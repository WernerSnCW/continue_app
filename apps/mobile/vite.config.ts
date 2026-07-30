import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
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
});
