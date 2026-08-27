import { describe, expect, test } from 'vitest';
import { FLESCH_KINCAID_TARGET, fleschKincaidGrade } from '../src';

describe('fleschKincaidGrade', () => {
  test('scores simple prose at or below the target', () => {
    const score = fleschKincaidGrade(
      'The cat sat on the mat. It saw a red bird. The bird flew away.',
    );

    expect(score).not.toBeNull();
    expect(score).toBeLessThanOrEqual(FLESCH_KINCAID_TARGET);
  });

  test('scores complex prose above the target', () => {
    const score = fleschKincaidGrade(
      'Interdisciplinary collaboration necessitates comprehensive evaluation of institutional methodologies. Consequently, administrators must systematically reconsider organizational responsibilities.',
    );

    expect(score).not.toBeNull();
    expect(score).toBeGreaterThan(FLESCH_KINCAID_TARGET);
  });

  test('gives equivalent plain text and Markdown the same score', () => {
    const plain = 'Clear guides help readers. Follow each step with care.';
    const markdown =
      '**Clear** guides help [readers](https://example.com). Follow each step with care.';

    expect(fleschKincaidGrade(markdown)).toBe(fleschKincaidGrade(plain));
  });

  test('ignores URLs and code', () => {
    const plain = 'Dogs like daily walks. They need fresh water each day.';
    const markdown = `${plain}\n\nhttps://example.com/a-long-technical-path\n\n\`const complicatedValue = calculate();\`\n\n\`\`\`ts\nfunction calculateComplexity() { return 42; }\n\`\`\``;

    expect(fleschKincaidGrade(markdown)).toBe(fleschKincaidGrade(plain));
  });

  test('treats headings and list items as separate sentences', () => {
    const plain = 'Steps. Pick a clear goal. Write a short plan. Test each step.';
    const markdown = '# Steps\n\n- Pick a clear goal\n- Write a short plan\n- Test each step';

    expect(fleschKincaidGrade(markdown)).toBe(fleschKincaidGrade(plain));
  });

  test('returns null for empty or unusable input', () => {
    expect(fleschKincaidGrade('')).toBeNull();
    expect(
      fleschKincaidGrade('![chart](chart.png)\n\nhttps://example.com\n\n```ts\nconst x = 1;\n```'),
    ).toBeNull();
  });
});
