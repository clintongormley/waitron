import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import type { AppError } from "@waitron/shared";

/**
 * Runs `fn`, expecting it to fail with an `AppError`, and returns that error.
 *
 * Four copies of this lived in `keyring.test.ts`, `purposes.test.ts`, `store.test.ts` and
 * `rotate.test.ts` — two byte-identical sync ones and two byte-identical async ones, one per task
 * that needed it, because each task's author saw only their own task.
 *
 * Two exports rather than one because the subjects differ, not the logic: `loadKeyRing` and
 * `validatePayload` throw synchronously, while the store's functions reject. That is also the
 * whole of why the four copies' diagnostics differed ("did not throw" vs "did not reject") — the
 * split was real, the duplication within each half was not. The narrowing rule both halves share —
 * an `AppError` is the assertion's subject, anything else is a genuine failure and must not be
 * swallowed — lives once, in `asAppError`.
 */
function asAppError(error: unknown): AppError {
  // Rethrown, never returned: a `TypeError` from a broken test double is not a finding about the
  // code under test, and returning it here would let a test assert `hasCode(...)` against it and
  // report a green pass for the wrong reason.
  if (isAppError(error)) return error;
  throw error;
}

/** For a subject that throws synchronously. Throws if `fn` returns normally. */
export function capturedSync(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    return asAppError(error);
  }
  throw new Error("expected the call to throw, and it did not");
}

/**
 * For a subject that rejects. Built on `@waitron/db`'s `captureError`, which already owns the
 * "run it, expect a rejection, throw if it succeeds" half — the former copies re-implemented that
 * control flow from scratch in a package that already imports `captureError` in
 * `migrations.test.ts`.
 */
export async function captured(fn: () => Promise<unknown>): Promise<AppError> {
  return asAppError(await captureError(fn));
}
