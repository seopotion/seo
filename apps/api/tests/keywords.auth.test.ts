import { describe, expect, test, vi } from 'vitest';

// Real authMiddleware (unlike keywords.test.ts): proves the keyword routes are
// actually protected, not just that handlers behave once auth is stubbed.
const { addCandidates, scheduleCandidate, CandidateRepo, KeywordRepo } = vi.hoisted(() => ({
  addCandidates: vi.fn(),
  scheduleCandidate: vi.fn(),
  CandidateRepo: { findById: vi.fn(), listByOrg: vi.fn(), releaseAfterUnschedule: vi.fn() },
  KeywordRepo: {
    findById: vi.fn(),
    findByOrgAndDate: vi.fn(),
    reschedulePending: vi.fn(),
    deleteUnstarted: vi.fn(),
  },
}));
vi.mock('@shared/db', () => ({ addCandidates, scheduleCandidate, CandidateRepo, KeywordRepo }));

vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ keywordIdeas: vi.fn(), bulkKeywordDifficulty: vi.fn() }),
}));

import app from '../src/routes/keywords';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('keyword routes require a bearer token', () => {
  test('POST /research without Authorization -> 401', async () => {
    const res = await post('/research', { org_id: 'o1', seed: 'crm' });
    expect(res.status).toBe(401);
  });

  test('POST /research with a malformed token -> 401', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const res = await post(
      '/research',
      { org_id: 'o1', seed: 'crm' },
      { Authorization: 'Bearer not-a-jwt' },
    );
    expect(res.status).toBe(401);
  });

  test('POST /candidates without Authorization -> 401', async () => {
    const res = await post('/candidates', { org_id: 'o1', keywords: [] });
    expect(res.status).toBe(401);
    expect(addCandidates).not.toHaveBeenCalled();
  });
});
