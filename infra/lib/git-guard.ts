import { spawnSync } from 'node:child_process';

/**
 * `cdk deploy` ships whatever is checked out. On 2026-09-08 a local deploy from
 * a feature branch overwrote staging with code that predated the H1 fix and
 * silently rolled back every backend PR merged after it. CI is gated by the
 * workflows (push to `master` / Release-on-`master`); this guard closes the
 * human path: the app refuses to synthesize unless HEAD is a commit on
 * `origin/master` with a clean tree.
 */
export type GitRunner = (args: string[]) => { status: number | null; stdout: string };

export const runGit: GitRunner = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { status: r.status, stdout: r.stdout ?? '' };
};

export function checkHeadOnMaster(git: GitRunner): { ok: true } | { ok: false; reason: string } {
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0)
    return { ok: false, reason: 'not a git checkout (git rev-parse HEAD failed)' };
  const sha = head.stdout.trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'detached';

  if (git(['rev-parse', '--verify', '-q', 'origin/master']).status !== 0) {
    return { ok: false, reason: 'origin/master is not fetched — run `git fetch origin master`' };
  }
  if (git(['merge-base', '--is-ancestor', 'HEAD', 'origin/master']).status !== 0) {
    return {
      ok: false,
      reason: `HEAD ${sha} (${branch}) is not on origin/master (stale origin/master? \`git fetch origin master\`)`,
    };
  }
  if (git(['status', '--porcelain']).stdout.trim() !== '') {
    return { ok: false, reason: 'working tree has uncommitted changes' };
  }
  return { ok: true };
}

/**
 * Exit with a readable message instead of a ts-node stack trace. Skipped in
 * GitHub Actions (the workflows pin the ref, and a Release checkout has no
 * origin/master) and under `-c allow-off-master=1`, which is for local
 * `cdk synth` / `cdk diff` on a branch — never for a deploy.
 */
export function enforceHeadOnMaster(opts: { allowOffMaster: boolean; ci: boolean }): void {
  if (opts.ci) return;
  const res = checkHeadOnMaster(runGit);
  if (res.ok) return;
  if (opts.allowOffMaster) {
    console.warn(`allow-off-master set: ${res.reason}. Do NOT deploy from here.`);
    return;
  }
  console.error(
    `Refusing to synthesize: ${res.reason}.\n` +
      'Deploys ship whatever is checked out — deploy from `master` (`git checkout master && git pull`).\n' +
      'For a local synth/diff on a branch, pass `-c allow-off-master=1`.',
  );
  process.exit(2);
}
