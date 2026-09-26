/** Opt-in real Browserbase request through the local HTTP route, not provider mocks. */
import { mkdir, writeFile } from "node:fs/promises";
import { consumeVisualStream } from "../src/visual-stream";
import type { VisualEvent } from "../shared/visual";
const base = process.env.BRAILLY_SMOKE_URL || "http://127.0.0.1:5183";
const url =
  process.argv[2] ||
  "https://www.dublinairport.com/flight-information/live-departures";
const task =
  process.argv[3] ||
  "Find the current flight status and gate for a flight to Madrid.";
const requestId = crypto.randomUUID();
const started = Date.now();
const events: { type: string; atMs: number }[] = [];
let snapshot: Extract<VisualEvent, { type: "snapshot" }> | undefined;
let terminal: Extract<VisualEvent, { type: "done" }> | undefined;
const failures: { stage: string; message: string }[] = [];
let classification: unknown;
let decisions: unknown;
const evidence: unknown[] = [];
const response = await fetch(base + "/api/visual-capture", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ requestId, url, task }),
  signal: AbortSignal.timeout(55000),
});
if (!response.ok)
  throw new Error(`Visual HTTP ${response.status}: ${await response.text()}`);
await consumeVisualStream(
  response,
  requestId,
  task,
  AbortSignal.timeout(55000),
  (event) => {
    events.push({ type: event.type, atMs: Date.now() - started });
    if (event.type === "snapshot") snapshot = event;
    if (event.type === "done") terminal = event;
    if (event.type === "dom-ranked")
      classification = {
        model: event.classification.model,
        latencyMs: event.classification.latencyMs,
        blocksScored: event.classification.results.length,
        top: event.classification.results
          .toSorted((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((r) => ({
            ...r,
            text: snapshot?.page.blocks.find((b) => b.id === r.id)?.text,
          })),
      };
    if (event.type === "visual-decisions") decisions = event.decisions;
    if (event.type === "visual-evidence") evidence.push(...event.evidence);
    if (event.type === "stage-error")
      failures.push({ stage: event.stage, message: event.message });
  },
);
const result = {
  checkedAt: new Date().toISOString(),
  url,
  task,
  httpStatus: response.status,
  mime: response.headers.get("content-type"),
  finalUrl: snapshot?.page.url,
  title: snapshot?.page.title,
  blocks: snapshot?.page.blocks.length,
  sourceSample: snapshot?.page.blocks.slice(0, 5).map((b) => b.text),
  classification,
  decisions,
  evidence,
  events,
  coverage: terminal?.coverage,
  metrics: terminal?.metrics,
  status: terminal?.status,
  sessionClosed: terminal?.sessionClosed,
  failures,
  verification:
    "Real Browserbase through local HTTP NDJSON route and production client parser. This does not verify streaming on the deployed hosting platform.",
};
await mkdir("artifacts/integration", { recursive: true });
await writeFile(
  `artifacts/integration/visual-http-${new URL(url).hostname}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
