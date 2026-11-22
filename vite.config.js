import { defineConfig } from 'vite';

// Vite serves index.html in development and bundles everything into `dist/`
// when you run `npm run build`. That `dist/` folder is what a host (e.g. Vercel)
// publishes.
export default defineConfig({
  // Bind to the port the harness assigns via PORT (falls back to Vite's default
  // for a plain `npm run dev`). Lets multiple dev servers coexist.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
    // Browser tests write reports beside the project. Those files are not game
    // source: watching them made the live dev tab reload in the middle of a
    // match whenever Playwright finished a test.
    watch: {
      ignored: ['**/playwright-report/**', '**/test-results/**', '**/dist/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
  // Vitest config: only run unit tests in src/.
  // The browser tests in e2e/ are run by Playwright, not Vitest.
  test: {
    include: ['src/**/*.test.js'],
  },
});
