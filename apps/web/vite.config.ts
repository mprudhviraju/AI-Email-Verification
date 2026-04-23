import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/graphql': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        ws: true,
      },
      '/export': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});
