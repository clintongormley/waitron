import { MAX_CAUSE_DEPTH } from "@waitron/shared";
import type { RefusalClass } from "./sql-state.js";

/** The table and columns a database refusal named. */
export interface ConstraintTarget {
  /** The relation the refused statement was writing. */
  readonly table: string;
  /**
   * The key the refusal named, in the order the index or constraint declares it.
   */
  readonly columns: readonly string[];
}

/**
 * Every object in an error's `cause` chain, outermost first.
 *
 * The walk exists because the fields below are not on the error a caller catches: Drizzle wraps the
 * driver's error rather than re-exposing them. It cannot be a predicate over `@waitron/shared`'s
 * `firstCodeInCauseChain`, which hands its predicate a `code` and returns only that string, where
 * this file needs the engine's `message` off a layer as well — and {@link refusalOn} needs both
 * off the SAME layer. It takes that module's BOUND rather than its own, which is the convention
 * `apps/server`'s `failureDetail` follows for the same reason.
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
 * Measured 2026-09-21 on Node v26.7.0, one real refusal per case, all of them re-driven in
 * `constraint-target.sqlite.test.ts`.
 */
const KEY_PREFIXES = ["UNIQUE constraint failed: ", "NOT NULL constraint failed: "] as const;

/**
 * The key named in a refusal's message: `UNIQUE constraint failed: child.code, child.tag` →
 * `{ table: "child", columns: ["code", "tag"] }`, or `undefined` when the message names no key.
 *
 * Three shapes return `undefined`, and each is a real message rather than a defensive guess:
 *  - a class that names no key at all (`FOREIGN KEY constraint failed`, `CHECK constraint failed:
 *    child_amount_ck`);
 *  - an index over an EXPRESSION, which SQLite reports as `UNIQUE constraint failed: index
 *    'expr_lower_uq'` — the index's name, and no columns;
 * The table comes from the FIRST entry and the rest are read as columns, because a unique index
 * belongs to one table and SQLite repeats that table's name on every entry.
 *
 * **Where it is blind, stated because a reader would otherwise assume otherwise.** The separator
 * is `, ` and the table/column split is a `.`, and SQLite quotes neither. A table or column whose
 * own name contains a comma or a dot is therefore unreadable here — measured: a table created as
 * `"odd,name"` reports `UNIQUE constraint failed: odd,name.a`, which parses as two entries. This
 * repository has no such identifier (every table and column is lower-case and underscored, which
 * `scripts/column-vocabulary.test.ts` and the generated migrations both hold), so the case is
 * recorded rather than handled: handling it would need quoting the engine does not supply.
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
 * one.
 *
 * `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code` for every failure alike and the discriminating
 * value on `errcode`, so this reads `errcode`. Exported for `./unique-violation.ts`, which asks
 * only which CLASS a refusal was.
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
 * Write paths used to ask which CONSTRAINT was violated, by name, so each translated only its own
 * refusal and re-threw the rest. SQLite does not report a constraint name for the classes that
 * matter — it reports the table and column instead — so task P10 changed the question before the
 * engine changed, and this body now answers it from SQLite's own words.
 *
 * Returns `undefined` when nothing in the cause chain names a key: a refusal whose class names no
 * key, an error from some other class entirely, or a value that is not an error. `undefined`
 * therefore means "this refusal named no key", never "no violation" — pair it with
 * {@link refusalCode}, or use {@link refusalOn}, when the class matters.
 *
 * **What each class gives you, measured on 2026-09-21 against `node:sqlite` on Node v26.7.0 and
 * driven again by every case in `constraint-target.sqlite.test.ts`:**
 *  - unique index (2067) and primary key (1555) — the table written and the key that collided,
 *    unless the index is over an EXPRESSION, which reports the index's name instead;
 *  - not null (1299) — the table and the column;
 *  - foreign key (787) and restrict (1811) — **nothing**. The whole message is
 *    `FOREIGN KEY constraint failed`;
 *  - check (275) — the constraint's name, or its expression when it is anonymous. Neither is a
 *    key, so neither is returned.
 *
 * **The gap that cost the most, stated here so nobody assumes otherwise.** On PostgreSQL a foreign
 * key refusal named the referencing table and column, and several write paths used that to tell
 * one foreign key from another — `apps/server/src/device.ts` maps three of them to three different
 * domain errors. SQLite reports no such thing, so `refusalOn(error, FOREIGN_KEY_VIOLATION, …)` can
 * only ever be false and those paths need a different mechanism: ask the database whether the
 * parent row exists, rather than ask the refusal which parent was missing. The callers are outside
 * this package and are not changed here; the storage swap's plan records the work.
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

/**
 * Is this refusal of class `refusal` and on `expected` — the one question a write path translating
 * a specific refusal asks?
 *
 * Both halves are needed and each rules out a different wrong answer: the class alone also accepts
 * a sibling constraint on the same table, and the target alone also accepts a refusal of another
 * class on those same columns — a NOT NULL and a unique index on one column name exactly the same
 * table and column, and only the class tells them apart.
 *
 * `refusal` is a LIST because one class can arrive under more than one result code: SQLite reports
 * a primary-key collision as 1555 and every other unique index as 2067, where PostgreSQL folded
 * both into `23505` (`./sql-state.ts`).
 *
 * It matches class and key on ONE layer of the cause chain rather than searching for each
 * separately, so a chain that happened to carry a result code at one depth and a key at another
 * can never be read as a refusal that was never raised.
 *
 * A caller that must also translate a refusal it could NOT identify reaches for
 * {@link constraintTarget} and tests for `undefined` itself, so that the decision stays visible.
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
