import type { SQSEvent } from 'aws-lambda';
import { describe, expect, test, vi } from 'vitest';

// vi.hoisted runs with the hoisted vi.mock factory, so the spy is initialized
// before the factory references it.
const { updateStatus } = vi.hoisted(() => ({ updateStatus: vi.fn(async () => {}) }));

vi.mock('@shared/db', () => ({
  OrgRepo: { updateStatus },
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
  test('advances the org to setup_scan_completed', async () => {
    await handler(
      sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://example.com' }),
      {} as never,
      () => {},
    );

    expect(updateStatus).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 'setup_scan_completed');
  });
});
