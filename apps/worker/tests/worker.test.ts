import type { SetupPresets } from '@shared/schemas';
import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// vi.hoisted runs with the hoisted vi.mock factory, so the spy is initialized
// before the factory references it.
const { completeScan, updateDomainRating } = vi.hoisted(() => ({
  completeScan: vi.fn(async (_id: string, _presets: SetupPresets) => {}),
  updateDomainRating: vi.fn(async (_id: string, _value: number) => {}),
}));

vi.mock('@shared/db', () => ({
  OrgRepo: { completeScan, updateDomainRating },
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
});
