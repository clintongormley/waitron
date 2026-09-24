import { isAppError } from "@waitron/shared";

/**
 * A structured code, never prose: a caught value's `.message` can carry whatever a driver or
 * library embedded, such as the failing statement's own text. Only the code is safe to log.
 */
export function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
