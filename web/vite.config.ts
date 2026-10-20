import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The guest portal and e-mail renderers are shared with the server, so the editor preview is exact
  resolve: { alias: { '@shared': fileURLToPath(new URL('../server/src/shared', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080', '/portal': 'http://localhost:8080' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
