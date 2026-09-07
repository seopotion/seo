import type { CandidateItem } from './queries';

export const CANDIDATE_EXPORT_HEADERS = [
  'id',
  'keyword',
  'source',
  'status',
  'search_volume',
  'difficulty',
  'cpc',
  'competition',
  'trend',
  'intent',
  'article_type',
  'opportunity_score',
  'relevance_score',
  'schedulable',
  'rejection_reason',
  'serp_competitor_count',
  'serp_competitor_ranks',
  'serp_competitor_domains',
  'serp_competitor_urls',
  'serp_competitor_titles',
  'created_at',
] as const;

type CsvValue = string | number | boolean | null | undefined;

export function candidatesToCsv(candidates: CandidateItem[]): string {
  const rows: CsvValue[][] = candidates.map((candidate) => {
    const competitors = candidate.serp_competitors ?? [];

    return [
      candidate.id,
      candidate.keyword,
      candidate.source,
      candidate.status,
      candidate.search_volume,
      candidate.difficulty,
      candidate.cpc,
      candidate.competition,
      candidate.trend,
      candidate.intent,
      candidate.article_type,
      candidate.opportunity_score,
      candidate.relevance_score,
      candidate.schedulable,
      candidate.rejection_reason,
      competitors.length,
      competitors.map((competitor) => competitor.rank ?? '').join(' | '),
      competitors.map((competitor) => competitor.domain).join(' | '),
      competitors.map((competitor) => competitor.url ?? '').join(' | '),
      competitors.map((competitor) => competitor.title ?? '').join(' | '),
      candidate.created_at,
    ];
  });

  return [CANDIDATE_EXPORT_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\r\n');
}

export function downloadCandidateCsv(candidates: CandidateItem[], filename: string): void {
  const blob = new Blob([`\uFEFF${candidatesToCsv(candidates)}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
