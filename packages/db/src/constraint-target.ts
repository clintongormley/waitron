/** The table and columns a database refusal named. */
export interface ConstraintTarget {
  /** The relation the refused statement was writing. */
  readonly table: string;
  /**
   * The key the refusal named, in the order the index or constraint declares it. An index over an
   * expression reports the expression rather than a column — `lower(email)` for
   * `persons_tenant_email_uq` — and a quoted identifier keeps its quotes.
   */
  readonly columns: readonly string[];
}

/**
 * How deep to follow `cause` before giving up. Drizzle wraps every failed query in a
 * `DrizzleQueryError`, so the driver's own error is not at the top — measured at depth 1 for a
 * `db.execute` on both drivers. This is a BOUND, not a claim about how deep the error sits on every
 * path; it exists so a self-referential or absurdly nested `cause` cannot spin. It is the same bound
 * `isPgError` uses (`./unique-violation.ts`).
 */
const MAX_CAUSE_DEPTH = 5;

/** `Key (a, b)=(1, 2) already exists.` → `a, b`. Non-greedy, so `Key (lower(email))=(a@x) …` stops
 * at the `)` that precedes `=(` and keeps the expression's own parentheses. */
const KEY_COLUMNS = /^Key \((.*?)\)=\(/;

/**
 * Which table and columns did this refusal name?
 *
 * Write paths used to ask which CONSTRAINT was violated, by name, so each translated only its own
 * refusal and re-threw the rest. SQLite does not report a constraint name — it reports the table and
 * column and nothing else, even when the constraint was explicitly named (design
 * `docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` §6.4) — so the question
 * has to change before the engine does. Both of today's drivers can answer it.
 *
 * Returns `undefined` when nothing in the cause chain names a key: a refusal that names no key at
 * all (a CHECK violation reports `Failing row contains (…)`), an error from some other class
 * entirely, or a value that is not an error. `undefined` therefore means "this refusal named no
 * key", never "no violation" — pair it with `isPgError` (`./unique-violation.ts`) when the SQLSTATE matters.
 *
 * What the two halves mean depends on the class, and each was measured on 2026-09-21 against PGlite
 * and a real PostgreSQL, through `describeEachTarget`, in `constraint-target.test.ts`:
 *  - unique and primary key — the table written, and the key that collided;
 *  - foreign key (`23503`) — the REFERENCING table, and its referencing column;
 *  - restrict (`23001`) — the REFERENCING table, and the REFERENCED table's key columns. The two
 *    halves come from opposite ends of the foreign key, which is PostgreSQL's reporting, not a
 *    choice made here.
 */
export function constraintTarget(error: unknown): ConstraintTarget | undefined {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === "object") {
      const layer = current as { table?: unknown; detail?: unknown };
      if (typeof layer.table === "string" && typeof layer.detail === "string") {
        const columns = KEY_COLUMNS.exec(layer.detail)?.[1];
        if (columns !== undefined) {
          return { table: layer.table, columns: columns.split(", ") };
        }
      }
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return undefined;
    current = next;
  }
  return undefined;
}

/**
 * Is `target` the table and columns of `expected` — same table, same columns, same order?
 *
 * The replacement for comparing a constraint NAME with `===`. Order is part of the identity, because
 * an index on `(location_id, name)` is a different index from one on `(name, location_id)`. An absent
 * `target` is never a match; a caller that wants to translate an unidentified refusal anyway tests
 * for `undefined` itself, so that the choice is visible where it is made.
 */
export function sameTarget(
  target: ConstraintTarget | undefined,
  expected: ConstraintTarget,
): boolean {
  return (
    target !== undefined &&
    target.table === expected.table &&
    target.columns.length === expected.columns.length &&
    target.columns.every((column, index) => column === expected.columns[index])
  );
}
