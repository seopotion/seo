import type { SetupPresets } from '@shared/schemas';
import type { SQSEvent } from 'aws-lambda';
import { describe, expect, test, vi } from 'vitest';

// vi.hoisted runs with the hoisted vi.mock factory, so the spy is initialized
// before the factory references it.
const { completeScan } = vi.hoisted(() => ({
  completeScan: vi.fn(async (_id: string, _presets: SetupPresets) => {}),
}));

vi.mock('@shared/db', () => ({
  OrgRepo: { completeScan },
}));

import { handler } from '../src/index';

function sqsEvent(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: {} as never,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

describe('scanner worker', () => {
  test('stores scan presets and completes the scan for the org', async () => {
    await handler(
      sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://clewas.com' }),
      {} as never,
      () => {},
    );

    expect(completeScan).toHaveBeenCalledTimes(1);
    const [orgId, presets] = completeScan.mock.calls[0] ?? [];
    expect(orgId).toBe('6650f1a2b3c4d5e6f7a8b9c0');
    expect(presets?.business.name).toBe('');
    expect(presets?.audience.competitors).toEqual([]);
  });
});
