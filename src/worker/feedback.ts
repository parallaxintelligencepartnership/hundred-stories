// The feedback route's logic: CORS, rate limits, the capped body read, validation and the KV
// write. Kept apart from index.ts because the Workers runtime treats every named export of the
// entry module as an entrypoint and refuses to start on a plain value (a string, a Set); the
// entry exports only its default handler.
//
// Privacy: a stored message holds the player's text, the optional reply address, the game
// version, platform and screen, and the time. Never the IP, country or user agent; the IP is used
// only as the rate limit key and is not written anywhere.

export interface Env {
  ASSETS: Fetcher;
  FEEDBACK: KVNamespace;
  // Optional at runtime: if a binding is missing the endpoint fails open rather than 500.
  // FEEDBACK_LIMIT is per client IP; FEEDBACK_GLOBAL is one shared bucket for every sender that
  // bounds the KV write rate however many IPs post. The per-IP limit sits below the shared one,
  // so one address alone can never hold the shared bucket (numbers and the daily cap in
  // wrangler.jsonc).
  FEEDBACK_LIMIT?: RateLimit;
  FEEDBACK_GLOBAL?: RateLimit;
}

export const FEEDBACK_PATH = '/api/feedback';
export const MAX_BODY_BYTES = 8 * 1024;
/** The key every request shares on the FEEDBACK_GLOBAL limiter. */
export const GLOBAL_LIMIT_KEY = 'global';
/**
 * The answer when the KV write fails, most likely because the day's write cap is spent. 507
 * (Insufficient Storage) and nothing else, so the card can tell it apart from a 503 or 500 that
 * Cloudflare or the runtime might send. src/ui/feedback.ts keeps the same number.
 */
export const STORE_FAILED_STATUS = 507;

/**
 * Origins allowed to post from another origin. The app shells serve the game from their own
 * bundle, so their fetch to the site is cross-origin: Capacitor on iOS (capacitor://localhost)
 * and on Android (https://localhost, capacitor.config.ts androidScheme 'https'), Tauri 2 on
 * macOS and Linux (tauri://localhost) and on Windows (http://tauri.localhost; the config leaves
 * useHttpsScheme off). The site's two hostnames are listed for a page on one posting to the other.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://hundredstories.xyz',
  'https://www.hundredstories.xyz',
  'capacitor://localhost',
  'https://localhost',
  'tauri://localhost',
  'http://tauri.localhost',
]);

export const LIMITS = { text: 2000, replyTo: 200, version: 20, platform: 40, screen: 40 } as const;

export interface FeedbackFields {
  text: string;
  replyTo: string | null;
  version: string | null;
  platform: string | null;
  screen: string | null;
}

export interface StoredFeedback extends FeedbackFields {
  at: string;
}

export type ParseResult = { kind: 'ok'; fields: FeedbackFields } | { kind: 'bot' } | { kind: 'bad' };

// Reads one optional string field: absent, null or blank is null; a non-string or an over-long
// value makes the whole request bad (undefined).
function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed === '' ? null : trimmed;
}

// Validates a parsed JSON body against the feedback contract. Pure: no I/O, no clock.
export function parseFeedback(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'bad' };
  const b = body as Record<string, unknown>;

  // Honeypot: the card's hidden "website" field. Any non-empty value is a bot.
  const website = b['website'];
  if (website !== undefined && website !== null && website !== '') return { kind: 'bot' };

  const rawText = b['text'];
  if (typeof rawText !== 'string') return { kind: 'bad' };
  const text = rawText.trim();
  if (text.length < 1 || text.length > LIMITS.text) return { kind: 'bad' };

  const replyTo = optionalString(b['replyTo'], LIMITS.replyTo);
  const version = optionalString(b['version'], LIMITS.version);
  const platform = optionalString(b['platform'], LIMITS.platform);
  const screen = optionalString(b['screen'], LIMITS.screen);
  if (replyTo === undefined || version === undefined || platform === undefined || screen === undefined) {
    return { kind: 'bad' };
  }
  if (replyTo !== null && !replyTo.includes('@')) return { kind: 'bad' };

  return { kind: 'ok', fields: { text, replyTo, version, platform, screen } };
}

// The exact value written to KV. Built field by field so nothing else can ride along.
export function buildRecord(fields: FeedbackFields, now: Date): StoredFeedback {
  return {
    text: fields.text,
    replyTo: fields.replyTo,
    version: fields.version,
    platform: fields.platform,
    screen: fields.screen,
    at: now.toISOString(),
  };
}

export function feedbackKey(nowMs: number, id: string): string {
  return `fb:${nowMs}:${id}`;
}

export async function storeFeedback(
  kv: Pick<KVNamespace, 'put'>,
  fields: FeedbackFields,
  now: Date,
  id: string,
): Promise<void> {
  await kv.put(feedbackKey(now.getTime(), id), JSON.stringify(buildRecord(fields, now)));
}

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  // _headers rules apply to static assets only, so the Worker sets its own no-store and nosniff.
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

// True when the request may proceed. Fails open (with a warning) if the binding is missing or
// the limiter itself errors: feedback is low stakes and a 500 would lose a real message.
async function underLimit(limiter: RateLimit | undefined, name: string, key: string): Promise<boolean> {
  if (!limiter) {
    console.warn(`feedback: ${name} binding missing, not rate limiting`);
    return true;
  }
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.warn(`feedback: ${name} rate limiter failed, not rate limiting`, err);
    return true;
  }
}

// Per IP first, so one sender who is over their own limit never spends the shared bucket. Only a
// request that would be stored reaches this: junk is refused before either limiter counts it.
async function allowed(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!(await underLimit(env.FEEDBACK_LIMIT, 'FEEDBACK_LIMIT', ip))) return false;
  return underLimit(env.FEEDBACK_GLOBAL, 'FEEDBACK_GLOBAL', GLOBAL_LIMIT_KEY);
}

/**
 * Reads the body, stopping as soon as it passes MAX_BODY_BYTES: a chunked upload with no
 * Content-Length is never buffered past the limit. Null means too large.
 */
export async function readCapped(request: Request, max = MAX_BODY_BYTES): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  // No Origin: a same-origin fetch or curl, handled as before. A listed Origin: the app shells
  // (or the other site hostname), answered with CORS headers. Anything else: no CORS headers,
  // so the browser blocks it, and a POST is refused outright.
  const origin = request.headers.get('origin');
  const cors: Record<string, string> = {};
  if (origin !== null) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      if (request.method === 'POST') return json(403, { ok: false, reason: 'forbidden' });
    } else {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Vary'] = 'Origin';
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }
    }
  }
  const reply = (status: number, body: Record<string, unknown>) => json(status, body, cors);
  const BAD = () => reply(400, { ok: false, reason: 'bad request' });
  const tooLarge = () => reply(413, { ok: false, reason: 'too large' });

  if (request.method !== 'POST') {
    return json(405, { ok: false, reason: 'method not allowed' }, { ...cors, Allow: 'POST' });
  }
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (mediaType !== 'application/json') return BAD();

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  const raw = await readCapped(request);
  if (raw === null) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return BAD();
  }

  const parsed = parseFeedback(body);
  if (parsed.kind === 'bot') return reply(200, { ok: true });
  if (parsed.kind === 'bad') return BAD();
  if (!(await allowed(request, env))) return reply(429, { ok: false, reason: 'slow down' });

  try {
    await storeFeedback(env.FEEDBACK, parsed.fields, new Date(), crypto.randomUUID());
  } catch (err) {
    // The expected cause is the KV daily write cap (wrangler.jsonc explains why the limiters
    // cannot hold it). The card maps this status to "full for today", not "try in a minute".
    console.error('feedback: KV write failed', err);
    return reply(STORE_FAILED_STATUS, { ok: false, reason: 'full for today' });
  }
  return reply(200, { ok: true });
}
