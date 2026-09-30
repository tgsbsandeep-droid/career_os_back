/**
 * Zod v4 request-body validation helper.
 *
 * Usage in a route handler:
 *
 *   const body = validateBody(req, res, MySchema);
 *   if (!body) return;          // 400 already sent
 *   // body is fully typed
 *
 * The helper sends a 400 JSON response with a structured errors array when
 * validation fails, so routes don't need to repeat that boilerplate.
 */

import type { Request, Response } from "express";
import { z } from "zod";

export type ValidationErrors = Array<{ path: string; message: string }>;

/**
 * Validate `req.body` against `schema`.
 * Returns the parsed (and typed) value on success, or null after sending a 400.
 */
export function validateBody<T extends z.ZodTypeAny>(
  req: Request,
  res: Response,
  schema: T,
): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (result.success) return result.data as z.infer<T>;

  // Zod v4 uses `issues` instead of `errors`.
  const issues = (result.error as z.ZodError).issues ?? [];
  const errors: ValidationErrors = issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  res.status(400).json({ success: false, message: "Validation failed", errors });
  return null;
}

// ── Reusable field schemas (zod v4 compatible) ────────────────────────────────

/** Non-empty trimmed string. */
export const zStr = (label: string) =>
  z.string().trim().min(1, `${label} is required`);

/** Optional trimmed string — undefined or non-empty after trim. */
export const zOptStr = () =>
  z.string().trim().optional();

/** http/https URL or empty/absent (stored as null). */
export const zHttpUrl = (label = "URL") =>
  z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => {
        if (!v) return true;
        try {
          const p = new URL(v);
          return p.protocol === "http:" || p.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: `${label} must be a valid http or https URL` },
    );

/** Positive integer. */
export const zPosInt = (label: string) =>
  z
    .number()
    .int(`${label} must be an integer`)
    .positive(`${label} must be positive`);

/** ISO date-time string. */
export const zIsoDate = (label: string) =>
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: `${label} must be a valid date-time string` });
