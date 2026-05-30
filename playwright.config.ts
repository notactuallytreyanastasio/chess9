import { defineConfig, devices } from '@playwright/test';

// E2E against the self-contained single-file artifacts (loaded over file://), so no dev
// server is needed. Default target is the Temper-backed build (dist-temper/index.html).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
  },
});
