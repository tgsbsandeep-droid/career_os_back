import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

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
  // own log/error output: `req.requestId`
  (req as Request & { requestId: string }).requestId = requestId;

  // Echo back so the caller can correlate client-side.
  res.setHeader("X-Request-Id", requestId);

  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    const line = `[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) {
      console.error(line);
    } else if (res.statusCode >= 400) {
      console.warn(line);
    } else {
      console.log(line);
    }
  });
  next();
}
