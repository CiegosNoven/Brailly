/** Opt-in provider smoke. Never run from npm test: each invocation opens paid sessions. */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  openVisualBrowser,
  visualAllowedOrigins,
} from "../server/browserbase.js";
import {
  runVisualCapture,
  defaultVisualDependencies,
} from "../server/visual-service.js";
import type { VisualEvent } from "../shared/visual.js";
const mode = process.argv[2] || "public";
const result: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  mode,
  stagehandVersion: "4.1.0",
  jevConfigured: !!process.env.TYPESAFE_API_KEY,
};
try {
  if (mode === "fixture-jev" || mode === "fixture-discounts") {
    const html = await readFile(
      new URL("../public/visual-demo.html", import.meta.url),
      "utf8",
    );
    const deps = defaultVisualDependencies();
    deps.open = (signal) =>
      openVisualBrowser(signal, {
        origins: [...visualAllowedOrigins(), "https://example.com"],
        testFixtureHtml: html,
      });
    const task =
      mode === "fixture-discounts"
        ? "Find discounts and promotional offers in the museum shop"
        : "Find the museum opening hours and the accessible entrance";
    const events: VisualEvent[] = [];
    await runVisualCapture(
      { requestId: crypto.randomUUID(), url: "https://example.com/", task },
      (e) => {
        events.push(e);
        console.log(
          JSON.stringify({
            type: e.type,
            sequence: e.sequence,
            ...(e.type === "stage-error"
              ? { stage: e.stage, message: e.message }
              : {}),
          }),
        );
      },
      new AbortController().signal,
      deps,
    );
    Object.assign(result, {
      fixture:
        "Controlled repository HTML injected into a fresh real Browserbase session at example.com; not a live museum website.",
      task,
      events,
    });
  } else if (mode === "fixture") {
    const html = await readFile(
      new URL("../public/visual-demo.html", import.meta.url),
      "utf8",
    );
    const controller = new AbortController();
    const deadline = setTimeout(
      () =>
        controller.abort(new DOMException("Smoke deadline", "TimeoutError")),
      45000,
    );
    const started = Date.now();
    const session = await openVisualBrowser(controller.signal, {
      origins: [...visualAllowedOrigins(), "https://example.com"],
      testFixtureHtml: html,
    });
    try {
      const capture = await session.capture(
        "https://example.com/",
        controller.signal,
      );
      const target = capture.inventory.candidates.find((c) =>
        c.accessibleName.includes("Museum site map"),
      );
      if (!target) throw new Error("Fixture map candidate was not captured.");
      const evidence = await session.inspect(
        target,
        "Find the accessible museum entrance",
        controller.signal,
        45000 - (Date.now() - started),
      );
      Object.assign(result, {
        fixture:
          "Controlled repository HTML injected into a fresh real Browserbase session at example.com; not a live museum website.",
        snapshot: {
          blocks: capture.page.blocks.length,
          candidates: capture.inventory.candidates.map((c) => ({
            candidateId: c.candidateId,
            kind: c.kind,
            accessibleName: c.accessibleName,
            signature: c.signature,
          })),
        },
        evidence,
        elapsedMs: Date.now() - started,
      });
    } finally {
      clearTimeout(deadline);
      await session.close();
      result.sessionClosed = true;
    }
  } else {
    const url = process.argv[3] || "https://achladeal.com/en";
    const task = url.includes("dublin")
      ? "Find the departure status and gate for a flight to Madrid"
      : "Find a flight to Madrid under USD 400 departing this month";
    const events: VisualEvent[] = [];
    await runVisualCapture(
      { requestId: crypto.randomUUID(), url, task },
      (e) => {
        events.push(e);
        console.log(
          JSON.stringify({
            type: e.type,
            sequence: e.sequence,
            ...(e.type === "snapshot"
              ? {
                  blocks: e.page.blocks.length,
                  candidates: e.candidates.length,
                }
              : {}),
            ...(e.type === "stage-error"
              ? { stage: e.stage, message: e.message }
              : {}),
          }),
        );
      },
      new AbortController().signal,
    );
    Object.assign(result, { url, task, events });
  }
} catch (e) {
  result.error =
    e instanceof Error ? e.message : "Unknown visual smoke failure";
  process.exitCode = 1;
}
// Provider credentials / connection URLs are never included in this summary.
const serialized = JSON.stringify(result, null, 2);
for (const key of ["BROWSERBASE_API_KEY", "TYPESAFE_API_KEY"])
  if (process.env[key] && serialized.includes(process.env[key]!))
    throw new Error("Refusing to write credential-bearing diagnostics.");
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/visual-live-${mode}.json`, serialized);
console.log(
  JSON.stringify(
    {
      artifact: `artifacts/visual-live-${mode}.json`,
      ...(!result.events
        ? result
        : {
            ...result,
            events: undefined,
            summary: (result.events as VisualEvent[]).map((e) =>
              e.type === "snapshot"
                ? {
                    type: e.type,
                    blocks: e.page.blocks.length,
                    candidates: e.candidates.map((c) => ({
                      id: c.candidateId,
                      name: c.accessibleName,
                    })),
                  }
                : e.type === "dom-ranked"
                  ? {
                      type: e.type,
                      model: e.classification.model,
                      blocks: e.classification.results.length,
                    }
                  : e,
            ),
          }),
    },
    null,
    2,
  ),
);
