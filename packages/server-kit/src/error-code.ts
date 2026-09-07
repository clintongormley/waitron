import { isAppError } from "@waitron/shared";

/**
 * A structured code, never prose. `pass.ts`'s `attempt` and `loop.ts`'s `runLoop` each classify a
 * caught value the same way — an `AppError`'s own `.code`, or `"unknown"` for anything else —
 * because whatever reaches either catch is by definition unclassified (an ordinary duty failure was
 * already turned into a `DutyReport` before it could reach `loop.ts` at all) and a bare `.message`
 * could carry anything a driver or client library chose to embed: a connection string, a request
 * detail. Only the code is safe to log. One function, not two copies of the same rule with two
 * different explanations of it — the shape every OTHER structured-code helper in this repo's
 * packages already uses (each package's own `codeOf`), applied here across this package's two files
 * rather than left duplicated within a single one.
 */
export function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
