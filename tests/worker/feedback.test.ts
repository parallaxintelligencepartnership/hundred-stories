import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_ORIGINS, buildRecord, feedbackKey, parseFeedback, type Env } from '../../src/worker/feedback';
import * as entry from '../../src/worker/index';

const worker = entry.default;

const URL_BASE = 'https://hundredstories.xyz';

function makeEnv(
  opts: { limitOk?: boolean; noLimiter?: boolean; globalOk?: boolean; noGlobal?: boolean; putThrows?: boolean } = {},
) {
  const put = vi.fn(async (_key: string, _value: string) => {
    if (opts.putThrows) throw new Error('kv down');
  });
  const limit = vi.fn(async (_o: { key: string }) => ({ success: opts.limitOk ?? true }));
  const globalLimit = vi.fn(async (_o: { key: string }) => ({ success: opts.globalOk ?? true }));
  const assetsFetch = vi.fn(async (_r: Request) => new Response('asset', { status: 200 }));
  const env = {
    ASSETS: { fetch: assetsFetch },
    FEEDBACK: { put },
    ...(opts.noLimiter ? {} : { FEEDBACK_LIMIT: { limit } }),
    ...(opts.noGlobal ? {} : { FEEDBACK_GLOBAL: { limit: globalLimit } }),
  } as unknown as Env;
  return { env, put, limit, globalLimit, assetsFetch };
}

function post(body: unknown, init: { contentType?: string; raw?: string; ip?: string; origin?: string } = {}): Request {
  return new Request(`${URL_BASE}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': init.contentType ?? 'application/json',
      'cf-connecting-ip': init.ip ?? '203.0.113.7',
      ...(init.origin ? { Origin: init.origin } : {}),
    },
    body: init.raw ?? JSON.stringify(body),
  });
}

async function call(req: Request, env: Env) {
  const res = await worker.fetch(req, env);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => vi.restoreAllMocks());

describe('the entry module', () => {
  // workerd reads every named export of the main module as an entrypoint and will not start on a
  // plain value: FEEDBACK_PATH exported from index.ts stopped wrangler dev and would stop a deploy.
  it('exports only its default handler', () => {
    expect(Object.keys(entry)).toEqual(['default']);
  });
});

describe('POST /api/feedback', () => {
  it('stores a valid message and answers 200 ok', async () => {
    const { env, put } = makeEnv();
    const { res, body } = await call(post({ text: '  Love it  ', replyTo: 'a@b.c', version: '0.6.1', platform: 'web', screen: 'tower' }), env);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(put).toHaveBeenCalledTimes(1);
    const [key, value] = put.mock.calls[0]!;
    expect(key).toMatch(/^fb:\d+:[0-9a-f-]{36}$/);
    const stored = JSON.parse(value) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['at', 'platform', 'replyTo', 'screen', 'text', 'version']);
    expect(stored).toMatchObject({ text: 'Love it', replyTo: 'a@b.c', version: '0.6.1', platform: 'web', screen: 'tower' });
    expect(new Date(stored['at'] as string).toISOString()).toBe(stored['at']);
  });

  it('stores only the allowed fields: no IP, extra body fields or headers', async () => {
    const { env, put } = makeEnv();
    await call(post({ text: 'hi', ip: '1.2.3.4', country: 'NZ', userAgent: 'x', extra: 1 }, { ip: '198.51.100.9' }), env);
    const value = put.mock.calls[0]![1];
    expect(Object.keys(JSON.parse(value)).sort()).toEqual(['at', 'platform', 'replyTo', 'screen', 'text', 'version']);
    expect(value).not.toContain('198.51.100.9');
    expect(value).not.toContain('1.2.3.4');
    expect(JSON.parse(value)).toMatchObject({ replyTo: null, version: null, platform: null, screen: null });
  });

  it('honeypot: a filled website field answers 200 and stores nothing', async () => {
    const { env, put } = makeEnv();
    const { res, body } = await call(post({ text: 'buy now', website: 'http://spam' }), env);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(put).not.toHaveBeenCalled();
  });

  it('an empty website field is not the honeypot', async () => {
    const { env, put } = makeEnv();
    await call(post({ text: 'real', website: '' }), env);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wrong content type', post({ text: 'hi' }, { contentType: 'text/plain' })],
    ['unparsable JSON', post(null, { raw: '{"text": ' })],
    ['missing text', post({ version: '1' })],
    ['empty text after trim', post({ text: '   ' })],
    ['text not a string', post({ text: 5 })],
    ['body not an object', post(['hi'])],
  ])('400 bad request: %s', async (_name, req) => {
    const { env, put } = makeEnv();
    const { res, body } = await call(req, env);
    expect(res.status).toBe(400);
    expect(body).toEqual({ ok: false, reason: 'bad request' });
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts application/json with a charset', async () => {
    const { env, put } = makeEnv();
    const { res } = await call(post({ text: 'hi' }, { contentType: 'application/json; charset=utf-8' }), env);
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('413 on a chunked body with no Content-Length, without reading it all', async () => {
    const { env, put } = makeEnv();
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          if (pulled > 100) controller.close();
          else controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    const req = new Request(`${URL_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(req.headers.get('content-length')).toBeNull();
    const { res, body } = await call(req, env);
    expect(res.status).toBe(413);
    expect(body).toEqual({ ok: false, reason: 'too large' });
    // 8 KB is eight 1 KB chunks; the ninth crosses the limit. Never the whole 100 KB.
    expect(pulled).toBeLessThanOrEqual(10);
    expect(put).not.toHaveBeenCalled();
  });

  it('a chunked body under the limit is read and stored', async () => {
    const { env, put } = makeEnv();
    const bytes = new TextEncoder().encode(JSON.stringify({ text: 'chunked hello' }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    });
    const req = new Request(`${URL_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const { res } = await call(req, env);
    expect(res.status).toBe(200);
    expect(JSON.parse(put.mock.calls[0]![1])).toMatchObject({ text: 'chunked hello' });
  });

  it('413 too large when the raw body is over 8 KB', async () => {
    const { env, put } = makeEnv();
    const raw = JSON.stringify({ text: 'a', pad: 'x'.repeat(8192) });
    const { res, body } = await call(post(null, { raw }), env);
    expect(res.status).toBe(413);
    expect(body).toEqual({ ok: false, reason: 'too large' });
    expect(put).not.toHaveBeenCalled();
  });

  it('429 slow down when the limiter refuses, keyed on cf-connecting-ip', async () => {
    const { env, put, limit } = makeEnv({ limitOk: false });
    const { res, body } = await call(post({ text: 'hi' }, { ip: '192.0.2.1' }), env);
    expect(res.status).toBe(429);
    expect(body).toEqual({ ok: false, reason: 'slow down' });
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
    expect(put).not.toHaveBeenCalled();
  });

  it('429 when the global limiter refuses, keyed on the constant "global", after the per-IP check', async () => {
    const { env, put, limit, globalLimit } = makeEnv({ globalOk: false });
    const { res, body } = await call(post({ text: 'hi' }, { ip: '192.0.2.2' }), env);
    expect(res.status).toBe(429);
    expect(body).toEqual({ ok: false, reason: 'slow down' });
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.2' });
    expect(globalLimit).toHaveBeenCalledWith({ key: 'global' });
    expect(limit.mock.invocationCallOrder[0]!).toBeLessThan(globalLimit.mock.invocationCallOrder[0]!);
    expect(put).not.toHaveBeenCalled();
  });

  it('a sender over their own limit never spends the global bucket', async () => {
    const { env, globalLimit } = makeEnv({ limitOk: false });
    const { res } = await call(post({ text: 'hi' }), env);
    expect(res.status).toBe(429);
    expect(globalLimit).not.toHaveBeenCalled();
  });

  it('both limiters pass: stored, each called once', async () => {
    const { env, put, limit, globalLimit } = makeEnv();
    const { res } = await call(post({ text: 'hi' }), env);
    expect(res.status).toBe(200);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(globalLimit).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('fails open with a warning when the global limit binding is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, put } = makeEnv({ noGlobal: true });
    const { res } = await call(post({ text: 'hi' }), env);
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FEEDBACK_GLOBAL'));
  });

  it('fails open with a warning when the rate limit binding is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env, put } = makeEnv({ noLimiter: true });
    const { res } = await call(post({ text: 'hi' }), env);
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('503 unavailable when the KV write throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env } = makeEnv({ putThrows: true });
    const { res, body } = await call(post({ text: 'hi' }), env);
    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, reason: 'unavailable' });
  });

  it.each(['GET', 'PUT', 'DELETE'])('405 with Allow: POST for %s', async (method) => {
    const { env, put, assetsFetch } = makeEnv();
    const res = await worker.fetch(new Request(`${URL_BASE}/api/feedback`, { method }), env);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(put).not.toHaveBeenCalled();
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});

describe('CORS for the app shells', () => {
  const preflight = (origin?: string) =>
    new Request(`${URL_BASE}/api/feedback`, {
      method: 'OPTIONS',
      headers: {
        ...(origin ? { Origin: origin } : {}),
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

  it('allows exactly the shell origins and the two site hostnames', () => {
    expect([...ALLOWED_ORIGINS].sort()).toEqual([
      'capacitor://localhost',
      'http://tauri.localhost',
      'https://hundredstories.xyz',
      'https://localhost',
      'https://www.hundredstories.xyz',
      'tauri://localhost',
    ]);
  });

  it.each([...ALLOWED_ORIGINS])('preflight from %s: 204 with the CORS headers', async (origin) => {
    const { env, put, limit, assetsFetch } = makeEnv();
    const res = await worker.fetch(preflight(origin), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(await res.text()).toBe('');
    expect(put).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('POST from an allowed origin: stored, with Allow-Origin and Vary on the answer', async () => {
    const { env, put } = makeEnv();
    const { res, body } = await call(post({ text: 'from the phone' }, { origin: 'capacitor://localhost' }), env);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('every POST answer to an allowed origin carries the CORS headers, failures included', async () => {
    const origin = 'http://tauri.localhost';
    const bad = await call(post({ text: '' }, { origin }), makeEnv().env);
    expect(bad.res.status).toBe(400);
    const slow = await call(post({ text: 'hi' }, { origin }), makeEnv({ globalOk: false }).env);
    expect(slow.res.status).toBe(429);
    const big = await call(post(null, { origin, raw: JSON.stringify({ text: 'a', pad: 'x'.repeat(8192) }) }), makeEnv().env);
    expect(big.res.status).toBe(413);
    for (const { res } of [bad, slow, big]) {
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('vary')).toBe('Origin');
    }
  });

  it('POST from an unknown origin: 403 forbidden, no CORS headers, nothing stored or limited', async () => {
    const { env, put, limit, globalLimit } = makeEnv();
    const { res, body } = await call(post({ text: 'hi' }, { origin: 'https://evil.example' }), env);
    expect(res.status).toBe(403);
    expect(body).toEqual({ ok: false, reason: 'forbidden' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expect(globalLimit).not.toHaveBeenCalled();
  });

  it('preflight from an unknown origin gets no CORS headers', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(preflight('http://localhost:5173'), env);
    expect(res.status).not.toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('POST with no Origin (same origin, curl) is handled as before, with no CORS headers', async () => {
    const { env, put } = makeEnv();
    const { res, body } = await call(post({ text: 'same origin' }), env);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe('field limits', () => {
  const ok = (body: Record<string, unknown>) => parseFeedback(body).kind;

  it('text: 1 to 2000 characters after trim', () => {
    expect(ok({ text: 'a' })).toBe('ok');
    expect(ok({ text: 'a'.repeat(2000) })).toBe('ok');
    expect(ok({ text: `  ${'a'.repeat(2000)}  ` })).toBe('ok');
    expect(ok({ text: 'a'.repeat(2001) })).toBe('bad');
  });

  it('replyTo: at most 200 and must contain @ when non-empty', () => {
    expect(ok({ text: 'a', replyTo: '' })).toBe('ok');
    expect(ok({ text: 'a', replyTo: `${'a'.repeat(198)}@b` })).toBe('ok');
    expect(ok({ text: 'a', replyTo: `${'a'.repeat(199)}@b` })).toBe('bad');
    expect(ok({ text: 'a', replyTo: 'no-at-sign' })).toBe('bad');
  });

  it.each([
    ['version', 20],
    ['platform', 40],
    ['screen', 40],
  ])('%s: at most %i characters', (field, max) => {
    expect(ok({ text: 'a', [field]: 'v'.repeat(max) })).toBe('ok');
    expect(ok({ text: 'a', [field]: 'v'.repeat(max + 1) })).toBe('bad');
    expect(ok({ text: 'a', [field]: 7 })).toBe('bad');
  });

  it('an over-long field through the handler is a 400', async () => {
    const { env, put } = makeEnv();
    const { res } = await call(post({ text: 'a', version: 'v'.repeat(21) }), env);
    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('record and key', () => {
  it('buildRecord copies exactly the allowed fields', () => {
    const fields = { text: 't', replyTo: null, version: '1', platform: 'ios', screen: 'menu', ip: 'x' } as never;
    const rec = buildRecord(fields, new Date('2026-09-27T00:00:00.000Z'));
    expect(rec).toEqual({ text: 't', replyTo: null, version: '1', platform: 'ios', screen: 'menu', at: '2026-09-27T00:00:00.000Z' });
  });

  it('feedbackKey is fb:<ms>:<id>', () => {
    expect(feedbackKey(1234, 'abc')).toBe('fb:1234:abc');
  });
});

describe('other paths', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/nope'],
    ['GET', '/api/other'],
    ['POST', '/api/feedback/extra'],
  ])('%s %s goes to env.ASSETS.fetch untouched', async (method, path) => {
    const { env, assetsFetch, put, limit } = makeEnv();
    const req = new Request(`${URL_BASE}${path}`, { method });
    const res = await worker.fetch(req, env);
    expect(assetsFetch).toHaveBeenCalledWith(req);
    expect(await res.text()).toBe('asset');
    expect(put).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });
});
