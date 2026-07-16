import { getDb } from './client';

export interface MigrationReport {
  audience_target_migrated: number;
}

/**
 * Idempotent data migrations — run via `seo-dev db migrate` BEFORE `db init`
 * (index creation) on deploy. Every step is a no-op once applied, so re-runs
 * are safe. See design/data-layer.md and #99.
 */
export async function runMigrations(): Promise<MigrationReport> {
  const db = await getDb();

  // #99: presets.audience.target string -> string[] ('' -> [], 'x' -> ['x']).
  // Never comma-split — legacy strings may contain natural-language commas.
  // $expr + aggregation $type: a plain {$type: 'string'} query would also
  // match arrays whose *elements* are strings and re-wrap them on every run.
  const audienceRes = await db.collection('orgs').updateMany(
    { $expr: { $eq: [{ $type: '$presets.audience.target' }, 'string'] } },
    [
      {
        $set: {
          'presets.audience.target': {
            $cond: [{ $eq: ['$presets.audience.target', ''] }, [], ['$presets.audience.target']],
          },
        },
      },
    ],
  );

  return { audience_target_migrated: audienceRes.modifiedCount };
}
