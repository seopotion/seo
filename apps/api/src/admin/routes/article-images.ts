import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { ArticleRepo, OrgRepo } from '@shared/db';
import { audit } from '../audit';
import { toAdminArticleDetail } from '../dto';
import {
  finalizeImageUpload,
  ImageUploadError,
  prepareImageUpload,
  removeArticleImage,
} from '../image-uploads';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

const errors = {
  400: {
    content: { 'application/json': { schema: schemas.AdminErrorResponse } },
    description: 'Invalid upload',
  },
  401: { description: 'Missing or invalid admin token' },
  403: {
    content: { 'application/json': { schema: schemas.AdminErrorResponse } },
    description: 'Operator required',
  },
  404: {
    content: { 'application/json': { schema: schemas.AdminErrorResponse } },
    description: 'Article or org not found',
  },
  409: {
    content: { 'application/json': { schema: schemas.AdminErrorResponse } },
    description: 'Article or image slot changed',
  },
  503: {
    content: { 'application/json': { schema: schemas.AdminErrorResponse } },
    description: 'Image storage unavailable',
  },
};

const articleImages = new OpenAPIHono<AdminEnv>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: c.req.path.endsWith('/images/remove')
            ? 'invalid_image_removal'
            : 'invalid_upload_metadata',
        },
        400,
      );
  },
})
  .openapi(
    createRoute({
      method: 'post',
      path: '/articles/{article_id}/images/upload',
      tags: ['admin'],
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminArticleParams,
        body: {
          required: true,
          content: { 'application/json': { schema: schemas.AdminImageUploadBody } },
        },
      },
      responses: {
        ...errors,
        200: {
          description: 'Upload prepared',
          content: { 'application/json': { schema: schemas.AdminImageUploadResponse } },
        },
      },
    }),
    async (c) => {
      if (c.var.adminAuth.role !== 'operator') return c.json({ error: 'operator_required' }, 403);
      const article = await ArticleRepo.findById(c.req.valid('param').article_id);
      if (!article || article.status === 'deleted' || !(await OrgRepo.findById(article.org_id))) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (article.keyword_id !== null) return c.json({ error: 'manual_images_only' }, 409);
      try {
        return c.json(
          await prepareImageUpload(article, c.var.adminAuth.email, c.req.valid('json')),
          200,
        );
      } catch (error) {
        if (error instanceof ImageUploadError) return c.json({ error: error.code }, error.status);
        throw error;
      }
    },
  )
  .openapi(
    createRoute({
      method: 'post',
      path: '/articles/{article_id}/images/finalize',
      tags: ['admin'],
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminArticleParams,
        body: {
          required: true,
          content: { 'application/json': { schema: schemas.AdminImageFinalizeBody } },
        },
      },
      responses: {
        ...errors,
        200: {
          description: 'Updated article',
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
        },
      },
    }),
    async (c) => {
      if (c.var.adminAuth.role !== 'operator') return c.json({ error: 'operator_required' }, 403);
      const article = await ArticleRepo.findById(c.req.valid('param').article_id);
      if (!article || article.status === 'deleted' || !(await OrgRepo.findById(article.org_id))) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (article.keyword_id !== null) return c.json({ error: 'manual_images_only' }, 409);
      try {
        const updated = await finalizeImageUpload(
          article,
          c.var.adminAuth.email,
          c.req.valid('json').upload_token,
        );
        if (updated !== article)
          await audit(c, {
            action: 'article.image_upload',
            org_id: article.org_id,
            entity: { type: 'article', id: article.id },
            payload: { images: updated.images },
            before: { images: article.images },
          });
        return c.json(toAdminArticleDetail(updated), 200);
      } catch (error) {
        if (error instanceof ImageUploadError) return c.json({ error: error.code }, error.status);
        throw error;
      }
    },
  )
  .openapi(
    createRoute({
      method: 'post',
      path: '/articles/{article_id}/images/remove',
      tags: ['admin'],
      security: [{ Bearer: [] }],
      request: {
        params: schemas.AdminArticleParams,
        body: {
          required: true,
          content: { 'application/json': { schema: schemas.AdminImageRemoveBody } },
        },
      },
      responses: {
        ...errors,
        200: {
          description: 'Updated article',
          content: { 'application/json': { schema: schemas.ArticleDetailResponse } },
        },
      },
    }),
    async (c) => {
      if (c.var.adminAuth.role !== 'operator') return c.json({ error: 'operator_required' }, 403);
      const article = await ArticleRepo.findById(c.req.valid('param').article_id);
      if (!article || article.status === 'deleted' || !(await OrgRepo.findById(article.org_id))) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (article.keyword_id !== null) return c.json({ error: 'manual_images_only' }, 409);
      const { url } = c.req.valid('json');
      try {
        const updated = await removeArticleImage(article, url);
        if (updated !== article)
          await audit(c, {
            action: 'article.image_remove',
            org_id: article.org_id,
            entity: { type: 'article', id: article.id },
            payload: { url, images: updated.images },
            before: { images: article.images },
          });
        return c.json(toAdminArticleDetail(updated), 200);
      } catch (error) {
        if (error instanceof ImageUploadError) return c.json({ error: error.code }, error.status);
        throw error;
      }
    },
  );

export default articleImages;
