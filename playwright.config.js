import { defineConfig, devices } from '@playwright/test';

// Playwright runs the browser tests in e2e/.
// Before testing, it builds the game and starts Vite's preview server,
// then points the tests at it. This mirrors the real production build.
export default defineConfig({
  testDir: './e2e',
  // Each game tab owns a WebGL context. Running several at once overloads the
  // software renderer and turns responsive gameplay checks into timeouts.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
