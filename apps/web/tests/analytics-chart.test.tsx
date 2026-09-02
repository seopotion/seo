import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, test, vi } from 'vitest';
import AnalyticsChart from '../app/[locale]/(authenticated)/(product)/analytics/_components/AnalyticsChart';
import messages from '../messages/en.json';

/**
 * Recharts takes colours as props, not classes, so this is the one surface the
 * token migration could not reach with a grep (#297). Pin that every colour the
 * chart hands to the SVG is a `var(--…)` token, never a literal.
 *
 * `ResponsiveContainer` measures with ResizeObserver, which jsdom lacks; give the
 * chart a fixed box instead. Everything under it is the real recharts.
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ height?: number; width?: number }>;
    }) => (
      <div style={{ height: 320, width: 800 }}>
        {cloneElement(children, { height: 320, width: 800 })}
      </div>
    ),
  };
});

const series = [
  { clicks: 12, ctr: 0.04, date: '2026-09-01', impressions: 300, position: 8.2 },
  { clicks: 18, ctr: 0.05, date: '2026-09-02', impressions: 360, position: 7.9 },
  { clicks: 15, ctr: 0.045, date: '2026-09-03', impressions: 330, position: 8.0 },
];

function renderChart(allowMetricToggle = false) {
  const user = userEvent.setup();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AnalyticsChart allowMetricToggle={allowMetricToggle} series={series} />
    </NextIntlClientProvider>,
  );
  return { user, ...utils };
}

const HEX = /#[0-9a-f]{3,8}\b/i;

/** Every colour-bearing value in the rendered chart: SVG paint attributes plus inline styles. */
function paintValues(container: HTMLElement): string[] {
  const values: string[] = [];
  for (const element of container.querySelectorAll<HTMLElement | SVGElement>('*')) {
    for (const attribute of ['stroke', 'fill', 'color']) {
      const value = element.getAttribute(attribute);
      if (value) values.push(`${attribute}=${value}`);
    }
    const style = element.getAttribute('style');
    if (style) values.push(`style=${style}`);
  }
  return values;
}

describe('chart colours come from the token layer', () => {
  test('traffic mode paints with tokens only', () => {
    const { container } = renderChart();

    const paints = paintValues(container);
    expect(paints.length).toBeGreaterThan(0);
    expect(paints.filter((value) => HEX.test(value))).toEqual([]);
    expect(paints).toContain('stroke=var(--chart-1)');
    expect(paints).toContain('stroke=var(--chart-2)');
    expect(paints).toContain('stroke=var(--border)');
    expect(paints).toContain('fill=var(--muted-foreground)');
  });

  test('search-metrics mode paints with tokens only', async () => {
    const { container, user } = renderChart(true);

    await user.click(container.ownerDocument.querySelector('[aria-pressed="false"]') as Element);

    const paints = paintValues(container);
    expect(paints.filter((value) => HEX.test(value))).toEqual([]);
    expect(paints).toContain('stroke=var(--chart-1)');
    expect(paints).toContain('stroke=var(--chart-3)');
  });
});
