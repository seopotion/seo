import type { Article, Keyword, Org } from '@shared/schemas';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  orgFindById,
  keywordFindById,
  keywordClaimGeneration,
  keywordFailGeneration,
  articleFindById,
  runRepoCreate,
  sfnSend,
  runLocalArticleRunMock,
} = vi.hoisted(() => ({
  orgFindById: vi.fn(),
  keywordFindById: vi.fn(),
  keywordClaimGeneration: vi.fn(),
  keywordFailGeneration: vi.fn(async () => {}),
  articleFindById: vi.fn(),
  runRepoCreate: vi.fn(),
  sfnSend: vi.fn(async () => ({})),
  runLocalArticleRunMock: vi.fn(async () => {}),
}));

vi.mock('@shared/db', () => ({
  OrgRepo: { findById: orgFindById },
  KeywordRepo: {
    findById: keywordFindById,
    claimGeneration: keywordClaimGeneration,
    failGeneration: keywordFailGeneration,
  },
  ArticleRepo: { findById: articleFindById },
  ArticleRunRepo: { create: runRepoCreate },
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
  runLocalArticleRun: runLocalArticleRunMock,
}));

import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ArticleFatalError } from '../src/errors';
import { createArticleRun, launchGeneration, launchImageRepair } from '../src/launch';
import { presets } from './fixtures';

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

const keyword: Keyword = {
  id: 'kw1',
  org_id: 'org1',
  keyword: 'best widgets',
  status: 'scheduled',
  scheduled_date: '2026-01-01',
  difficulty: 10,
  search_volume: 100,
  article_id: null,
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  created_at: new Date('2026-01-01'),
} as Keyword;

describe('createArticleRun', () => {
  beforeEach(() => vi.clearAllMocks());

  test('throws ArticleFatalError when the org has no presets', async () => {
    orgFindById.mockResolvedValue({ ...org, presets: undefined });

    await expect(createArticleRun('org1', 'kw1')).rejects.toBeInstanceOf(ArticleFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('throws ArticleFatalError when the keyword is missing or in a different org', async () => {
    orgFindById.mockResolvedValue(org);
    keywordFindById.mockResolvedValue(null);

    await expect(createArticleRun('org1', 'kw1')).rejects.toBeInstanceOf(ArticleFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('snapshots org + keyword into a fresh running run', async () => {
    orgFindById.mockResolvedValue(org);
    keywordFindById.mockResolvedValue(keyword);
    runRepoCreate.mockResolvedValue({ id: 'run1' });

    await createArticleRun('org1', 'kw1');

    expect(runRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org1',
        keyword_id: 'kw1',
        status: 'running',
        input: expect.objectContaining({
          website_url: org.website_url,
          presets,
          keyword,
        }),
      }),
    );
  });
});

describe('launchGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keywordClaimGeneration.mockResolvedValue(true);
    orgFindById.mockResolvedValue(org);
    keywordFindById.mockResolvedValue(keyword);
    runRepoCreate.mockResolvedValue({ id: 'run1', org_id: 'org1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('a lost claim returns null and creates no run', async () => {
    keywordClaimGeneration.mockResolvedValue(false);

    const result = await launchGeneration('org1', 'kw1');

    expect(result).toBeNull();
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('a fatal createArticleRun failure releases the claim via failGeneration and propagates', async () => {
    orgFindById.mockResolvedValue({ ...org, presets: undefined });

    await expect(launchGeneration('org1', 'kw1')).rejects.toBeInstanceOf(ArticleFatalError);

    expect(keywordFailGeneration).toHaveBeenCalledWith(
      'kw1',
      expect.stringContaining('missing or has no presets'),
    );
  });

  test('with ARTICLE_STATE_MACHINE_ARN set, starts a Step Functions execution', async () => {
    vi.stubEnv('ARTICLE_STATE_MACHINE_ARN', 'arn:aws:states:us-east-1:123:stateMachine:article');

    const result = await launchGeneration('org1', 'kw1');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(StartExecutionCommand).toHaveBeenCalledWith({
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:article',
      name: 'article-run1',
      input: JSON.stringify({ run_id: 'run1', org_id: 'org1' }),
    });
    expect(runLocalArticleRunMock).not.toHaveBeenCalled();
  });

  test('no ARN + wait: true awaits the local run', async () => {
    vi.stubEnv('ARTICLE_STATE_MACHINE_ARN', '');
    delete process.env.ARTICLE_STATE_MACHINE_ARN;
    const order: string[] = [];
    runLocalArticleRunMock.mockImplementationOnce(async () => {
      order.push('runLocalArticleRun resolved');
    });

    const result = await launchGeneration('org1', 'kw1', { wait: true });
    order.push('launchGeneration resolved');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).not.toHaveBeenCalled();
    expect(runLocalArticleRunMock).toHaveBeenCalledWith('run1');
    expect(order).toEqual(['runLocalArticleRun resolved', 'launchGeneration resolved']);
  });

  test('no ARN, no wait: fire-and-forget with a .catch attached', async () => {
    vi.stubEnv('ARTICLE_STATE_MACHINE_ARN', '');
    delete process.env.ARTICLE_STATE_MACHINE_ARN;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectRun: (err: Error) => void = () => {};
    runLocalArticleRunMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );

    const result = await launchGeneration('org1', 'kw1');

    expect(result).toEqual({ run_id: 'run1' });
    expect(sfnSend).not.toHaveBeenCalled();
    expect(runLocalArticleRunMock).toHaveBeenCalledWith('run1');

    // launchGeneration already resolved without waiting on the local run; a
    // later rejection of that run must be caught (not an unhandled
    // rejection) by the .catch attached to the fire-and-forget call.
    rejectRun(new Error('boom'));
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    consoleError.mockRestore();
  });
});

describe('launchImageRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    articleFindById.mockResolvedValue({
      id: 'art1',
      org_id: 'org1',
      keyword_id: 'kw1',
    } as Article);
    orgFindById.mockResolvedValue(org);
    keywordFindById.mockResolvedValue(keyword);
    runRepoCreate.mockResolvedValue({ id: 'run2', org_id: 'org1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('pre-completes prepare/outline/draft/humanize/finalize and seeds working.article_id', async () => {
    vi.stubEnv('ARTICLE_STATE_MACHINE_ARN', '');
    delete process.env.ARTICLE_STATE_MACHINE_ARN;

    const result = await launchImageRepair('org1', 'art1');

    expect(result).toEqual({ run_id: 'run2' });
    expect(runRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org1',
        keyword_id: 'kw1',
        status: 'running',
        working: expect.objectContaining({ article_id: 'art1' }),
      }),
    );
    expect(runRepoCreate).toHaveBeenCalledTimes(1);
    const call = runRepoCreate.mock.calls[0]?.[0];
    for (const stage of ['prepare', 'outline', 'draft', 'humanize', 'finalize'] as const) {
      expect(call?.stages[stage]).toMatchObject({ status: 'completed', error: null });
    }
    expect(call?.stages.images_plan).toBeUndefined();
    expect(call?.stages.images_render).toBeUndefined();
    expect(call?.stages.handoff_publish).toBeUndefined();
  });

  test('throws ArticleFatalError when the article is missing or belongs to another org', async () => {
    articleFindById.mockResolvedValue(null);

    await expect(launchImageRepair('org1', 'art1')).rejects.toBeInstanceOf(ArticleFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('throws ArticleFatalError when the article org does not match', async () => {
    articleFindById.mockResolvedValue({ id: 'art1', org_id: 'other-org', keyword_id: 'kw1' });

    await expect(launchImageRepair('org1', 'art1')).rejects.toBeInstanceOf(ArticleFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });

  test('throws ArticleFatalError when the keyword is missing', async () => {
    keywordFindById.mockResolvedValue(null);

    await expect(launchImageRepair('org1', 'art1')).rejects.toBeInstanceOf(ArticleFatalError);
    expect(runRepoCreate).not.toHaveBeenCalled();
  });
});
