import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { localSessionPlugin, STAGING_ADMIN_API_URL } from './dev/local-session';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'ADMIN_LOCAL_']);
  const apiUrl = env.VITE_ADMIN_API_URL ?? '';
  const localSession = command === 'serve' && apiUrl.replace(/\/$/, '') === STAGING_ADMIN_API_URL;
  return {
    plugins: [
      react(),
      tailwindcss(),
      localSessionPlugin(apiUrl, env.ADMIN_LOCAL_OPERATOR_EMAIL ?? '', env.ADMIN_LOCAL_AWS_PROFILE),
    ],
    define: { 'import.meta.env.VITE_LOCAL_ADMIN_SESSION': JSON.stringify(String(localSession)) },
  };
});
