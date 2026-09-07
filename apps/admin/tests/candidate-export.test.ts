import { describe, expect, test } from 'vitest';
import { CANDIDATE_EXPORT_HEADERS, candidatesToCsv } from '../src/lib/candidate-export';
import type { CandidateItem } from '../src/lib/queries';

const candidate: CandidateItem = {
  id: 'candidate-1',
  keyword: 'seo, "tools"',
  source: 'keyword_ideas',
  status: 'candidate',
  search_volume: 1200,
  difficulty: 42,
  cpc: 3.75,
  competition: 0.62,
  trend: 11,
  intent: 'commercial',
  article_type: 'listicle',
  opportunity_score: 87,
  relevance_score: 91,
  schedulable: true,
  rejection_reason: null,
  serp_competitors: [
    {
      rank: 1,
      domain: 'example.com',
      url: 'https://example.com/a,b',
      title: 'The "best" tools',
    },
  ],
  created_at: '2026-09-07T12:00:00.000Z',
};

describe('candidatesToCsv', () => {
  test('exports every candidate field and full SERP details', () => {
    const csv = candidatesToCsv([candidate]);
    const [header, row] = csv.split('\r\n');

    expect(header).toBe(CANDIDATE_EXPORT_HEADERS.join(','));
    expect(row).toContain('1200,42,3.75,0.62,11');
    expect(row).toContain('commercial,listicle,87,91,true');
    expect(row).toContain('1,1,example.com');
    expect(row).toContain('"https://example.com/a,b"');
    expect(row).toContain('"The ""best"" tools"');
  });

  test('escapes commas and quotes and leaves missing metrics blank', () => {
    const csv = candidatesToCsv([
      {
        ...candidate,
        keyword: 'seo, "tools"',
        search_volume: null,
        difficulty: null,
        serp_competitors: null,
      },
    ]);
    const row = csv.split('\r\n')[1];

    expect(row?.startsWith('candidate-1,"seo, ""tools""",keyword_ideas,candidate,,,')).toBe(true);
    expect(row).toContain(',0,,,,,2026-09-07T12:00:00.000Z');
  });
});
