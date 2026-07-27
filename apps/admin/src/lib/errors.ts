import { ApiError } from './api';

/**
 * The one place an API error code becomes operator-readable copy. The admin API
 * refuses with `{ error: '<code>' }` (409/4xx) and `unwrap` surfaces that code
 * on `ApiError.code`; anything not mapped here falls through as the raw code,
 * which is still more useful to an operator than a generic "something failed".
 *
 * Later subtasks extend this map rather than inventing their own copy.
 */
const MESSAGES: Record<string, string> = {
  not_found: 'That record no longer exists — reload the page.',
  no_presets: 'This org has no presets yet — the onboarding scan has not produced them.',
  strategy_not_claimable: 'A strategy job is already pending or completed for this org.',

  // Keyword curation (pool + planner).
  keyword_provider_failed: 'The research provider failed — try again in a moment.',
  date_occupied: 'That day already has a planner entry — pick another date.',
  keyword_already_scheduled: 'This keyword is already on the planner for another date.',
  candidate_already_scheduled: 'This candidate is already scheduled.',
  candidate_not_schedulable:
    'This candidate is missing the volume/difficulty metrics scheduling requires.',
  candidate_not_deletable: 'Only a pooled candidate can be rejected — this one moved on already.',
  generation_started: 'Generation already started — this entry can no longer be changed.',
  org_not_paid:
    'This org is on the free plan: generation would fail and burn an attempt. Set the plan first.',
  generation_terminal: 'This keyword already generated its article.',

  // Article editor.
  validation_failed: 'Some fields are invalid — see the messages below.',
  images_in_progress:
    'The images worker is still writing this article — it would overwrite the save. ' +
    'Wait for images to finish, then reload.',

  // WordPress publish / update.
  wordpress_not_connected: 'This org has no WordPress connection — connect the plugin first.',
  already_published: 'This article already has a WordPress post — use “Update live post”.',
  not_published: 'This article was never published — use “Publish to WordPress” first.',
  images_not_complete: 'WordPress publishing needs the images to be complete.',
  post_id_not_saved:
    'WordPress created the post but we failed to store its id — check the site before retrying, ' +
    'or a second publish would duplicate it.',
  wordpress_request_failed: "The customer's WordPress site did not respond — try again.",
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}

/** What to show the operator for a thrown query/mutation error. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? errorMessage(error.code) : fallback;
}
