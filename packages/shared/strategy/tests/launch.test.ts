import type { Keyword, Org } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { orgFindById, keywordListByOrg, runRepoCreate, sfnSend, runLocalStrategyMock } = vi.hoisted(
  () => ({
    orgFindById: vi.fn(),
    keywordListByOrg: vi.fn(async (): Promise<Keyword[]> => []),
    runRepoCreate: vi.fn(),
    sfnSend: vi.fn(async () => ({})),
    runLocalStrategyMock: vi.fn(async () => {}),
  }),
);

vi.mock('@shared/db', () => ({
  OrgRepo: { findById: orgFindById },
  KeywordRepo: { listByOrg: keywordListByOrg },
  StrategyRunRepo: { create: runRepoCreate },
}));

vi.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: vi.fn(function SFNClient(this: { send: typeof sfnSend }) {
    this.send = sfnSend;
  }),
  StartExecutionCommand: vi.fn(function StartExecutionCommand(
    this: { input: unknown },
    input: unknown,
  ) {
    this.input = input;
  }),
}));

vi.mock('../src/run', () => ({
  runLocalStrategy: runLocalStrategyMock,
}));

import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { StrategyFatalError } from '../src/errors';
import { createStrategyRun, launchStrategy } from '../src/launch';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'x' },
  audience: { target: ['devs'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: 'howto',
      internal_links_count: 1,
      table_of_contents: true,
      readability_grade_max: 8,
      llm_instructions: '',
    },
    engagement: {
      image_direction: { medium: 'photograph', palette: '', notes: '' },
      include_cta: true,
      youtube_videos: true,
    },
    publishing: { auto_publish: false },
  },
};

const org: Org = {
  id: 'org1',
  user_id: 'u1',
  website_url: 'https://acme.com',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'none',
  presets,
  created_at: new Date(),
} as Org;

describe('createStrategyRun', () => {
  beforeEach(() => vi.clearAllMocks());

  test('throws StrategyFatalError when the org is missing', async () => {
    orgFindById.mockResolvedValue(null);

    await expect(createStrategyRun('org1')).rejects.toBeInstanceOf(StrategyFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('throws StrategyFatalError when the org has no presets', async () => {
    orgFindById.mockResolvedValue({ ...org, presets: undefined });

    await expect(createStrategyRun('org1')).rejects.toBeInstanceOf(StrategyFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('snapshots the org + scheduled keywords into a fresh running run', async () => {
    orgFindById.mockResolvedValue(org);
    keywordListByOrg.mockResolvedValue([{ keyword: 'existing kw' } as Keyword]);
    runRepoCreate.mockResolvedValue({ id: 'run1' });

    await createStrategyRun('org1');

    expect(runRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org1',
        status: 'running',
        input: expect.objectContaining({
          website_url: org.website_url,
          presets,
          existing_keywords: ['existing kw'],
        }),
      }),
    );
  });
});

describe('launchStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgFindById.mockResolvedValue(org);
    keywordListByOrg.mockResolvedValue([]);
    runRepoCreate.mockResolvedValue({ id: 'run1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('with STRATEGY_STATE_MACHINE_ARN set, starts a Step Functions execution', async () => {
    vi.stubEnv('STRATEGY_STATE_MACHINE_ARN', 'arn:aws:states:us-east-1:123:stateMachine:strategy');

    const result = await launchStrategy('org1');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(StartExecutionCommand).toHaveBeenCalledWith({
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:strategy',
      name: 'strategy-run1',
      input: JSON.stringify({ run_id: 'run1', org_id: 'org1' }),
    });
    expect(runLocalStrategyMock).not.toHaveBeenCalled();
  });

  test('without STRATEGY_STATE_MACHINE_ARN, falls back to runLocalStrategy fire-and-forget', async () => {
    vi.stubEnv('STRATEGY_STATE_MACHINE_ARN', '');
    delete process.env.STRATEGY_STATE_MACHINE_ARN;

    const result = await launchStrategy('org1');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).not.toHaveBeenCalled();
    expect(runLocalStrategyMock).toHaveBeenCalledWith('run1');
  });

  // Final-review finding 3: short-lived callers (the CLI) exit their process
  // right after launchStrategy resolves, which would race a fire-and-forget
  // local run. `wait: true` awaits it instead.
  test('wait: true without an ARN awaits the local run before resolving', async () => {
    vi.stubEnv('STRATEGY_STATE_MACHINE_ARN', '');
    delete process.env.STRATEGY_STATE_MACHINE_ARN;
    const order: string[] = [];
    runLocalStrategyMock.mockImplementationOnce(async () => {
      order.push('runLocalStrategy resolved');
    });

    const result = await launchStrategy('org1', { wait: true });
    order.push('launchStrategy resolved');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).not.toHaveBeenCalled();
    expect(runLocalStrategyMock).toHaveBeenCalledWith('run1');
    expect(order).toEqual(['runLocalStrategy resolved', 'launchStrategy resolved']);
  });

  test('wait: true with an ARN still starts a Step Functions execution, not a local run', async () => {
    vi.stubEnv('STRATEGY_STATE_MACHINE_ARN', 'arn:aws:states:us-east-1:123:stateMachine:strategy');

    const result = await launchStrategy('org1', { wait: true });

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(runLocalStrategyMock).not.toHaveBeenCalled();
  });
});
