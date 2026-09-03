import type { Tone } from '../components/Badge';
import type { ArticleStatus, ImagesStatus, OrgSummary } from './queries';

/**
 * How org statuses colour their badges — shared by the search results and the
 * workspace header so the same status never reads two ways.
 */

export function planTone(plan: OrgSummary['plan']): Tone {
  return plan === 'free' ? 'neutral' : 'good';
}

export function setupTone(status: OrgSummary['setup_status']): Tone {
  if (status === 'setup_complete') return 'good';
  if (status === 'setup_scan_failed') return 'bad';
  return status === 'setup_not_started' ? 'neutral' : 'warn';
}

export function strategyTone(status: OrgSummary['strategy_status']): Tone {
  if (status === 'completed') return 'good';
  if (status === 'failed') return 'bad';
  return status === 'pending' ? 'warn' : 'neutral';
}

export function articleStatusTone(status: ArticleStatus): Tone {
  if (status === 'published') return 'good';
  return status === 'deleted' ? 'bad' : 'neutral';
}

/** `pending` is a warning, not a neutral: it is what blocks editing and publishing. */
export function imagesTone(status: ImagesStatus): Tone {
  if (status === 'complete') return 'good';
  return status === 'failed' ? 'bad' : 'warn';
}
