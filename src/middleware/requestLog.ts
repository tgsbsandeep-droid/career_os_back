import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

// ── Structured logger ─────────────────────────────────────────────────────────

type LogLevel = "info" | "warn" | "error";

/**
 * Emit a structured JSON log line.
 * In development (NODE_ENV !== "production") a human-readable line is used
 * instead so the terminal stays readable.
 */
export function structuredLog(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const prefix = level === "error" ? "ERROR" : level === "warn" ? "WARN " : "INFO ";
    const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
    const line = `${prefix} ${msg}${suffix}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } else {
    const entry = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra });
    if (level === "error") console.error(entry);
    else if (level === "warn") console.warn(entry);
    else console.log(entry);
  }
}

/**
 * Create a request-scoped logger that automatically includes the request ID.
 * Usage in a route handler:
 *   const log = reqLogger(req);
 *   log.info("profile updated", { userId });
 */
export function reqLogger(req: Request) {
  const requestId = (req as Request & { requestId?: string }).requestId ?? "unknown";
  return {
    info: (msg: string, extra?: Record<string, unknown>) =>
      structuredLog("info", msg, { requestId, ...extra }),
    warn: (msg: string, extra?: Record<string, unknown>) =>
      structuredLog("warn", msg, { requestId, ...extra }),
    error: (msg: string, extra?: Record<string, unknown>) =>
      structuredLog("error", msg, { requestId, ...extra }),
  };
}

// ── Request-ID middleware ─────────────────────────────────────────────────────

/**
 * Attach a unique request-ID to every inbound request so that all log lines
 * for a single request can be correlated in production logs.
 *
 * Priority order for the ID:
 *   1. X-Request-Id header forwarded by a load-balancer / API gateway
 *   2. A freshly generated UUID v4
 *
 * The ID is written back on the response as `X-Request-Id` so clients and
 * upstream proxies can correlate it too.
 */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const requestId =
    (Array.isArray(req.headers["x-request-id"])
      ? req.headers["x-request-id"][0]
      : req.headers["x-request-id"]) ?? randomUUID();

  // Expose on the request object so route handlers can include it in their
  // own log/error output via reqLogger(req).
  (req as Request & { requestId: string }).requestId = requestId;

  // Echo back so the caller can correlate client-side.
  res.setHeader("X-Request-Id", requestId);

  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    structuredLog(level, `${req.method} ${req.originalUrl}`, {
      requestId,
      status: res.statusCode,
      ms,
      ip: req.ip,
    });
  });
  next();
}
