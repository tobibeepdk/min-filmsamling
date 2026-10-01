import { defineConfig } from 'vite';
export default defineConfig({
  base: '/min-filmsamling/',
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node' },
  build: { sourcemap: false },
});
