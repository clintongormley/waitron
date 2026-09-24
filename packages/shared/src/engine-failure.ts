import { MAX_CAUSE_DEPTH } from "./cause-chain.js";

/**
 * The engine's own failure — its extended result code and the message that goes with it — taken
 * from the first layer of the cause chain that carries one, or `null` when no layer does.
 *
 * `node:sqlite` puts the fixed string `"ERR_SQLITE_ERROR"` on `code` whatever the failure; the
 * number that tells failures apart is on `errcode`. The message travels with it because one number
 * can cover several failures: `errcode` 1 is a missing table, a missing column and a syntax error
 * alike. The chain is walked because drizzle's `db.run` rejects with a `DrizzleError` whose own
 * message quotes the failed SQL and whose `cause` is the engine's error.
 *
 * A message can name a table or column, so do not print it where only a code was safe to print.
 */
export function sqliteFailureOf(error: unknown): { errcode: number; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const layer = current as { errcode?: unknown; message?: unknown; cause?: unknown };
    if (typeof layer.errcode === "number") {
      return {
        errcode: layer.errcode,
        message: typeof layer.message === "string" ? layer.message : "",
      };
    }
    const cause: unknown = layer.cause;
    if (cause === current) return null;
    current = cause;
  }
  return null;
}
