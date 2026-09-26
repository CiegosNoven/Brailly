/** Opt-in paid smoke: run against an already running local server with TTS enabled. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BRAILLY_SMOKE_URL || "http://127.0.0.1:5183";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio {
      constructor(src?: string) {
        super(src);
        (window as unknown as { __smokeAudio: HTMLAudioElement }).__smokeAudio =
          this;
      }
    };
  });
  await page.goto(base);
  await page.locator(".queue-item").first().waitFor();
  await page.getByLabel("Voice provider").selectOption("elevenlabs");
  await page.getByRole("tab", { name: "Read", exact: true }).click();
  const responsePromise = page.waitForResponse((r) =>
    r.url().endsWith("/api/tts"),
  );
  const start = Date.now();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const response = await responsePromise;
  if (response.status() !== 200)
    throw new Error(`TTS endpoint returned ${response.status()}`);
  const httpMs = Date.now() - start;
  await page.waitForFunction(
    () => {
      const audio = (window as unknown as { __smokeAudio?: HTMLAudioElement })
        .__smokeAudio;
      return (
        !!audio &&
        (audio.currentTime > 0 ||
          document.body.textContent?.includes("Audio is ready."))
      );
    },
    undefined,
    { timeout: 15000 },
  );
  const manualPlay = await page
    .getByRole("button", { name: "Play audio", exact: true })
    .isVisible();
  if (manualPlay)
    await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await page.waitForFunction(
    () =>
      ((window as unknown as { __smokeAudio?: HTMLAudioElement }).__smokeAudio
        ?.currentTime || 0) > 0,
    undefined,
    { timeout: 10000 },
  );
  const audio = await page.evaluate(() => {
    const a = (window as unknown as { __smokeAudio: HTMLAudioElement })
      .__smokeAudio;
    return {
      durationSeconds: a.duration,
      currentTimeSeconds: a.currentTime,
      readyState: a.readyState,
      error: a.error?.code || null,
    };
  });
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  if (await stop.isVisible()) await stop.click();
  const result = {
    checkedAt: new Date().toISOString(),
    base,
    httpStatus: response.status(),
    mime: response.headers()["content-type"],
    httpMs,
    manualPlay,
    ...audio,
    verification:
      "Real server and ElevenLabs response decoded and advanced in Chromium HTMLAudioElement. Headless playback; audible speaker quality not evaluated.",
  };
  await mkdir("artifacts/integration", { recursive: true });
  await writeFile(
    "artifacts/integration/reader-speech.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
