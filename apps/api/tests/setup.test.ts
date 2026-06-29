import { describe, expect, test, vi } from 'vitest';

// Spy on the SQS enqueue (hoisted so the vi.mock factory can reference it).
const { enqueueScanTask } = vi.hoisted(() => ({ enqueueScanTask: vi.fn(async () => {}) }));
vi.mock('../src/clients/sqs', () => ({ enqueueScanTask }));

// A fully-populated presets object (matches SetupPresetsSchema) for the
// completed org, so `/details` has something to return.
const presetsFixture = {
  business: {
    name: 'Example Co',
    language: 'English',
    country: 'Global (English)',
    description: 'An example business.',
  },
  audience: { target: 'Developers', competitors: ['acme.com'] },
  blog: {
    sitemap_url: 'https://example.com/sitemap.xml',
    main_blog_url: 'https://example.com/blog',
    best_articles: ['https://example.com/blog/post-1'],
  },
  article_preferences: {
    content_seo: { article_style: 'Conversational', internal_links: true, llm_instructions: '' },
    engagement: { image_style: 'Minimal' },
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
    findById: vi.fn(async (id: string) => {
      // Completed org with presets ready.
      if (id === '6650f1a2b3c4d5e6f7a8b9c0') {
        return {
          id,
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // Completed org whose scan hasn't produced presets yet.
      if (id === 'no_presets') {
        return {
          id,
          website_url: 'https://example.com',
          setup_status: 'setup_scan_in_progress',
          created_at: new Date(),
        };
      }
      return null;
    }),
  },
}));

import { testClient } from 'hono/testing';
import { signToken } from '../src/auth/jwt';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

async function authHeader() {
  const token = await signToken({ sub: 'user_1', email: 'u@example.com' });
  return { Authorization: `Bearer ${token}` };
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

  test('GET /health returns OK', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});
