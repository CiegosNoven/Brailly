import { randomUUID } from "node:crypto";
import { classifyDom } from "./dom-jev.js";
import {
  openVisualBrowser,
  abortable,
  type VisualBrowserSession,
} from "./browserbase.js";
import { selectVisuals, prioritizeEvidence } from "./visual-jev.js";
import {
  VISUAL_DEADLINE_MS,
  VISUAL_MAX_INSPECTIONS,
  visualEventSchema,
  type VisualEvent,
  type VisualEventPayload,
  type VisualRequest,
  type VisualCoverage,
  type VisualMetrics,
  type VisualEvidence,
} from "../shared/visual.js";
export type VisualDependencies = {
  open: (signal: AbortSignal) => Promise<VisualBrowserSession>;
  rank: typeof classifyDom;
  select: typeof selectVisuals;
  prioritize: typeof prioritizeEvidence;
  key: string;
  model: string;
  deadlineMs: number;
};
export const defaultVisualDependencies = (): VisualDependencies => ({
  open: openVisualBrowser,
  rank: classifyDom,
  select: selectVisuals,
  prioritize: prioritizeEvidence,
  key: process.env.TYPESAFE_API_KEY || "",
  model: process.env.TYPESAFE_MODEL || "jev-1.13.0",
  deadlineMs: VISUAL_DEADLINE_MS,
});
/** One invocation owns one session and all work. No background jobs survive it. */
export async function runVisualCapture(
  request: VisualRequest,
  send: (event: VisualEvent) => void,
  clientSignal: AbortSignal,
  deps = defaultVisualDependencies(),
): Promise<void> {
  const started = Date.now(),
    deadline = new AbortController(),
    signal = AbortSignal.any([clientSignal, deadline.signal]);
  const timer = setTimeout(
    () =>
      deadline.abort(
        new DOMException(
          "Visual capture exceeded its total deadline.",
          "TimeoutError",
        ),
      ),
    Math.max(
      1,
      deps.deadlineMs - Math.min(3000, Math.ceil(deps.deadlineMs * 0.1)),
    ),
  );
  let session: VisualBrowserSession | undefined,
    snapshotId = "",
    captureId = randomUUID(),
    sequence = 0,
    terminal = false,
    snapshotSent = false,
    partial = false,
    sessionClosed = false;
  let evidence: VisualEvidence[] = [],
    evidenceEmitted = false;
  const metrics: VisualMetrics = {
    totalMs: 0,
    loadMs: 0,
    domMs: 0,
    selectionMs: 0,
    visionMs: 0,
    priorityMs: 0,
  };
  const coverage: VisualCoverage = {
    totalCandidates: 0,
    includedCandidates: 0,
    inspected: 0,
    sourceAlt: 0,
    skipped: 0,
    uninspected: 0,
    hidden: 0,
    truncated: false,
    domSkipped: false,
    blockedRequests: null,
    unsupported: [
      "CSS backgrounds",
      "iframes",
      "shadow DOM",
      "animated images",
    ],
  };
  const emit = (payload: VisualEventPayload) => {
    if (terminal || clientSignal.aborted) return;
    const event = visualEventSchema.parse({
      ...payload,
      requestId: request.requestId,
      snapshotId,
      captureId,
      sequence: sequence + 1,
    });
    send(event);
    sequence++;
    if (payload.type === "snapshot") snapshotSent = true;
    if (payload.type === "done") terminal = true;
  };
  const failure = (
    stage: Extract<VisualEvent, { type: "stage-error" }>["stage"],
    message: string,
    candidateId?: string,
  ) => {
    partial = true;
    if (!signal.aborted)
      emit({
        type: "stage-error",
        stage,
        message,
        ...(candidateId ? { candidateId } : {}),
      });
  };
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      if (session) {
        await session.close();
        sessionClosed = true;
      }
    })());
  const abortSession = () => {
    if (session) void close().catch(() => {});
  };
  signal.addEventListener("abort", abortSession, { once: true });
  try {
    signal.throwIfAborted();
    session = await abortable(deps.open(signal), signal);
    signal.throwIfAborted();
    const { page, inventory } = await abortable(
      session.capture(request.url, signal),
      signal,
    );
    signal.throwIfAborted();
    snapshotId = page.id;
    metrics.loadMs = Date.now() - started;
    Object.assign(coverage, {
      totalCandidates: inventory.totalCandidates,
      includedCandidates: inventory.candidates.length,
      hidden: inventory.hidden,
      truncated: inventory.truncated,
      domSkipped: !page.blocks.length,
      uninspected: inventory.candidates.filter((c) => !c.hidden).length,
    });
    emit({
      type: "snapshot",
      page: { ...page, source: "browserbase" },
      candidates: inventory.candidates,
      coverage: { ...coverage },
    });
    const rank = async () => {
      if (!page.blocks.length) return;
      const start = Date.now();
      try {
        if (!deps.key) throw new Error("Jev is not configured.");
        const classification = await abortable(
          deps.rank(
            page,
            request.task,
            deps.key,
            deps.model,
            undefined,
            signal,
          ),
          signal,
        );
        signal.throwIfAborted();
        emit({
          type: "dom-ranked",
          classification: {
            ...classification,
            request: {
              readerTask: request.task,
              blockIds: page.blocks.map((b) => b.id),
              source: "visual-capture",
              note: "Full prompt omitted from the bounded event stream.",
            },
          },
        });
      } catch {
        failure(
          "dom",
          "Text ranking is unavailable; the source text remains readable.",
        );
      } finally {
        metrics.domMs = Date.now() - start;
      }
    };
    const visual = async () => {
      if (!inventory.candidates.length) return;
      let decisions;
      const selectionStart = Date.now();
      try {
        if (!deps.key) throw new Error("Jev is not configured.");
        decisions = await abortable(
          deps.select(
            inventory.candidates,
            request.task,
            deps.key,
            deps.model,
            signal,
          ),
          signal,
        );
        signal.throwIfAborted();
        emit({ type: "visual-decisions", decisions });
      } catch {
        failure(
          "selection",
          "Visual selection is unavailable; no speculative inspection was started.",
        );
        return;
      } finally {
        metrics.selectionMs = Date.now() - selectionStart;
      }
      const byId = new Map(inventory.candidates.map((c) => [c.candidateId, c]));
      coverage.skipped = decisions.filter((d) => d.decision === "SKIP").length;
      const identity = (c: (typeof inventory.candidates)[number]) => ({
        requestId: request.requestId,
        snapshotId,
        captureId,
        candidateId: c.candidateId,
        signature: c.signature,
        sourceAltText: c.sourceAltText,
        score: null,
        confidence: null,
        priority: "REVIEW" as const,
      });
      for (const d of decisions) {
        const c = byId.get(d.candidateId);
        if (
          c &&
          !c.hidden &&
          d.decision === "SKIP" &&
          d.reason === "source-alt-sufficient" &&
          c.sourceAltText
        ) {
          evidence.push({
            ...identity(c),
            generatedDescription: null,
            recognizedText: "",
            uncertainty: "",
            observedAt: page.capturedAt,
            method: "source-alt",
            model: null,
          });
          coverage.sourceAlt++;
        }
      }
      const inspect = decisions
        .filter((d) => d.decision === "INSPECT")
        .sort((a, b) => b.confidence - a.confidence);
      const unknown = decisions
        .filter((d) => d.decision === "UNKNOWN")
        .sort((a, b) => b.confidence - a.confidence);
      const chosen = [...inspect, ...unknown]
        .filter((d) => !byId.get(d.candidateId)?.hidden)
        .slice(0, VISUAL_MAX_INSPECTIONS);
      const visionStart = Date.now();
      for (const d of chosen) {
        if (signal.aborted) break;
        const c = byId.get(d.candidateId)!;
        try {
          const result = await abortable(
            session!.inspect(
              c,
              request.task,
              signal,
              Math.max(1, deps.deadlineMs - (Date.now() - started)),
            ),
            signal,
          );
          signal.throwIfAborted();
          evidence.push({
            ...identity(c),
            ...result,
            method: "stagehand-vision",
          });
          coverage.inspected++;
        } catch {
          failure(
            "vision",
            "This visual could not be inspected reliably; its source content is unchanged.",
            c.candidateId,
          );
        }
      }
      metrics.visionMs = Date.now() - visionStart;
      coverage.uninspected = inventory.candidates.filter(
        (c) =>
          !c.hidden &&
          !evidence.some((e) => e.candidateId === c.candidateId) &&
          !decisions.some(
            (d) => d.candidateId === c.candidateId && d.decision === "SKIP",
          ),
      ).length;
      if (coverage.uninspected > 0) partial = true;
      if (!evidence.length || signal.aborted) return;
      const priorityStart = Date.now();
      try {
        evidence = await abortable(
          deps.prioritize(evidence, request.task, deps.key, deps.model, signal),
          signal,
        );
      } catch {
        failure(
          "priority",
          "Visual descriptions are available without Jev priorities.",
        );
      } finally {
        metrics.priorityMs = Date.now() - priorityStart;
      }
      if (!signal.aborted) {
        emit({ type: "visual-evidence", evidence });
        evidenceEmitted = true;
      }
    };
    const outcomes = await Promise.allSettled([rank(), visual()]);
    if (outcomes.some((o) => o.status === "rejected"))
      failure(
        "capture",
        "A visual stage returned invalid data; available source content was preserved.",
      );
  } catch (e) {
    if (!snapshotSent) throw e;
    failure(
      "capture",
      "Visual capture stopped early; received source text remains available.",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortSession);
    try {
      await abortable(
        close(),
        AbortSignal.timeout(
          Math.max(1, deps.deadlineMs - (Date.now() - started)),
        ),
      );
    } catch {
      partial = true;
      if (snapshotSent && !clientSignal.aborted)
        emit({
          type: "stage-error",
          stage: "cleanup",
          message:
            "Session release could not be confirmed; its provider timeout remains active.",
        });
    }
    if (snapshotSent && !clientSignal.aborted) {
      if (signal.aborted) {
        partial = true;
        emit({
          type: "stage-error",
          stage: "deadline",
          message:
            "The total visual deadline was reached; available results were preserved.",
        });
      }
      if (evidence.length && !evidenceEmitted)
        emit({ type: "visual-evidence", evidence });
      coverage.blockedRequests = session?.blockedRequests ?? null;
      metrics.totalMs = Date.now() - started;
      emit({
        type: "done",
        status: partial || coverage.truncated ? "partial" : "complete",
        coverage,
        metrics,
        sessionClosed,
      });
    }
  }
}
