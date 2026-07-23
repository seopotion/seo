import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { UserRepo } from '../src/repositories/user.repo';

/**
 * Real-MongoDB round-trip for UserRepo. Run with `npm run test:integration`
 * after `docker compose up -d mongo`.
 */
describe('UserRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('users').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('findByEmail returns the matching user', async () => {
    await UserRepo.upsertByGoogleSub({ google_sub: 'sub_1', email: 'dev@example.com' });

    const found = await UserRepo.findByEmail('dev@example.com');
    expect(found?.google_sub).toBe('sub_1');
  });

  test('findByEmail returns null when no user matches', async () => {
    expect(await UserRepo.findByEmail('nobody@example.com')).toBeNull();
  });

  test('deleteById removes the user; invalid/unknown ids return false', async () => {
    const user = await UserRepo.upsertByGoogleSub({
      google_sub: 'sub_2',
      email: 'del@example.com',
    });
    expect(await UserRepo.deleteById(user.id)).toBe(true);
    expect(await UserRepo.findByEmail('del@example.com')).toBeNull();
    expect(await UserRepo.deleteById(user.id)).toBe(false);
    expect(await UserRepo.deleteById('not-an-object-id')).toBe(false);
  });
});
