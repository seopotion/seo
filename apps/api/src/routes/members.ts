import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { OrgMemberRepo, UserRepo } from '@shared/db';
import { loadOrgForUser } from '../lib/load-org-for-user';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/members';

/**
 * Org roster (#333). Reads are open to owner and members; add/remove are
 * owner-only. Membership is by email — no invite mail is sent; the teammate
 * simply logs in with Google using that address.
 */
const members = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'get',
      path: '/',
      summary: 'List the owner and members of an org',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.MembersQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.MembersResponse } },
          description: 'Owner first, then members oldest-first',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not accessible',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      const { org } = access;
      const [owner, rows] = await Promise.all([
        UserRepo.findById(org.user_id),
        OrgMemberRepo.listByOrgId(org.id),
      ]);
      const ownerRow = owner
        ? [{ email: owner.email, role: 'owner' as const, created_at: org.created_at.toISOString() }]
        : [];
      return c.json(
        {
          members: [
            ...ownerRow,
            ...rows.map((m) => ({
              email: m.email,
              role: 'member' as const,
              created_at: m.created_at.toISOString(),
            })),
          ],
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'post',
      path: '/',
      summary: 'Add a member by email (owner only)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.MemberBody } }, required: true },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: schemas.Member } },
          description: 'Member added',
        },
        403: {
          content: { 'application/json': { schema: schemas.OwnerOnlyResponse } },
          description: 'Caller is a member, not the owner',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not accessible',
        },
        409: {
          content: { 'application/json': { schema: schemas.AlreadyMemberResponse } },
          description: 'The email is the owner or already a member',
        },
      },
    }),
    async (c) => {
      const { org_id, email } = c.req.valid('json');
      const auth = c.get('auth');
      const access = await loadOrgForUser(org_id, auth);
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' as const }, 403);
      const normalized = email.toLowerCase();
      if (normalized === auth.email.toLowerCase()) {
        return c.json({ error: 'already_member' as const }, 409);
      }
      const row = await OrgMemberRepo.add({ org_id, email: normalized, invited_by: auth.userId });
      if (!row) return c.json({ error: 'already_member' as const }, 409);
      return c.json(
        { email: row.email, role: 'member' as const, created_at: row.created_at.toISOString() },
        201,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'delete',
      path: '/',
      summary: 'Remove a member (owner only)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.MemberBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.RemovedResponse } },
          description: 'Removed',
        },
        403: {
          content: { 'application/json': { schema: schemas.OwnerOnlyResponse } },
          description: 'Caller is a member, not the owner',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not accessible, or no such member',
        },
      },
    }),
    async (c) => {
      const { org_id, email } = c.req.valid('json');
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' as const }, 403);
      const removed = await OrgMemberRepo.remove(org_id, email);
      if (!removed) return c.json({ error: 'Not found' as const }, 404);
      return c.json({ ok: true as const }, 200);
    },
  );

export default members;
