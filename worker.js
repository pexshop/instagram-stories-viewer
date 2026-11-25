const VERSION = "v27.0";
const COOKIE = "igsv_session";
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,"0")).join("");
const cookie = (value, maxAge=604800) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function base(request, env){ return env.APP_ORIGIN || new URL(request.url).origin; }
async function graph(path, token, params={}) {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${path.replace(/^\//,"")}`);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  url.searchParams.set("access_token",token);
  const r = await fetch(url);
  const data = await r.json();
  if(!r.ok || data.error) throw new Error(data.error?.message || "Meta API request failed");
  return data;
}
async function session(request, env){
  const raw = request.headers.get("Cookie") || "";
  const id = raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if(!id) return null;
  const value = await env.SESSION_KV.get("session:"+id,"json");
  return value ? {id,...value} : null;
}
export default {
 async fetch(request, env){
  const url = new URL(request.url);
  if(request.method==="OPTIONS") return new Response(null,{headers:{"access-control-allow-origin":base(request,env),"access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type"}});
  try {
   if(url.pathname==="/api/health") return json({ok:true,service:"instagram-stories-viewer"});
   if(url.pathname==="/auth/login"){
    if(!env.META_APP_ID || !env.META_APP_SECRET || !env.SESSION_KV) return json({error:"请先配置 META_APP_ID、META_APP_SECRET 和 SESSION_KV。"},503);
    const state=randomId();
    await env.SESSION_KV.put("state:"+state,"1",{expirationTtl:600});
    const redirect=env.META_REDIRECT_URI || base(request,env)+"/auth/callback";
    const auth=new URL("https://www.facebook.com/"+VERSION+"/dialog/oauth");
    auth.searchParams.set("client_id",env.META_APP_ID);
    auth.searchParams.set("redirect_uri",redirect);
    auth.searchParams.set("state",state);
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("scope","instagram_basic,pages_show_list,pages_read_engagement");
    return Response.redirect(auth.toString(),302);
   }
   if(url.pathname==="/auth/callback"){
    const code=url.searchParams.get("code"), state=url.searchParams.get("state");
    if(!code || !state || !(await env.SESSION_KV.get("state:"+state))) return new Response("OAuth state 无效或已过期。请返回网站重新连接。",{status:400});
    await env.SESSION_KV.delete("state:"+state);
    const redirect=env.META_REDIRECT_URI || base(request,env)+"/auth/callback";
    const shortUrl=new URL("https://graph.facebook.com/"+VERSION+"/oauth/access_token");
    shortUrl.search=new URLSearchParams({client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:redirect,code}).toString();
    const sr=await fetch(shortUrl); const sd=await sr.json();
    if(!sr.ok || sd.error) throw new Error(sd.error?.message || "OAuth token exchange failed");
    const longUrl=new URL("https://graph.facebook.com/"+VERSION+"/oauth/access_token");
    longUrl.search=new URLSearchParams({grant_type:"fb_exchange_token",client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,fb_exchange_token:sd.access_token}).toString();
    const lr=await fetch(longUrl); const ld=await lr.json();
    const userToken=lr.ok && ld.access_token ? ld.access_token : sd.access_token;
    const pages=await graph("me/accounts",userToken,{fields:"id,name,access_token,instagram_business_account{id,username}"});
    const accounts=(pages.data||[]).filter(p=>p.instagram_business_account).map(p=>({id:p.instagram_business_account.id,username:p.instagram_business_account.username||p.name||"Instagram account",pageName:p.name||"",token:p.access_token}));
    if(!accounts.length) throw new Error("没有找到已关联 Facebook Page 的 Instagram 专业账号。请将 Instagram 商业/创作者账号连接到 Facebook Page，并确认应用权限。");
    const sid=randomId();
    await env.SESSION_KV.put("session:"+sid,JSON.stringify({accounts,createdAt:Date.now()}),{expirationTtl:60*60*24*30});
    return new Response(null,{status:302,headers:{location:base(request,env)+"/?connected=1", "set-cookie":cookie(sid)}});
   }
   if(url.pathname.startsWith("/api/")){
    const sess=await session(request,env);
    if(url.pathname==="/api/status") return json({connected:!!sess,accounts:sess?.accounts?.map(({id,username,pageName})=>({id,username,pageName}))||[]});
    if(url.pathname==="/api/logout" && request.method==="POST"){
      if(sess) await env.SESSION_KV.delete("session:"+sess.id);
      return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","set-cookie":cookie("",0),"cache-control":"no-store"}});
    }
    if(url.pathname==="/api/stories"){
      if(!sess) return json({error:"请先连接 Instagram 账号。"},401);
      const id=url.searchParams.get("account_id");
      const account=sess.accounts.find(a=>a.id===id) || sess.accounts[0];
      if(!account) return json({error:"没有可用的 Instagram 专业账号。"},404);
      const result=await graph(account.id+"/stories",account.token,{fields:"id,media_type,media_url,thumbnail_url,timestamp,permalink"});
      return json({account:{id:account.id,username:account.username},stories:result.data||[]});
    }
    return json({error:"Not found"},404);
   }
   return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Static assets binding missing",{status:500});
  } catch(e){ return url.pathname.startsWith("/api/") ? json({error:e.message},400) : new Response("Instagram 连接失败："+e.message+"。请返回网站检查 Meta 应用配置。",{status:400,headers:{"content-type":"text/plain; charset=utf-8"}}); }
 }
};