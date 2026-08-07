export type Stage = 'local' | 'remote';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];

/**
 * Which environment does an admin API URL point at? The operator-facing
 * wrong-environment guard (design/admin-panel.md §4) — anything that isn't
 * provably local is banner-red `remote`, including an unparseable URL.
 */
export function stageOf(url: string): Stage {
  try {
    return LOCAL_HOSTNAMES.includes(new URL(url).hostname) ? 'local' : 'remote';
  } catch {
    return 'remote';
  }
}
