import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';

let contentScript = '';
type Capture = { snapshot: { blocks: { text: string }[] } };
const captures = (page: Page) => page.evaluate(() => (window as unknown as { __captures: Capture[] }).__captures);

test.beforeAll(async () => {
  const result = await build({ entryPoints: ['extension/content.ts'], bundle: true, format: 'iife', write: false });
  contentScript = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.goto('/example.html');
  await page.evaluate(() => {
    const scope = window as unknown as { __captures: Capture[]; chrome: unknown };
    scope.__captures = [];
    Object.defineProperty(scope, 'chrome', { configurable: true, value: {
      runtime: { sendMessage: (message: Capture) => { scope.__captures.push(message); return Promise.resolve(); } },
    } });
  });
  await page.addScriptTag({ content: contentScript });
  await expect.poll(async () => (await captures(page)).length).toBe(1);
});

test('extension emits changed source text without feedback from its own IDs or highlight', async ({ page }) => {
  await page.locator('[data-demo="hours"]').evaluate(element => { element.textContent = 'Hours changed for the extension test.'; });
  await expect.poll(async () => (await captures(page)).length).toBe(2);
  expect((await captures(page))[1].snapshot.blocks.some(block => block.text === 'Hours changed for the extension test.')).toBe(true);
  await page.locator('[data-demo="hours"]').evaluate(element => {
    element.setAttribute('data-brailly-id', element.getAttribute('data-brailly-id')!);
    (element as HTMLElement).style.outline = '3px solid green';
    element.setAttribute('tabindex', '-1');
  });
  await page.waitForTimeout(750);
  expect((await captures(page)).length).toBe(2);
});

test('continuous source mutations cannot postpone live capture beyond the deadline', async ({ page }) => {
  await page.evaluate(() => {
    let tick = 0;
    const timer = setInterval(() => {
      document.querySelector('[data-demo="hours"]')!.textContent = `Clock ${++tick}`;
    }, 80);
    setTimeout(() => clearInterval(timer), 2600);
  });
  await expect.poll(async () => (await captures(page)).length, { timeout: 2500, intervals: [100] }).toBeGreaterThanOrEqual(2);
  expect((await captures(page))[1].snapshot.blocks.some(block => /^Clock \d+$/.test(block.text))).toBe(true);
});

test('recapturing replaces the observer and avoids duplicate live messages', async ({ page }) => {
  await page.addScriptTag({ content: contentScript });
  await expect.poll(async () => (await captures(page)).length).toBe(2);
  await page.locator('[data-demo="hours"]').evaluate(element => { element.textContent = 'Only the newest capture observer sends this.'; });
  await expect.poll(async () => (await captures(page)).length).toBe(3);
  await page.waitForTimeout(750);
  expect((await captures(page)).length).toBe(3);
});
