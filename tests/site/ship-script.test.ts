// scripts/ship.sh end to end in a scratch git repo: a stand-in npm (its deploy passes or fails on
// DEPLOY_FAIL) and two bare repos standing in for origin and the GitHub mirror. A failed deploy
// must leave the release commit local, with no tag and nothing pushed, and must print the exact
// tag and push commands; a good deploy tags and pushes both remotes (audit 2026-09-28 lane H).
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '../..');
const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
// ship.sh edits in place with BSD sed (`sed -i ''`), so it runs on macOS only.
const runnable = hasGit && process.platform === 'darwin';

const NPM_STUB = `#!/bin/sh
if [ "$1" = install ]; then
  node -e "const f='package-lock.json',l=require('./'+f),v=require('./package.json').version;l.version=v;l.packages[''].version=v;require('fs').writeFileSync(f,JSON.stringify(l,null,2)+'\\n')"
  exit 0
fi
if [ "$1" = run ] && [ "$2" = deploy ]; then
  echo "Current Version ID: 12345678-aaaa-bbbb-cccc-1234567890ab"
  if [ "\${DEPLOY_FAIL:-0}" != 0 ]; then echo "fake failure"; exit "$DEPLOY_FAIL"; fi
  exit 0
fi
exit 0
`;

const FILES = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'ios/App/App.xcodeproj/project.pbxproj',
  'android/app/build.gradle',
];

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'hs-ship-'));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'ship test',
    GIT_AUTHOR_EMAIL: 'ship@example.invalid',
    GIT_COMMITTER_NAME: 'ship test',
    GIT_COMMITTER_EMAIL: 'ship@example.invalid',
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
  };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'npm'), NPM_STUB);
  chmodSync(join(root, 'bin', 'npm'), 0o755);
  const work = join(root, 'repo');
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(root, 'init', '-q', '--bare', 'github.git');
  for (const f of FILES) {
    mkdirSync(join(work, f, '..'), { recursive: true });
    copyFileSync(join(repo, f), join(work, f));
  }
  mkdirSync(join(work, 'scripts'));
  // The deploy log goes into the scratch folder, not /tmp.
  const log = join(root, 'deploy.log');
  writeFileSync(join(work, 'scripts', 'ship.sh'), readFileSync(join(repo, 'scripts', 'ship.sh'), 'utf8').replaceAll('/tmp/hundred-stories-deploy.log', log));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'remote', 'add', 'origin', '../origin.git');
  git(work, 'remote', 'add', 'github', '../github.git');
  const ship = (version: string, tag: string, deployFail: number) =>
    spawnSync('sh', ['scripts/ship.sh', version, tag], { cwd: work, env: { ...env, DEPLOY_FAIL: String(deployFail) }, encoding: 'utf8' });
  const refs = (bare: string) => spawnSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: join(root, bare), env, encoding: 'utf8' }).stdout.trim();
  return { root, work, git, ship, refs };
}

const next = (): string => {
  const [a, b, c] = (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version.split('.').map(Number) as [number, number, number];
  return `${a}.${b}.${c + 1}`;
};

describe.skipIf(!runnable)('scripts/ship.sh in a scratch repo', () => {
  it('a failed deploy exits 1, tags nothing, pushes nothing, and prints the tag and push commands', () => {
    const s = scratch();
    const run = s.ship(next(), 'ship-test-a', 3);
    expect(run.status).toBe(1);
    expect(s.git(s.work, 'tag', '--list')).toBe('');
    expect(s.refs('origin.git')).toBe('');
    expect(s.refs('github.git')).toBe('');
    expect(s.git(s.work, 'log', '-1', '--format=%s')).toBe(next());
    expect(run.stderr).toContain('deploy failed (exit 3)');
    expect(run.stderr).toContain('  git tag ship-test-a\n');
    expect(run.stderr).toContain('  git push origin main --tags\n');
    expect(run.stderr).toContain('  git push github main --tags\n');
  }, 60_000);

  it('a good deploy tags the release commit and pushes it and the tag to both remotes', () => {
    const s = scratch();
    const run = s.ship(next(), 'ship-test-b', 0);
    expect(run.status, run.stderr).toBe(0);
    expect(s.git(s.work, 'tag', '--list')).toBe('ship-test-b');
    const head = s.git(s.work, 'rev-parse', 'HEAD');
    for (const bare of ['origin.git', 'github.git']) {
      expect(s.refs(bare).split('\n').sort()).toEqual(['refs/heads/main', 'refs/tags/ship-test-b']);
      expect(s.git(join(s.root, bare), 'rev-parse', 'main')).toBe(head);
    }
    expect(run.stdout).toContain('Cloudflare version id: 12345678-aaaa-bbbb-cccc-1234567890ab');
  }, 60_000);
});

it.skipIf(runnable)('ship.sh test skipped: needs git and macOS (BSD sed)', () => {
  expect(runnable).toBe(false);
});
