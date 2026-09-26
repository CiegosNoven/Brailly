/** A bounded TTS request. Credentials and voice configuration never leave the server. */
export const TTS_MAX_CHARACTERS = 800;
export const TTS_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const TTS_TIMEOUT_MS = 25_000;
export type TtsConfig = {
  enabled: boolean;
  apiKey: string;
  voiceId: string;
  modelId: string;
};
export class TtsError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "TtsError";
  }
}
export function getTtsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig {
  return {
    enabled: env.ELEVENLABS_TTS_ENABLED === "true",
    apiKey: env.ELEVENLABS_API_KEY || "",
    voiceId: env.ELEVENLABS_VOICE_ID || "",
    modelId: env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
  };
}
export function ttsConfigured(config: TtsConfig) {
  return (
    !!config.apiKey &&
    /^[a-zA-Z0-9_-]{1,120}$/.test(config.voiceId) &&
    /^[a-zA-Z0-9_.-]{1,100}$/.test(config.modelId)
  );
}
export function getTtsCapabilities(env: NodeJS.ProcessEnv = process.env) {
  const config = getTtsConfig(env);
  return {
    enabled: config.enabled,
    configured: ttsConfigured(config),
    available: config.enabled && ttsConfigured(config),
    maxCharacters: TTS_MAX_CHARACTERS,
  };
}
export async function synthesizeSpeech(
  text: string,
  config: TtsConfig,
  options: {
    signal?: AbortSignal;
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<Buffer> {
  if (!config.enabled)
    throw new TtsError(
      "ElevenLabs speech is disabled. Use the browser voice.",
      503,
    );
  if (!ttsConfigured(config))
    throw new TtsError(
      "ElevenLabs speech is not configured. Use the browser voice.",
      503,
    );
  if (!text.trim() || text.length > TTS_MAX_CHARACTERS)
    throw new TtsError("Choose text between 1 and 800 characters.", 400);
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const deadline = setTimeout(
    () => controller.abort(new DOMException("TTS timed out", "TimeoutError")),
    options.timeoutMs ?? TTS_TIMEOUT_MS,
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    controller.signal.throwIfAborted();
    const response = await (options.fetch ?? fetch)(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: config.modelId }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new TtsError(
          "ElevenLabs could not authorize this voice. Use the browser voice.",
        );
      if (response.status === 429)
        throw new TtsError(
          "ElevenLabs is busy or has reached its usage limit. Use the browser voice.",
          429,
        );
      throw new TtsError(
        "ElevenLabs could not generate speech. Use the browser voice.",
      );
    }
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (mime !== "audio/mpeg" || !response.body) {
      await response.body?.cancel();
      throw new TtsError(
        "ElevenLabs returned an invalid audio response. Use the browser voice.",
      );
    }
    if (Number(response.headers.get("content-length")) > TTS_MAX_AUDIO_BYTES) {
      await response.body.cancel();
      throw new TtsError(
        "The generated audio exceeds the supported size. Choose a shorter passage.",
      );
    }
    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const chunk = await reader.read();
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > TTS_MAX_AUDIO_BYTES)
        throw new TtsError(
          "The generated audio exceeds the supported size. Choose a shorter passage.",
        );
      chunks.push(Buffer.from(chunk.value));
    }
    if (!bytes)
      throw new TtsError(
        "ElevenLabs returned empty audio. Use the browser voice.",
      );
    return Buffer.concat(chunks);
  } catch (error) {
    if (options.signal?.aborted)
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (controller.signal.aborted)
      throw new TtsError(
        "Speech generation timed out. Try again or use the browser voice.",
        504,
      );
    if (error instanceof TtsError) throw error;
    throw new TtsError(
      "Could not connect to ElevenLabs. Use the browser voice.",
    );
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", cancel);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* Already aborted. */
      }
      reader.releaseLock();
    }
  }
}
