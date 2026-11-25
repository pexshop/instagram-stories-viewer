# Instagram Stories Viewer

Mobile-friendly Stories viewer for Instagram professional accounts you are authorized to manage.

## Important platform limitation

This project uses Meta's official Facebook Login + Instagram Graph API. The Stories edge `GET /{ig-user-id}/stories` returns Stories for the authorized Instagram professional account. It does **not** provide a feed of Stories from every account the user follows. Instagram does not expose a general API for reading arbitrary followers' or followed users' Stories. This project does not scrape Instagram, request Instagram passwords, or bypass access controls.

Official reference: https://developers.facebook.com/docs/graph-api/reference/ig-user/stories/

## Features

- Meta OAuth login; no Instagram password is collected by this site.
- Finds Instagram professional accounts linked to Facebook Pages authorized by the user.
- Server-side token storage in Cloudflare KV; tokens are never sent to the browser.
- Account selector, Stories refresh, full-screen viewer, progress bars, autoplay, pause/resume, previous/next, keyboard controls and touch navigation.
- Image/video playback and responsive iPhone layout.
- Disconnect / clear local session.

## Deploy to Cloudflare Workers

1. Create a Cloudflare KV namespace named for example `IGSV_SESSIONS`.
2. Replace the placeholder KV namespace `id` in `wrangler.toml` with its ID.
3. Create a Meta app at https://developers.facebook.com/apps/ and add Facebook Login.
4. Add the exact OAuth redirect URI: `https://YOUR-WORKER.workers.dev/auth/callback`.
5. Add these Worker secrets:
   - `META_APP_ID`
   - `META_APP_SECRET`
6. Set `APP_ORIGIN` and `META_REDIRECT_URI` in `wrangler.toml` to your deployed Worker URL.
7. Deploy with `npx wrangler deploy`.

Required Meta permissions used here: `instagram_basic`, `pages_show_list`, `pages_read_engagement`. App review / business verification may be required for accounts outside app roles and for production use. Meta may change requirements; verify in App Dashboard.

## Local development

Install Wrangler, configure secrets and KV, then run `npx wrangler dev`. The OAuth callback must use the exact public redirect URI configured in Meta, so local OAuth requires a public HTTPS tunnel or a separate development redirect URI.

## Security notes

- Keep `META_APP_SECRET` in Worker secrets, never in frontend files.
- KV stores access tokens server-side. Restrict access to your Cloudflare account.
- This starter stores a single browser session for up to 30 days. Add account deletion and privacy disclosures before public launch.
- Token expiration/revocation can occur; reconnect if Meta returns an OAuth error.
