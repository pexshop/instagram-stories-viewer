const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
function cleanProfile(value){
 let raw=String(value||"").trim();
 if(/^https?:\/\//i.test(raw)){
  let parsed;try{parsed=new URL(raw)}catch{throw new Error("Instagram 主页链接无效。")}
  if(!/(^|\.)instagram\.com$/i.test(parsed.hostname))throw new Error("只支持 instagram.com 主页链接。");
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
   if(url.pathname==="/spotify/callback"){
    if(!env.ASSETS) return new Response("Static assets binding missing",{status:500});
    const assetUrl=new URL("/spotify-player.html",url);assetUrl.search=url.search;
    return env.ASSETS.fetch(new Request(assetUrl.toString(),request));
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
    const cursor=url.searchParams.get("cursor");
    const qs=new URLSearchParams({tab});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/hashtags/"+encodeURIComponent(hashtag)+"/media?"+qs.toString(),env);
    const d=result.data||{};
    return json({media:normalize(d.media),page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/search/profiles"){
    const query=String(url.searchParams.get("query")||"").trim();
    if(!query||query.length>100) throw new Error("请输入要搜索的账号关键词（最多 100 个字符）。");
    const cursor=url.searchParams.get("cursor");
    const qs=new URLSearchParams({query});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/profiles/search?"+qs.toString(),env);
    const d=result.data||{};
    return json({accounts:d.accounts||[],page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/comments"){
    const media=String(url.searchParams.get("media")||"").trim();
    if(!media||media.length>500) throw new Error("请输入 Instagram 帖子或 Reels 链接。");
    const sort=url.searchParams.get("sort")==="newest"?"newest":"top";
    const cursor=url.searchParams.get("cursor");
    const qs=new URLSearchParams({sort});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media)+"/comments?"+qs.toString(),env);
    const d=result.data||{};
    return json({lookupStatus:d.lookupStatus||"unknown",comments:d.comments||[],page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/likers"){
    const media=String(url.searchParams.get("media")||"").trim();
    if(!media||media.length>500) throw new Error("请输入 Instagram 帖子或 Reels 链接。");
    const result=await social("/v2/instagram/media/"+encodeURIComponent(media)+"/likers",env);
    const d=result.data||{};
    return json({lookupStatus:d.lookupStatus||"unknown",accounts:d.accounts||[],sampled:!!d.sampled,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/media/detail"){
    const media=String(url.searchParams.get("media")||"").trim();
    if(!media||media.length>500) throw new Error("请输入 Instagram 帖子或 Reels 链接。");
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
   return env.ASSETS?env.ASSETS.fetch(request):new Response("Static assets binding missing",{status:500});
  }catch(e){const status=Number.isInteger(e.status)?e.status:400;return url.pathname.startsWith("/api/")?json({error:e.message},status):new Response("服务暂时不可用",{status:503});}
 }
};
