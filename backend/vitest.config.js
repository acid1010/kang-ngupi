import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules/**'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js']
    }
  }
});
