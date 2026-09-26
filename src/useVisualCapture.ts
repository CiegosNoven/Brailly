import { useEffect, useRef, useState } from "react";
import type {
  VisualCandidate,
  VisualCoverage,
  VisualDecision,
  VisualEvidence,
  VisualEvent,
  VisualMetrics,
} from "../shared/visual";
import { consumeVisualStream } from "./visual-stream";

export type VisualCaptureState = {
  requestId: string | null;
  busy: boolean;
  rankingPending: boolean;
  candidates: VisualCandidate[];
  decisions: VisualDecision[];
  evidence: VisualEvidence[];
  coverage: VisualCoverage | null;
  metrics: VisualMetrics | null;
  status: "idle" | "loading" | "analyzing" | "complete" | "partial";
  errors: string[];
};
const initial = (): VisualCaptureState => ({
  requestId: null,
  busy: false,
  rankingPending: false,
  candidates: [],
  decisions: [],
  evidence: [],
  coverage: null,
  metrics: null,
  status: "idle",
  errors: [],
});
export function useVisualCapture(apiBase = "") {
  const [state, setState] = useState<VisualCaptureState>(initial);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  function cancel(reset = false) {
    generation.current++;
    active.current?.abort();
    active.current = null;
    setState((s) =>
      reset
        ? initial()
        : {
            ...s,
            busy: false,
            rankingPending: false,
            status: s.busy ? "partial" : s.status,
          },
    );
  }
  useEffect(
    () => () => {
      generation.current++;
      active.current?.abort();
    },
    [],
  );
  async function start(
    url: string,
    task: string,
    onEvent: (event: VisualEvent) => void,
  ) {
    task = task.trim();
    active.current?.abort();
    const token = ++generation.current;
    const controller = new AbortController();
    active.current = controller;
    const requestId = crypto.randomUUID();
    setState({
      ...initial(),
      requestId,
      busy: true,
      rankingPending: true,
      status: "loading",
    });
    try {
      const response = await fetch(apiBase + "/api/visual-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, url, task }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || `Visual capture failed (HTTP ${response.status}).`,
        );
      }
      await consumeVisualStream(
        response,
        requestId,
        task,
        controller.signal,
        (event) => {
          if (token !== generation.current) return;
          setState((s) => {
            switch (event.type) {
              case "snapshot":
                return {
                  ...s,
                  status: "analyzing",
                  candidates: event.candidates,
                  coverage: event.coverage,
                  rankingPending: event.page.blocks.length > 0,
                };
              case "dom-ranked":
                return { ...s, rankingPending: false };
              case "visual-decisions":
                return { ...s, decisions: event.decisions };
              case "visual-evidence":
                return { ...s, evidence: [...s.evidence, ...event.evidence] };
              case "stage-error":
                return {
                  ...s,
                  rankingPending:
                    event.stage === "dom" ? false : s.rankingPending,
                  errors: [...s.errors, event.message],
                };
              case "done":
                return {
                  ...s,
                  busy: false,
                  rankingPending: false,
                  status: event.status,
                  coverage: event.coverage,
                  metrics: event.metrics,
                };
            }
          });
          onEvent(event);
        },
      );
    } catch (error) {
      if (token !== generation.current || controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        busy: false,
        rankingPending: false,
        status: "partial",
        errors: [
          ...s.errors,
          error instanceof Error &&
          error.name !== "ZodError" &&
          error.name !== "SyntaxError"
            ? error.message
            : "Visual response was invalid. Your reading remains available.",
        ],
      }));
    } finally {
      if (token === generation.current) {
        active.current = null;
        setState((s) => ({ ...s, busy: false, rankingPending: false }));
      }
    }
  }
  return { state, start, cancel };
}
