import { test as base } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stock WebKit 26.6 rejects native IndexedDB Blob writes in ephemeral contexts.
// A new disk profile per test exercises normal Safari/PWA storage without sharing data.
// Use public APIs: https://playwright.dev/docs/test-fixtures#overriding-fixtures
export const test = base.extend({
  context: async (
    {
      browserName,
      browser,
      playwright,
      launchOptions,
      headless,
      contextOptions,
      acceptDownloads,
      baseURL,
      colorScheme,
      deviceScaleFactor,
      hasTouch,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      serviceWorkers,
      timezoneId,
      userAgent,
      viewport,
      actionTimeout,
      navigationTimeout,
    },
    use,
    testInfo,
  ) => {
    // Read option fixtures so test.use(), including the offline suite's SW policy, is respected.
    const options = {
      ...contextOptions,
      acceptDownloads,
      baseURL,
      colorScheme,
      deviceScaleFactor,
      hasTouch,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      // This Playwright version exposes screen as a context option, not an option fixture.
      screen: testInfo.project.use.screen ?? contextOptions.screen,
      serviceWorkers,
      timezoneId,
      userAgent,
      viewport,
    };
    const profile =
      browserName === 'webkit' ? await mkdtemp(join(tmpdir(), 'filmsamling-webkit-')) : null;
    let context;
    try {
      context = profile
        ? await playwright.webkit.launchPersistentContext(profile, {
            ...launchOptions,
            ...options,
            headless,
          })
        : await browser.newContext(options);
      context.setDefaultTimeout(actionTimeout);
      context.setDefaultNavigationTimeout(navigationTimeout);
      await use(context);
    } finally {
      try {
        await context?.close();
      } finally {
        if (profile) await rm(profile, { recursive: true, force: true });
      }
    }
  },
});

export { expect } from '@playwright/test';
