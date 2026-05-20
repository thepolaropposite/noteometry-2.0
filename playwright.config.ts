import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Noteometry OS dev regression sweeps.
 *
 * The dev server is expected to already be running at
 * http://localhost:5173/ — Playwright does not start vite for us so we
 * can re-run tests in parallel with a long-lived dev session.
 *
 * If the dev server is not up the suite will fail fast with a
 * connection error, which is fine — the readme/regression report
 * explains the prerequisite.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    actionTimeout: 5000,
    navigationTimeout: 15000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
