import {
  type CreateOrgInput,
  CreateOrgInput as CreateOrgInputSchema,
  type Org,
  OrgSchema,
  type SetupPresets,
  SetupPresetsSchema,
} from '@shared/schemas';
import type { EntitlementPlan, SetupStatus, StrategyStatus } from '@shared/types';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('orgs');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Org {
  const { _id, ...rest } = doc;
  return OrgSchema.parse({ id: _id.toString(), ...rest });
}

export const OrgRepo = {
  async findById(id: string): Promise<Org | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async findByUserId(userId: string): Promise<Org[]> {
    const docs = await (await collection()).find({ user_id: userId }).toArray();
    return docs.map(toEntity);
  },

  /**
   * Find an org still mid-onboarding (not `setup_complete`) for this user and
   * URL. Lets `POST /setup/start_scan` be idempotent: a double-click or a
   * refresh-and-resubmit reuses the in-progress org instead of duplicating it.
   */
  async findActiveByUserAndUrl(userId: string, website_url: string): Promise<Org | null> {
    const doc = await (await collection()).findOne({
      user_id: userId,
      website_url,
      setup_status: { $ne: 'setup_complete' },
    });
    return doc ? toEntity(doc) : null;
  },

  async create(input: CreateOrgInput): Promise<Org> {
    const data = CreateOrgInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  async updateStatus(id: string, setup_status: SetupStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: { setup_status } });
  },

  /** Store the scan presets and mark scanning complete (single update). */
  async completeScan(id: string, presets: SetupPresets): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { presets: data, setup_status: 'setup_scan_completed' } },
    );
  },

  /** Persist edited presets without changing status (used by PATCH /setup/presets). */
  async updatePresets(id: string, presets: SetupPresets): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: { presets: data } });
  },

  async saveWordPressConnection(id: string, token: string, connectedAt: Date): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { wordpress_token: token, wordpress_connected_at: connectedAt } },
    );
    return res.matchedCount > 0;
  },

  /** Persist final presets (+ optional onboarding metadata) and flip the org to
   * `setup_complete` in a single update. */
  async finalize(
    id: string,
    presets: SetupPresets,
    onboarding?: { referral_source?: string; integrations?: string[] },
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    const set: Record<string, unknown> = { presets: data, setup_status: 'setup_complete' };
    if (onboarding) set.onboarding = onboarding;
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: set });
  },

  /**
   * Atomically claim the automatic-strategy job for this org. Flips
   * `strategy_status` none|failed -> pending and returns true only for the call
   * that won the transition, so `/setup/finalize` enqueues exactly one job even
   * under retries/re-finalize.
   */
  async claimStrategy(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), strategy_status: { $in: ['none', 'failed'] } },
      { $set: { strategy_status: 'pending' } },
    );
    return res.modifiedCount === 1;
  },

  async setStrategyStatus(id: string, status: StrategyStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { strategy_status: status } },
    );
  },

  /**
   * Override the entitlement plan directly. A dev/staging admin escape hatch
   * (via the `db set-plan` CLI) while Stripe billing (#13) is unbuilt. Returns
   * true when an org matched the id.
   */
  async setPlan(id: string, plan: EntitlementPlan): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: { plan } });
    return res.matchedCount === 1;
  },

  /** Store the latest Domain Rating (0–100) with its fetch timestamp (#12). */
  async updateDomainRating(id: string, value: number): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { domain_rating: { value, checked_at: new Date() } } },
    );
  },

  /** Delete the org (used by the `db reset-user` CLI). Returns true when a doc matched. */
  async deleteById(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  },
};
