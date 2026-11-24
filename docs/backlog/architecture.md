# Modules, data and code health — detail

The open entries are listed in [the backlog](../backlog.md), under "Modules, data and code health". This file holds
their full text.

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
  golden huella test and the `inmutabilidad` suite pass unedited. Still open: `bench/` and
  `scripts/fake-bluez.py`, which is outside the checker.

## Every read route now takes the venue's exclusive write lock and issues a DELETE

**OPEN.** `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
Plain GETs are among its callers — `GET /api/box/status`, the unauthenticated content-languages route, and two
management reads. The single writer is the engine's and is not removable. The unconditional DELETE
on a read-only body is: `node:sqlite` exposes a change counter. But it interacts with a documented
behaviour — the drain deliberately collects the rows an orphaned writer left — so this is a design
decision, not a cleanup. **Next action:** decide whether a read-only body should take the lock at
all.

## Unselected fiscal modules' append-only tables are neither re-protected nor checked

**Left open by A483: unselected provision-only fiscal modules.** Boot repairs missing triggers,
refuses changed definitions and watches existing tables declared append-only by toggleable modules,
and the declared payment guards, even while Off. The selected migration sets still supply the rest
of the protected list. No absent
optional table is created by that repair.

A box moved from fiscal-verifactu to fiscal-none still does not re-protect or watch the unselected
fiscal set's retained tables (`verifactu_records` and other declarations).
That fiscal protection decision remains outside A646's optional-module repair.

## These index and key names still read `tenant`, and the columns they name are gone

A1308 leaves these names with the slices that own their tables:

- `print_agents_tenant_node_key` and `purchase_invoices_tenant_received_idx`: the devices and
  menu areas; no slice plan names their rename yet.

## A913's fix items: general code English only

**2026-11-15, A1308 vb6:** the retired venue fixture field is removed. The historical
operation-description references below no longer describe that venue field; recording helpers
now pass their original description explicitly, and department receipts store theirs in
`departments.operation_description`. Remaining language cleanup is tracked by the root
English-only guard and its debt list.

**Audit done 2026-10-20 on main `a3be14ba4`: [english-only-audit.md](english-only-audit.md).** The
owner answered points 2–8 on 2026-10-20 (the campaign's questions file has the words): 2, 4, 7 and 8
as recommended; 3, 5 and 6 in the owner's own words, recorded in
[conventions-data.md](../developers/conventions-data.md#general-code-is-english-only). Point 1
was A918; its decision is under "Decisions and deliberate limits" below. The items
below carry them out, one pull request each unless an item says otherwise. File and line references
are the audit's, taken on `a3be14ba4`; re-find them on current `main`. Every item follows the rule
for its own diff (grep it for non-English text before pushing — the guard does not read a file
listed in `scripts/english-only-still-to-clean.ts` line by line).

- **Name special invoice-document issuing codes.** A963's review (on `e5693d460`) reported exactly
  `QU`, `XB`, `XG`, `XN`, `XU` returned unchanged by `countryNameFor` in English and Spanish.
  Both dialogs use that helper for the issuing list. Add sourced names for that list without
  admitting those values to the postal-country list. This is a wording follow-up; the identifiers
  retain their explicit issuing code.
- **Regional demo screen qualification.** Inspect the seeded till, kitchen and dashboard in
  English/Spanish, both themes and phone/desktop widths when the development stack can start.
  The regional cuts' local launches refused at Mailpit's absent Docker socket; their native setup
  component views and database/media checks do not qualify those live screens.
- **A974 — remaining Bucket E and F sites.** Still open: identifiers and file names from the audit.
  The audit is historical; its other listed Bucket E comments have been removed or put in English.
  The server split suites' comments and shared helper consumers remain.
  Record and submission names also remain in server seed,
  snapshot and fiscal-identity suites; check protected fixtures and fiscal-provider contracts.
  Fixture strings remain separate from this naming work. Shared helpers' Spanish dish samples
  and their consumers stay with A976, as do the filing order-portion samples.
  Keep accented search fixtures unchanged. String-selected product keys stay with their fixture text
  under A976.
  Menu display names, seasonal venue and zone names and printer-screen display labels
  also stay with A976, along with counter-screen display text, station-screen display names,
  kitchen-ticket grouping, payment/queue widget display text, variant media fixtures and
  device/printer deletion fixture text.
  Low priority.
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
  still need English defaults, as do the adjustment venue's legal name and department operation description.
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
  concurrency suite (`kitchen-print.concurrency.test.ts`) creates an English location, menu,
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
  the menu; its direct error-wording
  and browser language-name checks remain. Keep deliberate Spanish/French metadata, the filename
  suite's accent-sensitive sample and the framing suite's deliberate multilingual metadata.
  The combobox accessibility suite's sample wording is English; its themes, keyboard,
  selection, disabled contrast and accessibility checks remain.
  The bookings dashboard's form, day-list, client, validation, draft and accessibility suites
  use English sample names; form and picker labels read the menu. Keep printing’s accented
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
  with this item. Menu import-validation samples use English menu, dessert and drink names;
  accented-name collision and multilingual unit examples remain. Continue package by package
  from `scripts/english-only-still-to-clean.ts`. UI switch behavior and accessibility
  suites use English sample labels and descriptions. Disclosure accessibility samples use English
  headings, summaries and body text; deliberate EN/ES summary examples remain. Printing layout
  and printer samples use English; layout samples keep their character counts and word boundaries.
  Database kitchen-course, station and station-printer suites use English sample names.
  Floor-plan, menu-membership and ticket-item samples use English names and notes.
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
  Menu stored-name-key samples use English dish and template names; accented folding,
  variant renaming, batch boundaries and clash checks stay.
  Menu pricing samples use English dish and modifier text; pricing checks retain
  their existing amounts, quantities, dates and language keys.
  The menu-removal and availability suites use English dish samples; removal,
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
  The menu API suite (`apps/server/src/menu-api.test.ts`) gives English menu, category,
  product, variant, kitchen, options-list, label and extras-list names to what it creates; it
  keeps the customer names and descriptions it gives under `es`, `fr` and other language keys,
  its `es-ES` locale and the operation description "Venta". The full-manifest suite
  (`apps/server/src/menu-api.full-manifest.test.ts`) gives its location, administrator,
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
3. Rewrite the **Pre-release** line under _Evidence on Hand_ in `PRODUCT.md`.

Keep the current `CLAUDE.md` rule, planning files and ignore settings until go-live day.
The separate [A760 procedure](../operations/a760-migration-squash.md) retains its own freeze,
reset and operator gates; this entry does not start that job.

## Loose ends left by A435's printer, reader and device delete (steps 2 to 4)

- The till's status for an original whose printer was deleted uses the error code's sentence
  ("…this job will not be retried."), where its neighbours speak of "the original". Owner to
  choose the wording.
- Shorter printer-delete copy was offered to the owner during the build: for the till's
  deleted-printer sentence, the Spanish heading over ending work (now "Trabajo que finaliza"; a
  shorter "Lo que se detendrá" was offered, which in the present tense reads "Lo que se
  detiene"), and one dialog line per inherited default.

## Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519)

- The till names a reader deleted elsewhere with `reader.not_found`'s general sentence ("This
  device has no card reader it can use…", `apps/till/src/i18n/codes.ts`), where a deleted printer
  has its own "That printer no longer exists". Owner to choose whether readers get one too. Step 3
  (#1520), whose plan kept the existing sentence.

## Loose ends left by A483 (#1544)

OPEN.

- [Unselected fiscal modules' append-only protection](#unselected-fiscal-modules-append-only-tables-are-neither-re-protected-nor-checked).
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

## A974. Finish the remaining English names in general code.

- **A974. Finish the remaining English names in general code.**
  A private person binding (`marta`, shown as Martha) remains in the protected
  `clock-set.route.test.ts`; check the clock-suite boundary before renaming.
  Protected fiscal and receipt helpers still need their boundary audit.
  Other split-suite comments, shared helper consumers and file names remain.
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
  Other fixture text stays with A976, including menu
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

**2026-11-15, A1308 vb6:** the [fixture-field update above](#a913s-fix-items-general-code-english-only)
also qualifies the historical operation-description references in this section.

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
  The unpaid-departure suite uses Sophia for its local supervisor sample.
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
  The own personal-data download (`personal-data-export-api.own`) and box-health samples use Martha and Rose; stream-route and cross-person profile administrators use Administrator.
  Local personal-data export, staff-export and working-time record suites use Martha Lewis; the staff-export suite's administrator sample uses Anna Admin.
  The adjustment-download worked example uses Martha Lewis, Lewis Green, Paul Gray and Anna Smith;
  local reprint and restore-archive staff samples use Anna.
  The shared clock venue uses Anna for its staff sample and matching attendance, approver and profile-export checks.
  The shared signed-in-till venue uses Anna and Administrator for its staff display samples.
  The shared adjustment venue uses Anna and Martha for its staff and manager samples.
  Local `issuance-pass.test.ts`, `till-sale-tender-block.test.ts`, `sale-till-source.receipt.test.ts`,
  `served.test.ts`, `report-api.categories-reconcile.test.ts` and `demo-seed.db.test.ts` use English staff display names.
  The recovery-page personal-data suite uses Martha Lewis and George Hill as staff samples. Its Spanish venue legal-name, location and table-name samples remain.
  The shared boot provision-body and stream-pause fixtures use Administrator for their staff display sample.
  The menu include-folder, menu-patch and menu-schedule route suites use English staff display names.
  Account-invitation and box-alert-email duty staff samples use Anna; so do the two-role invitation
  and personal-data README literal-replacement examples.
  Local former-number station and today-name counter-group samples use English; accented group names (García birthday) and the Ana party name remain.
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
  The published-menu sale fixture uses Dishes for its staff category and Desserts/House desserts
  for its staff section; its Spanish customer section name and product/modifier text stay.
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
  Floor-plan, menu-membership and ticket-item samples use English names and notes.
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
  Menu stored-name-key samples use English dish and template names; accented folding,
  variant renaming, batch boundaries and clash checks stay.
  Menu pricing samples use English dish and modifier text; pricing checks retain
  their existing amounts, quantities, dates and language keys.
  The menu-removal and availability suites use English dish samples; removal,
  sibling-price, archived-product and availability checks remain.
  Dashboard hardware save-state, equipment-label and page-printer panel suites use English
  sample names; IDs, permissions, saved choices and save-state checks stay in place.
  Dashboard overview behavior and accessibility suites use English dish and variant samples;
  currency, ordering, overflow and deliberate EN/ES checks stay in place.
  Menu import-validation samples use English menu, dessert and drink names;
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
  concurrency suite (`kitchen-print.concurrency.test.ts`) creates an English location, menu,
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
  The menu API suite (`apps/server/src/menu-api.test.ts`) gives English menu, category,
  product, variant, kitchen, options-list, label and extras-list names to what it creates; it
  keeps the customer names and descriptions it gives under `es`, `fr` and other language keys,
  its `es-ES` locale and the operation description "Venta". The full-manifest suite
  (`apps/server/src/menu-api.full-manifest.test.ts`) gives its location, administrator,
  category, product and section English names, and keeps its `es-ES` locale, its Spanish street
  address and the operation description "Venta en establecimiento". The setup API suite
  (`apps/server/src/setup-api.test.ts`) uses English location, administrator, product,
  series-code, zone and department samples, and keeps its `es-ES` locale, its Spanish addresses,
  and the operation description "Venta en establecimiento" its operation-description case reads from the fiscal package.
  Group-route and course-deletion service-step suites use English names for their own courses.
  The printer-test-page suite uses English printer and trading names; it keeps the QR caption
  «QR tributario:», the sample invoice number «MUESTRA/1», the Spanish receipt's practice mark
  «DOCUMENTO DE PRUEBA», its no-invoice notice «Este documento no es una factura» as the 58mm
  roll wraps it, its sample issuer «Waitron - Recibo de muestra» and its change label «Cambio»,
  and the sample dishes of the Spanish, Catalan, Galician and Basque receipts.
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
  Venue-service's test files are off the list: ordinary samples are English, fixed Spanish screen
  labels are read from its strings table, and the files that still need non-English text are held
  at their counts in `KEEPS_NON_ENGLISH`, each with its reason; staffing is next.

## A1308. Rationalise the tables, background jobs, environment variables and files

- A39 (#671) left some server shutdown duties registered both in the failed-start unwind and in the normal close order. The background-duties suite pins the normal order.

- **A1308. Rationalise the tables, background jobs, environment variables and files** (owner,
  2026-11-02: "over engineered and disjunct … each bit has been designed in isolation"). The
  [design](../superpowers/specs/2026-11-02-rationalisation/README.md) is written. The owner has
  reviewed every file and answered every question (2026-11-04), and approved it the same day.
  [Slice 0](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-04-a1308-slice-0-bench.md)'s protection list is built;
  [the testing guide](../developers/testing-guide.md#the-protection-list) says how each slice uses
  it. Its bench is built too ([how to use it](../developers/testing-guide.md#the-bench)); it runs
  from time to time, not per slice (owner, 2026-11-10;
  [when](../developers/testing-guide.md#when-the-bench-runs)). Next is
  [the build order](../superpowers/plans/2026-11-08-a1308-build-order.md).
  A790's page jobs share the print queue. Its copy audit and its three routing journals keep their
  own tables. **Open:** later slices still need to cover the tables A802 and A739 added.
  246 tables become 145, in eight migration sets instead of sixteen. The job runner is built with scheduled
  menu activation, scheduled archives, the sealed-key copy and public `/health` reports. Scheduled
  archives copy the venue database on a worker thread. You can choose an eligible test connection
  in Backups and see its backup outcome there. Waitron Cloud receives the same scheduled backup
  as the box-key destinations, using its own encryption key. The bucket copy runs as a service.
  Close stops runner jobs first and the bucket copy last.
  [A1279](replication-cloud.md#a1279-a-local-secondary-promotes-only-over-a-chart-it-signed-itself) owns immediate role wiring and the real promotion test, including a mirror, if its live-promotion path gains a production caller. Codex attached this to A1279 after the watcher deferred immediate wiring on 2026-11-11 at 05:18.
  The six watches (append-only protections, clock, free space, Cloud connection, translation
  suggestions and practice printing) also run there. Repeated thrown passes raise one dashboard
  alert per job after ten minutes and three failures; the manager’s box-status read includes the
  complete job views. Attendance day processing, the outgoing-mail sender, certificate reminders
  and box-alert email decisions also run there; idle attendance checks take no write turn.
  Daily housekeeping also removes expired sign-in challenges, ended or idle dashboard sessions
  and photo bytes no image references, in separate batches. Command-answer cleanup is built but
  stays off until the latest possible till retry is confirmed; its bill branch retains abandoned
  bills because they have no closing timestamp.
  Filing, payment reconciliation and fiscal reconciliation also run there. A committed fiscal record
  wakes filing, subject to the tax agency's wait between submissions. Card recovery still runs in its
  separate loop until the one-payment-route change retires it.
  Devices hold their assigned station and invoice printer choice revision on the device row.
  Printers now store the device holding them and which documents they pick up on the printer row.
  Receipt and office printers share one table. Each profile stores its ordered printer choices and defaults.
  Device profiles hold their ordering department, starting zone, allowed zones and kitchen view on the profile row.
  Kitchen tickets now read their bill through the order line, with no copied bill id to update on a move.
  Each order line now carries its recorded offer and first-send facts, which stay with the line when it is split or moved.
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
  The print agent waits on held requests for receipt and office-print work. Drawer expiry,
  claim leases and a document's next retry can shorten that wait. Pending page work and discovery
  retain their two-second cadence. Receipt handover records the staff member and time on the print
  job.
  Handhelds and kitchen displays keep timed reads under
  jr11's measured fallback. Before go-live, qualify silence recovery with a physical power cut;
  jr13's SIGSTOP probe is a stand-in only. The shared environment inventory declares each setting's
  source, and the server reports unknown names and ignores misplaced file entries. The print agent
  uses its host name. Host-script and full-disk tests use shared roots. The SMTP connection URL and
  bucket keys are sealed.
  Ended dashboard sessions are deleted; sign-in history comes from activity records. Email-change
  proofs use the pending address without copying it into the proof row.
  Each shift now holds its own job role and area and belongs to a rota week; deleting a draft week
  deletes its shifts. Attendance questions now point at their stored day rather than copying its
  bounds; the next due time carries deferred work, and recorded answers refuse changes and deletion.
  Authenticator secrets and emailed confirmation codes use purpose keys from the vault ring.
  The existing rotation command re-seals authenticator secrets and pending setups; codes issued
  before the change still work while the ring retains their previous key.

  Department sale rules, receipt trading-name choices and receiving profiles live on the department row.
  Menus hold their own display settings and categories their own parent and colour. Root and Home
  sections are identified by role, with at most one of each per menu; the menu archive function leaves an activity entry.

  Privacy contact details live in venue settings; legal-name changes and credential saves and
  removals leave activity entries.

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
  runs first, merged into the eight sets. Slice 5 (5a–5h) completes the location removal. It absorbs A1301's schema slices (S20–S28);
  S23 builds no `venue_settings`, because the venue's settings become documents in the shared
  `settings` table. It also renames every leftover "tenant" name: the `tenants` table becomes
  `taxpayer`, and names that mean the venue or box get that name (owner, 2026-11-02; design §5 U9).
  Menu code uses `@waitron/menu` and menu/product file paths. Product defaults and starter-unit
  history share `settings.menu`; translation runs store their total on the first batch only.
  The menu table, identifiers, routes and wording now use menu names; the Products screen uses
  products names. Menu root names now come from menus.name; include-folder names, photo and colour have their own columns. Live and scheduled menu versions now share menu_releases; rescheduling leaves an activity entry. Menu version creators and release cancellers now name existing people through database keys. Periods hold their ordered staff-menu ids. Photo metadata lives on each photo; original and replacement bytes share one immutable blob store, and deleting or replacing a photo prunes bytes no photo names.
  Membership reads its term from the signed document, and an alert's handler references a person.
  The box's role, recovery key, signing key, mirror link and pinned main-box key share one local
  row; role changes, recovery-key replacements and signing-key rotations leave events in node.db.
  A card reader holds its device id on its own row; its enabled status comes from `disabled_at`.
  A device keeps its chosen reader on its row, and a profile keeps its ordered readers and default
  in one list. Reader deletion clears both; configuration exports leave those assignments behind.

  Bill numbers, names and editor ownership now use columns on each bill, with the next number
  held by its party. A party merge also moves paid bills and preserves their collection facts;
  abandoned bills stay behind.
  Bill and receipt refunds share one table. Each row points to the bill payment or receipt tender
  and names the staff who handled it. Both entry points use the same refund reservation,
  completion, card sender and recovery. Staff can print one acknowledgment from the till
  for either refund and get later copies in Print Queue.

### 2026-11-19 counter save-and-pay benchmark

PR 3 of [One way to pay](../superpowers/plans/2026-11-19-a1308-one-way-to-pay.md)
measured fresh counter cash through the old sale request and the bill's payment request. On the
bench server at `2.29.248.230`, both measurements used the same 30-day venue at 250 bills a
day (seed 1) and 200 samples per case in each of three rounds. The `node:26-slim` image ran
Node 26.13.1 and SQLite 3.54.1 without STAT4.

Base `1eb7a415fbd7ff50fdb3643e0c92d7c61a2148ea` produced
`/root/waitron-bench/a1308-2026-11-19-counter-save-pay-30d/before.json`. Candidate
`070bc8e5a7f0c14c22aac8d4a8f98c77d26eef5c` produced
`/root/waitron-bench/a1308-2026-11-19-counter-save-pay-30d/after.json`. Later review fixes
handle closed orders and their receipts. The timed sale starts with a fresh order.

| Case | Before round medians | After median | Verdict |
| --- | ---: | ---: | --- |
| `payment.partial` | 5.20–5.24 ms | 5.25 ms | same |
| `payment.final` | 11.40–11.56 ms | 11.53 ms | same |
| `sale.counter` | 11.84–11.93 ms | 15.10 ms | slower |
| `floor.read` | 7.38–7.43 ms | 7.40 ms | same |
| `floor.open` | 8.70–8.79 ms | 8.75 ms | same |
| `kitchen.queue` | 6.71–6.77 ms | 6.80 ms | same |
| `kitchen.screen` | 7.18–7.18 ms | 7.22 ms | same |
| `kitchen.pass` | 29.26–29.43 ms | 29.09 ms | same |
| `kitchen.pass-screen` | 43.34–43.56 ms | 43.20 ms | same |
| `dashboard.open` | 51.53–51.86 ms | 51.40 ms | same |
| `kitchen.pass-release` | 5.72–5.80 ms | 5.79 ms | same |
| `print.problems` | 3.86–3.99 ms | 3.86 ms | same |
| `filing.pass` | 12.73–12.82 ms | 12.71 ms | same |

`sale.counter` rose by 3.26 ms between the round medians. PR 3 switched this case from
`POST /api/sales` to `POST /api/working-orders/:id/payments`.

## Bundle: Small checks and indexes that are cheap only inside A1308's fresh tables

Size M.
Where each lands: the A1308 slice named in the design's "Lands in" column
([Additions of 6 November 2026](../superpowers/specs/2026-11-02-rationalisation/README.md#additions-of-6-november-2026)).
Include `menu_versions.created_by` when indexing the menu history. On a development Mac, the staff
download's first write-lock turn took a median 25 ms with a seeded year and 216 ms with five years.

- **`verifactu_identities`: decide the remaining DELETE restriction (A805 follow-up).**
- **Finish the remaining person-id foreign keys.**
  Columns still marked "No key yet" need keys as A1308 rewrites their starting migrations
  (CLAUDE.md §3: declare every foreign key). Their old reason — `persons` lived in another
  migration set — ended when A760 moved it into core.
- **A print job's payload sits ahead of its status columns.** `print_jobs.payload` averaged 20 KB
  on the bench's first full year (built 2026-11-06, since rebuilt; the table was 8 GB of the 12 GB year).
  **2026-11-14, A1532:** that measurement predates the one-week payload sweep; eligible old rows
  now hold empty blobs. The printers-down check (`stationPrintersDownQuery` in
  `apps/server/src/station-outputs-down.ts`) groups over every stuck job of a printer. It matters
  only with many stuck jobs. Put the payload after the columns reads filter on.
- **A dish's recorded options answers do not say which list they came from (left open by #3746).**
  Park a dish not yet sent with Cooking and Sauce answers, delete the Cooking list and add a required
  Milk list: the till does not ask for Milk and the server accepts the save, because the leftover
  answer could be the Milk list under a new name. `option_snapshots` on `working_order_lines` and
  `sale_lines` holds names only, so `answersOfGoneLists` (`apps/server/src/modifier-selection.ts`)
  has to count. Both Codex reviews of #3746 gave the fix: "preserve each recorded answer by its
  original list identity and validate new lists separately". It changes what both tables store, so
  it belongs with A1308's line work (watcher, 2026-11-18). No slice's plan names it yet.

## What A1308 retires

These entries stay open until the A1308 or A760 slice that removes the need for them lands (backlog review, 2026-11-06). The slice that does so deletes them here. If a slice changes course, its entry goes back to the index.

- **If a later slice moves `local` tables into `node.db`**, that slice decides again how the drain
  crosses the two files: SQLite refuses a trigger body that writes another attached database. A947
  slice 3a moved five tables with no change-log triggers; the question stays for `change_log`.
  [Detail](replication-cloud.md#if-a-later-slice-moves-local-tables-into-nodedb)
- **Left open by #1261's review (W111):** the receipt editor's copied phone and email limits remain open.

- `service_commands` rows are never pruned. Left open by service Task 2 (#715, a record per seated
  party).
- **The upgrade walk's historical runtime variation remains unexplained after reducing setup work (A736, [#1788](https://github.com/clintongormley/waitron/pull/1788)).**
  [Detail](ci.md#the-upgrade-walks-historical-runtime-variation-remains-unexplained-after-reducing-setup-work-a736-1788).

## Bundle: Query plans and indexes, measured on a year of data

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Index the dishes not yet fired, so the pass's reads stop scanning every ticket item ever kept
  (left open by A773-2 PR C's review).** This needs a migration.
  [Detail](till.md#index-the-dishes-not-yet-fired-so-the-passs-reads-stop-scanning-every-ticket-item-ever-kept-left-open-by-a773-2-pr-cs-review)
- **Measure the remaining top-level-dish reads (A1370 follow-up).** Check `parent_line_id is null`
  reads across the server and venue-service, including `listOrderGroups`, `working-order`,
  `move-bill`, `finish-party-service` and `party-allergy`. Measure their plans with history.


## Bundle: Full-invoice recipient: country code names

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **Name special invoice-document issuing codes.** Both recipient dialogs currently show
  `QU`, `XB`, `XG`, `XN` and `XU` as bare codes. Add sourced English/Spanish labels without
  treating them as postal countries. [Detail](architecture.md#a913s-fix-items-general-code-english-only)

## Bundle: Correct every sentence known to be false, then finish comment pruning

3 entries, size M.

- **Three configuration-transfer cases pin an insert order the importer's `pragma defer_foreign_keys`
  may make unnecessary for foreign keys** — OPEN (found by #603). Read only, not run: in
  `packages/menu`'s `options.test.ts`, `product-modifiers.test.ts` and `extras.test.ts`;
  whether to keep pinning it is the owner's call.
- **start-space.ts's `logDir: null` option is dead since A1042**; removing it deletes an existing case, so the owner approves the removal. [Detail](box.md#start-spacetss-logdir-null-option-is-dead-since-a1042)
- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  [Detail](architecture.md#prune-the-comments-one-package-per-pull-request)

## Bundle: Remove code nothing reaches (replaced or dead, never merely unused)

1 entry, size S.

- **Unread configuration parameters remain in `apps/server/src` test code.** The test helpers
  `offerProducts`, `createTable` and `defaultLayout` (in `apps/server/src/testing/`) keep an unread
  `_cfg` parameter (`git grep -n '_cfg:' apps/server/src`); the `asApp` helper in six test files
  takes a `cfg` it only discards (`git grep -n 'void cfg;' apps/server/src`). Each is mechanical
  but touches every call site: on 2026-11-22 about 760 lines matching `asApp(` in those six files
  (`git grep -c`).

## Bundle: Printer, reader and device delete wording

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by A435's printer, reader and device delete (steps 2 to 4).**
  [Detail](architecture.md#loose-ends-left-by-a435s-printer-reader-and-device-delete-steps-2-to-4).
- **Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519).**
  [Detail](architecture.md#loose-ends-left-by-a435-steps-3-3b-and-4-1520-1524-1519)

## Decisions and deliberate limits

**Adjustment splits stay on the adjustment record (A1308 pa5).** A partial pizza comp with a free
extra split off a row without creating a matching `adjustment_lines` row. Receipts still need that
split. A whole comp records the price reduction for each extra it makes cheaper. A free extra
has no reduction, so a whole comp has no adjustment line for it. Configuration exports carry
adjustment reasons only, so configuration import never remaps these row IDs. [Measurement 6](../superpowers/plans/2026-11-08-a1308-pa5-adjustments.md#task-1-measurement-6--does-every-splits-new-row-have-an-adjustment_lines-row-early)

**Orders history keeps its own tables for good (owner, 2026-11-19).** Receipt-copy requests and invoice PDF downloads stay in their own append-only history tables, with their protections and the dashboard's live subscriptions, rather than moving into the activity log: "On 19 November the owner chose to keep Orders history for good."

- **Department receipt rasters stay cached** (watcher, 2026-11-15 16:45). On the designated test box, converting one wordmark inside a synthetic write transaction added 15.913 ms warm for decode/dither and 114.681 ms including rendition. The removal follow-up is retired. [Measurement and limits](../superpowers/plans/2026-11-08-a1308-vb5-department-receipts.md#receipt-logo-cache-after-the-box-timing-2026-11-15).

**Venue identity (owner, 2026-11-02).** Cloud assigns its venue id; a box not connected to Cloud backs up where its owner chooses. A1308 slice 5 completes the removal of the old location object. Cloud, not the box, makes the id because one Cloud account can hold several venues and "a box-made id cannot be guaranteed unique"; inside the box the venue has no id, like the taxpayer row. A box with no Cloud id that pairs becomes a new Cloud venue; it is not attached to an existing one, and carrying a venue on means restoring its data, which carries the id (lane B's default, 2026-11-04, built as written).

**No locations (owner, 2026-11-01).** One venue per box; nothing new is built on a per-location idea: "Remove the location concept from the codebase entirely" and "Give this high priority so we don't build anything more on this concept."

<a id="a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up"></a>

**A646 — a Modules page where the administrator switches optional modules on and sets them up.**

Owner design decision, 2026-10-17 00:05 (Lane F archive/questions-to-2026-10-23.md:1169):
optional modules and card providers share the Modules page. Workforce and staffing stay mandatory
under A1002; Spanish workforce rules, Payments and Bookings use saved choices and a separate restart.
Watcher clearance, Lane D questions.md, 2026-11-14 14:22/14:40: Payments Off requires every provider
Off; installed optional sets keep migrating while Off, absent disabled sets stay absent, and earlier-payment
recovery continues. Unselected fiscal protection remains [open](#unselected-fiscal-modules-append-only-tables-are-neither-re-protected-nor-checked).
The owner withdrew Google sign-in from A646 on 2026-11-11; it is A1507 in [later.md](later.md#a1507-google-sign-in-built-in-through-one-waitron-owned-google-setup).
An export with an optional module Off loads on a new box with that module On and empty (owner, 2026-11-06 23:03, A1384).
See the [design](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-16-a646-modules-page-design.md) and [remaining-switches plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a646-remaining-module-switches.md).


**A malformed path id keeps the status it answers today (A394 question 7, the watcher's decision of 2026-11-20 22:35 on the owner's delegation of 14:31, not the owner's own).**
An address whose id is not even well formed answers 400 `shared.invalid_id` on most routes; the A394
audit (read, not run) found the resource's not-found 404 on management-api and orders-api and 409 on
three till routes. The rule's 404 is not applied to it. The watcher's reason: such an id comes only
from a hand-typed address, never from the screens, and the change would have touched 179 calls to
the id check in 23 files (`git grep` on main, 2026-11-20), about 30 of them screening body or query
ids that must stay 400. A394-22, which would have made it 404 everywhere, is dropped.

**Three till refusals keep their statuses (A394-9, owner 2026-11-10: "Leave them, write it down (Rec.)").**
On the till, `service_zone.not_found`, `table.not_found`/`table.inactive` and `reader.not_found`
answer as they did before A394, a deliberate exception to the one-status-rule in
[conventions-data.md](../developers/conventions-data.md): each is raised in more than one of the
rule's situations (the address names it, the form names it, or a stored row does), so following
the rule would need a new refusal for each situation; no screen reads the number, and every screen
acts on the refusal's name. The trace is in the A394 plan, under A394-9.
Question 14 of the A394 plan, which recommended 409 for the till's no-reader case, yields to this
decision (watcher, 2026-11-20 18:11).

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
[design update](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/specs/2026-10-27-a972-demo-data-per-country-and-region-design.md)
records the four answers. Spain owns its demo records and pictures behind secondary
exports; ordinary browser entries stay separate. Madrid keeps its frozen database
comparison. Catalonia and the Balearic Islands share Can Delgado; Valencia uses
Casa Delgado de l'Horta and Galicia uses A Casa Delgado. No further country demos
are included in these five cuts. The [implementation plan](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-27-a972-demo-country-region.md)
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
[Original implementation plan](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-27-a963-invoice-address-country.md) and
[foreign-recipient rework](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-28-a963-foreign-recipient-rework.md).

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
reasoning is in [2026-10-27-a918-starter-content-translations.md](https://github.com/clintongormley/waitron/blob/cb1aeeb7b2/docs/superpowers/plans/2026-10-27-a918-starter-content-translations.md).

**A646 module controls and Google access (owner, 2026-10-17).** The revised design is agreed:
Enabled-default menu, Add a module selects Disabled, row-menu Configure/Disable, a Configure
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

- **One rule for the old table permission questions (owner, 2026-11-06).** The A805 audit left one "decide this table's restriction" question per table. For non-tax tables, no new database refusal is added unless someone shows how a wrong delete or update could really happen. That closed the questions for: `bookings`, `card_readers`, `menus`, `change_log`, `convenio_config`, `departments`, `devices`, `employments`, `floor_zones`, `incidents`, `join_requests`, `kitchen_stations`, `management_sessions`, `menu_items`, `node_membership`, `persons`, `print_agents`, `print_jobs`, `printers`, `products`, `scheduled_runs`, `sessions`, `ticket_items`. The tax and card tables' refusals go into A1308.
