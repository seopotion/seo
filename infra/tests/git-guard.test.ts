import { describe, expect, it } from 'vitest';
import { checkHeadOnMaster, type GitRunner } from '../lib/git-guard';

/** Fake `git` keyed on the argv string; anything unlisted fails like a missing ref. */
function fakeGit(responses: Record<string, { status: number; stdout?: string }>): GitRunner {
  return (args) => {
    const r = responses[args.join(' ')];
    return r ? { status: r.status, stdout: r.stdout ?? '' } : { status: 128, stdout: '' };
  };
}

const onMasterClean = {
  'rev-parse HEAD': { status: 0, stdout: 'abc1234def\n' },
  'rev-parse --abbrev-ref HEAD': { status: 0, stdout: 'master\n' },
  'rev-parse --verify -q origin/master': { status: 0, stdout: 'abc1234def\n' },
  'merge-base --is-ancestor HEAD origin/master': { status: 0 },
  'status --porcelain': { status: 0, stdout: '' },
};

describe('checkHeadOnMaster', () => {
  it('passes when HEAD is on origin/master with a clean tree', () => {
    expect(checkHeadOnMaster(fakeGit(onMasterClean))).toEqual({ ok: true });
  });

  it('refuses outside a git checkout', () => {
    const res = checkHeadOnMaster(fakeGit({}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/git checkout/);
  });

  it('refuses when origin/master is not fetched', () => {
    const res = checkHeadOnMaster(
      fakeGit({ ...onMasterClean, 'rev-parse --verify -q origin/master': { status: 1 } }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/git fetch origin master/);
  });

  it('refuses a feature branch, naming the branch and commit', () => {
    const res = checkHeadOnMaster(
      fakeGit({
        ...onMasterClean,
        'rev-parse --abbrev-ref HEAD': { status: 0, stdout: 'alper/manual-images\n' },
        'merge-base --is-ancestor HEAD origin/master': { status: 1 },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('alper/manual-images');
      expect(res.reason).toContain('abc1234def');
      expect(res.reason).toContain('origin/master');
    }
  });

  it('refuses unpushed master commits (HEAD ahead of origin/master)', () => {
    const res = checkHeadOnMaster(
      fakeGit({ ...onMasterClean, 'merge-base --is-ancestor HEAD origin/master': { status: 1 } }),
    );
    expect(res.ok).toBe(false);
  });

  it('refuses a dirty working tree even on master', () => {
    const res = checkHeadOnMaster(
      fakeGit({
        ...onMasterClean,
        'status --porcelain': { status: 0, stdout: ' M lib/api-stack.ts\n' },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/uncommitted/);
  });
});
