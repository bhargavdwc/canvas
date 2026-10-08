import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/api/v1/ws': {
        target: 'ws://127.0.0.1:4000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'EPIPE') {
              return; // Browser tab refreshed or closed abruptly, ignore cleanly
            }
            console.error('[vite] ws proxy error:', err);
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err) => {
              const code = (err as NodeJS.ErrnoException)?.code;
              if (code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'EPIPE') {
                return;
              }
              console.error('[vite] ws socket error:', err);
            });
          });
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
  },
});
