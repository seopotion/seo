import { ADMIN_API_URL } from '../lib/env';
import { stageOf } from '../lib/stage';

/**
 * Persistent wrong-environment guard (design/admin-panel.md §4). It shows the
 * full API URL — the only thing that decides which environment an action hits —
 * and shouts in red whenever that isn't localhost.
 */
export function StageBanner() {
  const isLocal = stageOf(ADMIN_API_URL) === 'local';

  return (
    <div
      className={
        isLocal
          ? 'bg-emerald-950 px-4 py-1 text-center font-mono text-xs text-emerald-300'
          : 'bg-red-600 px-4 py-1 text-center font-mono text-xs font-bold tracking-wide text-white'
      }
    >
      {isLocal ? 'LOCAL' : 'REMOTE'} — {ADMIN_API_URL}
    </div>
  );
}
