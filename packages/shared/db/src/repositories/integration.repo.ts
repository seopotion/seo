import { type Integration, type IntegrationProvider, IntegrationSchema } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('integrations');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Integration {
  const { _id, ...rest } = doc;
  return IntegrationSchema.parse({ id: _id.toString(), ...rest });
}

export const IntegrationRepo = {
  /** Every connection the org has, for the settings panel. */
  async listByOrgId(orgId: string): Promise<Integration[]> {
    const docs = await (await collection()).find({ org_id: orgId }).toArray();
    return docs.map(toEntity);
  },

  async findByOrgAndProvider(
    orgId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null> {
    const doc = await (await collection()).findOne({ org_id: orgId, provider });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Store a verified WordPress connection. Upsert: reconnecting replaces the
   * token and clears any standing failure, the same shape as
   * `GscConnectionRepo.upsertToken`. The token arrives already encrypted — the
   * key lives in apps/api, which is the only place that has it.
   */
  async connectWordPress(orgId: string, siteUrl: string, tokenEnc: string): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId, provider: 'wordpress' },
      {
        $set: {
          site_url: siteUrl,
          token_enc: tokenEnc,
          connected_at: new Date(),
          last_error: null,
        },
      },
      { upsert: true },
    );
  },

  /**
   * Store a verified static-site connection (#7). Upsert on (org, provider), as
   * connectWordPress does. Returns **false** when the installation is already
   * bound to a different org: the partial unique index on `installation_id` is
   * what rejects it, so no check-then-write race can slip between two claimants
   * (design/github-app.md § Why `state` is not optional).
   */
  async connectStaticSite(
    orgId: string,
    input: { installationId: number; repo: string; branch: string; contentPath: string },
  ): Promise<boolean> {
    try {
      await (await collection()).updateOne(
        { org_id: orgId, provider: 'static-site' },
        {
          $set: {
            host: 'github',
            installation_id: input.installationId,
            repo: input.repo,
            branch: input.branch,
            content_path: input.contentPath,
            connected_at: new Date(),
            last_error: null,
          },
        },
        { upsert: true },
      );
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  },

  /**
   * Record (or clear, with `null`) the standing failure on a connection.
   * Webhooks are inactive in v1, so GitHub only tells us an installation is
   * gone when we try to use it — a failed publish is the *only* signal the
   * settings panel ever gets that a connection has died. No upsert: a row that
   * has since been disconnected has nothing left to annotate.
   */
  async setError(orgId: string, provider: IntegrationProvider, code: string | null): Promise<void> {
    await (await collection()).updateOne(
      { org_id: orgId, provider },
      { $set: { last_error: code === null ? null : { code, at: new Date() } } },
    );
  },

  /** Disconnect. Returns true when a row matched. */
  async deleteByOrgAndProvider(orgId: string, provider: IntegrationProvider): Promise<boolean> {
    const res = await (await collection()).deleteOne({ org_id: orgId, provider });
    return res.deletedCount === 1;
  },
};
