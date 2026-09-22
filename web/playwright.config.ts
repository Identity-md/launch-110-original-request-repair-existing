import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 40000, outputDir: '../test/scratch/playwright-results',
  reporter: [['list'], ['json', { outputFile: '../docs/frontend/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173/ipfs/work/', headless: true,
    launchOptions: { executablePath: process.env.CHROME_PATH } },
  webServer: { command: 'node scripts/serve.mjs', port: 4173, reuseExistingServer: false },
});
