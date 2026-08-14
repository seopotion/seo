import { z } from 'zod';
import { WorkingCandidateSchema } from './candidate';
import { SetupPresetsSchema } from './presets';

/** Stage order of the strategy state machine (#56). */
export const STRATEGY_STAGES = [
  'gather',
  'enrich',
  'triage',
  'serp_fetch',
  'plan',
  'persist_schedule',
] as const;
export type StrategyStageName = (typeof STRATEGY_STAGES)[number];

export const STRATEGY_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

export const StageStateSchema = z.object({
  status: z.enum(['completed', 'failed']),
  started_at: z.date(),
  finished_at: z.date(),
  /** Per-stage funnel/coverage counters — the run's audit trail. */
  stats: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable().default(null),
});
export type StageState = z.infer<typeof StageStateSchema>;

/**
 * One strategy run — the checkpoint document the state machine executes over.
 * Stages read the working-state fields (candidates/below_n/rejected/seeds/stats)
 * and write them back; a retried or redriven stage resumes from exactly what the
 * previous stage persisted. See the 2026-08-13 rearchitect spec.
 */
export const StrategyRunSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  status: z.enum(STRATEGY_RUN_STATUSES),
  input: z.object({
    website_url: z.string(),
    presets: SetupPresetsSchema,
    /** Planner keywords already scheduled when the run was launched. */
    existing_keywords: z.array(z.string()).default([]),
  }),
  stages: z.partialRecord(z.enum(STRATEGY_STAGES), StageStateSchema).default({}),
  candidates: z.array(WorkingCandidateSchema).default([]),
  below_n: z.array(WorkingCandidateSchema).default([]),
  rejected: z.array(WorkingCandidateSchema).default([]),
  seeds: z.array(z.string()).default([]),
  stats: z.record(z.string(), z.unknown()).default({}),
  created_at: z.date(),
  updated_at: z.date(),
});
export type StrategyRun = z.infer<typeof StrategyRunSchema>;

export const CreateStrategyRunInput = StrategyRunSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateStrategyRunInput = z.input<typeof CreateStrategyRunInput>;
