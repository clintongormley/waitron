# A918: starter content in the venue's languages at setup

**Status: plan, 2026-10-27, the fresh plan review folded in (0 Critical, 3 Important, 10 Minor,
`~/waitron-campaign-b/a918-plan-review.md`) under the driver's rulings of the same day; see "Review
rulings" at the end. Nothing was built when this was written; no code was changed.** Branch
`feat/a918-starter-content-translations`, from `main` at `f320bd194`. Four pull requests, one per
slice (below); this document holds full tasks for **slice 1** only, and a short paragraph for each
later slice, whose task list is written when it is picked up. **Slices 3 and 4 wait for the owner's
answer to FYI A**; slices 1 and 2 do not.

**No migration.** Every table that holds starter words already has the storage this design needs:
the two kinds of row that carry a name per language (void and comp reasons, units) keep a language
map today, and every other starter row holds one staff name, which this plan writes in one language
(decision 3, owner FYI A). Giving those rows a name per language would need a migration per table;
that is not proposed here.

**Not fiscal: no slice waits for the owner on fiscal grounds; slices 3 and 4 wait for the owner's answer to FYI A.** No starter word reaches a printed receipt,
invoice or filed record except the unit abbreviations, which are the same letters in every language
(`packages/catalogue/src/provisioning.ts:40-46`) and stay so (slice 4). Evidence and limits are under
"Printed and filed text" below.

Sources: the backlog entry **A918** (`docs/backlog.md:1981-1989`), A913's fix list
(`docs/backlog/architecture.md:423-530`, its "Point 1 → A918" bullet at `:435-440`), the audit's
Bucket D (`docs/backlog/english-only-audit.md:122-152`), and the rule
(`docs/developers/conventions-data.md:89-134`, root `CLAUDE.md:368-376`). Shape copied from
`docs/superpowers/plans/2026-10-27-a980-s1b-privacy-link-readers.md`.

## The owner's decision

> Owner (2026-10-19): "These default starter names in the general module should be in English only,
> and should be translated into Spanish and catalán etc when the box is set up only. There should be
> no text in Spanish in the general code."

> OWNER ANSWER (2026-10-20): "A — each module ships a translation file of its starter names (beside
> its screen translations), and setup writes every language the venue uses from it; the English-only
> check is taught to allow those files, and the written rule says so. … A becomes its OWN backlog
> item covering every module's starter content (reasons, «Cocina»/stations, device profiles, service
> steps, seasons, units)."

The facts lane C's question cited, re-checked on this tree:

| The question said | On `f320bd194` |
| --- | --- |
| By the time module seeds run, the venue's content languages are saved | **Partly.** The catalogue's seed saves them (`packages/catalogue/src/provisioning.ts:75-86`) and runs before venue-service's and adjustments' (composition order, `packages/composition/src/modules.ts:170`, `:187`, `:363`). But the kitchen station and the device profiles are written by core steps that run **before** any module seed (`packages/provisioning/src/venue-plan.ts:173-181`, `venue-apply.ts:302-310`), and the adjustments seed's own test database has no `content_languages` table (`packages/adjustments/src/provisioning.test.ts:12`). This plan does not rely on the saved row (decision 2). |
| The catalogue seed works them out from the country and province (`provisioning.ts:75-86`) | Yes: `resolveInstalledStartingContentLanguages({ country, area })` at `:75-78`, saved at `:83-86`. |
| A Valencia venue gets `ca-ES-valencia`, `es` and `en` | Yes: measured (probe 2 below), and pinned at `packages/catalogue/src/provisioning.test.ts:129`. |
| Staff screens are only Spanish or English (`packages/shared/src/locales.ts:7-10`) | Yes, `SUPPORTED_LOCALES` at `:7-10`. |
| «Cocina» is Spanish only | Yes, `packages/provisioning/src/venue-apply.ts:306`. |
| Device profiles and service steps are Spanish unless receipts are English | Yes: profiles take the first receipt language's subtag and fall back to Spanish (`packages/layouts/src/device-profile.ts:155-161`); steps are English only when the first receipt language is English (`packages/venue-service/src/service-steps.ts:125`). |
| Units are written in six languages inside general code (`provisioning.ts:12-39`) | Yes, `UNIT_NAMES` at `:12-39` and `UNIT_ABBR` at `:40-46`. |

## Words used here

- **Starter content**: the names and other words a person reads that Waitron writes into a new venue
  by itself, before anyone has typed anything: the nine void and comp reasons, the kitchen station,
  the three device profiles, the service steps, the four seasons, the counter zone, the "Open" menu
  period, the first menu and the five units.
- A **seed** is the code that writes it: a module's `provisioning.seed.run` (inside setup's one
  transaction, `packages/module/src/provisioning.ts:13-30`), or one of the core steps in
  `packages/provisioning/src/venue-apply.ts`.
- **Content languages**: the languages the venue writes customer text in, kept in the catalogue's
  one-row table `content_languages` (`packages/catalogue/src/schema/menu.ts:20-40`). A new venue
  starts with its area's default, the languages the area keeps enabled, then English
  (`resolveInstalledStartingContentLanguages`, `packages/country-packs/src/registry.ts:122-137`).
- **Staff language**: the language the staff screens can show, Spanish (`es`) or English (`en`)
  (`packages/shared/src/locales.ts:7-10`). This plan picks it for a venue in decision 3.
- **Receipt language**: the venue's first `locations.invoice_locales` entry. A real venue's is one of
  Spain's `es-ES`, `ca-ES`, `gl-ES`, `eu-ES` (`packages/country-es/src/spain.ts:293`; setup refuses
  any other, `apps/server/src/setup-api.ts:457-466`).
- A **language map** is a JSON column holding one text per language code, such as
  `adjustment_reasons.names` (`packages/adjustments/src/schema/reasons.ts:37`). A **one-name row** holds
  a single plain `name`, such as `kitchen_stations.name`.
- The **starter file** is the new translation file this plan adds to each package that writes
  starter content: `src/starter-content.ts` (decision 1).
- The **guard** is the English-only check: `packages/db/src/english-only.ts`, run by
  `scripts/english-only.test.ts` in the root test project. It refuses only words on a list (the base
  list `SPANISH_WORDS`, `english-only.ts:123-148`, plus each module's declared vocabulary) in the
  packages `GENERIC_PACKAGES` names (`:15-57`).

## The inventory: what a new venue gets today

Read from the tree, with `git grep` (the sweep below). "Languages written" is what the code writes
today, for a real venue.

| # | Starter content | Written by | Stored in | Languages written today | Slice |
| --- | --- | --- | --- | --- | --- |
| 1 | Nine void and comp reasons: "Entry error", "Item not available", "Customer changed mind", "Not served", "Other", "Complaint", "On the house", "Staff meal", "Discount" | `packages/adjustments/src/provisioning.ts:53-66`, written at `:68-84` | `adjustment_reasons.name` (plain, unique, `schema/reasons.ts:35`, `:49`) and `.names` (language map, `:37`) | English only: `name` and `names.en` (`provisioning.ts:76-80`) | 1 |
| 2 | Kitchen station «Cocina», the venue's default | `packages/provisioning/src/venue-apply.ts:302-310` (the create-location step) | `kitchen_stations.name`, one name (`packages/db/src/schema/kitchen-stations.ts:17`) | Spanish only, every venue | 2 |
| 3 | Device profiles «Mostrador»/"Counter", «Cocina»/"Kitchen", «Móvil»/"Handheld" | data at `packages/layouts/src/device-profile.ts:135-153`; name picked by `planVenue` (`packages/provisioning/src/venue-plan.ts:173-181`), written by `seedDeviceProfiles` (`venue-apply.ts:531-563`) | `device_profiles.name`, one name (`packages/db/src/schema/device-profiles.ts:37`) | the receipt language's subtag if it is `es` or `en`, else Spanish (`device-profile.ts:155-161`) | 2 |
| 4 | Service steps «Montar mesa»/"Set up", «Tomar nota»/"Take order", «¿Algo más?»/"Anything else?" | `packages/venue-service/src/service-steps.ts:110-138`; at setup (`provisioning.ts:63`) **and for every department a manager adds** (`operations.ts:214`) | `service_steps.name`, one name | English when the receipt language is English, else Spanish (`service-steps.ts:125`) | 3 |
| 5 | Seasons "Spring", "Summer", "Autumn", "Winter" | `packages/venue-service/src/season-rules.ts:24-33`, written by `ensureDefaultSeasons` (`seasons.ts:44-53`) at setup (`provisioning.ts:149`) and whenever a venue has none (`season-weeks.ts:62`, `:73`; `seasons.ts:82`) | `seasons.name`, one name, unique per venue (`schema/seasons.ts:27`, `:40`) | English only | 3 |
| 6 | Counter zone "Counter" | `packages/venue-service/src/provisioning.ts:103-111` | `floor_zones.name`, one name (`packages/db/src/schema/floor-zones.ts:18`) | English only | 3 |
| 7 | Menu period "Open" (weekdays 09:00-17:00) | `placeOpenPeriod`, `packages/venue-service/src/menu-timetable.ts:58-89` (name at `:73`); at setup (`provisioning.ts:153`) and for every new department (`operations.ts:220`) | `menu_periods.name`, one name (`schema/menus.ts:25`) | English only | 3 |
| 8 | Five units: Gram, Kilogram, Milligram, Millilitre, Litre | `packages/catalogue/src/provisioning.ts:12-46`, written at `:96-147` | `units.staff_name`, `staff_abbreviation` (plain) and `name`, `abbreviation` (language maps) | staff name English; maps in `en`, `es`, `ca`, `ca-ES-valencia`, `gl`, `eu` for every venue | 4 |
| 9 | The first menu "Menu", its root section "Menu" and home layout "Home" | `catalogue/src/provisioning.ts:153-156`; `createMenuShell`, `menu-structure.ts:31-48` (`HOME_SECTION_NAME`, `:28`), which also runs for every menu a manager adds | `catalogues.name`, `sections.internal_name` (plain); the root's `sections.names` stays `{}` | English only | 4 |

The sweep that found rows 5-9, which the backlog entry does not name:
`git grep -n -E '(name|internalName|staffName|tradingName|label|title): "[A-Z][a-z]' -- 'packages/*/src/**' ':!*.test.ts' ':!**/dashboard/**' ':!**/testing/**' …` (run 2026-10-27; the full exclusions are in "What was run"). It also printed these, **left out**, each for its reason:

- `EACH_UNIT` (`packages/catalogue/src/units.ts:28-36`): Spanish, Catalan, Galician and Basque words in
  general code, but never written into a venue (its comment, `:26-27`), so not starter content. The
  receipt reads its abbreviation to decide whether a line prints a unit
  (`apps/server/src/receipt-figures.ts:205-212`), so moving it can change printed words. Slice 4 adds
  a backlog entry for it; it is not built here.
- `"Order"` sent to Stripe (`packages/payments-stripe/src/stripe-hosted-client.ts:25`), and
  `"Fiscal readiness test"` (`packages/provisioning/src/fiscal-readiness-runner.ts:124`): not written
  into a venue's starter rows.
- The default department and node take the venue's own name (`venue-service/src/provisioning.ts:57-58`,
  `venue-plan.ts:198`), typed at setup: not starter words.

Out of scope, by default (only what a real new venue gets at setup):

- **The demo** (`apps/server/scripts/demo-seed/`, run by setup's "demo" mode,
  `apps/server/src/demo-seed.ts`) writes its own reasons, menu and floor in the area's languages; it is
  A972's. One trap is handled in slice 2 because that slice causes it: the demo finds the default
  station by the name `'Cocina'` (`apps/server/scripts/demo-seed/seed-catalogue.ts:44-56`).
- **Developer tools** (`apps/server/scripts/dev-setup.ts:213-316`): A975's.
- **Test helpers** with Spanish defaults (`packages/db/src/testing/seed.ts:44-52`, a default station «Cocina»,
  `apps/server/src/testing/*-venue.ts`): A976's.
- **A venue set up from a configuration export**: not checked by this plan. The export replaces every
  reason (`packages/adjustments/src/schema/adjustments.ts:60`). It also carries `kitchen_stations`,
  `device_profiles`, `floor_zones`, `seasons`, `menu_periods`, `service_steps`, `units`, `catalogues`
  and `sections` (the review's `git grep -l` over the configuration-transfer files); whether an
  import replaces those rows or merges into them was not looked at, and each later slice checks it
  before relying on its rows being written only at setup.
- **The audit's fourth real-venue row**, `apps/server/scripts/settle-invoice-first.ts:126-177`
  (`docs/backlog/english-only-audit.md:131`): not starter content, and the file no longer exists. It
  was deleted by A973 (`8ab1799a9`, #1967; `ls` of the path prints "No such file or directory"), as
  the audit's own dated note says (`english-only-audit.md:8`). So no backlog entry is added for it
  (review M8; see "Review rulings").

## Printed and filed text

Searched `apps/server/src/receipt-document.ts`, `invoice-pdf.ts`, `receipt-ticket.ts`,
`receipt-figures.ts` and `packages/country-es/src/receipt-labels.ts` for `reason`, `zone`, `period`,
`season`, `station`, `profile` and `unit` (run 2026-10-27; read, not run):

- **Reasons** are not printed on a receipt or invoice: no hit for `reason`. An adjustment records the
  name it showed (`adjustments.reason_name`, `packages/adjustments/src/schema/adjustments.ts:63`,
  written at `apps/server/src/adjustments-apply.ts:611`), which reports read; it is not filed with the
  tax agency.
- **Units**: a receipt line prints the quantity and the sold line's recorded unit text in the receipt
  language (`receipt-figures.ts:193-213`, called at `receipt-document.ts:283`, `:333`). That text is
  the unit's abbreviation (`docs/developers/products.md:280-292`), which is the same letters in every
  language today (`catalogue/src/provisioning.ts:40-46`). Slice 4 keeps every abbreviation equal to
  the staff abbreviation and pins it, so no printed word changes; its Task 0 checks that no unit's
  full name reaches a receipt, and if one does, that part is split into its own pull request parked
  for the owner.
- **Stations, zones, periods, seasons, profiles, menus**: no hit. A station's name prints on a kitchen
  ticket, which is not an invoice. The receipt's header prints the department's trading name
  (`receipt-document.ts:188-195`), which is the venue's own name, not starter text.

## What each slice builds

| Slice | Branch | What it builds | Visible change for a real venue |
| --- | --- | --- | --- |
| **1** | `feat/a918-1-starter-reasons` | The mechanism (decisions 1-6): the language helpers in `@waitron/country-packs`, the guard's allowance, the root `CLAUDE.md` and `conventions-data.md` wording; and the nine reasons from `packages/adjustments/src/starter-content.ts` | A Spanish venue's till shows the reasons in Spanish to Spanish-speaking staff and in English to English-speaking staff; the dashboard's reasons list shows the Spanish names; the reasons editor's "Name in Valencian/Catalan/Galician" fields are filled where the venue has that language |
| **2** | `feat/a918-2-station-and-profiles` | The kitchen station and the three device profiles from `packages/provisioning/src/starter-content.ts` and `packages/layouts/src/starter-content.ts`; the demo finds the default station by `is_default` | None (probe 2: every Spanish area's staff language is Spanish, so «Cocina», «Mostrador», «Móvil» stay) |
| **3** | `feat/a918-3-venue-service-starters` — **waits for FYI A** | Service steps, seasons, the counter zone and the "Open" period from `packages/venue-service/src/starter-content.ts`, at setup and when a department is added; the three places that find the starter period by the name "Open" | With FYI A's default: seasons, the counter zone and the period, English today, read in Spanish in a Spanish venue, for English-speaking staff too; steps unchanged |
| **4** | `feat/a918-4-catalogue-starters` — **waits for FYI A** | Units and the first menu's names from `packages/catalogue/src/starter-content.ts`; the `EACH_UNIT` backlog entry; A918 deleted from the backlog | Units carry only the venue's languages (owner FYI B); with FYI A's default, the first menu and the units' staff names, English today, are Spanish in a Spanish venue |

Slice 1 goes first; slices 2-4 depend only on it and on nothing of each other's except the shared
`conventions-data.md` sentence (Task 3 step 6; whichever lands later rebases onto it), and each leaves
`main` green on its own. Slices 3 and 4 wait for the owner's answer to FYI A; nothing is parked
on fiscal grounds.

**Why slices 3 and 4 wait and slices 1 and 2 do not** (driver ruling on review I1). FYI A's default
writes each one-name row in the staff language, which is Spanish in every Spanish venue (probe 2).
Where a row is **English today**, that takes words away from an English-speaking waiter or manager.
That is true of slice 3's seasons (`packages/venue-service/src/season-rules.ts:29-32`), counter zone
(`venue-service/src/provisioning.ts:105`) and period (`menu-timetable.ts:73`). It is equally true
of slice 4's first menu (`catalogue/src/provisioning.ts:153`) and units' staff names (`:99-139`),
which the driver's ruling did not name; verified here, so slice 4 waits too. Slice 2's rows are
**Spanish today** for every venue a real setup can make: the station is always «Cocina»
(`venue-apply.ts:306`), and the profiles take the receipt language's subtag, falling back to Spanish
(`device-profile.ts:155-161`), where every real receipt language is `es-ES`, `ca-ES`, `gl-ES` or
`eu-ES` (`spain.ts:293`, `setup-api.ts:457-466`). So slice 2 changes nothing a real venue sees (a developer's English demo does see its station
become "Kitchen", decision 3). FYI A's alternatives 2 and 3 would change slice 2's rows: with 2 the
slice would follow the answer, and with 3 its one-name rows are later extended by that migration
item, so slice 2 need not wait.
Slice 1's one-name field, a reason's plain name, is FYI C. Under the driver's ruling slice 1 does
not wait: a waiter whose account language is English still sees English on the till
(`reasonNameIn`, which falls back to the venue's language for an account with none saved,
`packages/identity/src/schema/persons.ts:47`, `:99`), and only the dashboard's reasons list and the
adjustments report's reason filter (`packages/adjustments/src/dashboard/adjustment-report-screen.ts:576`)
change (FYI C's example).

## What was run while writing this plan

- **By the plan's author:** reading and `git grep` (the greps named in each section), and three
  probes run with Vitest from a throwaway folder outside the repo (`/private/tmp/a918-probe`,
  `pnpm exec vitest run --root /private/tmp/a918-probe probe`, importing this tree's files by absolute
  path). No test in the repo was run and nothing in the repo was changed.
  - **Probe 1**, whether the guard would refuse the Spanish starter words: `findSpanish` over
    `export const x = { es: "<word>" };` with the guard's assembled word set (135 words). A refused
    word prints itself. Printed `[]` for every word tried («Cocina», «Mostrador», «Móvil», «Tomar
    nota», «Primavera»… «Gramo», «Litro»…) except `"Montar mesa" -> ["mesa"]`; the control
    `const nombreLector = 1;` printed `["nombre"]`.
  - **Probe 2**, the staff language and starting content languages for each kind of venue: the rows
    printed are the table under decision 3. A failing case for decision 3's claim would print
    `staff= en-GB` for a Spanish receipt or `staff= ca-ES` anywhere; none did.
  - **Probe 3**, the slice-1 starter file as written in Task 2 (all nine reasons, `es`, `ca`,
    `ca-ES-valencia`, `gl`): `findSpanish` printed `[]`; the control `{ es: "Queja del cliente" }`
    printed `["cliente"]`. So the real file would pass the guard **without** the allowance; Task 3's
    proof uses a fixture holding a listed word instead.
- One correction made while writing: a first search for tests used the pathspec
  `'apps/server/src/**/*.test.ts'`, which in git's default matching needs a sub-folder and missed
  every file directly in `src/`; the searches were re-run with `'apps/server/src/*.test.ts'`, which
  found `adjustments-api.test.ts` and `configuration-transfer.test.ts` (both checked: decision 4).

Every other claim below that a test proves is a prediction for the task that runs it, and says what
the failing case would print.

## Decisions this plan makes

The example venues: **Bar Ejemplo** in Valencia (content languages `ca-ES-valencia`, `es`, `en`;
receipts `es-ES`), **Bar Exemple** in Barcelona (`ca`, `es`, `en`; receipts fixed to `ca-ES`), and a
developer's English demo in Madrid (receipts `en-GB`).

1. **The starter file is `src/starter-content.ts` in the package whose seed writes the words.** It
   holds only data: one exported object per kind of starter, keyed by the starter's English text
   (units by their existing `seedKey`), each value the starter's words in the other languages. Typed
   with the `StarterTranslations` type from `@waitron/country-packs` (decision 5), so a missing
   language is a type error. English stays in the seed's code, where the rule allows it, and is the
   key, because the code already finds starters by English (`NOT_SERVED_REASON`,
   `packages/adjustments/src/provisioning.ts:49`, matched at `apps/server/src/adjustments-api.ts:276`).
   Why not `src/dashboard/starter-content.ts`, "beside its screen translations": only adjustments and
   venue-service have screen translations of their own (`packages/*/src/dashboard/strings.ts`); the
   catalogue's, layouts' and provisioning's screens keep their words in
   `apps/dashboard/src/i18n/strings.ts`, which no package can import; and no package's server code
   imports from its `dashboard/` folder today (`git grep -n 'from "\./dashboard/' -- 'packages/*/src/*.ts' ':!*.test.ts'`
   printed nothing). One path in every package lets the guard name one exact path. Owner FYI F.

2. **Each seed works out the venue's languages from its geography, as the catalogue's seed does,
   rather than reading the saved row.** A new function in `@waitron/country-packs`,
   `resolveInstalledStarterLanguages({ country, area, receiptLocale })`, answers the starting content
   languages (the catalogue's own `resolveInstalledStartingContentLanguages`, so the two always agree
   in setup's transaction) and the staff language (decision 3). Each seed reads `tenants.country`,
   `locations.province` and `locations.invoice_locales[0]` itself. Reasons: the core steps that write
   the station and the profiles run before the saved row exists; adjustments neither depends on the
   catalogue nor has its table in its test database (`provisioning.test.ts:12`); and reading the
   saved row needs the catalogue's table to exist, which only declaring the catalogue's set in
   adjustments' `requires` guarantees (`packages/module/src/module.ts:1589-1593`; a missing one
   throws `module.dependency_missing`, `:1672-1675`), for a single row. Cost: a seed re-run after a manager changed the
   content languages writes the setup-time languages. Every starter seed writes only when its rows
   are absent (`adjustments/src/provisioning.ts:72-74`, `seasons.ts:45-46`, `units` through
   `unit_seed_states`, `catalogue/src/provisioning.ts:90-95`), so a re-run writes nothing. Adding a
   department later (row 4, row 7) reads the same geography each time.

3. **A one-name row is written in the staff language: the receipt language when it is one the staff
   screens have (`es-ES`, `en-GB`), else the screen language the venue's geography gives.** This is
   not quite the venue's display language as the server defines it: `readVenueLocale`
   (`apps/server/src/venue-locale.ts:49-68`) is "DELIBERATELY separate from the location's receipt
   language" and takes only `WAITRON_TILL_LOCALE` as its override. For every venue a real setup can
   make the two agree (Spain's receipt languages, `spain.ts:293`; the UK pack is closed to setup,
   `packages/country-gb/src/united-kingdom.ts:13`). They differ for an `en-GB`-receipt demo or
   developer venue, and on a box with `WAITRON_TILL_LOCALE` set (`venue-locale.ts:52-54`, `:62`),
   which the staff language ignores. The demo or developer venue's starter rows come out English while its till, with `WAITRON_TILL_LOCALE`
   unset, shows Spanish screens and the reasons' `names.es`, and whose dashboard list shows the
   English plain name. The receipt override is kept so that an English demo stays English, as its
   profiles and steps are today. In code: `resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, { override: receiptLocale, country, area, fallback: FALLBACK_LOCALE })`
   (`packages/country-packs/src/registry.ts:46-73`), cut to its language subtag. The receipt
   language is a candidate only when it is one the screens show (`es-ES`, `en-GB`); `ca-ES` or
   `gl-ES` falls through to the area's and then the pack's default (`packages/country/src/country.ts:211-234`).
   Measured (probe 2):

   | Venue | Receipt | Staff language | Starting content languages |
   | --- | --- | --- | --- |
   | Madrid | `es-ES` | `es` | `es`, `en` |
   | Barcelona | `ca-ES` | `es` | `ca`, `es`, `en` |
   | Valencia | `es-ES` | `es` | `ca-ES-valencia`, `es`, `en` |
   | A Coruña | `gl-ES` | `es` | `gl`, `es`, `en` |
   | Madrid | `en-GB` | `en` | `es`, `en` |
   | Spain, no province | `es-ES` | `es` | `es`, `en` |
   | London (GB) | none | `en` | `en` |
   | no pack ("XX") | `es-ES` | `es` | `en` |

   That is exactly what the profiles and steps do today for every receipt language a real venue can
   have (row 3, row 4), so slice 2 changes nothing a real venue sees. The same staff language names a
   reason's plain `name` and a unit's staff name (decision 4). Owner FYI A.
   Example: Bar Exemple's station is «Cocina» and its profiles «Mostrador», «Cocina», «Móvil», as
   today; the English demo's station is "Kitchen".

4. **A language-map field gets the venue's content languages that the file carries, and English
   always; its plain name gets the staff language.** For the reasons: `names` holds `en` plus each
   of the venue's content languages the file has; `name` holds the staff-language text. English is
   always written because the Finish-table window finds its starting reason by `names.en ?? name`
   (`apps/server/src/adjustments-api.ts:276`), and `name` stops being English in a Spanish venue. The
   till already shows `names[operator language] ?? name` (`reasonNameIn`,
   `apps/server/src/adjustments-apply.ts:313-325`); the dashboard's list shows `name`
   (`packages/adjustments/src/dashboard/reasons-screen.ts:1177`) and its editor shows one field per
   content language (`:1362`). The demo, which renames starters into its own words, finds them by
   `names.en ?? name` (`apps/server/scripts/demo-seed/seed-adjustments.ts:187`), so it keeps working.
   Plain names are unique (`adjustment_reasons_name_key`, `schema/reasons.ts:49`; checked at
   `operations.ts:136-147`), so a manager in a Spanish venue who adds a reason called «Descuento»
   is now refused `adjustment_reason.name_taken`, as one adding "Discount" is today; no test creates a
   reason with one of the nine new Spanish plain names after a full setup (searched: the `Descuento`
   hits are sale lines, `adjustments-api.test.ts:1159` is a displayed answer). Owner FYIs B and C.
   Example: Bar Ejemplo's "Customer changed mind" is stored as `name` «Cambio de opinión» and `names`
   `{ en: "Customer changed mind", "ca-ES-valencia": "Canvi d'opinió", es: "Cambio de opinión" }`; a
   Spanish-speaking waiter sees «Cambio de opinión», an English-speaking one "Customer changed mind".

5. **The helpers live in `@waitron/country-packs`, in a new `src/starter-languages.ts`.** It exports
   `STARTER_CONTENT_LANGUAGES` (`es`, `ca`, `ca-ES-valencia`, `gl`: every language other than English
   that a new venue can start with in an installed pack's area), the types `StarterContentLanguage`,
   `StarterStaffLanguage` (`"es" | "en"`) and `StarterTranslations<L>`, and three functions:
   `resolveInstalledStarterLanguages`, `starterNames(file, english, languages)` and
   `starterName(file, english, staffLanguage)`. Its test computes the languages every installed pack
   can start a venue with and requires them to equal `STARTER_CONTENT_LANGUAGES`, so a new pack or
   area that can start in another language fails the build until every starter file carries it.
   `eu` is not among them: no area starts with Basque (Bizkaia starts with `es`, `en`, probe 2 and
   `catalogue/src/provisioning.test.ts:132`). Why this package: every seed that writes starter words
   depends on it or can (the catalogue, venue-service and provisioning already do; adjustments gains
   it, `@waitron/country-packs`'s own dependencies are `country`, `country-es`, `country-gb` and
   `shared`, none of which reaches adjustments); it holds the derivation the languages come from; and
   it is not mutation-tested, where `@waitron/shared` is, on every pull request that touches it
   (`docs/developers/ci-and-gates.md:414`).

6. **A starter with no entry in its file is written in English, and setup does not stop.** Setup
   runs in one transaction (`packages/provisioning/src/venue-apply.ts`, the seed loop at `:349-394`),
   so a throw would undo the whole venue over a missing translation. Each package's test pins that
   every starter has an entry and every entry is a starter, which is where a missing entry is caught.

7. **The guard skips the file by exact path at the top of a package's `src/`.** A new constant
   `STARTER_CONTENT_FILE = "starter-content.ts"` in `packages/db/src/english-only.ts`, matched by
   equality with the path relative to `src/`, beside the existing `I18N_CATALOGUES` (`:89-98`), whose
   pinned value does not change. A file of that name in a sub-folder, or with a prefix, is still
   scanned. Today's starter words would pass the guard anyway (probe 3); the allowance is what makes
   them legitimate under the written rule, and what A977's wider check (every text file, accented
   letters, `docs/backlog/architecture.md:524-528`) will rely on.

8. **The root `CLAUDE.md` line and `conventions-data.md` say so, in slice 1.** Exact words in Task 3.

9. **Review path: FULL** for slice 1. Risk trigger: a cross-package contract (new exports from
   `@waitron/country-packs`, read by four packages, and a new dependency of `@waitron/adjustments`).
   No fiscal invariant, tenant isolation, migration, grant, permission or concurrency change.

## Proposed words for slice 1

Six of nine reuse the demo's own translations (`apps/server/scripts/demo-seed/seed-adjustments.ts:26-111`);
the owner's question supplied «Cambio de opinión» and Valencian «Canvi d'opinió». Marked **new** are
Waitron's own, unchecked by a native speaker (owner FYI D).

| English (the key) | `es` | `ca` | `ca-ES-valencia` | `gl` | Source |
| --- | --- | --- | --- | --- | --- |
| Entry error | Error al marcar | Error en marcar | Error en marcar | Erro ao marcar | demo `:27-31` |
| Item not available | Producto agotado | Producte no disponible | Producte no disponible | Produto non dispoñible | demo `:43-47` |
| Customer changed mind | Cambio de opinión | Canvi d'opinió | Canvi d'opinió | Cambio de opinión | owner's question; demo `:61-63` (the demo's Spanish «Cambio del cliente» is not used: the guard refuses `cliente`, `conventions-data.md:111-118`) |
| Not served | No servido | No servit | No servit | Non servido | demo `:75-79` |
| Other | Otro motivo | Altre motiu | Altre motiu | Outro motivo | demo `:91-95` |
| Complaint | Queja | Queixa | Queixa | Queixa | demo `:109-111`; Spanish shortened from the demo's «Queja del cliente» for the same reason |
| On the house | Invitación | Invitació | Invitació | Invitación | **new** |
| Staff meal | Comida de personal | Àpat del personal | Menjar del personal | Comida do persoal | **new** |
| Discount | Descuento | Descompte | Descompte | Desconto | **new** |

## Open decisions for the owner (FYI; slices 1 and 2 are built with the defaults, slices 3 and 4 wait for the answer to A)

- **A. A one-name row gets one language: the staff language** (decision 3). **Slices 3 and 4 wait
  for this answer.** Worked examples:
  - *Your own example, the English-speaking waiter.* You chose the design whose example was "a
    Spanish-speaking waiter sees «Cambio de opinión»; an English-speaking one sees "Customer changed
    mind"". That holds for the reasons, which keep a name per language. It cannot hold for a
    one-name row. In Bar Ejemplo today, an English-speaking waiter or manager sees the seasons
    "Spring", "Summer", "Autumn", "Winter", the counter zone "Counter" and the menu period "Open"
    (`season-rules.ts:29-32`, `venue-service/src/provisioning.ts:105`, `menu-timetable.ts:73`). With
    the default, a **newly set-up** Spanish venue gets them as «Primavera», «Verano», «Otoño»,
    «Invierno», «Mostrador» and «Abierto», for everyone, that waiter included (the seeds write only
    rows that are absent, decision 2, so no existing venue's rows change). Slice 4 does the same to
    the first menu (a new venue's «Carta» where today it is "Menu") and the units' staff names
    («Gramo» where today it is "Gram").
  - *The regional languages.* Bar Ejemplo in Valencia gets its reasons in Valencian, Spanish and
    English, but one kitchen station «Cocina» and the Spanish names above, because those rows hold
    one name and its staff screens are Spanish.
  This departs from "writes every language the venue uses" for those rows only, because the tables
  cannot hold more without a migration. Alternatives:
  1. **Keep the one-name rows as they are today**: the seasons, counter zone, period, first menu and
     units' staff names stay English, and the station, profiles and steps stay as they are (Spanish
     for every real venue). Only their words move out of general code. The English-speaking waiter
     loses nothing, and the Spanish-speaking one keeps today's English words.
  2. **Write those rows in the venue's default content language**: Bar Ejemplo's and Bar Exemple's
     station is «Cuina», among Spanish screen words. This and alternative 3 are the answers that
     change slice 2's rows.
  3. **Give stations, profiles, steps, seasons, zones, periods, menus and units' staff names a name
     per language**: a migration per table, and its own item.
- **B. A language map gets only the venue's content languages, plus English** (decision 4). Worked
  example: a Madrid venue (`es`, `en`) gets its reasons in Spanish and English; if the manager later
  adds Catalan, the nine reasons' "Name in Catalan" fields are empty and must be filled by hand. In
  slice 4 the same rule means a Madrid venue's units no longer get the Catalan, Galician and Basque
  names they get today. Alternative: write every language the file carries, so a language added
  later is already filled for the starters.
- **C. A reason's plain name is in the staff language, not English** (decision 4). Worked example:
  Bar Ejemplo's dashboard lists «Error al marcar», «Producto agotado»…, and a manager who adds a
  reason «Descuento» is told the name is taken. An English-speaking manager there sees that Spanish
  list, and the same names in the adjustments report's reason filter
  (`adjustment-report-screen.ts:576`), where today both are English. On the till a waiter whose
  account language is English still sees "Entry error" (`reasonNameIn`); one with no language saved
  sees the venue's, Spanish. Alternative: keep the plain name English; the
  dashboard list then shows "Entry error" to a Spanish manager while the till shows «Error al
  marcar».
- **D. The Catalan, Valencian and Galician words ship unchecked by a native speaker** (the table
  above: three rows are new). Worked example: Bar Exemple's editor shows «Àpat del personal» in
  "Name in Catalan"; staff never see it on the till, which shows only Spanish or English. The pull
  request lists the new words for a native speaker to check. Alternative, as A980 S1b2 chose for a
  customer-facing notice: leave the regional languages out until checked, so those editor fields
  start empty.
- **E. A language the file lacks is left out; English is always written.** Worked example: none can
  happen at setup today, because the test in decision 5 fails the build when an installed pack can
  start a venue in a language the starter files lack; a future Portuguese pack starting venues in
  `pt` would fail it until the words are added. Were it bypassed, a Lisbon venue's reasons would
  carry English, and staff would see the plain name. Alternative: Spanish words in a missing
  language, which suits only Spain.
- **F. The file is `src/starter-content.ts`, not `src/dashboard/starter-content.ts`** (decision 1).
  Worked example: the reasons' words sit in `packages/adjustments/src/starter-content.ts`, one folder
  above the reasons screen's `src/dashboard/strings.ts`. Alternative: `src/dashboard/` for the two
  packages that have one, and `src/` for the rest, with two paths for the guard to allow.

## Global constraints

- **TDD.** Each task writes its failing test first, runs it, and watches it fail for the reason
  named; then the code. Where a case pins behaviour that already holds, the task says so and names
  the control that makes it fail.
- **English only.** Spanish, Catalan and Galician appear only in
  `packages/adjustments/src/starter-content.ts` and the Spanish guide (`apps/server/src/guide/es/`).
  No test spells a non-English word: expected text is read from `STARTER_REASON_NAMES`
  (`expected[english].es`), as screen tests read their strings file. Language codes (`es`,
  `ca-ES-valencia`) are codes, not words, and may be written. One exception, the guard's own
  suite: its subject is Spanish words, and it already spells them (its `FIXTURE` set,
  `scripts/english-only.test.ts:32-50`), so Task 3's fixture `{ es: "Mesa" }` follows that
  precedent.
- **Fixtures use venues the two sides could treat differently**: Valencia (default content language
  `ca-ES-valencia`, not `ca`; staff language `es`), Barcelona with `ca-ES` receipts (a receipt
  language the screens cannot show), Madrid with `en-GB` receipts (the receipt overrides the area),
  and London (one content language). A seed that wrote every file language, or took the staff
  language from the content default, fails at least one.
- **Every database test uses `useVenueDb`** (`@waitron/db/testing/venue-db.js`), as the files named
  already do. Exact shapes use `toEqual` (a `toMatchObject` checks only the keys listed).
- **No new error code, no log line, no migration, no change to any receipt, invoice, filed record,
  recorded adjustment, or stored snapshot.** Adjustments already recorded keep their names.
- **Coverage**: every package and the root hold 98/98/98/95; no exclude or ignore comment.
  `@waitron/country-packs` and `@waitron/adjustments` are not mutation-tested; `packages/db/src/english-only.ts`
  is outside db's mutation list (`packages/db/stryker.config.json:7`) and measured by the root project
  (`vitest.config.ts:121`).
- **A manifest change needs the lockfile.** After editing `packages/adjustments/package.json`, run
  `pnpm install` so `pnpm-lock.yaml` matches; the pre-push hook installs frozen.
- **New server test files: none.** New cases go into the files named.
- **Greps** use `'packages/*/src/*.ts'`-style pathspecs (git's default matching lets `*` cross `/`;
  `src/**/*.ts` needs a sub-folder). Call `/usr/bin/grep` where an exit status decides.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each check's
  state.
- Under an AI agent Vitest hides a passing test's console output; read each run's `Tests` line.

## Changed test checks (slice 1)

The owner's decision changes what a new venue's reasons are called, so these assertions change. Each
is named in its task's commit and the pull request lists them all. Any other existing assertion that
has to change is a STOP: say why in the handover.

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `packages/adjustments/src/provisioning.test.ts:33` (title) and `:64-76`; its call (`:34`) becomes `provisionedNode({ country: "ES", province: null, invoiceLocales: ["es-ES", "en-GB"] })` | "named in English only even where the venue's language is Spanish"; each `[name, names]` is `[english, { en: english }]` | each is `[expected[english].es, { en: english, es: expected[english].es }]` for that Spain-no-province venue (content languages `es`, `en`, staff `es`); title says the reasons are named in the staff language with a name in each content language | 2 |
| `packages/adjustments/src/provisioning.test.ts:93-113`; its call (`:94`) becomes `provisionedNode({ country: "ES", province: null, invoiceLocales: ["en-GB", "es-ES"] })`, the `country: "ES"` being what makes `es` appear in `names` | an `en-GB`-first venue: `names` equal `{ en: name }` (`:99-101`), plain names English (`:102-112`) | `names` equal `{ en: name, es: expected[name].es }`; the plain names stay English, unedited; the title (`:93`, "names it in English only…") becomes false and changes, to say the plain name is English and the map holds each content language | 2 |
| `packages/adjustments/src/provisioning.test.ts:116`, `:127` (the two "adds nothing" cases) | call `provisionedNode(["es-ES"])` | call the helper's new object form, `{ country: "ES", province: null, invoiceLocales: ["es-ES"] }`; their assertions do not change | 2 |
| `apps/server/src/default-cancel-reason.test.ts:72-82`, and `:51` | the till lists the nine English names; `startsFinishTable: name === "Not served"` | the nine `es` names from `STARTER_REASON_NAMES` (a Madrid venue, `es-ES`, `apps/server/src/testing/bill-venue.ts:64`, `:145`), compared against `expected["Not served"].es` | 3 |
| `apps/server/src/default-cancel-reason.test.ts:133` | `reason.name === "Not served"` | `reason.names.en === "Not served"` | 3 |
| `apps/server/src/default-cancel-reason.test.ts:151` | `toEqual(["Not served"])` | `toEqual([expected["Not served"].es])` | 3 |
| `apps/server/scripts/demo-seed/seed-adjustments.test.ts:102-103` | "On the house" keeps `names` `{ en }` and the plain name "On the house" | `names` `{ en: "On the house", es: expected["On the house"].es }`, plain name the `es` text (an `es-ES` venue, `:76`) | 3 |

Predicted **unchanged**, each run unedited in Task 3: `packages/provisioning/src/venue-apply.test.ts:267`
(the report text, A912's); `apps/server/scripts/demo-seed/seed.test.ts:718-731` (an `en-GB` demo,
`:33`, `:43`, so the plain names stay English); `seed-adjustments.test.ts:44-70`, `:106-190`;
`apps/server/src/adjustments-api.test.ts:1146-1215` (its own reasons, found by id or with
`arrayContaining`); `apps/server/src/configuration-transfer.test.ts:1795-1900` (counts and a
round trip).

## Review focus (slice 1)

- **Languages**: the reasons' maps hold exactly the venue's content languages the file has, plus
  English; never `gl` in Valencia, never `ca` for `ca-ES-valencia`. The plain name follows decision 3:
  Spanish for a `ca-ES` receipt, English for `en-GB`.
- **The Finish-table start** still finds "Not served" in a Spanish venue (`default-cancel-reason.test.ts`).
- **The guard**: skips exactly `src/starter-content.ts`; the fixture control fails both ways
  (Task 3 step 4).
- **No Spanish outside the starter file and the Spanish guide**: `git diff main...HEAD` grepped for
  accented letters and the table's words (Task 4 step 4).
- **Codex run-it seat**: two reviews, the second told to set this plan aside.

---

# Slice 1 — `feat/a918-1-starter-reasons`

## Task 0: re-check before dispatching (the driver, not an implementer)

Run on the branch's then-current tip; if anything differs, fix the plan before Task 1.

1. `git grep -n "names: { en }" -- packages/adjustments/src/provisioning.ts`: expected `:16` and `:37`
   (on `f320bd194`).
2. `git grep -n "starter-content\|STARTER_CONTENT\|starterNames\|resolveInstalledStarterLanguages" -- packages scripts`:
   expected nothing, exit 1.
3. `git grep -n "country-packs" -- packages/adjustments/package.json`: expected nothing, exit 1.
4. `sed -n 155,175p packages/composition/src/modules.ts` and `sed -n 345,365p` of the same: catalogue
   before adjustments (decision 2 does not depend on it; recorded for slices 2-4).
5. `git grep -n "Not served\|Customer changed mind" -- 'apps/server/src/*.test.ts' 'apps/server/scripts/*.test.ts' 'packages/*/src/*.test.ts' ':!*/dashboard/*'`:
   expected only the files in "Changed test checks" and the predicted-unchanged list.

## Task 1: the starter-language helpers in `@waitron/country-packs`

Files: `packages/country-packs/src/starter-languages.ts` (new), `packages/country-packs/src/starter-languages.test.ts`
(new), `packages/country-packs/src/index.ts` (one `export * from "./starter-languages.js";`).

The shape (decision 5):

```ts
/** Every language other than English that a new venue can start with in an installed pack's area. */
export const STARTER_CONTENT_LANGUAGES = ["es", "ca", "ca-ES-valencia", "gl"] as const;
export type StarterContentLanguage = (typeof STARTER_CONTENT_LANGUAGES)[number];
/** The staff screens' languages (`SUPPORTED_LOCALES`), as language subtags. */
export type StarterStaffLanguage = "es" | "en";
/** A starter's words in other languages, keyed by its English text. */
export type StarterTranslations<L extends string> = Readonly<
  Record<string, Readonly<Record<L, string>>>
>;
export interface StarterLanguages {
  /** The venue's starting content languages, English included. */
  readonly languages: readonly string[];
  readonly staffLanguage: StarterStaffLanguage;
}
export function resolveInstalledStarterLanguages(input: {
  readonly country?: string | null;
  readonly area?: string | null;
  readonly receiptLocale?: string | null;
}): StarterLanguages;
/** `english` under `en`, and its text in each of `languages` its entry has; nothing else. */
export function starterNames(
  file: StarterTranslations<string>,
  english: string,
  languages: readonly string[],
): Record<string, string>;
/** Its text in the staff language; `english` for `en` or a starter with no entry. */
export function starterName(
  file: StarterTranslations<string>,
  english: string,
  staffLanguage: StarterStaffLanguage,
): string;
```

1. Tests first, in `starter-languages.test.ts`, against a small fixture file of two starters with
   **made-up English-letter words** (`{ Alpha: { es: "alpha-es", ca: "alpha-ca", "ca-ES-valencia": "alpha-val", gl: "alpha-gl" } }`),
   so no Spanish is spelt:
   - `resolveInstalledStarterLanguages`: an `it.each` over decision 3's table, all eight rows, each
     expecting the literal `languages` and `staffLanguage` shown there.
   - `starterNames`: for `["ca-ES-valencia", "es", "en"]` answers exactly
     `{ en: "Alpha", "ca-ES-valencia": "alpha-val", es: "alpha-es" }` (`toEqual`); for `["es"]`
     (no `en`) still includes `en: "Alpha"`; for `["fr", "en"]` answers `{ en: "Alpha" }`; for an
     English text with no entry answers `{ en: "Beta-missing" }`.
   - `starterName`: `"es"` answers `alpha-es`; `"en"` answers `Alpha`; a missing entry answers the
     English for both.
   - "every language a new venue can start with is a starter language": build the union of
     `resolveInstalledStartingContentLanguages({ country: pack.countryCode, area })` over every
     `COUNTRY_PACKS` entry, with `area` undefined and with each `administrativeAreas` entry's `name`;
     drop `en`; expect the sorted result to equal `[...STARTER_CONTENT_LANGUAGES].sort()`.
   - "the staff languages are the supported locales' subtags": `SUPPORTED_LOCALE_CODES.map((c) => c.split("-")[0])`
     equals `["es", "en"]`.

   Run `pnpm --filter @waitron/country-packs exec vitest run src/starter-languages.test.ts`; expected
   failure: the import does not resolve (`Failed to load` / no such file).
2. Write `starter-languages.ts`: `resolveInstalledStarterLanguages` from
   `resolveInstalledStartingContentLanguages` and `resolveInstalledCountryLocale` (both in
   `registry.ts`), with `SUPPORTED_LOCALE_CODES` and `FALLBACK_LOCALE` from `@waitron/shared`.
3. Run the file again: every case passes; read the `Tests` line. Then
   `pnpm --filter @waitron/country-packs exec vitest run` and `pnpm --filter @waitron/country-packs typecheck`.
4. Controls, each run and reverted, each with what it prints:
   - Drop `override: receiptLocale`: the Madrid `en-GB` row fails, `expected 'es' to be 'en'`.
   - In `starterNames`, stop adding `en` when `languages` lacks it: the `["es"]` case fails, the
     answer missing `en`.
   - In `starterNames`, return every language the entry has: the Valencia case fails with extra
     `ca` and `gl` keys.
   - Remove `"gl"` from `STARTER_CONTENT_LANGUAGES`: the union case fails, the received list
     holding `gl` and the expected one not.
5. `pnpm --filter @waitron/country-packs test:coverage`: the new file at 100% lines and branches, the
   package at or above 98/98/98/95.

## Task 2: the reasons come from `packages/adjustments/src/starter-content.ts`

Files: `packages/adjustments/src/starter-content.ts` (new), `packages/adjustments/src/provisioning.ts`,
`packages/adjustments/src/index.ts` (export `STARTER_REASON_NAMES`), `packages/adjustments/package.json`
(`"@waitron/country-packs": "workspace:*"`), `pnpm-lock.yaml` (by `pnpm install`),
`packages/adjustments/src/provisioning.test.ts`.

The starter file:

```ts
import type { StarterContentLanguage, StarterTranslations } from "@waitron/country-packs";

/** The starter void and comp reasons' names in each language a new venue can start with, keyed by
 * the English name `provisioning.ts` seeds. */
export const STARTER_REASON_NAMES = {
  "Entry error": { es: "…", ca: "…", "ca-ES-valencia": "…", gl: "…" },
  // … the nine rows of "Proposed words for slice 1", in seed order
} as const satisfies StarterTranslations<StarterContentLanguage>;
```

1. Tests first, in `provisioning.test.ts`:
   - Change `provisionedNode` to take `{ country, province, invoiceLocales }` (country set on the
     `seedTenant` row as `packages/catalogue/src/provisioning.test.ts:29-31` does). Make the three
     changed checks of "Changed test checks" (rows 1-3), reading the file through a typed name, so
     that indexing it with a `string` is not error TS7053 under `strict` (`tsconfig.base.json:7`;
     `packages/adjustments/tsconfig.json` includes the tests), and no cast is needed:
     `const expected: StarterTranslations<StarterContentLanguage> = STARTER_REASON_NAMES;`
   - A new `it.each` over four venues, expecting for every seeded reason `names` (`toEqual`) and `name`,
     all computed from `expected` and the literal language codes:
     `["ES", "Valencia", "es-ES"]` → names `en`, `ca-ES-valencia`, `es`, plain `es`;
     `["ES", "Barcelona", "ca-ES"]` → `en`, `ca`, `es`, plain `es`;
     `["ES", "Madrid", "en-GB"]` → `en`, `es`, plain English;
     `["GB", "London", "en-GB"]` → `en` only, plain English.
   - "names every starter in the file, and nothing else": the seeded `names.en`, in order, equal
     `Object.keys(STARTER_REASON_NAMES)`.
   - The two "adds nothing" cases (`:115-145`) change only their `provisionedNode` call (row 3 of
     "Changed test checks"); their assertions stay as they are.

   Run `pnpm --filter @waitron/adjustments exec vitest run --project node src/provisioning.test.ts`;
   expected failure: the import of `./starter-content.js` does not resolve; once the file exists, the
   Valencia case fails with `names` `{ en: "Entry error" }` and plain name `Entry error`.
2. Add the dependency, then `pnpm install` at the root; `git diff --stat pnpm-lock.yaml` shows the
   lockfile changed.
3. Write it: `Starter` holds `english` instead of `names`; the seed reads `tenants.country`,
   `locations.province` and `locations.invoiceLocales` for `node.locationId` (one select joining
   `tenants` id 1, through the drizzle tables from `@waitron/db`), calls
   `resolveInstalledStarterLanguages`, and creates each reason with
   `name: starterName(STARTER_REASON_NAMES, english, staffLanguage)` and
   `names: starterNames(STARTER_REASON_NAMES, english, languages)`. `NOT_SERVED_REASON` stays
   `"Not served"`. The report text stays (A912 rewords it).
4. Run the file again: everything passes; read the `Tests` line. Then
   `pnpm --filter @waitron/adjustments exec vitest run --project node` and
   `pnpm --filter @waitron/adjustments typecheck`.
5. Controls, each run and reverted:
   - Pass `STARTER_CONTENT_LANGUAGES` instead of the venue's `languages`: the Valencia row fails with
     extra `ca` and `gl`; Madrid fails with extra `ca`, `ca-ES-valencia`, `gl`.
   - Name the plain `name` from `languages[0]` (the content default) instead of the staff language:
     the Valencia row fails, `expected 'Error en marcar' to be 'Error al marcar'` (read from the
     file, not typed).
   - Delete the `"Discount"` row from the starter file: `typecheck` still passes (decision 6's
     English fallback). The seed still writes "Discount" (the English fallback), so seven of the file's
     nine cases fail: the four rows of the four-venue `it.each` (`provisioning.test.ts:150`) and
     "names every starter in the file, and nothing else" (`:176`) at their English-name check, where
     the **received** `names.en` list holds `Discount` and the expected
     `Object.keys(STARTER_REASON_NAMES)` lacks it; and the two cases above them, which read
     `expected["Discount"].es` (`:93`, `:122`). Measured by the finish-branch run on the slice-1 tip:
     `Tests 7 failed | 2 passed (9)`.
6. `pnpm --filter @waitron/adjustments test:coverage` (node and browser projects; check
   `memory_pressure | grep free` first, and run beside another session only well above 15% free).

## Task 3: the server's and the demo's checks; the guard; the written rule

Files: `apps/server/src/default-cancel-reason.test.ts`, `apps/server/scripts/demo-seed/seed-adjustments.test.ts`,
`packages/db/src/english-only.ts`, `scripts/english-only.test.ts`, `CLAUDE.md`,
`docs/developers/conventions-data.md`.

1. Make rows 4-7 of "Changed test checks", importing `STARTER_REASON_NAMES` from
   `@waitron/adjustments`. Run
   `pnpm --filter @waitron/server exec vitest run src/default-cancel-reason.test.ts scripts/demo-seed/seed-adjustments.test.ts`:
   every case passes. Then, unedited:
   `pnpm --filter @waitron/server exec vitest run src/adjustments-api.test.ts src/configuration-transfer.test.ts`
   and `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts -t "runs every sub-seed"`;
   a failure in any of these is a STOP (it is outside "Changed test checks").
   Control: revert row 5 (`reason.name === "Not served"`) and run the first file: the Finish-table
   cases fail with `Cannot read properties of undefined`.
2. Guard tests first, in `scripts/english-only.test.ts`'s `configuration` block:
   - "excludes a package's top-level starter-content translations by exact path, and nothing wider":
     `STARTER_CONTENT_FILE` is `"starter-content.ts"`; in a `mkdtempSync` fixture (as `:68-88` does)
     write `export const x = { es: "Mesa" };` to `src/starter-content.ts`,
     `src/dashboard/starter-content.ts`, `src/starter-content.test.ts`, `src/my-starter-content.ts`
     and `src/other.ts`; `sourceFilesIn(relative(PACKAGES_ROOT, fixture))` equals the last four
     (sorted); and `findSpanish(content, FORBIDDEN).map((v) => v.word)` equals `["mesa"]` (it answers
     `Violation[]`), so the fixture is one the scan would refuse.
   - "drops adjustments' starter-content translations from the scan while keeping its other files":
     `packages/adjustments/src/starter-content.ts` exists, `sourceFilesIn("adjustments")` does not
     contain it and does contain `provisioning.ts`.
   Run `pnpm exec vitest run scripts/english-only.test.ts` at the root; expected failure: the import
   of `STARTER_CONTENT_FILE` is undefined, and the fixture list holds five files.
3. Add to `packages/db/src/english-only.ts`, after `I18N_CATALOGUES`:

   ```ts
   /**
    * A package's starter-content translations: the words its seed writes into a new venue in
    * languages other than English (owner, 2026-10-20, A918). Excluded by exact path at the top of
    * `src/`, so a file of that name anywhere else is still scanned.
    */
   export const STARTER_CONTENT_FILE = "starter-content.ts";
   ```

   and in `sourceFilesIn`, `.filter((entry) => entry !== STARTER_CONTENT_FILE)`. Two comments in the
   same file stop being true and are reworded or cut, as the house rule on touched comments asks:
   "There is deliberately no exception list…" (`english-only.ts:100-103`), which now sits beside two
   path exclusions, is cut or narrowed to say it is about columns; and "SELF and I18N_CATALOGUES
   match by `endsWith`" (`:229-230`) names the new exact match too. Run the suite again: every case
   passes; read the `Tests` line.
4. Controls, each run and reverted:
   - Delete the filter line: the fixture case fails, received five files with `src/starter-content.ts`
     among them; the adjustments case fails, `expected [...] not to include …/starter-content.ts`.
   - Match with `entry.endsWith(STARTER_CONTENT_FILE)`: the fixture case fails, received **two**
     files (`starter-content.test.ts` and `other.ts`); `dashboard/starter-content.ts` and
     `my-starter-content.ts` are missing (the review simulated this with `node -e`).
5. The root `CLAUDE.md`, in the "General code is English only" line (`:368-376`), replace
   "Module starter content is English, translated at setup;" with:
   "Module starter content is English in code and translated at setup; its words in other languages
   go in the writing package's `src/starter-content.ts`, which the guard skips by exact path
   (owner, 2026-10-20, A918);". This states the rule and where its translations go. No other line
   changes. (`src/starter-content.ts` is not rooted at a top-level folder, so
   `scripts/claude-md-pointers.test.ts` does not read it as a file pointer, `:31-42`.)
6. `docs/developers/conventions-data.md`:
   - `:108-109` ("What it covers"): replace "Starter content a module writes into a new venue
     (A758-1's void and comp reasons) is seeded in English." with a sentence that is true once slice
     1 alone has landed (review I2): "Starter content a module writes into a new venue is English in
     its code and translated at setup from a translation file in the writing package,
     `src/starter-content.ts`, keyed by the English. So far that holds for the void and comp reasons
     (`packages/adjustments/src/starter-content.ts`, A918): each reason's language map gets the
     venue's starting content languages the file carries, plus English, and its plain name gets the
     staff language. The kitchen station, the device profiles, the service steps, the seasons, the
     counter zone, the menu period, the units, and the first menu with its root section and home
     layout are still written from code (A918's open slices)." Each later slice moves its rows out of that last sentence and, for a one-name
     row, says its file holds the staff languages only.
   - `:147-153` ("What the guard does not see"): add "a package's top-level `src/starter-content.ts`,
     whole: comments and identifiers included, with nothing checking that the file holds only data"
     to the list after "any `dashboard/strings.ts`" (review M6).
   - `:4467-4468` (the root-detail copy): replace "Starter content a module writes into a new venue is English, translated when the box is set up;" with the sentence step 5 writes, beginning "Module starter content is English in code".
7. Root guards, each read for its `Tests` line:
   `pnpm exec vitest run scripts/english-only.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/write-path-tables.test.ts scripts/claude-md-pointers.test.ts`
   and `pnpm exec vitest run scripts/changed-scope.test.mjs`. Then `pnpm format:check`.

## Task 4: the Spanish guide line and the backlog

Files: `apps/server/src/guide/es/table-service.md`, `docs/backlog.md`.

1. `apps/server/src/guide/es/table-service.md:59` says the reason «empieza en el motivo de plato no
   servido que trae Waitron, si tu local lo conserva»: name it «**No servido**», the name a
   Spanish-speaking waiter now sees, keeping the condition. The English guide (`en/table-service.md:59`,
   "**Not served**") is unchanged. Grep both guides for any other starter reason name:
   `git grep -n -i "Entry error\|Item not available\|changed mind\|On the house\|Staff meal" -- apps/server/src/guide/`
   expected nothing.
2. `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, at the root,
   `pnpm exec vitest run scripts/guide-links.test.ts`.
3. `docs/backlog.md`, the A918 entry (`:1981-1989`): say the mechanism and the reasons landed in
   slice 1, and list what is left: the station and device profiles, venue-service's steps, seasons,
   counter zone and period, and the catalogue's units and first menu, each pointing at this plan.
   The A977 entry (`:5696`): add `src/starter-content.ts` to the homes it exempts. The backlog is
   under `docs/`, which prettier ignores (`pnpm exec prettier --file-info docs/backlog.md` prints
   `"ignored": true`).
4. Build the word list from the starter file itself, then grep the diff for it and for accented
   letters, keeping each file's `+++ b/<file>` header so the output shows which file every hit is in:

   ```sh
   export LC_ALL=en_US.UTF-8
   WORDS=$(node --input-type=module -e 'const m = await import(process.argv[1]); console.log(Object.values(m.STARTER_REASON_NAMES).flatMap(Object.values).join("|"))' "$PWD/packages/adjustments/src/starter-content.ts")
   git diff -U0 main...HEAD -- apps packages scripts CLAUDE.md | /usr/bin/grep -E "^\+\+\+ |^\+.*([áéíóúñçàèòïü·¿¡]|Mesa|$WORDS)"
   ```

   (Node strips the file's type-only import; tried on a throwaway file of the same shape, it printed
   `Error al marcar|Error en marcar` and the grep caught the line holding «Error al marcar».)
   Expected: hits under `packages/adjustments/src/starter-content.ts`,
   `apps/server/src/guide/es/table-service.md`, the guard's fixture in `scripts/english-only.test.ts`
   (`Mesa`), and the place names in `packages/country-packs/src/starter-languages.test.ts` (decision
   3's table holds "A Coruña"), with headers alone for every other file. With `LC_ALL` unset the
   accented class matches single bytes and also hits lines holding «»; that only adds noise.
5. The audit's `settle-invoice-first.ts` row needs no backlog entry: the script was deleted by A973
   (`8ab1799a9`). Nothing to add (see "Review rulings", M8).

At the end of slice 1, before `/finish-branch`: `git diff --stat main...HEAD -- packages/fiscal-verifactu packages/core apps/server/src/receipt-document.ts apps/server/src/invoice-pdf.ts apps/server/src/receipt-figures.ts`
prints nothing.

---

# Slice 2 — `feat/a918-2-station-and-profiles`

Written 2026-10-27 when the slice was picked up, from main `947d6ac19` (slice 1 landed in #2128).
Built **inline** (the lane's inline-coding trial): the driver writes each task's test and code.
Review path: light by the plan's own test (the action's new field is read only inside
`@waitron/provisioning`), plus one fresh-context plan review of this task list.

## Task 0 results (run 2026-10-27 on `947d6ac19`)

1. **A configuration import replaces the rows.** `importConfigurationTables`
   (`packages/provisioning/src/configuration-transfer.ts:640-735`) deletes every row of each table
   the bundle declares, in reverse order, then inserts the bundle's; `kitchen_stations` and
   `device_profiles` are declared tables (`packages/db/src/configuration-transfer.ts:67`, `:78`). So a
   venue set up from an export keeps the exporting venue's station and profile names, and nothing
   this slice writes survives there; nothing to change for imports.
2. **Readers of the profile data:** `git grep -n "nameByLocale\|defaultProfileName\|DEFAULT_DEVICE_PROFILES"`
   prints `packages/layouts/src/device-profile.ts`, its test, `packages/layouts/src/index.ts:35-36`,
   `packages/provisioning/src/venue-plan.ts:3-4`, `:175-176`, and `apps/server/src/payments-api.test.ts:37`,
   `:1377-1381` (a fixture insert that needs only a unique name).
3. **Readers of the station's word:** production code finds the station by `'Cocina'` only in the
   demo (`apps/server/scripts/demo-seed/seed-catalogue.ts:46-53`); `dev-setup.ts:293` already finds it
   by `isDefault`.
4. **`@waitron/layouts`'s dependencies** are `db`, `identity`, `printing`, `shared`, `ui-core`;
   `@waitron/provisioning` already depends on `@waitron/country-packs` and `@waitron/layouts`.

**Driver ruling: both files' words go in ONE file, `packages/provisioning/src/starter-content.ts`,
not a second one in `@waitron/layouts`.** Decision 1 puts the file in "the package whose seed writes
the words", and the written rule says "the writing package's `src/starter-content.ts`"
(`docs/developers/conventions-data.md:108-109`). Provisioning writes both: the station in
`applyVenue`'s create-location step (`venue-apply.ts:302-310`) and the profiles through
`seedDeviceProfiles` (`venue-apply.ts:531-563`), from names `planVenue` picks. `@waitron/layouts`
only holds the profile data, so it keeps the English name and gains no dependency, and the
`workspace-cycles` question does not arise. Cost if wrong: the profile words sit one package away
from the profile data.

## Global constraints (slice 2)

Slice 1's global constraints hold, with these differences: Spanish appears only in
`packages/provisioning/src/starter-content.ts` (and the existing assertions this slice leaves
unedited); new tests read expected words from that file. **No visible change for a real venue**: the
existing assertions that pin «Mostrador», «Cocina», «Móvil» and «Cocina» for an `es-ES` venue
(`packages/provisioning/src/venue-plan.test.ts:79-127`, `:410-416`; `venue-apply.test.ts:61`, `:75-88`,
`:356`, `:380`) run **unedited**, and are the evidence. No migration, no error code, no receipt or
fiscal change.

## Changed test checks (slice 2)

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `packages/layouts/src/device-profile.test.ts:300-314` ("names every entry in both es and en", "uses the owner-decided Spanish and English names") | each profile's `nameByLocale` holds `es` and `en`, pinned to today's words | one case: the profiles' `name`s are `Counter`, `Kitchen`, `Handheld`; the Spanish words' pin moves to provisioning (the unedited `venue-plan.test.ts:79-127`) | 1 |
| `packages/layouts/src/device-profile.test.ts:324-340` (`defaultProfileName`) | the subtag lookup and its Spanish fallback | deleted with the function; the fallback's replacement is the staff language, pinned by `@waitron/country-packs`' slice-1 tests and by Task 1's `ca-ES` case | 1 |
| `apps/server/src/payments-api.test.ts:1381` | `name: nextName(profile.nameByLocale.es!)` | `name: nextName(profile.name)` (fixture data, not an assertion) | 1 |
| `apps/server/scripts/demo-seed/*.test.ts`, `apps/server/scripts/dev-setup.test.ts` | predicted unchanged: their venues rename or find the station by default | run unedited in Task 2 | 2 |

## Task 1: the station's and profiles' names from `packages/provisioning/src/starter-content.ts`

Files: `packages/provisioning/src/starter-content.ts` (new), `packages/provisioning/src/starter-content.test.ts`
(new), `venue-plan.ts`, `venue-plan.test.ts`, `venue-apply.ts`, `venue-apply.test.ts`,
`packages/layouts/src/device-profile.ts`, its test, `packages/layouts/src/index.ts`,
`apps/server/src/payments-api.test.ts`.

1. Failing tests first:
   - `starter-content.test.ts`: `Object.keys(STARTER_PROFILE_NAMES)` equals
     `DEFAULT_DEVICE_PROFILES.map((p) => p.name)` and `Object.keys(STARTER_STATION_NAMES)` equals
     `[DEFAULT_STATION_NAME]` (every starter has an entry, every entry is a starter; decision 6).
   - `venue-plan.test.ts`: the create-location action carries `stationName` equal to
     `STARTER_STATION_NAMES.Kitchen.es` for the fixture's `es-ES` venue and `"Kitchen"` for `en-GB`; a
     Barcelona venue (`province: "Barcelona"`, receipts `["ca-ES"]`, a receipt language the screens
     cannot show) gets the profiles' and the station's `es` words, read from the file.
   - `venue-apply.test.ts`: an `en-GB` venue's default station is `"Kitchen"`.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/starter-content.test.ts src/venue-plan.test.ts src/venue-apply.test.ts`:
   expect the new cases to fail (no file, no `stationName`, «Cocina» for `en-GB`).
2. Code:
   - `starter-content.ts` exports `STARTER_STATION_NAMES = { Kitchen: { es: "Cocina" } }` and
     `STARTER_PROFILE_NAMES = { Counter: { es: "Mostrador" }, Kitchen: { es: "Cocina" }, Handheld: { es: "Móvil" } }`,
     each `as const satisfies StarterTranslations<Exclude<StarterStaffLanguage, "en">>` (one-name rows
     hold the staff languages only; a new staff language is a type error here).
   - `DefaultDeviceProfile.nameByLocale` becomes `name: string` (English); `DEFAULT_PROFILE_LANGUAGE`
     and `defaultProfileName` are deleted, and their export from `packages/layouts/src/index.ts`.
   - `planVenue` resolves `staffLanguage` once with `resolveInstalledStarterLanguages({ country, area: request.location.province, receiptLocale: locales[0] })`,
     names each profile `starterName(STARTER_PROFILE_NAMES, profile.name, staffLanguage)`, and adds
     `stationName: starterName(STARTER_STATION_NAMES, DEFAULT_STATION_NAME, staffLanguage)` to the
     create-location action (`DEFAULT_STATION_NAME = "Kitchen"`, exported from `venue-plan.ts`).
     `describeVenueAction`'s line is unchanged (it never named the station; `:414-415` stay unedited).
   - `applyVenue` writes `action.stationName` where it wrote `"Cocina"`.
   - `payments-api.test.ts:1381` reads `profile.name`.
3. Re-run step 1's command, then `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts`; typecheck
   `@waitron/layouts`, `@waitron/provisioning`, `@waitron/server`.
4. Control: change `starterName(STARTER_STATION_NAMES, …)` to pass `"en"`; the unedited
   `venue-apply.test.ts:61` fails with `"Kitchen"` where it expects «Cocina». Restore.

## Task 2: the demo finds the default station by `is_default`; the written rule; the backlog

1. `seed-catalogue.ts:46-53`'s lookup becomes `where location_id = … and is_default = 1 and active = 1`,
   its error "no default station". Failing test first, in `apps/server/scripts/demo-seed/seed-catalogue.test.ts`:
   rename the provisioned default station to a word that is not «Cocina» before seeding, and expect
   the seed to succeed and rename it to "Kitchen" (today it throws `no "Cocina" station found`). Then
   run `seed-catalogue.test.ts`, `seed.test.ts` and `apps/server/scripts/dev-setup.test.ts` unedited.
2. `docs/developers/conventions-data.md:108-116`: the sentence names the station and the profiles
   as done, in `packages/provisioning/src/starter-content.ts`, says a one-name row gets the staff
   language and a file of one-name rows holds only the staff languages other than English (`es`), and
   drops the station and the profiles from the "still written from code" list.
3. `docs/backlog.md`'s A918 entry: slice 2 done in this PR; slices 3 and 4 no longer wait (the owner
   answered FYI A with 2, the staff language, 2026-10-27).
4. English-only check of the diff: `git diff -U0 main...HEAD | grep -E '^\+\+\+ |^\+.*(Cocina|Mostrador|Móvil|[áéíóúñ])'`
   under `LC_ALL=en_US.UTF-8`: hits only in `packages/provisioning/src/starter-content.ts`, plus file
   headers.

Root guards before `/finish-branch`: the plan's list (below), and
`pnpm --filter @waitron/provisioning exec vitest run` whole (the package pins its plan and seed reports).

---

# Later slices (task lists written when each is picked up)

**Slice 2 — `feat/a918-2-station-and-profiles`.** (Its task list is above, under "Slice 2"; this paragraph is the plan as first written.) The station's word moves into
`packages/provisioning/src/starter-content.ts` (`Kitchen` → «Cocina»), the profiles' into
`packages/layouts/src/starter-content.ts` (`Counter`, `Kitchen`, `Handheld` → «Mostrador», «Cocina»,
«Móvil», today's words, `device-profile.ts:139-150`); `DEFAULT_DEVICE_PROFILES` keeps only the English
name, `DEFAULT_PROFILE_LANGUAGE` and `defaultProfileName` go. `@waitron/layouts` does not depend on
`@waitron/country-packs` today (its dependencies are `db`, `identity`, `printing`, `shared`,
`ui-core`), so its file either gains that dependency for the `StarterTranslations` type or types its
object inline as `Record<string, { es: string }>`; the slice decides, after checking
`scripts/workspace-cycles.test.ts`. `planVenue` (pure, `venue-plan.ts:173-181`)
picks each profile's name with `starterName` and the staff language from the request's country,
province and first receipt language; it carries the station's name to `applyVenue` in the
`create-location` action (a new field, so `describeVenueAction` and `venue-plan.test.ts` see it),
because the station is written before any seed reads the database. The demo's station lookup
(`apps/server/scripts/demo-seed/seed-catalogue.ts:44-56`) finds the default station by `is_default`,
as `dev-setup.ts:293` does, because an English demo's station is now "Kitchen". Changed checks:
`packages/provisioning/src/venue-plan.test.ts:20` and any case pinning a profile or station name,
read from the files; `apps/server/src/payments-api.test.ts:1377-1381`, which reads
`DEFAULT_DEVICE_PROFILES[].nameByLocale.es` and breaks when `nameByLocale` goes (review M10a); the
English demo's station name at provisioning. It extends `conventions-data.md`'s slice-1 sentence:
the station and the profiles leave its "still written from code" list, and it says their files
hold the staff languages only (`es`). Its Task 0 checks whether a configuration import replaces or
merges `kitchen_stations` and `device_profiles` (review M10c). No visible change for a real venue
(decision 3) under FYI A's default or alternative 1; alternatives 2 and 3 change its rows (with 3,
later, through that migration item), so it does not wait. Review path: light unless the action's new field is judged a cross-package
contract (it is read only inside `@waitron/provisioning`).

**Slice 3 — `feat/a918-3-venue-service-starters`. Waits for the owner's answer to FYI A**: with the
default, an English-speaking waiter in a Spanish venue loses today's English seasons, counter zone
and period; with alternative 1, this slice only moves the words out of general code and renames
nothing; with alternative 3 it becomes a migration item. The paragraph below is the default's.
`packages/venue-service/src/starter-content.ts`
holds the steps (today's «Montar mesa», «Tomar nota», «¿Algo más?», `service-steps.ts:111-113`), the
seasons («Primavera», «Verano», «Otoño», «Invierno»), the counter zone («Mostrador», the profile's
word for the same English) and the period («Abierto»), typed `StarterTranslations<"es">` because each
is a one-name row. `addStarterServiceSteps`, `ensureDefaultSeasons`, the seed's zone and
`placeOpenPeriod` take the staff language from the venue's geography and receipt language each time
they run, which covers a department added later. `venue-service` is not a package the guard scans
(`GENERIC_PACKAGES`, `packages/db/src/english-only.ts:15-57`), and its file holds «Montar mesa»,
which the guard would refuse (probe 1), so the allowance matters there once A977 widens the scan.
**Three places find the starter period by its English name "Open"** (review I3, re-verified):
`apps/server/src/setup-opening-hours.ts:27` (`if (period.name !== "Open") return undefined;`, in
`readSetupOpeningHours`, passed to setup at `boot.ts:1408`, imported at `:262`), which decides whether
the default department still has its starter hours; and the demo's
`apps/server/scripts/demo-seed/seed-floor.ts:174` (`eq(menuPeriods.name, "Open")`) and
`seed-catalogue.ts:108` (`d.name = 'Open'`). In a Spanish venue the period is «Abierto», so the first
quietly answers `undefined`. The demo's two lookups miss too, with different results:
`seed-catalogue.ts:108` finds no provisioned menu, and at `seed-floor.ts:171-182` a miss at `:174`
falls through `existing ??` to `saveMenuPeriod(… name: "Open")` (`:178`), so a Spanish demo gains a
**second** period named "Open" beside «Abierto». The demo also writes "Open" in English itself
(`:178`, and the deli's period at `:188`): those are the demo's own content and stay A972's and
A975's, so slice 3 changes only the lookups. No column marks the starter
period: `menu_periods` holds `id`, `department_id`, `name`, `colour`, `menu_id` and
`floor_plan_set_id` (`packages/venue-service/src/schema/menus.ts:20-35`), and adding a marker would be
a migration. So the default is that venue-service exports the set of names its file gives "Open"
(the English plus each language's word, as the reasons are matched by `names.en ?? name`) and all
three match against that set; `seed-catalogue.ts:108` binds them as an `in (…)` list. The
setup-hours check keeps every other test it already makes (exactly one period in the default
department, weekdays 09:00-17:00, `setup-opening-hours.ts:24-39`), so a manager who renames the
period to another word is still told apart (`setup-opening-hours.test.ts:77-81`, renamed to
"Lunch"). Its cost: a manager who renames the period to «Abierto» in an English venue is read as
starter, if the hours also match. Tests: `apps/server/src/setup-opening-hours.test.ts` gains a
Spanish venue whose period is «Abierto» (read from the file) and still gets its summary; the demo's
`scripts/demo-seed/seed.test.ts` runs a Spanish demo through both lookups. The other starter words
("Menu", "Home", "Counter", "Kitchen", the seasons, the steps) are found by name nowhere in
production code (the review's grep). Its Task 0 checks whether a configuration import replaces or
merges these tables (review M10c). It extends `conventions-data.md`'s sentence as slice 2 does.
Changed checks: venue-service and server cases pinning "Spring", "Counter" or "Open" for a Spanish
venue, read from the file. Visible: seasons, zone and period in Spanish in a Spanish venue.

**Slice 4 — `feat/a918-4-catalogue-starters`. Waits for the owner's answer to FYI A**, because the
first menu's name and the units' staff names are one-name fields that are English today ("Menu",
`catalogue/src/provisioning.ts:153`; "Gram"…, `:99-139`). The units' language maps follow FYI B
and do not wait. The paragraph below is the default's. `packages/catalogue/src/starter-content.ts` holds the
units' names (today's `es`, `ca`, `ca-ES-valencia` and `gl` words from `provisioning.ts:12-39`,
keyed by `seedKey`; the `eu` words go, because no venue can start in Basque), the staff names in
Spanish («Gramo»…), and the first menu's «Carta» and, if Task 0 finds it shown on a screen, the home
layout's «Inicio». Abbreviations stay as letters equal to the staff abbreviation in every language,
pinned by a case, so receipts print the same; Task 0 confirms no unit's full name reaches a receipt
(if one does, that part splits off, parked for the owner). Changed checks:
`packages/catalogue/src/provisioning.test.ts:180-255` (each unit's maps now hold the venue's
languages only). The root section's `sections.names` is a language map
(`packages/catalogue/src/schema/sections.ts:36`) that the seed leaves `{}` today; this plan has not
established where a root section's customer name is shown, so slice 4's Task 0 finds out, and if a
screen or receipt shows it the slice fills it by decision 4 (review M10b), otherwise it stays `{}`
and the slice says why. Its Task 0 also checks whether a configuration import replaces or merges
`units`, `catalogues` and `sections` (review M10c). Whichever of slices 2-4 lands last
finishes `conventions-data.md`'s sentence (nothing left "still written from code") and drops the
words after the colon in the root `CLAUDE.md` line; under FYI A's alternative 1 or 3 slices 3 and 4
may change shape, and the last to land still does this. The slice adds a backlog entry for `EACH_UNIT`'s non-English words
(`packages/catalogue/src/units.ts:28-36`, read by `receipt-figures.ts:205-212`, so its own pull
request would change printed words and wait for the owner), deletes A918 from `docs/backlog.md`, and
updates `docs/backlog/architecture.md`'s "Point 1 → A918" bullet (`:435-440`).

## Root guards to run before each `/finish-branch`

`pnpm exec vitest run scripts/english-only.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/write-path-tables.test.ts scripts/claude-md-pointers.test.ts scripts/guide-links.test.ts`
and `pnpm exec vitest run scripts/changed-scope.test.mjs`. No root guard pins a seed list or a
provisioning action list (`git grep -ln "seed-module\|provisioning.seed\|\.seed!" -- 'scripts/*.test.*'`
printed nothing); `packages/provisioning/src/venue-plan.test.ts` and `venue-apply.test.ts` pin the
plan and the seed reports inside the package, and slice 2 runs them.

## Review rulings

The fresh plan review (`~/waitron-campaign-b/a918-plan-review.md`, on `24d1a0bfd`) found 0 Critical,
3 Important and 10 Minor. The driver ruled against none. Each is folded in as follows:

| Finding | Ruling | Folded into |
| --- | --- | --- |
| **I1**: FYI A left out the owner's own example (the English-speaking waiter), so the departure looked smaller than it is | Take it; slice 3 waits for FYI A; slices 1 and 2 do not, verified | FYI A gains the English-speaking waiter's example (seasons, counter zone and period becoming «Primavera»…, «Mostrador», «Abierto») and, as alternative 1, keeping the one-name rows as today. The slice table and "Why slices 3 and 4 wait" record who waits. Verified, not assumed: slice 2's rows are Spanish today for every real venue, so it does not wait. **Slice 4 waits too**: its first menu and units' staff names are one-name fields that are English today, the same case as slice 3 (not named in the ruling; found while verifying). Slice 1 does not wait, per the ruling; FYI C now states the English-speaking manager's dashboard change |
| **I2**: the new `conventions-data.md` sentence claimed more than slice 1 delivers | Narrow it to what is true after slice 1; later slices extend it | Task 3 step 6's sentence names only the reasons as done and lists the rest as still written from code; step 5's `CLAUDE.md` wording claims only the reasons. Slices 2, 3 and 4 each say how they extend the sentence; slice 4 finishes it |
| **I3**: slice 3 missed code that finds the starter period by its English name | Name the three sites and how they move off the English name | Slice 3's paragraph names `setup-opening-hours.ts:27`, `seed-floor.ts:174` and `seed-catalogue.ts:108` (re-verified). No column marks the starter period (`menus.ts:20-35`), so the default matches against the set of names the starter file gives "Open", with no migration; it names the tests |
| **M1**: the `endsWith` control predicted three files; `findSpanish` answers `Violation[]` | Fix as the review says | Task 3 step 4 predicts two files; step 2 maps to `.word` |
| **M2**: the "delete Discount" control described its failure backwards | Fix | Task 2 step 5 states the `TypeError` in the four-venue case and the received side holding `Discount` |
| **M3**: decision 2 cited a rule that does not forbid one module reading another's table | Fix | Decision 2's third reason now says adjustments would have to `require` the catalogue's migration set for a single row (`conventions-data.md:4606-4610`, `:1527`) |
| **M4**: decision 3's staff language is not `readVenueLocale`'s display language | Fix | Decision 3 drops the old definition, says where the two differ (only an `en-GB`-receipt demo or developer venue) and why the receipt override is kept |
| **M5**: two required test edits were missing from "Changed test checks" | Fix | A row for the `:116` and `:127` call sites; the `:93` title change added to row 2; Task 2's "stay unedited" corrected |
| **M6**: the guard fixture spells «Mesa»; two `english-only.ts` comments go stale; the whole-file skip needs its hedge | Fix | Global constraints name the guard suite's existing exception (`FIXTURE`, `english-only.test.ts:32-50`); Task 3 step 3 rewords `:100-103` and `:229-230`; step 6's "What the guard does not see" line says the whole file is skipped and nothing checks that it holds only data |
| **M7**: Task 4 step 4's grep dropped the file headers and missed unaccented words | Fix | The review's `git diff -U0 … grep -E '^\+\+\+ |^\+.*(…)'` command, with the expected output |
| **M8**: the audit's `settle-invoice-first.ts` row was accounted for nowhere | A one-line leave-out note, and a backlog entry added in slice 1's docs task | **Folded differently, on evidence.** The leave-out note is added. But the script no longer exists: A973 deleted it (`8ab1799a9`, #1967; `ls apps/server/scripts/settle-invoice-first.ts` prints "No such file or directory"), and the audit's own dated note says so (`english-only-audit.md:8`). A backlog entry would track nothing, so Task 4 step 5 records why none is added. This is for the driver to overrule |
| **M9**: indexing the `as const` file with a `string` is TS7053 under `strict` | Fix | Task 2 step 1 declares `const expected: StarterTranslations<StarterContentLanguage> = STARTER_REASON_NAMES;` |
| **M10**: three facts for the later slices | Fix | (a) slice 2 names `payments-api.test.ts:1377-1381`; (b) slice 4 says why the root section's `names` stays `{}` until its Task 0 finds where it is shown; (c) the leave-outs list the tables a configuration export carries, and slices 2, 3 and 4 each check, in their Task 0, whether an import replaces or merges them |

### Round 3

The round-3 check of the fold (`~/waitron-campaign-b/a918-plan-round3.md`, on `6f8ed3bec`) found 0
Critical, 2 Important and 11 Minor. The driver ruled against none; each is folded as the check says.

| Finding | Folded into |
| --- | --- |
| **I1**: inserting a row into "Changed test checks" left the row numbers wrong | Task 2 step 1 says "the three changed checks (rows 1-3)"; Task 3 step 1 says "rows 4-7"; its control reverts "row 5" (`reason.name === "Not served"`) |
| **I2**: three lines contradicted the waits | The "Not fiscal" line says no slice waits on fiscal grounds and slices 3 and 4 wait for FYI A; the line under the slice table says the same; the FYI heading says slices 1 and 2 are built with the defaults and slices 3 and 4 wait for the answer to A |
| **M1**: Task 4 step 4's grep missed most starter words and predicted the wrong hits | The word list is built from the starter file with `node` (tried on a throwaway file of the same shape), run under `LC_ALL=en_US.UTF-8`; the expected hits add the country-packs test's "A Coruña" |
| **M2**: decision 2's replacement reason cited a rule about migration SQL | It now cites `requires` as what guarantees the catalogue's table exists (`packages/module/src/module.ts:1589-1593`, `:1672-1675`) |
| **M3**: "changes nothing anyone sees" and "the only answer that changes slice 2" claimed too much | "Nothing a real venue sees" (the English demo's station does change); alternatives 2 and 3 both change slice 2's rows, 3 later through its migration item |
| **M4**: decision 3's "differ only for an `en-GB` demo" was too broad | Adds a box with `WAITRON_TILL_LOCALE` set (`venue-locale.ts:52-54`, `:62`) |
| **M5**: the till shows the person's language only when the account has one | FYI C and "Why slices 3 and 4 wait" say "a waiter whose account language is English", name the fallback (`persons.ts:47`, `:99`), and add the adjustments report's reason filter (`adjustment-report-screen.ts:576`) |
| **M6**: the demo's missed lookup adds a second "Open" period | Slice 3 says so (`seed-floor.ts:171-182`), and keeps the demo's own English "Open" writes (`:178`, `:188`) as A972's and A975's, changing only the lookups |
| **M7**: the Discount control's `TypeError` depends on the row | The three Spanish rows fail, each reading its own first language; London passes |
| **M8**: rows 1 and 2 did not state their call | Both give their `provisionedNode({ country: "ES", … })` call |
| **M9**: "slice 4, the last" assumed an order | Whichever of slices 2-4 lands last finishes the sentence and the `CLAUDE.md` words; the dependency line names the shared sentence |
| **M10**: the "still written from code" list missed two starters | It names the first menu with its root section and home layout |
| **M11**: FYI A said slice 3 "renames" rows for everyone | A newly set-up venue gets the Spanish words; no existing venue's rows change |
