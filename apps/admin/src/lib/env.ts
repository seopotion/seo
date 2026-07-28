/**
 * Build-time environment. Vite inlines `import.meta.env.VITE_*` — only
 * VITE_-prefixed vars reach the bundle, so nothing secret can leak here.
 *
 * The admin API URL *is* the environment (design/admin-panel.md §4): there is
 * no stage flag to get out of sync, and the stage banner reads it directly.
 */
export const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:8788';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
