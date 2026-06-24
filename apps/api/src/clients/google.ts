import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';

const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
}

/** Verify a Google-issued ID token (from the frontend's Google sign-in). */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const ticket = await client.verifyIdToken({ idToken, audience: config.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Invalid Google ID token');
  }
  return { sub: payload.sub, email: payload.email, name: payload.name };
}
