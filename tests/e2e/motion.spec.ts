import {test, expect} from '@playwright/test';

test('decorative Braille respects reduced motion and a keyboard pause survives reload', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/config', route => route.fulfill({json:{jevConfigured:false,model:'TEST-ONLY-MOCK'}}));
  await page.goto('/');
  const canvas = page.locator('.braille-field canvas');
  await expect(canvas).toHaveAttribute('aria-hidden','true');
  await expect(canvas).toHaveAttribute('data-playing','false');
  const play = page.getByRole('button',{name:'Play animation',exact:true});
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-playing','true');
  const initialFrame = await canvas.getAttribute('data-frame');
  await expect.poll(() => canvas.getAttribute('data-frame')).not.toBe(initialFrame);
  const pause = page.getByRole('button',{name:'Pause animation',exact:true});
  await pause.focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-playing','false');
  const pausedFrame = await canvas.getAttribute('data-frame');
  await page.locator('.hero').hover({position:{x:50,y:50}});
  // Allow several animation ticks: a paused pointer wake must stay still too.
  await page.waitForTimeout(150);
  await expect(canvas).toHaveAttribute('data-frame',pausedFrame!);
  expect(await page.evaluate(() => localStorage.getItem('brailly-motion'))).toBe('off');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.reload();
  await expect(canvas).toHaveAttribute('data-playing','false');
  await expect(page.getByRole('button',{name:'Play animation',exact:true})).toBeVisible();
});
