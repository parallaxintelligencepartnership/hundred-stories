// The self-hosted nginx config and Cloudflare's public/_headers must send the same
// Content-Security-Policy, word for word. Only a comment kept them in step before, which is how
// they drifted once (audit 2026-09-28 lane H S3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const repo = join(__dirname, '../..');
const read = (path: string): string => readFileSync(join(repo, path), 'utf8');

/** Every CSP _headers sends, one per rule that sets it. */
function headersPolicies(text: string): string[] {
  return [...text.matchAll(/^\s+Content-Security-Policy:\s*(.+?)\s*$/gm)].map((m) => m[1] as string);
}

/** Every CSP nginx.conf adds, unquoted. */
function nginxPolicies(text: string): string[] {
  return [...text.matchAll(/^\s*add_header\s+Content-Security-Policy\s+"([^"]+)"/gm)].map((m) => (m[1] as string).trim());
}

it('deploy/nginx.conf sends exactly the Content-Security-Policy that public/_headers sends', () => {
  const cf = headersPolicies(read('public/_headers'));
  const nginx = nginxPolicies(read('deploy/nginx.conf'));
  expect(cf.length).toBeGreaterThan(0);
  expect(nginx.length).toBeGreaterThan(0);
  expect(new Set(cf).size).toBe(1);
  expect(new Set(nginx).size).toBe(1);
  expect(nginx[0]).toBe(cf[0]);
});

it('the parity check notices a one-word drift', () => {
  const cf = headersPolicies(read('public/_headers'))[0] as string;
  const drifted = read('deploy/nginx.conf').replace("font-src 'self'", "font-src 'self' https:");
  expect(nginxPolicies(drifted)[0]).not.toBe(cf);
});
