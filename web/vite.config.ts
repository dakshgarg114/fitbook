import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  envDir: '..', // read VITE_* settings from the repo-root .env
  server: { proxy: { '/api': 'http://127.0.0.1:4310' } },
});
