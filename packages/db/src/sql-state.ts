/**
 * The refusal classes this repository's write paths translate, as the engine reports them.
 *
 * These were PostgreSQL SQLSTATEs — five-character strings. SQLite reports a numeric **extended
 * result code** instead, and `node:sqlite` puts it on the error's `errcode`, with `code` fixed at
 * `"ERR_SQLITE_ERROR"` for every failure alike. Each is `SQLITE_CONSTRAINT` (19) plus the specific
 * reason shifted into the high byte, which is why the numbers look arbitrary: 275 is `19 + 1·256`,
 * 787 is `19 + 3·256`, and so on.
 *
 * One home for the ones a WRITE PATH translates, because the alternative is what the tree carried:
 * the same literals re-declared in each file that reads a refusal, with no way to tell a typo from
 * a deliberate difference. Not every code in the tree belongs here —
 * `apps/server/src/dev-migration-hint.ts` keeps its own wider list, which exists to explain a
 * failed migration to a developer rather than to translate a refusal.
 *
 * **Each is a LIST, and that is not decoration.** PostgreSQL folded a primary-key collision into
 * `23505` along with every other unique index; SQLite splits them — 2067 for a unique index, 1555
 * for a primary key — and a caller asking "was this key already taken?" must get the same answer
 * for both. Measured 2026-09-21 on Node v26.7.0 against `node:sqlite`, with a real refusal per
 * row; the receipts are in `constraint-target.sqlite.test.ts`, which drives them all again.
 *
 * A code is a value SQLite defines, so these are quotations rather than choices — never rename one.
 */

/** A unique index (2067) or a primary key (1555). */
export const UNIQUE_VIOLATION = [2067, 1555] as const;

/** A written value naming no parent row (787). */
export const FOREIGN_KEY_VIOLATION = [787] as const;

/**
 * A delete or update refused by an `ON DELETE RESTRICT` foreign key (1811 — SQLite implements
 * RESTRICT with an internal trigger, so it arrives under the TRIGGER reason rather than the
 * FOREIGN KEY one). NOT {@link FOREIGN_KEY_VIOLATION}, which is the other direction.
 */
export const RESTRICT_VIOLATION = [1811] as const;

/**
 * A trigger's own `RAISE(ABORT, 'text')` (1811) — how this schema's hand-written guards refuse a
 * write, and a refusal whose wording a MIGRATION chooses rather than the engine.
 *
 * **The same number as {@link RESTRICT_VIOLATION}, and that is the thing a reader must not have to
 * discover alone.** Both are `SQLITE_CONSTRAINT_TRIGGER`, because SQLite implements `ON DELETE
 * RESTRICT` with an internal trigger, so the result code cannot tell a deliberate raise from a
 * restricted delete. Only the MESSAGE separates them: a raise arrives with its own text verbatim, a
 * RESTRICT refusal with `FOREIGN KEY constraint failed`. Measured 2026-09-22 against `node:sqlite`
 * on Node v26.7.0 — one real refusal of each, both re-driven in `constraint-target.sqlite.test.ts`,
 * where the RESTRICT case is the control. That is why the predicate reading this class
 * (`./constraint-target.ts`'s `triggerRaised`) asks for the text as well.
 */
export const TRIGGER_ABORT: RefusalClass = [1811] as const;

/** A CHECK constraint (275). */
export const CHECK_VIOLATION = [275] as const;

/** A NOT NULL column written null (1299). PostgreSQL's `23502`, which nothing here translated. */
export const NOT_NULL_VIOLATION = [1299] as const;

/** One refusal class: the extended result codes that all mean the same thing to a write path. */
export type RefusalClass = readonly number[];
