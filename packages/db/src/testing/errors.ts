/**
 * Extracts a Postgres SQLSTATE from a driver error.
 *
 * node-postgres puts it on `.code`; PGlite has been observed to nest the
 * original error under `.cause`. Both drivers' errors also arrive wrapped in
 * drizzle's `DrizzleQueryError` (see `db.execute`/`tx.execute`), which has no
 * `.code` of its own and carries the real error on `.cause` — so the same
 * `.cause` fallback that unwraps PGlite's nesting also unwraps drizzle's
 * wrapper, and the two are normalised here so that a test asserting on a
 * SQLSTATE reads identically against both targets.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

/**
 * The Postgres error text, not the wrapper's.
 *
 * `db.execute`/`tx.execute` wrap every failed query in a `DrizzleQueryError`
 * whose own `.message` is `Failed query: <sql>\nparams: <params>` — the
 * actual Postgres text (`permission denied for table ...`, `table ... is
 * append-only: ...`) lives on `.cause`, not on `.message`.
 *
 * Deliberately does NOT fall back to `String(error)` when neither
 * `.cause.message` nor a top-level `.message` is a string: throws instead.
 * `String(error)` on a `DrizzleQueryError` reproduces the exact
 * `Failed query: <sql>` text this function exists to bypass, so a silent
 * fallback would let a pattern that happens to match the SQL itself (a table
 * or column name, say) pass an assertion for the wrong reason — this is the
 * trap `tenancy.test.ts`'s `rejectsWithCauseMatching` (Task 4) was written
 * to close, and this function's contract must not reopen it. Both real
 * drivers always populate `.cause.message`, so this branch is not expected
 * to fire against a live database; it exists so a caller that reaches it
 * anyway (a mocked or hand-built error shape, say) fails loudly with a clear
 * cause rather than silently asserting against stringified SQL.
 *
 * `tenancy.test.ts` uses this function directly for its own `.cause`
 * extraction rather than carrying a second, private near-copy of it — one
 * canonical implementation of "read the real Postgres message off a wrapped
 * driver error" in this package, not two that could drift apart.
 */
export function pgErrorMessage(error: unknown): string {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | null | undefined;
  if (typeof e?.cause?.message === "string") return e.cause.message;
  if (typeof e?.message === "string") return e.message;
  throw new Error(
    `pgErrorMessage: neither .cause.message nor .message is a string on this error ` +
      `(received: ${String(error)}) — refusing to fall back to String(error), which would ` +
      `reproduce a DrizzleQueryError's generic "Failed query: <sql>" text and let an ` +
      `assertion on it pass for the wrong reason`,
  );
}

/**
 * Runs `fn`, expecting it to reject, and returns the rejection.
 *
 * Throws if it SUCCEEDS. `try { await fn() } catch {}` in a test body is the
 * classic vacuous rejection assertion: it passes whether the operation was
 * blocked or sailed through.
 */
export async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected, but it succeeded");
}
