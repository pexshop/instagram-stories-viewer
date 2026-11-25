const SECURITY_HEADERS={
 "X-Content-Type-Options":"nosniff",
 "X-Frame-Options":"DENY",
 "Referrer-Policy":"strict-origin",
 "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
 "Cross-Origin-Opener-Policy":"same-origin",
 "X-Permitted-Cross-Domain-Policies":"none",
 "Origin-Agent-Cluster":"?1",
 "Strict-Transport-Security":"max-age=31536000; includeSubDomains"
};
const rateBuckets=new Map();
function nonceValue(){
 const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);
 return btoa(String.fromCharCode(...bytes));
}
function withSecurity(response,nonce=null){
 const headers=new Headers(response.headers);
 for(const [k,v] of Object.entries(SECURITY_HEADERS))headers.set(k,v);
 const scriptPolicy=nonce
  ? `script-src 'self' 'nonce-${nonce}' https://www.instagram.com`
  : "script-src 'self' https://www.instagram.com";
 headers.set("Content-Security-Policy",`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.cdninstagram.com https://*.fbcdn.net https://assets.science.nasa.gov; media-src 'self' blob: https://*.cdninstagram.com https://*.fbcdn.net; font-src 'self' data:; connect-src 'self'; frame-src https://www.instagram.com https://open.spotify.com; upgrade-insecure-requests`);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function secureAssetResponse(response){
 if(!response.ok)return withSecurity(response);
 const type=response.headers.get("content-type")||"";
 if(!type.toLowerCase().includes("text/html"))return withSecurity(response);
 const nonce=nonceValue();
 const html=await response.text();
 const secured=html.replace(/<script\b/gi,match=>match+` nonce="${nonce}"`);
 const headers=new Headers(response.headers);
 headers.set("Cache-Control","no-store, max-age=0");
 headers.set("Pragma","no-cache");
 headers.delete("ETag");
 headers.delete("Last-Modified");
 return withSecurity(new Response(secured,{status:response.status,statusText:response.statusText,headers}),nonce);
}
const json=(data,status=200)=>withSecurity(new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","pragma":"no-cache"}}));
function rateLimit(request,path){
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 const now=Date.now(),windowMs=60_000;
 for(const [key,b] of rateBuckets){if(now-b.start>windowMs)rateBuckets.delete(key);}
 const expensive=/\/(profile|stories|highlights?|media|comments|likers|trending|search)/.test(path);
 const limit=expensive?12:60,key=ip+"|"+(expensive?"expensive":"general");
 let bucket=rateBuckets.get(key);
 if(!bucket||now-bucket.start>windowMs){bucket={start:now,count:0};rateBuckets.set(key,bucket);}
 bucket.count++;
 return bucket.count<=limit;
}
function validMedia(value){
 const raw=String(value||"").trim();
 if(!raw||raw.length>500)throw new Error("请输入有效的 Instagram 帖子或 Reels 链接。");
 let u;try{u=new URL(raw)}catch{throw new Error("请使用完整的 Instagram 官方链接。");}
 if(u.protocol!=="https:"||!/(^|\.)instagram\.com$/i.test(u.hostname)||u.username||u.password)throw new Error("只支持 HTTPS Instagram 官方链接。");
 if(!/^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw new Error("请使用 Instagram 帖子或 Reels 链接。");
 return u.origin+u.pathname;
}
function safeCursor(value){
 if(!value)return null;
 const v=String(value).trim();
 if(v.length>500||/[<>\r\n]/.test(v))throw new Error("分页标记无效，请重新加载列表。");
 return v;
}
function cleanProfile(value){
 let raw=String(value||"").trim();
 if(/^https?:\/\//i.test(raw)){
  let parsed;try{parsed=new URL(raw)}catch{throw new Error("Instagram 主页链接无效。")}
  if(parsed.protocol!=="https:"||!/(^|\.)instagram\.com$/i.test(parsed.hostname)||parsed.username||parsed.password)throw new Error("只支持 HTTPS Instagram 官方主页链接。");
  const parts=parsed.pathname.split("/").filter(Boolean);
  raw=parts[0]==="stories"?parts[1]||"":parts[0]||"";
 }
 raw=raw.replace(/^@/,"");
 if(!/^[A-Za-z0-9._]{1,30}$/.test(raw))throw new Error("请输入有效的 Instagram 用户名，或 instagram.com 用户主页链接。");
 return raw;
}
async function social(path,env){
 if(!env.SOCIALFETCH_API_KEY) throw new Error("尚未配置 SOCIALFETCH_API_KEY。请在 Cloudflare Pages → Settings → Variables and Secrets 添加加密 Secret。");
 let response;try{response=await fetch("https://api.socialfetch.dev"+path,{headers:{"x-api-key":env.SOCIALFETCH_API_KEY,"accept":"application/json"},signal:AbortSignal.timeout(15000)});}catch(e){if(e.name==="TimeoutError"||e.name==="AbortError"){const error=new Error("第三方 API 响应超过 15 秒，已自动停止等待。请稍后重试。");error.status=504;throw error;}throw e;}
 const data=await response.json().catch(()=>({}));
 if(!response.ok) {
  const msg=data.error?.message||data.error?.detail||data.message||("第三方 API 请求失败（HTTP "+response.status+"）");
  const error=new Error(response.status===401?"Social Fetch API Key 无效或已撤销。":response.status===402?"Social Fetch 额度不足或需要充值。":response.status===429?"请求过于频繁，请稍后重试。":msg); error.status=response.status>=500?502:response.status; throw error;
 }
 return data;
}
function normalize(items){
 const typeOf=x=>{const t=String(x?.mediaType||"").toLowerCase();if(t==="video"||x?.videoUrl)return "VIDEO";if(t==="carousel"||Array.isArray(x?.carousel)&&x.carousel.length)return "CAROUSEL";return "IMAGE"};
 const one=x=>({
  id:x.id||null,
  media_type:typeOf(x),
  media_url:x.videoUrl||x.imageUrl||x.thumbnailUrl||x.carousel?.[0]?.videoUrl||x.carousel?.[0]?.imageUrl||"",
  thumbnail_url:x.thumbnailUrl||x.imageUrl||x.carousel?.[0]?.imageUrl||x.carousel?.[0]?.videoUrl||"",
  timestamp:x.createdAt||x.story?.expiresAt||null,
  permalink:x.url||null,
  caption:x.caption||x.altText||"",
  kind:x.kind||"post",
  carousel:Array.isArray(x.carousel)?x.carousel.map((c,i)=>({id:c.id||String(i),media_type:String(c.mediaType||"").toLowerCase()==="video"||c.videoUrl?"VIDEO":"IMAGE",media_url:c.videoUrl||c.imageUrl||"",thumbnail_url:c.imageUrl||c.videoUrl||"",caption:c.altText||x.caption||"",timestamp:x.createdAt||null,permalink:x.url||null,kind:"carousel"})).filter(c=>c.media_url||c.thumbnail_url):[]
 });
 return (Array.isArray(items)?items:[]).map(one).filter(x=>x.media_url||x.thumbnail_url||x.carousel.length);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(url.pathname.startsWith("/api/")){
    if(request.method!=="GET"&&request.method!=="HEAD")return json({error:"Method not allowed"},405);
    const origin=request.headers.get("Origin");
    if(origin&&origin!==url.origin)return json({error:"Cross-origin request blocked"},403);
    if(request.headers.get("Sec-Fetch-Site")==="cross-site")return json({error:"Cross-site request blocked"},403);
    if(!rateLimit(request,url.pathname))return withSecurity(new Response(JSON.stringify({error:"请求过于频繁，请一分钟后重试。"}),{status:429,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","retry-after":"60"}}));
   }
   if(url.pathname==="/spotify/callback"){
    const target=new URL("/spotify-player.html",url);
    target.search=url.search;
    return withSecurity(Response.redirect(target.toString(),302));
   }
   if(url.pathname==="/api/health") return json({ok:true,service:"instagram-stories-viewer",provider:"Social Fetch",apiKeyConfigured:!!env.SOCIALFETCH_API_KEY});
   if(url.pathname==="/api/status") { const configured=!!env.SOCIALFETCH_API_KEY; return json({connected:configured,provider:"Social Fetch",apiKeyConfigured:configured,connectionState:configured?"configured":"missing_key",requiresMetaLogin:false}); }
   if(url.pathname==="/api/profile"){
    const profile=cleanProfile(url.searchParams.get("username"));
    const result=await social("/v2/instagram/profiles/"+encodeURIComponent(profile)+"?include=recentMedia,about",env);
    const d=result.data||{};
    return json({username:profile,lookupStatus:d.lookupStatus||"unknown",profile:d.profile||null,recentMedia:normalize(d.recentMedia),about:d.about||null,creditsCharged:result.meta?.creditsCharged??null,stale:!!result.meta?.stale});
   }
   if(url.pathname==="/api/trending/reels"){
    const result=await social("/v2/instagram/reels/trending",env);
    const d=result.data||{};
    return json({media:normalize(d.media),items:d.media||[],creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/hashtags/search"){
    const query=String(url.searchParams.get("query")||"").trim();
    if(!query||query.length>100) throw new Error("请输入话题关键词。");
    const result=await social("/v2/instagram/hashtags/search?query="+encodeURIComponent(query),env);
    const d=result.data||{};
    return json({hashtags:d.hashtags||[],creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/hashtags/media"){
    const hashtag=String(url.searchParams.get("hashtag")||"").trim().replace(/^#/,"");
    if(!/^[\p{L}\p{N}_.]+$/u.test(hashtag)||hashtag.length>100) throw new Error("话题标签格式无效。");
    const tab=["top","recent","reels"].includes(url.searchParams.get("tab"))?url.searchParams.get("tab"):"top";
    const cursor=safeCursor(url.searchParams.get("cursor"));
    const qs=new URLSearchParams({tab});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/hashtags/"+encodeURIComponent(hashtag)+"/media?"+qs.toString(),env);
    const d=result.data||{};
    return json({media:normalize(d.media),page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/search/profiles"){
    const query=String(url.searchParams.get("query")||"").trim();
    if(!query||query.length>100) throw new Error("请输入要搜索的账号关键词（最多 100 个字符）。");
    const cursor=safeCursor(url.searchParams.get("cursor"));
    const qs=new URLSearchParams({query});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/profiles/search?"+qs.toString(),env);
    const d=result.data||{};
    return json({accounts:d.accounts||[],page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/comments"){
    const media=validMedia(url.searchParams.get("media"));
    const sort=url.searchParams.get("sort")==="newest"?"newest":"top";
    const cursor=safeCursor(url.searchParams.get("cursor"));
    const qs=new URLSearchParams({sort});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media)+"/comments?"+qs.toString(),env);
    const d=result.data||{};
    return json({lookupStatus:d.lookupStatus||"unknown",comments:d.comments||[],page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/likers"){
    const media=validMedia(url.searchParams.get("media"));
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media)+"/likers",env);
    const d=result.data||{};
    return json({lookupStatus:d.lookupStatus||"unknown",accounts:d.accounts||[],sampled:!!d.sampled,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/media/music"){
    const media=validMedia(url.searchParams.get("media"));
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media),env);
    const d=result.data||{},m=d.media||{};
    return json({lookupStatus:d.lookupStatus||"unknown",audio:m.audio||null,post:m?{id:m.id||null,url:m.url||media,kind:m.kind||null,mediaType:m.mediaType||null,caption:m.caption||null,owner:m.owner||null}:null,creditsCharged:result.meta?.creditsCharged??null,stale:!!result.meta?.stale});
   }
   if(url.pathname==="/api/media/detail"){
    const media=validMedia(url.searchParams.get("media"));
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media),env);
    const d=result.data||{};
    return json({lookupStatus:d.lookupStatus||"unknown",media:d.media||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/stories"){
    const profile=cleanProfile(url.searchParams.get("username"));
    const result=await social("/v2/instagram/profiles/"+encodeURIComponent(profile)+"/stories",env);
    const d=result.data||{};
    return json({username:profile,lookupStatus:d.lookupStatus||"unknown",stories:normalize(d.media),creditsCharged:result.meta?.creditsCharged??null,stale:!!result.meta?.stale,fetchedAt:result.meta?.fetchedAt||null});
   }
   if(url.pathname==="/api/highlights"){
    const profile=cleanProfile(url.searchParams.get("username"));
    const result=await social("/v2/instagram/profiles/"+encodeURIComponent(profile)+"/highlights",env);
    const d=result.data||{};
    return json({username:profile,lookupStatus:d.lookupStatus||"unknown",highlights:d.highlights||[],creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/highlight"){
    const id=String(url.searchParams.get("id")||"").trim();
    if(!/^\d{5,30}$/.test(id)) throw new Error("精选快拍 ID 无效。");
    const result=await social("/v2/instagram/highlights/"+encodeURIComponent(id),env);
    const d=result.data||{};
    return json({highlight:d.highlight||null,stories:normalize(d.media),lookupStatus:d.lookupStatus||"unknown",creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/media"){
    const profile=cleanProfile(url.searchParams.get("username"));
    const tab=["posts","reels"].includes(url.searchParams.get("tab"))?url.searchParams.get("tab"):"posts";
    const result=await social("/v2/instagram/profiles/"+encodeURIComponent(profile)+"/media?tab="+tab,env);
    const d=result.data||{};
    return json({username:profile,lookupStatus:d.lookupStatus||"unknown",media:normalize(d.media),page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname.startsWith("/api/")) return json({error:"Not found"},404);
   return env.ASSETS?await secureAssetResponse(await env.ASSETS.fetch(request)):withSecurity(new Response("Static assets binding missing",{status:500}));
  }catch(e){const status=Number.isInteger(e.status)?e.status:400;return url.pathname.startsWith("/api/")?json({error:e.message||"请求失败"},status):withSecurity(new Response("服务暂时不可用",{status:503}));}
 }
};
