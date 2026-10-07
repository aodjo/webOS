import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    hmr: process.env.WEBOS_HMR === 'off' ? false : undefined, /** WEBOS_HMR=off: edits only show on a manual reload (no automatic reboots while files change in bulk). */
  },
  test: {
    environment: 'jsdom',
  },
});
