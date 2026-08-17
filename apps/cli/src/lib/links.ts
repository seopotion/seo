/**
 * One-off cleanup of the dead internal links generated before #186: every link
 * that is not a verified, published page of the same org is unwrapped to plain
 * anchor text, using the exact sanitizer the generation pipeline now runs.
 *
 * Dry run by default. Published articles that changed are listed in the result
 * so an operator can republish them — this command never publishes anything.
 */
import { ArticleRepo, closeDb, IntegrationRepo, OrgRepo } from '@shared/db';
import {
  deriveCandidates,
  extractLinks,
  sanitizeLinks,
  staticSitePostUrl,
  verifyCandidates,
} from '@shared/generation';
import { type CleanLinksData, fail, ok, type Result, type SetPostBaseData } from '../types';

const MAX_ARTICLES = 500;

export async function cleanLinks(opts: {
  org?: string;
  apply: boolean;
}): Promise<Result<CleanLinksData>> {
  if (!opts.org) {
    return fail('ORG_REQUIRED', 'Pass --org <id>.', 'Find it with `npm run cli -- db set-plan`.');
  }
  try {
    const org = await OrgRepo.findById(opts.org);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id ${opts.org}.`);

    const max = org.presets?.article_preferences.content_seo.internal_links_count ?? 0;

    let staticSitePostBase: string | null = null;
    for (const integration of await IntegrationRepo.listByOrgId(org.id)) {
      if (integration.provider === 'static-site') staticSitePostBase = integration.post_url_base;
    }

    const { articles: publishedArticles } = await ArticleRepo.listByOrg(org.id, {
      status: 'published',
      limit: MAX_ARTICLES,
      offset: 0,
    });
    const allowed = await verifyCandidates(
      deriveCandidates({ staticSitePostBase }, publishedArticles),
    );
    const allowedUrls = allowed.map((c) => c.url);

    const { articles } = await ArticleRepo.listByOrg(org.id, { limit: MAX_ARTICLES, offset: 0 });
    let changed = 0;
    let linksRemoved = 0;
    const publishedChanged: { id: string; title: string }[] = [];

    for (const article of articles) {
      const cleaned = sanitizeLinks(article.content, allowedUrls, max);
      if (cleaned === article.content) continue;
      changed += 1;
      linksRemoved += extractLinks(article.content).length - extractLinks(cleaned).length;
      if (article.status === 'published') {
        publishedChanged.push({ id: article.id, title: article.title });
      }
      if (opts.apply) await ArticleRepo.replaceContent(article.id, cleaned);
    }

    return ok({
      org: org.id,
      apply: opts.apply,
      allowedUrls: allowedUrls.length,
      published: publishedArticles.length,
      scanned: articles.length,
      changed,
      linksRemoved,
      publishedChanged,
    });
  } catch (e) {
    return fail('CLEAN_LINKS_FAILED', (e as Error).message);
  } finally {
    await closeDb();
  }
}

/**
 * Backfill `post_url_base` on an org's static-site connection (#228) — how
 * connections that predate the connect-form field get one without redoing the
 * GitHub App flow.
 */
export async function setPostBase(opts: {
  org?: string;
  base?: string;
}): Promise<Result<SetPostBaseData>> {
  if (!opts.org) {
    return fail('ORG_REQUIRED', 'Pass --org <id>.', 'Find it with `npm run cli -- db set-plan`.');
  }
  const base = opts.base?.trim().replace(/\/+$/, '') ?? '';
  // Valid exactly when a post URL can be built from it — the one job it has.
  if (!staticSitePostUrl(base, 'probe')) {
    return fail(
      'INVALID_BASE',
      'Pass --base <url>: an http(s) URL without query or fragment.',
      'Example: --base https://www.clewas.com — a post then lives at <base>/<slug>.',
    );
  }
  try {
    if (!(await IntegrationRepo.setStaticSitePostBase(opts.org, base))) {
      return fail('NO_STATIC_SITE', `Org ${opts.org} has no static-site connection.`);
    }
    return ok({ org: opts.org, postUrlBase: base });
  } catch (e) {
    return fail('SET_POST_BASE_FAILED', (e as Error).message);
  } finally {
    await closeDb();
  }
}
