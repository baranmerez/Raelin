import { z } from "zod";

/**
 * Typed board commands. The same schema validates AI requests (MCP) and documents what a
 * batch may contain; `applyOps` then checks everything that depends on the board itself.
 */

export const toneSchema = z.enum(["lilac", "peach", "periwinkle", "sage", "butter", "paper"]);
export const shapeSchema = z.enum([
  "terminal",
  "process",
  "decision",
  "ellipse",
  "database",
  "document",
  "io",
  "cloud",
  "actor",
]);
const sideSchema = z.enum(["t", "r", "b", "l"]);
const idSchema = z.string().min(1).max(80);
const textSchema = z.string().max(2000);
const shortSchema = z.string().max(200);

/** Fields of the card kinds, shared by add and update. Lists replace the whole list. */
const cardFields = {
  size: z.enum(["s", "m", "l"]).optional().describe("text only."),
  url: z.string().max(2000).optional().describe("link: http(s) only."),
  note: textSchema.optional().describe("link note."),
  items: z
    .array(z.object({ text: textSchema, done: z.boolean().optional() }).strict())
    .max(200)
    .optional()
    .describe("checklist entries."),
  columns: z
    .array(
      z
        .object({
          name: shortSchema,
          type: z.string().max(60),
          pk: z.boolean().optional(),
          nullable: z.boolean().optional(),
          note: textSchema.optional(),
        })
        .strict(),
    )
    .max(200)
    .optional()
    .describe("table columns; relations are connect ops between tables (style reference)."),
};

export const placeSchema = z
  .object({
    after: idSchema.optional().describe("Put the new node below this node (id or ref)."),
    in: idSchema.optional().describe("Put the new node into this region (id or ref)."),
    x: z.number().finite().optional().describe("Center x; only when an exact spot matters."),
    y: z.number().finite().optional(),
  })
  .strict();

export const opSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      ref: idSchema.optional().describe("Temporary name to use for this node later in the batch."),
      kind: z.enum(["flowNode", "note", "region", "text", "checklist", "link", "table"]),
      shape: shapeSchema.optional().describe("flowNode only; default process."),
      text: textSchema.optional().describe("flowNode or text label."),
      title: textSchema.optional().describe("note/region/checklist/link title; table name."),
      markdown: z
        .string()
        .max(20000)
        .optional()
        .describe("note body: paragraphs, - bullets, 1. lists, **bold**."),
      tone: toneSchema.optional(),
      ...cardFields,
      place: placeSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("update"),
      id: idSchema,
      text: textSchema.optional(),
      title: textSchema.optional(),
      markdown: z.string().max(20000).optional(),
      tone: toneSchema.optional(),
      shape: shapeSchema.optional(),
      ...cardFields,
    })
    .strict(),
  z
    .object({
      op: z.literal("connect"),
      ref: idSchema.optional(),
      from: idSchema,
      to: idSchema,
      label: z.string().max(200).optional(),
      style: z
        .enum(["flow", "reference"])
        .optional()
        .describe("reference = relation, not flow order."),
      fromSide: sideSchema.optional(),
      toSide: sideSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("update_edge"),
      id: idSchema,
      label: z.string().max(200).nullable().optional().describe("null removes the label."),
      style: z.enum(["flow", "reference"]).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      id: idSchema,
      place: placeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("delete"),
      ids: z.array(idSchema).min(1).max(500),
    })
    .strict(),
  z
    .object({
      op: z.literal("style"),
      flowStyle: z.enum(["pastel", "line", "flat"]).optional(),
      connector: z.enum(["elbow", "curve", "straight"]).optional(),
      background: z.enum(["dots", "grid", "plain"]).optional(),
    })
    .strict(),
]);

export type Op = z.infer<typeof opSchema>;
export type Place = z.infer<typeof placeSchema>;

export const maxOpsPerBatch = 200;
