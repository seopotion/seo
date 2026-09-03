import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: {
    findById: vi.fn(),
    search: vi.fn(),
    findByUserId: vi.fn(),
    setPlan: vi.fn(),
    claimStrategy: vi.fn(),
    setStrategyStatus: vi.fn(),
    updatePresets: vi.fn(),
    saveWordPressConnection: vi.fn(),
    clearWordPressConnection: vi.fn(),
  },
  UserRepo: { findById: vi.fn(), findByEmail: vi.fn() },
  SubscriptionRepo: { findLatestByOrg: vi.fn(), listActiveByOrg: vi.fn() },
  GscConnectionRepo: { findByOrgId: vi.fn(), deleteByOrgId: vi.fn() },
  KeywordRepo: { countScheduled: vi.fn() },
  ArticleRepo: { countByStatus: vi.fn() },
  AdminActionRepo: { insert: vi.fn(), listByOrg: vi.fn() },
  PromoCodeRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deactivate: vi.fn(),
  },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

const wp = vi.hoisted(() => ({ testWordPressIntegration: vi.fn() }));
vi.mock('../src/clients/wordpress', () => wp);

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

beforeEach(() => {
  vi.clearAllMocks();
});

const org = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://example.com',
  name: 'Example',
  setup_status: 'setup_complete' as const,
  plan: 'expert' as const,
  strategy_status: 'completed' as const,
  wordpress_token: 'never-return-this-token',
  wordpress_connected_at: new Date('2026-07-14T10:00:00.000Z'),
  presets: {
    business: { name: 'Example', language: 'en', country: 'US', description: 'd' },
    audience: { target: ['smb'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'guide',
        internal_links_count: 1,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: {
        image_direction: { medium: 'photograph', palette: '', notes: '' },
        include_cta: true,
        youtube_videos: true,
      },
      publishing: { auto_publish: false },
    },
  },
  domain_rating: { value: 42, checked_at: new Date('2026-07-01T00:00:00.000Z') },
  onboarding: { referral_source: 'x', integrations: ['wordpress' as const] },
  created_at: new Date('2026-06-01T00:00:00.000Z'),
};

describe('GET /admin/v0/orgs (search)', () => {
  test('email query resolves via the owner, not OrgRepo.search', async () => {
    repos.UserRepo.findByEmail.mockResolvedValueOnce({ id: 'u1', email: 'o@x.com' });
    repos.OrgRepo.findByUserId.mockResolvedValueOnce([org]);

    const res = await client.admin.v0.orgs.$get({ query: { query: 'o@x.com' } }, await authed());
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.orgs).toHaveLength(1);
    expect(json.orgs[0]?.id).toBe(org.id);
    expect(repos.UserRepo.findByEmail).toHaveBeenCalledWith('o@x.com');
    expect(repos.OrgRepo.search).not.toHaveBeenCalled();
  });

  test('unknown email -> empty result', async () => {
    repos.UserRepo.findByEmail.mockResolvedValueOnce(null);
    const res = await client.admin.v0.orgs.$get({ query: { query: 'no@x.com' } }, await authed());
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).orgs).toEqual([]);
  });

  test('non-email query goes through OrgRepo.search', async () => {
    repos.OrgRepo.search.mockResolvedValueOnce([org]);
    const res = await client.admin.v0.orgs.$get({ query: { query: 'example' } }, await authed());
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).orgs[0]?.website_url).toBe('https://example.com');
    expect(repos.OrgRepo.search).toHaveBeenCalledWith('example');
  });
});

describe('GET /admin/v0/orgs/{org_id} (detail)', () => {
  test('composes owner + subscriptions + gsc + counts, fully redacted', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.UserRepo.findById.mockResolvedValueOnce({ id: org.user_id, email: 'o@x.com', name: 'O' });
    repos.SubscriptionRepo.findLatestByOrg.mockResolvedValueOnce({
      id: 's1',
      org_id: org.id,
      provider: 'lemonsqueezy',
      provider_customer_id: 'cust_1',
      provider_subscription_id: 'sub_1',
      tier: 'expert',
      status: 'active',
      current_period_end: new Date('2026-08-01T00:00:00.000Z'),
      created_at: new Date('2026-07-01T00:00:00.000Z'),
      updated_at: new Date('2026-07-01T00:00:00.000Z'),
    });
    repos.SubscriptionRepo.listActiveByOrg.mockResolvedValueOnce([]);
    repos.GscConnectionRepo.findByOrgId.mockResolvedValueOnce({
      id: 'g1',
      org_id: org.id,
      refresh_token_enc: 'secret-refresh-token-enc',
      site_url: 'sc-domain:example.com',
      google_email: 'o@x.com',
      connected_at: new Date('2026-07-10T00:00:00.000Z'),
      last_refresh_failed_at: null,
    });
    repos.KeywordRepo.countScheduled.mockResolvedValueOnce(7);
    repos.ArticleRepo.countByStatus.mockResolvedValueOnce(4).mockResolvedValueOnce(2);

    const res = await client.admin.v0.orgs[':org_id'].$get(
      { param: { org_id: org.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();

    expect(json.org.plan).toBe('expert');
    expect(json.org.wordpress).toEqual({
      connected: true,
      connected_at: '2026-07-14T10:00:00.000Z',
    });
    expect(json.owner?.email).toBe('o@x.com');
    expect(json.subscriptions.latest?.provider_subscription_id).toBe('sub_1');
    expect(json.gsc?.connected).toBe(true);
    expect(json.counts).toEqual({
      scheduled_keywords: 7,
      articles_generated: 4,
      articles_published: 2,
    });

    // Redaction (epic test 4): no secret values or keys anywhere in the body.
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('never-return-this-token');
    expect(serialized).not.toContain('secret-refresh-token-enc');
    expect(serialized).not.toContain('wordpress_token');
    expect(serialized).not.toContain('refresh_token_enc');
  });

  test('unknown org -> 404 not_found', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(null);
    const res = await client.admin.v0.orgs[':org_id'].$get(
      { param: { org_id: 'f'.repeat(24) } },
      await authed(),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /admin/v0/orgs/{org_id}/audit', () => {
  test('returns the org actions newest-first with ISO timestamps', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.AdminActionRepo.listByOrg.mockResolvedValueOnce({
      actions: [
        {
          id: 'act_1',
          at: new Date('2026-07-27T09:00:00.000Z'),
          actor: 'op@example.com',
          action: 'org.set_plan',
          org_id: org.id,
          entity: null,
          payload: { plan: 'expert' },
          before: { plan: 'free' },
        },
      ],
      total: 1,
    });

    const res = await client.admin.v0.orgs[':org_id'].audit.$get(
      { param: { org_id: org.id }, query: {} },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.actions[0]).toMatchObject({
      actor: 'op@example.com',
      action: 'org.set_plan',
      at: '2026-07-27T09:00:00.000Z',
    });
    expect(repos.AdminActionRepo.listByOrg).toHaveBeenCalledWith(org.id, { limit: 50, offset: 0 });
  });

  test('unknown org -> 404', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(null);
    const res = await client.admin.v0.orgs[':org_id'].audit.$get(
      { param: { org_id: 'f'.repeat(24) }, query: {} },
      await authed(),
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /admin/v0/orgs/{org_id}/presets', () => {
  test('deep-merges over the stored presets regardless of setup status, and audits', async () => {
    repos.AdminActionRepo.insert.mockClear();
    // Mid-onboarding org — the customer flow would refuse this status.
    repos.OrgRepo.findById.mockResolvedValueOnce({ ...org, setup_status: 'setup_scan_completed' });

    const res = await client.admin.v0.orgs[':org_id'].presets.$patch(
      {
        param: { org_id: org.id },
        json: { business: { name: 'Renamed' }, audience: { competitors: ['x.com'] } },
      },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    const json = await res.json();
    expect(json.presets.business.name).toBe('Renamed');
    expect(json.presets.business.language).toBe('en'); // untouched field survives
    expect(json.presets.audience.competitors).toEqual(['x.com']); // arrays replace wholesale

    expect(repos.OrgRepo.updatePresets).toHaveBeenCalledWith(org.id, json.presets);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.update_presets', before: org.presets }),
    );
  });

  test('org without presets -> 409 no_presets, no audit row', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce({ ...org, presets: undefined });

    const res = await client.admin.v0.orgs[':org_id'].presets.$patch(
      { param: { org_id: org.id }, json: { business: { name: 'X' } } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_presets' });
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('WordPress connect / disconnect (on behalf)', () => {
  test('connect verifies then saves; the token is redacted in the audit payload', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce({ ...org, wordpress_token: undefined });
    wp.testWordPressIntegration.mockResolvedValueOnce({ success: true });
    repos.OrgRepo.saveWordPressConnection.mockResolvedValueOnce(true);

    const res = await client.admin.v0.orgs[':org_id'].integrations.wordpress.$post(
      { param: { org_id: org.id }, json: { token: 'plugin-secret-key' } },
      await authed(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(wp.testWordPressIntegration).toHaveBeenCalledWith(org.website_url, 'plugin-secret-key');
    expect(repos.OrgRepo.saveWordPressConnection).toHaveBeenCalledWith(
      org.id,
      'plugin-secret-key',
      expect.any(Date),
    );
    const auditRow = repos.AdminActionRepo.insert.mock.calls[0]?.[0] as { payload: unknown };
    expect(JSON.stringify(auditRow.payload)).not.toContain('plugin-secret-key');
  });

  test('connect refuses an invalid key -> 403, nothing saved, no audit', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.testWordPressIntegration.mockResolvedValueOnce({
      success: false,
      error_code: 'invalid_integration_key',
    });

    const res = await client.admin.v0.orgs[':org_id'].integrations.wordpress.$post(
      { param: { org_id: org.id }, json: { token: 'bad' } },
      await authed(),
    );
    expect(res.status).toBe(403);
    expect(repos.OrgRepo.saveWordPressConnection).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('connect maps a network failure -> 502', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    wp.testWordPressIntegration.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await client.admin.v0.orgs[':org_id'].integrations.wordpress.$post(
      { param: { org_id: org.id }, json: { token: 't' } },
      await authed(),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error_code: 'wordpress_request_failed' });
  });

  test('disconnect clears the connection and audits -> 204', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce(org); // has wordpress_token
    repos.OrgRepo.clearWordPressConnection.mockResolvedValueOnce(true);

    const res = await client.admin.v0.orgs[':org_id'].integrations.wordpress.$delete(
      { param: { org_id: org.id } },
      await authed(),
    );
    expect(res.status).toBe(204);
    expect(repos.OrgRepo.clearWordPressConnection).toHaveBeenCalledWith(org.id);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.wordpress_disconnect' }),
    );
  });

  test('disconnect without a connection -> 409, no audit', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce({ ...org, wordpress_token: undefined });

    const res = await client.admin.v0.orgs[':org_id'].integrations.wordpress.$delete(
      { param: { org_id: org.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'wordpress_not_connected' });
    expect(repos.OrgRepo.clearWordPressConnection).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});

describe('DELETE /admin/v0/orgs/{org_id}/gsc', () => {
  const gscConn = {
    id: 'g1',
    org_id: 'a'.repeat(24),
    refresh_token_enc: 'secret-refresh-token-enc',
    site_url: 'sc-domain:example.com',
    google_email: 'o@x.com',
    connected_at: new Date('2026-07-10T00:00:00.000Z'),
    last_refresh_failed_at: new Date('2026-07-20T00:00:00.000Z'),
  };

  test('deletes the connection; the audit before snapshot never carries the token', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.GscConnectionRepo.findByOrgId.mockResolvedValueOnce(gscConn);
    repos.GscConnectionRepo.deleteByOrgId.mockResolvedValueOnce(true);

    const res = await client.admin.v0.orgs[':org_id'].gsc.$delete(
      { param: { org_id: org.id } },
      await authed(),
    );
    expect(res.status).toBe(204);
    expect(repos.GscConnectionRepo.deleteByOrgId).toHaveBeenCalledWith(org.id);
    const auditRow = repos.AdminActionRepo.insert.mock.calls[0]?.[0] as { before: unknown };
    expect(JSON.stringify(auditRow.before)).not.toContain('secret-refresh-token-enc');
    expect(JSON.stringify(auditRow.before)).not.toContain('refresh_token_enc');
    expect(auditRow.before).toMatchObject({ google_email: 'o@x.com' });
  });

  test('no connection -> 409 gsc_not_connected, no audit', async () => {
    repos.AdminActionRepo.insert.mockClear();
    repos.OrgRepo.findById.mockResolvedValueOnce(org);
    repos.GscConnectionRepo.findByOrgId.mockResolvedValueOnce(null);

    const res = await client.admin.v0.orgs[':org_id'].gsc.$delete(
      { param: { org_id: org.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'gsc_not_connected' });
    expect(repos.GscConnectionRepo.deleteByOrgId).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});
