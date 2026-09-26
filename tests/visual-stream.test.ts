import test from "node:test";
import assert from "node:assert/strict";
import { VisualEventParser, consumeVisualStream } from "../src/visual-stream";
import {
  VISUAL_MAX_EVENT_BYTES,
  type VisualEvent,
  type VisualCandidate,
  type VisualEvidence,
  type VisualCoverage,
} from "../shared/visual";
const base = {
  requestId: "request",
  snapshotId: "snapshot",
  captureId: "capture",
};
const candidate: VisualCandidate = {
  candidateId: "v1",
  kind: "svg",
  altStatus: "missing",
  sourceAltText: null,
  title: "",
  caption: "Map",
  accessibleName: "",
  nearbyHeading: "Entrance",
  nearbyText: "",
  control: null,
  width: 500,
  height: 400,
  x: 0,
  y: 0,
  hidden: false,
  locator: '[data-brailly-visual="v1"]',
  signature: "map-signature",
  asset: "",
};
const coverage: VisualCoverage = {
  totalCandidates: 1,
  includedCandidates: 1,
  inspected: 0,
  sourceAlt: 0,
  skipped: 0,
  uninspected: 1,
  hidden: 0,
  truncated: false,
  domSkipped: false,
  blockedRequests: 0,
  unsupported: ["CSS backgrounds", "iframes", "shadow DOM"],
};
const snapshot: VisualEvent = {
  ...base,
  type: "snapshot",
  sequence: 1,
  page: {
    id: "snapshot",
    url: "https://demo.example/",
    title: "Museo 🗺",
    blocks: [
      {
        id: "b1",
        text: "Texto fuente original.",
        tag: "p",
        role: "text",
        region: "main",
        order: 0,
      },
    ],
    capturedAt: "2026-09-26T00:00:00Z",
    source: "browserbase",
    totalCandidates: 1,
    truncated: false,
  },
  candidates: [candidate],
  coverage,
};
const evidence: VisualEvidence = {
  ...base,
  candidateId: "v1",
  signature: "map-signature",
  sourceAltText: null,
  generatedDescription: "La entrada está al norte.",
  recognizedText: "Entrada",
  uncertainty: "No se ve la pendiente.",
  observedAt: "2026-09-26T00:00:01Z",
  method: "stagehand-vision",
  model: "test",
  score: 3,
  confidence: 0.9,
  priority: "NOW",
};
const ranked: VisualEvent = {
  ...base,
  type: "dom-ranked",
  sequence: 2,
  classification: {
    snapshotId: "snapshot",
    task: "Find entrance",
    model: "test",
    latencyMs: 2,
    source: "Jev",
    request: {},
    results: [
      {
        id: "b1",
        category: "CONTENT",
        score: 3,
        confidence: 1,
        probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 },
        categoryConfidence: 1,
        priority: "NOW",
      },
    ],
  },
};
const details: VisualEvent = {
  ...base,
  type: "visual-evidence",
  sequence: 3,
  evidence: [evidence],
};
const done: VisualEvent = {
  ...base,
  type: "done",
  sequence: 4,
  status: "complete",
  coverage,
  metrics: {
    totalMs: 5,
    loadMs: 1,
    domMs: 1,
    selectionMs: 1,
    visionMs: 1,
    priorityMs: 1,
  },
  sessionClosed: true,
};
const encode = (events: unknown[]) =>
  new TextEncoder().encode(
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );

test("NDJSON decoder survives every byte boundary including UTF-8 and multiple lines", () => {
  const parser = new VisualEventParser("request", "Find entrance");
  const received: VisualEvent[] = [];
  for (const byte of encode([snapshot, ranked, details, done]))
    received.push(...parser.push(Uint8Array.of(byte)));
  received.push(...parser.finish());
  assert.deepEqual(received, [snapshot, ranked, details, done]);
  assert.equal(parser.done, true);
});
test("visual evidence may arrive before DOM ranking", () => {
  const parser = new VisualEventParser("request", "Find entrance");
  assert.equal(
    parser.push(
      encode([
        snapshot,
        { ...details, sequence: 2 },
        { ...ranked, sequence: 3 },
        done,
      ]),
    ).length,
    4,
  );
  parser.finish();
});
test("rejects wrong requests, capture identities, sequences, duplicate terminals and mismatched task", () => {
  for (const bad of [
    { ...ranked, requestId: "old" },
    { ...ranked, captureId: "old" },
    { ...ranked, sequence: 3 },
    {
      ...ranked,
      classification: { ...ranked.classification, task: "Other task" },
    },
  ]) {
    const parser = new VisualEventParser("request", "Find entrance");
    parser.push(encode([snapshot]));
    assert.throws(() => parser.push(encode([bad])));
  }
  const parser = new VisualEventParser("request", "Find entrance");
  parser.push(encode([snapshot, ranked, details, done]));
  assert.throws(() => parser.push(encode([{ ...done, sequence: 5 }])));
});
test("rejects stale signatures and duplicate evidence without altering earlier snapshots", () => {
  for (const stale of [
    { ...evidence, signature: "another-map" },
    { ...evidence, snapshotId: "old" },
    { ...evidence, requestId: "old" },
  ]) {
    const parser = new VisualEventParser("request", "Find entrance");
    parser.push(encode([snapshot, ranked]));
    assert.throws(() =>
      parser.push(encode([{ ...details, evidence: [stale] }])),
    );
  }
  const parser = new VisualEventParser("request", "Find entrance");
  parser.push(encode([snapshot, ranked, details]));
  assert.throws(() => parser.push(encode([{ ...details, sequence: 4 }])));
  assert.equal(snapshot.page.blocks[0].text, "Texto fuente original.");
});
test("valid prefix is delivered even when a later event in the same chunk is invalid", () => {
  const parser = new VisualEventParser("request", "Find entrance");
  const received: VisualEvent[] = [];
  assert.throws(() =>
    parser.push(encode([snapshot, { ...ranked, requestId: "wrong" }]), (e) =>
      received.push(e),
    ),
  );
  assert.deepEqual(received, [snapshot]);
});
test("missing terminal preserves received data and reports incompleteness", async () => {
  const received: VisualEvent[] = [];
  const response = new Response(encode([snapshot, ranked]), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  await assert.rejects(
    () =>
      consumeVisualStream(
        response,
        "request",
        "Find entrance",
        new AbortController().signal,
        (e) => received.push(e),
      ),
    /ended early/,
  );
  assert.deepEqual(received, [snapshot, ranked]);
});
test("abort cancels a waiting reader and never delivers late evidence", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const received: VisualEvent[] = [];
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(encode([snapshot]));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
  await assert.rejects(
    () =>
      consumeVisualStream(
        response,
        "request",
        "Find entrance",
        controller.signal,
        (event) => {
          received.push(event);
          controller.abort();
        },
      ),
    { name: "AbortError" },
  );
  assert.equal(cancelled, true);
  assert.deepEqual(received, [snapshot]);
});
test("bounds event size and rejects payloads before snapshot", () => {
  const parser = new VisualEventParser("request", "Find entrance");
  assert.throws(
    () =>
      parser.push(
        new TextEncoder().encode("a".repeat(VISUAL_MAX_EVENT_BYTES + 1)),
      ),
    /size limit/,
  );
  assert.throws(() =>
    new VisualEventParser("request", "Find entrance").push(
      encode([{ ...ranked, sequence: 1 }]),
    ),
  );
});
