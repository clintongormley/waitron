import type { Transaction } from "../client.js";

/**
 * Does nothing, deliberately.
 *
 * It used to run `set local role app_user`, so that a grant assertion ran as the non-owner
 * application role rather than as the connection owner — without it such a test asserted nothing,
 * however much it asserted. SQLite has no roles and no grants: one process opens one file, and
 * what a caller may do is decided outside the database. There is nothing left to switch to, and
 * `set local role` is not a statement this engine has (`near "set": syntax error`).
 *
 * It is kept as an empty function rather than deleted so that the storage switch does not also
 * have to edit its call sites, of which there are over a thousand. Task T1 of
 * `docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md` removes them, package by
 * package, and deletes this function last.
 *
 * The parameter stays so every call site still compiles, and it takes BOTH treatments because
 * the two checkers disagree about it. TypeScript's `noUnusedParameters` is silent only on a
 * name beginning with an underscore; this ESLint configuration sets no `argsIgnorePattern`, so
 * it refuses `_tx` in the same words it refuses `tx` and needs the one-line disable instead.
 * Either alone leaves a real error: with `tx` and the disable, `tsc --noEmit` reports
 * `roles.ts(23,33): error TS6133` in every package that reaches this file (measured 2026-09-22).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function asAppUser(_tx: Transaction): Promise<void> {}
