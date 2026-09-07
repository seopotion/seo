import { AdminActionRepo } from '@shared/db';
import type { Context } from 'hono';
import { logger } from '../logger';
import type { AdminEnv } from './middleware';

/**
 * Every auditable operator action. The full union is declared up front (epic
 * #150) so action names stay consistent across phases; only the actions whose
 * routes exist are ever written.
 */
export type AdminActionName =
  | 'org.set_plan'
  | 'org.update_presets'
  | 'org.scan_rerun'
  | 'org.strategy_run'
  | 'org.strategy_force_rerun'
  | 'org.wordpress_connect'
  | 'org.wordpress_disconnect'
  | 'org.gsc_disconnect'
  | 'candidate.add'
  | 'candidate.reject'
  | 'candidate.restore'
  | 'candidate.schedule'
  | 'keyword.reschedule'
  | 'keyword.unschedule'
  | 'keyword.generate_now'
  | 'keyword.reset_generation'
  | 'keyword.update_brief'
  | 'article.create_manual'
  | 'article.update_content'
  | 'article.wordpress_publish'
  | 'article.wordpress_update'
  | 'article.images_replay'
  | 'article.image_upload'
  | 'promo_code.create'
  | 'promo_code.deactivate';

/**
 * Record a successful mutation in the append-only audit log. Called explicitly
 * per handler AFTER the mutation succeeds — refused guards (409s) and reads are
 * not audited (they're in CloudWatch via the request logger). Best-effort: an
 * audit-insert failure is logged loudly but never un-reports the mutation's
 * success (no transactions in this codebase; see design/admin-panel.md §5).
 */
export async function audit(
  c: Context<AdminEnv>,
  input: {
    action: AdminActionName;
    org_id?: string;
    entity?: { type: string; id: string };
    payload?: unknown;
    before?: unknown;
  },
): Promise<void> {
  try {
    await AdminActionRepo.insert({
      actor: c.var.adminAuth.email,
      action: input.action,
      org_id: input.org_id ?? null,
      entity: input.entity ?? null,
      payload: input.payload ?? null,
      before: input.before ?? null,
    });
  } catch (err) {
    logger.error('admin audit insert failed', {
      action: input.action,
      org_id: input.org_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
