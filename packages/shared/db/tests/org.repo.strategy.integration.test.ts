import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { getDb } from '../src/client';
import { OrgRepo } from '../src/repositories/org.repo';

async function seedOrg(strategy_status: string): Promise<string> {
  const res = await (await getDb()).collection('orgs').insertOne({
    user_id: 'u1',
    website_url: 'https://example.com',
    setup_status: 'setup_complete',
    plan: 'paid',
    strategy_status,
    created_at: new Date(),
  });
  return res.insertedId.toString();
}

describe('OrgRepo strategy claim', () => {
  beforeEach(async () => {
    await (await getDb()).collection('orgs').deleteMany({});
  });
  afterAll(async () => {
    await (await getDb()).collection('orgs').deleteMany({});
  });

  test('claimStrategy wins once from none, then loses', async () => {
    const id = await seedOrg('none');
    expect(await OrgRepo.claimStrategy(id)).toBe(true);
    expect(await OrgRepo.claimStrategy(id)).toBe(false);
    expect((await OrgRepo.findById(id))?.strategy_status).toBe('pending');
  });

  test('claimStrategy re-claims after failure', async () => {
    const id = await seedOrg('failed');
    expect(await OrgRepo.claimStrategy(id)).toBe(true);
  });

  test('setStrategyStatus updates the field', async () => {
    const id = await seedOrg('pending');
    await OrgRepo.setStrategyStatus(id, 'completed');
    expect((await OrgRepo.findById(id))?.strategy_status).toBe('completed');
  });
});
