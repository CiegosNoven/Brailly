import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import AxeBuilder from '@axe-core/playwright';
import type { DomBlock, PageSnapshot } from '../../shared/dom';

let contentScript: string;
type FixtureWindow = Window & {
  __captures: { snapshot: PageSnapshot }[];
  __listeners: ((message: unknown, sender: unknown, respond: (value: unknown) => void) => void)[];
  __braillyLiveCapture: { stop: () => void };
};
test.beforeAll(async () => {
  contentScript = (await build({ entryPoints: ['extension/content.ts'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
});
async function source(page: Page) {
  await page.goto('/controls-demo.html');
  await page.evaluate(() => {
    const w = window as unknown as FixtureWindow & { __BRAILLY_EXTENSION_CAPTURE: unknown };
    w.__captures = []; w.__listeners = [];
    w.__BRAILLY_EXTENSION_CAPTURE = { token: 'test-token', url: location.href };
    Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: {
      id: 'test-extension', sendMessage: async (message: {snapshot: PageSnapshot}) => { w.__captures.push(message); },
      onMessage: { addListener: (fn: FixtureWindow['__listeners'][0]) => w.__listeners.push(fn), removeListener: (fn: FixtureWindow['__listeners'][0]) => { w.__listeners = w.__listeners.filter(item => item !== fn); } },
    } } });
  });
  await page.addScriptTag({ content: contentScript });
}
async function block(page: Page, text: string) {
  return page.evaluate(text => (window as unknown as FixtureWindow).__captures.at(-1)!.snapshot.blocks.find(item => item.text === text && item.tag !== 'label')!, text);
}
async function operate(page: Page, selected: DomBlock, requestId: string = crypto.randomUUID(), token = 'test-token') {
  return page.evaluate(({selected, requestId, token}) => {
    let result: {ok: boolean; message: string} | undefined;
    (window as unknown as FixtureWindow).__listeners[0]({ type: 'operate-control', token, url: location.href, requestId, block: selected }, {id: 'test-extension'}, value => { result = value as typeof result; });
    return result!;
  }, {selected, requestId, token});
}

test('extension activates the real button, captures its update and rejects duplicate requests', async ({page}) => {
  await source(page);
  const selected = await block(page, 'Show access information');
  expect((await operate(page, selected, 'once')).ok).toBe(true);
  await expect(page.locator('#route')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__captures.at(-1)!.snapshot.blocks.some(item => item.text.startsWith('Use the east entrance')))).toBe(true);
  expect((await operate(page, selected, 'once')).ok).toBe(false);
  await expect(page.locator('#route')).toBeVisible();
});

test('extension rejects stale, hidden, disabled and wrong-session controls without clicking', async ({page}) => {
  await source(page);
  const selected = await block(page, 'Show access information');
  expect((await operate(page, selected, 'wrong', 'other-token')).ok).toBe(false);
  await page.locator('#access').evaluate(node => node.setAttribute('disabled', ''));
  expect((await operate(page, selected)).message).toContain('disabled');
  await page.locator('#access').evaluate(node => { node.removeAttribute('disabled'); node.textContent = 'A different action'; });
  expect((await operate(page, selected)).ok).toBe(false);
  await page.locator('#access').evaluate(node => { node.textContent = 'Show access information'; (node as HTMLElement).hidden = true; });
  expect((await operate(page, selected)).ok).toBe(false);
  await expect(page.locator('#route')).toBeHidden();
});

test('extension focuses fields and refuses a link whose destination changed', async ({page}) => {
  await source(page);
  expect((await operate(page, await block(page, 'Visitor name'))).ok).toBe(true);
  await expect(page.locator('#visitor')).toBeFocused();
  const selected = await block(page, 'Open the museum demo');
  await page.getByRole('link', {name: selected.text}).evaluate(node => node.setAttribute('href', '/access-demo.html'));
  expect((await operate(page, selected)).ok).toBe(false);
  await expect(page).toHaveURL(/controls-demo.html$/);
  await page.evaluate(() => (window as unknown as FixtureWindow).__braillyLiveCapture.stop());
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__listeners.length)).toBe(0);
});

test('keyboard search selects a captured link and Enter follows it from the Braille line', async ({page}) => {
  await page.route('**/api/config', route => route.fulfill({json:{jevConfigured:false}}));
  await page.route('**/api/rank', route => route.fulfill({status:503,json:{error:'Test: model unavailable'}}));
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
  await page.keyboard.press('Alt+k');
  await expect(page.getByRole('dialog', {name:'Find a control'})).toBeVisible();
  await expect(page.getByLabel('Button, link, or field name')).toBeFocused();
  await page.getByLabel('Button, link, or field name').fill('Book your tickets');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#reading-output')).toBeFocused();
  await expect(page.locator('#reading-output')).toHaveValue('Book your tickets');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Website', {exact:true})).toHaveValue(/museum-tickets.html$/);
});

test('search has an empty state, closes with Escape, and fits a narrow viewport', async ({page}) => {
  await page.route('**/api/config', route => route.fulfill({json:{jevConfigured:false}}));
  await page.setViewportSize({width:360,height:800});
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
  await page.getByRole('button', {name:/Find a control/}).click();
  await page.getByLabel('Button, link, or field name').fill('no-such-control');
  await expect(page.getByText('No matching controls.', {exact:false})).toBeVisible();
  expect((await new AxeBuilder({page}).include('.control-dialog').analyze()).violations).toEqual([]);
  expect(await page.locator('.control-dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name:/Find a control/})).toBeFocused();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
