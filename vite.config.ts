/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run test:fuzz` runs the slow whole-run fuzz tests (tests/*.slow.ts) instead of the normal suite.
const fuzz = process.env.npm_lifecycle_event === 'test:fuzz';

export default defineConfig({
  plugins: [react()],
  test: {
    include: fuzz ? ['tests/**/*.slow.ts'] : ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
