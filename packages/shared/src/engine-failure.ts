import { MAX_CAUSE_DEPTH } from "./cause-chain.js";

/**
 * The engine's own failure — its extended result code and the message that goes with it — taken
 * from the first layer of the cause chain that carries one, or `null` when no layer does.
 *
 * `node:sqlite` reports every failure the same way: `code` is the fixed string
 * `"ERR_SQLITE_ERROR"`, and the discriminating value is the NUMBER on `errcode`. So a caller
 * classifying a database failure cannot use `firstCodeInCauseChain` (`cause-chain.ts`) at all — it
 * looks at `code`, which here says only that SQLite was involved. `sqlStateOf`, which read a
 * PostgreSQL SQLSTATE off the same field, stood in this file until the storage switch and was
 * deleted with the engine that produced one: `git show aabdde6a8^:packages/shared/src/sql-state.ts`.
 *
 * The MESSAGE travels with the number because the number is often not enough: `errcode` 1 is
 * `SQL logic error`, which covers a missing table, a missing column and a plain typo alike
 * (measured 2026-09-22, Node v26.7.0). A caller that needs to tell those apart has to read the text,
 * and a caller reading the text should take it from the same layer the number came from rather than
 * from the outer wrapper, whose message is drizzle's.
 *
 * It walks the chain because drizzle wraps the driver's error rather than re-exposing its fields,
 * and to the depth `MAX_CAUSE_DEPTH` sets (`cause-chain.ts`, which carries the argument for the
 * bound and for the cycle line).
 *
 * What leaves this function comes from the error: a number the chain carried and the string beside
 * it. A message can carry a table or column name, so unlike the five-character SQLSTATE this
 * replaces it is not shape-guarded — do not print one where a SQLSTATE was safe to print.
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
