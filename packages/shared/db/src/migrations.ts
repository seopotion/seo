import { normalizeKeyword } from '@shared/schemas';
import type { Document, ObjectId, UpdateFilter } from 'mongodb';
import { getDb } from './client';

export interface MigrationReport {
  audience_target_migrated: number;
  normalized_backfilled: number;
  date_dupes_resolved: number;
  keyword_dupes_removed: number;
  publications_backfilled: number;
  status_backfilled: number;
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
  const audienceRes = await db
    .collection('orgs')
    .updateMany({ $expr: { $eq: [{ $type: '$presets.audience.target' }, 'string'] } }, [
      {
        $set: {
          'presets.audience.target': {
            $cond: [{ $eq: ['$presets.audience.target', ''] }, [], ['$presets.audience.target']],
          },
        },
      },
    ]);

  const keywords = db.collection('keywords');

  // #99: backfill normalized_keyword so the unique (org_id, normalized_keyword)
  // partial index covers every scheduled entry.
  let normalizedBackfilled = 0;
  for await (const doc of keywords.find({ normalized_keyword: { $exists: false } })) {
    await keywords.updateOne(
      { _id: doc._id },
      { $set: { normalized_keyword: normalizeKeyword(doc.keyword as string) } },
    );
    normalizedBackfilled++;
  }

  // #99: resolve (org_id, scheduled_date) duplicates before the unique index.
  // Keep the article-linked entry (else lowest _id); shift each extra to the
  // org's next free date so nothing is deleted.
  let dateDupesResolved = 0;
  const dateDupes = await keywords
    .aggregate([
      {
        $group: {
          _id: { org_id: '$org_id', scheduled_date: '$scheduled_date' },
          docs: { $push: { id: '$_id', article_id: '$article_id' } },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const group of dateDupes) {
    const orgId = group._id.org_id as string;
    const docs = group.docs as { id: ObjectId; article_id: string | null }[];
    const keep = docs.find((d) => d.article_id !== null) ?? sortById(docs)[0]!;
    const occupied = new Set(
      (await keywords.find({ org_id: orgId }, { projection: { scheduled_date: 1 } }).toArray()).map(
        (d) => d.scheduled_date as string,
      ),
    );
    for (const extra of sortById(docs.filter((d) => d.id !== keep.id))) {
      const next = nextFreeDate(group._id.scheduled_date as string, occupied);
      occupied.add(next);
      await keywords.updateOne({ _id: extra.id }, { $set: { scheduled_date: next } });
      dateDupesResolved++;
    }
  }

  // #99: resolve (org_id, normalized_keyword) duplicates. Keep the
  // article-linked entry (else lowest _id) and delete unlinked extras; two
  // linked duplicates need a human decision — never orphan a generated article.
  let keywordDupesRemoved = 0;
  const kwDupes = await keywords
    .aggregate([
      {
        $group: {
          _id: { org_id: '$org_id', normalized_keyword: '$normalized_keyword' },
          docs: { $push: { id: '$_id', article_id: '$article_id' } },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const group of kwDupes) {
    const docs = group.docs as { id: ObjectId; article_id: string | null }[];
    const linked = docs.filter((d) => d.article_id !== null);
    if (linked.length > 1) {
      throw new Error(
        `migration blocked: multiple article-linked keywords for ${JSON.stringify(group._id)}: ` +
          docs.map((d) => d.id.toString()).join(', '),
      );
    }
    const keep = linked[0] ?? sortById(docs)[0]!;
    for (const extra of docs.filter((d) => d.id !== keep.id)) {
      await keywords.deleteOne({ _id: extra.id });
      keywordDupesRemoved++;
    }
  }

  // #7: seed articles.publications[] from the deprecated wordpress_post_id
  // mirror. The $not/$elemMatch filter also matches docs with no `publications`
  // field at all, and skips anything already carrying a wordpress entry — that
  // is what makes a re-run a no-op. `slug` is a best-effort reconstruction: an
  // article published and THEN renamed records its current slug, not the
  // published one. Only WordPress is affected (it addresses by post id and does
  // not care); static-site articles all postdate this change, so they are exact.
  const articles = db.collection('articles');
  let publicationsBackfilled = 0;
  for await (const doc of articles.find({
    wordpress_post_id: { $exists: true, $ne: null },
    publications: { $not: { $elemMatch: { provider: 'wordpress' } } },
  })) {
    // See ArticleRepo.recordPublication for why $push needs the cast.
    await articles.updateOne({ _id: doc._id }, {
      $push: {
        publications: {
          provider: 'wordpress',
          ref: String(doc.wordpress_post_id),
          slug: doc.slug as string,
          published_at: (doc.published_at as Date | null) ?? (doc.created_at as Date),
          updated_at: null,
        },
      },
    } as unknown as UpdateFilter<Document>);
    publicationsBackfilled++;
  }

  // Backfill `status`/`published_at` for articles that went live BEFORE
  // recordPublication started advancing the status. Until then nothing ever
  // wrote `'published'`, so these rows are live with a provider yet still read
  // as `'generated'` — which is what kept Content History, the published
  // counter, the GSC title join and the admin count empty. Runs after the
  // publications backfill above on purpose, so WordPress rows seeded from
  // `wordpress_post_id` in the same pass are picked up here too.
  //
  // `published_at` takes the earliest publication rather than `now`: these
  // articles went live in the past, and stamping today would misdate history.
  // Anything already carrying a `published_at` keeps it. `$ne: 'deleted'` so a
  // future unpublish is never silently resurrected.
  let statusBackfilled = 0;
  for await (const doc of articles.find({
    status: { $nin: ['published', 'deleted'] },
    publications: { $elemMatch: { provider: { $exists: true } } },
  })) {
    const pubs = doc.publications as { published_at: Date }[];
    const earliest = pubs
      .map((p) => p.published_at)
      .reduce((a, b) => (a && b && a <= b ? a : (b ?? a)));
    await articles.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'published',
          published_at: (doc.published_at as Date | null) ?? earliest ?? (doc.created_at as Date),
        },
      },
    );
    statusBackfilled++;
  }

  return {
    audience_target_migrated: audienceRes.modifiedCount,
    normalized_backfilled: normalizedBackfilled,
    date_dupes_resolved: dateDupesResolved,
    keyword_dupes_removed: keywordDupesRemoved,
    publications_backfilled: publicationsBackfilled,
    status_backfilled: statusBackfilled,
  };
}

function sortById<T extends { id: ObjectId }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
}

/** First yyyy-mm-dd on/after `from` not present in `occupied` (UTC). */
function nextFreeDate(from: string, occupied: Set<string>): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  let iso = from;
  while (occupied.has(iso)) {
    d.setUTCDate(d.getUTCDate() + 1);
    iso = d.toISOString().slice(0, 10);
  }
  return iso;
}
