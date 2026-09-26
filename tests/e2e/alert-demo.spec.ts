import { test, expect } from '@playwright/test';
import type { PageSnapshot } from '../../shared/dom';

for (const choice of ['INTERRUPT', 'DEFER'] as const) {
  test(`alert demo shows the actual ${choice} decision and preserves the previous reading`, async ({ page }) => {
    let updates = 0;
    await page.route('**/api/rank', route => {
      const { page: snapshot, context, task } = route.request().postDataJSON() as { page: PageSnapshot; context?: unknown; task: string };
      if (context) updates++;
      return route.fulfill({ json: {
        snapshotId: snapshot.id, task, model: 'TEST-ONLY-MOCK', latencyMs: 25,
        results: snapshot.blocks.map(block => ({ id: block.id, category: 'CONTENT', score: block.text.startsWith('Street elevator') ? 3 : 1, priority: 'NOW', confidence: .95 })),
        transition: context ? { choice, confidence: .95 } : undefined,
        usage: { input_tokens: 100, output_tokens: 50 },
      } });
    });
    await page.goto('/');
    await expect(page.locator('.live-status')).toContainText('rendered DOM blocks ready');
    await page.getByRole('button', { name: 'Play alert demo', exact: true }).click();
    await expect(page.locator('#reading-output')).toHaveValue(/^Street elevator in service/);
    const before = await page.locator('#reading-output').inputValue();
    await expect(page.locator('.change-source-alert')).toContainText('Street elevator out of service', { timeout: 15000 });
    await expect(page.locator('.change-decision')).toContainText(choice);
    expect(updates).toBe(1);
    if (choice === 'INTERRUPT') {
      await expect(page.locator('#reading-output')).toHaveValue(/^Street elevator out of service/);
      await expect(page.locator('.change-decision')).toHaveAttribute('role', 'alert');
      await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
    } else {
      await expect(page.locator('.change-decision')).toContainText('Reading held');
      await expect(page.getByRole('button', { name: 'Resume reading', exact: true })).toHaveCount(0);
    }
    await expect(page.locator('#reading-output')).toHaveValue(before);
    await page.getByRole('tab', { name: 'Analyze', exact: true }).click();
    await expect(page.frameLocator('iframe').locator('#route')).toHaveAttribute('role', 'alert');
  });
}

test('all four devices fit without clipping at mobile, tablet and desktop widths', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Read', exact: true }).click();
  for (const width of [360, 820, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const model of ['20', '40', '40-focus', '80']) {
      await page.getByLabel('Display cells', { exact: true }).selectOption(model);
      const overflow = await page.locator('.hw-workspace').evaluate(workspace => {
        const area = workspace.getBoundingClientRect();
        const elements = workspace.querySelectorAll('.hw-device,.hw-dots,.hw-thumb-controls > button,.hw-model-select select');
        return [...elements].filter(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < area.left - 1 || bounds.right > area.right + 1;
        }).map(element => element.className);
      });
      expect(overflow, `${model} cells at ${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
