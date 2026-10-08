# Receipts per department, slice 7 — implementation plan (A366)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** The campaign queue's owner decision of 2026-10-05 governs: a check that
> pins behaviour this plan removes (listed under "Behaviour this slice removes") is changed to check
> the new behaviour at least as strictly, and listed in the pull request's "Changed test checks"
> section with `file:line`, before and after. Anything else is a STOP. No golden huella,
> `inmutabilidad` or fiscal filing test is touched by this plan; if one fails, STOP.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Every commit is green.** Each task ends with its package suites passing and every touched
> package typechecking. The order is chosen for that: the new shape, table and routes are added
> beside the old ones; the readers move one path at a time; the venue-wide row and its routes are
> removed last.
>
> **Base.** Written 2026-10-08 against `main` `ecba0d379` plus slice 1's branch
> `feat/service-periods-slice-1` at commit **`1ed9857ca9dd6589dd280b5ac3df35cce27f5fc1`**, which
> had not landed. Every `file:line` below was read at `main` `ecba0d379`. Slice 1's branch changed
> no line of the receipt code this plan cites (a search of its diff for `receipt`, `tradingName`,
> `trading_name`, `headerSubtitle`, `footerMessage`, `invoice_locales`, `tenant_receipts` and
> `sale_polic` found no changed non-test line); it changes the menu setup in
> `apps/server/src/till-api.receipt.test.ts` and `sale-till-source.receipt.test.ts`, and adds
> venue-service migrations `0032` and `0033`. Before building, diff what changed after that commit:
> `git diff 1ed9857ca <slice-1 merge sha> -- packages/module/src/module.ts packages/venue-service/src/classification.ts packages/venue-service/src/configuration-transfer.ts packages/venue-service/src/index.ts apps/server/src/till-api.ts apps/till/src/till-app.ts apps/till/src/api/client.ts apps/server/src/till-api.receipt.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts`
> and re-read any cited line that moved (the review of 2026-10-08 found the branch already at
`124c4d773`, a descendant of `1ed9857ca`, with the same result for that search). Slices 2 to 6 may have landed by the time this is built;
> section "What this slice needs from slices 2 to 6" names the files they share.

**Goal:** each department prints its own receipt: its own logo, phone, email, "print the address"
switch, and a subtitle and footer written once per language a receipt or a copy can print in. A
language not yet written prints the receipt language's text. The legal name, tax number, address,
receipt language and the description sent to the tax agency stay venue-wide in Venue settings.

**Architecture:** today the authored receipt text is one venue-wide JSON row, `tenant_receipts`
(core set, `packages/db/src/schema/tenant-receipts.ts:18-26`), read live at every print and
reprint (`getPrintedReceipt`, `apps/server/src/receipt-print.ts:162`). This slice adds a
venue-service table, `department_receipts`, one row per department, with the same fields except
that `headerSubtitle` and `footerMessage` become maps keyed by receipt-language tag (`es-ES`,
`ca-ES`, …). A sale already records its department (`sale_receipt_headers.department_id`,
`packages/venue-service/src/schema/service.ts:140-160`, written in the sale's transaction by
`recordSaleReceiptHeader`, `packages/venue-service/src/operations.ts:614-627`); every print,
reprint, copy, A4 page and the till's on-screen receipt reads THAT department's current text,
resolved to the language being printed. A sale with no recorded department uses the location's
default department (`departments.is_default`, `service.ts:37-44`). The new store's reads never throw:
a print runs inside the sale's transaction, where a throw undoes the sale (decision 19). Validation stays a pure
function in `@waitron/layouts`; the table and its store live in venue-service and are reached from
`apps/server` through new venue-service seats, as `readSaleReceiptHeader` is
(`packages/module/src/module.ts:439-453`). The dashboard's Venue settings → Receipts page edits one
department's receipt at a time (Part A); the department page's Receipt tab (spec §9.1) takes that
editor over once slice 6 has built the page (Part B).

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects), sharp for the logo rasters.

**Spec:** [Service times, departments, zones and prep stations](../specs/2026-10-07-service-times-departments-and-stations-design.md)
§2 (the receipt bullet), §6 ("Print a receipt"), §9.1 (Receipt tab), §11, §12 ("Venue settings'
receipt fields that move to departments"), §13 item 7. The approved mock-up is screen 4 of
`all-screens-v3.html` in the brainstorm session (outside the tree); its text is quoted under
"The mock-up" below. Backlog: A366.

**Risk path:** FULL ceremony with two run-it reviews: a new table and a dropped one (migrations),
a changed cross-package contract (`VenueServiceContribution`, `packages/module/src/module.ts`; the
till's boot and sale answers), and what prints on a fiscal document — around, never inside, the
mandated elements (`packages/layouts/src/types.ts:3-6`).

**Venue reset: needed, optional.** Each pull request's first line reads **"venue reset needed —
optional: the venue-wide receipt text (logo, slogan, phone, email, footer) is not carried over;
without a reset each department starts with an empty receipt and is filled in again"** (Part B's
first line says "no venue reset needed" unless its own migration says otherwise). Dropping
`tenant_receipts` and creating `department_receipts` both succeed on a box with rows (no foreign
key points at `tenant_receipts`: its only constraint is `tenant_receipts_singleton_ck`,
`tenant-receipts.ts:25`; check again at Task A13 with the `REFERENCES` grep).

---

## The mock-up (screen 4, "Department ▸ Receipt", approved 2026-10-07)

Quoted from the brainstorm file's text, because the file is outside the tree:

> Subtitle and footer are written in each language a receipt or a copy can print in. Trading name,
> phone and email are the same in every language.
> Departments › Restaurant and bar — tabs Settings · Zones · **Receipt**
> Print a receipt [Always ▾]
> **At the top** — Logo [Upload…] · Trading name [Bar Casa Delgado] · ☐ Print the trading name
> above the legal name · Phone [+34 910 000 000] · Email [hola@casadelgado.es]
> **Translated text** — Español (receipts) · English (copies) · Català (copies) ⚠
> Subtitle [Tapas · Cócteles · Música] · Footer message [¡Gracias por su visita!]
> ⚠ = not yet translated; that copy prints the Spanish text. Legal name, tax number and address:
> Venue settings. Receipt language: Venue settings.
> Preview [Español ▾] — [logo] / Bar Casa Delgado / Tapas · Cócteles · Música / Casa Delgado S.L.
> / NIF B12345678 / Calle Mayor 1, Madrid / +34 910 000 000 / … / ¡Gracias por su visita!

Two things in it differ from the code and are settled by decisions 9 and 10: the mock offers
English, which Spain's pack does not list as a receipt language
(`packages/country-es/src/spain.ts:293`: `["es-ES", "ca-ES", "gl-ES", "eu-ES"]`); and the mock's
preview puts the subtitle above the legal name, where today's receipt prints it below
(`apps/server/src/receipt-document.ts:149-163`, pinned at `receipt-ticket.test.ts:2586-2640`).

---

## What this slice needs from slices 2 to 6

### 1. Every file this slice changes

**Part A (Tasks A1–A13).**

- `packages/shared/src/receipt-text.ts` (new) and its test, `packages/shared/src/index.ts`
- `packages/layouts/src/`: `types.ts`, `validate.ts` and its test, `errors.ts` and its test,
  `index.ts` and its test; `receipt-store.ts` and its test
  (deleted in A13), `defaults.ts`
- `packages/venue-service/src/`: `schema/receipts.ts` (new), `schema/index.ts`,
  `department-receipts.ts` (new) and its test, `classification.ts` and its test,
  `configuration-transfer.ts` and its test, `service.ts`, `index.ts`, `migrations.test.ts`,
  `routes.ts` (the `departments-and-zones` answer gains `isDefault`, `:584`) and its test;
  `drizzle/` (one generated migration)
- `packages/module/src/module.ts` (`VenueServiceContribution`)
- `packages/db/src/`: `schema/tenant-receipts.ts` (deleted), `schema/index.ts`, `index.ts:146`,
  `classification.ts:117` and its test, `configuration-transfer.ts:63`; `drizzle/` (one generated
  migration)
- `packages/media/src/images.ts` (`:91-92`, `:230-233`, `:267`, `:659-665`) and its test,
  `dashboard/client.ts:40`, `dashboard/image-library.ts:32`, `:44` and its test,
  `dashboard/live-queries.ts:11`, `dashboard/strings.ts` (`image.receipt_logo`), `module.ts:30`
  (`requires`, decision 5); `packages/media/package.json` (a dependency on `@waitron/venue-service`)
- `apps/server/src/`: `management-api.ts` (`:1228-1285`), `receipt-logo.ts`, `receipt-print.ts`
  (`:145-178`), `receipt-document.ts` (`:21-26`), `till-sale.ts` (`:203`, `:626-692`, `:829`,
  `:1364`, `:1514`), `bill-payments.ts` (`:741`, `:922-942`), `till-api.ts` (`:1182-1183`,
  `:1226-1230`), `invoice-document.ts` (`:91-92`), `invoice-choice-delivery.ts` (`:30-101`),
  `working-order.ts` (`:3436`, the one call of `checkedInvoiceChoiceDelivery`),
  `receipt-preview-api.ts` (`:191-309`), `sample-receipt.ts`, `venue-address.ts`,
  `testing/full-invoice-fixture.ts`, `configuration-import.test.ts` and
  `testing/fixtures/configuration-v1-before-printing-retirement.json:248`, and the tests listed in
  each task. The server needs no live-source change: its resource names come from the
  classification lists (`packages/venue-service/src/classification.ts:43-44`,
  `apps/server/src/live-resources.ts`)
- `apps/till/src/`: `layout.ts:10-19`, `api/client.ts` (`:95`, `:121-123`, `:835`),
  `till-app.ts` (`:1910`, `:2243`, `:8523`), `screens/till-ticket-view.ts` (`:461`, `:527-560`,
  `:685-689`), and their tests
- `apps/dashboard/src/`: `api/client.ts` (`:477-490`, `:2567-2602`), `api/live-queries.ts:316`,
  `screens/receipts-screen.ts` and its eight test files, `dashboard-app.ts:1676-1690`,
  `dashboard-app.venue-settings-unsaved.test.ts` (`:409`, `:498`), `i18n/strings.ts` (`:339-384`,
  `:899-900`, Spanish `:2783-2829`, `:3351-3352`), `i18n/codes.ts:445-456`,
  `api/client-routes.test.ts`, `api/client.test.ts`, and the app tests that stub `getReceipt`:
  `dashboard-app.a11y.test.ts:77`, `dashboard-app.test.ts:134`,
  `dashboard-app.unsaved-changes.test.ts:897`, `dashboard-app.settings-panels.test.ts:100`,
  `screens/receipts-screen.location.test.ts:50`, `content-languages-screen.test.ts` and its
  `.a11y.test.ts`, `api/live-queries.test.ts`
- `scripts/schema-constraints.test.ts:633`, `scripts/migration-upgrade.test.ts`
- `docs/developers/design-system.md` (any sentence that describes the Receipts page as
  venue-wide or its department picker as a preview choice; at 2026-10-08 the page is named at
  `:395`, `:1634`, `:1850`, `:1855`, `:2590`, `:2602`, `:2897`, `:2903`, `:3133` and `:3137`, none of
  which lists its fields; `:1850` describes "Preview department changes"), `docs/backlog.md`

**Part B (Tasks B1–B3, outline only).** The department page slice 6 builds (file unknown today;
`packages/venue-service/src/dashboard/venue-operations-screen.ts` is today's page),
`packages/dashboard-kit/src/contract.ts`, `apps/dashboard/src/dashboard-app.ts`,
`apps/dashboard/src/screens/receipts-screen.ts`, `packages/media/src/dashboard/image-library.ts`,
venue-service dashboard strings.

### 2. Does this slice need slice 2, 3, 4, 5 or 6?

| Slice | What it builds (spec) | Needed by this slice? | What was checked |
| --- | --- | --- | --- |
| 2 | Zone closed times, refusing new orders in a closed zone, named days, real weeks, the Calendar (§6 "Closed times", §7, §9.2, §13 item 2) | **Believed independent.** | Its plan lists receipts as out of scope (`docs/superpowers/plans/2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md:70-71`). A receipt's department comes from the sale's zone at issuance (`recordSaleReceiptHeader`, `operations.ts:614-627`, through `resolveSalePolicy`, `:571-612`); nothing in §6–§7 changes a zone's department or the sale paths that call it. |
| 3 | Manager extensions; station "Close for today" / "Open for today" on the till and kitchen display (§5, §8, §10, §13 item 3) | **Believed independent.** | Nothing in §5's extension or §10's controls prints a receipt. Both change `apps/till/src/till-app.ts` and `apps/server/src/till-api.ts` in different areas (this slice: the boot answer's `receipt` and the ticket view's input). |
| 4 | Station hours and fallbacks removed; period choices in routing cells; combined kitchen tickets on shared printers; Stations page slimmed (§8, §9.3, §13 item 4) | **Believed independent.** | §8's combined tickets are kitchen tickets (`apps/server/src/kitchen-print.ts`), a different print path from the receipt (`receipt-print.ts`). Shares only `packages/module/src/module.ts` and venue-service's classification, transfer list and migration journal. |
| 5 | Monitors; watchers retired (§9.4, §13 item 5) | **Believed independent.** | Its plan (`2026-10-08-a366-slice-5-monitors.md`) changes no receipt content; it edits a `devices` insert in `apps/server/src/receipt-print.test.ts:1437` (its Task A10b) and shares `module.ts`, venue-service's classification, transfer list, `index.ts` and journal, `till-api.ts`, `till-app.ts` and `apps/till/src/api/client.ts`. |
| 6 | Departments: the list, Settings and Zones tabs, "How orders start", service settings in the same words for department and zone; the tree table and old tabs removed (§6, §9.1, §13 item 6) | **Part A: believed independent. Part B: needs slice 6.** | §9.1 puts the Receipt tab on the department page slice 6 builds ("Receipt tab: section 11"), and §11's first line ("Print a receipt … with the zones that differ") is the §6 service setting slice 6 restates "in the same words for both". Part A changes no file of today's Departments page: its "Preview" link to `/manage/venue-settings/view/receipts?departmentId=<id>` (`venue-operations-screen.ts:1181-1184`) already opens the department Part A's Receipts page edits. No slice 6 plan exists, so Part B's tasks are outlined without file detail. |

**Conclusion.** Part A (Tasks A1–A13) is believed independent of slices 2 to 6 and can be built as
soon as slice 1 lands (it is believed independent of slice 1 too, by the diff search under
"Base"; waiting for slice 1 avoids a venue-service migration-number clash and re-basing the two
receipt tests slice 1 rewrites). Part B (Tasks B1–B3) needs slice 6's department page and must not
start before slice 6 lands.

### 3. Files shared with slices 2 to 6 (same files, different areas)

- **Slice 1 (unlanded):** `packages/module/src/module.ts`, `packages/venue-service/src/classification.ts`,
  `configuration-transfer.ts`, `apps/server/src/till-api.ts`, `apps/till/src/till-app.ts`,
  `apps/till/src/api/client.ts`, `apps/server/src/till-api.receipt.test.ts` (menu setup),
  `scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts`, the venue-service
  journal.
- **Slice 2:** venue-service `classification.ts`, `configuration-transfer.ts`, `index.ts`,
  `migrations.test.ts`, the journal, `packages/module/src/module.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/migration-upgrade.test.ts`, and `apps/server/src/working-order.ts`, `till-sale.ts`,
  `till-api.ts`, `apps/till/src/till-app.ts` (its plan's task file lists, around its lines
  697-707 and 772-799). Different functions: slice 2's refuse new orders in a closed zone.
- **Slice 3:** `apps/till/src/till-app.ts`, `apps/server/src/till-api.ts` (inferred from §10).
- **Slice 4:** `packages/module/src/module.ts`, venue-service classification, transfer list and
  journal (inferred from §8).
- **Slice 5:** as in the table; also `apps/server/src/working-order.ts`,
  `scripts/schema-constraints.test.ts` and `scripts/migration-upgrade.test.ts`.
- **Slice 6:** today's `venue-operations-screen.ts` (the "Preview" link Part A leaves alone; slice 6
  is expected to remove or move it), the department sale-policy routes
  (`packages/venue-service/src/routes.ts:723-766`, `:852-889`), venue-service dashboard strings.

A drizzle migration-number clash in any shared journal is repaired by regeneration, never by hand
(CLAUDE.md §3).

---

## Decisions this plan makes that the spec does not

Each has the default this plan builds; the owner may override any. **Decision 1 departs from the
approved spec's build order**; the rest fill gaps it leaves.

1. **Departs from §13 ("each slice is its own plan and pull request, in this order"): two pull
   requests, the first buildable before slices 2–6.** DEFAULT: Part A (Tasks A1–A13) is its own
   pull request, buildable as soon as slice 1 lands; Part B (Tasks B1–B3) is a second pull request
   after slice 6 lands. Why: everything but the Receipt tab's place on the department page is
   independent of slices 2–6, and Part A leaves a working editor (the Venue settings → Receipts page,
   one department at a time) for Part B to move. If slice 6's plan chooses to build the Receipt tab
   itself, Part B shrinks to what slice 6 leaves.
2. **Where the department's receipt is stored: a venue-service table.** DEFAULT:
   `department_receipts` (venue-service set): `department_id` primary key and foreign key to
   `departments.id`; `receipt` (JSON: `logo?`, `phone?`, `email?`, `printAddress?`,
   `headerSubtitle?` and `footerMessage?` each a map of receipt-language tag to text); `logo_rasters`
   (JSON, nullable: one raster per paper width, as `tenant_receipts` keeps inside its JSON today,
   `types.ts:18-26`); `updated_at`. Classified `state`; in venue-service's configuration transfer
   with `department_id` carried as `department_sale_policies.department_id` is
   (`packages/venue-service/src/configuration-transfer.ts:608`). No row means an empty receipt, as no
   `tenant_receipts` row means `DEFAULT_RECEIPT` today (`packages/layouts/src/defaults.ts:3`).
   Considered and rejected: keeping the rows in core keyed by `department_id`. A foreign key from a
   core table into venue-service's `departments` would make the core set name venue-service in its
   `requires` (`packages/composition/src/modules.ts:86-87`: "`requires` must name every set whose
   table this set's SQL `REFERENCES`"), and every module builds on core; without the key the
   column breaks CLAUDE.md §3's rule that an id column is a foreign key. (Inferred from those
   rules; not tried.)
3. **A sale's receipt reads its department's CURRENT text, as today's reads the venue's current
   text.** DEFAULT: the department is the one the sale recorded (`sale_receipt_headers.department_id`);
   the text is read live at every print, reprint, copy, A4 page and on-screen view, exactly as
   `getPrintedReceipt` is today (`receipt-print.ts:162`; pinned by `receipt-print.test.ts:2162`
   "reprints with the trim saved since, as it does the slogan", and
   `till-api.receipt.test.ts:2215`). The trading name and its switch stay the sale's snapshot
   (`receipt-print.test.ts:1873`). Nothing new is snapshotted per sale.
4. **A sale with no recorded department prints the default department's receipt.** A sale recorded
   with no zone stores `department_id` null (`operations.ts:620-626`), and a sale with no header row
   reads `null` (`readSaleReceiptHeader`, `:629-639`). Which sale paths reach either is not traced
   here; the rule is a safe default for both. DEFAULT: both use the location's department marked
   `is_default` (one per location, `departments_one_default_per_location_key`, `service.ts:42-44`),
   active or not — a disabled default can exist, because `deactivateDepartment` refuses only the
   last active department and does not read `is_default` (`operations.ts:269-275`). So the
   department receipt routes accept an inactive department of this location (decision 13), and the
   Receipts page lists the default department even when it is disabled, marked "(disabled)"
   (decision 14). If the location has no default department, the receipt prints no authored text.
5. **Media counts a department's logo by reading `department_receipts` directly.** DEFAULT:
   `packages/media` adds a dependency on `@waitron/venue-service` and reads the table as it already
   reads catalogue's (`packages/media/src/images.ts:200-233`); measured 2026-10-08 that no package
   in `@waitron/venue-service`'s dependency closure depends on `@waitron/media` (a script over every
   `package.json`), so no loop forms — the implementer re-runs `scripts/workspace-cycles.test.ts`.
   The usage becomes `{ kind: "receipt"; departmentId; departmentName }`, and the image library's
   link opens that department (`/manage/venue-settings/view/receipts?departmentId=<id>` in Part A).
   Media's descriptor names catalogue in `requires` (`packages/media/src/module.ts:30`); it names
   venue-service too, so the composition never enables media without the table it reads.
6. **The languages a department writes are the venue's receipt languages.** DEFAULT: the
   receipt-language choices of the installed country pack (`readVenueReceiptLanguageRules(...).choices`,
   `apps/server/src/venue-locale.ts:80-87`; Spain `es-ES`, `ca-ES`, `gl-ES`, `eu-ES`), plus the
   venue's current receipt language if it is not among them, the receipt language first. A key
   outside that list is refused `receipt.invalid` with `reason: "language_unknown"`, without naming
   the key (see Global constraints). These are the languages a copy can print in (`till-sale.ts:704-712`), so "each
   language a receipt or a copy can print in" (§11) is this list.
7. **Which text prints for a language.** DEFAULT, for the subtitle and the footer separately: the
   text written for the language being printed; if that is blank or missing, the text written for
   the venue's CURRENT receipt language (first of `locations.invoice_locales`); if that is blank
   too, the first text written in decision 6's order; otherwise nothing. The second step is §11's
   "its copy prints the receipt language's text". The third keeps a receipt from losing its text
   when the venue changes its receipt language to one nobody has written yet (Spanish written,
   receipt language changed to Catalan: Catalan receipts print the Spanish text until Catalan is
   written). An original or reprint prints in the sale's filed language (`sales.locale`).
8. **"Not yet translated" is per language.** DEFAULT: a language is marked ⚠ when another language
   has a subtitle or a footer that this language lacks — the receipt language included, so a venue
   that has just changed its receipt language sees it marked. When no language has a subtitle or a
   footer, nothing is marked: both fields are optional, as the slogan and footer are today.
9. **The mock's "English (copies)" is illustrative.** DEFAULT: the editor lists the languages of
   decision 6 — for a Spanish venue Spanish, Catalan, Galician and Basque, the receipt language
   labelled "(receipts)" and the others "(copies)" — and does not add English. Adding a language to
   Spain's receipt languages is outside this slice.
10. **The printed order of the top block does not change.** DEFAULT: logo, trading name, legal
    name, subtitle, address, phone, email, DUPLICADO, NIF, as today (`receipt-document.ts:149-163`,
    pinned exactly at `receipt-ticket.test.ts:2586-2640`). The mock's preview puts the subtitle
    above the legal name; the spec's text says nothing about order, and the order in the code is the
    one the receipt tests and the W111 work settled.
11. **"Print the address" moves to the department with the rest of the top block.** DEFAULT: it is
    in the same JSON today (`printAddress`, `types.ts:12-13`), §11's list of what stays in Venue
    settings names the address itself, not the switch, and a second department at the same premises
    may print its own phone and email without the street. The address lines themselves stay the
    location's (`locations.address_*`, edited in Venue settings → Venue details).
12. **The subtitle's label becomes "Subtitle" / "Subtítulo"** (today "Slogan" / "Eslogan",
    `apps/dashboard/src/i18n/strings.ts:899`, Spanish `:3351`), the spec's and the mock's word. Its
    hint stays "Printed under the legal name, e.g. a tagline" in substance.
13. **Who may edit a department's receipt: unchanged.** DEFAULT: the department receipt routes
    require `layout.configure`, as `GET/PUT /management-api/receipt` do today
    (`management-api.ts:1228-1285`), and accept any department of this location, active or not
    (decision 4); the preview accepts the same departments, where today it refuses an inactive one
    (`receipt-preview-api.ts:215-237`). The page stays a manager-only Venue settings panel
    (`dashboard-app.ts:276-282`, `requiresManager: true`). Part B shows the department page's Receipt
    tab only to someone who also holds `layout.configure`; the department page itself keeps
    `venue_service.manage` (`packages/venue-service/src/dashboard/index.ts:21`).
14. **Part A's Receipts page edits one department at a time, chosen on the page.** DEFAULT: today's
    "Preview for" picker (`receipts-screen.ts:1133-1143`, shown with two or more active
    departments, kept in `?departmentId=`) becomes "Department", above the department's fields, and
    picks what is edited as well as what is previewed. It lists the active departments, plus the
    default department marked "(disabled)" when it is disabled (decision 4); the departments list
    the page reads gains `isDefault` (`GET /management-api/venue-service/departments-and-zones`,
    `packages/venue-service/src/routes.ts:584`; client `getVenueDepartments`,
    `apps/dashboard/src/api/client.ts:2567-2572`). Without `?departmentId=` the default department
    is edited. The section heading "Every location" (`receipts.venue_wide`) becomes the department's
    name. With one department the picker is hidden and that department is edited. Switching
    department with unsaved edits to THAT department's receipt asks the leave question about that
    draft only; the receipt-language and description drafts (`receipts-screen.ts:213-248`) are the
    venue's and survive the switch. The app keeps letting a `departmentId`-only navigation through
    without its own page-leave question (`dashboard-app.ts:1676-1690`); the page asks instead. A
    save still in flight when the department changes commits to the department it was sent for and
    never into the newly picked department's draft. If the departments list fails to load, the
    page says so where the department section would be and the venue-wide section still works.
    The receipt language and the description stay on the page, below, in their own section, as
    today.
15. **The preview has its own language picker.** DEFAULT: "Preview" gains a language picker
    listing decision 6's languages, defaulting to the receipt language; the preview draws the
    picked language's subtitle and footer, with decision 7's fallback, and the fixed words in that
    language — as a copy in that language would print. Today the preview draws in the receipt
    language picked in the form (`receipts-screen.ts:509-512`, `:637-643`); that picker keeps
    choosing the receipt language and no longer drives the preview. The preview stays a GET with
    the draft in its query string (`client.ts:2591-2600`), and Node refuses a request head over
    16 KiB (`http.maxHeaderSize`; no override found in `apps/server/src`): sending every language's
    200-character texts could pass that (arithmetic, not measured: eight entries of 3-byte
    characters, URL-encoded, are about 14 KiB). So the dashboard resolves the picked language's two
    texts itself with Task A1's `resolveReceiptText` and sends a one-language map, keeping the query
    today's size. The resolver lives in `@waitron/shared`, beside `resolveContentText`, which the
    Receipts page already imports (`receipts-screen.ts:4`): the dashboard's production code imports
    nothing from `@waitron/layouts`, whose index "pulls @waitron/db into the browser bundle"
    (`apps/dashboard/src/screens/canvas-editor/card-contracts.ts:1-2`).
16. **The translated fields are one tab per language.** DEFAULT: a `wt-tabs` strip of decision 6's
    languages above the Subtitle and Footer message fields, as in the mock; a tab carries ⚠ per
    decision 8, and a note under the strip says what ⚠ means. Each language's fields are named
    `headerSubtitle-<tag>` and `footerMessage-<tag>` (semantic names, CLAUDE.md §3). A refusal that
    names a language opens that tab and shows the message under its field.
17. **Invoice-email consent quotes the sale's department's contact.** Today email delivery is
    offered only when the venue-wide receipt email is valid, and the consent must echo that email
    and phone (`apps/server/src/invoice-choice-delivery.ts:78-86`). DEFAULT: the check reads the
    department the order's zone belongs to (decision 4's default department when there is none),
    found with `VENUE_SERVICE.findOrderContext` as the sale paths do (`working-order.ts:5627`).
18. **The till's on-screen receipt takes its text from the sale, not from boot.** DEFAULT: the boot
    answer drops `receipt` (`till-api.ts:1182`) and sends the location's address unconditionally
    (`readLocationAddress`, `apps/server/src/venue-address.ts`); each sale and replay answer carries
    `receiptTrim` — the sale's department's logo, phone, email, `printAddress`, and the subtitle and
    footer resolved for the sale's language — and `till-ticket-view.ts` reads that. That includes
    the bill-payment answer: `bill-payments.ts:741` builds its own ticket with `receiptHeader`,
    returned to the till as `BillPaymentResult.invoice` (`apps/till/src/api/client.ts:980`), and
    `resultOf` (`bill-payments.ts:922-942`) reads `readSettledTicket` only when no ticket is passed.
19. **The store's reads never throw.** A receipt is built inside the sale's transaction
    (`receipt-print.ts:155-160`), so a throw there undoes the filed sale. Today's store drops a
    field of the wrong type and reads a malformed logo picture as none, on purpose, because a
    configuration import copies the row unchecked (`packages/layouts/src/receipt-store.ts:26-31`) and
    the read "runs inside a sale's transaction, where a throw would roll the sale back"
    (`:72-75`, returning `null` for a bad picture at `:76-83`). DEFAULT: the department store does the same field by field — a map that is not an
    object, an entry that is not a string, a picture that is not well formed — and an import of a
    configuration bundle is not validated for this table either, as today's is not.
20. **Saving keeps today's logo-picture rules.** DEFAULT: an unchanged logo reuses its stored
    pictures instead of drawing them again (today `management-api.ts:1258-1268` with
    `getStoredLogoRasters`, `receipt-store.ts:114-131`), and a logo is never written without a
    printable picture for every paper width (today `receipt-store.ts:133-149`). Both move to the
    department seats.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in this branch's worktree; never commit to `main`.
- A shipped migration file is never edited. New migrations only, generated by drizzle-kit against
  the current tree; the number is whatever it assigns.
- No data-migration code before go-live (CLAUDE.md §3): the venue-wide row is not copied into
  departments.
- Every foreign key is declared in the TypeScript schema; `department_receipts.department_id`
  references `departments.id`.
- Columns come from `packages/db/src/schema/columns.ts` (`id`, `json`, `tsString`), never straight
  from `drizzle-orm/sqlite-core` (guard `scripts/column-vocabulary.test.ts`).
- Error codes name the domain concept. `receipt.invalid` stays the refusal for authored text
  (`packages/layouts/src/errors.ts:8-23`) and gains an optional `language` param, set only to one of
  the venue's receipt-language tags: the file's rule is that no param echoes a caller-supplied value
  (`errors.ts:4-7`), so an unknown key is refused `reason: "language_unknown"` WITHOUT naming it, and
  the comment at `:4-7` is updated to say `language` is always a known tag. An unknown or
  other-location department is `department.not_found` (already used by the preview,
  `receipt-preview-api.ts:215-237`).
- venue-service functions take `cfg: VenueScope`. Multi-table writes take one `tx: Transaction`;
  queries on one transaction are awaited in turn, never `Promise.all`.
- The logo rasters are drawn OUTSIDE the transaction, as today (`management-api.ts:1274`).
- No authored field may suppress or reorder a mandated receipt element (`types.ts:3-6`). The QR
  block, the filed issuer, the F1 domicile and the invoice block are not touched.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; forms follow `docs/developers/design-system.md` → Forms and A331's save rule
  (`draftScopeFor` + `saveActionState` + an early return in the save handler; the Receipts page
  already has all three, `receipts-screen.ts:209-280`, `:797`), with the `*.unsaved.test.ts`
  reconnect case kept (#1422).
- Strings in English and Spanish.
- Coverage stays at 98/98/98/95 in every package touched. Of the packages this slice changes,
  `packages/shared` and `packages/db` are mutation-tested (CLAUDE.md §2 lists `ui`, `ui-core`,
  `shared`, `fiscal` and `db`; `packages/layouts` has no `mutation` script, checked 2026-10-08).
- Comments only for an invariant or a non-obvious why; no history. Cut the stale comment at
  `till-api.receipt.test.ts:2228-2229` when touching that case (it says the reprint must NOT read
  the current text; the assertions below it check that it does).

## Behaviour this slice removes

Tests pinning these may change, under the queue's 2026-10-05 rule:

- One venue-wide receipt text: `tenant_receipts`, `GET/PUT /management-api/receipt`
  (`management-api.ts:1228-1285`), `getReceipt` / `getPrintedReceipt` / `putReceipt`
  (`packages/layouts/src/receipt-store.ts`), the dashboard live query `getReceipt`
  (`apps/dashboard/src/api/live-queries.ts:316`), the till boot answer's `receipt`.
- A subtitle and a footer that are one string printed in every language.
- The "Every location" section heading and the "Slogan" label on the Receipts page.
- The Receipts page's "Preview for" picker choosing only what the preview draws, and a
  `departmentId`-only navigation keeping unsaved edits without asking
  (`dashboard-app.venue-settings-unsaved.test.ts:409`); the page now asks about the department's
  draft (decision 14).
- The preview refusing an inactive department (`receipt-preview-api.ts:215-237`).
- The preview drawing in the receipt language picked in the form.
- Media's receipt usage carrying no department (`packages/media/src/images.ts:91`).
- Invoice-email consent checked against the venue-wide email.

## Review focus

The conditions most likely to bite a person that no single task's happy path exercises. Each has
its test in the task named.

1. **A copy in a language not yet written.** The Restaurant writes a Spanish subtitle and a
   Catalan footer only, Spanish being the receipt language. A Catalan copy prints the Spanish
   subtitle and the Catalan footer; a Galician copy prints the Spanish subtitle and, having no
   Galician or Spanish footer, the Catalan one (decision 7's third step); a Spanish original prints
   the Spanish subtitle and the Catalan footer (Tasks A1 and A4).
2. **Two departments, one printer.** A Restaurant sale and a Deli sale printed one after the other
   on the same receipt printer each print their own logo, phone and footer; a reprint of the
   Restaurant sale made after the Deli's receipt was edited still prints the Restaurant's (Task A4).
3. **A sale with no department.** A sale whose header records no department, or that has no header
   row (set up directly in the test), prints the default department's text, also when that
   department is disabled; a location whose default department has no row prints none and still
   prints every mandated element (Task A4).
4. **A corrupt department row.** A department row with a number where a map should be, a
   non-string entry and a malformed logo picture: a sale under it still files and its receipt
   prints the mandated elements and whatever fields are well formed (Tasks A2 and A4).
5. **A department renamed or disabled after the sale.** Its sale's reprint keeps the trading name it
   was printed with (existing check) and prints the department's current text (Task A4).
6. **The receipt language changed.** An original reprint prints in the filed language; where that
   language has no text, the current receipt language's text; where neither has, the first written
   (Tasks A1 and A4).
7. **Unsaved edits and the department picker.** Edit the Restaurant's footer and the venue's
   description, pick Deli: the leave question asks about the Restaurant's receipt; Keep stays on
   Restaurant with the edit; Discard opens Deli clean and the description edit is still there. A
   Restaurant save that returns after Deli is picked does not change Deli's draft (Task A10).
8. **A logo shared by two departments.** The library counts two uses; deleting it is refused while
   either uses it; each use links to its own department (Task A8).
9. **Export and import.** A configuration bundle carries each department's receipt, logo rasters
   included, under the importing venue's department ids (Task A2).

---

## Part A — the receipt moves to departments (first pull request)

### Task A1: The per-language receipt shape, its validation and its resolver (shared, layouts)

**Files:** `packages/shared/src/receipt-text.ts` (new) and its test, `packages/shared/src/index.ts`;
`packages/layouts/src/types.ts`, `validate.ts`, `errors.ts`, `index.ts`, and their tests.

**Interfaces:**

```ts
// packages/shared/src/receipt-text.ts — browser-safe, imported by the dashboard (decision 15)
/** Receipt-language tag → text. A blank or missing entry means "not written". */
export type ReceiptText = Readonly<Record<string, string>>;

export function resolveReceiptText(
  text: ReceiptText | undefined,
  language: string,
  languages: readonly string[], // decision 6, receipt language first
): string | undefined; // decision 7

export function untranslatedLanguages(
  texts: readonly (ReceiptText | undefined)[], // the subtitle's and the footer's maps
  languages: readonly string[],
): string[]; // decision 8

// packages/layouts/src/types.ts and validate.ts
export interface DepartmentReceiptConfig {
  headerSubtitle?: ReceiptText;
  footerMessage?: ReceiptText;
  phone?: string;
  email?: string;
  /** Absent prints the location's address; `false` prints none. */
  printAddress?: boolean;
  /** A `@waitron/media` library filename. */
  logo?: string;
}

/** What one printed receipt shows: the two texts already resolved for its language. */
export interface PrintedReceiptTrim {
  headerSubtitle?: string;
  footerMessage?: string;
  phone?: string;
  email?: string;
  printAddress?: boolean;
  logo?: string;
}

export function validateDepartmentReceipt(
  value: unknown,
  languages: readonly string[], // decision 6, receipt language first
): DepartmentReceiptConfig; // throws receipt.invalid

export function printedTrimFor(
  config: DepartmentReceiptConfig,
  language: string,
  languages: readonly string[],
): PrintedReceiptTrim; // resolves both texts with resolveReceiptText
```

`ReceiptConfig` and `validateReceiptConfig` stay until Task A13 removes them.

- [ ] **Step 1: failing tests.** `packages/shared/src/receipt-text.test.ts`: decision 7's three steps — the exact
  language; a blank entry falls back to the receipt language (the first of `languages`); with that
  blank too, the first written in `languages`' order; nothing written → `undefined`; subtitle and
  footer resolved separately (Review focus 1); whitespace-only counts as blank.
  `untranslatedLanguages`: marked when another language has text this one lacks, the receipt
  language included; nothing marked when nothing is written. `validate.test.ts`: a map entry over
  200 characters is refused with `field: "footerMessage"` and that `language`; an unknown key is
  refused `reason: "language_unknown"` and the refusal's params do not contain the key; a non-object
  map, a non-string entry and an unknown top-level key are refused as today; blank entries are
  dropped from the result; phone, email, logo and `printAddress` keep today's rules
  (`validate.ts:18-63`).
- [ ] **Step 2:** run them; they fail because the module and functions do not exist.
- [ ] **Step 3:** implement. Add `language?: string` and `reason: "language_unknown"` to the
  `receipt.invalid` params (`errors.ts:8-23`), update the comment at `:4-7`, extend `errors.test.ts`.
- [ ] **Step 4:** `pnpm --filter @waitron/shared test:coverage` and `pnpm --filter @waitron/shared
  mutation` (its floor of 90 breaks the run, CLAUDE.md §2); `pnpm --filter @waitron/layouts
  test:coverage`. Prove the fallbacks by deletion too: remove each fallback step of
  `resolveReceiptText` in turn and watch a named case fail, then restore.
- [ ] **Step 5:** commit.

### Task A2: The `department_receipts` table, its store and its seats (venue-service)

**Files:** `packages/venue-service/src/schema/receipts.ts` (new), `schema/index.ts`,
`department-receipts.ts` (new) and its test, `classification.ts` and its test,
`configuration-transfer.ts` and its test, `service.ts`, `index.ts`, `migrations.test.ts`,
`packages/module/src/module.ts`; `packages/venue-service/drizzle/` (generated);
`scripts/schema-constraints.test.ts`, `scripts/migration-upgrade.test.ts` only if they fail and
the change is a list entry for the new table.

**Interfaces** (seats on `VenueServiceContribution`, beside `readSaleReceiptHeader`,
`module.ts:439-453`):

```ts
/** The stored receipt, rasters left out; `{}` when the department has none. Never throws on a bad row (decision 19). */
readDepartmentReceipt(tx, cfg, departmentId: string): Promise<StoredDepartmentReceipt>;
/** The stored receipt and the raster for one paper width (null when absent or malformed). */
readPrintedDepartmentReceipt(tx, cfg, departmentId: string, paperWidth: PaperWidth):
  Promise<{ receipt: StoredDepartmentReceipt; logo: StoredLogoRaster | null }>;
/** The stored rasters, for reuse when the logo is unchanged (decision 20). */
readDepartmentLogoRasters(tx, cfg, departmentId: string):
  Promise<{ logo: string; rasters: Record<PaperWidth, StoredLogoRaster> } | null>;
/** Refuses a logo without a raster for every paper width (decision 20). */
writeDepartmentReceipt(tx, cfg, departmentId: string, receipt: StoredDepartmentReceipt,
  logoRasters: Record<PaperWidth, StoredLogoRaster> | null): Promise<void>;
/** Decision 4: the sale's recorded department, else the location's default, else null. */
receiptDepartmentForSale(tx, cfg, saleId: string): Promise<string | null>;
/** Decision 4 for an order not yet a sale (decision 17). */
receiptDepartmentForOrder(tx, cfg, orderId: string): Promise<string | null>;
```

`StoredDepartmentReceipt` is declared in venue-service as plain JSON, as `tenant_receipts` keeps
its row free of the layouts type (`tenant-receipts.ts:14-16`); `apps/server` validates with
Task A1's `validateDepartmentReceipt` before writing. The `departments-and-zones` answer
(`routes.ts:584`) gains `isDefault` for decision 14.

- [ ] **Step 1: failing tests** (`department-receipts.test.ts`, `useVenueDb`): a department with
  no row reads `{}`; write then read round-trips both maps and the rasters; a second write replaces
  the first (upsert on `department_id`); the read leaves rasters out; a write for a department of
  another location is refused `department.not_found`; a write with a logo and no rasters is refused;
  decision 19's corrupt rows (inserted directly) read without throwing, dropping exactly the bad
  fields, and a malformed raster reads as `null`; `receiptDepartmentForSale` returns the recorded
  department, the default department when the header's department is null, the default department
  when there is no header row, the default department when it is disabled, and `null` when the
  location has no default; a disabled department's receipt still reads (Review focus 5);
  `departments-and-zones` names the default department.
- [ ] **Step 2:** watch them fail.
- [ ] **Step 3:** schema (decision 2), `classify("department_receipts", "state", STATE)`, the
  transfer entry beside `department_sale_policies` (`configuration-transfer.ts:608`), the store, the
  seats in `service.ts` and `module.ts`. Generate the migration with drizzle-kit for the
  venue-service set; it only adds a table.
- [ ] **Step 4:** a transfer test: export then import into a venue whose departments have other
  ids carries each receipt to the matching department, rasters included (Review focus 9).
- [ ] **Step 5:** guards: `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
  scripts/id-columns-are-references.test.ts scripts/column-vocabulary.test.ts
  scripts/module-graph-honesty.test.ts scripts/migrations-match-schema.test.ts
  scripts/migration-upgrade.test.ts`, then `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  inmutabilidad` (must pass unedited), `pnpm --filter @waitron/venue-service test:coverage`.
- [ ] **Step 6:** commit.

### Task A3: The department receipt routes (server)

**Files:** `apps/server/src/management-api.ts`, `receipt-logo.ts`,
`management-api.accounts-and-receipt-config.test.ts` (new cases beside the old), `boot.test.ts` if
it lists routes.

**Routes** (both `layout.configure`, decision 13; any department of this location, active or not):

- `GET /management-api/departments/:id/receipt` → `{ receipt: DepartmentReceiptConfig,
  languages: string[], untranslated: string[], venueAddress: string[] }` (`languages` per decision
  6, receipt language first; `untranslated` per decision 8; `venueAddress` the location's lines
  whatever the switch says).
- `PUT /management-api/departments/:id/receipt` `{ receipt }` → validate with
  `validateDepartmentReceipt(receipt, languages)`; a logo must exist in the media library (today's
  `logoNotFound`, `management-api.ts:405-407`); reuse the stored rasters when the logo is unchanged,
  else draw them outside the transaction (decision 20); write through `writeDepartmentReceipt`. A
  missing body is `management.request_invalid {field: "receipt"}`.

An unknown or other-location department is `department.not_found` (404).

- [ ] **Step 1: failing tests:** read of a department with no row; save and read back both maps;
  refusals — a 201-character Catalan footer names `field` and `language`; an unknown language
  (named in no param); a missing logo; another location's department; a person without
  `layout.configure` is refused as today's receipt route refuses; an inactive department is
  accepted; the rasters are written for both paper widths when a logo is saved, reused (not
  redrawn — spy on the drawing function) when a save keeps the logo, and cleared when it is removed.
- [ ] **Step 2:** watch them fail. **Step 3:** implement. The old `/management-api/receipt` routes
  stay until Task A13.
- [ ] **Step 4:** `pnpm exec vitest run scripts/errors-reachable.test.ts`, then the server's focused
  files.
- [ ] **Step 5:** commit.

### Task A4: Printing, reprints and copies read the sale's department (server)

**Files:** `apps/server/src/receipt-print.ts` (`buildReceiptBytes`, `:145-178`),
`receipt-document.ts` (`ReceiptTrim`, `:21-26`), and the tests named below.

`buildReceiptBytes` asks `receiptDepartmentForSale`, reads `readPrintedDepartmentReceipt` for the
printer's paper width, and builds the trim with `printedTrimFor(receipt, invoiceLocale,
languages)`, where `invoiceLocale` is the language being printed (`language ?? ticket.locale`,
`:173-177`) and `languages` is decision 6's list (the current receipt language from
`readReceiptLanguage`, `packages/catalogue/src/operations.ts:1345-1367`, first). The address
follows the department's `printAddress` (`readReceiptAddress`, `venue-address.ts`).

- [ ] **Step 1: failing tests** in `receipt-print.test.ts` and `receipt-language.test.ts`: Review
  focus 1 to 6, each as a print-bytes assertion on the ESC/POS text; Review focus 4 also asserts
  the sale filed (its fiscal record exists). A test helper that today writes a `tenant_receipts`
  row writes a department receipt instead — list each such helper in the pull request's "Changed
  test checks".
- [ ] **Step 2:** watch them fail.
- [ ] **Step 3:** implement. The till's own reprint and copy (`till-sale.ts:695-723`), the
  dashboard Orders reprint (`orders-reprint.ts:11-48`), the automatic original
  (`enqueueSaleReceipt`, `receipt-print.ts:202-225`) and the bill-payment print
  (`bill-payments.ts:755`) all reach `buildReceiptBytes`; check each by a test, not by reading.
- [ ] **Step 4:** change the existing checks that read the venue-wide row:
  `receipt-print.test.ts:943` ("prints the tenant's authored receipt trim from tenant_receipts"),
  `:2162` (stays a current-text check, now the department's), `:2021-2103` (top block),
  `till-api.receipt.test.ts:2215` (and cut its stale comment at `:2228-2229`). Each keeps its
  assertion strength and goes in "Changed test checks". `receipt-ticket.test.ts` takes a resolved
  `ReceiptTrim` and should need no change; if one of its checks fails, STOP.
- [ ] **Step 5:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`
  and `inmutabilidad` (must pass unedited); the server's focused files.
- [ ] **Step 6:** commit.

### Task A5: The A4 page and the invoice-email consent (server)

**Files:** `apps/server/src/invoice-document.ts` (`:91-92`), `invoice-choice-delivery.ts`
(`:30-101`), its one caller `working-order.ts:3436` (inside `setOrderInvoiceChoice`, reached from
`till-api.ts:1741`; it already has the order id and `order.locationId`),
`testing/full-invoice-fixture.ts`, and their tests (`invoice-document.test.ts:188-240`,
`invoice-pdf.test.ts`, `boot.invoice-delivery.test.ts`, `unpaid-invoice-delivery.test.ts`,
`bill-payments.test.ts`, `bill-payments-api.test.ts`).

- `readInvoiceDocument` reads the sale's department's text resolved for `sale.locale`.
- Decision 17: `checkedInvoiceChoiceDelivery` takes the order's department
  (`receiptDepartmentForOrder`) and checks the consent's `contactEmail`/`contactPhone` against
  that department's receipt.

- [ ] **Step 1: failing tests:** the A4 page of a Deli sale shows the Deli's footer in the sale's
  language; consent for a Restaurant order echoing the Deli's email is refused
  `management.request_invalid {field: "delivery.consent"}`, echoing the Restaurant's is accepted;
  email delivery is unavailable when the order's department has no valid email even if another
  department has one.
- [ ] **Step 2:** watch them fail. **Step 3:** implement. **Step 4:** change the existing checks
  that read the venue-wide row (`invoice-document.test.ts:188-240`'s `after.receipt`, the consent
  fixtures) and list them.
- [ ] **Step 5:** commit.

### Task A6: The preview takes a department receipt (server)

**Files:** `apps/server/src/receipt-preview-api.ts` (`:191-309`), `sample-receipt.ts`, and
`receipt-preview-api.test.ts`.

The query's `receipt` is a `DepartmentReceiptConfig` (validated with Task A1's validator against
decision 6's languages); `departmentId` picks the trading name and the department, any department of
this location, active or not (absent → the default department); `language` picks the printed
language (decision 15); the marks name `headerSubtitle` and `footerMessage` as today.

- [ ] **Step 1: failing tests:** the preview in Catalan draws the Catalan footer and, with none,
  the Spanish one; an inactive department previews; an unknown language key is refused as in
  Task A3.
- [ ] **Step 2:** watch them fail. **Step 3:** implement; the route's active-only filter
  (`receipt-preview-api.ts:232`) goes — no existing test pins it (`receipt-preview-api.test.ts:212`
  refuses a malformed and an unknown department, both still refused). **Step 4:** change the
  existing checks whose `receipt` fixture is a plain-string trim, and list them.
- [ ] **Step 5:** commit.

### Task A7: The till shows the sale's department's text

**Files:** `apps/server/src/till-sale.ts` (`TillSaleResult`, `:203`; the four answers that read the
header, `:679`, `:829`, `:1364`, `:1514`), `bill-payments.ts` (`:741`), `till-api.ts`
(`:1182-1183`), `apps/till/src/layout.ts` (`:10-19`), `api/client.ts` (`:95`, `:121-123`, `:835`,
`:980`), `till-app.ts` (`:1910`, `:2243`, `:8523`), `screens/till-ticket-view.ts` (`:461`,
`:527-560`, `:685-689`), and their tests (`till-ticket-view.test.ts:638`, `:1240-1330`,
`.a11y.test.ts`, `till-app.test.ts`, `api/client.test.ts`, `till-api.test.ts`,
`bill-payments-api.test.ts`).

Decision 18: `TillSaleResult.receiptTrim?: PrintedReceiptTrim`, filled for every answer that carries
`receiptHeader`, the bill-payment answer included; the boot answer drops `receipt` and its
`venueAddress` becomes the location's lines whatever any switch says; the ticket view prints the
address only when `receiptTrim.printAddress !== false`.

- [ ] **Step 1: failing tests:** server — a sale answer, a replay answer and a bill-payment answer
  each carry the sale's department's trim in the sale's language; till — the view draws the
  subtitle, footer, logo, phone and email from `receiptTrim`, hides the address when
  `printAddress` is `false`, and draws none of them when `receiptTrim` is absent.
- [ ] **Step 2:** watch them fail. **Step 3:** implement. **Step 4:** change the view's existing
  trim checks (`till-ticket-view.test.ts:1278-1330`) to feed `receiptTrim`; list them.
- [ ] **Step 5:** commit.

### Task A8: Media counts each department's logo

**Files:** `packages/media/package.json`, `src/module.ts:30`, `src/images.ts` (`:91-92`,
`:230-233`, `:267`, `:659-665`) and `images.test.ts`, `src/dashboard/client.ts:40`,
`dashboard/image-library.ts` (`:32`, `:44`) and its test, `dashboard/live-queries.ts:11`,
`dashboard/strings.ts` (`image.receipt_logo`).

- [ ] **Step 1: failing tests:** Review focus 8 — one logo used by two departments is listed twice,
  each with its department's id and name; the count is 2; a delete is refused while either uses it
  (today's refusal, by the same path); the library's text names the department and its link is
  `/manage/venue-settings/view/receipts?departmentId=<id>`.
- [ ] **Step 2:** watch them fail. **Step 3:** implement (decision 5); the live query depends on
  `department_receipts` and `departments` in place of `tenant_receipts`.
- [ ] **Step 4:** `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/module-seams.test.ts
  scripts/module-graph-honesty.test.ts scripts/live-subscriptions.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run`; `pnpm --filter @waitron/media test:coverage`.
- [ ] **Step 5:** commit.

### Task A9: The Receipts page edits one department (dashboard)

**Files:** `apps/dashboard/src/api/client.ts` (`ReceiptConfig` copy `:477-490`, the receipt methods
`:2567-2602`), `api/live-queries.ts:316`, `screens/receipts-screen.ts`, `i18n/strings.ts`, and the
tests: `receipts-screen.test.ts`, `.trim.test.ts`, `.top-block.test.ts`, `.save-state.test.ts`,
`.location.test.ts:50`, and every other dashboard test that stubs or names `getReceipt` (`grep -rln
getReceipt apps/dashboard/src`: at 2026-10-08 also the receipts page's `.a11y`, `.language`,
`.unsaved` tests, `content-languages-screen.test.ts` and `.a11y.test.ts`,
`dashboard-app.a11y.test.ts:77`, `dashboard-app.test.ts:134`,
`dashboard-app.unsaved-changes.test.ts:897`, `dashboard-app.settings-panels.test.ts:100`,
`dashboard-app.venue-settings-unsaved.test.ts`, `api/live-queries.test.ts`), `api/client.test.ts`,
`api/client-routes.test.ts`.

Decision 14, without the switching rules (Task A10). The page loads the departments
(`getVenueDepartments`, now with `isDefault`), picks `?departmentId=` or the default department,
reads `GET /management-api/departments/:id/receipt` through a new live query `getDepartmentReceipt`
(depending on `department_receipts`, `departments` and `locations`), and saves with `PUT` to the same
path. In this task the subtitle and footer are still edited as ONE field each, written to and read
from the receipt language's entry of the map; Task A11 adds the other languages.

- [ ] **Step 1: failing tests:** the department picker shows with two or more listed departments
  and is labelled "Department"; a disabled default department is listed marked "(disabled)"; the
  section heading is the department's name; with no `?departmentId=` the default department is
  edited; Save writes to the picked department's route only; with one department no picker shows
  and that department is edited; a departments list that fails to load shows its message where the
  department section would be, and the description still saves; the A331 cases in
  `.save-state.test.ts` hold for the department scope (opens quiet; untouched Save sends nothing;
  quiet after save).
- [ ] **Step 2:** watch them fail. **Step 3:** implement; `pnpm exec vitest run
  scripts/live-subscriptions.test.ts`.
- [ ] **Step 4:** change the existing checks this removes: the "Every location" heading, the
  "Preview for" label, the `/management-api/receipt` routes in `client-routes.test.ts` and
  `client.test.ts`, and the `getReceipt` stubs (a stub is fixture, the routes they answer are not);
  list each.
- [ ] **Step 5:** commit.

### Task A10: Switching department keeps edits safe (dashboard)

**Files:** `apps/dashboard/src/screens/receipts-screen.ts`, `dashboard-app.ts:1676-1690` (only if the
page's own question needs a hook there), and the tests `receipts-screen.unsaved.test.ts`,
`receipts-screen.test.ts`, `dashboard-app.venue-settings-unsaved.test.ts` (`:409`, `:498`).

Decision 14's switching rules: picking another department with unsaved edits to the current
department's receipt asks the leave question about that draft only; the language and description
drafts survive; a save in flight commits to the department it was sent for.

- [ ] **Step 1: failing tests:** Review focus 7 in full, in EN and ES; the same after a reconnect
  (#1422's case, beside `receipts-screen.unsaved.test.ts:298`); a Back navigation that changes only
  `departmentId` asks the same question; a switch with no department edits asks nothing.
- [ ] **Step 2:** watch them fail. **Step 3:** implement.
- [ ] **Step 4:** change `dashboard-app.venue-settings-unsaved.test.ts:409` (today department
  navigation keeps the edited appearance without asking; now it asks, and Keep keeps it) and list it.
- [ ] **Step 5:** commit.

### Task A11: Translated subtitle and footer (dashboard)

**Files:** `apps/dashboard/src/screens/receipts-screen.ts`, `i18n/strings.ts`, `i18n/codes.ts`
(`:445-456`), and the tests: `receipts-screen.trim.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.

Decisions 8, 9, 12 and 16: the "Translated text" block with one tab per language, ⚠ per decision 8
with its note, and the "Subtitle" label. The draft's snapshot copies the two maps deeply: today's
copies the body one level deep (`receipts-screen.ts:260-261`), which with maps would let an edit change
the saved copy too and leave the page looking unchanged.

- [ ] **Step 1: failing tests:** the tabs list the route's `languages` with the receipt language
  first and labelled "(receipts)", the rest "(copies)"; typing in the Catalan tab changes only the
  Catalan entry of the save body and makes the page dirty (the deep-copy case); a language with
  blank fields is absent from the body; ⚠ appears on Catalan when Spanish has a footer and Catalan
  has none, and goes when Catalan's is typed (before saving); a refusal naming `language: "ca-ES"`
  and `field: "footerMessage"` selects the Catalan tab and shows the message under its footer field
  and in the bottom message; Keep and Discard cover an edit made in a tab that is not showing; axe
  passes on the tabbed block with ⚠ in both themes.
- [ ] **Step 2:** watch them fail. **Step 3:** implement with `wt-tabs`, `wt-input` and
  `wt-textarea`; no hand-drawn field.
- [ ] **Step 4:** change the "Slogan" label checks and list them.
- [ ] **Step 5:** commit.

### Task A12: The preview's language, and the look pass (dashboard)

**Files:** `apps/dashboard/src/screens/receipts-screen.ts`, `api/client.ts` (`previewReceipt`,
`:2588-2602`), `i18n/strings.ts`, and the tests: `receipts-screen.language.test.ts`,
`receipts-screen.test.ts`, `.a11y.test.ts`.

Decision 15: the preview's own language picker; the request carries one language's resolved texts.

- [ ] **Step 1: failing tests:** the preview's language picker lists the route's `languages` and
  starts on the receipt language; picking Catalan requests the Catalan copy and the request's
  `receipt` holds one language's texts, resolved with decision 7 (Review focus 1); the
  receipt-language picker no longer changes the preview's language; switching department keeps the
  preview's language when the new department offers it.
- [ ] **Step 2:** watch them fail. **Step 3:** implement.
- [ ] **Step 4:** change `receipts-screen.language.test.ts`'s "preview in picked language" checks
  and list them.
- [ ] **Step 5:** LOOK at the whole page in EN and ES, both themes, 1280 and 390 wide, with one
  department and with three, with ⚠ showing and with a refused Catalan footer; save the screenshots
  for the FYI. A screenshot that shows a defect is fixed in this task.
- [ ] **Step 6:** commit.

### Task A13: The venue-wide receipt goes; documentation and backlog

**Files:** `packages/db/src/schema/tenant-receipts.ts` (deleted), `schema/index.ts`, `index.ts:146`,
`classification.ts:117` and its test, `configuration-transfer.ts:63`; `packages/db/drizzle/`
(generated); `packages/layouts/src/receipt-store.ts` and its test (deleted), `types.ts`
(`ReceiptConfig` removed or reduced to what remaining callers need), `validate.ts`
(`validateReceiptConfig` removed), `index.ts`; `apps/server/src/management-api.ts` (the
`/management-api/receipt` routes removed), `configuration-transfer.test.ts`,
`configuration-import.test.ts`, `testing/fixtures/configuration-v1-before-printing-retirement.json`;
`apps/dashboard/src/api/client.ts`, `api/live-queries.ts:316`; `scripts/schema-constraints.test.ts:633`;
`docs/developers/design-system.md`; `docs/backlog.md`.

- [ ] **Step 1:** `grep -rn 'tenant_receipts\|tenantReceipts\|getPrintedReceipt\|getStoredLogoRasters\|putReceipt\|getReceipt\b\|/management-api/receipt\b' apps packages scripts`
  lists every remaining reader; each is gone or switched by Tasks A3–A12 except the definitions this
  task deletes. `grep -rn 'REFERENCES.*tenant_receipts' packages/*/drizzle` finds no key into it.
  `packages/fiscal-verifactu/src/privileges.expected.ts:109` is a frozen record of the old engine's
  grants ("Nothing checks these letters against anything", its header) and stays unchanged;
  `scripts/write-path-tables.test.ts` reads only its read-only rows, and `tenant_receipts` is `SIU`.
- [ ] **Step 2: failing test first:** a core migration test (`packages/db`) that the migrated schema
  has no `tenant_receipts`. Read how a configuration import treats a bundle that still carries a
  `tenant_receipts` block — the fixture at
  `testing/fixtures/configuration-v1-before-printing-retirement.json:248` holds an empty one — and pin
  that behaviour with a test before deleting; say in the pull request which it is.
- [ ] **Step 3:** delete; generate the core migration with drizzle-kit. Remove the singleton check
  from `scripts/schema-constraints.test.ts:633` (a guard list entry for a table that no longer
  exists; name it in "Changed test checks").
- [ ] **Step 4:** guards as in Task A2 Step 5, plus `scripts/apply-migrations-callers.test.ts`,
  `scripts/append-only-migration-sets.test.ts`, `scripts/write-path-tables.test.ts`,
  `scripts/errors-reachable.test.ts`, `scripts/claude-md-pointers.test.ts`; the golden huella test
  and `inmutabilidad` (unedited).
- [ ] **Step 5:** docs: any `design-system.md` sentence describing the Receipts page as venue-wide,
  or its department picker as a preview choice (`:1850`), says it edits one department at a time with translated subtitle and footer; the backlog's A366
  entry says slice 7 Part A landed and Part B waits for slice 6 (open work only, under its area,
  per the backlog rule of 2026-10-08).
- [ ] **Step 6:** commit. The pull request's first line is the venue-reset line under "Venue
  reset".

---

## Part B — the department page's Receipt tab (second pull request, after slice 6) — OUTLINE

Slice 6's department page does not exist yet and no plan for it has been written, so these tasks
name what each does and not its files. Re-ground them on slice 6 as it lands: read its page, its
tab mechanism and where it left the trading name, "Print it" and the department's receipt print
mode when it removed the tree table (§13 item 6).

### Task B1: A seat for the Receipt tab

Today's Departments page is venue-service module code
(`packages/venue-service/src/dashboard/venue-operations-screen.ts`), and the Receipts editor is the
dashboard app's (`apps/dashboard/src/screens/receipts-screen.ts`). The module cannot import the app:
`apps/dashboard/package.json:24` depends on `@waitron/venue-service`, so the reverse import is a
workspace loop (guard `scripts/workspace-cycles.test.ts`). The module contract has no seat for the
app to add a tab to a module's page (`packages/dashboard-kit/src/contract.ts:56-63`). DEFAULT: the
department receipt editor from Part A becomes its own element in the app
(`dashboard-department-receipt`, property `departmentId`), and `DashboardModuleContext`
(`contract.ts:14-17`) gains an optional host hook the app fills, for example
`departmentReceipt?(departmentId: string, readOnly: boolean): TemplateResult`; the department page
renders its Receipt tab from that hook and hides the tab when the hook is absent or the person
lacks `layout.configure` (decision 13). Alternative the owner may prefer: move the editor, the
paper preview (`apps/dashboard/src/widgets/print-paper.ts`) and the logo upload into a shared
package and build the tab in venue-service.

### Task B2: The Receipt tab

As the mock-up: "Print a receipt" for the department with the zones that differ (a read-out line,
the zones edited on the Zones tab — §6, §9.1); "At the top": logo, trading name, "Print the trading
name above the legal name" (today's `print_trading_name`,
`packages/venue-service/src/schema/service.ts:106`), phone, email, "Print the address"; "Translated
text" (Task A11's block); the preview with its language picker. The trading name, the switch and the
print mode keep their current routes (`PATCH /management-api/venue-service/departments/:id` and
`/sale-policy/:field`, `packages/venue-service/src/routes.ts:694-766`) unless slice 6 changed them;
one Save covers the tab, so the tab holds one draft over both routes and reports a partial failure
as the Receipts page does today (`receipts-screen.ts:827-839`). A331's rule in full:
`draftScopeFor`, `saveActionState`, an early return in the save handler, and an
`*.unsaved.test.ts` with the reconnect case.

### Task B3: Venue settings → Receipts keeps the venue-wide part

The Receipts tab of Venue settings keeps the receipt language and the description sent to the tax
agency, and a line saying the rest of the receipt is set per department, linking to the
Departments page. Its department picker and department section go. The media library's receipt
link and any "Preview" link slice 6 kept open the department's Receipt tab. Docs and the backlog's
A366 entry.
