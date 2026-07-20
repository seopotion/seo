import type { StrategyStatus } from '@shared/schemas';
import type { PlannerKeywordResponse } from '../content-planner/types';

export const MAX_RECOMMENDED_ACTIONS = 3;

const PLANNER_HREF = '/content-planner';

export type RecommendedActionKey =
  | 'addKeywords'
  | 'allCaughtUp'
  | 'connectSearchConsole'
  | 'generationFailed'
  | 'overdue'
  | 'planNext'
  | 'strategyFailed'
  | 'strategyPending'
  | 'upgrade';

/** `href` omitted means the action has no in-app destination and renders as plain text. */
export type RecommendedAction = {
  count?: number;
  href?: string;
  key: RecommendedActionKey;
};

export type RecommendedActionsInput = {
  bestGated: boolean;
  keywordResearch: boolean;
  keywords: PlannerKeywordResponse[];
  planned: number;
  published: number;
  strategyStatus: StrategyStatus;
  /** yyyy-mm-dd, injected so the overdue rule is deterministic in tests. */
  today: string;
};

/**
 * Prioritized home-page nudges derived from live org state. Rules are evaluated
 * most-urgent first (failures, then blockers, then growth) and capped, so the
 * card shows what to do next instead of a static checklist.
 */
export function recommendedActions(input: RecommendedActionsInput): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  const failed = input.keywords.filter((keyword) => keyword.generation_status === 'failed').length;

  if (failed > 0) {
    actions.push({ count: failed, href: PLANNER_HREF, key: 'generationFailed' });
  }

  if (input.strategyStatus === 'failed') {
    actions.push({ href: PLANNER_HREF, key: 'strategyFailed' });
  }

  if (input.strategyStatus === 'pending') {
    actions.push({ href: PLANNER_HREF, key: 'strategyPending' });
  }

  if (input.keywords.length === 0) {
    actions.push({ href: PLANNER_HREF, key: 'addKeywords' });
  }

  if (!input.keywordResearch) {
    actions.push({ key: 'upgrade' });
  }

  // `scheduled_date` is a yyyy-mm-dd key, so a string compare is the whole check.
  const overdue = input.keywords.filter(
    (keyword) => keyword.generation_status === 'pending' && keyword.scheduled_date < input.today,
  ).length;

  if (overdue > 0) {
    actions.push({ count: overdue, href: PLANNER_HREF, key: 'overdue' });
  }

  if (input.bestGated) {
    actions.push({ key: 'connectSearchConsole' });
  }

  if (input.planned === 0 && input.published > 0) {
    actions.push({ href: PLANNER_HREF, key: 'planNext' });
  }

  if (actions.length === 0) {
    return [{ key: 'allCaughtUp' }];
  }

  return actions.slice(0, MAX_RECOMMENDED_ACTIONS);
}
