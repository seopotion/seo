import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { launchImageRepair } from '@shared/articles';
import { ArticleRepo, OrgRepo } from '@shared/db';
import type { Org } from '@shared/schemas';
import { validateArticleFields } from '../../lib/article-validation';
import { recordWordPressPublication } from '../../lib/publications';
import { publishWordPressArticle, updateWordPressArticle } from '../../lib/publishers';
import { PublishingFailure } from '../../lib/publishing-errors';
import { audit } from '../audit';
import { toAdminArticleDetail, toAdminArticleListItem } from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/** WordPress connection guard shared by publish/update. */
function wordpressConnected(org: Org): boolean {
  return Boolean(org.wordpress_token && org.wordpress_connected_at);
}

/**
 * Operator article surface: list/detail, the content editor, and WordPress
 * publish/update — same guard ladder as the customer routes in
 * routes/dashboard.ts, minus ownership, with admin snake_case 409 codes.
 */
const articles = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/orgs/{org_id}/articles',
      summary: 'List articles (paginated, status-filterable)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminOrgParams, query: schemas.AdminArticlesQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminArticlesResponse } },
          description: 'Article rows incl. images_status + wordpress_post_id',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const { status, limit, offset } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const { articles: rows, total } = await ArticleRepo.listByOrg(org.id, {
        status,
        limit,
        offset,
      });
      return c.json({ articles: rows.map(toAdminArticleListItem), total }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/orgs/{org_id}/articles',
      summary: 'Create a planner-independent article',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminOrgParams,
        body: {
          content: { 'application/json': { schema: schemas.AdminArticleCreateBody } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
          description: 'The created article record',
        },
        400: {
          content: { 'application/json': { schema: schemas.ArticleValidationErrorResponse } },
          description: 'One or more fields failed validation',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Org not found',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('param');
      const body = c.req.valid('json');
      const org = await OrgRepo.findById(org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const fields = validateArticleFields(body);
      if (Object.keys(fields).length > 0) {
        return c.json({ error: 'validation_failed', fields }, 400);
      }

      const normalizedKeyword = body.keyword?.trim() || null;
      const created = await ArticleRepo.create({
        org_id,
        keyword_id: null,
        keyword: normalizedKeyword,
        title: body.title,
        slug: body.slug,
        meta_title: body.meta_title,
        meta_description: body.meta_description,
        content: body.content,
        search_volume: null,
        difficulty: null,
        topic_cluster_id: null,
        topic_cluster_label: null,
        topic_role: null,
        topic_content_focus: null,
        topic_primary_keyword: null,
        featured_image_url: '',
        images: [],
        images_status: 'complete',
        video: null,
        readability: null,
        status: 'generated',
        published_at: null,
      });
      await audit(c, {
        action: 'article.create_manual',
        org_id,
        entity: { type: 'article', id: created.id },
        payload: body,
      });
      return c.json(toAdminArticleDetail(created), 201);
    },
    (result, c) => {
      if (result.success) return;

      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        fields[typeof field === 'string' ? field : 'body'] = issue.message;
      }
      return c.json({ error: 'validation_failed', fields }, 400);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/articles/{article_id}',
      summary: 'Full article record',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
          description: 'Same field set as the customer article detail (no secrets)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Article not found',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      return c.json(toAdminArticleDetail(article), 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'patch',
      path: '/articles/{article_id}',
      summary: 'Save editor changes (customer validation rules)',
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminArticleParams,
        body: {
          content: { 'application/json': { schema: schemas.ArticleUpdateBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
          description: 'The updated article record',
        },
        400: {
          content: { 'application/json': { schema: schemas.ArticleValidationErrorResponse } },
          description: 'One or more fields failed validation',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Article not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description:
            "images_in_progress — the images worker's atomic content swap would clobber the edit",
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const body = c.req.valid('json');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      // fillImageSlot atomically swaps `content` while filling a slot — soft-
      // block edits until images are terminal (design/admin-panel.md §5/§7).
      if (article.images_status === 'pending') {
        return c.json({ error: 'images_in_progress' }, 409);
      }

      const fields = validateArticleFields(body);
      if (Object.keys(fields).length > 0) {
        return c.json({ error: 'validation_failed', fields }, 400);
      }

      const updated = await ArticleRepo.updateContent(article.id, body);
      if (!updated) return c.json({ error: 'not_found' }, 404);
      await audit(c, {
        action: 'article.update_content',
        org_id: article.org_id,
        entity: { type: 'article', id: article.id },
        payload: body,
        // The editable fields only, not the whole article (epic #150).
        before: {
          title: article.title,
          slug: article.slug,
          meta_title: article.meta_title,
          meta_description: article.meta_description,
          content: article.content,
        },
      });
      return c.json(toAdminArticleDetail(updated), 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/articles/{article_id}/wordpress',
      summary: "Publish to the customer's WordPress (dup-guarded)",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WordPressArticleResponse } },
          description: 'Inherited WordPress plugin response',
        },
        400: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the payload',
        },
        401: { description: 'Missing or invalid admin token' },
        403: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the site secret',
        },
        404: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Article/org not found, or the plugin 404ed',
        },
        409: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'wordpress_not_connected | already_published | images_not_complete',
        },
        500: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin failed to create the post',
        },
        502: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin response or network failure',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      const org = await OrgRepo.findById(article.org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      if (!wordpressConnected(org)) return c.json({ error: 'wordpress_not_connected' }, 409);
      // Dup-guard: a sequential retry must not create and remap a second post.
      if (article.wordpress_post_id) return c.json({ error: 'already_published' }, 409);
      if (article.images_status !== 'complete') {
        return c.json({ error: 'images_not_complete' }, 409);
      }

      try {
        const published = await publishWordPressArticle({
          article,
          websiteUrl: org.website_url,
          token: org.wordpress_token as string,
          automatic: false,
        });
        const persisted = await ArticleRepo.setWordPressPostId(article.id, published.post_id);
        if (!persisted) return c.json({ error: 'post_id_not_saved' }, 500);
        await recordWordPressPublication(article, {
          post_id: published.post_id,
          slug: published.slug,
          remote_url: published.remote_url,
          published_at: published.published_at,
        });
        await audit(c, {
          action: 'article.wordpress_publish',
          org_id: org.id,
          entity: { type: 'article', id: article.id },
          payload: { post_id: published.post_id },
          before: { wordpress_post_id: null },
        });
        return c.json(published.response, 200);
      } catch (err) {
        if (!(err instanceof PublishingFailure)) {
          return c.json({ error: 'wordpress_request_failed' }, 502);
        }
        const body = { error: err.httpStatus === 502 ? 'wordpress_request_failed' : err.message };
        if (err.httpStatus === 400) return c.json(body, 400);
        if (err.httpStatus === 403) return c.json(body, 403);
        if (err.httpStatus === 404) return c.json(body, 404);
        if (err.httpStatus === 409) return c.json(body, 409);
        if (err.httpStatus === 500) return c.json(body, 500);
        return c.json(body, 502);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'put',
      path: '/articles/{article_id}/wordpress',
      summary: 'Update the published WordPress post',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WordPressArticleResponse } },
          description: 'Inherited WordPress plugin response, including warnings',
        },
        400: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the payload',
        },
        401: { description: 'Missing or invalid admin token' },
        403: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin rejected the site secret',
        },
        404: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'Article/org not found, or the WordPress post was not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description:
            'wordpress_not_connected | not_published | images_not_complete | slug conflict',
        },
        500: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin failed to update the post',
        },
        502: {
          content: { 'application/json': { schema: schemas.WordPressArticleErrorResponse } },
          description: 'WordPress plugin response or network failure',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      const org = await OrgRepo.findById(article.org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      if (!wordpressConnected(org)) return c.json({ error: 'wordpress_not_connected' }, 409);
      if (!article.wordpress_post_id) return c.json({ error: 'not_published' }, 409);
      if (article.images_status !== 'complete') {
        return c.json({ error: 'images_not_complete' }, 409);
      }

      try {
        const published = await updateWordPressArticle({
          article,
          websiteUrl: org.website_url,
          token: org.wordpress_token as string,
          postId: article.wordpress_post_id,
        });
        await recordWordPressPublication(article, {
          post_id: published.post_id,
          slug: published.slug,
          remote_url: published.remote_url,
          published_at: published.published_at,
        });
        await audit(c, {
          action: 'article.wordpress_update',
          org_id: org.id,
          entity: { type: 'article', id: article.id },
          payload: { post_id: article.wordpress_post_id },
        });
        return c.json(published.response, 200);
      } catch (err) {
        if (!(err instanceof PublishingFailure)) {
          return c.json({ error: 'wordpress_request_failed' }, 502);
        }
        const body = { error: err.httpStatus === 502 ? 'wordpress_request_failed' : err.message };
        if (err.httpStatus === 400) return c.json(body, 400);
        if (err.httpStatus === 403) return c.json(body, 403);
        if (err.httpStatus === 404) return c.json(body, 404);
        if (err.httpStatus === 409) return c.json(body, 409);
        if (err.httpStatus === 500) return c.json(body, 500);
        return c.json(body, 502);
      }
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/articles/{article_id}/images',
      summary: 'Replay the image task (lever for images_status: failed)',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminEnqueuedResponse } },
          description:
            "Image repair run started; the article's set-if-absent plan and per-slot guards make replay safe",
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Article not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'images_not_supported — standalone articles have no planner keyword',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      if (article.keyword_id === null) {
        return c.json({ error: 'images_not_supported' }, 409);
      }

      await launchImageRepair(article.org_id, article.id);
      await audit(c, {
        action: 'article.images_replay',
        org_id: article.org_id,
        entity: { type: 'article', id: article.id },
        before: { images_status: article.images_status },
      });
      return c.json({ enqueued: true as const }, 200);
    },
  );

export default articles;
