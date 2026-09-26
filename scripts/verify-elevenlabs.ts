/** Opt-in live check: node --import tsx scripts/verify-elevenlabs.ts
 * Generates one short passage using .env; writes only safe verification metadata.
 * API: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
 */
import { config as dotenv } from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { getTtsConfig, synthesizeSpeech } from "../server/elevenlabs.js";
dotenv({ quiet: true });
const config = { ...getTtsConfig(), enabled: true };
const passage =
  "Brailly reads the selected passage. The accessible entrance is on the east side.";
const started = Date.now();
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  provider: "ElevenLabs",
  endpoint: "/v1/text-to-speech/:voice_id/stream",
  model: config.modelId,
  characters: passage.length,
  voiceConfigured: !!config.voiceId,
  outputFormat: "mp3_44100_128",
  check:
    "Actual provider request; bounded MP3 response, header signature and bytes checked. This check does not assess pronunciation or speaker playback.",
};
try {
  const bytes = await synthesizeSpeech(passage, config, {
    fetch: async (...args) => {
      const response = await fetch(...args);
      report.httpStatus = response.status;
      report.contentType = response.headers.get("content-type");
      return response;
    },
  });
  const mp3 =
    bytes.subarray(0, 3).toString() === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!mp3)
    throw new Error("Response does not start with an MP3 frame or ID3 header.");
  report.status = "passed";
  report.audioBytes = bytes.length;
  report.sha256 = createHash("sha256").update(bytes).digest("hex");
  report.mp3HeaderVerified = true;
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error ? error.message : "TTS verification failed.";
  process.exitCode = 1;
}
report.elapsedMs = Date.now() - started;
await mkdir("artifacts/integration", { recursive: true });
await writeFile(
  "artifacts/integration/elevenlabs.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
