# Instagram Stories Viewer

Mobile-friendly Stories viewer for Instagram professional accounts you are authorized to manage.

## Important platform limitation

This project uses Meta's official Facebook Login + Instagram Graph API. The Stories edge `GET /{ig-user-id}/stories` returns Stories for the authorized Instagram professional account. It does **not** provide a feed of Stories from every account the user follows. This project does not scrape Instagram, request Instagram passwords, or bypass access controls.

Official reference: https://developers.facebook.com/docs/graph-api/reference/ig-user/stories/

## Deploy to Cloudflare Workers

**Use Workers, not Cloudflare Pages.** This repository contains a Worker backend and static assets. Cloudflare Pages static hosting alone will not run `worker.js`.

1. In Cloudflare Dashboard, open **Workers & Pages → KV** and create a namespace, e.g. `IGSV_SESSIONS`.
2. Copy its Namespace ID and add this block to `wrangler.toml` (replace the example ID with the real one):

   ```toml
   [[kv_namespaces]]
   binding = "SESSION_KV"
   id = "PASTE_REAL_KV_NAMESPACE_ID_HERE"
   ```
3. Create a Meta app at https://developers.facebook.com/apps/ and configure Facebook Login.
4. Choose your final Worker hostname, then replace both `YOUR-WORKER.workers.dev` values in `wrangler.toml`. The redirect URI must be exactly `https://YOUR-WORKER.workers.dev/auth/callback`.
5. In Meta App Dashboard, add that exact URL to the valid OAuth redirect URI list.
6. In Cloudflare Worker settings, add these as **Secrets** (not plain text variables):
   - `META_APP_ID`
   - `META_APP_SECRET`
7. Deploy using Wrangler:
   - Build command: leave empty
   - Deploy command: `npx wrangler@4 deploy`
   - Root directory: repository root
8. After deploy, open `https://YOUR-WORKER.workers.dev/api/health`. It should return JSON with `"ok":true` and `"kvConfigured":true`.

If using the Cloudflare dashboard Git integration for **Workers Builds**, select the Worker project and use the deploy command above. Do not configure it as a Pages project with only `public` as the build output directory.

## Required Meta permissions

The code requests `instagram_basic`, `pages_show_list`, and `pages_read_engagement`. Meta app review / business verification may be required for accounts outside app roles and for production use. Confirm the current requirements in Meta App Dashboard.

## Features

- Meta OAuth login; no Instagram password is collected by this site.
- Finds Instagram professional accounts linked to Facebook Pages authorized by the user.
- Server-side token storage in Cloudflare KV; tokens are never sent to the browser.
- Account selector, Stories refresh, full-screen viewer, progress bars, autoplay, pause/resume, previous/next, keyboard controls and touch navigation.
- Image/video playback and responsive iPhone layout.
- Disconnect / clear local session.

## Security notes

- Keep `META_APP_SECRET` in Worker Secrets, never in frontend files.
- KV stores access tokens server-side. Restrict access to your Cloudflare account.
- This starter stores a single browser session for up to 30 days. Add account deletion and privacy disclosures before public launch.
- Token expiration/revocation can occur; reconnect if Meta returns an OAuth error.
