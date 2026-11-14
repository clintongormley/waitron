# Modules, data and code health — detail

The open entries are listed in [the backlog](../backlog.md), under "Modules, data and code health". This file holds
their full text.

## A646 — a Modules page where the administrator switches optional modules on and sets them up

- **A646 — OPEN; DESIGN APPROVED (owner, 2026-10-17).**
  [Plan](../superpowers/plans/2026-11-11-a646-modules-and-card-providers.md), Claude-read and cleared by the watcher on 2026-11-11. Modules lists optional modules and hosts provider configuration windows; Card payments links to all card providers. Administrators can turn card providers on or off after removing their readers; credentials remain available for earlier-payment recovery. A483 blocks switching the other five optional modules (workforce, workforce-es, payments, bookings and staffing), so A646 stays OPEN after the provider switches land.
  [Design](../superpowers/specs/2026-10-16-a646-modules-page-design.md) and
  static mockups (removed from the repository on 2026-11-02). The
  [switched-off modules' append-only protection](#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked)
  stays OPEN but no longer gates this page: no module that owns tables becomes switchable here
  (watcher's scope read, 2026-11-11).
  **Owner, 2026-11-11: Google sign-in leaves A646** ("Move google signin to the backlog, with the
  intention of doing it with a single key via waitron, but this is definitely not a go live
  requirement"); it is A1507 in [later.md](later.md#a1507-google-sign-in-built-in-through-one-waitron-owned-google-setup).
  The Google parts of the design below (an optional Google module, its credentials on this page,
  the every-administrator check before switching it off) are withdrawn.
  The agreed revision uses one complete optional catalogue, initially Enabled; Add a module filters
  that same list to Disabled. Category is independent, and Card payments links to Card providers
  with All states. Rows offer Configure where settings exist (watcher, 2026-11-11 17:15), plus Enable/Disable when switching is available, with persistent red reasons
  when Disable is forbidden. Configure opens a modal and saves settings only; state changes need
  separate confirmation and server checks. Stripe/SumUp remain Payments
  contributions. Other optional modules are listed but cannot be switched. Reuse provider
  reader-add checks; Off requires readers removed first, while credentials remain available for refunds and checks.
  Cut live module-code switching, pending-operation records and rerouting every `modules.json` reader
  (watcher, 2026-11-11 14:54).
  **Owner, 2026-11-06 23:03 (A1384 export answer, copied into Lane K queue):** an export from a box with a module off must load on a new box, and “that module starts on and empty”. Configuration import accepts missing optional sets and wholly absent optional-module tables (including Staffing in Workforce’s set), empties those configuration tables and still refuses partial tables, rows naming an absent set, and missing mandatory or provision-only sets; the boundary tests and `boot.setup-routes.test.ts` cover this.
  **Watcher, 2026-11-07 21:38:** the later 4 November rationalisation wins: applied module state in shared settings. The older design's separate applied-state tables and sealed ID are superseded.

  **2026-11-14, fl10:** module selection now lives in `settings.modules` inside `venue.db` and travels with database copies. The list below records the earlier 14 October read.

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
  2. (Withdrawn 2026-11-11: Google login as an optional module set on this page; now A1507.)
  3. SumUp and Stripe are set up from that page too. Card payments links to the list, filtered to
     card providers.


## Remaining table restrictions after the grants-record audit

Each unresolved table has its own entry in [the backlog](../backlog.md). The
[2026-10-19 audit](../developers/grants-retirement-audit.md) accounts for every restricted name
before the record was removed. Decide retention and the permitted mutations per table before
adding enforcement. These entries do not authorise fiscal or working-time chain changes.

The write-path detector still reads only builder calls whose receiver looks like a database
handle. A differently named handle can escape it; expanding that detector needs both a real-write
control and the ordinary `Set.delete` control. The allowance list remains JSON, with the reasons
beside its reader in `scripts/write-path-tables.test.ts`.

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

- `docs/developers/conventions-data.md` names a
  `print-api.printer-wiring.test.ts` case "refuses another tenant's manager…" that #378 removed.
  `docs/developers/testing-guide.md` says the concurrent Enable/unpair payments test "locks the
  reader before deciding"; there are no row locks, the enable waits behind the unpair's write
  transaction. `apps/server/README.md` sends readers to "the `drain.complete` log line, the
  `incidents` table" for rejected fiscal records, a path only someone with a terminal can take.
  Read only, not run: `WebhookDeps.nodeId` looks unread by `settleWebhook`. The lock-ordering and
  deadlock cases for transfers, merges and split bills went with PostgreSQL and nothing replaced
  them (one write transaction per venue file is what serialises those writers now). Test titles
  #622 could not touch: "regardless of database date display settings" in `print-api.test.ts`,
  "(the R-D dedupe)" in `kitchen-print.test.ts`, "(SP-B4 rehome)" in `receipt-print.test.ts`,
  "(SP-A.2 §16.4)" and "SP-C:" in `sale-till-source.receipt.test.ts`, "old per-taxpayer path"
  and "path tenant" in `webhook.test.ts`, "(FIX 2 cascade)" in `transfer-lines.test.ts`, "(the
  TS-4 shape)" in `move-merge.test.ts`.

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
so check which document each one names before cutting it. One was left on purpose:
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

## A switched-off module's append-only tables are neither re-protected nor checked

**Left open by A483.** Boot hands `applyMigrations` the sets of the modules this start migrates
(`setsToMigrate` in `apps/server/src/boot.ts`: every module in setup mode, the enabled ones when
trading), and the append-only check and the 10-second watch read the same list
(`appendOnlyTables`). A module switched off after its tables exist keeps those tables, but no start
re-installs or checks their triggers. From `packages/composition/src/modules.ts` and each module's
classification, read 2026-10-11 and not measured on a box: `payment_resolutions` (payments, `toggleable`), and
`registros_facturacion`, `filing_cases` and `filing_case_events` (fiscal-verifactu,
`provision-only`) on a box later moved to `fiscal-none`. The alternative is to check every known
module's tables that exist; its cost is a box that refuses to start after a release marks an
existing table of a switched-off module `appendOnly()`, because no migration of that module would
run to install the new trigger. Owner question Q5 of A483.

## These index and key names still read `tenant`, and the columns they name are gone

`print_agents_tenant_node_key`,
  `purchase_invoices_tenant_received_idx`, `sales_tenant_issued_idx`,
  `working_orders_tenant_status_idx`, `registros_tenant_node_secuencia_uq`, and four in identity:
  `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq`,
  `persons_tenant_pending_email_uq` and `persons_tenant_google_subject_uq`. (The `tenants*`
  and `tenant_credentials*` names are correct and stay.) This is
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


## A394-5, A394-10, A394-16 and A394-20 to A394-22 — refusal statuses by one rule

OPEN,
low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to
A394-4 landed as #1441, #1444, #1447 and #1455.) Read, not run: of 49 boundaries, 96 status rows
break the rule (`docs/developers/conventions-data.md`); 17 defects answered 500, or success for a
missing id (A394-1 to -6); all but A394-5's two, which still answer 500, are fixed; 16 owner
questions. The follow-ups and the rows:
`docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

## A913's fix items: general code English only

**Audit done 2026-10-20 on main `a3be14ba4`: [english-only-audit.md](english-only-audit.md).** The
owner answered points 2–8 on 2026-10-20 (the campaign's questions file has the words): 2, 4, 7 and 8
as recommended; 3, 5 and 6 in the owner's own words, recorded in
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only). Point 1
was A918; its decision is under "Decisions and deliberate limits" below. The items
below carry them out, one pull request each unless an item says otherwise. File and line references
are the audit's, taken on `a3be14ba4`; re-find them on current `main`. Every item follows the rule
for its own diff (grep it for non-English text before pushing — the guard does not read a file
listed in `scripts/english-only-still-to-clean.ts` line by line).

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
  The server split suites' comments and private bill/party helper bindings remain.
  Record and submission names also remain in server seed,
  snapshot and fiscal-identity suites; check protected fixtures and fiscal-provider contracts.
  Fixture strings remain separate from this naming work. Shared helpers' Spanish dish samples
  and their consumers stay with A976, as do the filing order-portion samples.
  Keep accented search fixtures unchanged. String-selected product keys stay with their fixture text
  under A976.
  Catalogue display names, seasonal venue and zone names and printer-screen display labels
  also stay with A976, along with counter-screen display text, station-screen display names,
  kitchen-ticket grouping, payment/queue widget display text, variant media fixtures and
  device/printer deletion fixture text.
  Low priority.
- **Setup receipt-language selection lookup.** `apps/setup/src/screens/venue-screen.ts` still
  treats an inherited property such as `constructor` as a language entry. Qualify the selection path with country-pack
  choices carrying such a code before changing it. Its reachability through an installed pack
  has not been established. `git blame` attributes the selection expression to `082553a65`.
- **A976 — remaining test-venue defaults.** Menu-period rule samples use English names.
  The shared bill and order venues use Anna, Administrator and Sophia for staff samples.
  The shared party venue uses Administrator, including station authorizer readbacks.
  Local receipt-language, receipt-guests, till-receipt, promotion-endpoint and till-reroute
  fixtures use English staff display names.
  The till-sale suite uses Main room, Administrator, Food and Drinks for local staff samples;
  its Spanish product names, customer wording and fiscal defaults remain.
  BillVenue uses Croquettes and Octopus as staff keys, with their matching selectors and
  readbacks; customer Croquetas de jamón / Pulpo a la gallega and kitchen CROQ / PULPO stay.
  Its Tarta, Caña and Paella keys remain, along with the other fixture work below.
  The nine local party suites use English table, party, course and printer samples; shared
  party-venue defaults, dish selectors and till-API samples remain.
  The filing order-portion suite still has Spanish dish samples. Shared helpers' dish names and selectors
  remain, including those read by the working-order, receipt-print and counter-portion suites.
  Native allergy, kitchen-note and bill-identity suites use English sample location names.
  The bill, party, boot, stream and clock fixtures
  listed in the [historical audit](english-only-audit.md#test-support-files-outside-testts)
  still need English defaults, as do the split-extras venue's operation description and the
  adjustment venue's legal name and operation description.
  Native provisioning and floor-plan-set route suites use English venue, operation and menu
  samples; their Spanish locale and starter-content checks remain.
  The adjustment venue (`apps/server/src/testing/adjustment-venue.ts`) now gives English
  customer-facing and kitchen names to its dishes and wine-glass variant, and English category,
  printer, device, location and administrator names. Its legal name and operation description
  remain; it keeps its street address, its es-ES locale, its reasons' Spanish translations, setup's default station
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
  creates, and the Spanish
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
  The error, alert, clearing, configuration-import and print-agent suites
  (`apps/server/src/errors.test.ts`, `apps/server/src/alerts-api.test.ts`,
  `apps/server/src/leave-for-clearing.test.ts`, `apps/server/src/configuration-import.test.ts` and
  `apps/server/src/print-agent-e2e.test.ts`) give English names to what they create. The alert,
  configuration-import and print-agent suites keep their es-ES locales; the alert and print-agent
  suites keep the operation description "Venta en establecimiento", the configuration-import
  suite its legal name, Madrid street addresses and the drink
  "Mojito", the errors suite its guest surname "Soler", and the clearing suite the Spanish names its
  shared party venue (`apps/server/src/testing/party-venue.ts`) creates.
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
  from `scripts/english-only-still-to-clean.ts`. UI switch behavior and accessibility
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
  and the operation description "Venta en establecimiento" its operation-description case reads from the fiscal package.
  Other helpers and screen fixtures remain.
  Keep existing behavioral assertions. Low priority.
- **Cloud cost-test fixture wording.** The separate Cloud repository's
  `scripts/cloud-cost/fixtures/remote-browser-backend.mjs` and `remote-waitron-backend.mjs` still
  carry Spanish operation and street examples. Translate those samples in a Cloud change; the
  Waitron fixture's wording change does not update those files.

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

- A malformed menu path id still answers 400 `shared.invalid_id` until A394-22, while the course
  route answers 404.

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

## A974. Finish the remaining English names in general code.

- **A974. Finish the remaining English names in general code.** Private person and dish bindings
  remain. Protected fiscal and receipt helpers still need their boundary audit.
  Split-suite comments, shared helper consumers and file names also remain.
  Private drink bindings remain in `sale-till-source.receipt.test.ts`,
  `issuance-pass.fiscal-identity.test.ts`, `list-unit-price.fiscal-identity.test.ts` and
  `served-at-huella.test.ts`; audit their fiscal fixture boundaries before renaming.
  Other record and submission names, including `registros` and `envios`, remain in server seed,
  provisioning, receipt, clock and fiscal-identity suites. Examples include
  `scripts/demo-seed/seed-sales.test.ts`, `src/provision.test.ts`, `src/orders-reprint.test.ts`,
  `src/sale-clock.test.ts` and `src/full-comp.fiscal-identity.test.ts` under `apps/server/`.
  Check protected golden fixtures and fiscal-provider contracts before changing those names.
  Keep accented search fixtures unchanged. Shared helper display samples and their consumers
  stay with A976.
  Other fixture text stays with A976, including catalogue
  display names, seasonal venue and zone names, printer-screen display
  labels, counter-screen display text and station-screen display names, plus kitchen-ticket grouping,
  payment/queue widget display text, the table-action suite's beer/cake display names,
  variant media fixtures and device/printer deletion fixture text.
  [Detail](architecture.md#a913s-fix-items-general-code-english-only). Low priority.

### A974 review assertion gaps

Qualify the no-sale assertions in `split-table.fiscal.test.ts`, in "the new bill holds no sale".
The 6 November naming review's attempts to issue every split bill, including a route-scoped
fully-paid bypass, left this case passing with no sale or record on the new bill. Those probes
did not reach a wrong-sale outcome, so they establish neither a product defect nor whether the existing no-sale assertions can catch one. Find a
control that creates an unwanted sale or record on the new bill and reaches those assertions,
while retaining the dish-name, sale-count, record-count and open-status checks.

## A976. Finish the server's English test-venue defaults.

- **A976. Finish the server's English test-venue defaults.**
  The VAT-class, issue-rate, line-transfer and move/merge filing suites use Administrator for their staff sample; their location and dish samples remain.
  Local invoice-correction and fiscal-sale route staff samples use Martha, Administrator, Cashier and Supervisor.
  Local workforce-export staff use Martha Canary, Colleague Green, Anna Admin and Lewis Manager;
  the adjustment-approval and box-email incident samples use Paul and Anna.
  Local session-person and recovery-page route fixtures use Anna for their staff display sample.
  The invoice-PDF download suite uses Martha for its manager sample and audit readback.
  The recovery-pack status suite uses Martha Green for its staff sample and name readback.
  The single- and multi-bill editor suites use Anna and Lewis as local staff samples.
  The `floor-today-*` route suites use Anna as their staff sample.
  Local course-retention, service-step, status, kitchen-note, allergy, today-join, course and party route fixtures use Anna for staff.
  The provision, setup-api.throwaway, promote-api.handover, break-glass-command and
  backup-api.settings-evidence suites use Administrator for their local administrator display-name samples.
  The setup-api and setup-api.throwaway suites use Anna Mary and Smith Green for their administrator real-name samples.
  The backup-api.route and mirror-bundle-api suites use English staff display-name samples.
  The cancel-invoiced-order and unpaid-departure suites use Sophia for their local supervisor samples.
  The device-equipment and device-levers suites use English staff display-name samples.
  Local floor-signal, pairing and till clock-state staff samples use Lucy, Anna and Lewis.
  The attendance-discovery, attendance-obligations, boot.mirror, boot.clock-watch and standalone tab-person suites use Anna and Martha for their main staff sample.
  Local till table, zone-layout, zone-required, split-bill, floor-catch-up and today-names suites use Anna for their staff-role person.
  The device-join suite uses Server and Manager for its local staff-role display samples.
  The main till API and profile-zone suites use Anna, Martha and Beatrice where present; local
  delivery, published-menu sale and unroutable-dish staff samples use Cashier.
  Local box-host, box-health, disk-stop and clock set/confirm route fixtures use Martha, Anna
  and Simon for their manager, administrator and supervisor samples; the clock suites' administrators remain Mario and Berta.
  Local alert, box-host call, attendance-fact, bill-editor transition, deferred-close and orders
  route fixtures use English staff display-name samples.
  Local portion-sale projection, station-queue and station-move staff samples use Anna and Lewis.
  Local adjustment-report staff use Lucy, Paul and Rose; `till-session.person` and box-alert-email samples use Anna.
  The own personal-data download (`me-api`) and box-health samples use Martha and Rose; stream-route and cross-person profile administrators use Administrator.
  Local personal-data export, staff-export, README and working-time record suites use Martha Lewis; the staff-export suite's administrator sample uses Anna Admin.
  The adjustment-download worked example uses Martha Lewis, Lewis Green, Paul Gray and Anna Smith;
  local reprint and restore-archive staff samples use Anna.
  The shared clock venue uses Anna for its staff sample and matching attendance, approver and profile-export checks.
  The shared signed-in-till venue uses Anna and Administrator for its staff display samples.
  The shared adjustment venue uses Anna and Martha for its staff and manager samples.
  Local `issuance-pass.test.ts`, `till-sale-tender-block.test.ts`, `sale-till-source.receipt.test.ts`,
  `served.test.ts`, `report-api.categories-reconcile.test.ts` and `demo-seed.db.test.ts` use English staff display names.
  The recovery-page personal-data suite uses Martha Lewis and George Hill as staff samples. Its Spanish venue legal-name, location and table-name samples remain.
  The shared boot provision-body and stream-pause fixtures use Administrator for their staff display sample.
  The catalogue include-folder, menu-patch and menu-schedule route suites use English staff display names.
  Other local and shared staff-name samples still need triage; preserve deliberate name and locale cases.
  Logger personal-name samples use English names, except the deliberate accented `Àngel` cases
  and short-email `ana@bo.es` sample;
  made-here and till-table supervisor display samples use English names.
  Location and dish samples remain in the issuance-pass and list-unit-price fiscal-identity,
  served-at-huella, split-bill fiscal and tabs filing suites.
  Remaining local venue seeds,
  including email and sale suites, the stream-loop/pause helpers and the boot
  helper's raw `Barra` locations should use `Main room`, as `setupVenue` does.
  Current-order, order-group, order-draft, served, certificate, backup-settings and backup-room
  fixture names use `Main room`; recovery-pack cover names stay unchanged.
  The local published-menu, menu-patch, current-order, integrated-sale, delivery,
  pay-and-dispatch and stuck-payment fixtures use Administrator; their location and category
  samples use Main room and Drinks where present.
  Other display samples in those files remain.
  The shared `setupVenue` uses Administrator,
  Drinks, Coffee and Water; BillVenue uses Steak, Red wine bottle, House salad, Croquettes
  and Octopus as staff keys, with Spanish customer and kitchen names unchanged. Tarta,
  Caña, Paella and its other labels remain. PartyVenue uses Red wine bottle and Water as
  staff keys, retaining customer Rioja crianza / Agua mineral, kitchen TINTO / AGUA and the
  independent recorded Vino.
  The main till API and table-route fixtures use Daily menu and Drinks for menu/category labels;
  their Spanish product samples (Agua mineral in both, Cerveza in the till API) remain.
  Local draft, party-seating, zone-refusal, tab, split-bill and move/merge fixtures use Daily menu
  for menus and Drinks or Dishes for renamed categories; the tab suite's category stays ES drinks.
  Other display samples in those files remain.
  The till API modifier fixture uses Cheese, Preparation, Cold and Hot for distinct staff
  names; the till-sale size option uses Size and Large. Their customer and kitchen wording stays.
  Local party-suite table, party,
  course and printer samples use English. Shared dish samples remain in their helpers and
  consumers, including `party-bill-actions.test.ts`, `party-move-bill.test.ts`,
  `party-arriving-dishes.test.ts` and `receipt-guests.test.ts`. Spanish display samples remain in
  `order-portions.filing.test.ts`,
  `till-api.move-bill.test.ts`, `till-api.groups.test.ts` and `till-api.fiscal-sale-paths.test.ts`;
  other shared-helper samples and their consumers' dish selectors also remain. These belong to
  A976 rather than the private-name work in A974. The `made-here.routes.test.ts` venue
  samples and `receipt-document.test.ts` fixture descriptions and test titles also need
  triage there; preserve Spanish receipt output and deliberate locale checks. Fiscal-sale
  descriptions also retain Spanish words. The fiscal-sale
  suite’s string-selected SQL count alias stays with its fixture text. Bookings’ native suites use English
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
  creates, and the Spanish
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
  The error, alert, clearing, configuration-import and print-agent suites
  (`apps/server/src/errors.test.ts`, `apps/server/src/alerts-api.test.ts`,
  `apps/server/src/leave-for-clearing.test.ts`, `apps/server/src/configuration-import.test.ts` and
  `apps/server/src/print-agent-e2e.test.ts`) give English names to what they create. The alert,
  configuration-import and print-agent suites keep their es-ES locales; the alert and print-agent
  suites keep the operation description "Venta en establecimiento", the configuration-import
  suite its legal name, Madrid street addresses and the drink
  "Mojito", the errors suite its guest surname "Soler", and the clearing suite the Spanish names its
  shared party venue (`apps/server/src/testing/party-venue.ts`) creates.
  The venue-service menu-timetable suite (`packages/venue-service/src/menu-timetable.test.ts`)
  still keys and names its menus in Spanish (Desayunos, Almuerzo, Cena, Bebidas, Café, Cócteles,
  Copas, "Deli para llevar") and uses "Sala" and "Terraza".
  The server's adjustment venue gives English customer-facing and kitchen dish names and English
  category, printer, device, location and administrator names; its locale, street address,
  reasons' Spanish translations and setup's default station "Cocina" stay, and its legal name
  and operation description remain.
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
  and the operation description "Venta en establecimiento" its operation-description case reads from the fiscal package.
  Group-route and course-deletion service-step suites use English names for their own courses.
  The printer-test-page suite uses an English printer sample and retains its bilingual words
  and accented-character checks.
  Payment-slip table labels and print-preview plain samples use English; translated receipt
  wording and accented-character samples remain.
  Native server floor-annotation and kitchen/floor read-model suites use English location,
  operation, station, table and contact samples; their Spanish locale keys remain.
  Other helpers and screen expectations remain.
  Continue package by package from `scripts/english-only-still-to-clean.ts`; keep accent-sensitive
  combobox searches and filename samples, deliberate multilingual metadata and printing’s accented
  glyph cases. Preserve text lengths when translating remaining printing samples. Low priority.
  [Detail](architecture.md#a913s-fix-items-general-code-english-only)
  BillVenue's receipt printer, card readers and cash till use English display names.
  Local device-equipment and office-printer route fixtures use English printer and reader names;
  their shared BillVenue device names and venue/operation samples remain.

## A1308. Rationalise the tables, background jobs, environment variables and files

- **A1308. Rationalise the tables, background jobs, environment variables and files** (owner,
  2026-11-02: "over engineered and disjunct … each bit has been designed in isolation"). The
  [design](../superpowers/specs/2026-11-02-rationalisation/README.md) is written. The owner has
  reviewed every file and answered every question (2026-11-04), and approved it the same day.
  [Slice 0](../superpowers/plans/2026-11-04-a1308-slice-0-bench.md)'s protection list is built;
  [the testing guide](../developers/testing-guide.md#the-protection-list) says how each slice uses
  it. Its bench is built too ([how to use it](../developers/testing-guide.md#the-bench)); it runs
  from time to time, not per slice (owner, 2026-11-10;
  [when](../developers/testing-guide.md#when-the-bench-runs)). Next is
  [the build order](../superpowers/plans/2026-11-08-a1308-build-order.md).
  **Open:** the design does not cover A790's six tables, A802's eleven or A739's; each later slice
  must fold in the ones it touches. 246 tables become 145, or 144 once A1323 removes
  `recovery_packs`, in eight migration sets instead of sixteen. The job runner is built with scheduled
  menu activation, the sealed-key copy and public `/health` reports. The bucket copy runs as a
  service; close stops runner jobs first and the bucket copy last.
  [A1279](replication-cloud.md#a1279-a-local-secondary-promotes-only-over-a-chart-it-signed-itself) owns immediate role wiring and the real promotion test, including a mirror, if its live-promotion path gains a production caller. Codex attached this to A1279 after the watcher deferred immediate wiring on 2026-11-11 at 05:18.
  The six watches (append-only protections, clock, free space, Cloud connection, translation
  suggestions and practice printing) also run there. Repeated thrown passes raise one dashboard
  alert per job after ten minutes and three failures; the manager’s box-status read includes the
  complete job views. The remaining jobs still need moving onto the runner.
  Kitchen tickets now read their bill through the order line, with no copied bill id to update on a move.
  Floor splits now check the parties the till read, separately from the room layout revision;
  saved joined designs form ordinary live groups. Zones now carry their department and sale overrides;
  saved designs now carry membership, placements retain off-layout sizes, and sets carry their
  department, name and default. Today's map now lives on the live table and zone rows;
  merge membership and its before-place values now live there too, with group names and seats
  in `table_merges`. Today-only table and room updates now use narrower
  notifications for the floor, kitchen and their dashboard readers. Transfers and the menu's zone
  status keep their existing 15-second polls for these updates (watcher, 2026-11-13).
  Management and device events share one loop with read-only wake checks; device events carry types
  only. The dashboard detects a silent connection, quiets audited database-only re-read timers
  while connected and receives pairing, discovery, practice-inbox and backup state changes.
  Reads that depend on time, memory or external services keep their timers.
  Tills use the device stream for menu, equipment, floor, transfer and table-allergy refreshes;
  transfers retain their access timer to notice ended sessions, and payment-owned equipment changes
  retain their timed refresh so the connection also works with payments disabled;
  station, pass, clocking and receipt-delivery reads also refresh on changes while keeping their
  clock-dependent timers. The open bill draft refreshes on changes and quiets its row-based timer
  while connected. Clocking interests are present only when clocking is available.
  A one-box till pauses primary-server probes while its
  device connection is ready and the last probe found a primary, resuming immediately when it drops;
  lists with more than one box keep probing and handing on membership charts.
  The print agent waits on held requests for receipt and office-print work. Drawer expiry and
  claim leases shorten that wait; pending page work and discovery retain their two-second cadence.
  Handhelds and kitchen displays keep timed reads under
  jr11's measured fallback. Before go-live, qualify silence recovery with a physical power cut;
  jr13's SIGSTOP probe is a stand-in only. 111 product
  environment variables become 51. Duplicate address names are merged, the print agent uses its host name,
  and host-script and full-disk tests use shared roots. The remaining environment slices stay open.
  There is one state-folder layout, and a box keeps its venue under that state folder.
  A first setup has no venue claim or separate setup lock; its record and attachments live
  in `flows/setup/`. The attempt, initial node-key verifier, public evidence and recovery-document
  metadata share one record. A completed setup folder ends after the trading start stays up for
  two minutes; unknown top-level files and nested attachment folders are kept, and a refused cleanup
  is logged without stopping the start. Start again removes its listed files and then the empty folders,
  and sets unknown files aside under the state folder. The box certificate and key
  share one PEM file, and a completed certificate repair ends after a start stays healthy. It keeps
  the second-box path that A947 and the landed A1018 handover slices build on (adoption, the mirror
  link, the pinned main-box key, the handover tables) and removes only the standby's reserved identity
  (`fiscal_reservations`). It removes recipes (owner, 2026-11-04). The owner chose that A760's squash
  runs first, merged into the eight sets. It absorbs A1301's schema slices (S20–S28);
  S23 builds no `venue_settings`, because the venue's settings become documents in the shared
  `settings` table. It also renames every leftover "tenant" name: the `tenants` table becomes
  `taxpayer`, and names that mean the venue or box get that name (owner, 2026-11-02; design §5 U9).

## A1301. Remove the "location" concept: the venue holds everything a location held

- **A1301. Remove the "location" concept: the venue holds everything a location held** (owner,
  2026-11-01, high priority; nothing new is built on locations meanwhile). The design is written and
  reviewed: its settings move to the `settings.venue` and `settings.business_day` documents (A1308,
  owner, 2026-11-04), and the work is cut into
  slices S1–S28 and fixture slices F1–F5, eight of them landed by the owner. The owner answered
  every design question (lane B's A1268 does the working-time hashes; the working-time export names
  the venue only). The build plan covers S1–S12, S16, S17 and F1–F5; the watcher hands out its
  slices. Still open: 5g and 5h of A1308's slice 5.
  `@waitron/db`'s `readVenue`, `readVenueClock`, `readVenueClockAndPlace` and the interim
  `venueLocationId` are on main for the remaining consumer slices (S1, #2379).
  `@waitron/db/testing/seed.js` has `seedVenue`, `seedVenueSettings`, `seedBusinessDay` and `seedWorkingOrder`.
  S18 is planned in six sub-slices
  ([S18 plan](../superpowers/plans/2026-11-04-a1301-s18-contract-cleanup.md)). S18c (#2443),
  S18a (#2447), S18b (#2450), S18d (#2451, #2453) and S18f (#2467) have landed. The owner decided on 2026-11-02 what the venue id sent to Cloud and naming the backup
  folder becomes: Cloud assigns the id, and a box not connected to Cloud backs up where its owner
  says. The owner approved the [venue-id design](../superpowers/specs/2026-11-04-a1301-venue-id-design.md)
  that writes this up, with its defaults, on 2026-11-04. S18e builds it, and is held by A1308: it
  adds a table, and no lane starts table work until A760's squash lands. S18f did not wait for
  S18e: the owner chose the plan's cheaper schedule, so the places that need the old id read it
  from one temporary function until S18e replaces it. The schema slices S20–S28 get a plan of their own.

  What the landed slices left, by owner:

  - **S18:** S18e, held by A1308 (above). Two test helpers still hand out a node value
    holding the venue row's id, because test files read it from there: `hour-recovery-host.ts`'s
    `node` and `staged-hour-crash.ts`'s (an assertion in
    `restore-emergency-crash.e2e.test.ts`) (S18f).
  - **The schema slices S20–S28:** the schema changes remain for S20–S28 (S3, #2387).
    Calendar rows still written
    with a `location_id` take `venueLocationId` (S8, #2405). The export no longer carries
    `fire_control`, whose column goes with `locations` in S28 rather than in A773-2, since dropping
    it alone rebuilds `locations` (S17, #2415; A773-2 PR D plan D113). S28 also deletes the tests
    that still set it, listed in D113 and in [kitchen.md](kitchen.md). Server test helpers take the venue row's
    id through the test type `WithVenueRowId` (`apps/server/src/testing/venue-row-id.ts`), which
    stays in fixtures that still read the venue row, including node, Cloud, backup, kitchen-setting
    and menu-name fixtures. Until `venueLocationId` goes, boot takes the venue row's id for the
    bucket stream, its recovery kit and the Cloud connection; 5g removes those uses.
    The `locationId` brand remains in `packages/shared/src/ids.ts` (S18f).
  - **Fixture lines the helpers could not take:** F5 (#2403), F2 (#2410) and F4 (#2412) list the
    lines they left (fixed ids the helpers cannot keep, second-location cases and standby copies)
    with their owning slice in their commit messages and PR bodies; F3 (#2427) lists its lines
    with the reason each was left. fiscal-verifactu's own helpers and the tests outside F2's list
    (`certificate-install`, `seed-single-venue`, `void-issue-clock`) are S3's. Left as they were
    by F4: rows written under fixed ids that a backup, archive, `trading.env` or assertion names
    (most `recovery*` and `restore*` suites, `hour-promotion`, `hour-recovery`,
    `rebuild-first-start`, `promote-endpoint-e2e`), devices planted under
    a join request's id, cases needing no taxpayer row (`reset-request`), and second-location
    cases whose code slice deletes them.
    Left as they were by F3: venue and node rows under fixed ids that a boot env, `trading.env`,
    adoption, promotion, mirror or break-glass key names (the `boot.*` suites the F3c
    commit lists,
    `adoption-allocation-refusal`, `allocated-standby-host`, `backup-data-placement`,
    `backup-verification`, `first-fiscal-mode`), a raw insert on `backup-verification-compatibility`'s
    fixture-migrated copy, devices sharing one token hash (`device-session`), a case needing no
    taxpayer row (`department-receipt-languages`), and second-location cases whose code slice
    deletes them (`alerts-api`, `boot.test`, `device-api.pass`).

  [Design](../superpowers/specs/2026-11-01-a1301-remove-location-design.md),
  [plan](../superpowers/plans/2026-11-01-a1301-remove-location.md),
  [working-time plan](../superpowers/plans/2026-11-02-a1301-working-time-slices.md)

## Bundle: Small checks and indexes that are cheap only inside A1308's fresh tables

15 entries, size M.
Where each lands: the A1308 slice named in the design's "Lands in" column
([Additions of 6 November 2026](../superpowers/specs/2026-11-02-rationalisation/README.md#additions-of-6-november-2026)).

- **The `media_images` filename CHECK accepts a name with an embedded NUL**: the review stored 64
  hex characters, `.png`, a NUL and `evil` (73 bytes) on `node:sqlite`, because `substr` stops at
  the NUL; closing it needs a migration. Found by #609 (`packages/media`), not fixable in a
  comments-only change.
- **A negative catalogue price can still be stored by a direct call** — OPEN (left by #487).
  [Detail](catalogue.md#a-negative-catalogue-price-can-still-be-stored-by-a-direct-call)
- **Loose ends left by A322 (#1372, an included menu can show its sections directly).** A folder's
  fixed photo shows on the till only in Thumbnails mode, as a section's photo does.
  [Detail](catalogue.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)
- **Loose ends left by A263 (#1151)** — OPEN, unqueued.
  [Detail](catalogue.md#what-1151-left-open-2026-10-03)
- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's parser refuses a blank; `option_lists.name`, `option_labels.name` and
  `extra_lists.name` share the pattern (`packages/db/drizzle/0000_baseline.sql`). **Next
  action:** decide whether the columns want a check constraint and the write paths a domain refusal.
- **A1368. A dish waiting for the pass whose HOLD ticket printed, moved to the counter, still gets no MOVED line and no FIRE mark (left open by A1327, #2502).** At the counter the dish
  leaves its group, and the record of HOLD paper is kept per group. The fix proposed is a per-dish
  record: a schema change, held by A1308 until A760 lands. The owner chose to fix it there
  (2026-11-06): a cook is not left with two tickets for one dish.
  [Detail](kitchen.md#a1368-a-dish-waiting-for-the-pass-whose-hold-ticket-printed-moved-to-the-counter-still-gets-no-moved-line-and-no-fire-mark)
- **`envio_flujo`: decide the remaining DELETE restriction (A805 follow-up).**
- **`envios`: decide the remaining DELETE restriction (A805 follow-up).**
- **`invoice_series`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
- **`payments`: decide the remaining DELETE restriction (A805 follow-up).**
- **`registro_sif`: decide the remaining DELETE restriction (A805 follow-up).**
- Retry spacing is the agent's batch interval rather than a per-job backoff, so a flapping printer
  burns `MAX_DELIVERY_ATTEMPTS` at loop speed — needs a next-attempt column.
- **Passkey name column after A760:** A403 keeps the column under the schema hold; new registrations
  use the detected password manager. Decide whether to remove it after the hold.
  [Detail](dashboard.md#passkey-name-column-after-a760)
- **Finish the remaining person-id foreign keys and `order_draft_lines.menu_item_id`.**
  Columns still marked "No key yet" need keys as A1308 rewrites their starting migrations
  (CLAUDE.md §3: declare every foreign key). Their old reason — `persons` lived in another
  migration set — ended when A760 moved it into core.
- **A print job's payload sits ahead of its status columns.** `print_jobs.payload` averaged 20 KB
  on the bench's first full year (built 2026-11-06, since rebuilt), so any walk over print-job rows reads about five pages a job (the table was
  8 GB of the 12 GB year), and the printers-down check (`stationPrintersDownQuery` in
  `apps/server/src/station-outputs-down.ts`) groups over every stuck job of a printer. It matters
  only with many stuck jobs. Put the payload after the columns reads filter on.

## What A1308 retires

These entries stay open until the A1308 or A760 slice that removes the need for them lands (backlog review, 2026-11-06). The slice that does so deletes them here. If a slice changes course, its entry goes back to the index.

- **Repeated allergen kinds from direct callers.** The allergen validator accepts, for example,
  `{ gluten: { kinds: ["wheat", "wheat"] } }`; the dashboard picker and published derivation remove
  repeats. A668-1's Claude probe recorded that result. A1308's one allergen column normalises them
  on write. Decide whether direct declarations should be refused instead, then check product requests
  with repeated kinds.
- **Catalogue names (W72): there is no unique index, and no backfill.**
  [Detail](catalogue.md#catalogue-no-two-categories-with-one-parent-and-no-two-active-products-share-a-name-w72-to-w72h-left-open)
- **Two signals say whether a dish is sold by weight, and they can disagree in storage.** Since B4
  the order path reads only the unit (`priceOrderLines`), so no sale reads `products.pricing_unit`.
  **Next action:** keep it in step with the unit or drop it.
  [Detail](catalogue.md#two-signals-say-whether-a-dish-is-sold-by-weight-and-they-can-disagree-in-storage)
- **The catalogue picker was deleted and nothing replaced it.** `selectedCatalogueId`
  (`catalogue-screen.ts`) takes the first catalogue in the list, which is also the one every new
  product is created in; with two, the second becomes unreachable from the dashboard. **Next
  action:** decide whether more than one catalogue is a case Waitron supports.
- **A backup setting in `trading.env` or `secrets.env` is not compared at a handover.** Only a hand
  edit puts one there (the writers read, not run). Two such boxes pass and can differ in a hidden recovery key. Left open by A1018 Slice 5 (Ruling R21).
- **If a later slice moves `local` tables into `node.db`**, that slice decides again how the drain
  crosses the two files: SQLite refuses a trigger body that writes another attached database. A947
  slice 3a moved five tables with no change-log triggers; the question stays for `change_log`.
  [Detail](replication-cloud.md#if-a-later-slice-moves-local-tables-into-nodedb)
- **The `authorized_by` comment on `drawer_opens` says only a manual open sets it**
  [Detail](architecture.md#the-authorized_by-comment-on-drawer_opens-says-only-a-manual-open-sets-it)
- **`cadenas`: decide the remaining DELETE restriction (A805 follow-up).**
- **`daily_close_chain`: decide the remaining DELETE restriction (A805 follow-up).**
- **`drawer_opens`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
- **`locations`: decide the remaining DELETE restriction (A805 follow-up).**
- **`media_image_data`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
- **`payment_refunds`: decide the remaining DELETE restriction (A805 follow-up).**
- **`workforce_chains`: decide the remaining DELETE restriction (A805 follow-up).**
- **`working_order_counters`: decide the remaining DELETE restriction (A805 follow-up).**
- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1** — left behind
  by the tenant-column removal (#378, 2026-09-16).
  [Detail](architecture.md#drainresulttenantswithwork-is-named-for-a-count-that-can-now-only-be-0-or-1)
- **A department's receipt logo save re-checks only the image's revision, not its id** — found in
  A841 slice 7's review, read, not run.
  [Detail](printers.md#a-departments-receipt-logo-save-re-checks-only-the-images-revision-not-its-id)
- **A copied department receipt that names `logo` twice, or once more as `"logo\u0000"`, may split
  its two readers** — believed from A841 slice 7's review, not run through a receipt.
  [Detail](printers.md#a-copied-department-receipt-that-names-logo-twice-or-once-more-as-logou0000-may-split-its-two-readers)
- **Left open by #1261's review (W111):** database enforcement of logo retention remains open.
  A theme's logo (A841 slice 7) is a second image whose deletion only the app refuses; this entry
  covers it too.
  [Detail](printers.md#left-open-by-1261s-review-not-acted-on-2026-10-05)
- **Drop `printers.ticket_scope` at the next reset — OPEN (3d, W20).** — left open by the product
  folders work. Printing no longer reads the column. Dropping it rebuilds `printers`, so leave it
  until the venue reset that permits the rebuild.
- **`clock_stop_restarts` is written by nothing: drop it, and its two backup-check links, when
  A1308 rewrites the starting migrations.**
  [Detail](box.md#clock_stop_restarts-is-written-by-nothing-drop-it-and-its-two-backup-check-links-when-a1308-rewrites-the-starting-migrations)
- **A person row written from outside `packages/identity` still folds its key ASCII-only** — OPEN.
  [Detail](dashboard.md#a-person-row-written-from-outside-packagesidentity-still-folds-its-key-ascii-only)
- **Task 1b** (#554, session cookies stored only as hashes).
  [Detail](dashboard.md#task-1b-554-session-cookies-stored-only-as-hashes)
- `service_commands` rows are never pruned. Left open by service Task 2 (#715, a record per seated
  party).
- **The upgrade walk's historical runtime variation remains unexplained after reducing setup work (A736, [#1788](https://github.com/clintongormley/waitron/pull/1788)).**
  [Detail](ci.md#the-upgrade-walks-historical-runtime-variation-remains-unexplained-after-reducing-setup-work-a736-1788).
- **Task 2's review found no test that fails when `device_profile_admission_roles` is left out of `apps/server/src/testing/clear-provision-fixture.ts`** (read, not run).
  [Detail](ci.md#task-2s-review-found-no-test-that-fails-when-device_profile_admission_roles-is-left-out-of-appsserversrctestingclear-provision-fixturets).

## Bundle: Query plans and indexes, measured on a year of data

4 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Index the dishes not yet fired, so the pass's reads stop scanning every ticket item ever kept
  (left open by A773-2 PR C's review).** This needs a migration.
  [Detail](till.md#index-the-dishes-not-yet-fired-so-the-passs-reads-stop-scanning-every-ticket-item-ever-kept-left-open-by-a773-2-pr-cs-review)
- **Index the uncollected, non-abandoned bill lookup in A1308's orders slice (A1370 follow-up).** The station
  queue now reads tickets by uncollected, non-abandoned bill, but finding those bills still scans
  `working_orders`. Add the partial index once the table-change hold ends.
- **Measure the remaining top-level-dish reads (A1370 follow-up).** Check `parent_line_id is null`
  reads across the server and venue-service, including `listOrderGroups`, `working-order`,
  `move-bill`, `finish-party-service` and `party-allergy`. Measure their plans with history.
- **Decide how kitchen queues order bills tied on time (A1370 follow-up).** The queue sorts by
  ticket `queued_at` and line number; different query plans can reorder bills tied on both.
  Check whether a product path produces those ties before choosing a stable tie-breaker.


## Bundle: Full-invoice recipient: comma refusal and country code names

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Full-invoice locality/province commas.** Align the till's structured address checks and
  the server's Spanish completeness rule, and put a refusal under the field that needs changing.
  A locality or province containing a comma currently passes the till check and is refused as a
  street-address error. [Detail](architecture.md#a913s-fix-items-general-code-english-only)
- **Name special invoice-document issuing codes.** Both recipient dialogs currently show
  `QU`, `XB`, `XG`, `XN` and `XU` as bare codes. Add sourced English/Spanish labels without
  treating them as postal countries. [Detail](architecture.md#a913s-fix-items-general-code-english-only)

## Bundle: Correct every sentence known to be false, then finish comment pruning

26 entries, size M.

- **`writeItems` and `writeLabels` each keep a refusal after their insert that looks unreachable
  now** — OPEN (found by #603). Read only, not run: `writeItems` (`packages/catalogue/src/extras.ts`)
  and `writeLabels` (`src/options.ts`); duplicate and foreign ids are refused earlier and one write
  runs at a time.
- **`MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this
  engine** — OPEN (found by #603). Read only, not run: both were PostgreSQL's integer maximum.
  [Detail](catalogue.md#max_modifier_integer-and-the-extras-contracts-whole-bound-have-no-stated-reason-on-this-engine)
- **`assertRefsExist` still reads lists in sorted key order** — OPEN (found by #603). Read only, not
  run: that order (`packages/catalogue/src/product-modifiers.ts`) served PostgreSQL's lock ordering
  only.
- **Three configuration-transfer cases pin an insert order the importer's `pragma defer_foreign_keys`
  may make unnecessary for foreign keys** — OPEN (found by #603). Read only, not run: in
  `packages/catalogue`'s `options.test.ts`, `product-modifiers.test.ts` and `extras.test.ts`;
  whether to keep pinning it is the owner's call.
- **Test titles in `packages/catalogue` a comments-only change cannot touch** — OPEN (found by
  #603). Four titles, in `dietary.test.ts`, `product-modifiers.test.ts` and `migrations.test.ts`.
  [Detail](catalogue.md#test-titles-in-packagescatalogue-a-comments-only-change-cannot-touch)
- **A test comment still names the old savepoint error.**
  `packages/fiscal-verifactu/src/correction-path.e2e.test.ts:308` says its control "fails with
  `no such savepoint`"; since #1936 that text is only the error's cause, not its message. Reword
  the comment (a comment in a fiscal test, not the fiscal core).
- **start-space.ts's `logDir: null` option is dead since A1042**; removing it deletes an existing case, so the owner approves the removal. [Detail](box.md#start-spacetss-logdir-null-option-is-dead-since-a1042)
- **Server comment pruning notes** — found by
  #656 while pruning comments. No production caller sets `skipSecrets` any more, so whether the
  option should go is open.
  [Detail](box.md#server-comment-pruning-notes)

- **The empty-venue-directory reason #561 deleted from `packages/provisioning` … is false there**
  [Detail](box.md#the-empty-venue-directory-reason-561-deleted-from-packagesprovisioning--is-false-there)
- **`packages/provisioning/README.md` also says only `ES-common` is implemented** — found by #561
  while pruning comments.
  [Detail](box.md#packagesprovisioningreadmemd-also-says-only-es-common-is-implemented)
- **`packages/provisioning` code found by #561 and not changed.** The coverage config leaves
  `src/bin.ts` out with no reason stated any more, which may hide code a test could reach.
  [Detail](box.md#packagesprovisioning-code-found-by-561-and-not-changed)
- **Loose ends left by the comment-pruning pull requests (#559 to #624).**
  [Detail](ci.md#loose-ends-left-by-the-comment-pruning-pull-requests-559-to-624).
- **Comments and docs still name drizzle-orm 0.45.2 and 0.45.3; 0.45.4 is installed** — OPEN.
  [Detail](dependencies.md#comments-and-docs-still-name-drizzle-orm-0452-and-0453-0454-is-installed)
- **Fiscal source comments still describe the migration sets A760 retired.**
  `packages/fiscal-verifactu/src/schema/clock-confirmations.ts:46`, `clock-stop-restarts.ts:16` and
  `filing-cases.ts:60` say `persons` is in identity's own set (it is in core's since A760);
  `clock-stop-restarts.ts:6` says A760 will drop that table (A760 changed no table's shape); and
  `src/drain.ts`'s `codeOf` comment names `@waitron/scheduler`, now part of `@waitron/payments`. A760
  left
  them because fiscal source stays unedited in that change; fix them in the next fiscal change.
- **Remove the stale till description beside the device-delete preview fixture.**
  `apps/dashboard/src/screens/devices-screen.test.ts:6005` calls the fixture a till, while
  its `d1` row is a kitchen display (`kind: "kds_station"`). Remove that comment in the next
  comment-cleanup pass.
- **The order-line schema's variant-name comment mistakes missing customer text for a null map.**
  `packages/db/src/schema/orders.ts` says `variantDescriptions` is null when the variant has no
  customer name. The existing working-order case "names a variant line with no customer or kitchen
  name" instead reads its frozen staff-name map. Left open by A612; remove the misleading comment.
- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  [Detail](architecture.md#prune-the-comments-one-package-per-pull-request)
- **`apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
  condition by construction"**
  [Detail](architecture.md#appsserverreadmemd-near-line-496-still-says-an-error-line-and-a-503-are-the-same-condition-by-construction)
- **`working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same live-course
  definition; `fireCourse` calls `requireCourse`**
  [Detail](architecture.md#working-orderts-near-requirelivecourse-says-the-fire-verbs-use-the-same-live-course-definition-firecourse-calls-requirecourse)
- **Pointers outside `docs/` that #597 made stale**
  [Detail](architecture.md#pointers-outside-docs-that-597-made-stale)
- **"Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)" … is too
  wide** — found by #567 while pruning comments. The same claim stands in
  `packages/fiscal-verifactu/src/venue-fields.ts`.
  [Detail](architecture.md#nothing-under-apps-may-import-a-regime-package-scriptsmodule-seamstestts--is-too-wide)
- **Nothing now checks at run time that a read returns something other than a Node `Buffer`**
  [Detail](architecture.md#nothing-now-checks-at-run-time-that-a-read-returns-something-other-than-a-node-buffer)
- **The nested `tx.transaction(...)` in `enqueueSuccessor` wraps one insert**
  [Detail](architecture.md#the-nested-txtransaction-in-enqueuesuccessor-wraps-one-insert)
- **`decimalToCents` refuses an amount over the bound (#583), but `centsToDecimal` itself has no
  digit bound**
  [Detail](architecture.md#decimaltocents-refuses-an-amount-over-the-bound-583-but-centstodecimal-itself-has-no-digit-bound)
- **Comments and test titles still cite sections of specs that were deleted** — OPEN (2026-09-26).
  **Next action:** fold into the comment-pruning sweeps: re-point each to
  the pull request that built the work, or drop the tag.
  [Detail](architecture.md#comments-and-test-titles-still-cite-sections-of-specs-that-were-deleted)
- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce.**
  [Detail](architecture.md#comments-still-describe-a-drizzlequeryerror-wrapper-that-this-engine-does-not-produce)

## Bundle: Remove code nothing reaches (replaced or dead, never merely unused)

1 entry, size S.

- **Unread configuration parameters remain in `apps/server/src`.** Test helpers still use
  `void cfg;` (`git grep -n 'void cfg;' apps/server/src`); `setLineCourse` and
  `readTransactionReceipt` retain `_cfg` in their signatures, among others
  (`git grep -n '_cfg:' apps/server/src`). Left open by SQLite slice 1
  (#490 and the preparation tasks) and A1308 5f-ii's five-function scope. Size on 2026-11-14 for
  the five most-called of the eight, counted as matches of `<name>(` in `apps/server/src`
  (declarations and same-named test wrappers included): `offerProducts` 284, `createTable` 187,
  `defaultLayout` 68, `readDrafts` 49, `setLineCourse` 20, mostly in tests, plus 11 `void cfg;`
  lines.

## Bundle: Recovery wording into `i18n`, with table names to match

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The Start again choice's words move into `apps/server/src/i18n/`.** `START_AGAIN_PAGE_TEXT`
  (`apps/server/src/recovery-start-again.ts`) is the last recovery-page wording outside `i18n/`.
  It stays a table of its own, apart from `OPERATOR_TEXT`, and must load without the database.
- **The recovery page's tables keep their old names.** `OPERATOR_TEXT`, `GENERIC_TEXT` and
  `OperatorText` in `apps/server/src/i18n/recovery-page.ts` do not end in `_WORDS` like the
  folder's other tables, and `recovery-surface.ts` passes them on so A968 (#2419) left every test
  unedited. Renaming them means changing the importing tests too.

## Bundle: Printer, reader and device delete wording and tidying

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by A435's printer, reader and device delete (steps 2 to 4).**
  [Detail](architecture.md#loose-ends-left-by-a435s-printer-reader-and-device-delete-steps-2-to-4).
- **Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519).**
  [Detail](architecture.md#loose-ends-left-by-a435-steps-3-3b-and-4-1520-1524-1519)

## Decisions and deliberate limits

**Three till refusals keep their statuses (A394-9, owner 2026-11-10: "Leave them, write it down (Rec.)").**
On the till, `service_zone.not_found`, `table.not_found`/`table.inactive` and `reader.not_found`
answer as they did before A394, a deliberate exception to the one-status-rule in
[conventions-data.md](../developers/conventions-data.md): each is raised in more than one of the
rule's situations (the address names it, the form names it, or a stored row does), so following
the rule would need a new refusal for each situation; no screen reads the number, and every screen
acts on the refusal's name. The trace is in the A394 plan, under A394-9.

**No runtime planner statistics (A1469, watcher, 2026-11-10).** A box does not gather SQLite's
planner statistics (`ANALYZE` or `PRAGMA optimize`). On the bench's year of trading (days
361–362, with the `order_groups(number_party_id)` index), a whole day took 0.35 s a bill with no
statistics, 1.63 s with them, and 0.48 s with them plus three partial indexes; even then the filing pass's two reads of
waiting records still took 29 s each. Instead of statistics, a read that picks a worse index
without them names its index with `indexed by`: the two reads of `payments` by working order
(A1469), and the four filed-record reads of A1471 (#2711). Commands and result files: #2704 (with
and without statistics) and the A1469 payments PR (the partial indexes). Those figures were taken on
the bench server. On 10 November 2026 it and the box image's base, `node:26-slim` (a floating tag),
both ran Node v26.13.0 with SQLite 3.54.0 built without `ENABLE_STAT4`, so `ANALYZE` gathers only
`sqlite_stat1` there and the figures compare like with like (the command is in
[testing-guide.md](../developers/testing-guide.md#the-bench), under "Which Node and SQLite made a
result"). On a build with STAT4 (Homebrew's Node on macOS), the watcher's scratch test that day,
not kept, read a synthetic 360,000-row order-lines table by
`order_id = ? or parent_line_id in (select id … where order_id = ?)`: with no statistics it used
both indexes, and with `sqlite_stat1`, alone or with `sqlite_stat4`, it read the whole table.
Neither the reads named above nor a read filtering on a fixed value was tested.

With all three fixes (the `order_groups` index, the payments reads and A1471's filed-record reads),
days 361–365 of the year were traded again on 10 November 2026 with no statistics (A1474), at a
scratch commit: the bench's commit `8456ac2059` with #2715's and #2711's read changes applied and
the index created on the year copy by hand, since main's schema no longer opens that year. The empty venue's five days ran at the same scratch
commit; the before column is the run of that morning at `8456ac2059`. Median of the five days'
medians, in ms:

| Request                                   | Empty venue | Year, before the fixes | Year, with them |
| ----------------------------------------- | ----------: | ---------------------: | --------------: |
| `POST /api/pay`                           |        15.8 |                  157.8 |            16.2 |
| `POST /api/working-orders/:id/payments`   |        16.9 |                   78.6 |            17.2 |
| `POST /api/working-orders/:id/collect`    |        13.5 |                   74.0 |            13.8 |
| `PUT /api/parties/:id/allergy`            |         4.5 |                   60.5 |             4.2 |
| `POST /api/parties/:id/drafts/:id/submit` |        19.5 |                   49.8 |            19.3 |
| `POST /api/parties/:id/groups/:id/fire`   |        10.0 |                   39.8 |             9.9 |

All six are back to empty-venue speed. A day took 0.188 s a bill empty, 0.489 before the fixes and
0.249 with them; 0.024 of that is the bench's own end-of-day copy of the database, which a venue
does not make. Of the remaining 0.037 s a bill, half is in requests, mostly the print agent's job
claim (0.9 to 1.6 ms, 1.9 s a day) and the kitchen's ticket advance (1.1 s a day, in its slower
calls, not its median), and half is outside the timed requests; neither was traced to a statement.
Commands and per-day figures: the A1474 PR (#2729).

- **Official holiday names and English display names (A971, owner 2026-10-23).** Keep the published official name as the annual-rule key; choose the display name by the screen language. The country calendar supplies English names for holidays and area choices. A stored name absent from the supplied English-name inventory stays as recorded. This changes no stored holiday rule or database schema.

**A972 regional demos (owner, 2026-10-27).** Each regional demo extends Casa Delgado
with one menu section, a regional wine and its own staff. Build Catalonia first,
shared with the Balearic Islands, then Valencia, then Galicia. Give each region a
restaurant name; update an untouched default when the postcode or province changes
and preserve a name someone has typed. **A1458, owner 2026-11-08:** staff and kitchen
names now follow the seed's English/Spanish language, keeping regional translation data and
customer maps. A1458's later setup slices add the explicit working-language choice; until then
the existing resolver supplies it. This replaces A972's demo-only regional-name override;
the A918 starter-content policy below stays separate. The
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
every other active administrator needs supported recorded password/passkey enrollment. Planning is authorised by the watcher's 2026-11-01 note; build waits for A739 and starts with retained disabled-module protection.

2026-11-11 scope update: the [current A646 entry](#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up) supersedes these Google and build-order parts.

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

- **One rule for the old table permission questions (owner, 2026-11-06).** The A805 audit left one "decide this table's restriction" question per table. For non-tax tables, no new database refusal is added unless someone shows how a wrong delete or update could really happen. That closed the questions for: `bookings`, `card_readers`, `catalogues`, `change_log`, `convenio_config`, `departments`, `devices`, `employments`, `floor_zones`, `incidents`, `join_requests`, `kitchen_stations`, `management_sessions`, `menu_items`, `node_membership`, `persons`, `print_agents`, `print_jobs`, `printers`, `products`, `scheduled_runs`, `sessions`, `ticket_items`. The tax and card tables' refusals go into A1308.
