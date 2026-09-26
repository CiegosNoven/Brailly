import {
  visualEventSchema,
  VISUAL_MAX_EVENT_BYTES,
  type VisualEvent,
} from "../shared/visual";

/** One request is also one task revision. Never associate events by URL alone. */
export class VisualEventParser {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private bytes = 0;
  private sequence = 0;
  private snapshot: Extract<VisualEvent, { type: "snapshot" }> | null = null;
  private terminal = false;
  private seen = new Set<string>();
  private evidence = new Set<string>();
  constructor(
    private requestId: string,
    private task: string,
  ) {}
  get done() {
    return this.terminal;
  }
  push(
    chunk: Uint8Array,
    onEvent?: (event: VisualEvent) => void,
  ): VisualEvent[] {
    this.bytes += chunk.byteLength;
    if (this.bytes > 2_000_000)
      throw new Error("Visual response exceeds its size limit.");
    this.pending += this.decoder.decode(chunk, { stream: true });
    return this.lines(false, onEvent);
  }
  finish(onEvent?: (event: VisualEvent) => void): VisualEvent[] {
    this.pending += this.decoder.decode();
    const events = this.lines(true, onEvent);
    if (!this.terminal)
      throw new Error(
        "Visual analysis ended early. Received text and details remain available.",
      );
    return events;
  }
  private lines(
    final: boolean,
    onEvent?: (event: VisualEvent) => void,
  ): VisualEvent[] {
    const events: VisualEvent[] = [];
    let end: number;
    while ((end = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      if (line.trim()) {
        const event = this.parse(line);
        events.push(event);
        onEvent?.(event);
      }
    }
    if (
      new TextEncoder().encode(this.pending).byteLength > VISUAL_MAX_EVENT_BYTES
    )
      throw new Error("Visual event exceeds its size limit.");
    if (final && this.pending.trim()) {
      const event = this.parse(this.pending);
      events.push(event);
      onEvent?.(event);
      this.pending = "";
    }
    return events;
  }
  private parse(line: string): VisualEvent {
    if (new TextEncoder().encode(line).byteLength > VISUAL_MAX_EVENT_BYTES)
      throw new Error("Visual event exceeds its size limit.");
    const event = visualEventSchema.parse(JSON.parse(line));
    if (
      this.terminal ||
      event.requestId !== this.requestId ||
      event.sequence !== this.sequence + 1
    )
      throw new Error("Invalid visual event sequence or request identity.");
    if (!this.snapshot) {
      if (event.type !== "snapshot" || event.snapshotId !== event.page.id)
        throw new Error(
          "Visual capture must begin with its matching snapshot.",
        );
      if (
        new Set(event.page.blocks.map((b) => b.id)).size !==
          event.page.blocks.length ||
        new Set(event.candidates.map((c) => c.candidateId)).size !==
          event.candidates.length
      )
        throw new Error("Duplicate capture identifiers.");
      const url = new URL(event.page.url);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Invalid snapshot URL.");
      this.snapshot = event;
    } else if (
      event.type === "snapshot" ||
      event.snapshotId !== this.snapshot.snapshotId ||
      event.captureId !== this.snapshot.captureId
    )
      throw new Error("Visual event belongs to another capture.");
    if (["dom-ranked", "visual-decisions", "done"].includes(event.type)) {
      if (this.seen.has(event.type)) throw new Error("Duplicate visual event.");
      this.seen.add(event.type);
    }
    if (event.type === "dom-ranked") {
      const ids = new Set(this.snapshot.page.blocks.map((b) => b.id));
      if (
        event.classification.snapshotId !== event.snapshotId ||
        event.classification.task !== this.task ||
        event.classification.results.length !== ids.size ||
        new Set(event.classification.results.map((r) => r.id)).size !==
          ids.size ||
        event.classification.results.some((r) => !ids.has(r.id))
      )
        throw new Error(
          "Classification does not match the captured task and blocks.",
        );
    }
    if (
      event.type === "visual-decisions" &&
      (new Set(event.decisions.map((d) => d.candidateId)).size !==
        event.decisions.length ||
        event.decisions.some(
          (d) =>
            !this.snapshot!.candidates.some(
              (c) => c.candidateId === d.candidateId,
            ),
        ))
    )
      throw new Error("Invalid visual decision candidate.");
    if (event.type === "visual-evidence")
      for (const item of event.evidence) {
        const candidate = this.snapshot.candidates.find(
          (c) => c.candidateId === item.candidateId,
        );
        if (
          !candidate ||
          item.signature !== candidate.signature ||
          item.requestId !== event.requestId ||
          item.snapshotId !== event.snapshotId ||
          item.captureId !== event.captureId ||
          this.evidence.has(item.candidateId)
        )
          throw new Error("Visual evidence is stale or duplicated.");
        this.evidence.add(item.candidateId);
      }
    this.sequence = event.sequence;
    this.terminal = event.type === "done";
    return event;
  }
}

export async function consumeVisualStream(
  response: Response,
  requestId: string,
  task: string,
  signal: AbortSignal,
  onEvent: (event: VisualEvent) => void,
) {
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("application/x-ndjson")
  )
    throw new Error("The server did not return a visual event stream.");
  const reader = response.body.getReader();
  const parser = new VisualEventParser(requestId, task);
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      parser.push(value, (event) => {
        signal.throwIfAborted();
        onEvent(event);
      });
    }
    parser.finish((event) => {
      signal.throwIfAborted();
      onEvent(event);
    });
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
