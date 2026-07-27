import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Needed so the dev server is reachable from the host when run in Docker.
    host: true,
    strictPort: true,
    // On Windows, file-change events don't propagate across the bind mount into
    // the container, so native watching never fires. Poll instead so HMR works.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
