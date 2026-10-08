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

## Prune the comments, one package per pull request

- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  Keep a comment only for an invariant, or a non-obvious why, that the code cannot show (CLAUDE.md
  §1). Every pruning pull request passes `scripts/comments-only.mjs <base>`; its header states what
  it refuses and misses. The fiscal packages go under the same gates as any other fiscal change: the
  golden huella test and the `inmutabilidad` suite pass unedited. Not reached by any package's pull
  request: `bench/` (about 2,300 comment lines) and the root `vitest.config.ts` and
  `eslint.config.js`; in `scripts/`, the `.sh` files and `write-path-tables.json` are outside the
  checker and were left. Landed so far: `workforce` (#555), `payments` (#558), `identity` (#559),
  `provisioning` (#561), `fiscal-verifactu` (#562), `apps/setup` (#567), `packages/store` (#568),
  `packages/payments-stripe` (#570), `packages/printing` (#572), `packages/bookings` (#574),
  `packages/credentials` (#577), `packages/shared` (#579), `packages/scheduler` (#581),
  `packages/db/src/schema` (#585), the rest of `packages/db` (#589), `packages/fiscal` (#592),
  `packages/payments-sumup` with `packages/migrations` (#597), `packages/core` (#598), the small
  packages as one pull request (#600: `apps/print-agent`, `print-agent`, `server-kit`, `tunnel`,
  `membership`, `sync-enrolment`, `workforce-es`, `purchasing`, `recipes`, `fiscal-none`,
  `composition`, `diagnostics`, `dashboard-modules`, the `country*` packages, `ui-core` and
  `dashboard-kit`), `packages/reporting` (#601; the generated `src/dr303-layout.ts` untouched),
  `scripts/` (#602), `packages/catalogue` (#603), `packages/ui` (#604), `packages/module` (#606),
  `packages/media` (#609), `packages/venue-service` (#611), `apps/dashboard` (#607, #610, #612),
  `apps/till` (#614, #616, #618, #621) and `apps/server` in parts (#613, #615, #617, #620, #622,
  #623, #624, #625, #629, #653, #656, #657, #658). A pruning pull request cannot carry this file (the
  checker refuses it), so each one's line lands here as a docs-only push after the merge.

## `apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same condition by construction"

- Found by the retroactive Codex reviews of #621–#626 and #629 (C3.18.12r, 2026-09-25), outside
  the files their fixes could change or not changeable in a comments-only PR:
  `apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
  condition by construction", the claim #637 removed from `health.ts` (a duty can go stale between
  passes: Codex got a 503 with no log line), and #637's review read its list of 503 causes (near
  line 404) as naming one that answers 200 — read, not run. Test titles:
  `apps/server/src/spa-api.test.ts`'s two cache cases say hashed versus non-hashed where the rule
  is the `/assets/` prefix, and `boot.mirror.test.ts`'s opt-in case
  says "binds 0.0.0.0" while connecting only over loopback. `apps/server/src/rebuild-first-start.ts`
  (near line 121, lane A's file) says "The log carries the error's code only", the overclaim #637
  corrected in `health.ts` (`codeOf` logs `unknown` for a plain error carrying `code: "EIO"`).
  "Empties every table" in
  `packages/bookings/src/schema/bookings.test.ts` (near line 60) and
  `packages/catalogue/src/migrations.test.ts` (near line 304) is wider than the reset, which
  leaves the migration journals (`packages/db/src/testing/venue-db.ts`).

## `working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same live-course definition; `fireCourse` calls `requireCourse`

- Found by #622 (`apps/server` part g), outside its files or not fixable in a comments-only
  change. `working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same
  live-course definition; `fireCourse` calls `requireCourse`. `packages/provisioning/src/venue-apply.ts`
  names a `till.configure` gate for `createDeviceProfile`; the gate is `layout.configure`
  (`packages/layouts/src/device-profile-store.ts`). `docs/developers/conventions-data.md` names a
  `print-api.printer-wiring.test.ts` case "refuses another tenant's manager…" that #378 removed.
  `docs/developers/testing-guide.md` says the concurrent Enable/unpair payments test "locks the
  reader before deciding"; there are no row locks, the enable waits behind the unpair's write
  transaction. `apps/server/README.md` sends readers to "the `drain.complete` log line, the
  `incidents` table" for rejected fiscal records, a path only someone with a terminal can take.
  Read only, not run: `WebhookDeps.nodeId` looks unread by `settleWebhook`; `me-api.ts`'s profile
  save logs `account_email.send_failed` with the caught error's message. The lock-ordering and
  deadlock cases for transfers, merges and split bills went with PostgreSQL and nothing replaced
  them (one write transaction per venue file is what serialises those writers now). Test titles
  #622 could not touch: "regardless of database date display settings" in `print-api.test.ts`,
  "(the R-D dedupe)" in `kitchen-print.test.ts`, "(SP-B4 rehome)" in `receipt-print.test.ts`,
  "(SP-A.2 §16.4)" and "SP-C:" in `sale-till-source.receipt.test.ts`, "old per-taxpayer path"
  and "path tenant" in `webhook.test.ts`, "(FIX 2 cascade / FIX 4 split)" in
  `transfer-lines.test.ts`, "(the TS-4 shape)" in `move-merge.test.ts`, "TS-4's move guards" and
  "TS-2 status" in `split-bill.test.ts`.

## `apps/server` test titles still say an unscreened malformed id becomes an opaque 500, although ids are text columns now

- Found by #600 (the small packages), not fixable in a comments-only change. `apps/server` test
  titles still say an unscreened malformed id becomes an opaque 500, although ids are text columns
  now. Also found by reading only, not run: nothing the review could find copies
  `node_membership` from the primary to a standby, so a promoting standby may take
  `nextStandings`' fallback that appends it with an empty `contactUrl` (`packages/membership`),
  which `routableServers` then drops.

## Pointers outside `docs/` that #597 made stale

- Found by #597 (`packages/payments-sumup`, `packages/migrations`), not fixable in a
  comments-only change. Pointers outside `docs/` that #597 made stale: `apps/server/README.md:82`
  says `packages/migrations/src/apply.ts` carries the lock races, which now live only in #489;
  `packages/db/src/immutability.sql.md:18` cites `apply.ts:105` for the trigger install, which is
  now the `installAppendOnlyTriggers` call at line 74; and `.github/workflows/ci.yml:401` says
  esbuild collapses "all five" migration descriptors, while
  `grep -rhoE "export const [A-Z_]+_MIGRATIONS\b" packages --include='*.ts' | sort -u` lists 15
  names on `ca01a7fbd`. `sumupClientForTenant` (`packages/payments-sumup/src/card-provider.ts:50`)
  still carries "tenant" in its name. The fake SumUp client leaves its one-shot switches for a
  lookup or a refund armed when a checkout before them is refused; no test combines the two.

## "Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)" … is too wide

- "Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)", which #567
  deleted from `apps/setup/src/server-fields.ts`, is too wide: with
  `import "@waitron/fiscal-verifactu";` added there, that guard still passed, since its regime
  checks read `packages/provisioning` and `apps/server/src` only. The same claim stands in
  `packages/fiscal-verifactu/src/venue-fields.ts`. Prune with those.

## Nothing now checks at run time that a read returns something other than a Node `Buffer`

- `packages/credentials`, found by #577 and not changed. Nothing now checks at run time that a
  read returns something other than a Node `Buffer` (the runtime case went with the PostgreSQL
  suite; a 2026-09-22 measurement read `Uint8Array`, `Buffer.isBuffer` false). Nothing checks
  that a caller other than the application cannot read or list the vault; only the encryption
  protects it. Test titles ending "— C1" and "(M7)" are old review labels, and
  `credentials.test.ts`'s fixtures `sk_test_rls`/`whsec_rls` carry a PostgreSQL-era name. The
  `beforeEach` deletes in the store, cli and rotate suites may be redundant beside `useVenueDb`'s
  per-test reset (not tried).

## The nested `tx.transaction(...)` in `enqueueSuccessor` wraps one insert

- Found by #581 (`packages/scheduler`). The nested `tx.transaction(...)` in `enqueueSuccessor`
  wraps one insert, which SQLite backs out by itself when refused, so it changes nothing today;
  `insertClose` in `packages/reporting/src/record-daily-close.ts` is the same case
  (`docs/developers/conventions-data.md` has the probe). Whether to remove these two nested calls,
  or say why they stay, is open (a code change, not made). #587's review also found older comments
  still describing PostgreSQL's behaviour, left alone there:
  `packages/store/src/node-sqlite-adapter.test.ts:90` calls keeping the outer transaction usable
  "the whole point of the savepoint"; a test name in
  `packages/fiscal-verifactu/src/chain.test.ts:225` says a collision would "poison the whole
  transaction" (a test title, which a comments-only change cannot touch).
  The reason "v8 reports phantom uncovered branches" given for excluding
  barrel `index.ts` files from coverage did not hold in scheduler: with the exclusion removed,
  both barrels reported 0 branches at 100% and the totals did not move. So scheduler's two barrel
  excludes in `vitest.config.ts` can go (a config change, not made), and the same reason is still
  given in the configs of workforce, credentials, bookings, workforce-es, server-kit,
  dashboard-kit and fiscal-none (not re-measured there); `payments-sumup` keeps its
  `src/dashboard/index.ts` exclude with the reason deleted by #597, also not measured. `claimGap`
  uses an untargeted `.onConflictDoNothing()` on a table with two unique constraints (the `id`
  primary key and `scheduled_runs_key`); CLAUDE.md §3 asks for a named target there, though `id`
  is freshly generated (read, not run).

## `decimalToCents` refuses an amount over the bound (#583), but `centsToDecimal` itself has no digit bound

- Found by #579 (`packages/shared`). `decimalToCents` refuses an amount over the bound
  (#583), but `centsToDecimal` itself has no digit bound, so a count past 99999999999999 cents
  that reaches it by another route is still turned into an amount without refusal.
  `docs/developers/conventions-data.md` (the "no column width left to measure" paragraph) has only
  the PostgreSQL raw-read table, not the SQLite one #579's commit message now carries. Comments
  saying drizzle wraps a failed query remain elsewhere — `git grep -l -i -E "drizzle wraps|wraps
every failed" -- ':!docs'` listed files in `apps/server`, `db`, `identity`, `media`,
  `migrations`, `printing` and `store` on 2026-09-24, not each checked (see the
  `DrizzleQueryError` entry under _Afterwards_).
