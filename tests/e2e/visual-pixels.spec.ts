import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { visualDocumentClip } from "../../server/browserbase";

test("pixel stability detects a visual changing after scrolling below the fold", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`
    <style>
      body { margin: 0; width: 3000px; height: 2800px; background: white; }
      #visual { position: absolute; left: 1600px; top: 1500px;
        width: 300px; height: 150px; background: red; }
    </style>
    <div id="visual" role="img" aria-label="Changing visual"></div>
  `);
  await page.locator("#visual").evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }),
  );
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  expect(scroll.x).toBeGreaterThan(0);
  expect(scroll.y).toBeGreaterThan(900);

  const viewportClip = await page.locator("#visual").evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const cdp = await page.context().newCDPSession(page);
  const pixelHash = async (clip: typeof viewportClip) => {
    // Stagehand forwards its screenshot clip unchanged to this CDP command.
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { ...clip, scale: 1 },
    });
    return createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");
  };
  const visualHash = async () =>
    pixelHash(await page.evaluate(visualDocumentClip, "#visual"));
  const before = await visualHash();
  const wrongRegionBefore = await pixelHash(viewportClip);
  expect(await visualHash()).toBe(before);

  await page.locator("#visual").evaluate((element) => {
    element.style.background = "blue";
  });

  // The former viewport-coordinate clip misses the changed pixels entirely.
  expect(await pixelHash(viewportClip)).toBe(wrongRegionBefore);
  expect(await visualHash()).not.toBe(before);
});
