/**
 * Reads `.code` off a driver error, preferring the top level and falling back
 * to one `.cause` layer.
 *
 * **It cannot tell one refusal from another on this engine, and a caller that
 * needs to should not use it.** `node:sqlite` puts the same constant,
 * `"ERR_SQLITE_ERROR"`, on `.code` for every failure alike and the
 * discriminating number on `errcode`, which this function does not read.
 * `refusalOn` / `checkFailed` / `triggerRaised` in `../constraint-target.ts`
 * are what a test asking WHICH refusal this was should call.
 *
 * The two shapes it walks: a refusal from `db.run` arrives as drizzle's
 * `DrizzleError`, which has no `.code` of its own and carries the engine's
 * error on `.cause`, while one from `db.all`, `db.get`, `db.execute` or an
 * awaited drizzle query builder is the engine's own `Error`, with `.code` at
 * the top level and no `.cause` at all.
 *
 * Its own suite, `./errors.test.ts`, drives it with hand-built objects
 * carrying PostgreSQL values. Those establish WHICH branch each shape takes
 * and nothing about what arrives from this engine.
 */
export function driverErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}

/**
 * The engine's own error text, not a wrapper's. `db.run` rejects with
 * drizzle's `DrizzleError`, whose own `.message` is
 * `Failed to run the query '<sql>'` and whose `.cause` carries the engine's
 * text. `db.all`, `db.get`, `db.execute` and an awaited drizzle query builder
 * reject with the engine's own `Error`, where that same text is the top-level
 * `.message` and there is no `.cause`.
 *
 * Deliberately does NOT fall back to `String(error)` when neither
 * `.cause.message` nor a top-level `.message` is a string: throws instead.
 * `String(error)` on the wrapper reproduces the failed SQL, so a silent
 * fallback would let a pattern that happens to match the SQL itself (a table
 * or column name, say) pass an assertion for the wrong reason. The thrown text
 * below quotes the PostgreSQL wrapper's older wording, `Failed query: <sql>`,
 * and is pinned verbatim by `./errors.test.ts` — the hazard it names is the
 * same one.
 *
 * Its own suite drives it with hand-built objects carrying PostgreSQL wording.
 * Those establish which branch each shape takes, and nothing about what
 * arrives from this engine.
 */
export function engineErrorMessage(error: unknown): string {
  const e = error as { message?: unknown; cause?: { message?: unknown } } | null | undefined;
  if (typeof e?.cause?.message === "string") return e.cause.message;
  if (typeof e?.message === "string") return e.message;
  throw new Error(
    `engineErrorMessage: neither .cause.message nor .message is a string on this error ` +
      `(received: ${String(error)}) — refusing to fall back to String(error), which would ` +
      `reproduce a DrizzleQueryError's generic "Failed query: <sql>" text and let an ` +
      `assertion on it pass for the wrong reason`,
  );
}

/**
 * Runs `fn`, expecting it to reject, and returns the rejection. Throws if it
 * SUCCEEDS.
 *
 * `fn` may return a value rather than a promise, because this engine is
 * synchronous: a refusal from `() => db.execute(...)` arrives as a synchronous
 * throw inside the `try` below.
 */
export async function captureError(fn: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be rejected, but it succeeded");
}
