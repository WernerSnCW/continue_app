import { readFileSync } from 'node:fs';
// Vitest's re-export of Vite's defineConfig, which additionally types the
// `test` block below. Keeping one config file means tests inherit `define`,
// and `__APP_VERSION__` is referenced by the code under test.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Stamped into cloud backups so a restored snapshot can be traced back to
    // the build that wrote it.
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    // jsdom for localStorage, which the store and the sync marker both use.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
