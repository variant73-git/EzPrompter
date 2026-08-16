import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
    // The design-eval package lives outside this directory but is exercised by the
    // same suite: when its checks were extracted into @uncraft/design-eval, their
    // tests left the runner's reach and 58 of them silently stopped running. One
    // command still covers both.
    include: ['**/*.test.{js,jsx}', '../design-eval/src/**/*.test.js'],
    exclude: ['node_modules', '.next', '**/node_modules/**'],
  },
  resolve: {
    alias: {
      '@': '/Users/adilsonporto/Desktop/IA/Uncraft/packages/web-shell',
    },
  },
});
