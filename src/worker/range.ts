// Byte-range answers for the videos under /trailers/. Safari and iOS fetch a progressive mp4 with
// Range requests and will not play it unless the server answers 206; the Workers static assets
// binding ignores Range and always sends the whole file with 200 (the asset worker in wrangler
// 4.135 has no Range handling, and production answered `Range: bytes=0-99` with the full body).
// wrangler.jsonc routes /trailers/* to the Worker first (run_worker_first), and index.ts sends
// those paths here. The asset is fetched once with the Range header removed, then sliced.
//
// Every header the assets binding set (the public/_headers rules, ETag, Content-Type,
// Cache-Control) is copied onto the answer except Content-Length and Content-Range, which are
// recomputed. Anything the binding answers with other than 200 (304, 404) is returned as is.

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

export async function handleRange(request: Request, env: AssetsEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);

  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete('Range');
  assetHeaders.delete('If-Range');
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers: assetHeaders }));
  if (asset.status !== 200) return asset;

  const range = request.headers.get('Range');
  // If-Range: send the range only when the validator still matches the asset's ETag.
  const ifRange = request.headers.get('If-Range');
  const rangeApplies = range !== null && request.method === 'GET' && (ifRange === null || ifRange === asset.headers.get('ETag'));
  if (!rangeApplies || range.includes(',')) {
    return new Response(asset.body, { status: 200, statusText: asset.statusText, headers: copyHeaders(asset.headers) });
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
