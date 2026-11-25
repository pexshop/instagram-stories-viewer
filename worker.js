const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function cleanProfile(value){
 const raw=String(value||"").trim().replace(/^@/,"");
 if(!raw||raw.length>100||/[\s/?#]/.test(raw)) throw new Error("请输入有效的 Instagram 用户名，不要包含 @ 以外的特殊字符。");
 return raw;
}
async function social(path,env){
 if(!env.SOCIALFETCH_API_KEY) throw new Error("尚未配置 SOCIALFETCH_API_KEY。请在 Cloudflare Pages → Settings → Variables and Secrets 添加加密 Secret。");
 const response=await fetch("https://api.socialfetch.dev"+path,{headers:{"x-api-key":env.SOCIALFETCH_API_KEY,"accept":"application/json"}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok) {
  const msg=data.error?.message||data.error?.detail||data.message||("第三方 API 请求失败（HTTP "+response.status+"）");
  throw new Error(response.status===401?"Social Fetch API Key 无效或已撤销。":response.status===402?"Social Fetch 额度不足或需要充值。":response.status===429?"请求过于频繁，请稍后重试。":msg);
 }
 return data;
}
function normalize(items){
 return (items||[]).map(x=>({
  id:x.id,
  media_type:String(x.mediaType||"").toLowerCase()==="video"?"VIDEO":"IMAGE",
  media_url:x.videoUrl||x.imageUrl||x.thumbnailUrl||"",
  thumbnail_url:x.thumbnailUrl||x.imageUrl||"",
  timestamp:x.createdAt||x.story?.expiresAt||null,
  permalink:x.url||null,
  caption:x.caption||"",
  kind:x.kind||"story"
 })).filter(x=>x.media_url||x.thumbnail_url);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(url.pathname==="/api/health") return json({ok:true,service:"instagram-stories-viewer",provider:"Social Fetch",apiKeyConfigured:!!env.SOCIALFETCH_API_KEY});
   if(url.pathname==="/api/status") return json({connected:false,provider:"Social Fetch",apiKeyConfigured:!!env.SOCIALFETCH_API_KEY,requiresMetaLogin:false});
   if(url.pathname==="/api/profile"){
    const profile=cleanProfile(url.searchParams.get("username"));
    const result=await social("/v2/instagram/profiles/"+encodeURIComponent(profile)+"?include=recentMedia,about",env);
    const d=result.data||{};
    return json({username:profile,lookupStatus:d.lookupStatus||"unknown",profile:d.profile||null,recentMedia:normalize(d.recentMedia),about:d.about||null,creditsCharged:result.meta?.creditsCharged??null,stale:!!result.meta?.stale});
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
   return env.ASSETS?env.ASSETS.fetch(request):new Response("Static assets binding missing",{status:500});
  }catch(e){return url.pathname.startsWith("/api/")?json({error:e.message},400):new Response("服务暂时不可用",{status:503});}
 }
};
