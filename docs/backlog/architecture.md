# Modules, data and code health — detail

The open entries are listed in [the backlog](../backlog.md), under "Modules, data and code health". This file holds
their full text.

## A646 — a Modules page where the administrator switches optional modules on and sets them up

- **A646 — OPEN; DESIGN APPROVED (owner, 2026-10-17).**
  [Design](../superpowers/specs/2026-10-16-a646-modules-page-design.md) and
  [static mockups](mockups/a646-modules-page/README.md). Build waits for A739. The
  first independent build PR must repair retained disabled-module append-only protection before
  any UI state controls; [that defect remains OPEN](#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked).
  The revision proposes one complete optional catalogue, initially Enabled; Add a module filters
  that same list to Disabled. Category is independent, and Card payments links to Card providers
  with All states. Row kebabs offer Configure plus Enable/Disable, with persistent red reasons
  when Disable is forbidden. Configure opens a modal and saves settings only; state changes need
  separate confirmation and server checks. Google remains proposed; Stripe/SumUp remain Payments
  contributions. Runtime, credentials, payment history, migration-slot/H2 and first-repair limits
  remain. Google disable protects every active administrator: the actor gives fresh non-Google
  proof, and every other active administrator needs supported recorded password/passkey enrollment.

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


## Copies of the patterns A105 and C27 replaced

**OPEN.** The same two SQL patterns (the
  block-comment one A105 replaced, and `/--.*$/`, the one C27 replaced) are copied in
  `scripts/module-graph-honesty.test.ts`, a guard reading the repository's own SQL;
  `apps/till/src/i18n/t.ts` still strips the region with `/-.*$/` on the till's locale (CodeQL did
  not flag it); and `/\/+$/` (written `/\/+$/u` in `mailpit-client.ts`) is still used in
  `apps/server/src/boot.ts` (a peer relay URL from `mirror_config`, owner-written config),
  `apps/server/src/mailpit-client.ts` (the loopback Mailpit base URL) and
  `apps/server/src/mirror-bundle-fetch.ts` (a URL already parsed by `assertSafePrimaryUrl`) — none of
  the three timed; and the email pattern itself is still copied in `apps/dashboard`
  (`login-preference.ts` twice, `screens/login-screen.ts`, `screens/profile-screen.ts`,
  `widgets/person-edit.ts`, `widgets/person-form.ts`), run in the browser on an address the person
  typed or the browser saved (CodeQL did not flag them either). See also the OPEN bullet "The two
  SQL scanners named `stripSql`…": a fix to one touches the other's code.

## The two SQL scanners named `stripSql` blank block comments before `--` comments

**OPEN (split from A95).** `scripts/module-graph-honesty.test.ts` and
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

**OPEN (T2, 2026-09-23; narrowed by A92 and #1039).**
  `apps/server/src/working-order-reads.sqlite.test.ts` keeps its `.sqlite.` infix
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

**IN PROGRESS (owner decision 2026-09-23).**
  Keep a comment only for an invariant, or a non-obvious why, that the code cannot show (CLAUDE.md
  §1). Every pruning pull request passes `scripts/comments-only.mjs <base>`; its header states what
  it refuses and misses. The fiscal packages go under the same gates as any other fiscal change: the
  golden huella test and the `inmutabilidad` suite pass unedited. Still open: `bench/`, the root
  `vitest.config.ts` and
  `eslint.config.js`; in `scripts/`, the `.sh` files and `write-path-tables.json` are outside the
  checker and were left.

## `apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same condition by construction"

- #637 removed that claim from `health.ts` (a duty can go stale between
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

- `packages/provisioning/src/venue-apply.ts`
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

- The same family: the remaining "not a 500" titles across the `apps/server` route suites,
  which name no engine and were left unprobed by C127 (#1036, #1042), after which no comment or
  test title names a PostgreSQL SQLSTATE as today's behaviour.

## Pointers outside `docs/` that #597 made stale

- `apps/server/README.md:82`
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

- `packages/credentials`: nothing now checks at run time that a
  read returns something other than a Node `Buffer` (the runtime case went with the PostgreSQL
  suite; a 2026-09-22 measurement read `Uint8Array`, `Buffer.isBuffer` false). Nothing checks
  that a caller other than the application cannot read or list the vault; only the encryption
  protects it. Test titles ending "— C1" and "(M7)" are old review labels, and
  `credentials.test.ts`'s fixtures `sk_test_rls`/`whsec_rls` carry a PostgreSQL-era name. The
  `beforeEach` deletes in the store, cli and rotate suites may be redundant beside `useVenueDb`'s
  per-test reset (not tried).

## The nested `tx.transaction(...)` in `enqueueSuccessor` wraps one insert

- The nested `tx.transaction(...)` in `enqueueSuccessor`
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

- A count past 99999999999999 cents
  that reaches `centsToDecimal` by another route is still turned into an amount without refusal. Comments
  saying drizzle wraps a failed query remain elsewhere — `git grep -l -i -E "drizzle wraps|wraps
every failed" -- ':!docs'` listed files in `apps/server`, `db`, `identity`, `media`,
  `migrations`, `printing` and `store` on 2026-09-24, not each checked (see the
  `DrizzleQueryError` entry [in this file](#comments-still-describe-a-drizzlequeryerror-wrapper-that-this-engine-does-not-produce)).

## Comments and test titles still cite sections of specs that were deleted

**OPEN (2026-09-26).**
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

## Every read route now takes the venue's exclusive write lock and issues a DELETE

**OPEN.** `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
Plain GETs are among its callers — `GET /api/box/status`, the unauthenticated content-languages route, and two
management reads. The single writer is the engine's and is not removable. The unconditional DELETE
on a read-only body is: `node:sqlite` exposes a change counter. But it interacts with a documented
behaviour — the drain deliberately collects the rows an orphaned writer left — so this is a design
decision, not a cleanup. **Next action:** decide whether a read-only body should take the lock at
all.

## Three copies of one SQL identifier validator and two cause-chain walkers

**OPEN.** W8 replaced the probes in
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

Left by #757, which exported them from `@waitron/store`. Outside test files and `bench/`: `apps/server/src/cloud-snapshot-archive.ts`
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

#460 declared `@waitron/print-agent-app` as a test-only dependency of `apps/server` (for
  `apps/server/src/print-agent-e2e.test.ts`) and exported `./tcp-probe.js`. Moving `tcp-probe.ts`
  alone into `packages/print-agent` was consciously not taken: it belongs to a cohort of six
  device-discovery modules in the app (`ipp-probe.ts`, `bluetooth.ts`, `usb.ts`,
  `linux-devices.ts`, `network.ts`, `sweep.ts`), and moving one would leave its siblings importing
  back across the boundary. Moving the WHOLE cohort would settle it, and that is a print agent
  layering decision. Until then no guard stops a second app-to-app edge:
  `scripts/workspace-cycles.test.ts` looks only for loops, and `eslint.config.js`'s
  `no-restricted-paths` zones name `packages/*` as targets, never `apps/*`.

## Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's location

Scope these alongside the other by-id verbs when multi-location lands. All
   four are in `apps/server/src/working-order.ts`: `handOver`, which `POST /api/orders/:id/collect`
   reaches through `handOverOrder`, selects and updates on `eq(workingOrders.id, id)`, using its
   `TradingContext` only to read a placed order's service mode, through `findOrderServiceContext`, which
   filters by `cfg.locationId`; without a stored context, the handover check uses the unscoped
   `prepay` default;
   `cancelPlacedOrder` selects and updates the same way and uses `cfg` only to stamp the amendment's
   till and node and, for an order whose invoice was issued, to give the credit note its node and
   series (its till is the requesting device's); `readLockedLines` takes no `cfg` at all, nor does `priceStoredOrder`, which calls
   it to rebuild a filed ticket, nor `priceStoredOrderForIssuance`, which the filing sites in
   `till-sale.ts` and `working-order.ts` call.

## These index and key names still read `tenant`, and the columns they name are gone

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

It is thrown for AEAT's certificate
  (`packages/fiscal-verifactu/src/aeat-transport.ts`), for Stripe's secret key and webhook secret
  (`apps/server/src/stripe-account.ts`, `apps/server/src/webhook.ts`), and for the email and
  machine-key credentials (`credentialField`, `apps/server/src/credentials.ts`); both
  `packages/fiscal-verifactu/src/errors.ts` and `apps/server/src/errors.ts` declare it. **Next
  action:** choose a prefix (`credentials.missing` is the nearest sibling) and rename it in one
  change, checking the prefix matchers `docs/developers/conventions-data.md` lists.

## `DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1

The field reaches `apps/server`'s awaiting-certificate flag (`apps/server/src/pass.ts`, which keys off
  `> 0`) and `fiscal-none`. A rename would want to keep that "did this pass attempt work?" meaning
  rather than flatten it to a boolean, since the flag deliberately distinguishes a no-work pass from
  a pass that exercised the certificate and skipped.

## Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce

On `node:sqlite` only `db.run` wraps (as `DrizzleError`, message `Failed to run the query '<sql>'`),
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

OPEN,
low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to
A394-4 landed as #1441, #1444, #1447 and #1455.) Read, not run: of 49 boundaries, 96 status rows
break the rule (`docs/developers/conventions-data.md`); 17 defects answer 500 or success for a
missing id (A394-1 to -6 first); 16 owner questions; A394-8 settles A374's. The follow-ups and the
rows: `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

## Raw engine imports in `apps/server/src/recovery-lock.ts` and `apps/server/scripts/cloud-backup-fixture.ts`

Left open by W45 (#1155), which closed
"`packages/migrations` opened its own raw `node:sqlite` connection": a 2026-10-03 search of
non-test files under `apps/` and `packages/` also found raw engine imports in
`apps/server/src/recovery-lock.ts` and `apps/server/scripts/cloud-backup-fixture.ts`. **Next
action:** review each remaining raw connection separately before deciding whether a shared store
API fits.

## Location-scope the by-id verb family together

Scope (`getHeldOrder`/`getPlacedCounterOrder`/
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

## A913's fix items: general code English only

**Audit done 2026-10-20 on main `a3be14ba4`: [english-only-audit.md](english-only-audit.md).** The
owner answered points 2–8 on 2026-10-20 (the campaign's questions file has the words): 2, 4, 7 and 8
as recommended; 3, 5 and 6 in the owner's own words, recorded in
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only). Point 1
was A918; its decision is under "Decisions and deliberate limits" below. The items
below carry them out, one pull request each unless an item says otherwise. File and line references
are the audit's, taken on `a3be14ba4`; re-find them on current `main`. Every item follows the rule
for its own diff (grep it for non-English text before pushing — the guard will not see most of it
until A977).

- **Full-invoice locality/province commas.** On A963's `e5693d460`,
  `recipientAddressErrors` accepts a nonblank Spanish locality/province containing a comma, but
  `checkedInvoiceRecipient` refuses the composed address with `invoice.recipient_invalid`,
  `field: address`. A street ending in a comma also takes that path; an internal street comma
  is accepted. Align structured and server checks and field recovery without dropping completeness
  checks. Driver probe: `pnpm --filter @waitron/server exec vitest run src/a963-driver-review-probe.test.ts`
  in the owned installed candidate, two passing cases including the accepted street control.
  Receipt: `~/waitron-campaign-e/receipts/a963-task8-20261028/review-findings-probe.log`.
  The base version was not run, so this receipt makes no regression classification.
- **Name special invoice-document issuing codes.** The same probe finds exactly
  `QU`, `XB`, `XG`, `XN`, `XU` returned unchanged by `countryNameFor` in English and Spanish.
  Both dialogs use that helper for the issuing list. Add sourced names for that list without
  admitting those values to the postal-country list. This is a wording follow-up; the identifiers
  retain their explicit issuing code.
- **A968 — point 2: the guide's frame and the recovery page.** `guide-pages.ts:73–85` and
  `recovery-surface.ts:107–425` (about 50 strings). The recovery page is served when the box cannot
  start, so its strings must load without the database. No visible change.
- **A971 — point 5: Spain's pack provides English.** Check every word `country-es` shows on a screen:
  holiday names (`data/es-2026.ts`, one `name` per row, verbatim from the BOE and compared by a
  test), the area label «Lleida, fuera del territorio de Arán» (Waitron's wording), and the notices
  (`spain.ts:199–235`, already `{ en, es }`). A holiday carrying an English name beside the official
  one may need a schema change — ask before adding one.
- **Regional demo screen qualification.** Inspect the seeded till, kitchen and dashboard in
  English/Spanish, both themes and phone/desktop widths when the development stack can start.
  The regional cuts' local launches refused at Mailpit's absent Docker socket; their native setup
  component views and database/media checks do not qualify those live screens.
- **Demo media regeneration changes the committed Negroni picture.** The moved
  generator produces different pixels for Negroni; a decoded-pixel comparison
  preserves this finding across tested Node compression versions. Preserve the
  committed picture when qualifying a future regeneration policy;
  A972 cut 1 moves its original bytes and keeps the existing encoder behavior.
- **A974 — remaining Bucket E and F sites.** Still open: identifiers and file names from the audit.
  The audit is historical; its other listed Bucket E comments have been removed or put in English.
  Other private naming sites remain in the till's boot and counter-payment suites
  and the server's till-API fixtures.
  Keep accented search fixtures unchanged. String-selected product keys stay with their fixture text
  under A976.
  Catalogue display names, recipe ingredient text, seasonal venue and zone names and printer-screen display labels
  also stay with A976, along with counter-screen display text, station-screen display names,
  kitchen-ticket grouping, payment/queue widget display text, variant media fixtures and
  device/printer deletion fixture text.
  Developer/demo script names remain A975's. Low priority.
- **Setup receipt-language selection lookup.** `apps/setup/src/screens/venue-screen.ts` still
  treats an inherited property such as `constructor` as a language entry. Qualify the selection path with country-pack
  choices carrying such a code before changing it. Its reachability through an installed pack
  has not been established. `git blame` attributes the selection expression to `082553a65`.
- **A975 — remaining demo scripts.** The `*-demo.ts` scripts still carry non-English sample
  text. Retire the fake-backend demos after moving their useful checks into ordinary English
  tests. Move the worked VAT-return example in `modelo-303-demo.ts` into Spain's reporting area.
  The receipt picture tool's sample identities, addresses, dishes and units are English; its
  rendered-output test runs the tool and reads its PDFs. Spanish and Basque receipt presentation
  stays selected, with the QR caption taken from the existing fiscal invoice fixture. The demo
  seed itself is A972's; script-suite test fixtures belong to A976 below. Low priority; A977
  cannot scan `apps/*/scripts` until the remaining demos and test-fixture cleanup land.
- **A976 — remaining test-venue defaults.** Menu-period rule samples use English names.
  The kitchen-note upgrade fixture uses an English operation description.
  Native allergy, kitchen-note and bill-identity suites use English sample location names.
  The bill, party, boot, stream and clock fixtures
  listed in the [historical audit](english-only-audit.md#test-support-files-outside-testts)
  still need English defaults, as do the split-extras venue's operation description and the
  adjustment venue's Spanish staff dish names, legal name and operation description.
  Native provisioning and floor-plan-set route suites use English venue, operation and menu
  samples; their Spanish locale and starter-content checks remain.
  The adjustment venue (`apps/server/src/testing/adjustment-venue.ts`) now gives English
  customer-facing and kitchen names to its dishes and wine-glass variant, and English category,
  printer, device, location and administrator names. Its staff names "Croquetas", "Tortilla",
  "Pimientos" and "Cana", its legal name and its operation description remain; it keeps its
  street address, its es-ES locale, its reasons' Spanish translations, setup's default station
  "Cocina" and the Spanish ticket and receipt words its es-ES venue prints. Some of its suites
  keep their own Spanish samples, among them the apply suite's "Barra" counter zones,
  the collect-at-counter suite's "Fríos" printer and the receipt and portions suites' customer
  "Cliente SL".
  The kitchen-ticket renderer suite (`apps/server/src/kitchen-ticket.test.ts`) uses English
  station, table, dish, note and place names; it keeps the Spanish ticket words its es-ES cases
  print, the accented samples its wrapping and character checks read ("Cumpleaños de la abuela"
  with and without "García", "Jalapeños en vinagre con eneldo" and "Café"), and one French sample,
  "Cornichons".
  The kitchen-print suite (`apps/server/src/kitchen-print.test.ts`) gives English station,
  printer, course, dish, extra, note and table names to what it creates; it keeps the default
  kitchen station setup names "Cocina" for its Spanish party venue (printed on its party-name
  tickets), the party venue's dishes, the Spanish ticket words and unit
  names its es-ES venue prints, and its Spanish alphabetical-order case. The kitchen-print
  concurrency suite (`kitchen-print.concurrency.test.ts`) creates an English location, catalogue,
  station, printer and product but keeps its es-ES locale and the operation description "Venta en
  establecimiento", and the shared-printers suite (`kitchen-print.shared-printers.test.ts`) creates
  only English names. The print-problems suite (`apps/server/src/print-problems.test.ts`)
  gives English location, menu, category, station, printer and table names to what it creates,
  and names its kitchen station itself instead of taking the shared seed's default "Cocina"; it
  keeps its es-ES locale and the operation description "Restaurante". The print API suite
  (`apps/server/src/print-api.test.ts`) gives English location, printer, print-agent, table and
  handheld-device names to what it creates, and names a registered printer apart from the name a
  box reports for the same device; it keeps its es-ES locale, the operation description "Venta en
  establecimiento", the "Café 12,50 €" line its preview case reads back and its Spanish date
  check. The kitchen suite (`apps/server/src/kitchen.test.ts`) gives English location, station and
  course names to what it creates; it keeps its es-ES locale, the operation description "Venta en
  establecimiento" and its Spanish alphabetical-order case. The fiscal sale-path
  suite's venue keeps "Sala principal", "Administradora", "Delicatessen", "Comida", "Bebidas" and
  "Venta en establecimiento".
  The print-alert suite (`apps/server/src/alert-sources.test.ts`) gives English print-agent,
  station and printer names to what it creates, and the order-places suite
  (`apps/server/src/order-places.test.ts`) English table and group names; the alert suite keeps
  its es-ES locale and the printer name "Epson", and the order-places suite keeps the Spanish names
  its shared party venue (`apps/server/src/testing/party-venue.ts`) creates.
  The service-period suite (`apps/server/src/till-api.service-periods.test.ts`) gives English
  names to what it creates and names no menu after a period, and the service-step suite
  (`apps/server/src/service-step-signals.test.ts`) English table names; the service-period suite
  keeps the Spanish names its shared signed-in till (`apps/server/src/testing/signed-in-till.ts`)
  creates, among them the administrator "Administradora" it reads as the manager, and the Spanish
  ticket words that till's es-ES venue prints, and the service-step suite the Spanish dishes its
  shared party venue creates.
  The tables suite (`apps/server/src/tables.test.ts`) gives English location, zone, menu,
  category, product and station names to what it creates, naming its kitchen station itself
  instead of taking the shared seed's default "Cocina"; it keeps its es-ES locale and the
  operation description "Venta en establecimiento". The receipt-lines suite
  (`apps/server/src/receipt-lines.test.ts`) uses English dish, extra, unit and option samples; it
  keeps its `es-ES` language keys, its "kg" unit and the Spanish names its two-language
  variant-name case joins.
  The receipt-preview suite (`apps/server/src/receipt-preview-api.test.ts`) gives English device
  and receipt-printer names to what it creates, in the same name order its tie-break cases read;
  it keeps the Spanish header and footer text it saves under the `es-ES` key, the Galician and
  Spanish receipt labels it checks, and what its shared venue
  (`apps/server/src/testing/venue-fixtures.ts`) creates: Spanish names, among them "Sala
  principal", "Administradora", "Bebidas", "Café", "Agua" and "Venta en establecimiento", the
  street address "Calle Mayor 1" and the legal name "Deli Test SL". The station-printers suite
  (`apps/server/src/station-printers.test.ts`) gives English location and station names to what it
  creates; it keeps its es-ES locale and the operation description "Venta en establecimiento".
  The management API suites (`apps/server/src/management-api.test.ts` and its
  accounts-and-receipt-config, passkey, canvas-retirement, device-profiles, floor-plan-sets,
  membership and status siblings) give English location, administrator, staff, zone, station,
  course and menu names to what they create; they keep their es-ES locale, the operation
  description "Venta en establecimiento", the legal name "Deli Test SL" (the membership suite's is
  "Membership Endpoint SL"), the street address "Calle Mayor 1", the city and province "Madrid",
  and the Spanish receipt subtitles and footers the account suite saves under its `es-ES` and
  `ca-ES` keys. The chain-height suite (`apps/server/src/chain-height.test.ts`), whose venue setup
  copies the status suite's apart from its tax number, uses the same English location and
  administrator names and keeps the same es-ES locale, operation description, legal name, street
  address, city and province. The
  department-receipt-mount, kitchen-delete and service-delete management API suites keep only the
  Spanish names their shared venue (`apps/server/src/testing/venue-fixtures.ts`) or party venue
  (`apps/server/src/testing/party-venue.ts`) creates.
  The card-reader, device and course delete suites (`apps/server/src/card-reader-delete.db.test.ts`,
  `device-delete.db.test.ts`, `course-delete.test.ts` and `kitchen.remove-course.test.ts`) and the
  kitchen-delete integration suite (`kitchen-delete.integration.test.ts`) give English reader,
  profile, device, location, course, table and order names to what they create, and the
  delete-impact naming suite (`delete-impact.test.ts`) uses English labels for its sample targets;
  the card-reader suite keeps its es-ES locale and the operation description "Venta", the
  device-delete suite its sale line's es-ES description "Café" and the names its shared venue
  creates, and the course and kitchen-delete suites only the Spanish names their shared party venue
  creates. The device-delete history suite (`apps/server/src/device-delete.history.test.ts`) still
  labels its open order "Mesa 1" and names its sale line "Café".
  The venue-service menu-timetable suite (`packages/venue-service/src/menu-timetable.test.ts`)
  still keys and names its menus in Spanish (Desayunos, Almuerzo, Cena, Bebidas, Café, Cócteles,
  Copas, "Deli para llevar") and uses "Sala" and "Terraza".
  The device-api suite (`apps/server/src/device-api.test.ts`) gives English names to what it
  creates; two of its comments still name the shared helper's default station "Cocina" and one its
  products (café, agua), names no check in it reads. The station-alert and party suites still
  hold other Spanish samples, among them "Mesa 7" and "Terraza" in the party suites. The
  configuration-transfer suite (`apps/server/src/configuration-transfer.test.ts`) gives English
  names to what it creates; it still reads the default kitchen station setup names "Cocina" for a
  Spanish venue (`packages/provisioning/src/starter-content.ts`), and keeps Spanish values inside
  its translation maps, its accented name-key case, official holiday and place names, its street
  lines, and "Fiesta" (also an English word). The device-api pass suite
  (`apps/server/src/device-api.pass.test.ts`) and the device, join-request,
  join-api, join-api database and device-session suites keep only the Spanish names the shared
  test helpers create, and the device and device-session suites' operation description "Venta en
  establecimiento". Screen tests take translated expectations from
  their strings file.
  Keep accent tests, including combobox searches, AEAT names and official text. Media's main
  library suite takes its Spanish Save label, card actions, usage labels, preview, default-language
  marker and form message from
  the catalogue; its direct error-wording
  and browser language-name checks remain. Keep deliberate Spanish/French metadata, the filename
  suite's accent-sensitive sample and the framing suite's deliberate multilingual metadata.
  The combobox accessibility suite's sample wording is English; its themes, keyboard,
  selection, disabled contrast and accessibility checks remain.
  The bookings dashboard's form, day-list, client, validation, draft and accessibility suites
  use English sample names; form and picker labels read the catalogue. Keep printing’s accented
  glyph cases and preserve text lengths when translating its remaining samples.
  Bookings’ native booking, route, clock, floor, table-removal and schema suites use English
  sample location, operation, contact and note text. Venue-service period-deletion and zone-closure
  suites use English venue, station, zone, menu, period and special-day samples, keeping
  locale keys, dates and behavior checks. Season and day-resolver suites use English venue,
  zone and custom-season samples, keeping staff-language cases, dates and clock settings.
  The native special-day save/delete suite uses English venue, operation, zone and custom-day
  samples, keeping official holiday names, dates, locale settings and behavior checks.
  Opening-hours route samples use English venue, station, zone, menu, period and custom-date
  names, keeping locale settings, dates, permissions and refusal checks.
  Period-deletion HTTP route samples use English location, operation, station, menu and special-day
  names, keeping dates, locale keys, permission refusals and replacement checks.
  The native opening-hours calendar suite uses English venue, operation, menu, department and
  custom-day samples; official holiday names, staff-language season checks, geography, dates
  and calendar behavior checks stay.
  Special-day HTTP route samples use English venue, operation, zone and custom-day names;
  dates, permissions, refusal details, saved paint and name ordering stay.
  Remaining helper and screen fixtures stay
  with this item. Catalogue import-validation samples use English menu, dessert and drink names;
  accented-name collision and multilingual unit examples remain. Continue package by package
  from A977's list. UI switch behavior and accessibility
  suites use English sample labels and descriptions. Disclosure accessibility samples use English
  headings, summaries and body text; deliberate EN/ES summary examples remain. Printing layout
  and printer samples use English; layout samples keep their character counts and word boundaries.
  Database kitchen-course, station and station-printer suites use English sample names.
  Floor-plan, catalogue-membership and ticket-item samples use English names and notes.
  Layouts' receipt, address and operation-description samples use English.
  Database zone and party-label suites use English sample zone, group and guest names.
  UI-core input and textarea samples use English label and note text; phone-label checks
  retain their 120-character inputs and existing bounds.
  UI floor-model, table-token and floor-map suites use English sample zone and party names.
  UI-core field-label and input accessibility samples use English price and contact text.
  UI combobox and row-menu suites use English sample staff names; deliberate bilingual
  trigger labels and accented-search examples remain.
  Venue-service API-client zone samples use English names; request bodies and refusal checks remain.
  Routing-grid equal-name and ordinary hierarchy samples use English labels; explicit accent,
  natural-order and search fixtures and the Spanish locale check remain.
  Menu-period rule samples use English names; whitespace trimming, invalid-name refusals,
  weekday validation and overnight ranges retain their checks.
  The kitchen-note upgrade fixture uses an English operation description and keeps its
  es-ES locale, translated dish description and populated-predecessor comparisons.
  The kitchen-notice suite uses English station samples; its statement-count checks remain.
  Native allergy, kitchen-note and bill-identity suites use English sample location names;
  their allergy assignments, note revisions and bill-number checks remain.
  Catalogue stored-name-key samples use English dish and template names; accented folding,
  variant renaming, batch boundaries and clash checks stay.
  Catalogue pricing samples use English dish and modifier text; pricing checks retain
  their existing amounts, quantities, dates and language keys.
  Catalogue menu-removal and availability suites use English dish samples; removal,
  sibling-price, archived-product and availability checks remain.
  Dashboard hardware save-state, equipment-label and page-printer panel suites use English
  sample names; IDs, permissions, saved choices and save-state checks stay in place.
  Dashboard overview behavior and accessibility suites use English dish and variant samples;
  currency, ordering, overflow and deliberate EN/ES checks stay in place.
  The server's split-extras test venue and its suites use English customer, kitchen and location
  names; staff names, language keys and the venue's locale stay, and its operation description
  remains.
  The server's zone-offer suite gives English location, menu, category, product, station and
  extras-list names to what it creates; its es-ES locale, its extras list's language key and
  the default kitchen station the shared seed helper names "Cocina" stay.
  The server's device, device-session, join, station-alert, party and configuration-transfer
  suites no longer use "Pase" or "Pantalla" in sample names.
  The device, join-request, join-api, join-api database and device-session suites
  give English names to what they create; the names the shared test helpers create and the
  operation description stay Spanish.
  Named-day occurrence samples use English custom-day names; repetition, closure, public-holiday
  tone and area-selection checks stay.
  Holiday-route custom fair samples use English names; official holiday names, geography,
  permissions, sources and dates stay.
  Native season route and season week suites use English venue, operation, zone and custom-season
  samples; Spanish starter-season names, locale keys, clock revisions and refusal checks stay.
  Native kitchen-notice samples use English menu, dish, table, note and removed-extra text;
  unit translations, unit identities, quantities and all six day-boundary readings stay.
  The server's report suites (`apps/server/src/report-api*.test.ts`, all but the
  categories-reconcile suite) give English location, node, device, table, printer, category,
  product and station names to what they create; they keep their `es-ES` invoice locale and
  `es-ES` description values, the operation description "Venta en establecimiento", the supplier
  name "Café del Puerto SL", the modelo 303 terms and the Spanish category-print heading check.
  The catalogue API suite (`apps/server/src/catalogue-api.test.ts`) gives English menu, category,
  product, variant, kitchen, options-list, label and extras-list names to what it creates; it
  keeps the customer names and descriptions it gives under `es`, `fr` and other language keys,
  its `es-ES` locale and the operation description "Venta". The full-manifest suite
  (`apps/server/src/catalogue-api.full-manifest.test.ts`) gives its location, administrator,
  category, product and section English names, and keeps its `es-ES` locale, its Spanish street
  address and the operation description "Venta en establecimiento". The setup API suite
  (`apps/server/src/setup-api.test.ts`) uses English location, administrator, product,
  series-code, zone and department samples, and keeps its `es-ES` locale, its Spanish addresses,
  the administrator's personal names "Ana Maria" and "Lopez Garcia", and the operation
  description "Venta en establecimiento" its venue-defaults case reads from the fiscal package.
  Other helpers and screen fixtures remain.
  Keep existing behavioral assertions. Low priority.
- **Cloud cost-test fixture wording.** The separate Cloud repository's
  `scripts/cloud-cost/fixtures/remote-browser-backend.mjs` and `remote-waitron-backend.mjs` still
  carry Spanish operation and street examples. Translate those samples in a Cloud change; the
  Waitron fixture's wording change does not update those files.
- **A977 — point 8, after A963–A975 land.** Widen `scripts/english-only.test.ts` to every
  text file under `packages/` and `apps/`, exempting only the homes (the packages written for Spain,
  `fiscal-verifactu`, translation files, a package's `src/starter-content.ts`), add an accented-letter check, and keep a list of test
  folders still to clean that may only get shorter. Fix the wrong comment at
  `packages/reporting/src/dr303-layout.ts:14–16` and its generator
  (`reference/generate-dr303-layout.py:184–186, 274–275`), which say the guard scans `reporting`.

## Go-live day steps

On go-live day, make these changes together (owner, 2026-10-21 about 15:35–15:40):

1. Replace `CLAUDE.md` §3's **No backwards-compatibility or data-migration code until Waitron
   is in production** rule with the live-data policy: each release that changes stored data
   ships a migration that rewrites the live venue's rows. Never reset a production box or
   edit a shipped migration. Code reads the new form only. Read both forms only while
   something outside the box, such as Cloud or a till page that has not reloaded, still
   holds the old form; remove that support in a later release. You may still reset test boxes.
2. After A979's [operator-procedure inventory](../operations/planning-procedure-audit.md),
   sweep again for procedures added since its pin and retain them in permanent docs or user
   guides. Then delete `docs/superpowers/` and `docs/handoffs/`, and gitignore both directories.
   Check permanent docs for links to the deleted files and keep any instructions still needed.

Keep the current `CLAUDE.md` rule, planning files and ignore settings until go-live day.
The separate [A760 procedure](../operations/a760-migration-squash.md) retains its own freeze,
reset and operator gates; this entry does not start that job.

## A760. Squash every migration set before go-live

The [operator procedure](../operations/a760-migration-squash.md)
  and [inventory](../operations/a760-migration-squash-inventory.md) are approved
  (owner, 2026-10-16), including fiscal SQL/meta and the named history-harness changes.
  The watcher starts the sole job after big work and migration branches drain, with the full
  Waitron/Cloud mutation freeze and named reset/operator roster recorded. Reset the laptop
  dev-stack slots and Santet venue through the plan; leave the owner's physical `waitron.local`
  off/quarantined, image pinned, for the owner to reset on return after 2 November.

## Station deletion's draft-location filter needs a discriminating test

Add a second-location draft case that fails without the `working_orders` location `exists` clause
  in `apps/server/src/station-delete.ts`, or establish by running the real writers that it is
  redundant before removing it. Its necessity remains unverified.

## Loose ends left by A435's printer, reader and device delete (steps 2 to 4)

- The till's status for an original whose printer was deleted uses the error code's sentence
  ("…this job will not be retried."), where its neighbours speak of "the original". Owner to
  choose the wording.
- The Spanish for `printer.deleted` breaks its twin's pattern: "por lo que no se volverá a
  intentar este trabajo" where `printer.unpaired` says "así que este trabajo no se volverá a
  intentar".
- Shorter printer-delete copy was offered to the owner during the build: for the till's
  deleted-printer sentence, the Spanish heading over ending work (now "Trabajo que finaliza"; a
  shorter "Lo que se detendrá" was offered, which in the present tense reads "Lo que se
  detiene"), and one dialog line per inherited default.
- `refuseDeletedPrinters` lives in `@waitron/layouts` though `@waitron/printing` holds the
  printer functions and `printer.not_found`'s registry.
- `deletePrinter` writes the device choices, profile lists and holders that layouts owns; one
  layouts function could clear them.
- Several printer queries that already require an active printer or a live job also filter
  `deleted_at`; one test pinning "deleted means switched off with no live jobs" could replace
  the copies.
- The devices and payments screens copy the printers screen's delete-dialog logic
  (`apps/dashboard/src/screens/devices-screen.ts`, and since A435 step 3 `payments-screen.ts`).
  Pull it into one shared piece, with the `names` helper that `printer-delete-copy.ts`,
  `reader-delete-copy.ts` and `device-delete-copy.ts` each repeat and the `line` helper the
  first two share. Left open by A435 step 4 (#1519) and step 3.

## Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519)

- "A device that is not deleted" is written by hand as `isNull(devices.deletedAt)` in several
  files; one named check would keep a new query from forgetting it. Step 4 (#1519).
- A Stripe reader's delete confirmation does not say the reader stays registered at Stripe, which
  a SumUp reader's does while SumUp is not connected. Step 3b.
- The till names a reader deleted elsewhere with `reader.not_found`'s general sentence ("This
  device has no card reader it can use…", `apps/till/src/i18n/codes.ts`), where a deleted printer
  has its own "That printer no longer exists". Owner to choose whether readers get one too. Step 3
  (#1520), whose plan kept the existing sentence.

## Loose ends left by A394-3 (#1447)

- `GET …/locations/:locationId/catalogues` and the member `DELETE` answer as before for an
  unknown location.
- A malformed menu or location path id still answers 400 `shared.invalid_id` until A394-22,
  while the course route answers 404.
- The two location routes' body menu id keeps 404 until A394-11.
- Workforce refuses an unknown BODY location as `management.request_invalid` while catalogue's
  PATH location answers `location.not_found`. If workforce moves to the new code, declare it in
  `packages/db/src/errors.ts`.

## Loose ends left by A483 (#1544)

OPEN.

- [Switched-off modules' append-only protection](#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked).
- **Putting back a changed append-only trigger is a hand-typed command.** Retry cannot clear
  `append_only.triggers_changed` for a changed trigger; the installer runs the `node -e` drop in
  `deploy/README.md` (_When the page names `append_only.triggers_changed`_) and then presses
  Retry. **Next action:** decide whether Waitron ships that as an operator command.
- **The append-only check does not read `PRAGMA recursive_triggers`.** With the pragma off,
  `INSERT OR REPLACE` rewrites an append-only row without touching a trigger (measured,
  `docs/developers/conventions-data.md`); `apps/server/src/append-only-watch.ts` reads only the
  triggers' stored text. Whether anything on a running server can turn the pragma off is
  unmeasured.

## Loose ends left by the tenant-column removal (#378, 2026-09-16)

- [Index and key names that still read `tenant`](#these-index-and-key-names-still-read-tenant-and-the-columns-they-name-are-gone).
- [`server.credential_unusable`'s domain prefix](#servercredential_unusable-names-an-unusable-credential-although-server-is-reserved-for-facts-about-the-process-itself).

## The `authorized_by` comment on `drawer_opens` says only a manual open sets it

The comment (`packages/db/src/schema/drawer-opens.ts:50-51`) omits a cash refund's opening:
  `enqueueTenderRefundDrawer` takes a required `authorizedBy` and writes it into the row
  (`apps/server/src/receipt-print.ts:622`, `:645-653`). Correct the comment to name every reason
  that sets it.

## No sweep has read every insert whose rows grow with an order

A1208 routed the inserts it found growing with a counter order's dishes (the lines, their sale
contexts and copies, portions and their bindings, cancellations, carried discounts, kitchen items
and split extras, and the links from filed rows) through `insertInChunks` or `statementChunks`
(`packages/db/src/insert-in-chunks.ts`). That sweep missed four. PR #2265's run-it review saw one
refused when it ran it, and named three more it had not run; a test of each was refused "too many
SQL variables" before its fix: an item payment's lines (6,554 rows), a whole-bill discount's lines
(6,554), a kitchen ticket's line links (10,924 on one printer) and, on a bill with a party, its
kitchen allergy snapshots (11,880 items fired in one call). These now go through the same helpers.
Nobody has read every insert since, so others may remain. Read each insert whose row count follows
an order's dishes and route any that can bind more than `SQL_VARIABLE_LIMIT` values
(`packages/store/src/index.ts`) through one of those helpers.

## A table round of more than about 1,100 dishes is refused "too many SQL variables"

A connection the store opens binds at most 32,766 values in one statement
(`SQL_VARIABLE_LIMIT`, `packages/store/src/index.ts`), the limit the official Node v26.13.0 for
macOS reported; Homebrew's Node reported 250,000, and the store sets the lower one so a local run
refuses what CI refused. A803 slice 1 writes one line per dish. A1208 chunked the other inserts
it found growing with an order; see
[No sweep has read every insert whose rows grow with an order](#no-sweep-has-read-every-insert-whose-rows-grow-with-an-order).
The table round's line insert, `insertTabRound` (`apps/server/src/working-order.ts`), is still one
statement: placing one round of waters through `placeGroups` passed at 11 lines of 99 (1,089
dishes) and was refused "too many SQL variables" in `insertTabRound` at 12 lines of 99 (1,188
dishes), 20 and 30, under the official Node v26.13.0 and Homebrew's v26.11.1 alike (2026-10-30). It uses `.returning`, so splitting it means gathering the
returned rows from every part, as `fireLines` now does. `copyRecalledPortion`
(`apps/server/src/draft-recall.ts`) also writes its lines in one statement; it copies one recalled
dish, so its size is bounded by that dish's quantity (read, not run). The 99 limit
(`tab.portions_too_many`) is per dish, so it does not bound a round.

Separately, drizzle's session and the store's adapter (`packages/store/src/node-sqlite-adapter.ts`)
pass every bound value as a separate argument, and an `inArray` over 60,000 ids answered
`RangeError: Maximum call stack size exceeded` on Homebrew's Node, where 57,500 passed. Through the
store's connections, which now set the limit, a 60,000-value statement is refused "too many SQL
variables" instead (measured on Homebrew's v26.11.1, 2026-10-30).

## A974. Finish the remaining English names in general code.

- **A974. Finish the remaining English names in general code.** Remaining: boot and counter-payment
  suites, server till-API fixtures, and file names.
  Keep accented search fixtures unchanged. Other fixture text stays with A976, including catalogue
  display names, recipe ingredient names and seasonal venue and zone names, printer-screen display
  labels, counter-screen display text and station-screen display names, plus kitchen-ticket grouping,
  payment/queue widget display text,
  variant media fixtures and device/printer deletion fixture text.
  [Detail](architecture.md#a913s-fix-items-general-code-english-only). Low priority.

## A976. Finish the server's English test-venue defaults.

- **A976. Finish the server's English test-venue defaults.** Bookings’ native suites use English
  sample location, operation, contact and note text. Native provisioning and floor-plan-set route
  suites use English venue, operation and menu samples; their Spanish locale and starter-content
  checks remain. UI switch behavior and accessibility suites
  use English sample labels and descriptions. Disclosure accessibility samples use English headings,
  summaries and body text; deliberate EN/ES summary examples remain. Printing layout and printer
  samples use English, with the layout samples retaining their character counts and word boundaries.
  Database kitchen-course, station and station-printer suites use English sample names.
  Floor-plan, catalogue-membership and ticket-item samples use English names and notes.
  Layouts' receipt, address and operation-description samples use English.
  Database zone and party-label suites use English sample zone, group and guest names.
  UI-core input and textarea samples use English label and note text; phone-label checks
  retain their 120-character inputs and existing bounds.
  UI floor-model, table-token and floor-map suites use English sample zone and party names.
  UI-core field-label and input accessibility samples use English price and contact text.
  UI combobox and row-menu suites use English sample staff names; deliberate bilingual
  trigger labels and accented-search examples remain.
  Venue-service API-client zone samples use English names; request bodies and refusal checks remain.
  Routing-grid equal-name and ordinary hierarchy samples use English labels; explicit accent,
  natural-order and search fixtures and the Spanish locale check remain.
  Menu-period rule samples use English names; whitespace trimming, invalid-name refusals,
  weekday validation and overnight ranges retain their checks.
  The kitchen-note upgrade fixture uses an English operation description and keeps its
  es-ES locale, translated dish description and populated-predecessor comparisons.
  The kitchen-notice suite uses English station samples; its statement-count checks remain.
  Native allergy, kitchen-note and bill-identity suites use English sample location names;
  their allergy assignments, note revisions and bill-number checks remain.
  Catalogue stored-name-key samples use English dish and template names; accented folding,
  variant renaming, batch boundaries and clash checks stay.
  Catalogue pricing samples use English dish and modifier text; pricing checks retain
  their existing amounts, quantities, dates and language keys.
  Catalogue menu-removal and availability suites use English dish samples; removal,
  sibling-price, archived-product and availability checks remain.
  Dashboard hardware save-state, equipment-label and page-printer panel suites use English
  sample names; IDs, permissions, saved choices and save-state checks stay in place.
  Dashboard overview behavior and accessibility suites use English dish and variant samples;
  currency, ordering, overflow and deliberate EN/ES checks stay in place.
  Catalogue import-validation samples use English menu, dessert and drink names;
  accented-name collision and multilingual unit examples remain.
  The server's split-extras test venue and its suites use English customer, kitchen and location
  names; staff names, language keys and the venue's locale stay, and its operation description
  remains.
  The server's zone-offer suite gives English location, menu, category, product, station and
  extras-list names to what it creates; its es-ES locale, its extras list's language key and
  the default kitchen station the shared seed helper names "Cocina" stay.
  The kitchen-print suite (`apps/server/src/kitchen-print.test.ts`) gives English station,
  printer, course, dish, extra, note and table names to what it creates; it keeps the default
  kitchen station setup names "Cocina" for its Spanish party venue (printed on its party-name
  tickets), the party venue's dishes, the Spanish ticket words and unit
  names its es-ES venue prints, and its Spanish alphabetical-order case. The kitchen-print
  concurrency suite (`kitchen-print.concurrency.test.ts`) creates an English location, catalogue,
  station, printer and product but keeps its es-ES locale and the operation description "Venta en
  establecimiento", and the shared-printers suite (`kitchen-print.shared-printers.test.ts`) creates
  only English names. The print-problems suite (`apps/server/src/print-problems.test.ts`)
  gives English location, menu, category, station, printer and table names to what it creates,
  and names its kitchen station itself instead of taking the shared seed's default "Cocina"; it
  keeps its es-ES locale and the operation description "Restaurante". The print API suite
  (`apps/server/src/print-api.test.ts`) gives English location, printer, print-agent, table and
  handheld-device names to what it creates, and names a registered printer apart from the name a
  box reports for the same device; it keeps its es-ES locale, the operation description "Venta en
  establecimiento", the "Café 12,50 €" line its preview case reads back and its Spanish date
  check. The kitchen suite (`apps/server/src/kitchen.test.ts`) gives English location, station and
  course names to what it creates; it keeps its es-ES locale, the operation description "Venta en
  establecimiento" and its Spanish alphabetical-order case. The fiscal sale-path
  suite's venue keeps "Sala principal", "Administradora", "Delicatessen", "Comida", "Bebidas" and
  "Venta en establecimiento".
  The print-alert suite (`apps/server/src/alert-sources.test.ts`) gives English print-agent,
  station and printer names to what it creates, and the order-places suite
  (`apps/server/src/order-places.test.ts`) English table and group names; the alert suite keeps
  its es-ES locale and the printer name "Epson", and the order-places suite keeps the Spanish names
  its shared party venue (`apps/server/src/testing/party-venue.ts`) creates.
  The service-period suite (`apps/server/src/till-api.service-periods.test.ts`) gives English
  names to what it creates and names no menu after a period, and the service-step suite
  (`apps/server/src/service-step-signals.test.ts`) English table names; the service-period suite
  keeps the Spanish names its shared signed-in till (`apps/server/src/testing/signed-in-till.ts`)
  creates, among them the administrator "Administradora" it reads as the manager, and the Spanish
  ticket words that till's es-ES venue prints, and the service-step suite the Spanish dishes its
  shared party venue creates.
  The tables suite (`apps/server/src/tables.test.ts`) gives English location, zone, menu,
  category, product and station names to what it creates, naming its kitchen station itself
  instead of taking the shared seed's default "Cocina"; it keeps its es-ES locale and the
  operation description "Venta en establecimiento". The receipt-lines suite
  (`apps/server/src/receipt-lines.test.ts`) uses English dish, extra, unit and option samples; it
  keeps its `es-ES` language keys, its "kg" unit and the Spanish names its two-language
  variant-name case joins.
  The receipt-preview suite (`apps/server/src/receipt-preview-api.test.ts`) gives English device
  and receipt-printer names to what it creates, in the same name order its tie-break cases read;
  it keeps the Spanish header and footer text it saves under the `es-ES` key, the Galician and
  Spanish receipt labels it checks, and what its shared venue
  (`apps/server/src/testing/venue-fixtures.ts`) creates: Spanish names, among them "Sala
  principal", "Administradora", "Bebidas", "Café", "Agua" and "Venta en establecimiento", the
  street address "Calle Mayor 1" and the legal name "Deli Test SL". The station-printers suite
  (`apps/server/src/station-printers.test.ts`) gives English location and station names to what it
  creates; it keeps its es-ES locale and the operation description "Venta en establecimiento".
  The management API suites (`apps/server/src/management-api.test.ts` and its
  accounts-and-receipt-config, passkey, canvas-retirement, device-profiles, floor-plan-sets,
  membership and status siblings) give English location, administrator, staff, zone, station,
  course and menu names to what they create; they keep their es-ES locale, the operation
  description "Venta en establecimiento", the legal name "Deli Test SL" (the membership suite's is
  "Membership Endpoint SL"), the street address "Calle Mayor 1", the city and province "Madrid",
  and the Spanish receipt subtitles and footers the account suite saves under its `es-ES` and
  `ca-ES` keys. The chain-height suite (`apps/server/src/chain-height.test.ts`), whose venue setup
  copies the status suite's apart from its tax number, uses the same English location and
  administrator names and keeps the same es-ES locale, operation description, legal name, street
  address, city and province. The
  department-receipt-mount, kitchen-delete and service-delete management API suites keep only the
  Spanish names their shared venue (`apps/server/src/testing/venue-fixtures.ts`) or party venue
  (`apps/server/src/testing/party-venue.ts`) creates.
  The card-reader, device and course delete suites (`apps/server/src/card-reader-delete.db.test.ts`,
  `device-delete.db.test.ts`, `course-delete.test.ts` and `kitchen.remove-course.test.ts`) and the
  kitchen-delete integration suite (`kitchen-delete.integration.test.ts`) give English reader,
  profile, device, location, course, table and order names to what they create, and the
  delete-impact naming suite (`delete-impact.test.ts`) uses English labels for its sample targets;
  the card-reader suite keeps its es-ES locale and the operation description "Venta", the
  device-delete suite its sale line's es-ES description "Café" and the names its shared venue
  creates, and the course and kitchen-delete suites only the Spanish names their shared party venue
  creates. The device-delete history suite (`apps/server/src/device-delete.history.test.ts`) still
  labels its open order "Mesa 1" and names its sale line "Café".
  The venue-service menu-timetable suite (`packages/venue-service/src/menu-timetable.test.ts`)
  still keys and names its menus in Spanish (Desayunos, Almuerzo, Cena, Bebidas, Café, Cócteles,
  Copas, "Deli para llevar") and uses "Sala" and "Terraza".
  The server's adjustment venue gives English customer-facing and kitchen dish names and English
  category, printer, device, location and administrator names; its locale, street address,
  reasons' Spanish translations and setup's default station "Cocina" stay, and its Spanish staff
  dish names, legal name and operation description remain.
  The server's kitchen-ticket renderer suite uses English station, table, dish, note and place
  names; it keeps the Spanish ticket words its es-ES cases print, its accented wrapping and
  character samples and one French sample.
  The server's station-alert and party suites still hold Spanish sample names. The
  configuration-transfer suite gives English names to what it creates; it still reads setup's
  Spanish default station "Cocina", and keeps Spanish translation-map values, its accented
  name-key case, official holiday and place names, its street lines and "Fiesta". The device,
  device-api, device-api pass, join-request, join-api, join-api database and
  device-session suites give English names to what they create; the names the shared test helpers
  create stay Spanish, as does the device and device-session suites' operation description.
  Venue-service period-deletion and zone-closure suites use English venue, station,
  zone, menu, period and special-day samples; locale keys, dates and behavior checks stay.
  Season and day-resolver suites use English venue, zone and custom-season samples;
  their deliberate staff-language cases, dates and clock settings stay.
  The native special-day save/delete suite uses English venue, operation, zone and custom-day
  samples; official holiday names, dates, locale settings and behavior checks stay.
  Opening-hours route samples use English venue, station, zone, menu, period and custom-date
  names; locale settings, dates, permissions and refusal checks stay.
  Period-deletion HTTP route samples use English location, operation, station, menu and special-day
  names; dates, locale keys, permission refusals and replacement checks stay.
  The native opening-hours calendar suite uses English venue, operation, menu, department and
  custom-day samples; official holiday names, staff-language season checks, geography, dates
  and calendar behavior checks stay.
  Special-day HTTP route samples use English venue, operation, zone and custom-day names;
  dates, permissions, refusal details, saved paint and name ordering stay.
  Named-day occurrence samples use English custom-day names; repetition, closure, public-holiday
  tone and area-selection checks stay.
  Holiday-route custom fair samples use English names; official holiday names, geography,
  permissions, sources and dates stay.
  Native season route and season week suites use English venue, operation, zone and custom-season
  samples; Spanish starter-season names, locale keys, clock revisions and refusal checks stay.
  Native kitchen-notice samples use English menu, dish, table, note and removed-extra text;
  unit translations, unit identities, quantities and all six day-boundary readings stay.
  The server's report suites (`apps/server/src/report-api*.test.ts`, all but the
  categories-reconcile suite) give English location, node, device, table, printer, category,
  product and station names to what they create; they keep their `es-ES` invoice locale and
  `es-ES` description values, the operation description "Venta en establecimiento", the supplier
  name "Café del Puerto SL", the modelo 303 terms and the Spanish category-print heading check.
  The catalogue API suite (`apps/server/src/catalogue-api.test.ts`) gives English menu, category,
  product, variant, kitchen, options-list, label and extras-list names to what it creates; it
  keeps the customer names and descriptions it gives under `es`, `fr` and other language keys,
  its `es-ES` locale and the operation description "Venta". The full-manifest suite
  (`apps/server/src/catalogue-api.full-manifest.test.ts`) gives its location, administrator,
  category, product and section English names, and keeps its `es-ES` locale, its Spanish street
  address and the operation description "Venta en establecimiento". The setup API suite
  (`apps/server/src/setup-api.test.ts`) uses English location, administrator, product,
  series-code, zone and department samples, and keeps its `es-ES` locale, its Spanish addresses,
  the administrator's personal names "Ana Maria" and "Lopez Garcia", and the operation
  description "Venta en establecimiento" its venue-defaults case reads from the fiscal package.
  Other helpers and screen expectations remain.
  Continue package by package from A977's list; keep accent-sensitive
  combobox searches and filename samples, deliberate multilingual metadata and printing’s accented
  glyph cases. Preserve text lengths when translating remaining printing samples. Low priority.
  [Detail](architecture.md#a913s-fix-items-general-code-english-only)

## Decisions and deliberate limits

**A972 regional demos (owner, 2026-10-27).** Each regional demo extends Casa Delgado
with one menu section, a regional wine and its own staff. Build Catalonia first,
shared with the Balearic Islands, then Valencia, then Galicia. Give each region a
restaurant name; update an untouched default when the postcode or province changes
and preserve a name someone has typed. Staff and kitchen names use the region's
language even when the staff screens are in English or Spanish. This applies to
demo data only; the A918 starter-content policy below stays separate. The
[design update](../superpowers/specs/2026-10-27-a972-demo-data-per-country-and-region-design.md)
records the four answers. Spain owns its demo records and pictures behind secondary
exports; ordinary browser entries stay separate. Madrid keeps its frozen database
comparison. Catalonia and the Balearic Islands share Can Delgado; Valencia uses
Casa Delgado de l'Horta and Galicia uses A Casa Delgado. No further country demos
are included in these five cuts. The [implementation plan](../superpowers/plans/2026-10-27-a972-demo-country-region.md)
records the delivered scope; live seeded-screen qualification remains separate.

**A963 recipient addresses (owner, 2026-10-20; extended 2026-10-28).**
The recipient may live in any country; Spain's pack owns Spain's address-completeness rule. The separate country code
selects the country name in the receipt language for thermal receipts, A4 invoices and the till
ticket; order details use the screen language. Recorded address text is rendered unchanged,
followed by the country line, without recognising or rewriting older address spellings.
The owner's 2026-10-28 identifier ruling requires one accepted identifier: a Spanish NIF, or a
document with its actual type and issuing country. Postal country never selects the identity.
Only a Spanish NIF is normalized and checked against Spain's rules; foreign document values
retain their spelling within the filing schema's limits. The owner authorized extending the
recipient builder; the completed invoice PR remains the owner's to land.
[Original implementation plan](../superpowers/plans/2026-10-27-a963-invoice-address-country.md) and
[foreign-recipient rework](../superpowers/plans/2026-10-28-a963-foreign-recipient-rework.md).

**A918 starter content in the venue's languages (owner, 2026-10-19, 2026-10-20 and 2026-10-27).**
The owner: "These default starter names in the general module should be in English only, and
should be translated into Spanish and catalán etc when the box is set up only" (2026-10-19); "each
module ships a translation file of its starter names (beside its screen translations), and setup
writes every language the venue uses from it; the English-only check is taught to allow those
files …" (2026-10-20); and, relayed on 2026-10-27, that rows holding one name "are written at
setup in the venue's staff language, the same for everyone; existing venues keep their rows".
So each package that writes starter words keeps them in its `src/starter-content.ts`, keyed by the
English; a field holding a name per language gets English plus the venue's starting content
languages the file carries; a field holding one name gets the staff language. A unit's staff name
shows only in the unit editor, the translation gap report and where a unit's name is blank; the
units list and product screens show each person's own language. The rule's home is
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only); the
reasoning is in `docs/superpowers/plans/2026-10-27-a918-starter-content-translations.md`.

**A646 module controls and Google access (owner, 2026-10-17).** The revised design is agreed:
Enabled-default catalogue, Add a module selects Disabled, row-menu Configure/Disable, a Configure
modal, red in-row reasons and settings saves separate from Enable/Disable. Disabling Google
protects every active administrator: the applying administrator gives fresh non-Google proof;
every other active administrator needs supported recorded password/passkey enrollment. Plan
and build wait for A739 and start with retained disabled-module protection.

**Practice-sales operation descriptions (owner, 2026-10-23).** Under the owner's approval,
the demo-test provisioner's practice-sales golden now uses the English operation description
(`apps/server/scripts/demo-seed/testing/provision-venue.ts`).

**Operator procedures survive the go-live planning cleanup (owner, 2026-10-21).**
Keep operating steps in permanent docs, outside `docs/superpowers/` and `docs/handoffs/`.
The [procedure directory](../operations/operator-procedures.md) and its
[22 October source audit](../operations/planning-procedure-audit.md) retain current workflows
and A760’s approved, still-gated one-time procedure. Recheck newly added procedures before
the go-live deletion; future design commands are not current operating instructions.

**What slice 1 left (#490 and the preparation tasks):**

- **Declined, with reasons:** writing `moneyNum` in `packages/workforce-es/src/convenio.ts` as
  `cents / 100` — it would put a second copy of the money scale outside `packages/shared/src/cents.ts`
  and the files `packages/shared/src/conventions.test.ts` checks (P5, #531); and one constant for the
  `10000` literals — four sit in check constraints, where only `sql.raw(String(n))` renders the
  number, and a constant that works only through `sql.raw` is a trap for the next tidy-up (P6,
  #529).

### Three shapes the read connection does not cover

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
