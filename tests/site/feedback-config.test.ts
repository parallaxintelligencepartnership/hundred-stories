// The two config files the feedback route depends on outside the Worker: the desktop shell's
// CSP must let it reach the site, and the n8n mailer must only delete a message once its email
// went out. Read here, under the main tsconfig, because the Worker's tsconfig has no node types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the desktop shell may reach the endpoint', () => {
  it('the Tauri CSP connect-src adds only https://hundredstories.xyz', () => {
    const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
      app: { security: { csp: string } };
    };
    expect(conf.app.security.csp).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; " +
        "worker-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://hundredstories.xyz; base-uri 'self'; form-action 'self'",
    );
  });
});

describe('the n8n mailer workflow', () => {
  type Node = { name: string; type: string; onError?: string; parameters: Record<string, unknown> };
  type Wf = { nodes: Node[]; connections: Record<string, { main: { node: string }[][] }> };
  const wf = JSON.parse(readFileSync(new URL('../../deploy/n8n-feedback-mailer.json', import.meta.url), 'utf8')) as Wf;
  const node = (name: string): Node => wf.nodes.find((n) => n.name === name)!;
  const next = (name: string, branch = 0): string[] => (wf.connections[name]?.main[branch] ?? []).map((c) => c.node);

  it('deletes a key only after its email went out: Email Matt continues on error into an Email sent check', () => {
    expect(node('Email Matt').onError).toBe('continueRegularOutput');
    expect(next('Email Matt')).toEqual(['Email sent']);
    expect(node('Email sent').type).toBe('n8n-nodes-base.if');
    const cond = JSON.stringify(node('Email sent').parameters);
    expect(cond).toContain('$json.error');
    expect(cond).toContain('"notExists"');
    expect(next('Email sent', 0)).toEqual(['Delete the key']);
    expect(next('Email sent', 1)).toEqual([]);
  });

  it("replies go to the player's address when they gave one, and it still runs hourly", () => {
    expect((node('Email Matt').parameters['options'] as Record<string, string>)['replyTo']).toBe("={{ $json.replyTo || '' }}");
    expect(node('Every hour').parameters['rule']).toEqual({ interval: [{ field: 'hours', hoursInterval: 1 }] });
  });
});
