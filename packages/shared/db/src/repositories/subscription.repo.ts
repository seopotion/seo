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

  /**
   * Idempotent upsert keyed on `provider_subscription_id`. Sets `created_at`
   * only on insert; always bumps `updated_at`. Webhooks are at-least-once, so
   * replays converge to the same doc. Returns the resulting entity.
   */
  async upsertFromEvent(input: UpsertInput): Promise<Subscription> {
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
    const res = await (await collection()).findOneAndUpdate(
      { provider_subscription_id: input.provider_subscription_id },
      { $set: set },
      { returnDocument: 'after' },
    );
    return res ? toEntity(res) : null;
  },
};
