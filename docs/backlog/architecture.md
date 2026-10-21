# Modules, data and code health — detail

The open entries are listed in [the backlog](../backlog.md), under "Modules, data and code health". This file holds
their full text.

## A646 — a Modules page where the administrator switches optional modules on and sets them up

- **A646 — owner, 2026-10-14; OPEN; DESIGN REVISED after the ~22:40 owner answer, awaiting agreement (2026-10-16).**
  [Proposed design](../superpowers/specs/2026-10-16-a646-modules-page-design.md), not an approved
  decision or an implementation plan. [Static mockups](mockups/a646-modules-page/README.md) illustrate the proposal. Build waits for owner design agreement and A739/A764 to land. The
  first independent build PR must repair retained disabled-module append-only protection before
  any UI state controls; [that defect remains OPEN](#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked).
  The revision proposes one complete optional catalogue, initially Enabled; Add a module filters
  that same list to Disabled. Category is independent, and Card payments links to Card providers
  with All states. Row kebabs offer Configure plus Enable/Disable, with persistent red reasons
  when Disable is forbidden. Configure opens a modal and saves settings only; state changes need
  separate confirmation and server checks. Google remains proposed; Stripe/SumUp remain Payments
  contributions. Runtime, credentials, payment history, migration-slot/H2 and first-repair limits
  remain. The one unresolved owner question is Google lockout scope: only the applying admin or
  every active admin (recommended proposal, not approval). Both need the actor's fresh non-Google
  proof; the wider option adds supported recorded enrollment for others, not everyone's fresh proof.

  **Original request and reading receipts, retained from 2026-10-14:** The owner asked for a system
  section where an administrator installs and configures
  optional modules, starting from the Profile → Security tab's Google login row, which today only
  says "Google login becomes available when it is configured for this installation."

  **What exists today**, read 2026-10-14, not tried on a box:
  - Google login is part of the identity package, not a module. Its OAuth client ID and secret come
    only from `WAITRON_GOOGLE_CLIENT_ID` and `WAITRON_GOOGLE_CLIENT_SECRET`
    (`apps/server/src/config.ts`); no screen sets them. This entry replaces the open point "an
    operator screen for Google provider credentials" in the #298/#305/#317 list under Users,
    sign-in and the dashboard shell.
  - Which modules are on is a `modules.json` file on the box (`apps/server/src/module-config.ts`):
    every module is on unless the file says `false`, a `mandatory` module cannot be switched off,
    and nothing in the dashboard edits the file. Every module ships in every image, so "install"
    means switching on and setting up. Tiers are in `packages/composition/src/modules.ts`.
  - SumUp and Stripe are separate packages but not modules: they plug into the payments module as
    card providers (`packages/composition/src/card-providers.ts`, and
    `packages/dashboard-modules/src/card-providers.ts` for their dashboard panels), so they have no
    switch of their own today.

  **What the owner asked for:**
  1. A Modules page listing the optional modules, where the administrator switches each on or off
     and fills in its settings. The owner called it a "system section"; the dashboard has no System
     group today (its groups end with Settings), so where it sits is part of the design.
  2. Google login becomes an optional module, its client ID and secret set on that page. The
     Profile → Security row shows only when the module is on, and its "becomes available" sentence
     goes.
  3. SumUp and Stripe are set up from that page too. Card payments links to the list, filtered to
     card providers.

  **Original design questions (the linked proposal awaits agreement):**
  - **How a switch takes effect.** Boot picks the modules it migrates and protects from the module
    configuration (`apps/server/src/boot.ts`), so today a change takes effect only on the next
    start. Either the page asks for a restart, or switching applies a module's migrations and
    protections while the box runs.
  - **Switching off must stay safe.** A module switched off after its tables exist keeps them, and
    no start re-protects or checks their append-only triggers —
    [the open entry below](#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked).
    A switch anyone with the permission can flip from a screen makes that easier to reach, so fix
    it first or in the same work.
  - **Whether a card provider becomes a module of its own**, or stays a provider inside payments
    that the page lists beside the modules.
  - **Where the Google secret is kept.** A primary streams the whole database to the owner's bucket
    once one is set up, so a secret stored in the database must be sealed the way the existing
    provider credentials are (the `credentials` module).
  - **Who may use the page** — which permission, and whether it is the same one that gates Card
    payments today.

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

## Remaining table restrictions after the grants-record audit

Each unresolved table has its own entry in [the backlog](../backlog.md). The
[2026-10-19 audit](../developers/grants-retirement-audit.md) accounts for every restricted name
before the record was removed. Decide retention and the permitted mutations per table before
adding enforcement. These entries do not authorise fiscal or working-time chain changes.

The write-path detector still reads only builder calls whose receiver looks like a database
handle. A differently named handle can escape it; expanding that detector needs both a real-write
control and the ordinary `Set.delete` control. The allowance list remains JSON, with the reasons
beside its reader in `scripts/write-path-tables.test.ts`.

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
  now. The same family: the remaining "not a 500" titles across the `apps/server` route suites,
  which name no engine and were left unprobed by C127 (#1036, #1042), after which no comment or
  test title names a PostgreSQL SQLSTATE as today's behaviour.

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
  that reaches it by another route is still turned into an amount without refusal. Comments
  saying drizzle wraps a failed query remain elsewhere — `git grep -l -i -E "drizzle wraps|wraps
every failed" -- ':!docs'` listed files in `apps/server`, `db`, `identity`, `media`,
  `migrations`, `printing` and `store` on 2026-09-24, not each checked (see the
  `DrizzleQueryError` entry [in this file](#comments-still-describe-a-drizzlequeryerror-wrapper-that-this-engine-does-not-produce)).

## Comments and test titles still cite sections of specs that were deleted

**Comments and test titles still cite sections of specs that were deleted — OPEN (2026-09-26).**
The docs prune that day deleted every spec and plan for built work (#711 and the direct docs commits
before it). A pointer that names only a SECTION ("spec §3.2", "design §3", "(till-reroute §3.6)")
was fixed only for the last 28 documents. Find the rest with
`git grep -nE "(spec|design|plan)[^)]{0,40}§[0-9]" -- apps packages scripts bench`. Some hits point
into specs that were kept (menus, service and billing, sales classification, the SQLite topology),
so check which document each one names before cutting it. Two were left on purpose:
`packages/db/drizzle/0004_variant_one_level.sql` ("spec §1.2, §15.7"), because a shipped migration
is not edited without a venue reset (`CLAUDE.md` §3), and
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` ("(spec §2)"), which could not be traced to a
deleted document. **Next action:** fold into the comment-pruning sweeps: re-point
each to the pull request that built the work, or drop the tag. A test title is not a comment, so
changing one does not pass `scripts/comments-only.mjs` as a comments-only change.

## Three shapes the read connection does not cover

**Three shapes the read connection does not cover — OPEN (stated 2026-09-23, task N3, PR #493).** A
transaction opened by RUNNING `begin` as an ordinary statement is not one the store is told about —
Drizzle's own migrator opens one that way — so a read concurrent with it still lands on the writer.
A write issued from outside a running body while one is open is re-run on the writer, where it joins
that transaction if it is still open and commits or rolls back with it, which is what one connection
did; in the moment after the queue's `commit` and before the body has ended, none is open and the
write commits by itself. Nothing refuses it. And `readOnly: true` refuses a write to the database
FILE, not every write: measured 2026-09-23 on Node v26.7.0, `create temp table` SUCCEEDS on such a
connection, so a temporary table written from outside a running body would land on the reader and
stay there — and the same holds for an `ATTACH` of a file that exists (one of a missing file is
refused, errcode 14 — measured by #568) and for any connection-scoped pragma, because all three
change a CONNECTION rather than the file, so nothing refuses them and nothing routes them back. A
temporary table and an `ATTACH` have no site in this tree (searched 2026-09-23). The two
connection-scoped pragmas that run on a request path, both `pragma defer_foreign_keys = on`, are
each issued INSIDE a running transaction body, which is exactly where the routing sends a statement
to the writer: `apps/server/src/configuration-transfer.ts`'s import issues it inside the
provisioning transaction's body, and `writeAndRemoveDecoyAction`
(`packages/identity/src/account-action.ts`) inside `issueRecovery`'s `withTransaction` body
(`apps/server/src/management-api.ts`); the others are test setup issued outside any body, where the
reader would serve them if a body happened to be running, and none of those suites runs one.
**Next action:** none needed while that holds; a temporary table, an attachment or a connection
pragma issued from OUTSIDE a running body has to be put on the writer deliberately, and a guard for
that does not exist. Also left by #493's review: the case pinning the adapter half of the window fix
lives in `packages/store/src/index.test.ts`, not beside the file it reverts
(`packages/store/src/node-sqlite-adapter.ts`).

## Every read route now takes the venue's exclusive write lock and issues a DELETE

**Every read route now takes the venue's exclusive write lock and issues a DELETE — OPEN (found
2026-09-23, task F1's review wave).** `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
Plain GETs are among its callers — box status, the unauthenticated content-languages route, and two
management reads. The single writer is the engine's and is not removable. The unconditional DELETE
on a read-only body is: `node:sqlite` exposes a change counter. But it interacts with a documented
behaviour — the drain deliberately collects the rows an orphaned writer left — so this is a design
decision, not a cleanup. **Next action:** decide whether a read-only body should take the lock at
all.

## Three copies of one SQL identifier validator and two cause-chain walkers

**Three copies of one SQL identifier validator and two cause-chain walkers — OPEN (found
2026-09-23, task F1's review wave).** W8 replaced the probes in
`packages/db/src/deployment.ts`, `packages/db/src/node-membership.ts`,
`packages/db/src/mirror-config.ts`, `packages/migrations/src/schema-version.ts`,
`packages/migrations/src/journal-hashes.ts` and `packages/catalogue/src/categories.ts` with
`@waitron/db`'s `tableExists`. `apps/server/src/restore-stream.ts` still has a one-table probe;
`apps/server/scripts/dev-setup.ts` checks two table names in one query. The identifier validator is in
`packages/db/src/testing/identifiers.ts`, `packages/db/src/change-feed.ts` and
`packages/store/src/append-only.ts` — the first two are in the SAME package. The cause-chain walk is
in `packages/shared/src/cause-chain.ts` and again in `packages/db/src/constraint-target.ts`, and
that one is a regression: `unique-violation.ts` used to import the shared walker and now uses the
local copy. The shared walker's only product caller is
`packages/fiscal-verifactu/src/certificate-check.ts`. **Next action:** export
one validator from `@waitron/shared`; `packages/store` depends only on `@waitron/shared`,
which depends on nothing, so that edge closes no loop.

## Files that still spell the store's file names themselves

**Files that still spell the store's file names themselves (left by #757, which exported them
from `@waitron/store`).** Outside test files and `bench/`: `apps/server/src/cloud-snapshot-archive.ts`
(a staging file outside the venue folder), `packages/stream/src/litestream.ts` and
`packages/stream/src/restore.ts` (`@waitron/stream` does not depend on the store),
`deploy/waitron.sh` (a `node -e` snippet run in the app image, whose `/app/node_modules` holds only
sharp), the fixture scripts `apps/server/scripts/cloud-backup-fixture.ts` and
`apps/server/scripts/cloud-recovery-client-fixture.ts`, and the store's own
`packages/store/src/connections.ts`, which builds the `-wal` path itself; `WAL_SUFFIX` lives in
`index.ts`, which imports `connections.ts`, so using it there means moving the names into a module
of their own. #757's checks do not cover `migrations.lock`, Litestream's `.venue.db-litestream/`
folder, or the restore's `venue.db.incoming` file and `.venue.db-replaced-*` folder.

## A switched-off module's append-only tables are neither re-protected nor checked

**Left open by A483.** Boot hands `applyMigrations` the sets of the modules this start migrates
(`setsToMigrate` in `apps/server/src/boot.ts`: every module in setup mode, the enabled ones when
trading), and the append-only check and the 10-second watch read the same list
(`appendOnlyTables`). A module switched off after its tables exist keeps those tables, but no start
re-installs or checks their triggers. From `packages/composition/src/modules.ts` and each module's
classification, read 2026-10-11 and not measured on a box: `time_entries` (workforce, `toggleable`,
the legal working-time record), `payment_resolutions` (payments, `toggleable`), and
`registros_facturacion`, `filing_cases` and `filing_case_events` (fiscal-verifactu,
`provision-only`) on a box later moved to `fiscal-none`. The alternative is to check every known
module's tables that exist; its cost is a box that refuses to start after a release marks an
existing table of a switched-off module `appendOnly()`, because no migration of that module would
run to install the new trigger. Owner question Q5 of A483.

## `apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree

**Left behind by the TypeScript 7 upgrade (#460, 2026-09-20).**

- **`apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree.** #460
  declared `@waitron/print-agent-app` as a test-only dependency of `apps/server` (for
  `apps/server/src/print-agent-e2e.test.ts`) and exported `./tcp-probe.js`. Moving `tcp-probe.ts`
  alone into `packages/print-agent` was consciously not taken: it belongs to a cohort of six
  device-discovery modules in the app (`ipp-probe.ts`, `bluetooth.ts`, `usb.ts`,
  `linux-devices.ts`, `network.ts`, `sweep.ts`), and moving one would leave its siblings importing
  back across the boundary. Moving the WHOLE cohort would settle it, and that is a print agent
  layering decision. Until then no guard stops a second app-to-app edge:
  `scripts/workspace-cycles.test.ts` looks only for loops, and `eslint.config.js`'s
  `no-restricted-paths` zones name `packages/*` as targets, never `apps/*`.

## Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's location

**Correctness:**

1. **Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's
   location.** Scope these alongside the other by-id verbs when multi-location lands. All
   four are in `apps/server/src/working-order.ts`: `handOver`, which `POST /api/orders/:id/collect`
   reaches through `handOverOrder`, selects and updates on `eq(workingOrders.id, id)`, using its
   `TillConfig` only to read a placed order's service mode, through `findOrderServiceContext`, which
   filters by `cfg.locationId`; without a stored context, the handover check uses the unscoped
   `prepay` default;
   `cancelPlacedOrder` selects and updates the same way and uses `cfg` only to stamp the amendment's
   till and node and, for an order whose invoice was issued, to give the credit note its node and
   series (its till is the requesting device's); `readLockedLines` takes no `cfg` at all, nor does `priceStoredOrder`, which calls
   it to rebuild a filed ticket, nor `priceStoredOrderForIssuance`, which the filing sites in
   `till-sale.ts` and `working-order.ts` call.

## These index and key names still read `tenant`, and the columns they name are gone

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **These index and key names still read `tenant`, and the columns they name are gone:**
  `print_agents_tenant_node_key`,
  `purchase_invoices_tenant_received_idx`, `sales_tenant_issued_idx`,
  `working_orders_tenant_status_idx`, `registros_tenant_node_secuencia_uq`, and four in identity:
  `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq`,
  `persons_tenant_pending_email_uq` and `persons_tenant_google_subject_uq`. (The `tenants*`,
  `tenant_receipts*` and `tenant_credentials*` names are correct and stay.) This is
  its own slice, not a tidy-up: THREE of the four `persons_*` names are matched BY NAME in production
  error translation — `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
  `persons_tenant_pending_email_uq`, whose names are held in `packages/identity/src/person-constraints.ts`
  (read by `staff.ts` and `account-action.ts`) — so renaming them changes behaviour and wants its own
  failing tests first.

## `server.credential_unusable` names an unusable credential, although `server.*` is reserved for facts about the process itself

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **`server.credential_unusable` names an unusable credential, although `server.*` is reserved for
  facts about the process itself.** It is thrown for AEAT's certificate
  (`packages/fiscal-verifactu/src/aeat-transport.ts`), for Stripe's secret key and webhook secret
  (`apps/server/src/stripe-account.ts`, `apps/server/src/webhook.ts`), and for the email and
  machine-key credentials (`credentialField`, `apps/server/src/credentials.ts`); both
  `packages/fiscal-verifactu/src/errors.ts` and `apps/server/src/errors.ts` declare it. **Next
  action:** choose a prefix (`credentials.missing` is the nearest sibling) and rename it in one
  change, checking the prefix matchers `docs/developers/conventions-data.md` lists.

## `DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1

**Names left behind by the tenant-column removal (#378, 2026-09-16):**

- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1.** The field
  reaches `apps/server`'s awaiting-certificate flag (`apps/server/src/pass.ts`, which keys off
  `> 0`) and `fiscal-none`. A rename would want to keep that "did this pass attempt work?" meaning
  rather than flatten it to a boolean, since the flag deliberately distinguishes a no-work pass from
  a pass that exercised the certificate and skipped.

## Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce

**What slice 1 left (#490 and the preparation tasks):**

- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce.** On
  `node:sqlite` only `db.run` wraps (as `DrizzleError`, message `Failed to run the query '<sql>'`),
  while `db.all`, `db.get`, `db.execute` and an awaited query builder reject with the engine's own
  error (`packages/db/src/testing/errors.ts` records both shapes). Each site needs checking against
  the path it actually takes, then rewording. The candidates are what
  `git grep -n -i -E "DrizzleQueryError|drizzle wraps|Failed query" -- ':!docs'` prints, which
  also includes test fixtures that build a wrapped error by hand. `engineErrorMessage` in
  `packages/db/src/testing/errors.ts` names the old wrapper on purpose and is pinned verbatim by its
  test.

## `modules.json` has no flow-down channel from a primary to its standby

- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  _Afterwards_, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.

  Read during A10-2 planning, not run: non-mirror trading startup calls `endMirrorViewer`
  (`apps/server/src/boot.ts:1333`), which updates identity-owned `management_sessions`
  (`apps/server/src/mirror-session.ts:70–80`). Probe real startup with identity and its dependants
  disabled before changing that path; the runtime outcome remains unverified.

## A394-5, A394-6, A394-8 to A394-17 and A394-20 to A394-22 — refusal statuses by one rule

**A394-5, A394-6, A394-8 to A394-17 and A394-20 to A394-22 — refusal statuses by one rule** — OPEN,
low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to
A394-4 landed as #1441, #1444, #1447 and #1455.) Read, not run: of 49 boundaries, 96 status rows
break the rule (`docs/developers/conventions-data.md`); 17 defects answer 500 or success for a
missing id (A394-1 to -6 first); 16 owner questions; A394-8 settles A374's. The follow-ups and the
rows: `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

## Raw engine imports in `apps/server/src/recovery-lock.ts` and `apps/server/scripts/cloud-backup-fixture.ts`

**Raw engine imports in `apps/server/src/recovery-lock.ts` and
`apps/server/scripts/cloud-backup-fixture.ts`** — left open by W45 (#1155), which closed
"`packages/migrations` opened its own raw `node:sqlite` connection": a 2026-10-03 search of
non-test files under `apps/` and `packages/` also found raw engine imports in
`apps/server/src/recovery-lock.ts` and `apps/server/scripts/cloud-backup-fixture.ts`. **Next
action:** review each remaining raw connection separately before deciding whether a shared store
API fits.

## Location-scope the by-id verb family together

**Location-scope the by-id verb family together** (`getHeldOrder`/`getPlacedCounterOrder`/
`updateHeldOrder`/`abandonHeldOrder`/`openTab`) when multi-location lands — alongside `handOver`,
`cancelPlacedOrder`, `readLockedLines`, `priceStoredOrder` and `priceStoredOrderForIssuance` in
`apps/server/src/working-order.ts`.
[Order-path detail](#four-order-paths-read-working_orders-by-id-alone-with-nothing-narrowing-them-to-the-callers-location).
Floor plans slice 1 (A429) added more read and written by id alone: in
`apps/server/src/table-removal.ts`, `tablesTied` and `removeLiveTables`' label read and the deletes
after it; `releaseDeliveries` (`apps/server/src/delivery-release.ts`); `followersOf`
(`apps/server/src/floor-plan.ts`); and bookings' `release` (`packages/bookings/src/table-removal.ts`),
unscoped on purpose so a stray booking under another location cannot block a table's final delete
(`25ecf900b`) — scoping it needs that case answered first.

## A913. Find the non-English text in general code, then propose fixes

**A913. Find the non-English text in general code, then propose fixes (owner, 2026-10-19).**
General code is English only (CLAUDE.md §3; the owner's decisions are in
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only)). A docs-only
audit of `packages/*` and `apps/*` lists every Spanish, Catalan or other non-English text outside
the allowed homes, sorted into: what is allowed; the packages written for Spain (`workforce-es`,
`country-es`, `reporting`'s modelo 303); user-visible text outside a translation file; starter and
demo content; identifiers or comments; and the three exemptions the comments in
`packages/db/src/english-only.ts` argue for (`dashboard-kit`'s `{ en, es }` values, `provisioning`'s
tests, and all of `apps/*`, argued from `apps/server` being where general code is wired to
Veri\*Factu). It says what `scripts/english-only.test.ts` misses, and asks the owner which to fix and where the packages written for Spain stand. Examples
already seen: `packages/dashboard-kit/src/table-strings.ts` holds a Spanish `{ en, es }` value
outside the translation files the rule names, and `packages/venue-service/src/service-steps.ts`
seeds Spanish starter steps (A900).

**Audit done 2026-10-20 on main `a3be14ba4`: [english-only-audit.md](english-only-audit.md).** The
owner answered all eight points on 2026-10-20 (the campaign's questions file has the words): 1, 2,
4, 7 and 8 as recommended; 3, 5 and 6 in the owner's own words, recorded in
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only). The items
below carry them out, one pull request each unless an item says otherwise. File and line references
are the audit's, taken on `a3be14ba4`; re-find them on current `main`. Every item follows the rule
for its own diff (grep it for non-English text before pushing — the guard will not see most of it
until A977).

- **Point 1 → A918** (its own backlog entry): starter content in English, translated at setup from a
  translation file each module ships. The kitchen station «Cocina»
  (`packages/provisioning/src/venue-apply.ts:308`), the service steps
  (`packages/venue-service/src/service-steps.ts:110–138`, A900), the device profiles
  (`packages/layouts/src/device-profile.ts:131–152`) and A758-1's reasons. Trap: the demo seed finds
  the default station by its Spanish name (`apps/server/scripts/demo-seed/seed-catalogue.ts:46–56`);
  find it by `is_default`, as `dev-setup.ts` does.
- **A963 — points 3(4) and 4.** Move the full-invoice address rule (`apps/server/src/invoice-selection.ts:20–46`:
  ends «España», five-digit postcode) into Spain's country pack beside the tax-ID check general code
  already asks it for. The till stops appending «España»
  (`apps/till/src/widgets/invoice-recipient-dialog.ts:279`) and stores the country code; the printed
  invoice (`apps/server/src/receipt-document.ts:238`) names the country in the receipt language from
  the pack. Look for other Spain-only logic of this shape while there. It changes words printed on a
  full invoice and no filed field — under the owner's 2026-10-21 rule a truly fiscal PR (invoices)
  waits for the owner to land it; the PR says which it is.
- **A964 — point 3(3), and the first of point 2.** Create `apps/server/src/i18n/`. Kitchen tickets
  (`apps/server/src/kitchen-ticket.ts:166–464`, about 25 words) and the order-number slip move into
  it, in English with translations, and follow the venue's language rather than
  `WAITRON_TILL_LOCALE` (`apps/server/src/till-config.ts:83`; setup never writes it,
  `trading-config.ts:33–41`). Trace every reader of that setting before changing it — the card slip's
  dates and money read it too. Which venue setting picks a kitchen's language is the plan's first
  question; ask only if no existing setting fits.
- **A965 — points 3(1), 3(2), 3(5) and 5's English.** `country-es`'s receipt words
  (`packages/country-es/src/receipt-labels.ts`) gain English, shown on English screens, never printed
  on a Spanish receipt; say in the plan where each is shown. The card payment slip's words
  (`apps/server/src/payment-slip.ts:21–55`, no English, no language choice) and the refund receipt's
  heading table (`tender-refund-receipt.ts:94–99`) move into Spain's receipt words and print in the
  receipt language; the sample receipt (`sample-receipt.ts:14–39`) takes the receipt language. If it
  changes a word printed on a simplified or full invoice, the owner lands it (2026-10-21 rule).
- **A966 — point 2: emails.** `account-email.ts:38–72, 125` and `attendance-email.ts:18–22, 46, 49`
  move into `apps/server/src/i18n/`. No visible change. After A964.
- **A967 — point 2: printed pages.** The working-time PDF's frame (`attendance-export-pdf.ts:29–160`),
  the category sales report (`category-sales-page.ts:48–65`), the printer test and ruler pages
  (`printer-test-page.ts:26–29`, `test-page.ts:21–25`). No visible change. After A964.
- **A968 — point 2: the guide's frame and the recovery page.** `guide-pages.ts:73–85` and
  `recovery-surface.ts:107–425` (about 50 strings). The recovery page is served when the box cannot
  start, so its strings must load without the database. No visible change. After A964.
- **A969 — point 2's sibling in a package.** `packages/dashboard-kit/src/codes.ts:9`,
  `alert-messages.ts:21` and `table-strings.ts` hold `{ en, es }` pairs in generic code; move them
  into a strings file.
- **A970 — point 5: `workforce-es`.** The working-time export's ~68 label pairs
  (`packages/workforce-es/src/record-export.ts`) move to a translation file; the access-holder values
  `trabajador`, `representantes_legales`, `inspeccion_trabajo` (`registro-jornada.ts:26–31`) print
  untranslated in the English export (from reading, `attendance-export-pdf.ts:120, 141`) — run the
  export first, then give them labels. Spanish identifiers and the `convenio_config` table stay
  (Spanish-specific terms are allowed there).
- **A971 — point 5: Spain's pack provides English.** Check every word `country-es` shows on a screen:
  holiday names (`data/es-2026.ts`, one `name` per row, verbatim from the BOE and compared by a
  test), the area label «Lleida, fuera del territorio de Arán» (Waitron's wording), and the notices
  (`spain.ts:199–235`, already `{ en, es }`). A holiday carrying an English name beside the official
  one may need a schema change — ask before adding one.
- **A972 — point 6: demo data per country pack and region. DESIGN FIRST, then ask the owner.** The
  demo (`apps/server/src/demo-seed.ts`, `apps/server/scripts/demo-seed/`) moves into `country-es` as
  Spain's demo; region demos ("catalán demo in Catalunya") — say which regions get their own and which
  share Spain's default; setup picks the demo from the venue's country and region the way it already
  derives other geography values (A833 landed: setup and the demo start only for a country with a
  pack). English provided. The ~33 staff and kitchen names with no English (`menu.ts`) and «Menú del
  Día» in an English slot (`menu.ts:840`) are fixed there. After A918.
- **A973 — point 6: the operator script.** `apps/server/scripts/settle-invoice-first.ts:126–177`
  writes «Comida», «Descuento», «Supervisora» and accepts `WAITRON_ENV=production`; write English.
- **A974 — Bucket E and F: comments, identifiers, file names.** The audit's tables list them
  (`apps/server`, `apps/dashboard`, `apps/till`, `packages/db` schema comments, `venue-service`,
  `catalogue`, `purchasing`, `packages/ui/demo/main.ts`, setup's receipt-language names
  `apps/setup/src/receipt-languages.ts:6–9`, which disagree with the venue screen). Not
  `packages/core/src/record-substitution.ts:43–67` («factura de canje» quoted with no source): it is
  the fiscal core, so it is left to the owner. Low priority.
- **A975 — developer tools and demo scripts.** `apps/server/scripts/dev-setup.ts:213–316`, the
  `*-demo.ts` scripts, `cloud-integration-fixture.ts`, `receipt-look.ts`, the README's example values
  (`apps/server/README.md:152–156`). The demo seed itself is A972's. Low priority; A977 cannot scan
  `apps/*/scripts` until it lands.
- **A976 — point 7's first step.** The server's test venues default to English, and the tests that
  then read a screen take their text from the strings file. Accent tests, AEAT names and official
  text stay. Low priority. The rest of the test cleanup is one low-priority item per package, taken
  from A977's list.
- **A977 — point 8, after A918 and A963–A973 land.** Widen `scripts/english-only.test.ts` to every
  text file under `packages/` and `apps/`, exempting only the homes (the packages written for Spain,
  `fiscal-verifactu`, translation files), add an accented-letter check, and keep a list of test
  folders still to clean that may only get shorter. Fix the wrong comment at
  `packages/reporting/src/dr303-layout.ts:14–16` and its generator
  (`reference/generate-dr303-layout.py:184–186, 274–275`), which say the guard scans `reporting`.

## Decisions and deliberate limits

**What slice 1 left (#490 and the preparation tasks):**

- **Declined, with reasons:** writing `moneyNum` in `packages/workforce-es/src/convenio.ts` as
  `cents / 100` — it would put a second copy of the money scale outside `packages/shared/src/cents.ts`
  and the files `packages/shared/src/conventions.test.ts` checks (P5, #531); and one constant for the
  `10000` literals — four sit in check constraints, where only `sql.raw(String(n))` renders the
  number, and a constant that works only through `sql.raw` is a trap for the next tidy-up (P6,
  #529).
