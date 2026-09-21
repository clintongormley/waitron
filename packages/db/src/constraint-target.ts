import { MAX_CAUSE_DEPTH } from "@waitron/shared";

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
 * Every object in an error's `cause` chain, outermost first.
 *
 * The walk exists because the fields below are not on the error a caller catches: Drizzle wraps the
 * driver's error rather than re-exposing them. It cannot be a predicate over `@waitron/shared`'s
 * `firstCodeInCauseChain`, which hands its predicate a `code` and returns only that string, where
 * this file needs `table` and `detail` off a layer as well — and {@link refusalOn} needs all three
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

const KEY_PREFIX = "Key (";

/**
 * The key named in a refusal's `detail`: `Key (a, b)=(1, 2) already exists.` → `["a", "b"]`, or
 * `undefined` when `detail` names no key (a CHECK violation reports `Failing row contains (…)`).
 *
 * Hand-scanned rather than matched with a regular expression, because three of the four things that
 * delimit the list can also appear INSIDE an entry, and a pattern cannot tell the two apart:
 * a quoted identifier may contain a comma, a parenthesis or the `)=(` that ends the key; an
 * expression index reports its expression, so `replace(email, ','::text, ''::text)` brings nested
 * parentheses, commas and a SQL literal at once. Each of those is a case in this file's test,
 * driven through a real refusal on both drivers.
 */
function keyColumns(detail: string): string[] | undefined {
  if (!detail.startsWith(KEY_PREFIX)) return undefined;
  const columns: string[] = [];
  let current = "";
  let depth = 1; // the `(` of `Key (`
  let inDoubleQuote = false;
  let inSingleQuote = false;
  for (let i = KEY_PREFIX.length; i < detail.length; i++) {
    const char = detail[i]!;
    if (inDoubleQuote || inSingleQuote) {
      current += char;
      // A doubled quote inside a quoted run closes then immediately reopens, which lands on the
      // same state this flip reaches — so `"a""b"` and `'it''s'` need no case of their own.
      if (inDoubleQuote && char === '"') inDoubleQuote = false;
      else if (inSingleQuote && char === "'") inSingleQuote = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inDoubleQuote = char === '"';
      inSingleQuote = char === "'";
      current += char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) {
        if (!detail.startsWith("=(", i + 1)) return undefined;
        columns.push(current);
        // `Key ()=()` parses to one empty entry. PostgreSQL cannot write it, and every caller would
        // answer `false` to it anyway, but returning it would have this function claim a key was
        // named when none was.
        return columns.some((column) => column === "") ? undefined : columns;
      }
    }
    if (char === "," && depth === 1) {
      columns.push(current);
      current = "";
      if (detail[i + 1] === " ") i++; // PostgreSQL separates entries with ", "
      continue;
    }
    current += char;
  }
  return undefined;
}

/**
 * Which table and columns did this refusal name?
 *
 * Write paths used to ask which CONSTRAINT was violated, by name, so each translated only its own
 * refusal and re-threw the rest. SQLite does not report a constraint name — it reports the table and
 * column and nothing else, even when the constraint was explicitly named (design
 * `docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` §6.4) — so the question
 * has to change before the engine does. **This file is one of the bodies the storage switch
 * replaces**, the same role `./schema/columns.ts` holds for the column vocabulary: after the flip it
 * answers the same question from SQLite's message instead.
 *
 * Returns `undefined` when nothing in the cause chain names a key: a refusal that names no key at
 * all, an error from some other class entirely, or a value that is not an error. `undefined`
 * therefore means "this refusal named no key", never "no violation" — pair it with `isPgError`
 * (`./unique-violation.ts`), or use {@link refusalOn}, when the SQLSTATE matters.
 *
 * What the two halves mean depends on the class, and each was measured on 2026-09-21 against PGlite
 * and a real PostgreSQL, through `describeEachTarget`, in `constraint-target.test.ts`:
 *  - unique and primary key — the table written, and the key that collided;
 *  - foreign key (`23503`) — the REFERENCING table, and its referencing column;
 *  - restrict (`23001`) — the REFERENCING table, and the REFERENCED table's key columns. The two
 *    halves come from opposite ends of the foreign key, which is PostgreSQL's reporting, not a
 *    choice made here.
 *
 * **It reads a MESSAGE, and a message has a language.** `.constraint`, which this replaced, was a
 * structured field; `detail` is rendered in the server's `lc_messages`, and the prefix this parser
 * anchors on is the English one. No production or deployment code sets `lc_messages` — only the
 * guard below does — and on the image
 * `deploy/compose.yml` runs the setting makes no difference: asked for a Spanish locale, the server
 * accepts the request and still answers in English. That is a property of the IMAGE, not of
 * PostgreSQL, so it is guarded rather than asserted — `constraint-target.test.ts` drives a refusal
 * under `lc_messages = 'es_ES.UTF-8'` and goes red the day an image with locale data is swapped in.
 */
export function constraintTarget(error: unknown): ConstraintTarget | undefined {
  for (const layer of causeLayers(error)) {
    if (typeof layer.table === "string" && typeof layer.detail === "string") {
      const columns = keyColumns(layer.detail);
      if (columns !== undefined) return { table: layer.table, columns };
    }
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
 * Is this refusal `sqlstate` on `expected` — the one question a write path translating a specific
 * refusal asks?
 *
 * Both halves are needed and each rules out a different wrong answer: the SQLSTATE alone also accepts
 * a sibling constraint on the same table, and the target alone also accepts a refusal of another
 * class on those same columns.
 *
 * It matches them on ONE layer of the cause chain rather than searching for each separately. That is
 * what the drivers report — measured 2026-09-21, both of today's drivers put `code`, `table` and
 * `detail` on the same object — and it means a chain that happened to carry the SQLSTATE at one depth
 * and a key at another can never be read as a refusal that was never raised.
 *
 * A caller that must also translate a refusal it could NOT identify reaches for
 * {@link constraintTarget} and tests for `undefined` itself, so that the decision stays visible.
 */
export function refusalOn(error: unknown, sqlstate: string, expected: ConstraintTarget): boolean {
  for (const layer of causeLayers(error)) {
    if (layer.code !== sqlstate) continue;
    if (typeof layer.table !== "string" || typeof layer.detail !== "string") continue;
    const columns = keyColumns(layer.detail);
    if (columns !== undefined && sameTarget({ table: layer.table, columns }, expected)) return true;
  }
  return false;
}
