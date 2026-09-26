import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('reader controls and hardware dialog have no automated accessibility violations', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
  // Third-party source pages have their own accessibility; audit Braily's controls.
  const scan = () => new AxeBuilder({page}).exclude('iframe').analyze();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', {name:'Compatible devices'}).click();
  expect((await scan()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Display cells').selectOption('80');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
