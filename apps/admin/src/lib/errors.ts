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
  not_found: 'That org no longer exists.',
  no_presets: 'This org has no presets yet — the onboarding scan has not produced them.',
  strategy_not_claimable: 'A strategy job is already pending or completed for this org.',
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}

/** What to show the operator for a thrown query/mutation error. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? errorMessage(error.code) : fallback;
}
