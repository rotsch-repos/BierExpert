import { defineConfig, devices } from '@playwright/test';

/**
 * Die Tests fahren gegen den Produktions-Build, nicht gegen den Dev-Server:
 * geprüft werden soll, was ausgeliefert wird.
 *
 * PLAYWRIGHT_CHROMIUM_PATH ist für Umgebungen, in denen ein Chromium schon
 * bereitliegt und Playwright seines nicht nachladen soll. Ist die Variable
 * nicht gesetzt — so in der CI —, nimmt Playwright den selbst installierten
 * Browser. Damit steht kein Pfad einer einzelnen Maschine im Repository.
 */
const eigenerBrowser = process.env['PLAYWRIGHT_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // In der CI darf kein test.only durchrutschen.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(eigenerBrowser ? { launchOptions: { executablePath: eigenerBrowser } } : {}),
  },

  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobil', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
