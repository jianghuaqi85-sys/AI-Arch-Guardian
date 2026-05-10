import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['scanner.js', 'auditor.js', 'reporter.js', 'patcher.js'],
      exclude: ['tests/**', 'node_modules/**']
    },
    testTimeout: 30000,
    hookTimeout: 30000
  }
});