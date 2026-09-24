import { MAX_CAUSE_DEPTH } from "@waitron/shared";
import { CHECK_VIOLATION, TRIGGER_ABORT, UNIQUE_VIOLATION } from "./sql-state.js";
import type { RefusalClass } from "./sql-state.js";

/** The table and columns a database refusal named. */
export interface ConstraintTarget {
  /** The relation the refused statement was writing. */
  readonly table: string;
  /** The key the refusal named, in the order the index or constraint declares it. */
  readonly columns: readonly string[];
}

/**
 * Every object in an error's `cause` chain, outermost first.
 *
 * The walk exists because WHERE the engine's fields sit depends on how the statement was run. A
 * refusal from `db.run` arrives as drizzle's `DrizzleError`, which carries none of them and holds
 * the engine's error on `.cause`; one from `db.all`, `db.get`, `db.execute` or an awaited drizzle
 * query builder is the engine's own error, carrying them itself.
 *
 * It cannot be a predicate over `@waitron/shared`'s `firstCodeInCauseChain`, which returns only a
 * `code`, where this file needs the engine's `message` off a layer as well — and {@link refusalOn}
 * needs both off the SAME layer.
 */
function* causeLayers(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === "object") yield current as Record<string, unknown>;
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return;
    current = next;
  }
}

/**
 * The refusal classes whose message names a key, and the words that introduce it.
 *
 * SQLite writes `<CLASS> constraint failed: <tail>`, and only these two put `table.column` in the
 * tail. A foreign key's message is `FOREIGN KEY constraint failed` and stops there; a CHECK's tail
 * is the constraint's NAME when it has one and its expression when it does not — neither is a key.
 * Each case is driven in `constraint-target.sqlite.test.ts`.
 */
const KEY_PREFIXES = ["UNIQUE constraint failed: ", "NOT NULL constraint failed: "] as const;

/**
 * The key named in a refusal's message: `UNIQUE constraint failed: child.code, child.tag` →
 * `{ table: "child", columns: ["code", "tag"] }`, or `undefined` when the message names no key.
 *
 * An index over an EXPRESSION carries the right prefix but no `table.column` entry: SQLite reports
 * `UNIQUE constraint failed: index 'expr_lower_uq'`. {@link indexViolated} is that index's
 * question.
 *
 * **Blind to a name containing a comma or a dot.** The separator is `, ` and the table/column split
 * is a `.`, and SQLite quotes neither, so a table created as `"odd,name"` reports
 * `UNIQUE constraint failed: odd,name.a`, which parses as two entries.
 */
function keyColumns(message: string): ConstraintTarget | undefined {
  const prefix = KEY_PREFIXES.find((candidate) => message.startsWith(candidate));
  if (prefix === undefined) return undefined;
  const entries = message.slice(prefix.length).split(", ");
  const columns: string[] = [];
  let table = "";
  for (const entry of entries) {
    const dot = entry.indexOf(".");
    if (dot <= 0) return undefined;
    if (table === "") table = entry.slice(0, dot);
    columns.push(entry.slice(dot + 1));
  }
  return { table, columns };
}

/**
 * The extended result code the engine refused with, or `undefined` if nothing in the chain carries
 * one. It reads `errcode`, because `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code` for every
 * failure alike.
 */
export function refusalCode(error: unknown): number | undefined {
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode === "number") return layer.errcode;
  }
  return undefined;
}

/**
 * Which table and columns did this refusal name?
 *
 * `undefined` means "this refusal named no key", never "no violation" — pair it with
 * {@link refusalCode}, or use {@link refusalOn}, when the class matters.
 *
 * **What each class gives you** (each driven in `constraint-target.sqlite.test.ts`):
 *  - unique index (2067) and primary key (1555) — the table written and the key that collided,
 *    unless the index is over an EXPRESSION, which reports the index's name instead;
 *  - not null (1299) — the table and the column;
 *  - foreign key (787) and restrict (1811) — **nothing**. The whole message is
 *    `FOREIGN KEY constraint failed`;
 *  - check (275) — the constraint's name, or its expression when it is anonymous. Neither is a
 *    key, so neither is returned.
 *
 * So `refusalOn(error, FOREIGN_KEY_VIOLATION, …)` can only ever be false: to tell one foreign key
 * from another, ask the database whether the parent row exists.
 */
export function constraintTarget(error: unknown): ConstraintTarget | undefined {
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode !== "number" || typeof layer.message !== "string") continue;
    const target = keyColumns(layer.message);
    if (target !== undefined) return target;
  }
  return undefined;
}

/**
 * Is `target` the table and columns of `expected` — same table, same columns, same order?
 *
 * Order is part of the identity, because an index on `(location_id, name)` is a different index
 * from one on `(name, location_id)`. An absent `target` is never a match; a caller that wants to
 * translate an unidentified refusal anyway tests for `undefined` itself, so that the choice is
 * visible where it is made.
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

/**
 * Is this refusal of class `refusal` and on `expected` — the one question a write path translating
 * a specific refusal asks?
 *
 * Both halves are needed: the class alone also accepts a sibling constraint on the same table, and
 * the target alone also accepts a refusal of another class on those same columns — a NOT NULL and a
 * unique index on one column name exactly the same table and column.
 *
 * It matches class and key on ONE layer of the cause chain rather than searching for each
 * separately, so a chain that happened to carry a result code at one depth and a key at another
 * can never be read as a refusal that was never raised.
 */
export function refusalOn(
  error: unknown,
  refusal: RefusalClass,
  expected: ConstraintTarget,
): boolean {
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode !== "number" || !refusal.includes(layer.errcode)) continue;
    if (typeof layer.message !== "string") continue;
    if (sameTarget(keyColumns(layer.message), expected)) return true;
  }
  return false;
}

/**
 * Did the unique index named `index` refuse this write?
 *
 * The question {@link constraintTarget} cannot answer: an index over an EXPRESSION is reported as
 * `UNIQUE constraint failed: index '<name>'` — the index's own name and no columns.
 *
 * **It answers only for an index over an expression.** A plain-column index reports its TABLE and
 * COLUMNS and no name at all, so asking this about one can only ever be false — `refusalOn` is that
 * index's question. A caller has to know which kind of index it is translating; that is a property
 * of the DECLARATION, not of the refusal.
 *
 * Matched on ONE layer of the cause chain, for the reason {@link refusalOn} states.
 */
export function indexViolated(error: unknown, index: string): boolean {
  const expected = `UNIQUE constraint failed: index '${index}'`;
  // Widened from the literal tuple, for the reason {@link checkFailed}'s own line states.
  const refusal: RefusalClass = UNIQUE_VIOLATION;
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode !== "number" || !refusal.includes(layer.errcode)) continue;
    if (layer.message === expected) return true;
  }
  return false;
}

/**
 * Did the CHECK named `constraint` refuse this write?
 *
 * The question a write path asks when the table it writes carries SEVERAL checks and it translates
 * only one of them: `isRefusal(error, CHECK_VIOLATION)` accepts every sibling check on the table
 * alike.
 *
 * **Only a NAMED check can be identified.** An anonymous one reports its EXPRESSION in the same
 * position, so this can only ever be false for it.
 *
 * Matched on ONE layer of the cause chain, for the reason {@link refusalOn} states.
 */
export function checkFailed(error: unknown, constraint: string): boolean {
  const expected = `CHECK constraint failed: ${constraint}`;
  // Widened from the literal tuple `CHECK_VIOLATION` declares, so `includes` takes any number.
  // `TRIGGER_ABORT` carries the same annotation at its declaration; this one is local because
  // `CHECK_VIOLATION[0]` is read as a literal elsewhere in the tree.
  const refusal: RefusalClass = CHECK_VIOLATION;
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode !== "number" || !refusal.includes(layer.errcode)) continue;
    if (layer.message === expected) return true;
  }
  return false;
}

/**
 * Did one of OUR triggers raise this refusal, saying exactly `raised`?
 *
 * A trigger's `RAISE(ABORT, 'text')` reports the text and nothing else, so the text is the whole
 * identity, and the migration owns it.
 *
 * Both halves are needed. The CLASS alone also accepts an `ON DELETE RESTRICT` refusal, which
 * arrives under the same result code ({@link TRIGGER_ABORT}). The MESSAGE alone also accepts any
 * error that happens to carry those words. Matched on ONE layer of the cause chain, for the reason
 * {@link refusalOn} states.
 *
 * Compared by EQUALITY rather than containment: a guard that raised a longer sentence beginning
 * with this one is a different guard.
 */
export function triggerRaised(error: unknown, raised: string): boolean {
  for (const layer of causeLayers(error)) {
    if (typeof layer.errcode !== "number" || !TRIGGER_ABORT.includes(layer.errcode)) continue;
    if (layer.message === raised) return true;
  }
  return false;
}
