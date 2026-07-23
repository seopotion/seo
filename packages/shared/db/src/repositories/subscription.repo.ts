import {
  type CreateSubscriptionInput,
  type PaidTier,
  type Subscription,
  SubscriptionSchema,
  type SubscriptionStatus,
} from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('subscriptions');

function toEntity(doc: WithId<Document>): Subscription {
  const { _id, ...rest } = doc;
  return SubscriptionSchema.parse({ id: _id.toString(), ...rest });
}

type UpsertInput = Omit<CreateSubscriptionInput, 'created_at' | 'updated_at'>;

async function upsertOnce(input: UpsertInput): Promise<Subscription> {
  const now = new Date();
  const res = await (await collection()).findOneAndUpdate(
    { provider_subscription_id: input.provider_subscription_id },
    {
      $set: {
        org_id: input.org_id,
        provider: input.provider,
        provider_customer_id: input.provider_customer_id,
        tier: input.tier,
        status: input.status,
        current_period_end: input.current_period_end,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!res) throw new Error('upsertFromEvent: no document returned');
  return toEntity(res);
}

export const SubscriptionRepo = {
  async findByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | null> {
    const doc = await (await collection()).findOne({
      provider_subscription_id: providerSubscriptionId,
    });
    return doc ? toEntity(doc) : null;
  },

  async findActiveByOrg(org_id: string): Promise<Subscription | null> {
    const doc = await (await collection()).findOne({ org_id, status: 'active' });
    return doc ? toEntity(doc) : null;
  },

  /** All of the org's active subscriptions. Normally at most one, but an
   * upgrade checkout creates a new provider subscription, so the applier uses
   * this to cancel any superseded ones. */
  async listActiveByOrg(org_id: string): Promise<Subscription[]> {
    const docs = await (await collection()).find({ org_id, status: 'active' }).toArray();
    return docs.map(toEntity);
  },

  /**
   * The org's most recent subscription regardless of status. Used by the
   * portal route: past_due (dunning) and cancelled (access-until-expiry) orgs
   * still need to reach the billing portal, not only active ones.
   */
  async findLatestByOrg(org_id: string): Promise<Subscription | null> {
    const doc = await (await collection()).findOne({ org_id }, { sort: { created_at: -1 } });
    return doc ? toEntity(doc) : null;
  },

  /** Delete all of an org's subscriptions (CLI reset/delete-user). Returns the count. */
  async deleteByOrgId(org_id: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id });
    return res.deletedCount;
  },

  /**
   * Idempotent upsert keyed on `provider_subscription_id`. Sets `created_at`
   * only on insert; always bumps `updated_at`. Webhooks are at-least-once, so
   * replays converge to the same doc. Returns the resulting entity.
   */
  async upsertFromEvent(input: UpsertInput): Promise<Subscription> {
    try {
      return await upsertOnce(input);
    } catch (err) {
      // Two concurrent first deliveries can race the upsert into a
      // duplicate-key error on the unique provider_subscription_id index; the
      // retry finds the now-existing doc and updates it in place.
      if ((err as { code?: number }).code !== 11000) throw err;
      return await upsertOnce(input);
    }
  },

  /**
   * Update an existing subscription in place (used for updated/cancelled/expired
   * events, which carry only the provider subscription id). Returns null when no
   * subscription matches — the applier treats that as a logged no-op.
   */
  async updateFromEvent(input: {
    provider_subscription_id: string;
    tier?: PaidTier;
    status: SubscriptionStatus;
    current_period_end?: Date;
  }): Promise<Subscription | null> {
    const set: Record<string, unknown> = { status: input.status, updated_at: new Date() };
    if (input.tier) set.tier = input.tier;
    if (input.current_period_end) set.current_period_end = input.current_period_end;
    // `expired` is terminal: webhooks are at-least-once and unordered, so a
    // late/retried non-expired event must not resurrect an expired sub (it
    // would re-grant entitlement for free). Re-setting `expired` still matches
    // so the applier's downgrade stays idempotent under replays.
    const filter: Record<string, unknown> = {
      provider_subscription_id: input.provider_subscription_id,
    };
    if (input.status !== 'expired') filter.status = { $ne: 'expired' };
    const res = await (await collection()).findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after' },
    );
    return res ? toEntity(res) : null;
  },
};
