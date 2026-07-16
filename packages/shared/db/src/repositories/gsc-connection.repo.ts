import { type GscConnection, GscConnectionSchema } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('gsc_connections');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): GscConnection {
  const { _id, ...rest } = doc;
  return GscConnectionSchema.parse({ id: _id.toString(), ...rest });
}

export const GscConnectionRepo = {
  async findByOrgId(orgId: string): Promise<GscConnection | null> {
    const doc = await (await collection()).findOne({ org_id: orgId });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Store a freshly exchanged (encrypted) refresh token, resetting the row to
   * the "property not yet chosen" state. Upsert: reconnecting replaces the old
   * token and clears any standing refresh failure.
   */
  async upsertToken(orgId: string, refreshTokenEnc: string, googleEmail: string): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId },
      {
        $set: {
          refresh_token_enc: refreshTokenEnc,
          google_email: googleEmail,
          site_url: null,
          connected_at: new Date(),
          last_refresh_failed_at: null,
        },
      },
      { upsert: true },
    );
  },

  /** Finalize the connection with the user-chosen GSC property. */
  async setSiteUrl(orgId: string, siteUrl: string): Promise<void> {
    await (await collection()).updateOne({ org_id: orgId }, { $set: { site_url: siteUrl } });
  },

  /** Record a failed token refresh (revoked access) — closes the gate. */
  async markRefreshFailed(orgId: string): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId },
      { $set: { last_refresh_failed_at: new Date() } },
    );
  },

  /** Disconnect (used by DELETE /dashboard/gsc). Returns true when a row matched. */
  async deleteByOrgId(orgId: string): Promise<boolean> {
    const res = await (await collection()).deleteOne({ org_id: orgId });
    return res.deletedCount === 1;
  },
};
