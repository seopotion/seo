import { getDb } from './client';

/**
 * Idempotent index setup — run at deploy time (CDK-invoked one-off Lambda or a
 * script), never lazily per request. `createIndex` is safe to re-run.
 * See design/data-layer.md ("Indexes").
 */
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection('users').createIndex({ google_sub: 1 }, { unique: true });
  // Compound index covers both findByUserId (user_id prefix) and the idempotent
  // start_scan lookup (OrgRepo.findActiveByUserAndUrl, user_id + website_url).
  await db.collection('orgs').createIndex({ user_id: 1, website_url: 1 });
  await db.collection('orgs').createIndex({ website_url: 1 });
  // One planner entry per org per day (#99) — the final concurrency backstop
  // for manual + strategy scheduling. The pre-#99 index had the same name
  // without `unique`, so recreate on a spec/options conflict (codes 85/86).
  // Run `db migrate` first to resolve existing duplicates.
  try {
    await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 }, { unique: true });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 85 && code !== 86) throw e;
    await db.collection('keywords').dropIndex('org_id_1_scheduled_date_1');
    await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 }, { unique: true });
  }
  // One scheduled entry per normalized keyword per org (#99); partial so legacy
  // docs without the field (backfilled by `db migrate`) don't block creation.
  await db
    .collection('keywords')
    .createIndex(
      { org_id: 1, normalized_keyword: 1 },
      { unique: true, partialFilterExpression: { normalized_keyword: { $type: 'string' } } },
    );
  // One planner entry per source candidate (#99) — makes scheduling idempotent
  // at the database layer.
  await db
    .collection('keywords')
    .createIndex(
      { org_id: 1, candidate_id: 1 },
      { unique: true, partialFilterExpression: { candidate_id: { $type: 'string' } } },
    );
  // Scheduler due-query: scheduled_date range + unlinked filter (#55).
  await db.collection('keywords').createIndex({ scheduled_date: 1, article_id: 1 });
  await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('articles').createIndex({ org_id: 1, status: 1 });
  await db
    .collection('candidates')
    .createIndex({ org_id: 1, normalized_keyword: 1 }, { unique: true });
  await db.collection('candidates').createIndex({ org_id: 1, status: 1 });
  await db.collection('candidates').createIndex({ org_id: 1, opportunity_score: -1 });
  // Candidate-pool read: org/status filter + score/date ordering (#99).
  await db
    .collection('candidates')
    .createIndex({ org_id: 1, status: 1, opportunity_score: -1, created_at: 1 });
  // One GSC connection per org (#12); the unique index makes upsertToken safe
  // under concurrent connect callbacks.
  await db.collection('gsc_connections').createIndex({ org_id: 1 }, { unique: true });
  // GSC analytics cache (#208): one row per query key; TTL expires entries 48h
  // after the last write (GSC's own data refreshes ~daily, so 48h staleness is
  // acceptable and cuts quota use drastically).
  await db.collection('gsc_analytics_cache').createIndex({ key: 1 }, { unique: true });
  await db
    .collection('gsc_analytics_cache')
    .createIndex({ created_at: 1 }, { expireAfterSeconds: 172800 });
  // One connection per (org, provider) (#7) — an org is one website, so the
  // unique index is what makes connectWordPress's upsert safe.
  await db.collection('integrations').createIndex({ org_id: 1, provider: 1 }, { unique: true });
  // One GitHub App installation binds to exactly one org
  // (design/github-app.md § Why `state` is not optional here). Partial so
  // WordPress rows, which have no installation_id, don't collide on null.
  await db
    .collection('integrations')
    .createIndex(
      { installation_id: 1 },
      { unique: true, partialFilterExpression: { provider: 'static-site' } },
    );
  // Billing (#13). Unique on the provider subscription id makes upsertFromEvent
  // idempotent under at-least-once webhooks; org_id index serves findActiveByOrg.
  await db
    .collection('subscriptions')
    .createIndex({ provider_subscription_id: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ org_id: 1, status: 1 });
  // Admin audit log (epic #150): per-org history (newest first) + global feed.
  await db.collection('admin_actions').createIndex({ org_id: 1, at: -1 });
  await db.collection('admin_actions').createIndex({ at: -1 });
  // Strategy runs are looked up per org, newest first (#56).
  await db.collection('strategy_runs').createIndex({ org_id: 1, created_at: -1 });
  // Article runs are looked up per org, newest first, and per keyword.
  await db.collection('article_runs').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('article_runs').createIndex({ keyword_id: 1, created_at: -1 });
  // Promo codes (design spec 2026-08-29): unique code for validation lookups;
  // one redemption row per (code, org) makes upsertPending idempotent and
  // once-per-org enforceable at the database layer.
  await db.collection('promo_codes').createIndex({ code: 1 }, { unique: true });
  await db.collection('promo_redemptions').createIndex({ code_id: 1, org_id: 1 }, { unique: true });
  await db.collection('promo_redemptions').createIndex({ org_id: 1 });
}
