import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 47310, proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3000' } },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
