import type { Request } from "express";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function parsePageParams(req: Request, defaults: { limit?: number; max?: number } = {}) {
  const defaultLimit = defaults.limit ?? DEFAULT_LIMIT;
  const maxLimit = defaults.max ?? MAX_LIMIT;
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const rawPage = Number(req.query.page);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.floor(rawOffset)
    : Number.isFinite(rawPage) && rawPage > 0
      ? (Math.floor(rawPage) - 1) * limit
      : 0;
  return { limit, offset, from: offset, to: offset + limit - 1 };
}

export function pageMeta(total: number, limit: number, offset: number) {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}
