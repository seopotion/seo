import { describe, expect, test } from 'vitest';
import { GenerateTask, KeywordSchema } from '../src';

describe('generation schema additions', () => {
  test('KeywordSchema defaults generation fields for pre-existing docs', () => {
    const k = KeywordSchema.parse({
      id: 'k1',
      org_id: 'o1',
      keyword: 'seo tips',
      status: 'scheduled',
      scheduled_date: '2026-07-08',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
      created_at: new Date(),
    });
    expect(k.generation_status).toBe('pending');
    expect(k.generation_attempts).toBe(0);
    expect(k.generation_error).toBeNull();
    expect(k.generation_started_at).toBeNull();
  });

  test('GenerateTask parses the queue contract', () => {
    expect(GenerateTask.parse({ org_id: 'o1', keyword_id: 'k1' })).toEqual({
      org_id: 'o1',
      keyword_id: 'k1',
    });
  });
});
