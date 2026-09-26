import express from "express";
import { z } from "zod";
import { parsePage } from "./page.js";
import { fetchExpandedPage } from "./embedded-page.js";
import { classifyDom } from "./dom-jev.js";
export const webApi = express.Router();
webApi.use(express.json({ limit: "200kb" }));
webApi.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
// Public demo API accepts only bounded page text, never executes it, and has no write actions.
// Extension origins need CORS to call the same deployed classifier.
webApi.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin?.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
const windows = new Map<string, { start: number; count: number }>();
webApi.use((req, res, next) => {
  if (req.method !== "POST" || !["/page", "/rank"].includes(req.path))
    return next();
  const id = req.ip || "unknown";
  const now = Date.now();
  for (const [key, value] of windows)
    if (now - value.start > 60000) windows.delete(key);
  const slot = windows.get(id) || { start: now, count: 0 };
  slot.count++;
  windows.set(id, slot);
  if (slot.count > 20)
    return res
      .status(429)
      .json({ error: "Too many requests. Wait a minute before trying again." });
  next();
});
webApi.get("/config", (_req, res) =>
  res.json({
    jevConfigured: !!process.env.TYPESAFE_API_KEY,
    model: process.env.TYPESAFE_MODEL || "jev-1.13.0",
  }),
);
webApi.post("/page", async (req, res) => {
  const p = z.object({ url: z.url().max(2048) }).safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "Enter a complete website URL, starting with https://." });
  try {
    const source = await fetchExpandedPage(p.data.url);
    const page = parsePage(source.html, source.url);
    if (!page.blocks.length)
      return res
        .status(422)
        .json({
          error:
            "No readable HTML blocks found. Use the extension for JavaScript-rendered pages.",
        });
    res.json({
      ...page,
      embeddedSources: source.embeddedSources,
      embeddedOmitted: source.embeddedOmitted,
    });
  } catch (e) {
    res
      .status(422)
      .json({
        error:
          e instanceof Error
            ? e.message
            : "Could not load this page. Try the extension.",
      });
  }
});
const blockSchema = z.object({
  id: z.string().regex(/^b\d+$/),
  tag: z.string().max(20),
  role: z.string().max(40),
  region: z.string().max(40),
  text: z.string().min(1).max(800),
  context: z.string().max(240).optional(),
  live: z.enum(["timer"]).optional(),
  href: z.string().max(2048).optional(),
  order: z.number().int().min(0),
});
const input = z
  .object({
    context: z
      .object({
        current: blockSchema,
        offset: z.number().int().min(0).max(800),
        previousBlocks: z.array(blockSchema).max(60),
      })
      .optional(),
    task: z.string().trim().min(3).max(500),
    page: z.object({
      id: z.string().max(100),
      url: z.string().max(2048),
      title: z.string().max(500),
      blocks: z.array(blockSchema).max(60),
      capturedAt: z.string().max(100),
      source: z.enum(["url", "extension", "example"]),
      totalCandidates: z.number(),
      truncated: z.boolean(),
    }),
  })
  .refine((value) => value.page.blocks.length > 0 || !!value.context);
webApi.post("/rank", async (req, res) => {
  const p = input.safeParse(req.body);
  if (!p.success)
    return res
      .status(400)
      .json({ error: "The page or task is invalid. Load the page again." });
  if (
    new Set(p.data.page.blocks.map((b) => b.id)).size !==
    p.data.page.blocks.length
  )
    return res.status(400).json({ error: "Duplicate DOM block identifiers." });
  const key = process.env.TYPESAFE_API_KEY;
  if (!key)
    return res
      .status(503)
      .json({
        error:
          "Live Jev needs a TYPESAFE_API_KEY on the server. DOM extraction and reading work without it; scores will only appear after a real call.",
      });
  try {
    res.json(
      await classifyDom(
        p.data.page,
        p.data.task,
        key,
        process.env.TYPESAFE_MODEL || "jev-1.13.0",
        p.data.context,
      ),
    );
  } catch (e) {
    res
      .status(502)
      .json({
        error:
          e instanceof Error && e.name === "TimeoutError"
            ? "Jev took too long. Your current reading is unchanged."
            : e instanceof Error && e.message.startsWith("Jev returned")
              ? e.message
              : "Jev returned an invalid response. Your current reading is unchanged.",
      });
  }
});
