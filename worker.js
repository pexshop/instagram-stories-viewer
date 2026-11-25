const SECURITY_HEADERS={
 "X-Content-Type-Options":"nosniff",
 "X-Frame-Options":"DENY",
 "Referrer-Policy":"no-referrer",
 "Cross-Origin-Resource-Policy":"same-origin",
 "X-DNS-Prefetch-Control":"off",
 "X-Download-Options":"noopen",
 "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
 "Cross-Origin-Opener-Policy":"same-origin",
 "X-Permitted-Cross-Domain-Policies":"none",
 "Origin-Agent-Cluster":"?1",
 "Strict-Transport-Security":"max-age=31536000; includeSubDomains",
 "X-Robots-Tag":"noindex, nofollow, noarchive"
};
function badRequest(message){const error=new Error(message);error.status=400;return error;}
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
 const stylePolicy=nonce
  ? `style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'`
  : "style-src 'self'; style-src-attr 'unsafe-inline'";
 headers.set("Content-Security-Policy",`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self' blob:; ${scriptPolicy}; ${stylePolicy}; img-src 'self' data: blob: https://*.cdninstagram.com https://*.fbcdn.net https://assets.science.nasa.gov; media-src 'self' blob: https://*.cdninstagram.com https://*.fbcdn.net; font-src 'self' data:; connect-src 'self'; frame-src https://www.instagram.com https://open.spotify.com; upgrade-insecure-requests`);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function secureAssetResponse(response){
 if(!response.ok)return withSecurity(response);
 const type=response.headers.get("content-type")||"";
 if(!type.toLowerCase().includes("text/html"))return withSecurity(response);
 const nonce=nonceValue();
 const html=await response.text();
 const secured=html.replace(/<(script|style)\b/gi,match=>match+` nonce="${nonce}"`);
 const headers=new Headers(response.headers);
 headers.set("Cache-Control","no-store, max-age=0");
 headers.set("Pragma","no-cache");
 headers.delete("ETag");
 headers.delete("Last-Modified");
 return withSecurity(new Response(secured,{status:response.status,statusText:response.statusText,headers}),nonce);
}
const json=(data,status=200)=>withSecurity(new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","pragma":"no-cache"}}));
async function rateLimit(request,path,env){
 if(!env.RATE_LIMITER)return {allowed:false,unavailable:true};
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 const expensive=/\/(profile|stories|highlights?|media|comments|likers|trending|search)/.test(path);
 const limit=expensive?20:90;
 try{
  const id=env.RATE_LIMITER.idFromName(ip+"|"+(expensive?"expensive":"general"));
  const stub=env.RATE_LIMITER.get(id);
  const response=await stub.fetch("https://rate-limiter.internal/check",{
   method:"POST",
   headers:{"content-type":"application/json"},
   body:JSON.stringify({limit,windowMs:60_000})
  });
  if(!response.ok)return {allowed:false,unavailable:true};
  return await response.json();
 }catch{return {allowed:false,unavailable:true};}
}
function validMedia(value){
 const raw=String(value||"").trim();
 if(!raw||raw.length>500)throw badRequest("请输入有效的 Instagram 帖子或 Reels 链接。");
 let u;try{u=new URL(raw)}catch{throw badRequest("请使用完整的 Instagram 官方链接。");}
 if(u.protocol!=="https:"||!/(^|\.)instagram\.com$/i.test(u.hostname)||u.username||u.password)throw badRequest("只支持 HTTPS Instagram 官方链接。");
 if(!/^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw badRequest("请使用 Instagram 帖子或 Reels 链接。");
 return u.origin+u.pathname;
}
function safeCursor(value){
 if(!value)return null;
 const v=String(value).trim();
 if(v.length>500||/[<>\r\n]/.test(v))throw badRequest("分页标记无效，请重新加载列表。");
 return v;
}
function cleanProfile(value){
 let raw=String(value||"").trim();
 if(/^https?:\/\//i.test(raw)){
  let parsed;try{parsed=new URL(raw)}catch{throw badRequest("Instagram 主页链接无效。")}
  if(parsed.protocol!=="https:"||!/(^|\.)instagram\.com$/i.test(parsed.hostname)||parsed.username||parsed.password)throw badRequest("只支持 HTTPS Instagram 官方主页链接。");
  const parts=parsed.pathname.split("/").filter(Boolean);
  raw=parts[0]==="stories"?parts[1]||"":parts[0]||"";
 }
 raw=raw.replace(/^@/,"");
 if(!/^[A-Za-z0-9._]{1,30}$/.test(raw))throw badRequest("请输入有效的 Instagram 用户名，或 instagram.com 用户主页链接。");
 return raw;
}

function inscrapeMedia(x){
 const f=x?.firstMedia?.[0]||x?.carouselMedia?.[0]||{};
 const carousel=Array.isArray(x?.carouselMedia)?x.carouselMedia.map((c,i)=>({id:c.id||String(i),mediaType:c.videoUrl?"video":"image",videoUrl:c.videoUrl||null,imageUrl:c.url||null,thumbnailUrl:c.url||c.videoUrl||null,caption:x.caption||"",createdAt:x.post_timestamp||null,url:x.postLink||null})):undefined;
 return {...x,mediaType:(x?.mediaType===2||x?.product_type==="clips"||x?.videoUrl||f.videoUrl)?"video":"image",videoUrl:x?.videoUrl||f.videoUrl||null,imageUrl:x?.imageUrl||f.url||null,thumbnailUrl:x?.thumbnailUrl||f.url||f.videoUrl||null,createdAt:x?.createdAt||x?.post_timestamp||x?.takenAt||x?.taken_at||null,url:x?.url||x?.postLink||null,carousel};
}
function inscrapeAccount(x){return {handle:x?.handle||x?.username||x?.user?.username||"",displayName:x?.display_name||x?.full_name||x?.username||"",avatarUrl:x?.profile_pic_url||x?.avatarUrl||"",verified:!!(x?.is_verified||x?.isVerified)};}
function unsupportedFreeFeature(msg){const e=new Error(msg);e.status=501;return e;}
async function social(path,env){
 if(!env.INSCRAPE_API_KEY){const e=new Error("尚未配置 InScrape 免费 API Key。请在 Cloudflare Worker Secrets 添加 INSCRAPE_API_KEY。");e.status=503;throw e;}
 if(typeof path!=="string"||!path.startsWith("/v2/instagram/")||path.includes("..")||path.length>1800){const e=new Error("无效的上游请求。");e.status=400;throw e;}
 const [p,q=""]=path.split("?"),old=new URLSearchParams(q),params=new URLSearchParams();let endpoint="",kind="";
 const stories=p.match(/^\/v2\/instagram\/profiles\/([^/]+)\/stories$/),highlights=p.match(/^\/v2\/instagram\/profiles\/([^/]+)\/highlights$/),list=p.match(/^\/v2\/instagram\/profiles\/([^/]+)\/media$/),profile=p.match(/^\/v2\/instagram\/profiles\/([^/]+)$/),highlight=p.match(/^\/v2\/instagram\/highlights\/(\d{5,30})$/),tag=p.match(/^\/v2\/instagram\/hashtags\/([^/]+)\/media$/),comments=p.match(/^\/v2\/instagram\/media\/([^/]+)\/comments$/),media=p.match(/^\/v2\/instagram\/media\/([^/]+)$/),search=p==="/v2/instagram/profiles/search",cursor=old.get("cursor");
 if(stories){endpoint="/v1/instagram/stories";params.set("handle",decodeURIComponent(stories[1]));kind="stories";}
 else if(highlights){endpoint="/v1/instagram/highlights";params.set("handle",decodeURIComponent(highlights[1]));kind="highlights";}
 else if(list){kind=old.get("tab")==="reels"?"reels":"posts";endpoint="/v1/instagram/"+kind;params.set("handle",decodeURIComponent(list[1]));if(cursor)params.set("next_cursor",cursor);}
 else if(profile){endpoint="/v1/instagram/profile";params.set("handle",decodeURIComponent(profile[1]));params.set("include_posts","true");params.set("include_highlights","true");kind="profile";}
 else if(highlight){endpoint="/v1/instagram/highlight-stories";params.set("highlight_id",highlight[1]);kind="highlight";}
 else if(tag){endpoint="/v1/instagram/hashtag";params.set("tag",decodeURIComponent(tag[1]));if(cursor)params.set("cursor",cursor);kind="tag";}
 else if(search){endpoint="/v1/instagram/search-user";if(!old.get("query"))throw badRequest("请输入搜索关键词。");params.set("query",old.get("query"));if(cursor)params.set("cursor",cursor);kind="search";}
 else if(comments){endpoint="/v1/instagram/comments";params.set("url",decodeURIComponent(comments[1]));if(cursor)params.set("cursor",cursor);kind="comments";}
 else if(media){endpoint="/v1/instagram/post";params.set("url",decodeURIComponent(media[1]));kind="media";}
 else if(p==="/v2/instagram/reels/trending")throw unsupportedFreeFeature("当前免费接口没有热门 Reels 榜单，未发送请求。");
 else if(p==="/v2/instagram/hashtags/search")throw unsupportedFreeFeature("免费接口不提供话题建议搜索。请直接输入准确话题标签浏览帖子。");
 else if(/\/likers$/.test(p))throw unsupportedFreeFeature("免费接口不提供帖子点赞者名单，未发送请求。");
 else throw unsupportedFreeFeature("该功能没有已验证的零付费兼容接口，已安全停止请求。");
 const id=env.RATE_LIMITER.idFromName("inscrape-free-budget-v1"),stub=env.RATE_LIMITER.get(id);
 const reserve=await stub.fetch("https://rate-limiter.internal/free-budget/reserve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({cost:2,cap:100})});
 if(!reserve.ok){const e=new Error("免费额度保护不可用，已停止请求以避免产生费用。");e.status=503;throw e;}
 const rsv=await reserve.json();if(!rsv.allowed){const e=new Error("100 个免费 credits 安全上限已用完或已预留完毕。不会自动购买积分，也不会调用收费服务。");e.status=402;throw e;}
 let response,data;
 try{
  const u=new URL("https://api.inscrape.dev"+endpoint);u.search=params.toString();
  response=await fetch(u.toString(),{headers:{"x-api-key":env.INSCRAPE_API_KEY,"accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(15000)});
  const raw=await response.text();if(raw.length>5_000_000)throw Error("response too large");data=JSON.parse(raw);
 }catch(e){
  await stub.fetch("https://rate-limiter.internal/free-budget/settle",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reserved:2,charged:2})}).catch(()=>{});
  const err=new Error("InScrape 连接失败或超时。为保护免费预算，已保留最多 2 credits，不会切换到收费服务。");err.status=504;throw err;
 }
 const n=Number(data?.credits_charged),charged=Number.isFinite(n)&&n>=0?Math.min(2,n):(response.ok?2:0);
 await stub.fetch("https://rate-limiter.internal/free-budget/settle",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reserved:2,charged})}).catch(()=>{});
 if(!response.ok||data?.success===false){
  const status=response.status===402?402:response.status===429?429:503;
  const msg=response.status===401?"InScrape Key 无效，请检查 INSCRAPE_API_KEY。":response.status===402?"InScrape 免费 credits 不足或 Key 限额已到。已停止请求，不会自动购买或调用付费服务。":response.status===429?"InScrape 暂时限制请求，请稍后重试。":"InScrape 服务暂时不可用。";
  const e=new Error(msg);e.status=status;throw e;
 }
 const d=data.data||{};let out={};
 if(kind==="profile"){const x=d.profile||d;out={profile:{...x,handle:x.handle||x.username,displayName:x.full_name||x.handle,avatarUrl:x.profile_pic_url,avatarUrlHd:x.profile_pic_url_hd||x.profile_pic_url,bio:x.biography,verified:!!x.is_verified,metrics:{posts:x.media_count??null,followers:x.follower_count??null,following:x.following_count??null}},recentMedia:(d.posts||[]).map(inscrapeMedia),about:{bio:x.biography||"",externalUrl:x.external_url||null}};}
 else if(kind==="stories")out={lookupStatus:"ok",media:(d.stories||[]).map(inscrapeMedia)};
 else if(kind==="highlights")out={lookupStatus:"ok",highlights:d.highlights||[]};
 else if(kind==="highlight")out={lookupStatus:"ok",highlight:null,media:(d.stories||d.media||[]).map(inscrapeMedia)};
 else if(kind==="posts"||kind==="reels")out={lookupStatus:"ok",media:(d[kind]||d.media||[]).map(inscrapeMedia),page:{nextCursor:d.next_cursor||null,hasNextPage:!!d.has_next_page}};
 else if(kind==="tag")out={media:(d.posts||d.media||[]).map(inscrapeMedia),page:{nextCursor:d.next_cursor||null,hasNextPage:!!d.has_next_page}};
 else if(kind==="search")out={accounts:(d.users||d.accounts||[]).map(inscrapeAccount),page:{nextCursor:d.next_cursor||null,hasNextPage:!!d.has_next_page}};
 else if(kind==="comments")out={lookupStatus:"ok",comments:(d.comments||[]).map(x=>({...x,author:x.author||{handle:x.username||x.owner?.username},text:x.text||x.comment||"",likeCount:x.like_count??x.likeCount??0,replyCount:x.reply_count??x.replyCount??0})),page:{nextCursor:d.next_cursor||null,hasNextPage:!!d.has_next_page}};
 else if(kind==="media"){const x=Array.isArray(d.media)?d.media[0]||null:d.media||null,m=x?.clips_metadata||{},a=m.music_info||m.original_sound_info||null;out={lookupStatus:x?"ok":"not_found",media:x?inscrapeMedia(x):null,audio:a?{id:a.music_canonical_id||a.audio_asset_id||null,title:a.title||a.original_audio_title||"Original audio",artist:a.artist||a.ig_artist?.username||"",isOriginal:!!m.original_sound_info}:null};}
 return {data:out,meta:{provider:"InScrape",creditsCharged:charged,creditsRemaining:data.credits_remaining??null,stale:false}};
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
export class RateLimiter {
 constructor(state,env){this.state=state;this.env=env;}
 async fetch(request){
  const url=new URL(request.url);
  if(url.hostname!=="rate-limiter.internal")return new Response("Not found",{status:404,headers:{"cache-control":"no-store"}});
  if(url.pathname==="/free-budget/state"){
   if(request.method!=="GET")return new Response("Method not allowed",{status:405});
   const b=await this.state.storage.get("inscrapeFreeBudget")||{used:0,reserved:0,cap:100};
   return Response.json({used:b.used,reserved:b.reserved,cap:b.cap,remaining:Math.max(0,b.cap-b.used-b.reserved)},{headers:{"cache-control":"no-store"}});
  }
  if(url.pathname==="/free-budget/reserve"){
   if(request.method!=="POST")return new Response("Method not allowed",{status:405});
   let input;try{input=await request.json()}catch{return new Response("Bad request",{status:400});}
   const cost=Math.max(0.1,Math.min(2,Number(input.cost)||2));
   const result=await this.state.storage.transaction(async tx=>{
    const b=await tx.get("inscrapeFreeBudget")||{used:0,reserved:0,cap:100};
    b.cap=Math.min(b.cap||100,100);
    if(b.used+b.reserved+cost>b.cap)return {allowed:false,used:b.used,reserved:b.reserved,cap:b.cap,remaining:Math.max(0,b.cap-b.used-b.reserved)};
    b.reserved+=cost;await tx.put("inscrapeFreeBudget",b);return {allowed:true,used:b.used,reserved:b.reserved,cap:b.cap,remaining:Math.max(0,b.cap-b.used-b.reserved)};
   });
   return Response.json(result,{headers:{"cache-control":"no-store"}});
  }
  if(url.pathname==="/free-budget/settle"){
   if(request.method!=="POST")return new Response("Method not allowed",{status:405});
   let input;try{input=await request.json()}catch{return new Response("Bad request",{status:400});}
   const reserved=Math.max(0,Math.min(2,Number(input.reserved)||0)),charged=Math.max(0,Math.min(2,Number(input.charged)||0));
   const b=await this.state.storage.transaction(async tx=>{const x=await tx.get("inscrapeFreeBudget")||{used:0,reserved:0,cap:100};x.reserved=Math.max(0,x.reserved-reserved);x.used=Math.min(100,x.used+charged);await tx.put("inscrapeFreeBudget",x);return x;});
   return Response.json({used:b.used,reserved:b.reserved,cap:b.cap,remaining:Math.max(0,b.cap-b.used-b.reserved)},{headers:{"cache-control":"no-store"}});
  }
  if(url.pathname==="/credit-state"){
   if(request.method!=="GET")return new Response("Method not allowed",{status:405});
   const state=await this.state.storage.get("creditGuard");
   const now=Date.now();
   if(state?.pausedUntil&&state.pausedUntil<=now){await this.state.storage.delete("creditGuard");return Response.json({paused:false},{headers:{"cache-control":"no-store"}});}
   return Response.json({paused:!!state?.pausedUntil,retryAt:state?.pausedUntil||null},{headers:{"cache-control":"no-store"}});
  }
  if(url.pathname==="/credit-state/exhausted"){
   if(request.method!=="POST")return new Response("Method not allowed",{status:405});
   const input=await request.json().catch(()=>({}));
   const pauseMs=24*60*60*1000;
   const pausedUntil=Date.now()+pauseMs;
   await this.state.storage.put("creditGuard",{pausedUntil});
   await this.state.storage.setAlarm(pausedUntil);
   return Response.json({paused:true,retryAt:pausedUntil},{headers:{"cache-control":"no-store"}});
  }
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  let input;
  try{input=await request.json()}catch{return new Response("Bad request",{status:400});}
  const limit=Math.max(1,Math.min(100,Number(input.limit)||1));
  const windowMs=Math.max(1000,Math.min(300000,Number(input.windowMs)||60000));
  const now=Date.now();
  let result;
  try{
   result=await this.state.storage.transaction(async tx=>{
    let bucket=await tx.get("bucket");
    if(!bucket||now-bucket.start>=windowMs)bucket={start:now,count:0};
    bucket.count++;
    await tx.put("bucket",bucket);
    return {allowed:bucket.count<=limit,remaining:Math.max(0,limit-bucket.count),resetAt:bucket.start+windowMs};
   });
   await this.state.storage.setAlarm(now+windowMs*2);
  }catch{return new Response("Rate limiter storage unavailable",{status:503});}
  return Response.json(result,{headers:{"cache-control":"no-store"}});
 }
 async alarm(){
  try{await this.state.storage.delete("bucket");}catch{}
 }
}

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(url.pathname.startsWith("/api/")){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const origin=request.headers.get("Origin");
    if(origin&&origin!==url.origin)return json({error:"Cross-origin request blocked"},403);
    if(request.headers.get("Sec-Fetch-Site")==="cross-site")return json({error:"Cross-site request blocked"},403);
    const rate=await rateLimit(request,url.pathname,env);
    if(rate.unavailable)return json({error:"安全限流服务暂不可用，请稍后重试。"},503);
    if(!rate.allowed)return withSecurity(new Response(JSON.stringify({error:"请求过于频繁，请一分钟后重试。"}),{status:429,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","retry-after":"60"}}));
   }
   if(url.pathname==="/spotify/callback"){
    const target=new URL("/spotify-player.html",url);
    target.search=url.search;
    return withSecurity(Response.redirect(target.toString(),302));
   }
   if(url.pathname==="/api/health") return json({ok:true,service:"instagram-stories-viewer",provider:"InScrape",apiKeyConfigured:!!env.INSCRAPE_API_KEY,paidFallback:false});
   if(url.pathname==="/api/status") {
    const configured=!!env.INSCRAPE_API_KEY;let freeBudget={used:0,reserved:0,cap:100,remaining:100};
    try{const id=env.RATE_LIMITER.idFromName("inscrape-free-budget-v1"),stub=env.RATE_LIMITER.get(id),r=await stub.fetch("https://rate-limiter.internal/free-budget/state");if(r.ok)freeBudget=await r.json();}catch{}
    return json({connected:false,provider:"InScrape",apiKeyConfigured:configured,connectionState:configured?"configured_unverified":"missing_key",freeBudget,paidFallback:false,automaticPurchases:false,message:configured?"InScrape Key 已配置；状态检查不消耗 credits，首次真实查询成功后确认连接。":"请在 Cloudflare Worker Secrets 添加 INSCRAPE_API_KEY（sk_ 开头）。"});
   }
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
    if(!query||query.length>100) throw badRequest("请输入话题关键词。");
    const result=await social("/v2/instagram/hashtags/search?query="+encodeURIComponent(query),env);
    const d=result.data||{};
    return json({hashtags:d.hashtags||[],creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/hashtags/media"){
    const hashtag=String(url.searchParams.get("hashtag")||"").trim().replace(/^#/,"");
    if(!/^[\p{L}\p{N}_.]+$/u.test(hashtag)||hashtag.length>100) throw badRequest("话题标签格式无效。");
    const tab=["top","recent","reels"].includes(url.searchParams.get("tab"))?url.searchParams.get("tab"):"top";
    const cursor=safeCursor(url.searchParams.get("cursor"));
    const qs=new URLSearchParams({tab});if(cursor)qs.set("cursor",cursor);
    const result=await social("/v2/instagram/hashtags/"+encodeURIComponent(hashtag)+"/media?"+qs.toString(),env);
    const d=result.data||{};
    return json({media:normalize(d.media),page:d.page||null,creditsCharged:result.meta?.creditsCharged??null});
   }
   if(url.pathname==="/api/search/profiles"){
    const query=String(url.searchParams.get("query")||"").trim();
    if(!query||query.length>100) throw badRequest("请输入要搜索的账号关键词（最多 100 个字符）。");
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
    return json({lookupStatus:d.lookupStatus||"unknown",audio:d.audio||m.audio||null,post:m?{id:m.id||null,url:m.url||media,kind:m.kind||null,mediaType:m.mediaType||null,caption:m.caption||null,owner:m.owner||null}:null,creditsCharged:result.meta?.creditsCharged??null,stale:!!result.meta?.stale});
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
    if(!/^\d{5,30}$/.test(id)) throw badRequest("精选快拍 ID 无效。");
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
  }catch(e){const status=Number.isInteger(e.status)?e.status:500;const message=status>=500?"服务器暂时不可用，请稍后重试。":(e.message||"请求失败");return url.pathname.startsWith("/api/")?json({error:message,retryAt:e.retryAt||null},status):withSecurity(new Response("服务暂时不可用",{status:503}));}
 }
};
