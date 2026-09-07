import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnv } from '../src/middlewares/auth';

const { findById, findUserById, members } = vi.hoisted(() => ({
  findById: vi.fn(),
  findUserById: vi.fn(),
  members: {
    listByOrgId: vi.fn(),
    findByOrgAndEmail: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  UserRepo: { findById: findUserById },
  OrgMemberRepo: members,
}));

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock('../src/clients/ses', () => ({ sendEmail }));

// Two callers: the owner and a teammate. Swap via `caller` before each request.
let caller = { userId: 'owner', email: 'owner@example.com' };
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', caller);
      await next();
    },
  };
});

import { OpenAPIHono } from '@hono/zod-openapi';
// Named `membersRouter` (not `members`) to avoid colliding with the
// `members` repo mock above, which the test bodies reference throughout.
import membersRouter from '../src/routes/members';

// Mount under a prefix so the typed client exposes `client.members.$get` etc.
const app = new OpenAPIHono().route('/members', membersRouter);
const client = testClient(app);
const now = new Date('2026-09-01T00:00:00.000Z');
const org = {
  id: 'o1',
  user_id: 'owner',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'free',
  strategy_status: 'none',
  created_at: now,
};
const mateRow = {
  id: 'm1',
  org_id: 'o1',
  email: 'mate@example.com',
  invited_by: 'owner',
  created_at: now,
};

beforeEach(() => {
  vi.clearAllMocks();
  caller = { userId: 'owner', email: 'owner@example.com' };
  findById.mockResolvedValue(org);
  findUserById.mockResolvedValue({
    id: 'owner',
    email: 'owner@example.com',
    google_sub: 'g',
    created_at: now,
  });
  members.listByOrgId.mockResolvedValue([mateRow]);
  // Owner never hits org_members; a teammate matches; anyone else does not.
  members.findByOrgAndEmail.mockImplementation(async (_org: string, email: string) =>
    email === 'mate@example.com' ? mateRow : null,
  );
});

describe('GET /core/members', () => {
  test('owner sees the roster, owner row first', async () => {
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        { email: 'owner@example.com', role: 'owner', created_at: now.toISOString() },
        { email: 'mate@example.com', role: 'member', created_at: now.toISOString() },
      ],
    });
  });

  test('a member sees the same roster', async () => {
    caller = { userId: 'mate', email: 'Mate@example.com' };
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect((await res.json()).members).toHaveLength(2);
    }
  });

  test('404 for a stranger', async () => {
    caller = { userId: 'x', email: 'x@example.com' };
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /core/members', () => {
  test('owner adds a member (201, lowercased)', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'New@Example.com' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      email: 'new@example.com',
      role: 'member',
      created_at: now.toISOString(),
    });
    expect(members.add).toHaveBeenCalledWith({
      org_id: 'o1',
      email: 'new@example.com',
      invited_by: 'owner',
    });
  });

  test('emails the new member, Reply-To the owner', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        replyTo: 'owner@example.com',
        subject: "You've been added to https://example.com on SEOPotion",
      }),
    );
  });

  test('still 201 when the email fails', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    sendEmail.mockRejectedValueOnce(new Error('MessageRejected'));
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      email: 'new@example.com',
      role: 'member',
      created_at: now.toISOString(),
    });
  });

  test('sends nothing on 409', async () => {
    members.add.mockResolvedValueOnce(null);
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('403 for a member', async () => {
    caller = { userId: 'mate', email: 'mate@example.com' };
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(403);
    expect(members.add).not.toHaveBeenCalled();
  });

  test("409 for the owner's own email", async () => {
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'Owner@example.com' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });
    expect(members.add).not.toHaveBeenCalled();
  });

  test('409 when the row already exists', async () => {
    members.add.mockResolvedValueOnce(null);
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(409);
  });

  test('404 for a stranger', async () => {
    caller = { userId: 'x', email: 'x@example.com' };
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /core/members', () => {
  test('owner removes a member', async () => {
    members.remove.mockResolvedValueOnce(true);
    const res = await client.members.$delete({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(members.remove).toHaveBeenCalledWith('o1', 'mate@example.com');
  });

  test('404 when no such member', async () => {
    members.remove.mockResolvedValueOnce(false);
    const res = await client.members.$delete({
      json: { org_id: 'o1', email: 'nobody@example.com' },
    });
    expect(res.status).toBe(404);
  });

  test('403 for a member', async () => {
    caller = { userId: 'mate', email: 'mate@example.com' };
    const res = await client.members.$delete({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(403);
    expect(members.remove).not.toHaveBeenCalled();
  });
});
