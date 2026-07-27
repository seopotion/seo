import { describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: {
    findById: vi.fn(),
    search: vi.fn(),
    findByUserId: vi.fn(),
    setPlan: vi.fn(),
    claimStrategy: vi.fn(),
    setStrategyStatus: vi.fn(),
  },
  UserRepo: { findById: vi.fn(), findByEmail: vi.fn() },
  SubscriptionRepo: { findLatestByOrg: vi.fn(), listActiveByOrg: vi.fn() },
  GscConnectionRepo: { findByOrgId: vi.fn() },
  KeywordRepo: { countScheduled: vi.fn() },
  ArticleRepo: { countByStatus: vi.fn() },
  AdminActionRepo: { insert: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
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
      engagement: { image_style: 'photo', youtube_videos: true },
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
