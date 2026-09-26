import test from "node:test";
import assert from "node:assert/strict";
import {
  onlyCountdownTicks,
  snapshotSignature,
  sourceChanges,
} from "../shared/live";
import type { DomBlock, PageSnapshot } from "../shared/dom";

const block = (id: string, text: string): DomBlock => ({
  id,
  text,
  tag: "span",
  role: "text",
  region: "main",
  order: 0,
  ...(/^\d+:\d+:\d+$/.test(text) ? { live: "timer" as const } : {}),
});
const page = (...blocks: DomBlock[]): PageSnapshot => ({
  id: crypto.randomUUID(),
  url: "https://example.org/deals",
  title: "Deals",
  capturedAt: new Date().toISOString(),
  source: "url",
  totalCandidates: blocks.length,
  truncated: false,
  blocks,
});

test("reordering alone does not invalidate an in-flight classification", () => {
  const a = block("b1", "Rome"),
    b = block("b2", "Price 240");
  assert.equal(
    snapshotSignature(page(a, b)),
    snapshotSignature(page({ ...b, order: 0 }, { ...a, order: 1 })),
  );
});
test("only ordinary countdown ticks are suppressed, not expiry, minute boundaries or price changes", () => {
  const before = page(block("b1", "00:12:45"), block("b2", "Price 240"));
  assert.equal(
    onlyCountdownTicks(
      before,
      page(block("b1", "00:12:44"), block("b2", "Price 240")),
    ),
    true,
  );
  assert.equal(
    onlyCountdownTicks(
      before,
      page(block("b1", "00:12:44"), block("b2", "Price 320")),
    ),
    false,
  );
  assert.equal(
    onlyCountdownTicks(
      page(block("b1", "00:00:01")),
      page(block("b1", "00:00:00")),
    ),
    false,
  );
  assert.equal(
    onlyCountdownTicks(
      page(block("b1", "00:01:01")),
      page(block("b1", "00:01:00")),
    ),
    false,
  );
  assert.equal(
    onlyCountdownTicks(
      page(block("b1", "Wait: 35 minutes")),
      page(block("b1", "Wait: 55 minutes")),
    ),
    false,
  );
});
test("source changes include disappearance and href changes while preserving before text", () => {
  const before = page(block("b1", "Fare 240"), {
    ...block("b2", "Book"),
    href: "https://example.org/a",
  });
  const next = page(
    { ...block("b2", "Book"), href: "https://example.org/b" },
    block("b3", "Sold out"),
  );
  const changes = sourceChanges(before, next);
  assert.equal(changes.removed[0].text, "Fare 240");
  assert.equal(changes.changed[0].id, "b2");
  assert.equal(changes.added[0].text, "Sold out");
});
