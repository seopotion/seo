import type { SetupPresets } from '@shared/schemas';
import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// vi.hoisted runs with the hoisted vi.mock factory, so the spy is initialized
// before the factory references it.
const { completeScan, updateDomainRating, updateStatus } = vi.hoisted(() => ({
  completeScan: vi.fn(async (_id: string, _presets: SetupPresets) => {}),
  updateDomainRating: vi.fn(async (_id: string, _value: number) => {}),
  updateStatus: vi.fn(async (_id: string, _status: string) => {}),
}));

vi.mock('@shared/db', () => ({
  OrgRepo: { completeScan, updateDomainRating, updateStatus },
}));

const { scanWebsite } = vi.hoisted(() => ({
  scanWebsite: vi.fn(async () => ({
    business: {
      name: 'Clewas',
      language: 'English',
      country: 'Global (English)',
      description: 'desc',
    },
    audience: { target: ['devs'], competitors: [] },
    blog: { sitemap_url: 's', main_blog_url: 'b', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'x',
        internal_links_count: 1,
        table_of_contents: true,
        llm_instructions: 'y',
      },
      engagement: {
        image_direction: { medium: 'photograph', palette: '', notes: '' },
        include_cta: true,
        youtube_videos: true,
      },
      publishing: { auto_publish: false },
    },
  })),
}));
vi.mock('../src/scanner', () => ({ scanWebsite }));

const { backlinksSummary } = vi.hoisted(() => ({
  backlinksSummary: vi.fn(async (_target: string) => ({ rank: 423 })),
}));
vi.mock('../src/providers', () => ({
  getScanClients: () => ({ llm: {}, dataForSeo: { backlinksSummary } }),
}));

import { handler } from '../src/index';

function sqsEvent(body: unknown, receiveCount?: number): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: (receiveCount === undefined
          ? {}
          : { ApproximateReceiveCount: String(receiveCount) }) as never,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stores scan presets and completes the scan for the org', async () => {
    await handler(
      sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://clewas.com' }),
      {} as never,
      () => {},
    );

    expect(completeScan).toHaveBeenCalledTimes(1);
    const [orgId, presets] = completeScan.mock.calls[0] ?? [];
    expect(orgId).toBe('6650f1a2b3c4d5e6f7a8b9c0');
    expect(presets?.business.name).toBe('Clewas');
    expect(presets?.audience.competitors).toEqual([]);
  });

  test('stamps the domain rating after a successful scan', async () => {
    await handler(
      sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://www.clewas.com' }),
      {} as never,
      () => {},
    );

    expect(backlinksSummary).toHaveBeenCalledWith('clewas.com');
    expect(updateDomainRating).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 42);
  });

  test('a domain-rating failure never fails the scan', async () => {
    backlinksSummary.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      handler(
        sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://clewas.com' }),
        {} as never,
        () => {},
      ),
    ).resolves.toBeUndefined();

    expect(completeScan).toHaveBeenCalled();
    expect(updateDomainRating).not.toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.anything(),
    );
  });

  // #244: nothing used to touch the org on failure, so after the message
  // dead-lettered it polled as in-progress forever.
  describe('scan failure', () => {
    const task = { org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://clewas.com' };

    test('an early delivery rethrows without stamping (redelivery may recover)', async () => {
      scanWebsite.mockRejectedValueOnce(new Error('scrape timeout'));

      await expect(handler(sqsEvent(task, 1), {} as never, () => {})).rejects.toThrow(
        'scrape timeout',
      );

      expect(updateStatus).not.toHaveBeenCalled();
    });

    test('the last delivery stamps setup_scan_failed and still rethrows', async () => {
      scanWebsite.mockRejectedValueOnce(new Error('scrape timeout'));

      await expect(handler(sqsEvent(task, 3), {} as never, () => {})).rejects.toThrow(
        'scrape timeout',
      );

      expect(updateStatus).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 'setup_scan_failed');
    });

    test('an unknown receive count is treated as final', async () => {
      scanWebsite.mockRejectedValueOnce(new Error('scrape timeout'));

      await expect(handler(sqsEvent(task), {} as never, () => {})).rejects.toThrow();

      expect(updateStatus).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 'setup_scan_failed');
    });

    test('a body that fails ScanTask.parse still stamps the org it names', async () => {
      await expect(
        handler(sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0' }, 3), {} as never, () => {}),
      ).rejects.toThrow();

      expect(updateStatus).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 'setup_scan_failed');
    });

    test('a stamp failure does not mask the scan error', async () => {
      scanWebsite.mockRejectedValueOnce(new Error('scrape timeout'));
      updateStatus.mockRejectedValueOnce(new Error('mongo down'));

      await expect(handler(sqsEvent(task, 3), {} as never, () => {})).rejects.toThrow(
        'scrape timeout',
      );
    });
  });
});
