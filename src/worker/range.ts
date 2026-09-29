// Byte-range answers for the videos under /trailers/. Safari and iOS fetch a progressive mp4 with
// Range requests and will not play it unless the server answers 206; the Workers static assets
// binding ignores Range and always sends the whole file with 200 (the asset worker in wrangler
// 4.135 has no Range handling, and production answered `Range: bytes=0-99` with the full body).
// wrangler.jsonc routes /trailers/* to the Worker first (run_worker_first), and index.ts sends
// those paths here. The asset is fetched once with the Range header removed, then sliced.
//
// Every header the assets binding set (the public/_headers rules, ETag, Content-Type,
// Cache-Control) is copied onto the answer except Content-Length and Content-Range, which are
// recomputed. The binding's answer carries no Content-Length header, on GET or HEAD (seen under
// wrangler dev 4.135; live HEAD had none either): a GET gets one on the wire only because the
// runtime measures the body it sends. A HEAD has no body, so it is sent to the binding as a GET
// whose body is counted (streamed, not held) and dropped, and the count is set as Content-Length.
// Anything the binding answers with other than 200 (304, 404) is returned as is (HEAD: no body).

export interface AssetsEnv {
  ASSETS: Fetcher;
}

export const TRAILERS_PREFIX = '/trailers/';

export type ByteRange = { start: number; end: number };

/**
 * Reads a Range header against a body of `size` bytes. Returns the inclusive byte range, 'none'
 * when the header is absent, malformed or asks for several ranges (the caller then sends the
 * whole body, as RFC 9110 allows), or 'unsatisfiable' (416).
 */
export function parseRange(header: string | null, size: number): ByteRange | 'none' | 'unsatisfiable' {
  if (header === null) return 'none';
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return 'none';
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return 'none';
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  if (b !== '' && Number(b) < start) return 'none';
  if (start >= size) return 'unsatisfiable';
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  return { start, end };
}

function copyHeaders(from: Headers): Headers {
  const headers = new Headers(from);
  headers.delete('Content-Length');
  headers.delete('Content-Range');
  headers.set('Accept-Ranges', 'bytes');
  return headers;
}

/** Counts a response body's bytes without holding them. */
async function bodyLength(res: Response): Promise<number> {
  if (res.body === null) return 0;
  const reader = res.body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
  }
}

export async function handleRange(request: Request, env: AssetsEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);

  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete('Range');
  assetHeaders.delete('If-Range');
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: assetHeaders }));
  if (request.method === 'HEAD') {
    // Range is ignored on HEAD: the whole file's headers and its length, no body.
    if (asset.status !== 200) {
      await asset.body?.cancel();
      return new Response(null, { status: asset.status, statusText: asset.statusText, headers: asset.headers });
    }
    const headers = copyHeaders(asset.headers);
    headers.set('Content-Length', String(await bodyLength(asset)));
    return new Response(null, { status: 200, statusText: asset.statusText, headers });
  }
  if (asset.status !== 200) return asset;

  const range = request.headers.get('Range');
  // If-Range: send the range only when the validator still matches the asset's ETag.
  const ifRange = request.headers.get('If-Range');
  const rangeApplies = range !== null && (ifRange === null || ifRange === asset.headers.get('ETag'));
  if (!rangeApplies || range.includes(',')) {
    // The whole file as the binding sent it; the runtime sets Content-Length from the body.
    const headers = copyHeaders(asset.headers);
    const length = asset.headers.get('Content-Length');
    if (length !== null) headers.set('Content-Length', length);
    return new Response(asset.body, { status: 200, statusText: asset.statusText, headers });
  }

  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  const parsed = parseRange(range, size);
  const headers = copyHeaders(asset.headers);
  if (parsed === 'none') {
    headers.set('Content-Length', String(size));
    return new Response(body, { status: 200, headers });
  }
  if (parsed === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Type');
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = parsed;
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
