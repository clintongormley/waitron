# Modules, data and code health — detail

The open entries are listed in [the backlog](../backlog.md), under "Modules, data and code health". This file holds
their full text.

## Copies of the patterns A105 and C27 replaced

- **Copies of the patterns A105 and C27 replaced — OPEN.** The same two SQL patterns (the
  block-comment one A105 replaced, and `/--.*$/`, the one C27 replaced) are copied in
  `scripts/module-graph-honesty.test.ts`, a guard reading the repository's own SQL;
  `apps/till/src/i18n/t.ts` still strips the region with `/-.*$/` on the till's locale (CodeQL did
  not flag it); and `/\/+$/` (written `/\/+$/u` in `mailpit-client.ts`) is still used in
  `apps/server/src/boot.ts` (a peer relay URL from `mirror_config`, owner-written config),
  `apps/server/src/mailpit-client.ts` (the loopback Mailpit base URL) and
  `apps/server/src/mirror-bundle-fetch.ts` (a URL already parsed by `assertSafePrimaryUrl`) — none of
  the three timed; and the email pattern itself is still copied six times in `apps/dashboard`
  (`login-preference.ts` twice, `screens/login-screen.ts`, `screens/profile-screen.ts`,
  `widgets/person-edit.ts`, `widgets/person-form.ts`), run in the browser on an address the person
  typed or the browser saved (CodeQL did not flag them either). See also the OPEN bullet "The two
  SQL scanners named `stripSql`…": a fix to one touches the other's code.

## The two SQL scanners named `stripSql` blank block comments before `--` comments

- **The two SQL scanners named `stripSql` blank block comments before `--` comments — OPEN (split
  from A95).** `scripts/module-graph-honesty.test.ts` and
  `packages/sync-enrolment/src/migration-tables.ts` (product code, not a guard) blank `/*…*/` before
  `--` comments and `'…'` strings, the same ordering the six TypeScript guards had. Read, not run;
  whether any file they scan has a `/*` inside a `--` comment or a string is not measured. The
  TypeScript reader in `packages/shared/src/source-comments.ts` knows nothing of `--` comments, so
  it is not a drop-in fix. See also the OPEN bullet "Copies of the patterns A105 and C27
  replaced…", which holds the copy of `/--.*$/` in `scripts/module-graph-honesty.test.ts`: a fix to
  one touches the other's code.

## What the grants refuse ONE OPERATION AT A TIME is not guarded

- **What the grants refuse ONE OPERATION AT A TIME is not guarded (2026-09-19).**
  `scripts/write-path-tables.test.ts` (#430) covers the tables request code may read and never
  write — those `scripts/write-path-tables.json` lists, `tenants`, `nodes`, `deployment`,
  `mirror_config` and `node_roles` — and nothing else. The slice-1 design asks for more: everything
  else should become a guard that reads the source, not a convention with nothing checking it. Many
  tables refuse an insert, an update or a delete only through the grant, with no trigger backing it,
  and TRUNCATE is wider still — no table grants it and only ten carry a trigger blocking it. The
  per-table matrix is read from `packages/fiscal-verifactu/src/privileges.expected.ts`, which goes
  when the grants do.

  **What #430's review left behind, none of it taken there.** The allowance list is a JSON file
  rather than the annotated TypeScript constant every sibling guard uses, because the plan named a
  file that outlives the grants; the justification for each entry is a doc comment beside the
  `JSON.parse` instead, which no test reads. The detector only reads a builder call whose receiver
  looks like a database handle, so a write through a handle named something else is invisible; that
  was the price of not reporting `cache.delete(nodes)` on an ordinary `Set`.

  **Next action:** decide before the flip between three shapes. Grow the guard an operation column,
  which means encoding a privilege matrix as regexes. Give the tables that lack one a `reject_mutation`
  trigger, as the core baseline already does for eight tables in a single migration. Or brand the owner handle as its own type
  so `tsc` refuses the write instead of a text scan reporting it. Today the distinction is carried by
  a NAME and nothing else: `apps/server` declares `ownerDb: Database` at half a dozen call sites and
  hands it to write helpers in `packages/db` that take a plain `Database`, which is the same gap
  `CLAUDE.md` §3 names for the neighbouring `Database`/`Transaction` case. The third also closes
  the two weaknesses the new guard states about itself: it reads text, and it judges a file rather
  than a call chain.

## Small renames and dead exports the sweep found and could not make

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23; narrowed by A92 and #1039).**
  Still open: `apps/server/src/working-order-reads.sqlite.test.ts` keeps its `.sqlite.` infix
  because the approved slice 3d plan (`docs/superpowers/plans/2026-10-01-watchers-slice-3d.md`)
  ran it by that name. PF8 landed as #1088; rename the file and its references in the next T2
  sweep. The `pg` handle
  stays in `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts`,
  the fiscal gates no runner edits.
  `generatePassword` has a caller in `apps/server/src/break-glass.ts` and remains exported.
  The `provisioning.invalid_identifier` error registry entry remains; the A92 tree search
  (`rg -n provisioning.invalid_identifier packages apps`) found no product throw site. Retire it
  with the broader dead-code sweep, checking stored-code consumers first.
