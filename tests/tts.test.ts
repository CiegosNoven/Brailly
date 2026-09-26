import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { request } from "node:http";
import {
  getTtsCapabilities,
  getTtsConfig,
  synthesizeSpeech,
  TTS_MAX_AUDIO_BYTES,
  type TtsConfig,
} from "../server/elevenlabs";
import { createTtsRouter } from "../server/tts-api";
const config: TtsConfig = {
  enabled: true,
  apiKey: "test-key-private",
  voiceId: "test-voice",
  modelId: "eleven_multilingual_v2",
};
const audio = () =>
  new Response(new Uint8Array([0x49, 0x44, 0x33, 1]), {
    headers: { "content-type": "audio/mpeg" },
  });

test("ElevenLabs defaults off; flags and missing configuration prevent provider calls", async () => {
  assert.deepEqual(getTtsCapabilities({}), {
    enabled: false,
    configured: false,
    available: false,
    maxCharacters: 800,
  });
  assert.equal(
    getTtsCapabilities({
      ELEVENLABS_API_KEY: "key",
      ELEVENLABS_VOICE_ID: "voice",
    }).available,
    false,
  );
  let calls = 0;
  const mocked = (async () => {
    calls++;
    return audio();
  }) as typeof fetch;
  await assert.rejects(
    synthesizeSpeech("Words", { ...config, enabled: false }, { fetch: mocked }),
    /disabled/,
  );
  await assert.rejects(
    synthesizeSpeech("Words", { ...config, apiKey: "" }, { fetch: mocked }),
    /not configured/,
  );
  await assert.rejects(
    synthesizeSpeech(
      "Words",
      { ...config, voiceId: "../private" },
      { fetch: mocked },
    ),
    /not configured/,
  );
  assert.equal(calls, 0);
  assert.equal(getTtsConfig({ ELEVENLABS_TTS_ENABLED: "true" }).enabled, true);
});

test("provider gets only the selected text and server-configured voice/model; returns MP3 bytes", async () => {
  const bytes = await synthesizeSpeech("  Exactly this passage.  ", config, {
    fetch: (async (url, options) => {
      assert.equal(
        url,
        "https://api.elevenlabs.io/v1/text-to-speech/test-voice/stream?output_format=mp3_44100_128",
      );
      assert.deepEqual(JSON.parse(options!.body as string), {
        text: "  Exactly this passage.  ",
        model_id: "eleven_multilingual_v2",
      });
      assert.equal(
        (options!.headers as Record<string, string>)["xi-api-key"],
        config.apiKey,
      );
      return audio();
    }) as typeof fetch,
  });
  assert.equal(bytes.length, 4);
});

test("provider errors are safe and invalid or oversized audio is rejected", async () => {
  for (const response of [
    new Response("SECRET provider diagnostics", { status: 401 }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("", { headers: { "content-type": "audio/mpeg" } }),
    new Response("audio", {
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(TTS_MAX_AUDIO_BYTES + 1),
      },
    }),
    new Response(new Uint8Array(TTS_MAX_AUDIO_BYTES + 1), {
      headers: { "content-type": "audio/mpeg" },
    }),
  ]) {
    await assert.rejects(
      synthesizeSpeech("Words", config, {
        fetch: (async () => response) as typeof fetch,
      }),
      (error) =>
        error instanceof Error &&
        !error.message.includes("SECRET") &&
        !error.message.includes(config.apiKey),
    );
  }
});

test("deadline and caller cancellation abort the actual ElevenLabs fetch", async () => {
  let signal: AbortSignal | undefined;
  const mocked = ((_url: unknown, options: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      signal = options.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal!.reason), {
        once: true,
      });
    })) as typeof fetch;
  await assert.rejects(
    synthesizeSpeech("Words", config, { fetch: mocked, timeoutMs: 5 }),
    /timed out/,
  );
  assert.equal(signal!.aborted, true);
  const caller = new AbortController();
  const pending = synthesizeSpeech("Words", config, {
    fetch: mocked,
    signal: caller.signal,
  });
  caller.abort(new DOMException("Left page", "AbortError"));
  await assert.rejects(pending, /Left page/);
  assert.equal(signal!.aborted, true);
});

async function server(
  dependencies: Parameters<typeof createTtsRouter>[0],
  run: (url: string) => Promise<void>,
) {
  const app = express();
  app.use(createTtsRouter(dependencies));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("TTS API validates bounded text/request ID, forbids client voice overrides, and sends private audio", async () => {
  let calls = 0;
  await server(
    {
      config: () => config,
      synthesize: async (text, received) => {
        calls++;
        assert.equal(text, "Selected passage");
        assert.equal(received.voiceId, config.voiceId);
        return Buffer.from([1, 2, 3]);
      },
    },
    async (url) => {
      for (const body of [
        { text: "", requestId: "r1" },
        { text: "x".repeat(801), requestId: "r1" },
        { text: "Words", requestId: "../bad" },
        { text: "Words", requestId: "r1", voiceId: "other" },
      ]) {
        const response = await fetch(`${url}/tts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 400);
      }
      assert.equal(calls, 0);
      const response = await fetch(`${url}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Selected passage", requestId: "r1" }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "audio/mpeg");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-speech-request-id"), "r1");
      assert.equal((await response.arrayBuffer()).byteLength, 3);
      assert.equal(calls, 1);
    },
  );
});

test("TTS route disconnect aborts upstream without writing a late response", async () => {
  let start!: () => void, disconnected!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  await server(
    {
      config: () => config,
      synthesize: (_text, _config, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => {
              disconnected();
              reject(options!.signal!.reason);
            },
            { once: true },
          );
          start();
        }),
    },
    async (url) => {
      const client = request(`${url}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      client.on("error", () => {});
      client.end(
        JSON.stringify({ text: "A passage", requestId: "disconnect" }),
      );
      await started;
      client.destroy();
      await Promise.race([
        stopped,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("Disconnect did not abort upstream")),
            1000,
          ).unref(),
        ),
      ]);
    },
  );
});
