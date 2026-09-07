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
  strategy_not_claimable:
    'A strategy job is already pending or completed for this org — use “Force re-run” instead.',

  // Keyword curation (pool + planner).
  keyword_provider_failed: 'The research provider failed — try again in a moment.',
  date_occupied: 'That day already has a planner entry — pick another date.',
  keyword_already_scheduled: 'This keyword is already on the planner for another date.',
  candidate_already_scheduled: 'This candidate is already scheduled.',
  candidate_not_schedulable: 'This candidate is missing the search volume scheduling requires.',
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
  images_not_supported: 'Standalone articles do not support image generation.',
  invalid_upload_metadata: 'Choose a WebP, JPEG, or PNG up to 5 MiB, with descriptive alt text.',
  invalid_image_placement:
    'The H2 section is missing or ambiguous. Reload and choose a unique section.',
  manual_image_limit:
    'This article already has eight images. Choose an existing placement to replace one.',
  image_slot_changed: 'This placement changed during the upload. Reload before trying again.',
  article_changed: 'The article changed during the upload. Reload and retry finalization.',
  invalid_upload_token:
    'This upload expired or belongs to another session. Select the file again to restart.',
  upload_not_found: 'The file has not reached storage. Select the file again and retry the upload.',
  uploaded_file_mismatch:
    'The uploaded file does not match its declared type or size. Select the file again.',
  invalid_image_file: 'The file is not a valid supported image, or exceeds 40 megapixels.',
  image_storage_unavailable: 'Image storage is not configured for this environment.',
  image_upload_failed:
    'The upload failed. Check your connection and retry; the upload URL may have expired.',
  image_upload_timeout: 'The upload timed out. Check your connection and try again.',
  manual_images_only: 'Manual uploads are available only for manually created articles.',

  // WordPress publish / update.
  wordpress_not_connected: 'This org has no WordPress connection — connect the plugin first.',
  already_published: 'This article already has a WordPress post — use “Update live post”.',
  not_published: 'This article was never published — use “Publish to WordPress” first.',
  images_not_complete: 'WordPress publishing needs the images to be complete.',
  post_id_not_saved:
    'WordPress created the post but we failed to store its id — check the site before retrying, ' +
    'or a second publish would duplicate it.',
  wordpress_request_failed: "The customer's WordPress site did not respond — try again.",

  // Phase-2 unstick levers. Each is a conditional update losing its race: the
  // row moved on since the page loaded, so the copy says what to do about it.
  candidate_not_restorable: 'This candidate is no longer rejected — reload the pool.',
  not_resettable:
    'Only a failed entry with no article can be reset — reload the planner to see its real state.',
  setup_complete:
    'Refused for live orgs: a rescan would overwrite the presets and knock this org out of its ' +
    'dashboard.',
  gsc_not_connected: 'This org has no Search Console connection to remove.',

  // WordPress connect-on-behalf: the plugin reports these through the
  // verify-then-save step, before anything is stored.
  invalid_integration_key: "The plugin rejected that key — check it in the customer's WordPress.",
  integration_not_configured:
    'The plugin is installed but its integration is not switched on for this site.',

  // Promo codes.
  code_exists:
    'That code is already in use — pick a different one or leave it blank to generate one.',
  already_inactive: 'This code is already inactive.',
};

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}

/** What to show the operator for a thrown query/mutation error. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? errorMessage(error.code) : fallback;
}
