import worker from "../worker.js";

export async function onRequest(context) {
  // Reuse the existing Worker API/OAuth implementation inside Cloudflare Pages.
  // When the request is not an API/auth route, fall through to the Pages static asset.
  const env = {
    ...context.env,
    ASSETS: {
      fetch: () => context.next()
    }
  };
  return worker.fetch(context.request, env);
}
