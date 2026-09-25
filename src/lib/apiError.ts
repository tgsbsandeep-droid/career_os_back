/**
 * Returns a safe error message for HTTP responses.
 *
 * In development (NODE_ENV !== "production") the raw error message is returned
 * so developers can debug quickly. In production a generic message is returned
 * instead, preventing internal Supabase / DB error details from leaking to
 * end users or being captured by browser devtools / network logs.
 */
export function safeErrorMessage(error: unknown, fallback = "An unexpected error occurred"): string {
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  if (process.env.NODE_ENV !== "production") return raw;
  // In production, only surface messages that are already user-facing
  // (short, no stack traces, no Supabase internals).
  const isUserFacing =
    raw.length < 200 &&
    !/supabase|postgrest|pg_|relation|column|syntax error|42[A-Z0-9]{3}|jwt|bearer/i.test(raw);
  return isUserFacing ? raw : fallback;
}