import { z } from 'zod';

/** User entity. Identified by their Google subject id (`google_sub`). */
export const UserSchema = z.object({
  id: z.string(),
  google_sub: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  created_at: z.date(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserInput = UserSchema.omit({ id: true, created_at: true });
export type CreateUserInput = z.infer<typeof CreateUserInput>;
