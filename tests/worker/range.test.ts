import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/worker/feedback';
import * as entry from '../../src/worker/index';
import { parseRange } from '../../src/worker/range';

const worker = entry.default;
const URL_BASE = 'https://hundredstories.xyz';
const SIZE = 1000;
const BYTES = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);

// A stand-in for the Workers static assets binding as wrangler 4.135 runs it: it ignores Range and
// always answers the whole file with 200, with the _headers rules already applied.
function makeEnv(opts: { status?: number } = {}) {
  const assetsFetch = vi.fn(async (req: Request) => {
    const status = opts.status ?? 200;
    const headers = new Headers({
      'Content-Type': 'video/mp4',
      ETag: '"abc"',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'",
      'Content-Length': String(SIZE),
    });
    if (status !== 200) return new Response(status === 304 ? null : 'not found', { status });
    return new Response(req.method === 'HEAD' ? null : BYTES.slice(), { status, headers });
  });
  const env = { ASSETS: { fetch: assetsFetch }, FEEDBACK: {} } as unknown as Env;
  return { env, assetsFetch };
}

function get(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`${URL_BASE}${path}`, { method, headers });
}

const VIDEO = '/trailers/the-wait.mp4';

async function bytes(res: Response): Promise<number[]> {
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}

describe('GET /trailers/* byte ranges', () => {
  it('no Range: 200 with the whole body, Accept-Ranges and the asset headers', async () => {
    const { env, assetsFetch } = makeEnv();
    const res = await worker.fetch(get(VIDEO), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(await bytes(res)).toEqual(Array.from(BYTES));
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=900-', 900, 999],
    ['bytes=-100', 900, 999],
    ['bytes=990-5000', 990, 999],
    ['bytes=-5000', 0, 999],
  ])('%s: 206 with the exact Content-Range and bytes', async (range, start, end) => {
    const { env, assetsFetch } = makeEnv();
    const res = await worker.fetch(get(VIDEO, { Range: range }), env);
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${SIZE}`);
    expect(res.headers.get('content-length')).toBe(String(end - start + 1));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await bytes(res)).toEqual(Array.from(BYTES.slice(start, end + 1)));
    // The binding is asked for the whole file, without the Range header.
    expect(assetsFetch.mock.calls[0]![0].headers.get('range')).toBeNull();
  });

  it.each(['bytes=1000-', 'bytes=5000-6000', 'bytes=-0'])('%s: 416 with bytes */length', async (range) => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO, { Range: range }), env);
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
    expect(res.headers.get('content-type')).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('several ranges fall back to the whole body with 200', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO, { Range: 'bytes=0-9,20-29' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toBeNull();
    expect(await bytes(res)).toEqual(Array.from(BYTES));
  });

  it('a malformed Range is ignored: 200 with the whole body', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO, { Range: 'bytes=50-10' }), env);
    expect(res.status).toBe(200);
    expect((await bytes(res)).length).toBe(SIZE);
  });

  it('If-Range that no longer matches the ETag gets the whole body', async () => {
    const { env } = makeEnv();
    const stale = await worker.fetch(get(VIDEO, { Range: 'bytes=0-9', 'If-Range': '"old"' }), env);
    expect(stale.status).toBe(200);
    const fresh = await worker.fetch(get(VIDEO, { Range: 'bytes=0-9', 'If-Range': '"abc"' }), env);
    expect(fresh.status).toBe(206);
  });

  it('HEAD: headers only, with Accept-Ranges', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO, { Range: 'bytes=0-99' }, 'HEAD'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.body).toBeNull();
  });

  it.each([
    ['with Range', { Range: 'bytes=0-99' }],
    ['without Range', {}],
  ])('HEAD %s keeps the whole file size in Content-Length', async (_name, headers) => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO, headers, 'HEAD'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
  });

  it('HEAD asks the binding for GET and sets Content-Length from its body (the binding sends no Content-Length header)', async () => {
    // Under wrangler dev 4.135 the assets binding's answer has no Content-Length header on GET or
    // HEAD; a GET only gets one on the wire because the runtime measures the body.
    const assetsFetch = vi.fn(async (req: Request) => {
      const headers = new Headers({ 'Content-Type': 'video/mp4', ETag: '"abc"' });
      return new Response(req.method === 'HEAD' ? null : BYTES.slice(), { status: 200, headers });
    });
    const env = { ASSETS: { fetch: assetsFetch }, FEEDBACK: {} } as unknown as Env;
    const res = await worker.fetch(get(VIDEO, { Range: 'bytes=0-99' }, 'HEAD'), env);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('content-range')).toBeNull();
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(assetsFetch.mock.calls[0]![0].method).toBe('GET');
  });

  it('GET without Range keeps the whole file size in Content-Length', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(get(VIDEO), env);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(await bytes(res)).toHaveLength(SIZE);
  });

  it.each([404, 304])('a %i from the assets binding is passed through untouched', async (status) => {
    const { env } = makeEnv({ status });
    const res = await worker.fetch(get('/trailers/missing.mp4', { Range: 'bytes=0-99' }), env);
    expect(res.status).toBe(status);
    expect(res.headers.get('accept-ranges')).toBeNull();
    expect(res.headers.get('content-range')).toBeNull();
  });

  it('HEAD on a 404 from the binding answers 404 with no body and cancels the GET body it was sent', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const env = { ASSETS: { fetch: vi.fn(async () => new Response(body, { status: 404 })) }, FEEDBACK: {} } as unknown as Env;
    const res = await worker.fetch(get('/trailers/missing.mp4', {}, 'HEAD'), env);
    expect(res.status).toBe(404);
    expect(res.body).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('paths outside /trailers/ go straight to the binding with their Range header', async () => {
    const { env, assetsFetch } = makeEnv();
    const req = get('/og.png', { Range: 'bytes=0-9' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(assetsFetch).toHaveBeenCalledWith(req);
    expect(res.headers.get('accept-ranges')).toBeNull();
  });
});

describe('parseRange', () => {
  it('reads the three single-range forms and rejects the rest', () => {
    expect(parseRange(null, 10)).toBe('none');
    expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-', 10)).toBe('none');
    expect(parseRange('items=0-1', 10)).toBe('none');
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-1', 0)).toBe('unsatisfiable');
  });
});
