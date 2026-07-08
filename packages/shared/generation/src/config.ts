/** Generation policy constants (#55). Tunable in one place. */
export const WORD_COUNT_FLOOR = 800;
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MIN = 120;
export const META_DESCRIPTION_MAX = 160;
export const MIN_H2 = 2;

/** Max generation attempts before a keyword is terminal (scheduler drops it). */
export const MAX_GENERATION_ATTEMPTS = 3;

/** Whether to run the humanization/readability pass. */
export const HUMANIZE = true;

/** Inline images per article (#51); the cover is always additionally required. */
export const INLINE_IMAGE_COUNT = 2;
