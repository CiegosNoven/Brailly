import { z } from "zod";
import type { Classification, PageSnapshot } from "./dom.js";
export const VISUAL_MAX_CANDIDATES = 12;
export const VISUAL_MAX_INSPECTIONS = 2;
export const VISUAL_DEADLINE_MS = 45_000;
export const VISUAL_MAX_EVENT_BYTES = 512_000;
const id = z.string().min(1).max(100);
const probability = z.number().finite().min(0).max(1);
export const visualRequestSchema = z
  .object({
    requestId: id,
    url: z.url().max(2048),
    task: z.string().trim().min(3).max(500),
  })
  .strict();
export type VisualRequest = z.infer<typeof visualRequestSchema>;
export const visualCandidateSchema = z
  .object({
    candidateId: z.string().regex(/^v\d+$/),
    kind: z.enum(["img", "canvas", "svg", "role-img"]),
    altStatus: z.enum(["missing", "empty", "present", "not-applicable"]),
    sourceAltText: z.string().max(800).nullable(),
    title: z.string().max(300),
    caption: z.string().max(800),
    accessibleName: z.string().max(800),
    nearbyHeading: z.string().max(500),
    nearbyText: z.string().max(800),
    control: z
      .object({ role: z.string().max(40), text: z.string().max(300) })
      .nullable(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
    hidden: z.boolean(),
    locator: z.string().max(100),
    signature: z.string().min(1).max(100),
    asset: z.string().max(2048),
  })
  .strict();
export type VisualCandidate = z.infer<typeof visualCandidateSchema>;
export const visualDecisionSchema = z
  .object({
    candidateId: z.string().regex(/^v\d+$/),
    decision: z.enum(["INSPECT", "SKIP", "UNKNOWN"]),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
    reason: z.enum([
      "inspect",
      "source-alt-sufficient",
      "irrelevant",
      "uncertain",
      "hidden",
    ]),
    model: z.string().max(150),
  })
  .strict();
export type VisualDecision = z.infer<typeof visualDecisionSchema>;
export const visualEvidenceSchema = z
  .object({
    requestId: id,
    snapshotId: id,
    captureId: id,
    candidateId: z.string().regex(/^v\d+$/),
    signature: z.string().min(1).max(100),
    sourceAltText: z.string().max(800).nullable(),
    generatedDescription: z.string().max(800).nullable(),
    recognizedText: z.string().max(800),
    uncertainty: z.string().max(500),
    observedAt: z.string().max(100),
    method: z.enum(["source-alt", "stagehand-vision"]),
    model: z.string().max(150).nullable(),
    score: z.number().finite().min(0).max(3).nullable(),
    confidence: probability.nullable(),
    priority: z.enum(["NOW", "NEXT", "LATER", "REVIEW"]),
  })
  .strict();
export type VisualEvidence = z.infer<typeof visualEvidenceSchema>;
export const visualCoverageSchema = z
  .object({
    totalCandidates: z.number().int().nonnegative(),
    includedCandidates: z.number().int().nonnegative().max(12),
    inspected: z.number().int().nonnegative().max(2),
    sourceAlt: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    uninspected: z.number().int().nonnegative(),
    hidden: z.number().int().nonnegative(),
    truncated: z.boolean(),
    domSkipped: z.boolean(),
    blockedRequests: z.number().int().nonnegative().nullable(),
    unsupported: z.array(z.string().max(100)).max(8),
  })
  .strict();
export type VisualCoverage = z.infer<typeof visualCoverageSchema>;
const block = z.object({
  id: z.string().regex(/^b\d+$/),
  tag: z.string().max(20),
  role: z.string().max(40),
  region: z.string().max(40),
  text: z.string().min(1).max(800),
  href: z.string().max(2048).optional(),
  context: z.string().max(240).optional(),
  live: z.literal("timer").optional(),
  order: z.number().int().nonnegative(),
});
const page = z.object({
  id,
  url: z.string().max(2048),
  title: z.string().max(500),
  blocks: z.array(block).max(60),
  capturedAt: z.string().max(100),
  source: z.literal("browserbase"),
  totalCandidates: z.number().int().nonnegative(),
  truncated: z.boolean(),
}) satisfies z.ZodType<PageSnapshot>;
const result = z.object({
  id: z.string().regex(/^b\d+$/),
  category: z.enum(["CONTENT", "ACTION", "NAVIGATION", "NOTICE", "EXTRA"]),
  score: z.number().finite().min(0).max(3),
  confidence: probability,
  probabilities: z.record(z.string(), probability),
  categoryConfidence: probability,
  priority: z.enum(["NOW", "NEXT", "LATER", "REVIEW"]),
});
const classification = z.object({
  snapshotId: id,
  task: z.string().max(500),
  model: z.string().max(150),
  latencyMs: z.number().finite().nonnegative(),
  results: z.array(result).max(60),
  request: z.unknown(),
  usage: z.unknown().optional(),
  source: z.literal("Jev"),
}) satisfies z.ZodType<Classification>;
const base = {
  requestId: id,
  snapshotId: id,
  captureId: id,
  sequence: z.number().int().positive(),
};
export const visualMetricsSchema = z
  .object({
    totalMs: z.number().nonnegative(),
    loadMs: z.number().nonnegative(),
    domMs: z.number().nonnegative(),
    selectionMs: z.number().nonnegative(),
    visionMs: z.number().nonnegative(),
    priorityMs: z.number().nonnegative(),
  })
  .strict();
export type VisualMetrics = z.infer<typeof visualMetricsSchema>;
export const visualEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("snapshot"),
      page,
      candidates: z.array(visualCandidateSchema).max(12),
      coverage: visualCoverageSchema,
    })
    .strict(),
  z.object({ ...base, type: z.literal("dom-ranked"), classification }).strict(),
  z
    .object({
      ...base,
      type: z.literal("visual-decisions"),
      decisions: z.array(visualDecisionSchema).max(12),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("visual-evidence"),
      evidence: z.array(visualEvidenceSchema).max(12),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("stage-error"),
      stage: z.enum([
        "dom",
        "selection",
        "vision",
        "priority",
        "capture",
        "deadline",
        "cleanup",
      ]),
      message: z.string().max(500),
      candidateId: z
        .string()
        .regex(/^v\d+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("done"),
      status: z.enum(["complete", "partial"]),
      coverage: visualCoverageSchema,
      metrics: visualMetricsSchema,
      sessionClosed: z.boolean(),
    })
    .strict(),
]);
export type VisualEvent = z.infer<typeof visualEventSchema>;
export type VisualEventPayload = VisualEvent extends infer E
  ? E extends VisualEvent
    ? Omit<E, keyof typeof base>
    : never
  : never;
