import { describe, expect, test, vi } from 'vitest';

// Spy on the SQS enqueue (hoisted so the vi.mock factory can reference it).
const { enqueueScanTask } = vi.hoisted(() => ({ enqueueScanTask: vi.fn(async () => {}) }));
vi.mock('../src/clients/sqs', () => ({ enqueueScanTask }));

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
    findById: vi.fn(async (id: string) =>
      id === '6650f1a2b3c4d5e6f7a8b9c0'
        ? {
            id,
            website_url: 'https://example.com',
            setup_status: 'setup_scan_completed',
            created_at: new Date(),
          }
        : null,
    ),
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

  test('GET /health returns OK', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });
});
