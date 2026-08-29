import { type PromoRedemption, PromoRedemptionSchema } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('promo_redemptions');

function toEntity(doc: WithId<Document>): PromoRedemption {
  const { _id, ...rest } = doc;
  return PromoRedemptionSchema.parse({ id: _id.toString(), ...rest });
}

export const PromoRedemptionRepo = {
  /**
   * Record "a checkout was created with this code" — idempotent per
   * (code, org) so an abandoned checkout never burns the code for that org.
   * The `$ne: 'confirmed'` filter + unique index guarantee a confirmed row is
   * never demoted: the upsert then races into E11000, which is a no-op here.
   */
  async upsertPending(codeId: string, code: string, orgId: string): Promise<void> {
    try {
      await (await collection()).updateOne(
        { code_id: codeId, org_id: orgId, status: { $ne: 'confirmed' } },
        {
          $set: { status: 'pending', created_at: new Date() },
          $setOnInsert: { code_id: codeId, code, org_id: orgId },
        },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  },

  /**
   * Called by the billing applier on subscription_activated: the org's pending
   * redemptions become confirmed. Correlates by org, not by LS discount — the
   * accepted accuracy caveat in the design spec (§5). Returns the count.
   */
  async confirmPendingByOrg(orgId: string): Promise<number> {
    const res = await (await collection()).updateMany(
      { org_id: orgId, status: 'pending' },
      { $set: { status: 'confirmed', confirmed_at: new Date() } },
    );
    return res.modifiedCount;
  },

  /** Confirmed uses only — pending rows never count against max_redemptions. */
  async countConfirmed(codeId: string): Promise<number> {
    return (await collection()).countDocuments({ code_id: codeId, status: 'confirmed' });
  },

  async findConfirmedByCodeAndOrg(codeId: string, orgId: string): Promise<PromoRedemption | null> {
    const doc = await (await collection()).findOne({
      code_id: codeId,
      org_id: orgId,
      status: 'confirmed',
    });
    return doc ? toEntity(doc) : null;
  },

  async listByCode(codeId: string): Promise<PromoRedemption[]> {
    const docs = await (await collection())
      .find({ code_id: codeId })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(toEntity);
  },
};
