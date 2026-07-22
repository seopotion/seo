import { describe, expect, test } from 'vitest';
import type { PlannerKeywordResponse } from '../app/[locale]/(authenticated)/(product)/content-planner/types';
import {
  MAX_RECOMMENDED_ACTIONS,
  type RecommendedActionsInput,
  recommendedActions,
} from '../app/[locale]/(authenticated)/(product)/home/home-utils';

const TODAY = '2026-07-20';

function plannerKeyword(overrides: Partial<PlannerKeywordResponse> = {}): PlannerKeywordResponse {
  return {
    article_id: null,
    candidate_id: 'candidate-1',
    difficulty: 23,
    generation_error: null,
    generation_status: 'generated',
    id: 'keyword-1',
    intent: 'informational',
    keyword: 'content planning',
    opportunity_score: 65,
    scheduled_date: TODAY,
    search_volume: 1200,
    ...overrides,
  };
}

/** A settled org: strategy done, keywords generated, GSC connected, entitled. */
function input(overrides: Partial<RecommendedActionsInput> = {}): RecommendedActionsInput {
  return {
    bestGated: false,
    keywordResearch: true,
    keywords: [plannerKeyword()],
    planned: 1,
    published: 1,
    strategyStatus: 'completed',
    today: TODAY,
    ...overrides,
  };
}

function keys(overrides: Partial<RecommendedActionsInput> = {}) {
  return recommendedActions(input(overrides)).map((action) => action.key);
}

describe('recommendedActions rules', () => {
  test('falls back to all-caught-up when nothing fires', () => {
    expect(recommendedActions(input())).toEqual([{ key: 'allCaughtUp' }]);
  });

  test('flags failed generations with a count', () => {
    const keywords = [
      plannerKeyword({ generation_status: 'failed', id: 'a' }),
      plannerKeyword({ generation_status: 'failed', id: 'b' }),
      plannerKeyword({ id: 'c' }),
    ];

    expect(recommendedActions(input({ keywords }))).toEqual([
      { count: 2, href: '/content-planner', key: 'generationFailed' },
    ]);
  });

  test.each([
    ['failed', 'strategyFailed'],
    ['pending', 'strategyPending'],
  ] as const)('surfaces a %s strategy', (strategyStatus, key) => {
    expect(keys({ strategyStatus })).toContain(key);
  });

  test('asks for keywords when the planner is empty', () => {
    expect(keys({ keywords: [], planned: 0 })).toContain('addKeywords');
  });

  test('prompts an upgrade without the keyword-research capability', () => {
    expect(recommendedActions(input({ keywordResearch: false }))).toEqual([{ key: 'upgrade' }]);
  });

  test('counts only pending keywords scheduled before today', () => {
    const keywords = [
      plannerKeyword({ generation_status: 'pending', id: 'a', scheduled_date: '2026-07-19' }),
      // Today is not overdue.
      plannerKeyword({ generation_status: 'pending', id: 'b', scheduled_date: TODAY }),
      // Already generated, so the past date is fine.
      plannerKeyword({ generation_status: 'generated', id: 'c', scheduled_date: '2026-01-01' }),
    ];

    expect(recommendedActions(input({ keywords }))).toEqual([
      { count: 1, href: '/content-planner', key: 'overdue' },
    ]);
  });

  test('asks to connect Search Console while gated, with no destination', () => {
    expect(recommendedActions(input({ bestGated: true }))).toEqual([
      { key: 'connectSearchConsole' },
    ]);
  });

  test('nudges to plan next only when something is already published', () => {
    expect(keys({ planned: 0 })).toContain('planNext');
    expect(keys({ planned: 0, published: 0 })).not.toContain('planNext');
  });
});

describe('recommendedActions ordering', () => {
  test('ranks failures above blockers above growth, capped at the maximum', () => {
    const actions = recommendedActions(
      input({
        bestGated: true,
        keywordResearch: false,
        keywords: [
          plannerKeyword({ generation_status: 'failed', id: 'a' }),
          plannerKeyword({ generation_status: 'pending', id: 'b', scheduled_date: '2026-01-01' }),
        ],
        planned: 0,
        strategyStatus: 'failed',
      }),
    );

    expect(actions).toHaveLength(MAX_RECOMMENDED_ACTIONS);
    expect(actions.map((action) => action.key)).toEqual([
      'generationFailed',
      'strategyFailed',
      'upgrade',
    ]);
  });
});
