import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.FILMSAMLING_TEST_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ugyldig testport.');
const baseURL = `http://127.0.0.1:${port}/min-filmsamling/`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    {
      name: 'iphone-chromium',
      use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: `pnpm preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
