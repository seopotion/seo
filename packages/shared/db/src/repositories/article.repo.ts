import {
  type Article,
  type ArticleImage,
  type ArticlePublication,
  ArticleSchema,
  type AutoPublishAttempt,
  type CreateArticleInput,
  CreateArticleInput as CreateArticleInputSchema,
  type IntegrationProvider,
  type PublishingError,
  type TopicRole,
} from '@shared/schemas';
import { type Document, ObjectId, type UpdateFilter, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('articles');

export interface RecordPublicationOptions {
  publishedAt?: Date;
  updatedAt?: Date | null;
}

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Article {
  const { _id, ...rest } = doc;
  return ArticleSchema.parse({ id: _id.toString(), ...rest });
}

export const ArticleRepo = {
  async listByOrg(
    orgId: string,
    opts: { status?: Article['status']; limit: number; offset: number },
  ): Promise<{ articles: Article[]; total: number }> {
    const filter: Document = { org_id: orgId };
    if (opts.status) filter.status = opts.status;
    const col = await collection();
    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return { articles: docs.map(toEntity), total };
  },

  async findById(id: string): Promise<Article | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async countByStatus(orgId: string, status: Article['status']): Promise<number> {
    return (await collection()).countDocuments({ org_id: orgId, status });
  },

  async listPublishedByTopicCluster(
    orgId: string,
    topicClusterId: string,
    opts: {
      limit: number;
      role?: { value: TopicRole; mode: 'include' | 'exclude' };
    },
  ): Promise<Article[]> {
    const filter: Document = {
      org_id: orgId,
      status: 'published',
      topic_cluster_id: topicClusterId,
    };
    if (opts.role) {
      filter.topic_role = opts.role.mode === 'include' ? opts.role.value : { $ne: opts.role.value };
    }
    const docs = await (await collection())
      .find(filter)
      .sort({ created_at: -1 })
      .limit(opts.limit)
      .toArray();
    return docs.map(toEntity);
  },

  /**
   * Every article the org currently has live with one provider. Unpaginated on
   * purpose: the static-site publisher rebuilds the whole `manifest.json` from
   * this, so a partial page would silently drop articles out of the client's
   * blog index (design/static-site-integration.md § The contract).
   */
  async listPublishedTo(
    orgId: string,
    provider: ArticlePublication['provider'],
  ): Promise<Article[]> {
    const docs = await (await collection())
      .find({ org_id: orgId, status: { $ne: 'deleted' }, 'publications.provider': provider })
      .toArray();
    return docs.map(toEntity);
  },

  async create(input: CreateArticleInput): Promise<Article> {
    const data = CreateArticleInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  async initializeAutoPublishAttempt(
    id: string,
    provider: IntegrationProvider,
    requestedAt: Date = new Date(),
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const entry: AutoPublishAttempt = {
      provider,
      status: 'queued',
      attempt_count: 0,
      requested_at: requestedAt,
      last_attempt_at: null,
      lease_expires_at: null,
      last_error: null,
    };
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        'publications.provider': { $ne: provider },
        'auto_publish.attempts': { $not: { $elemMatch: { provider } } },
      },
      { $push: { 'auto_publish.attempts': entry } } as unknown as UpdateFilter<Document>,
    );
    return res.modifiedCount === 1;
  },

  async claimAutoPublishAttempt(
    id: string,
    provider: IntegrationProvider,
    now: Date,
    leaseMs: number,
  ): Promise<AutoPublishAttempt | null> {
    if (!ObjectId.isValid(id)) return null;
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const doc = await (await collection()).findOneAndUpdate(
      {
        _id: new ObjectId(id),
        'publications.provider': { $ne: provider },
        'auto_publish.attempts': {
          $elemMatch: {
            provider,
            $or: [
              { status: { $in: ['queued', 'retrying'] } },
              { status: 'publishing', lease_expires_at: { $lte: now } },
            ],
          },
        },
      },
      {
        $set: {
          'auto_publish.attempts.$.status': 'publishing',
          'auto_publish.attempts.$.last_attempt_at': now,
          'auto_publish.attempts.$.lease_expires_at': leaseExpiresAt,
        },
        $inc: { 'auto_publish.attempts.$.attempt_count': 1 },
      },
      { returnDocument: 'after' },
    );
    if (!doc) return null;
    return (
      toEntity(doc).auto_publish.attempts.find((attempt) => attempt.provider === provider) ?? null
    );
  },

  async recordAutoPublishRetry(
    id: string,
    provider: IntegrationProvider,
    leaseExpiresAt: Date,
    error: PublishingError,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        'auto_publish.attempts': {
          $elemMatch: { provider, status: 'publishing', lease_expires_at: leaseExpiresAt },
        },
      },
      {
        $set: {
          'auto_publish.attempts.$.status': 'retrying',
          'auto_publish.attempts.$.lease_expires_at': null,
          'auto_publish.attempts.$.last_error': error,
        },
      },
    );
    return res.modifiedCount === 1;
  },

  async failAutoPublishAttempt(
    id: string,
    provider: IntegrationProvider,
    error: PublishingError,
    leaseExpiresAt?: Date,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const attemptFilter: Document = { provider, status: { $ne: 'published' } };
    if (leaseExpiresAt) {
      attemptFilter.status = 'publishing';
      attemptFilter.lease_expires_at = leaseExpiresAt;
    }
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        'auto_publish.attempts': { $elemMatch: attemptFilter },
      },
      {
        $set: {
          'auto_publish.attempts.$.status': 'failed',
          'auto_publish.attempts.$.lease_expires_at': null,
          'auto_publish.attempts.$.last_error': error,
        },
      },
    );
    return res.modifiedCount === 1;
  },

  async cancelAutoPublishAttempt(
    id: string,
    provider: IntegrationProvider,
    error: PublishingError,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        'auto_publish.attempts': {
          $elemMatch: {
            provider,
            $or: [
              { status: { $in: ['queued', 'retrying'] } },
              { status: 'publishing', lease_expires_at: { $lte: now } },
            ],
          },
        },
      },
      {
        $set: {
          'auto_publish.attempts.$.status': 'cancelled',
          'auto_publish.attempts.$.lease_expires_at': null,
          'auto_publish.attempts.$.last_error': error,
        },
      },
    );
    return res.modifiedCount === 1;
  },

  async completeAutoPublishAttempt(id: string, provider: IntegrationProvider): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), 'auto_publish.attempts.provider': provider },
      {
        $set: {
          'auto_publish.attempts.$.status': 'published',
          'auto_publish.attempts.$.lease_expires_at': null,
          'auto_publish.attempts.$.last_error': null,
        },
      },
    );
    return res.matchedCount === 1;
  },

  async resetAutoPublishAttempt(
    id: string,
    provider: IntegrationProvider,
    requestedAt: Date = new Date(),
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        'publications.provider': { $ne: provider },
        'auto_publish.attempts': {
          $elemMatch: { provider, status: { $in: ['failed', 'cancelled'] } },
        },
      },
      {
        $set: {
          'auto_publish.attempts.$.status': 'queued',
          'auto_publish.attempts.$.attempt_count': 0,
          'auto_publish.attempts.$.requested_at': requestedAt,
          'auto_publish.attempts.$.last_attempt_at': null,
          'auto_publish.attempts.$.lease_expires_at': null,
          'auto_publish.attempts.$.last_error': null,
        },
      },
    );
    return res.modifiedCount === 1;
  },

  async recordAutoPublishPreflightError(id: string, error: PublishingError): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { 'auto_publish.preflight_error': error } },
    );
  },

  async clearAutoPublishPreflightError(id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { 'auto_publish.preflight_error': null } },
    );
  },

  /**
   * Upsert the article's publish state for one provider (#7). A first publish
   * pushes the entry; a re-publish updates `ref`/`slug` and stamps
   * `updated_at`, so `published_at` keeps meaning "first went live".
   * `slug` is the slug we actually wrote under, which the editor can later
   * change on the article itself — that difference is what makes stale remote
   * paths detectable at the next publish.
   *
   * Callers may provide the exact provider timestamps they already committed.
   * `publishedAt` defaults to now for a first publication. `updatedAt` defaults
   * to null for an insertion and now for an existing provider, but an explicit
   * Date or null is always stored as-is. In particular, equality between the
   * two timestamps does not imply that no update occurred.
   *
   * This is also the ONLY place `article.status` advances to `'published'`.
   * It has to be here rather than in each publish route because every provider
   * funnels through it, and until it was added `'published'` was a value the
   * codebase read in four places but never wrote — Content History, the
   * published counter, the GSC top-pages title join and the admin org detail
   * were all permanently empty for every customer.
   */
  async recordPublication(
    id: string,
    entry: {
      provider: ArticlePublication['provider'];
      ref: string;
      slug: string;
      remote_url?: string | null;
    },
    options?: RecordPublicationOptions,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const col = await collection();
    const _id = new ObjectId(id);
    const now = new Date();
    const publishedAt = options?.publishedAt ?? now;
    const updatedAt = options?.updatedAt === undefined ? now : options.updatedAt;
    const updateSet: Document = {
      'publications.$.ref': entry.ref,
      'publications.$.slug': entry.slug,
      'publications.$.updated_at': updatedAt,
      status: 'published',
    };
    if (entry.remote_url !== undefined) updateSet['publications.$.remote_url'] = entry.remote_url;
    const updated = await col.updateOne(
      { _id, 'publications.provider': entry.provider },
      { $set: updateSet },
    );
    let matched = updated.matchedCount > 0;
    if (!matched) {
      // The cast is the driver's `PushOperator<Document>` wrinkle: on an untyped
      // collection every field resolves to `undefined`, so no $push value is
      // assignable. Nothing here is dynamic — the shape is ArticlePublication.
      const pushed = await col.updateOne(
        { _id, 'publications.provider': { $ne: entry.provider } },
        {
          $set: { status: 'published' },
          $push: {
            publications: {
              ...entry,
              remote_url: entry.remote_url ?? null,
              published_at: publishedAt,
              updated_at: options?.updatedAt ?? null,
            },
          },
        } as unknown as UpdateFilter<Document>,
      );
      matched = pushed.matchedCount > 0;
      if (!matched) {
        const raced = await col.updateOne(
          { _id, 'publications.provider': entry.provider },
          { $set: updateSet },
        );
        matched = raced.matchedCount > 0;
      }
    }
    if (!matched) return false;
    // `article.published_at` means "first went live with ANY provider", so it is
    // stamped once and never moved by a republish or by a second provider going
    // live later. A separate write because that rule can't be expressed in the
    // same update as the $set above; `{published_at: null}` also matches the
    // pre-#7 documents where the field is absent entirely.
    await col.updateOne({ _id, published_at: null }, { $set: { published_at: publishedAt } });
    return true;
  },

  async setWordPressPostId(id: string, postId: number): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { wordpress_post_id: postId } },
    );
    return res.matchedCount > 0;
  },

  /** Save the editor's five editable fields, stamping `updated_at` (#74). */
  async updateContent(
    id: string,
    patch: Pick<Article, 'title' | 'slug' | 'meta_title' | 'meta_description' | 'content'>,
  ): Promise<Article | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...patch, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return doc ? toEntity(doc) : null;
  },

  /**
   * Overwrite `content` alone, leaving `updated_at` untouched — that field means
   * "last editor save", and the one-off internal-link cleanup (#186) is not one.
   */
  async replaceContent(id: string, content: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { content } },
    );
    return res.matchedCount > 0;
  },

  /** Persist the image plan once (set-if-absent) — a retry never re-plans (#51). */
  async setImagePlan(id: string, images: ArticleImage[]): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), 'images.0': { $exists: false } },
      { $set: { images, images_status: 'pending' } },
    );
    return res.modifiedCount === 1;
  },

  /**
   * Fill slot `index` — only while its url is '' (pending→generated guard, so a
   * redelivery can't double-fill or double-inject). `newContent` swaps the
   * article markdown atomically in the same update (null = leave content alone).
   */
  async fillImageSlot(
    id: string,
    index: number,
    fill: {
      url: string;
      model: string;
      seed: number | null;
      generated_at: Date;
      width: number | null;
      height: number | null;
    },
    newContent: string | null,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const set: Document = {
      [`images.${index}.url`]: fill.url,
      [`images.${index}.model`]: fill.model,
      [`images.${index}.seed`]: fill.seed,
      [`images.${index}.generated_at`]: fill.generated_at,
      [`images.${index}.width`]: fill.width,
      [`images.${index}.height`]: fill.height,
    };
    if (newContent !== null) set.content = newContent;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), [`images.${index}.url`]: '' },
      { $set: set },
    );
    return res.modifiedCount === 1;
  },

  /** Mark images complete + set the cover as featured — only when every slot is filled (#51). */
  async completeImages(id: string, coverUrl: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        images_status: { $ne: 'complete' },
        'images.0': { $exists: true },
        images: { $not: { $elemMatch: { url: '' } } },
      },
      { $set: { images_status: 'complete', featured_image_url: coverUrl } },
    );
    return res.modifiedCount === 1;
  },

  /** Record an image-plan failure. Never downgrades a completed article (#51). */
  async failImages(id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id), images_status: { $ne: 'complete' } },
      { $set: { images_status: 'failed' } },
    );
  },

  /**
   * Re-arm the image pipeline for one article (`db reset-images`). The worker's
   * idempotency guards — plan set-if-absent, `url === ''` per slot, and the
   * `images_status === 'complete'` short-circuit — mean a replayed task is a
   * no-op until the slots are blanked and the status rewound, which is exactly
   * what this does. Content comes in already stripped of the dead markdown.
   */
  async resetImages(
    id: string,
    update: { images: ArticleImage[]; content: string; featuredImageUrl: string },
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          images: update.images,
          content: update.content,
          featured_image_url: update.featuredImageUrl,
          images_status: 'pending',
        },
      },
    );
    return res.modifiedCount === 1;
  },

  /** Delete every article for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
