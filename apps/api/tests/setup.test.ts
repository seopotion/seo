import { beforeEach, describe, expect, test, vi } from 'vitest';

// Spy on the SQS enqueue (hoisted so the vi.mock factory can reference it).
const { enqueueScanTask } = vi.hoisted(() => ({ enqueueScanTask: vi.fn(async () => {}) }));
vi.mock('../src/clients/sqs', () => ({ enqueueScanTask }));

const { launchStrategy } = vi.hoisted(() => ({
  launchStrategy: vi.fn(async () => ({ run_id: 'run_1' })),
}));
vi.mock('@shared/strategy', () => ({ launchStrategy }));

// A fully-populated presets object (matches SetupPresetsSchema) for the
// completed org, so `/details` has something to return.
const presetsFixture = {
  business: {
    name: 'Example Co',
    language: 'English',
    country: 'Global (English)',
    description: 'An example business.',
  },
  audience: { target: ['Developers'], competitors: ['acme.com'] },
  blog: {
    sitemap_url: 'https://example.com/sitemap.xml',
    main_blog_url: 'https://example.com/blog',
    best_articles: ['https://example.com/blog/post-1'],
  },
  article_preferences: {
    content_seo: {
      article_style: 'Conversational',
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
};

// Mock the DB package BEFORE importing the app. Vitest hoists vi.mock above the
// imports, so the route's `import { OrgRepo } from '@shared/db'` gets the mock.
vi.mock('@shared/db', () => ({
  OrgRepo: {
    create: vi.fn(async (input: { website_url: string }) => ({
      id: '6650f1a2b3c4d5e6f7a8b9c0',
      website_url: input.website_url,
      setup_status: 'setup_scan_in_progress',
      created_at: new Date(),
    })),
    // Default: no in-progress org for this user+url, so start_scan creates one.
    findActiveByUserAndUrl: vi.fn(async () => null),
    updateStatus: vi.fn(async () => {}),
    findById: vi.fn(async (id: string) => {
      // Completed org with presets ready, owned by the test user.
      if (id === '6650f1a2b3c4d5e6f7a8b9c0') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          plan: 'free',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // Completed org whose scan hasn't produced presets yet (owned by test user).
      if (id === 'no_presets') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_in_progress',
          plan: 'free',
          created_at: new Date(),
        };
      }
      // An already-finalized org owned by the test user (for 409 cases).
      if (id === 'already_complete') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_complete',
          plan: 'free',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // An org owned by a DIFFERENT user (for ownership 404 cases).
      if (id === 'other_users_org') {
        return {
          id,
          user_id: 'someone_else',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          plan: 'free',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // A paid org ready to finalize (for the strategy-trigger tests).
      if (id === 'paid_ready') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          plan: 'paid',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      return null;
    }),
    updatePresets: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
    claimStrategy: vi.fn(async () => true),
  },
  OrgMemberRepo: { findByOrgAndEmail: vi.fn(async () => null) },
}));

import { OrgRepo } from '@shared/db';
import { testClient } from 'hono/testing';
import { signToken } from '../src/auth/jwt';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

async function authHeader() {
  const token = await signToken({ sub: 'user_1', email: 'u@example.com' });
  return { Authorization: `Bearer ${token}` };
}

async function finalize(orgId: string) {
  return client.api.v0.setup.finalize.$post(
    { json: { org_id: orgId } },
    { headers: await authHeader() },
  );
}

describe('setup routes', () => {
  test('POST /start_scan requires auth', async () => {
    const res = await client.api.v0.setup.start_scan.$post({
      json: { website_url: 'https://example.com' },
    });
    expect(res.status).toBe(401);
  });

  test('POST /start_scan creates an org and returns scanning status', async () => {
    const res = await client.api.v0.setup.start_scan.$post(
      { json: { website_url: 'https://example.com' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.org_id).toBe('6650f1a2b3c4d5e6f7a8b9c0');
    expect(json.setup_status).toBe('setup_scan_in_progress');

    // The scan task is enqueued for the worker with the new org id.
    expect(enqueueScanTask).toHaveBeenCalledWith({
      org_id: '6650f1a2b3c4d5e6f7a8b9c0',
      website_url: 'https://example.com',
    });
  });

  test('POST /start_scan reuses an in-progress org instead of duplicating', async () => {
    vi.mocked(OrgRepo.create).mockClear();
    vi.mocked(OrgRepo.findActiveByUserAndUrl).mockResolvedValueOnce({
      id: 'existing_org_id',
      user_id: 'user_1',
      website_url: 'https://example.com',
      setup_status: 'setup_scan_in_progress',
      plan: 'free',
      strategy_status: 'none',
      created_at: new Date(),
    });

    const res = await client.api.v0.setup.start_scan.$post(
      { json: { website_url: 'https://example.com' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.org_id).toBe('existing_org_id');
    expect(json.setup_status).toBe('setup_scan_in_progress');

    // No new org created; the existing one is re-armed and re-enqueued.
    expect(OrgRepo.create).not.toHaveBeenCalled();
    expect(OrgRepo.updateStatus).toHaveBeenCalledWith('existing_org_id', 'setup_scan_in_progress');
    expect(enqueueScanTask).toHaveBeenCalledWith({
      org_id: 'existing_org_id',
      website_url: 'https://example.com',
    });
  });

  test('GET /status returns the org status', async () => {
    const res = await client.api.v0.setup.status.$get({
      query: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.setup_status).toBe('setup_scan_completed');
  });

  test('GET /status falls back to not_started for unknown org', async () => {
    const res = await client.api.v0.setup.status.$get({ query: { org_id: 'nope' } });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.setup_status).toBe('setup_not_started');
  });

  test('GET /details requires auth', async () => {
    const res = await client.api.v0.setup.details.$get({
      query: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' },
    });
    expect(res.status).toBe(401);
  });

  test('GET /details returns generated presets for a completed org', async () => {
    const res = await client.api.v0.setup.details.$get(
      { query: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.business.name).toBe('Example Co');
    expect(json.presets.audience.competitors).toEqual(['acme.com']);
  });

  test('GET /details returns 404 when presets are not generated yet', async () => {
    const res = await client.api.v0.setup.details.$get(
      { query: { org_id: 'no_presets' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('GET /details returns 404 for an unknown org', async () => {
    const res = await client.api.v0.setup.details.$get(
      { query: { org_id: 'nope' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('GET /details returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.details.$get(
      { query: { org_id: 'other_users_org' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /presets requires auth', async () => {
    const res = await client.api.v0.setup.presets.$patch({
      json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0', presets: { business: { name: 'New' } } },
    });
    expect(res.status).toBe(401);
  });

  test('PATCH /presets merges a partial edit and returns full presets', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { business: { name: 'Renamed Co' } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.business.name).toBe('Renamed Co');
    expect(json.presets.business.language).toBe('English'); // sibling preserved
    expect(OrgRepo.updatePresets).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({
        business: expect.objectContaining({ name: 'Renamed Co', language: 'English' }),
      }),
    );
  });

  test('PATCH /presets replaces the audience target array wholesale (no join)', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { audience: { target: ['Desalination plant operators', 'Utility managers'] } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.audience.target).toEqual([
      'Desalination plant operators',
      'Utility managers',
    ]);
    expect(OrgRepo.updatePresets).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({
        audience: expect.objectContaining({
          target: ['Desalination plant operators', 'Utility managers'],
        }),
      }),
    );
  });

  test('PATCH /presets persists a disabled CTA preference and preserves engagement siblings', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { article_preferences: { engagement: { include_cta: false } } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const engagement = (await res.json()).presets.article_preferences.engagement;
    expect(engagement.include_cta).toBe(false);
    expect(engagement.image_direction.medium).toBe('photograph');
    expect(engagement.youtube_videos).toBe(true);
  });

  test('PATCH /presets returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      { json: { org_id: 'other_users_org', presets: { business: { name: 'Hijack' } } } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /presets returns 409 when scan is not yet completed', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      { json: { org_id: 'no_presets', presets: { business: { name: 'Early' } } } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(409);
  });

  test('POST /finalize requires auth', async () => {
    const res = await client.api.v0.setup.finalize.$post({
      json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' },
    });
    expect(res.status).toBe(401);
  });

  test('POST /finalize flips status to setup_complete without edits', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.setup_status).toBe('setup_complete');
    expect(json.presets.business.name).toBe('Example Co');
    expect(OrgRepo.finalize).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({ business: expect.objectContaining({ name: 'Example Co' }) }),
    );
  });

  test('POST /finalize applies a final edit then flips status', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { business: { name: 'Final Co' } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.business.name).toBe('Final Co');
    expect(OrgRepo.finalize).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({ business: expect.objectContaining({ name: 'Final Co' }) }),
    );
  });

  test('POST /finalize returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: 'other_users_org' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('POST /finalize returns 409 when already complete', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: 'already_complete' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(409);
  });

  test('finalize persists referral_source + integrations onto onboarding', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          referral_source: 'LinkedIn',
          integrations: ['wordpress'],
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    expect(OrgRepo.finalize).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', expect.any(Object), {
      referral_source: 'LinkedIn',
      integrations: ['wordpress'],
    });
  });

  test('finalize rejects an unknown integration id', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      // @ts-expect-error — 'wix' is not a valid ONBOARDING_INTEGRATIONS member
      { json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0', integrations: ['wix'] } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(400);
  });

  test('GET /health returns OK', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});

describe('POST /finalize strategy trigger', () => {
  beforeEach(() => {
    launchStrategy.mockClear();
  });

  test('paid org: claims and launches exactly one strategy run', async () => {
    const res = await finalize('paid_ready');
    expect(res.status).toBe(200);
    expect(launchStrategy).toHaveBeenCalledTimes(1);
    expect(launchStrategy).toHaveBeenCalledWith('paid_ready');
  });

  test('free org: does not launch', async () => {
    const res = await finalize('6650f1a2b3c4d5e6f7a8b9c0');
    expect(res.status).toBe(200);
    expect(launchStrategy).not.toHaveBeenCalled();
  });

  test('paid org, claim lost: does not launch', async () => {
    vi.mocked(OrgRepo.claimStrategy).mockResolvedValueOnce(false);
    const res = await finalize('paid_ready');
    expect(res.status).toBe(200);
    expect(launchStrategy).not.toHaveBeenCalled();
  });
});
