/**
 * Reads `.code` off a driver error, preferring the top level and falling back
 * to one `.cause` layer.
 *
 * **It cannot tell one refusal from another on this engine, and a caller that
 * needs to should not use it.** `node:sqlite` puts the same constant,
 * `"ERR_SQLITE_ERROR"`, on `.code` for every failure alike and the
 * discriminating number on `errcode`, which this function does not read. So
 * every real refusal — a CHECK, a unique index, a missing table — answers
 * `"ERR_SQLITE_ERROR"` here. Measured 2026-09-23 on Node v26.7.0, one real
 * refusal taken down each of the paths below. `refusalCode` in
 * `../constraint-target.ts` is what reads `errcode`, and `refusalOn` /
 * `checkFailed` / `triggerRaised` beside it are what a test asking WHICH
 * refusal this was should call.
 *
 * It survives because the SQLSTATE it was named for is gone but the two
 * shapes it walks are not: a refusal from `db.run` arrives as drizzle's
 * `DrizzleError`, which has no `.code` of its own and carries the engine's
 * error on `.cause`, while one from `db.all`, `db.get`, `db.execute` or an
 * awaited drizzle query builder is the engine's own `Error`, with `.code` at
 * the top level and no `.cause` at all.
 *
 * Its own suite, `./errors.test.ts`, drives it with hand-built objects
 * carrying PostgreSQL values (`"42501"`, `"WT001"`). Those establish WHICH
 * branch each shape takes and nothing about what arrives from this engine:
 * no value in that file is one `node:sqlite` produces.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

/**
 * The engine's own error text, not a wrapper's.
 *
 * The two shapes it covers, measured 2026-09-23 on Node v26.7.0 by taking one
 * real refusal down each path. `db.run` rejects with drizzle's `DrizzleError`,
 * whose own `.message` is `Failed to run the query '<sql>'` and whose `.cause`
 * carries the engine's text (`CHECK constraint failed: tenants_singleton_ck`,
 * `order_amendments is append-only`) — the `.cause` branch. `db.all`,
 * `db.get`, `db.execute` and an awaited drizzle query builder reject with the
 * engine's own `Error`, where that same text is the top-level `.message` and
 * there is no `.cause` — the second branch. Both paths therefore return the
 * engine's words, which is what every caller matches on.
 *
 * Deliberately does NOT fall back to `String(error)` when neither
 * `.cause.message` nor a top-level `.message` is a string: throws instead.
 * `String(error)` on the wrapper reproduces the failed SQL — here
 * `DrizzleError: Failed to run the query '<sql>'` — which is what this
 * function exists to look past, so a silent fallback would let a pattern that
 * happens to match the SQL itself (a table or column name, say) pass an
 * assertion for the wrong reason. This is the trap `tenancy.test.ts`'s
 * `rejectsWithCauseMatching` (Task 4) was written to close, and this
 * function's contract must not reopen it. The thrown text below quotes the
 * PostgreSQL wrapper's older wording, `Failed query: <sql>`, and is pinned
 * verbatim by `./errors.test.ts` — the hazard it names is the same one.
 *
 * Neither real path leaves both places empty — one carries `.cause.message`,
 * the other a top-level `.message` — so this branch is not expected to fire
 * against a live database; it exists so a caller that reaches it anyway (a
 * mocked or hand-built error shape, say) fails loudly with a clear cause
 * rather than silently asserting against stringified SQL.
 *
 * `tenancy.test.ts` calls this rather than carrying a second, private
 * near-copy — one implementation of "read the engine's message off whatever
 * wrapped it" in this package, not two that could drift apart.
 *
 * Its own suite, `./errors.test.ts`, drives it with hand-built objects
 * carrying PostgreSQL wording (`"permission denied"`, `Failed query: ...`).
 * Those establish which branch each shape takes, and nothing about what
 * arrives from this engine: neither string is one `node:sqlite` produces. What
 * covers the real shapes is every suite that matches a refusal's words —
 * `../schema/sales.test.ts`'s `sales is append-only` among them.
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
 *
 * `fn` may return a value rather than a promise, because this engine is
 * synchronous: `db.execute` hands back a `RawResult`, so `() => db.execute(...)`
 * is not thenable and a refusal arrives as a synchronous throw inside the
 * `try` below. `await` on a non-promise is the identity, so both shapes are
 * captured by the same body. Same widening, and for the same reason, as
 * `withTransaction`'s in `../tenancy.ts`.
 */
export async function captureError(fn: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected, but it succeeded");
}
