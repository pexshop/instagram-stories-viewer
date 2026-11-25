# Instagram Stories Viewer

A mobile-friendly public Instagram viewer deployed on Cloudflare Pages. The backend uses the Social Fetch public-data API; the API key stays in a Cloudflare Secret and is never sent to the browser.

## Current provider

- Social Fetch REST API: https://www.socialfetch.dev/docs/api/v2/instagram
- Authentication: `x-api-key` header, stored as Cloudflare Secret `SOCIALFETCH_API_KEY`.
- No Meta App ID, Meta App Secret, Facebook Login, Instagram password, or KV namespace is required for this provider mode.
- Supports public profile live Stories (last 24 hours), saved Story Highlights, profile posts and Reels where the provider can retrieve them.
- Private accounts, expired Stories, restricted/removed content, and media blocked by Instagram are not accessible. This does not bypass access controls.

## Deploy on Cloudflare Pages

1. Open Cloudflare Dashboard → **Workers & Pages** → **instagram-stories-viewer**.
2. Open **Settings → Variables and Secrets**.
3. Add an encrypted Secret:
   - Name: `SOCIALFETCH_API_KEY`
   - Value: your Social Fetch API key (starts with `sfk_`).
4. Create a key at https://app.socialfetch.dev/signup and copy it when shown. Keep it private; do not commit it to GitHub or paste it into the website.
5. Trigger a new deployment from the latest GitHub commit.
6. Test:
   - `https://instagram-stories-viewer.pages.dev/api/health` should show `ok:true` and `apiKeyConfigured:true`.
   - Open the site, enter a public Instagram username (without @), then choose Stories, Highlights, Posts or Reels.

## API routes

- `GET /api/health` — provider and configuration status.
- `GET /api/status` — indicates whether the server-side API key exists.
- `GET /api/stories?username=nasa` — live public Stories.
- `GET /api/highlights?username=nasa` — saved highlight albums.
- `GET /api/highlight?id=HIGHLIGHT_ID` — media inside one highlight.
- `GET /api/media?username=nasa&tab=posts` — posts.
- `GET /api/media?username=nasa&tab=reels` — Reels.

## Credits and reliability

Social Fetch bills by credits. Its documentation currently lists public profile live Stories at 3 credits per lookup, Highlights at 1 credit, and profile media at 1 credit per page. Check the provider dashboard for current pricing, available credits, and usage limits before repeated use. CDN media URLs can expire, and provider results may occasionally be stale or unavailable.

Provider documentation:
- Authentication: https://www.socialfetch.dev/docs/authentication
- Live Stories: https://www.socialfetch.dev/docs/api/v2/instagram/profiles/profile/stories/get
- Highlights: https://www.socialfetch.dev/docs/api/v2/instagram/profiles/profile/highlights/get
- Highlight contents: https://www.socialfetch.dev/docs/api/v2/instagram/highlights/highlightid/get
- Posts and Reels: https://www.socialfetch.dev/docs/api/v2/instagram/profiles/profile/media/get

## Frontend features

- Public username lookup; no Meta OAuth step.
- Live Story viewer with autoplay, pause/resume, progress bars, previous/next, loop, fullscreen, keyboard and touch navigation.
- Highlight album list and playback.
- Posts and Reels playback where direct media URLs are returned.
- Official Instagram embed.js for public post/Reel embeds.
- Responsive iPhone layout.

## Security and privacy

- Store `SOCIALFETCH_API_KEY` only as a Cloudflare encrypted Secret.
- Do not add API keys to `public/index.html`, frontend JavaScript, GitHub commits, query strings, or screenshots.
- The site does not ask for Instagram credentials or attempt to access private accounts.
- Use public data only, follow the provider terms and Instagram terms, and review applicable privacy/data-protection rules before storing or redistributing content.
