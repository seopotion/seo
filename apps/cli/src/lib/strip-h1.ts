/**
 * One-off cleanup of the body H1 the generator used to write: the page renders
 * `title` as the H1 (static-site frontmatter, WordPress post title, the in-app
 * preview), so a body that opens with one shipped as a duplicate heading on
 * every customer site. Uses the same strip the draft stage now applies.
 *
 * Dry run by default. Published articles that changed are listed in the result
 * so an operator can republish them — this command never publishes anything.
 */
import { ArticleRepo, closeDb, OrgRepo } from '@shared/db';
import { stripLeadingH1 } from '@shared/generation';
import { fail, ok, type Result, type StripH1Data } from '../types';

const MAX_ARTICLES = 500;

export async function stripH1(opts: {
  org?: string;
  apply: boolean;
}): Promise<Result<StripH1Data>> {
  if (!opts.org) {
    return fail('ORG_REQUIRED', 'Pass --org <id>.', 'Find it with `npm run cli -- db set-plan`.');
  }
  try {
    const org = await OrgRepo.findById(opts.org);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id ${opts.org}.`);

    const { articles } = await ArticleRepo.listByOrg(org.id, { limit: MAX_ARTICLES, offset: 0 });
    let changed = 0;
    const publishedChanged: { id: string; title: string }[] = [];

    for (const article of articles) {
      const stripped = stripLeadingH1(article.content);
      if (stripped === article.content) continue;
      changed += 1;
      if (article.status === 'published') {
        publishedChanged.push({ id: article.id, title: article.title });
      }
      if (opts.apply) await ArticleRepo.replaceContent(article.id, stripped);
    }

    return ok({
      org: org.id,
      apply: opts.apply,
      scanned: articles.length,
      changed,
      publishedChanged,
    });
  } catch (e) {
    return fail('STRIP_H1_FAILED', (e as Error).message);
  } finally {
    await closeDb();
  }
}
