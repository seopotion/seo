/** Generation policy constants (#55). Tunable in one place. */
export const WORD_COUNT_FLOOR = 800;
// Single-sourced in @shared/schemas so `apps/web` can import them too (#74).
export { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX } from '@shared/schemas';
export const MIN_H2 = 2;

/** Max generation attempts before a keyword is terminal (scheduler drops it). */
export const MAX_GENERATION_ATTEMPTS = 3;

/** Whether to run the humanization/readability pass. */
export const HUMANIZE = true;

/** Inline images per article (#51); the cover is always additionally required. */
export const INLINE_IMAGE_COUNT = 2;

/** Published articles considered as internal-link targets per generation (#186).
 * Bounds both the outline prompt and the HTTP verification fan-out. */
export const MAX_LINK_CANDIDATES = 25;
