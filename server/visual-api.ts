import express from "express";
import {
  visualRequestSchema,
  VISUAL_MAX_EVENT_BYTES,
} from "../shared/visual.js";
import { visualAllowedOrigins, validateVisualUrl } from "./browserbase.js";
import {
  runVisualCapture,
  defaultVisualDependencies,
  type VisualDependencies,
} from "./visual-service.js";
export function getVisualCapabilities() {
  const visualEnabled = process.env.VISUAL_ENRICHMENT_ENABLED === "true";
  const visualConfigured = !!process.env.BROWSERBASE_API_KEY;
  return {
    visualEnabled: visualEnabled && visualConfigured,
    visualConfigured,
    visualAllowedOrigins: visualAllowedOrigins(),
  };
}
export function createVisualApi(dependencies?: VisualDependencies) {
  const router = express.Router();
  const windows = new Map<string, { start: number; count: number }>();
  router.post("/visual-capture", async (req, res) => {
    if (!getVisualCapabilities().visualEnabled)
      return res
        .status(503)
        .json({
          error:
            "Visual enrichment is disabled or Browserbase is not configured.",
        });
    const parsed = visualRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error:
            "Enter a valid URL, request identity and task of 3–500 characters.",
        });
    try {
      validateVisualUrl(parsed.data.url);
    } catch {
      return res
        .status(400)
        .json({
          error:
            "Use one of the configured public HTTPS demo origins for visual capture.",
        });
    }
    const now = Date.now();
    for (const [key, slot] of windows)
      if (now - slot.start > 60000) windows.delete(key);
    const key = req.ip || "unknown";
    const slot = windows.get(key) || { start: now, count: 0 };
    if (++slot.count > 4)
      return res
        .status(429)
        .json({
          error: "Too many visual captures. Wait a minute before trying again.",
        });
    windows.set(key, slot);
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded)
        controller.abort(
          new DOMException("Client disconnected.", "AbortError"),
        );
    };
    req.once("aborted", disconnect);
    res.once("close", disconnect);
    try {
      await runVisualCapture(
        parsed.data,
        (event) => {
          if (controller.signal.aborted || res.destroyed || res.writableEnded)
            return;
          const line = JSON.stringify(event) + "\n";
          if (Buffer.byteLength(line) > VISUAL_MAX_EVENT_BYTES)
            throw new Error("Visual event exceeds its size limit.");
          if (!res.headersSent) {
            res.status(200);
            res.setHeader(
              "Content-Type",
              "application/x-ndjson; charset=utf-8",
            );
            res.setHeader("Cache-Control", "no-store, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders();
          }
          res.write(line);
        },
        controller.signal,
        dependencies || defaultVisualDependencies(),
      );
      if (!controller.signal.aborted && !res.writableEnded) res.end();
    } catch (e) {
      if (controller.signal.aborted) return;
      if (!res.headersSent)
        res
          .status(e instanceof Error && e.name === "TimeoutError" ? 504 : 502)
          .json({
            error:
              "Browserbase capture could not finish. Your current reading is unchanged.",
          });
      else if (!res.writableEnded) res.end();
    } finally {
      req.off("aborted", disconnect);
      res.off("close", disconnect);
    }
  });
  return router;
}
export const visualApi = createVisualApi();
