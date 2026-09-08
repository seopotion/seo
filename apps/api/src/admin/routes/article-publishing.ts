import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, IntegrationRepo, OrgRepo } from '@shared/db';
import { publishStaticSiteArticle } from '../../lib/publishers';
import { PublishingFailure } from '../../lib/publishing-errors';
import { audit } from '../audit';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

const articlePublishing = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/articles/{article_id}/publishing-targets',
      summary: "List the article organization's publishing destinations",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPublishingTargetsResponse } },
          description: 'Display-safe publishing destinations',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Article or organization not found',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      const org = await OrgRepo.findById(article.org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const [wordpressIntegration, staticSiteIntegration] = await Promise.all([
        IntegrationRepo.findByOrgAndProvider(org.id, 'wordpress'),
        IntegrationRepo.findByOrgAndProvider(org.id, 'static-site'),
      ]);
      const destinations = [];
      if (org.wordpress_token && org.wordpress_connected_at) {
        destinations.push({
          provider: 'wordpress' as const,
          target: org.website_url,
          connected_at: org.wordpress_connected_at.toISOString(),
          last_error:
            wordpressIntegration?.provider === 'wordpress' && wordpressIntegration.last_error
              ? {
                  code: wordpressIntegration.last_error.code,
                  at: wordpressIntegration.last_error.at.toISOString(),
                }
              : null,
        });
      }
      if (staticSiteIntegration?.provider === 'static-site') {
        destinations.push({
          provider: 'static-site' as const,
          target: `${staticSiteIntegration.repo}@${staticSiteIntegration.branch}`,
          connected_at: staticSiteIntegration.connected_at.toISOString(),
          last_error: staticSiteIntegration.last_error
            ? {
                code: staticSiteIntegration.last_error.code,
                at: staticSiteIntegration.last_error.at.toISOString(),
              }
            : null,
        });
      }
      return c.json({ destinations }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/articles/{article_id}/static-site',
      summary: "Publish or update an article on the organization's static site",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminArticleParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishResponse } },
          description: 'Committed article and manifest',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishErrorResponse } },
          description: 'Article or organization not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishErrorResponse } },
          description: 'Not connected, images incomplete, publish in progress, or conflict',
        },
        422: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishErrorResponse } },
          description: 'GitHub refused the commit',
        },
        500: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishErrorResponse } },
          description: 'Commit succeeded but publication state was not saved',
        },
        502: {
          content: { 'application/json': { schema: schemas.AdminStaticSitePublishErrorResponse } },
          description: 'GitHub request or response failed',
        },
      },
    }),
    async (c) => {
      const { article_id } = c.req.valid('param');
      const article = await ArticleRepo.findById(article_id);
      if (!article) return c.json({ error: 'not_found' }, 404);
      const org = await OrgRepo.findById(article.org_id);
      if (!org) return c.json({ error: 'not_found' }, 404);

      const integration = await IntegrationRepo.findByOrgAndProvider(org.id, 'static-site');
      if (integration?.provider !== 'static-site') {
        return c.json({ error: 'static_site_not_connected' }, 409);
      }
      if (article.images_status !== 'complete') {
        return c.json({ error: 'images_not_complete' }, 409);
      }

      const previous = article.publications.find((entry) => entry.provider === 'static-site');
      let published: Awaited<ReturnType<typeof publishStaticSiteArticle>>;
      try {
        published = await publishStaticSiteArticle({ article, integration });
      } catch (error) {
        if (!(error instanceof PublishingFailure)) {
          return c.json({ error: 'github_request_failed' }, 502);
        }
        if (error.httpStatus === 422) {
          await IntegrationRepo.setError(org.id, 'static-site', error.error.code).catch(() => {});
          return c.json({ error: error.error.code }, 422);
        }
        if (error.httpStatus === 409) return c.json({ error: error.error.code }, 409);
        if (error.httpStatus === 500) return c.json({ error: error.error.code }, 500);
        return c.json({ error: error.error.code }, 502);
      }

      if (integration.last_error) {
        await IntegrationRepo.setError(org.id, 'static-site', null).catch(() => {});
      }
      await audit(c, {
        action: previous ? 'article.static_site_update' : 'article.static_site_publish',
        org_id: org.id,
        entity: { type: 'article', id: article.id },
        payload: { ref: published.ref, slug: published.slug, path: published.path },
        before: previous,
      });
      return c.json(
        { commit_sha: published.ref, commit_url: published.remote_url, path: published.path },
        200,
      );
    },
  );

export default articlePublishing;
