import { z } from '@hono/zod-openapi';
import { ORG_ROLES } from '@shared/types';

const ORG_ID = z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' });

export const MembersQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const Member = z
  .object({
    email: z.string(),
    role: z.enum(ORG_ROLES),
    /** ISO timestamp: org creation for the owner, the add for a member. */
    created_at: z.string(),
  })
  .openapi('Member');
export type Member = z.infer<typeof Member>;

export const MembersResponse = z.object({ members: z.array(Member) }).openapi('MembersResponse');

export const MemberBody = z
  .object({
    org_id: ORG_ID,
    email: z.string().trim().email().max(254).openapi({ example: 'teammate@example.com' }),
  })
  .openapi('MemberBody');

export const AlreadyMemberResponse = z
  .object({ error: z.literal('already_member') })
  .openapi('AlreadyMemberResponse');

export const OwnerOnlyResponse = z
  .object({ error: z.literal('Owner only') })
  .openapi('MembersOwnerOnlyResponse');

export const NotFoundResponse = z
  .object({ error: z.literal('Not found') })
  .openapi('MembersNotFoundResponse');

export const RemovedResponse = z.object({ ok: z.literal(true) }).openapi('MemberRemovedResponse');
