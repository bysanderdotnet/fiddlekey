import { test, expect } from '@playwright/test';

// One lean spec. Runs against the production build (see playwright.config.js).

test('app loads, starts analyzing, no console or page errors', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Fiddlekey');
  await expect(page.locator('.key-badge')).toContainText('---');

  await page.click('#closeOnboarding');
  await expect(page.locator('#onboarding')).toBeHidden();

  // Click "Detect notes" to trigger getUserMedia + AudioWorklet + worker + detector init
  const detectButton = page.locator('#startButton');
  await detectButton.click();
  await expect(detectButton).toHaveText('Analyzing...', { timeout: 15_000 });
  await expect(detectButton).toBeDisabled();
  await expect(page.locator('#key-display')).toHaveClass(/is-listening/);

  // Give the worker and detector a few seconds to surface any async errors
  await page.waitForTimeout(4_000);

  expect(pageErrors, `Uncaught exceptions: ${pageErrors.join('\n')}`).toHaveLength(0);
  expect(
    consoleErrors.filter(msg => !msg.includes('AudioContext was not allowed to start')),
    `console.error calls: ${consoleErrors.join('\n')}`
  ).toHaveLength(0);
});

test('shows error when microphone permission is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new Error('Permission denied')),
      configurable: true
    });
  });

  await page.goto('/');
  await page.click('#closeOnboarding');

  const detectButton = page.locator('#startButton');
  await detectButton.click();

  await expect(page.locator('#error-message')).toContainText('Error: Microphone access is required');
  await expect(detectButton).toContainText('Detect notes');
  await expect(detectButton).toBeEnabled();
});
