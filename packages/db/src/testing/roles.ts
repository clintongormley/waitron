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
 * The parameter stays so every call site still compiles; nothing reads it, and the lint rule
 * that would otherwise refuse an unread parameter is turned off for that one line rather than
 * for the file. No underscore prefix: this configuration has no `argsIgnorePattern`, so `_tx`
 * is refused in exactly the same words (measured).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function asAppUser(tx: Transaction): Promise<void> {}
