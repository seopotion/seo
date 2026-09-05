import { z } from 'zod';

/**
 * A teammate on an org (#333). The owner is never a row here — ownership is
 * `orgs.user_id`. Membership is keyed by email, not user id, so an owner can
 * add someone before they have ever logged in; Google verifies the email at
 * login, which is what makes the match safe. Stored lowercased.
 */
export const OrgMemberSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  email: z.string().email(),
  /** User id of the owner who added the row. */
  invited_by: z.string(),
  created_at: z.date(),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const CreateOrgMemberInput = OrgMemberSchema.omit({ id: true, created_at: true });
export type CreateOrgMemberInput = z.infer<typeof CreateOrgMemberInput>;
