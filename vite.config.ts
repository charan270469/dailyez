import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Frontend is pinned to port 3000 — strictPort makes Vite error out
      // instead of silently moving to another port (which would break the proxy).
      port: 3000,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR === 'true' to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': 'http://localhost:3001',
        '/auth/google': 'http://localhost:3001',
      },
    },
    preview: {
      // `vite preview` serves the production build on the same port 3000.
      port: 3000,
      strictPort: true,
      proxy: {
        '/api': 'http://localhost:3001',
        '/auth/google': 'http://localhost:3001',
      },
    },
  };
});
