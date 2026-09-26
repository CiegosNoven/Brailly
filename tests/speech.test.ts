import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SpeechController,
  type SpeechDependencies,
} from "../src/speech-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const source = { kind: "source" as const, id: "snapshot-a:b1" };
const visual = {
  kind: "visual" as const,
  id: "snapshot-a:capture-a:v1:signature:task1",
};
const mp3 = () =>
  new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
    headers: { "Content-Type": "audio/mpeg" },
  });
function harness() {
  const requests: {
    pending: ReturnType<typeof deferred<Response>>;
    signal: AbortSignal;
    body: { text: string; requestId: string };
  }[] = [];
  const audios: HTMLAudioElement[] = [];
  const utterances: SpeechSynthesisUtterance[] = [];
  const revoked: string[] = [];
  let spoken = 0,
    paused = 0,
    cancelled = 0,
    plays = 0;
  let nextPlay: (() => Promise<void>) | undefined;
  const dependencies: SpeechDependencies = {
    fetch: (async (_url: unknown, options: RequestInit) => {
      const pending = deferred<Response>();
      requests.push({
        pending,
        signal: options.signal as AbortSignal,
        body: JSON.parse(options.body as string),
      });
      return pending.promise;
    }) as typeof fetch,
    synthesis: {
      cancel() {
        cancelled++;
      },
      speak() {
        spoken++;
      },
    },
    createUtterance: (text) => {
      const value = {
        text,
        onend: null,
        onerror: null,
      } as SpeechSynthesisUtterance;
      utterances.push(value);
      return value;
    },
    createAudio: (url) => {
      const value = {
        src: url,
        onended: null,
        onerror: null,
        play: () => {
          plays++;
          return nextPlay ? nextPlay() : Promise.resolve();
        },
        pause: () => {
          paused++;
        },
        removeAttribute: () => {},
        load: () => {},
      } as unknown as HTMLAudioElement;
      audios.push(value);
      return value;
    },
    createObjectURL: () => `blob:audio-${audios.length}`,
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    requestId: () => `request-${requests.length}`,
  };
  const controller = new SpeechController("", dependencies);
  return {
    controller,
    dependencies,
    requests,
    audios,
    utterances,
    revoked,
    counts: () => ({ spoken, paused, cancelled, plays }),
    playWith: (callback: () => Promise<void>) => {
      nextPlay = callback;
    },
  };
}

test("slow audio A then B only plays B, with the exact selected text and identity", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const a = h.controller.speak("Original source words", source);
  const b = h.controller.speak("Generated map description", visual);
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[1].pending.resolve(mp3());
  await b;
  h.requests[0].pending.resolve(mp3());
  await a;
  assert.equal(h.audios.length, 1);
  assert.deepEqual(h.controller.getSnapshot().content, visual);
  assert.equal(h.requests[1].body.text, "Generated map description");
  assert.equal(h.controller.getSnapshot().status, "playing");
  h.controller.stop();
});

test("Stop while loading aborts and prevents a late success or fallback", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const pending = h.controller.speak("Words to read", source);
  assert.equal(h.controller.getSnapshot().status, "loading");
  h.controller.stop();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].pending.resolve(mp3());
  await pending;
  assert.equal(h.audios.length, 0);
  assert.equal(h.counts().spoken, 0);
  assert.equal(h.controller.getSnapshot().status, "idle");
});

test("old ended/error callbacks cannot end a newer audio", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const a = h.controller.speak("Source A", source);
  h.requests[0].pending.resolve(mp3());
  await a;
  const oldEnded = h.audios[0].onended!;
  const oldError = h.audios[0].onerror!;
  const b = h.controller.speak("Visual B", visual);
  h.requests[1].pending.resolve(mp3());
  await b;
  oldEnded.call(h.audios[0], new Event("ended"));
  oldError.call(h.audios[0], new Event("error"));
  assert.equal(h.controller.getSnapshot().status, "playing");
  assert.deepEqual(h.controller.getSnapshot().content, visual);
  assert.deepEqual(h.revoked, ["blob:audio-0"]);
  h.controller.stop();
  assert.deepEqual(h.revoked, ["blob:audio-0", "blob:audio-1"]);
});

test("provider switch aborts audio and never automatically speaks with the fallback", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const pending = h.controller.speak("A selected passage", source);
  h.controller.setProvider("browser");
  h.requests[0].pending.reject(new Error("late provider failure"));
  await pending;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.controller.getSnapshot().provider, "browser");
  assert.equal(h.controller.getSnapshot().status, "idle");
  assert.equal(h.counts().spoken, 0);
  await h.controller.speak("A selected passage", source);
  assert.equal(h.counts().spoken, 1);
  h.controller.stop();
});

test("autoplay rejection offers an explicit Play retry with the same blob and no new request", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  h.playWith(() =>
    Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  );
  const pending = h.controller.speak("Speak on demand", visual);
  h.requests[0].pending.resolve(mp3());
  await pending;
  assert.equal(h.controller.getSnapshot().needsPlay, true);
  assert.equal(h.controller.getSnapshot().status, "error");
  assert.deepEqual(h.controller.getSnapshot().content, visual);
  assert.equal(h.revoked.length, 0);
  h.playWith(() => Promise.resolve());
  await h.controller.retryPlay();
  assert.equal(h.controller.getSnapshot().status, "playing");
  assert.equal(h.controller.getSnapshot().needsPlay, false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.counts().plays, 2);
  h.controller.stop();
});

test("a play promise resolving after Stop cannot restart the UI", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const playing = deferred<void>();
  h.playWith(() => playing.promise);
  const pending = h.controller.speak("Delayed playback", source);
  h.requests[0].pending.resolve(mp3());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.audios.length, 1);
  h.controller.stop();
  playing.resolve();
  await pending;
  assert.equal(h.controller.getSnapshot().status, "idle");
  assert.equal(h.controller.getSnapshot().content, null);
  assert.equal(h.counts().paused, 1);
  assert.equal(h.revoked.length, 1);
});

test("provider errors and empty or invalid audio never trigger browser speech", async () => {
  for (const response of [
    new Response('{"error":"Voice unavailable"}', { status: 502 }),
    new Response("", { headers: { "content-type": "audio/mpeg" } }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
  ]) {
    const h = harness();
    h.controller.setProvider("elevenlabs");
    const pending = h.controller.speak("Selected text", source);
    h.requests[0].pending.resolve(response);
    await pending;
    assert.equal(h.controller.getSnapshot().status, "error");
    assert.equal(h.counts().spoken, 0);
    assert.equal(h.audios.length, 0);
    assert.deepEqual(h.controller.getSnapshot().content, source);
    h.controller.stop();
  }
});

test("browser speech also rejects stale callbacks and transfers ownership to visual content", async () => {
  const h = harness();
  await h.controller.speak("First", source);
  const ended = h.utterances[0].onend!;
  const failed = h.utterances[0].onerror!;
  await h.controller.speak("Second", visual);
  ended.call(h.utterances[0], {} as SpeechSynthesisEvent);
  failed.call(h.utterances[0], {} as SpeechSynthesisErrorEvent);
  assert.equal(h.controller.getSnapshot().status, "playing");
  assert.deepEqual(h.controller.getSnapshot().content, visual);
  h.utterances[1].onend!.call(h.utterances[1], {} as SpeechSynthesisEvent);
  assert.equal(h.controller.getSnapshot().status, "idle");
});

test("empty or oversized passages fail explicitly without truncating or sending a request", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  for (const text of ["  ", "x".repeat(801)]) {
    await h.controller.speak(text, source);
    assert.equal(h.controller.getSnapshot().status, "error");
  }
  assert.equal(h.requests.length, 0);
  h.controller.stop();
});

test("finishing playback frees its blob, and Stop is idempotent", async () => {
  const h = harness();
  h.controller.setProvider("elevenlabs");
  const pending = h.controller.speak("Complete passage", source);
  h.requests[0].pending.resolve(mp3());
  await pending;
  h.audios[0].onended!.call(h.audios[0], new Event("ended"));
  h.controller.stop();
  h.controller.stop();
  assert.equal(h.revoked.length, 1);
  assert.equal(h.controller.getSnapshot().status, "idle");
});
