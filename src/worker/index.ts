// The site's Worker. Static assets are served by Cloudflare before this code runs, except
// /trailers/* (wrangler.jsonc run_worker_first), so the Worker sees only requests no file in dist/
// matches plus the videos. It answers POST /api/feedback, the in-game feedback card, answers
// Range requests for /trailers/ (range.ts; Safari and iOS need 206 to play mp4), and hands every
// other path back to the assets binding, which serves the 404 page exactly as before.
//
// Privacy: a stored message holds the player's text, the optional reply address, the game
// version, platform and screen, and the time. Never the IP, country or user agent; the IP is used
// only as the rate limit key and is not written anywhere.

// Only the default export lives here (see feedback.ts for why).
import { FEEDBACK_PATH, handleFeedback, type Env } from './feedback';
import { TRAILERS_PREFIX, handleRange } from './range';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === FEEDBACK_PATH) return handleFeedback(request, env);
    if (url.pathname.startsWith(TRAILERS_PREFIX)) return handleRange(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
