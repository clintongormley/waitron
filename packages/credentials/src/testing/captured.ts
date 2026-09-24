import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import type { AppError } from "@waitron/shared";

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

/** For a subject that rejects. Throws if `fn` resolves. */
export async function captured(fn: () => Promise<unknown>): Promise<AppError> {
  return asAppError(await captureError(fn));
}
