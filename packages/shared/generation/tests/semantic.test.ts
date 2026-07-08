import { describe, expect, test } from 'vitest';
import { buildSemanticCheckPrompt, parseSemanticResult } from '../src/semantic';
import type { GenerationContext } from '../src/types';

const ctx = {
  businessName: 'Acme',
  competitors: ['rival.com'],
  keyword: 'best widgets',
  language: 'English',
} as GenerationContext;

describe('semantic check', () => {
  test('prompt names competitors, keyword, language, and the JSON contract', () => {
    const joined = buildSemanticCheckPrompt(ctx, '# Article\n\nbody')
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('rival.com');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined).toContain('pass');
  });

  test('parseSemanticResult parses pass/fail with defaulted reasons', () => {
    expect(parseSemanticResult('{"pass":true}')).toEqual({ pass: true, reasons: [] });
    expect(
      parseSemanticResult('```json\n{"pass":false,"reasons":["promotes rival"]}\n```'),
    ).toEqual({
      pass: false,
      reasons: ['promotes rival'],
    });
  });
});
