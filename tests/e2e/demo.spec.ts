import { test, expect, type Page } from '@playwright/test';

async function mockJev(page: Page, delay = 0) {
  await page.route('**/api/rank', async route => {
    const { page: snapshot, task, context } = route.request().postDataJSON();
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

const output = (page: Page) => page.getByRole('textbox', { name: 'Stable reading output' });
const openJev = async (page: Page) => {
  if (!await page.locator('.jev-details').evaluate(element => (element as HTMLDetailsElement).open)) {
    await page.locator('.jev-details > summary').click();
  }
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
});

test('loads real example DOM without fabricated Jev scores', async ({ page }) => {
  await expect(output(page)).toHaveValue('The Harbor Museum');
  await expect(page.frameLocator('iframe').getByText('Open Tuesday–Sunday, 10 am–6 pm. Closed Mondays.', { exact: true })).toBeVisible();
  await openJev(page);
  await expect(page.locator('.classification-results')).toHaveCount(0);
  await expect(page.locator('.jev-metrics')).toContainText('N/A');
  await expect(page.locator('.jev-details > summary')).toContainText('Score + Choice');
});

test('classification updates order, source selection, voice control and Braille output', async ({ page }) => {
  await mockJev(page);
  await page.getByRole('button', { name: 'Read page', exact: true }).click();
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await openJev(page);
  await expect(page.locator('.classification-results button').first()).toContainText('3.0 / 3');
  await expect(page.locator('.physical-cell i.raised').first()).toBeVisible();
  await expect(page.locator('.jev-details > summary')).toContainText('160 tokens');
  await page.getByRole('button', { name: 'Next block', exact: true }).click();
  await expect(output(page)).not.toHaveValue(/Open Tuesday/);
  await page.getByLabel('Reading block').selectOption({ index: 0 });
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await page.frameLocator('iframe').getByRole('heading', { name: 'Tickets', exact: true }).click();
  await expect(output(page)).toHaveValue('Tickets');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByLabel('Reading block')).toBeVisible();
  await expect(page.locator('iframe')).toBeVisible();
});

test('task change invalidates in-flight classification', async ({ page }) => {
  await mockJev(page, 1200);
  const request = page.waitForRequest('**/api/rank');
  await page.getByRole('button', { name: 'Read page', exact: true }).click();
  await request;
  await page.getByLabel('Find', { exact: true }).fill('Find membership information instead');
  await page.waitForTimeout(1500);
  await expect(page.locator('.classification-results')).toHaveCount(0);
  await expect(output(page)).toHaveValue('The Harbor Museum');
  await expect(page.getByRole('button', { name: 'Read page', exact: true })).toBeEnabled();
});

test('API failure preserves exact reading and never fabricates fallback scores', async ({ page }) => {
  await page.route('**/api/rank', route => route.fulfill({ status: 503, json: { error: 'Live Jev needs an API key.' } }));
  const before = await output(page).inputValue();
  await page.getByRole('button', { name: 'Read page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API key');
  await expect(output(page)).toHaveValue(before);
  await expect(page.locator('.classification-results')).toHaveCount(0);
});

test('mobile layout, hardware disclosure and downloadable extension', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Compatible devices' }).click();
  await expect(page.getByRole('dialog')).toContainText('No physical display');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Get extension', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download the extension ZIP' })).toHaveAttribute('href', '/brailly-extension.zip');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('iframe mutations defer noise, interrupt a route change and restore the retained line', async ({ page }) => {
  await mockJev(page);
  await page.getByRole('button', { name: 'Read page', exact: true }).click();
  await expect(output(page)).toHaveValue(/Open Tuesday/);
  await page.getByRole('button', { name: 'Next line', exact: true }).click();
  const retained = await output(page).inputValue();
  await openJev(page);
  await page.locator('.demo-controls > summary').click();
  await page.getByRole('button', { name: 'Change offer', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('DEFER');
  await expect(output(page)).toHaveValue(retained);
  await expect(page.frameLocator('iframe').locator('[data-demo="noise"]')).toContainText('Member shop offer refreshed');
  await page.getByRole('button', { name: 'Close entrance', exact: true }).click();
  await expect(page.locator('.transition').first()).toHaveText('INTERRUPT');
  await expect(output(page)).toHaveValue(/Harbor Street entrance is now closed/);
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  await expect(output(page)).toHaveValue(retained);
  await expect(page.locator('.jev-metrics')).toContainText('120');
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
  await page.frameLocator('iframe').getByText('Return to museum', { exact: true }).click();
  await expect(page.getByLabel('Website', { exact: true })).toHaveValue(/example.html/);
});
