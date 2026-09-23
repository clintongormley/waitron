/**
 * Builds the error `node:sqlite` throws when it refuses a write, so a unit test can hand one to a
 * translator without a database. `./refusals.test.ts` provokes the real refusal for every kind and
 * holds the two equal, so the words here are the engine's.
 *
 * The readers' own suites (`../constraint-target.test.ts`, `../unique-violation.test.ts`) keep
 * literal quotations and must not call this: a mistake shared by the helper and the reader would
 * pass both.
 */

/** Which refusal to build, one kind per object. */
export type Refusal =
  | { readonly unique: { readonly table: string; readonly columns: readonly string[] } }
  | { readonly primaryKey: { readonly table: string; readonly column: string } }
  /** A unique index over an EXPRESSION, which the engine reports by the index's name. */
  | { readonly uniqueIndex: string }
  | { readonly notNull: { readonly table: string; readonly column: string } }
  /** A written value naming no parent row. */
  | { readonly foreignKey: true }
  /** A delete refused by an `ON DELETE RESTRICT` key. */
  | { readonly restrict: true }
  /** A named CHECK constraint. */
  | { readonly check: string }
  /** A trigger's `RAISE(ABORT, text)`. */
  | { readonly trigger: string };

/** The engine's refusal: a plain `Error` whose own enumerable keys are exactly these three. */
export type RefusalError = Error & {
  readonly code: "ERR_SQLITE_ERROR";
  readonly errcode: number;
  readonly errstr: string;
};

function describeRefusal(refusal: Refusal): { errcode: number; message: string } {
  if ("unique" in refusal) {
    const { table, columns } = refusal.unique;
    const key = columns.map((column) => `${table}.${column}`).join(", ");
    return { errcode: 2067, message: `UNIQUE constraint failed: ${key}` };
  }
  if ("primaryKey" in refusal) {
    const { table, column } = refusal.primaryKey;
    return { errcode: 1555, message: `UNIQUE constraint failed: ${table}.${column}` };
  }
  if ("uniqueIndex" in refusal) {
    return { errcode: 2067, message: `UNIQUE constraint failed: index '${refusal.uniqueIndex}'` };
  }
  if ("notNull" in refusal) {
    const { table, column } = refusal.notNull;
    return { errcode: 1299, message: `NOT NULL constraint failed: ${table}.${column}` };
  }
  if ("foreignKey" in refusal) return { errcode: 787, message: "FOREIGN KEY constraint failed" };
  if ("restrict" in refusal) return { errcode: 1811, message: "FOREIGN KEY constraint failed" };
  if ("check" in refusal) {
    return { errcode: 275, message: `CHECK constraint failed: ${refusal.check}` };
  }
  return { errcode: 1811, message: refusal.trigger };
}

/** The error the engine throws for `refusal`. */
export function refusalError(refusal: Refusal): RefusalError {
  const { errcode, message } = describeRefusal(refusal);
  return Object.assign(new Error(message), {
    code: "ERR_SQLITE_ERROR" as const,
    errcode,
    errstr: "constraint failed",
  });
}
