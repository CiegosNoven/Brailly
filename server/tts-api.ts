import express from "express";
import { z } from "zod";
import {
  getTtsConfig,
  synthesizeSpeech,
  TtsError,
  TTS_MAX_CHARACTERS,
} from "./elevenlabs.js";
export { getTtsCapabilities } from "./elevenlabs.js";

const ttsInput = z
  .object({
    text: z
      .string()
      .min(1)
      .max(TTS_MAX_CHARACTERS)
      .refine((value) => !!value.trim()),
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();

export function createTtsRouter(
  dependencies: {
    config?: typeof getTtsConfig;
    synthesize?: typeof synthesizeSpeech;
  } = {},
) {
  const router = express.Router();
  router.post("/tts", express.json({ limit: "8kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const parsed = ttsInput.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error:
            "Choose text between 1 and 800 characters and a valid speech request ID.",
        });
    const abort = new AbortController();
    const onAborted = () =>
      abort.abort(new DOMException("Client disconnected", "AbortError"));
    const onClose = () => {
      if (!res.writableEnded) onAborted();
    };
    req.once("aborted", onAborted);
    res.once("close", onClose);
    try {
      const audio = await (dependencies.synthesize ?? synthesizeSpeech)(
        parsed.data.text,
        (dependencies.config ?? getTtsConfig)(),
        { signal: abort.signal },
      );
      if (abort.signal.aborted || res.destroyed) return;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Speech-Request-Id", parsed.data.requestId);
      res.send(audio);
    } catch (error) {
      if (abort.signal.aborted || res.destroyed) return;
      res.status(error instanceof TtsError ? error.status : 502).json({
        error:
          error instanceof TtsError
            ? error.message
            : "Could not generate speech. Use the browser voice.",
      });
    } finally {
      req.removeListener("aborted", onAborted);
      res.removeListener("close", onClose);
    }
  });
  return router;
}
export const ttsApi = createTtsRouter();
