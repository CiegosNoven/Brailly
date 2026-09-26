import { test, expect, type Page } from '@playwright/test';

async function mockJev(page: Page, delay = 0, release?: Promise<void>) {
  await page.route('**/api/rank', async route => {
    const { page: snapshot, task, context } = route.request().postDataJSON();
    if (release) await release;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const results = snapshot.blocks.map((block: { id: string; text: string }) => {
      const relevant = block.text.includes('Open Tuesday');
      return {
        id: block.id, category: 'CONTENT', score: relevant ? 3 : 1,
        confidence: .9, categoryConfidence: .9, priority: relevant ? 'NOW' : 'LATER',
        probabilities: { '0': 0, '1': relevant ? 0 : 1, '2': 0, '3': relevant ? 1 : 0 },
      };
    });
    const interrupt = snapshot.blocks.some((block: { text: string }) => block.text.includes('Harbor Street entrance is now closed'));
    await route.fulfill({ json: {
      snapshotId: snapshot.id, task, model: 'TEST-ONLY-MOCK', latencyMs: 12, results,
      usage: { input_tokens: 120, output_tokens: 40 },
      transition: context ? { choice: interrupt ? 'INTERRUPT' : 'DEFER', confidence: .95, probabilities: { DEFER: interrupt ? .05 : .95, INTERRUPT: interrupt ? .95 : .05 } } : undefined,
      request: { testOnly: true }, source: 'Jev',
    } });
  });
}

const output = (page: Page) => page.locator('#reading-output');
const tab = async (page: Page, name: 'Analyze' | 'Read') => page.getByRole('tab', { name, exact: true }).click();
const openJev = async (page: Page) => {
  await tab(page, 'Analyze');
  if (!await page.locator('.jev-details').evaluate(element => (element as HTMLDetailsElement).open)) {
    await page.locator('.jev-details > summary').click();
  }
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
});

test('loads real DOM into the queue without fabricated Jev scores', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Analyze', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.frameLocator('iframe').getByText('Open Tuesday–Sunday, 10 am–6 pm. Closed Mondays.', { exact: true })).toBeVisible();
  await expect(page.locator('.queue-item')).toHaveCount(24);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await expect(page.locator('.queue-status')).toContainText('awaiting Jev');
  await openJev(page);
  await expect(page.locator('.jev-metrics')).toContainText('N/A');
  await tab(page, 'Read');
  await expect(output(page)).toBeVisible();
  await expect(output(page)).toHaveValue('The Harbor Museum');
  await expect(page.locator('.queue-current')).toContainText('The Harbor Museum');
});

test('one batch scores the queue, then source and queue selection drive the display', async ({ page }) => {
  let finish!: () => void;
  const release = new Promise<void>(resolve => { finish = resolve; });
  await mockJev(page, 0, release);
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.locator('.queue-status')).toContainText('scoring all 24 blocks');
  await expect(page.locator('.queue-score').filter({ hasText: 'Pending' })).toHaveCount(24);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  finish();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await expect(page.locator('.queue-item').first()).toContainText('Open Tuesday');
  await expect(page.locator('.queue-score').first()).toContainText('3.0 / 3');
  await expect(page.locator('.queue-score b')).toHaveCount(24);
  await openJev(page);
  await expect(page.locator('.jev-details > summary')).toContainText('160 tokens');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await expect(page.locator('.physical-cell i.raised').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next block', exact: true }).click();
  await expect(output(page)).not.toHaveValue(/Open Tuesday/);
  await tab(page, 'Analyze');
  await page.locator('.queue-item').first().click();
  await expect(page.getByRole('tab', { name: 'Read', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await expect(page.locator('.queue-item').first()).toHaveAttribute('aria-current', 'true');
  await tab(page, 'Analyze');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Tickets', exact: true }).click();
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue('Tickets');
  await expect(page.locator('.queue-current')).toContainText('Tickets');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
});

test('task change invalidates in-flight classification', async ({ page }) => {
  await mockJev(page, 1200);
  const request = page.waitForRequest('**/api/rank');
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await request;
  await page.getByLabel('Find', { exact: true }).fill('Find membership information instead');
  await page.waitForTimeout(1500);
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await expect(page.locator('.queue-status')).toContainText('awaiting Jev');
  await expect(page.getByRole('button', { name: 'Analyze page', exact: true })).toBeEnabled();
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue('The Harbor Museum');
});

test('API failure preserves exact reading and never fabricates fallback scores', async ({ page }) => {
  await page.route('**/api/rank', route => route.fulfill({ status: 503, json: { error: 'Live Jev needs an API key.' } }));
  const before = await output(page).inputValue();
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API key');
  await expect(page.locator('.queue-score b')).toHaveCount(0);
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(before);
});

test('mobile tabs, hardware disclosure and downloadable extension', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await tab(page, 'Read');
  await page.getByRole('button', { name: 'Compatible devices' }).click();
  await expect(page.getByRole('dialog')).toContainText('No physical display');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Get extension', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download the extension ZIP' })).toHaveAttribute('href', '/brailly-extension.zip');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tab(page, 'Analyze');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('page changes and reading position survive tab switches, interruption and resume', async ({ page }) => {
  await mockJev(page);
  await page.getByRole('button', { name: 'Analyze page', exact: true }).click();
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await page.getByRole('button', { name: 'Next line', exact: true }).click();
  const retained = await output(page).inputValue();
  const frameToken = await page.locator('iframe').getAttribute('data-token');
  await openJev(page);
  await page.locator('.demo-controls > summary').click();
  await page.getByRole('button', { name: 'Change offer', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('DEFER');
  await expect(page.frameLocator('iframe').locator('[data-demo="noise"]')).toContainText('Member shop offer refreshed');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(retained);
  await tab(page, 'Analyze');
  await expect(page.locator('iframe')).toHaveAttribute('data-token', frameToken!);
  await expect(page.frameLocator('iframe').locator('[data-demo="noise"]')).toContainText('Member shop offer refreshed');
  await page.getByRole('button', { name: 'Close entrance', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('INTERRUPT');
  await expect(page.locator('.jev-metrics')).toContainText('120');
  await tab(page, 'Read');
  await expect(output(page)).toHaveValue(/Harbor Street entrance is now closed/);
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  await expect(output(page)).toHaveValue(retained);
  await page.getByLabel('Display cells').selectOption('20');
  await expect(page.locator('.physical-cell')).toHaveCount(20);
  await page.getByLabel('Display cells').selectOption('80');
  await expect(page.locator('.physical-cell')).toHaveCount(80);
});

test('links navigate within the preview and trigger a new classification', async ({ page }) => {
  await mockJev(page);
  await page.frameLocator('iframe').getByText('Book your tickets', { exact: true }).click();
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue(/museum-tickets.html/);
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Your next visit.' })).toBeVisible();
  await openJev(page);
  await expect(page.locator('.call-destination')).toContainText('TEST-ONLY-MOCK');
  await expect(page.locator('.queue-status')).toContainText('Ready');
  await page.frameLocator('iframe').getByText('Return to museum', { exact: true }).click();
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue(/example.html/);
});
