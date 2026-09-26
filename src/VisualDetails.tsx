import { useEffect, useRef, useState } from "react";
import type { VisualEvidence } from "../shared/visual";
import type { VisualCaptureState } from "./useVisualCapture";
import type { useSpeech } from "./useSpeech";
import "./visual-details.css";

type Props = {
  state: VisualCaptureState;
  speech: ReturnType<typeof useSpeech>;
  onInteract: () => void;
};
export const evidenceAudioId = (item: VisualEvidence) =>
  `${item.requestId}:${item.captureId}:${item.candidateId}:${item.signature}`;
export default function VisualDetails({ state, speech, onInteract }: Props) {
  const [opened, setOpened] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const item = state.evidence.find((e) => e.candidateId === opened);
  useEffect(() => {
    if (item) closeButton.current?.focus();
  }, [item?.candidateId]);
  function close() {
    if (speech.content?.kind === "visual") speech.stop();
    setOpened(null);
    opener.current?.focus();
  }
  const available = state.evidence.length;
  if (state.status === "idle") return null;
  const isPlaying =
    speech.status === "loading" ||
    speech.status === "playing" ||
    speech.needsPlay;
  const active =
    !!item && speech.content?.id === evidenceAudioId(item) && isPlaying;
  const recognizedActive =
    !!item &&
    speech.content?.id === evidenceAudioId(item) + ":recognized" &&
    isPlaying;
  const ownsAudio =
    !!item &&
    (speech.content?.id === evidenceAudioId(item) ||
      speech.content?.id === evidenceAudioId(item) + ":recognized");
  return (
    <section className="visual-details" aria-labelledby="visual-details-title">
      <div className="visual-heading">
        <h2 id="visual-details-title">Visual details</h2>
        <span>
          {state.busy
            ? "Analyzing capture…"
            : state.status === "partial"
              ? "Partial analysis"
              : "Analysis complete"}
        </span>
      </div>
      <p className="visual-announcement" role="status" aria-live="polite">
        {available
          ? `${available} visual detail${available === 1 ? "" : "s"} available. Open one when you choose.`
          : state.busy
            ? "Source text is available as soon as it is captured."
            : "No visual descriptions available. Source text remains readable."}
      </p>
      {state.coverage && (
        <p className="coverage">
          {state.coverage.includedCandidates} visual candidates ·{" "}
          {state.coverage.inspected} inspected · {state.coverage.uninspected}{" "}
          uninspected.
          {state.coverage.domSkipped
            ? " This capture has no source text blocks."
            : ""}
          {state.coverage.truncated ? " Visual inventory was limited." : ""}{" "}
          Coverage excludes{" "}
          {state.coverage.unsupported.join(", ") || "unsupported content"}.
        </p>
      )}
      {state.evidence.length > 0 && (
        <ul className="visual-list">
          {state.evidence.map((e, index) => {
            const candidate = state.candidates.find(
              (c) => c.candidateId === e.candidateId,
            );
            return (
              <li key={e.candidateId}>
                <button
                  aria-label={`Open visual detail ${index + 1}: ${candidate?.caption || candidate?.nearbyHeading || candidate?.title || "Visual"}`}
                  onClick={(event) => {
                    onInteract();
                    opener.current = event.currentTarget;
                    setOpened(e.candidateId);
                  }}
                >
                  <strong>
                    {candidate?.caption ||
                      candidate?.nearbyHeading ||
                      candidate?.title ||
                      `Visual ${index + 1}`}
                  </strong>
                  <span>
                    {e.method === "source-alt"
                      ? "Source alternative text"
                      : "Generated description"}
                    {e.score !== null
                      ? ` · Jev ${e.score.toFixed(1)} / 3`
                      : " · Relevance not scored"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {state.decisions.length > 0 && (
        <details>
          <summary>Inspection decisions</summary>
          <ul>
            {state.decisions.map((d) => (
              <li key={d.candidateId}>
                {d.candidateId}: {d.decision} · {d.reason.replaceAll("-", " ")}{" "}
                · {Math.round(d.confidence * 100)}% confidence
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.errors.length > 0 && (
        <ul className="visual-errors">
          {state.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
      {state.metrics && (
        <details>
          <summary>Capture timing</summary>
          <p>
            Load {state.metrics.loadMs} ms · DOM Jev {state.metrics.domMs} ms ·
            selection {state.metrics.selectionMs} ms · vision{" "}
            {state.metrics.visionMs} ms · priority {state.metrics.priorityMs} ms
            · total {state.metrics.totalMs} ms
          </p>
        </details>
      )}
      {item && (
        <div className="modal-backdrop" onClick={close}>
          <section
            className="modal visual-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="visual-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
              if (e.key === "Tab") {
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),a[href]",
                  ),
                ];
                const first = items[0],
                  last = items[items.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              ref={closeButton}
              className="close"
              aria-label="Close visual detail"
              onClick={close}
            >
              ×
            </button>
            <h2 id="visual-dialog-title">
              {item.method === "source-alt"
                ? "Source alternative text"
                : "Generated visual description"}
            </h2>
            {item.generatedDescription && <p>{item.generatedDescription}</p>}
            {item.sourceAltText && (
              <p>
                <strong>Source alternative text:</strong> {item.sourceAltText}
              </p>
            )}
            {item.recognizedText && (
              <p>
                <strong>Text recognized by the model:</strong>{" "}
                {item.recognizedText}
              </p>
            )}
            {item.uncertainty && (
              <p>
                <strong>Uncertainty:</strong> {item.uncertainty}
              </p>
            )}
            <p className="coverage">
              {item.model ? `Model: ${item.model}. ` : ""}Observed{" "}
              {item.observedAt}. Your source reading position is retained.
            </p>
            <button
              className="subtle"
              onClick={() =>
                active
                  ? speech.stop()
                  : void speech.speak(
                      item.generatedDescription ||
                        item.sourceAltText ||
                        item.recognizedText,
                      { kind: "visual", id: evidenceAudioId(item) },
                    )
              }
            >
              {active ? "Stop visual audio" : "Listen to visual detail"}
            </button>
            {item.recognizedText && (
              <button
                className="subtle"
                onClick={() =>
                  recognizedActive
                    ? speech.stop()
                    : void speech.speak(item.recognizedText, {
                        kind: "visual",
                        id: evidenceAudioId(item) + ":recognized",
                      })
                }
              >
                {recognizedActive
                  ? "Stop recognized audio"
                  : "Listen to recognized text"}
              </button>
            )}
            {(active || recognizedActive) && speech.needsPlay && (
              <button
                className="subtle"
                onClick={() => void speech.retryPlay()}
              >
                Play visual audio
              </button>
            )}
            {ownsAudio && speech.error && (
              <div role="alert">
                <p>{speech.error}</p>
                {speech.provider === "elevenlabs" && (
                  <button
                    className="subtle"
                    onClick={() => speech.setProvider("browser")}
                  >
                    Use browser voice
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
