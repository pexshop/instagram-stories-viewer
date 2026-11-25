# Instagram Stories Viewer

A mobile-friendly public Instagram viewer deployed on Cloudflare Workers. The backend uses a free-only InScrape adapter; API keys stay in Cloudflare Secrets and are never sent to the browser.

## Free-only provider

- Provider: InScrape REST API — https://inscrape.dev/docs/
- Authentication: `x-api-key` header, stored as Cloudflare Secret `INSCRAPE_API_KEY` (key begins with `sk_`).
- New accounts currently receive 100 free credits without a credit card. Credits are finite, not unlimited. See https://inscrape.dev/pricing/.
- The Worker enforces a separate hard cap of 100 credits for this deployment. It reserves up to 2 credits before each upstream request, settles against the provider's reported `credits_charged`, and stops when the local cap is exhausted.
- No paid provider fallback, automatic top-up, subscription, or purchase flow is implemented. The previous `SOCIALFETCH_API_KEY` is no longer used by the request adapter.
- Supported public-data routes: profile, live Stories, Highlights, Highlight Stories, posts, Reels, account search, hashtag posts, comments, and single-post metadata.
- Not supported by the currently verified free API: liker lists, trending Reels discovery, hashtag autocomplete. These routes fail closed without contacting a provider.
- Private account content, DMs, notifications, saved posts, owner-only insights, and expired Stories are not available through public-data endpoints.

## Configure the Cloudflare Worker

1. Open Cloudflare Dashboard → **Workers & Pages** → **instagram-stories-viewer**.
2. Open **Settings → Variables and Secrets**.
3. Add an encrypted Secret:
   - Name: `INSCRAPE_API_KEY`
   - Value: your InScrape key (starts with `sk_`).
4. Create the free account at https://inscrape.dev/ and copy the key from its dashboard. Do not paste it into GitHub, frontend files, or chat.
5. Deploy the latest GitHub commit.
6. Check `/api/status` for key configuration and the Worker-side remaining budget. This status check does not call InScrape or consume credits.
7. Run one real public profile lookup to verify the key. The first successful query will consume the endpoint's free credits.

## API routes

- `GET /api/health` — provider and key-configuration status.
- `GET /api/status` — free-budget state; does not consume provider credits.
- `GET /api/profile?username=nasa` — public profile and recent posts.
- `GET /api/stories?username=nasa` — live public Stories.
- `GET /api/highlights?username=nasa` — saved Highlight albums.
- `GET /api/highlight?id=HIGHLIGHT_ID` — media inside one Highlight.
- `GET /api/media?username=nasa&tab=posts` — public posts.
- `GET /api/media?username=nasa&tab=reels` — public Reels.
- `GET /api/search/profiles?query=...` — public account search.
- `GET /api/hashtags/media?hashtag=...` — public posts for an exact hashtag.
- `GET /api/comments?media=...` — comments on a public post.
- `GET /api/media/detail?media=...` — public post metadata.
- `GET /api/media/music?media=...` — music/audio metadata when exposed by Instagram.

## Budget and fail-closed behavior

- The local Durable Object budget cap is 100 credits and is not reset by redeploying the Worker.
- Each request reserves up to 2 credits before it reaches InScrape. If the budget guard is unavailable, the request is blocked.
- Successful responses are settled using the provider's `credits_charged` value. Ambiguous timeouts conservatively reserve the maximum amount.
- When the local budget is exhausted, the Worker stops. It never automatically switches to a paid provider or buys more credits.
- This is a finite free allowance, not an unlimited free service. Do not add a payment method or purchase credits if you require a strict zero-spend setup. If you later purchase credits in the provider account, the Worker-side 100-credit cap still limits this deployment's use, but the provider account's own billing configuration remains under your control.

## Provider documentation

- API docs: https://inscrape.dev/docs/
- Authentication and quickstart: https://inscrape.dev/docs/quickstart/
- Endpoint catalogue: https://inscrape.dev/docs/instagram/
- Credits and billing: https://inscrape.dev/docs/credits/
- Pricing/free allowance: https://inscrape.dev/pricing/

## Frontend features

- Public username lookup.
- Live Story viewer with autoplay, pause/resume, progress, previous/next, fullscreen, keyboard and touch navigation.
- Highlight album list and playback.
- Posts and Reels display/playback when public media URLs are returned.
- Public account search and exact hashtag post browsing.
- Public post comments and audio metadata when the provider returns them.
- Responsive mobile layout.

## Security and privacy

- Store `INSCRAPE_API_KEY` only as a Cloudflare encrypted Secret.
- Never put API keys in `public/index.html`, frontend JavaScript, GitHub commits, query strings, or screenshots.
- The site does not ask for Instagram credentials or attempt to bypass private-account restrictions.
- Use public data only and follow provider terms, Instagram terms, and applicable privacy/data-protection rules.
