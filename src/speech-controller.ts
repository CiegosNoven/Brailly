export type SpeechProvider = "browser" | "elevenlabs";
/** Include snapshot/capture and task identity in id, not only a reusable DOM ID. */
export type SpeechContent = { kind: "source" | "visual" | "alert"; id: string };
export type SpeechState = {
  status: "idle" | "loading" | "playing" | "error";
  provider: SpeechProvider;
  content: SpeechContent | null;
  error: string | null;
  needsPlay: boolean;
};
export type SpeechDependencies = {
  fetch: typeof fetch;
  synthesis?: Pick<SpeechSynthesis, "cancel" | "speak">;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  createAudio: (url: string) => HTMLAudioElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  requestId: () => string;
};

export function browserSpeechDependencies(): SpeechDependencies {
  return {
    fetch: (...args) => fetch(...args),
    synthesis:
      typeof window !== "undefined" ? window.speechSynthesis : undefined,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
    createAudio: (url) => new Audio(url),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    requestId: () => crypto.randomUUID(),
  };
}

/** One owner for both engines. Sequence checks invalidate even uncancellable callbacks. */
export class SpeechController {
  private state: SpeechState = {
    status: "idle",
    provider: "browser",
    content: null,
    error: null,
    needsPlay: false,
  };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private request: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private objectURL: string | null = null;
  constructor(
    private apiBase: string,
    private dependencies: SpeechDependencies = browserSpeechDependencies(),
  ) {}
  getSnapshot = (): SpeechState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<SpeechState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private release() {
    this.request?.abort();
    this.request = null;
    if (this.utterance) {
      this.utterance.onend = null;
      this.utterance.onerror = null;
      this.utterance = null;
    }
    this.dependencies.synthesis?.cancel();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.objectURL) this.dependencies.revokeObjectURL(this.objectURL);
    this.objectURL = null;
  }
  stop = () => {
    this.sequence++;
    this.release();
    this.update({
      status: "idle",
      content: null,
      error: null,
      needsPlay: false,
    });
  };
  setProvider = (provider: SpeechProvider) => {
    if (provider === this.state.provider) return;
    this.stop();
    this.update({ provider });
  };
  private failed(sequence: number, message: string) {
    if (sequence !== this.sequence) return;
    this.sequence++;
    this.release();
    this.update({ status: "error", error: message, needsPlay: false });
  }
  private ended = (sequence: number) => {
    if (sequence !== this.sequence) return;
    this.stop();
  };
  speak = async (text: string, content: SpeechContent): Promise<void> => {
    this.stop();
    const sequence = this.sequence;
    this.update({ content: { ...content } });
    if (!text.trim() || text.length > 800) {
      this.failed(sequence, "Choose text between 1 and 800 characters.");
      return;
    }
    if (this.state.provider === "browser") {
      if (!this.dependencies.synthesis) {
        this.failed(
          sequence,
          "This browser does not support speech. The reading text remains available.",
        );
        return;
      }
      try {
        const utterance = this.dependencies.createUtterance(text);
        this.utterance = utterance;
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        utterance.onend = () => this.ended(sequence);
        utterance.onerror = () =>
          this.failed(
            sequence,
            "The browser could not play this passage. Try Listen again.",
          );
        this.update({ status: "playing" });
        this.dependencies.synthesis.speak(utterance);
      } catch {
        this.failed(
          sequence,
          "The browser could not play this passage. Try Listen again.",
        );
      }
      return;
    }
    this.update({ status: "loading" });
    const request = new AbortController();
    this.request = request;
    const deadline = setTimeout(() => {
      if (sequence === this.sequence)
        this.failed(
          sequence,
          "Speech generation timed out. Try again or use the browser voice.",
        );
    }, 30_000);
    try {
      const requestId = this.dependencies.requestId();
      const response = await this.dependencies.fetch(
        `${this.apiBase}/api/tts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, requestId }),
          signal: request.signal,
        },
      );
      if (sequence !== this.sequence) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new Error(
          typeof data.error === "string" && data.error.length < 500
            ? data.error
            : "ElevenLabs could not generate speech. Use the browser voice.",
        );
      }
      const responseId = response.headers.get("X-Speech-Request-Id");
      if (responseId && responseId !== requestId)
        throw new Error(
          "Speech response did not match this request. Try Listen again.",
        );
      if (
        response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "audio/mpeg"
      )
        throw new Error("Invalid audio received. Use the browser voice.");
      const blob = await response.blob();
      if (sequence !== this.sequence) return;
      if (!blob.size || blob.size > 2 * 1024 * 1024)
        throw new Error("Invalid audio received. Use the browser voice.");
      clearTimeout(deadline);
      this.request = null;
      this.objectURL = this.dependencies.createObjectURL(blob);
      this.audio = this.dependencies.createAudio(this.objectURL);
      this.audio.onended = () => this.ended(sequence);
      this.audio.onerror = () =>
        this.failed(
          sequence,
          "Could not play this audio. Use the browser voice.",
        );
      await this.playAudio(sequence);
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.failed(
        sequence,
        error instanceof Error
          ? error.message
          : "Could not generate speech. Use the browser voice.",
      );
    } finally {
      clearTimeout(deadline);
    }
  };
  private async playAudio(sequence: number) {
    const audio = this.audio;
    if (!audio || sequence !== this.sequence) return;
    this.update({ status: "loading", error: null, needsPlay: false });
    try {
      await audio.play();
      if (sequence === this.sequence) this.update({ status: "playing" });
      // A superseded play promise must not pause a newer engine or update its UI.
    } catch (error) {
      if (sequence !== this.sequence) return;
      if (error instanceof Error && error.name === "NotAllowedError") {
        this.update({
          status: "error",
          error: "Audio is ready. Press Play to allow playback.",
          needsPlay: true,
        });
      } else {
        this.failed(
          sequence,
          "Could not play this audio. Use the browser voice.",
        );
      }
    }
  }
  retryPlay = async () => {
    if (!this.state.needsPlay) return;
    // Calls play in the click handler before yielding, retaining the user gesture.
    await this.playAudio(this.sequence);
  };
}
