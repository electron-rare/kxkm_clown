import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Session / Login
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  username: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/),
  role: z.enum(["admin", "editor", "operator", "viewer"]).optional(),
  token: z.string().max(256).optional(),
  password: z.string().max(256).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Persona CRUD
// ---------------------------------------------------------------------------

export const createPersonaSchema = z.object({
  name: z.string().min(1).max(50),
  model: z.string().min(1).max(100).optional(),
  summary: z.string().max(2000).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

export const updatePersonaSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  summary: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
});

export const togglePersonaSchema = z.object({
  enabled: z.boolean().optional(),
});

export const updatePersonaSourceSchema = z.object({
  subjectName: z.string().max(200).optional(),
  summary: z.string().max(5000).optional().default(""),
  references: z.array(z.string().max(500)).max(100).optional().default([]),
});

export const reinforcePersonaSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  summary: z.string().max(2000).optional(),
  apply: z.boolean().optional(),
});

export const voiceSampleSchema = z.object({
  audio: z.string().min(1), // base64
});

// ---------------------------------------------------------------------------
// Node Engine
// ---------------------------------------------------------------------------

export const createGraphSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional().default(""),
});

export const updateGraphSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
});

export const runGraphSchema = z.object({
  hold: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Chat History
// ---------------------------------------------------------------------------

export const retentionSweepSchema = z.object({
  maxAgeDays: z.number().int().min(1).max(365).optional(),
});

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().min(1).max(8192) }),
  z.object({ type: z.literal("command"), text: z.string().min(1).max(8192) }),
  z.object({
    type: z.literal("upload"),
    filename: z.string().max(255).optional(),
    mimeType: z.string().max(100).optional(),
    data: z.string().optional(), // base64
    size: z.number().max(16 * 1024 * 1024).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Middleware helper -- validate(schema) returns Express middleware
// ---------------------------------------------------------------------------

export function validate<T>(schema: z.ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        ok: false,
        error: "validation_error",
        details: result.error.issues,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
