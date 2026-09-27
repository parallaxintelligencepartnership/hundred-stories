// The Worker that serves this site never gets Cloudflare's automatic Web Analytics injection, so
// the beacon tag is added by hand via the cfBeacon plugin. The app build must never carry it: the
// store listing promises no analytics in the app.
import { describe, expect, it } from 'vitest';

import { cfBeacon } from '../../vite.config';

const HTML = '<html><head><title>x</title></head><body></body></html>';

describe('cfBeacon', () => {
  it('inserts the exact beacon script before </head> when a token is set', async () => {
    const plugin = cfBeacon('abc');
    const transform = plugin.transformIndexHtml as (html: string) => string;
    const result = transform(HTML);
    const tag =
      '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token": "abc"}\'></script>';
    expect(result).toContain(tag);
    expect(result.indexOf(tag)).toBeLessThan(result.indexOf('</head>'));
  });

  it('leaves the HTML unchanged when there is no token', () => {
    const plugin = cfBeacon('');
    const transform = plugin.transformIndexHtml as (html: string) => string;
    expect(transform(HTML)).toBe(HTML);
  });

  it('is registered only for the site build, never the app build', async () => {
    const config = (await import('../../vite.config')).default;
    const siteConfig = typeof config === 'function' ? config({ mode: 'production', command: 'build' }) : config;
    const appConfig = typeof config === 'function' ? config({ mode: 'app', command: 'build' }) : config;
    const siteNames = (siteConfig.plugins ?? []).flat().map((p: any) => p?.name);
    const appNames = (appConfig.plugins ?? []).flat().map((p: any) => p?.name);
    expect(siteNames).toContain('cf-beacon');
    expect(appNames).not.toContain('cf-beacon');
  });
});
