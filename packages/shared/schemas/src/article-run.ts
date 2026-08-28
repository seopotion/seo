import { z } from 'zod';
import { TOPIC_ROLES } from './candidate';
import { KeywordSchema } from './keyword';
import { SetupPresetsSchema } from './presets';
import { StageStateSchema } from './strategy-run';

/** Stage order of the article-generation state machine. */
export const ARTICLE_STAGES = [
  'prepare',
  'outline',
  'draft',
  'humanize',
  'finalize',
  'images_plan',
  'images_render',
  'handoff_publish',
] as const;
export type ArticleStageName = (typeof ARTICLE_STAGES)[number];

export const ARTICLE_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

/** Snapshot of @shared/generation's LinkCandidate (schemas cannot import generation). */
const LinkCandidateSnapshotSchema = z.object({
  title: z.string(),
  url: z.string(),
  topic_cluster_id: z.string().nullable(),
  topic_role: z.enum(TOPIC_ROLES).nullable(),
});

/** Snapshot of @shared/generation's Outline (same rationale as LinkCandidateSnapshot). */
const OutlineSnapshotSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  internal_links: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export const HumanizeAttemptSchema = z.object({
  attempt: z.number().int(),
  /** Flesch-Kincaid grade of this attempt's content; null = unmeasurable or non-English. */
  grade: z.number().nullable(),
  content: z.string(),
});
export type HumanizeAttempt = z.infer<typeof HumanizeAttemptSchema>;

/**
 * One article-generation run — the checkpoint document the state machine
 * executes over. Each stage reads `working`, does its one expensive thing, and
 * writes its result back; a retried or redriven stage resumes from exactly what
 * the previous stage persisted. See the 2026-08-28 design spec.
 */
export const ArticleRunSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword_id: z.string(),
  status: z.enum(ARTICLE_RUN_STATUSES),
  input: z.object({
    website_url: z.string(),
    presets: SetupPresetsSchema,
    /** Keyword snapshot at launch; the live doc may move on (article_id etc). */
    keyword: KeywordSchema,
  }),
  stages: z.partialRecord(z.enum(ARTICLE_STAGES), StageStateSchema).default({}),
  working: z
    .object({
      link_candidates: z.array(LinkCandidateSnapshotSchema).default([]),
      outline: OutlineSnapshotSchema.nullable().default(null),
      draft: z.string().nullable().default(null),
      humanize_attempts: z.array(HumanizeAttemptSchema).default([]),
      /** The chosen (readability-approved or best-of-cap) humanized content. */
      content: z.string().nullable().default(null),
      /** FK grade of `content`; what finalize stamps onto the article. */
      readability_grade: z.number().nullable().default(null),
      /** Set by finalize once the article doc exists; images stages key off it. */
      article_id: z.string().nullable().default(null),
    })
    .default({
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: null,
    }),
  created_at: z.date(),
  updated_at: z.date(),
});
export type ArticleRun = z.infer<typeof ArticleRunSchema>;
export type ArticleRunWorking = ArticleRun['working'];

export const CreateArticleRunInput = ArticleRunSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateArticleRunInput = z.input<typeof CreateArticleRunInput>;
