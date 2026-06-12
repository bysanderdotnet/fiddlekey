import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __MODEL_BASE_URL__: JSON.stringify('https://r2-fiddlekey.bysander.net'),
  },
  test: {
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
});
