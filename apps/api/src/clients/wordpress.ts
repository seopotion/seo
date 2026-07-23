import type { Article } from '@shared/schemas';
import { marked } from 'marked';
import { config } from '../config';

export type WordPressIntegrationResult = { success: true } | { success: false; error_code: string };

export type WordPressArticleResponse = {
  success: true;
  post_id: number;
  warnings?: string[];
};

export type WordPressArticleResult =
  | { status: 200; body: WordPressArticleResponse }
  | { status: 400 | 403 | 404 | 409 | 500; body: { error: string } };

type WordPressArticleSnapshot = {
  title: string;
  slug: string;
  content: string;
  image_url?: string;
  meta_description: string;
  focus_keyword: string;
};

function articleSnapshot(article: Article): WordPressArticleSnapshot {
  return {
    title: article.title,
    slug: article.slug,
    content: marked.parse(article.content, { async: false }),
    ...(article.featured_image_url ? { image_url: article.featured_image_url } : {}),
    meta_description: article.meta_description,
    focus_keyword: article.keyword,
  };
}

async function sendWordPressArticle(
  websiteUrl: string,
  route: 'submit' | 'edit',
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
): Promise<WordPressArticleResult> {
  const response = await fetch(`${websiteUrl.replace(/\/+$/, '')}/wp-json/seo-potion/v1/${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Secret-Key': config.WORDPRESS_ROUTE_SECRET,
    },
    body: JSON.stringify(body),
  });
  const responseBody: unknown = await response.json();

  if (
    response.status === 200 &&
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'success' in responseBody &&
    responseBody.success === true &&
    'post_id' in responseBody &&
    typeof responseBody.post_id === 'number' &&
    Number.isInteger(responseBody.post_id) &&
    responseBody.post_id > 0 &&
    (!('warnings' in responseBody) ||
      (Array.isArray(responseBody.warnings) &&
        responseBody.warnings.every((warning) => typeof warning === 'string')))
  ) {
    return {
      status: 200,
      body: {
        success: true,
        post_id: responseBody.post_id,
        ...('warnings' in responseBody ? { warnings: responseBody.warnings as string[] } : {}),
      },
    };
  }

  if (
    (response.status === 400 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 409 ||
      response.status === 500) &&
    typeof responseBody === 'object' &&
    responseBody !== null &&
    'error' in responseBody &&
    typeof responseBody.error === 'string'
  ) {
    return { status: response.status, body: { error: responseBody.error } };
  }

  throw new Error('Invalid WordPress article response');
}

export function submitWordPressArticle(
  websiteUrl: string,
  token: string,
  article: Article,
): Promise<WordPressArticleResult> {
  return sendWordPressArticle(websiteUrl, 'submit', 'POST', {
    secret: token,
    title: article.title,
    slug: article.slug,
    created_at: article.created_at.toISOString(),
    content: articleSnapshot(article).content,
    ...(article.featured_image_url ? { image_url: article.featured_image_url } : {}),
    meta_description: article.meta_description,
    focus_keyword: article.keyword,
  });
}

export function editWordPressArticle(
  websiteUrl: string,
  token: string,
  postId: number,
  article: Article,
): Promise<WordPressArticleResult> {
  return sendWordPressArticle(websiteUrl, 'edit', 'PUT', {
    secret: token,
    id: postId,
    ...articleSnapshot(article),
  });
}

export async function testWordPressIntegration(
  websiteUrl: string,
  token: string,
): Promise<WordPressIntegrationResult> {
  const response = await fetch(
    `${websiteUrl.replace(/\/+$/, '')}/wp-json/seo-potion/v1/test-integration`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: token }),
    },
  );
  const body: unknown = await response.json();

  if (
    typeof body === 'object' &&
    body !== null &&
    'success' in body &&
    body.success === true &&
    response.ok
  ) {
    return { success: true };
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'success' in body &&
    body.success === false &&
    'error_code' in body &&
    typeof body.error_code === 'string'
  ) {
    return { success: false, error_code: body.error_code };
  }

  throw new Error('Invalid WordPress integration response');
}
