import { describe, expect, test } from 'vitest';
import {
  aggregateTotals,
  analyticsWindows,
  articlePublishedAt,
  buildSeries,
  computeDeltas,
  daysLive,
  splitByWindow,
  trendFor,
} from '../src/lib/gsc-analytics';

const row = (date: string, clicks: number, impressions: number, position: number) => ({
  keys: [date],
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position,
});

describe('analyticsWindows', () => {
  const now = new Date('2026-08-11T10:30:00Z');

  test('endDate is today − 3 days (GSC lag), 7d spans a 2× window', () => {
    const w = analyticsWindows('7d', now);
    expect(w.endDate).toBe('2026-08-08');
    expect(w.currentStartDate).toBe('2026-08-02'); // end − 6 days: 7-day current half
    expect(w.priorEndDate).toBe('2026-08-01');
    expect(w.priorStartDate).toBe('2026-07-26'); // 7-day prior half
    expect(w.startDate).toBe(w.priorStartDate);
  });

  test('30d and 90d halves are contiguous and equal-length', () => {
    for (const range of ['30d', '90d'] as const) {
      const w = analyticsWindows(range, now);
      const days = range === '30d' ? 30 : 90;
      const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
      const DAY = 24 * 60 * 60 * 1000;
      expect(ms(w.endDate) - ms(w.currentStartDate)).toBe((days - 1) * DAY);
      expect(ms(w.priorEndDate) - ms(w.priorStartDate)).toBe((days - 1) * DAY);
      expect(ms(w.currentStartDate) - ms(w.priorEndDate)).toBe(DAY);
    }
  });
});

describe('aggregateTotals', () => {
  test('sums clicks/impressions; ctr and position are impression-weighted', () => {
    const totals = aggregateTotals([
      row('2026-08-01', 10, 100, 2), // ctr .1
      row('2026-08-02', 0, 300, 10), // ctr 0
    ]);
    expect(totals.clicks).toBe(10);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(10 / 400); // NOT the row average (.05)
    expect(totals.position).toBeCloseTo((2 * 100 + 10 * 300) / 400); // 8, not 6
  });

  test('empty rows → all zeros', () => {
    expect(aggregateTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });
});

describe('computeDeltas', () => {
  test('percent change for clicks/impressions/ctr, absolute for position', () => {
    const d = computeDeltas(
      { clicks: 120, impressions: 2000, ctr: 0.06, position: 5 },
      { clicks: 100, impressions: 1000, ctr: 0.1, position: 8 },
    );
    expect(d.clicks).toBeCloseTo(0.2);
    expect(d.impressions).toBeCloseTo(1);
    expect(d.ctr).toBeCloseTo(-0.4);
    expect(d.position).toBe(-3); // absolute, improvement is negative
  });

  test('null deltas when the prior value is 0; position null when either half has no impressions', () => {
    const d = computeDeltas(
      { clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
      { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    );
    expect(d).toEqual({ clicks: null, impressions: null, ctr: null, position: null });
    const d2 = computeDeltas(
      { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      { clicks: 5, impressions: 100, ctr: 0.05, position: 4 },
    );
    expect(d2.position).toBeNull();
  });
});

describe('splitByWindow', () => {
  test('rows on/after currentStartDate are current, the rest prior', () => {
    const rows = [
      row('2026-08-01', 1, 10, 1),
      row('2026-08-02', 2, 20, 2),
      row('2026-07-30', 3, 30, 3),
    ];
    const { current, prior } = splitByWindow(rows, '2026-08-02');
    expect(current.map((r) => r.keys[0])).toEqual(['2026-08-02']);
    expect(prior.map((r) => r.keys[0])).toEqual(['2026-08-01', '2026-07-30']);
  });
});

describe('buildSeries', () => {
  test('groups rows by date ascending with weighted aggregates per date', () => {
    const series = buildSeries([
      {
        keys: ['2026-08-02', 'https://x.com/b'],
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 10,
      },
      {
        keys: ['2026-08-01', 'https://x.com/a'],
        clicks: 2,
        impressions: 100,
        ctr: 0.02,
        position: 4,
      },
      {
        keys: ['2026-08-02', 'https://x.com/a'],
        clicks: 3,
        impressions: 300,
        ctr: 0.01,
        position: 2,
      },
    ]);
    expect(series.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-02']);
    expect(series[1]).toEqual({
      date: '2026-08-02',
      clicks: 4,
      impressions: 400,
      ctr: 4 / 400,
      position: (10 * 100 + 2 * 300) / 400,
    });
  });
});

describe('daysLive / articlePublishedAt', () => {
  test('whole days, floored, UTC', () => {
    const now = new Date('2026-08-11T00:30:00Z');
    expect(daysLive(new Date('2026-08-10T23:00:00Z'), now)).toBe(0);
    expect(daysLive(new Date('2026-08-01T00:30:00Z'), now)).toBe(10);
  });

  test('articlePublishedAt is the earliest of published_at and publication dates', () => {
    const early = new Date('2026-07-01T00:00:00Z');
    const later = new Date('2026-07-05T00:00:00Z');
    expect(
      articlePublishedAt({
        published_at: later,
        publications: [
          { provider: 'wordpress', ref: '1', slug: 's', published_at: early, updated_at: null },
        ],
      }),
    ).toEqual(early);
    expect(articlePublishedAt({ published_at: null, publications: [] })).toBeNull();
  });
});

describe('trendFor', () => {
  test('±10% boundaries are inclusive', () => {
    expect(trendFor(110, 100, 30)).toBe('up');
    expect(trendFor(90, 100, 30)).toBe('down');
    expect(trendFor(109, 100, 30)).toBe('flat');
    expect(trendFor(91, 100, 30)).toBe('flat');
  });

  test('null when under 14 days live or prior clicks are 0', () => {
    expect(trendFor(200, 100, 13)).toBeNull();
    expect(trendFor(200, 0, 30)).toBeNull();
    expect(trendFor(110, 100, 14)).toBe('up');
  });
});
