import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
    include: ['**/*.test.{js,jsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': '/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell',
    },
  },
});
