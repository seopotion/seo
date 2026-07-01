import { afterEach, describe, expect, test, vi } from 'vitest';

// Hoisted handles the mock factories reference.
const { ping, closeDb, sqsSend } = vi.hoisted(() => ({
  ping: vi.fn(async () => ({ ok: 1 })),
  closeDb: vi.fn(async () => {}),
  sqsSend: vi.fn(async () => ({})),
}));

vi.mock('@shared/db', () => ({
  getDb: vi.fn(async () => ({ command: ping })),
  closeDb,
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  // biome-ignore lint/complexity/useArrowFunction: regular function required — arrow fns are not constructors
  SQSClient: vi.fn(function () {
    return { send: sqsSend, destroy: vi.fn() };
  }),
  // biome-ignore lint/complexity/useArrowFunction: regular function required — arrow fns are not constructors
  GetQueueAttributesCommand: vi.fn(function (input: unknown) {
    return input;
  }),
}));

import { checkInfra } from '../src/lib/infra';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.SCAN_QUEUE_URL = 'http://localhost:9324/queue/scan';
});

describe('checkInfra', () => {
  test('reports all services healthy when every check succeeds', async () => {
    process.env.SCAN_QUEUE_URL = 'http://localhost:9324/queue/scan';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 })),
    );

    const res = await checkInfra();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.allHealthy).toBe(true);
    expect(res.data.services.map((s) => s.service).sort()).toEqual(['api', 'mongo', 'sqs']);
  });

  test('marks mongo down when ping throws, allHealthy false', async () => {
    ping.mockRejectedValueOnce(new Error('conn refused'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 })),
    );

    const res = await checkInfra(['mongo']);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.allHealthy).toBe(false);
    expect(res.data.services).toHaveLength(1);
    expect(res.data.services[0]).toMatchObject({ service: 'mongo', available: false });
  });

  test('only runs the requested services', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    const res = await checkInfra(['api']);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.services.map((s) => s.service)).toEqual(['api']);
    expect(ping).not.toHaveBeenCalled();
  });

  test('marks sqs down with SCAN_QUEUE_URL not set message when env var is missing', async () => {
    delete process.env.SCAN_QUEUE_URL;
    const res = await checkInfra(['sqs']);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.services[0]).toMatchObject({
      service: 'sqs',
      available: false,
      error: 'SCAN_QUEUE_URL not set',
    });
  });
});
