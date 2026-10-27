# A918: starter content in the venue's languages at setup

**Status: plan, 2026-10-27, the fresh plan review folded in (0 Critical, 3 Important, 10 Minor,
`~/waitron-campaign-b/a918-plan-review.md`) under the driver's rulings of the same day; see "Review
rulings" at the end. Nothing was built when this was written; no code was changed.** Branch
`feat/a918-starter-content-translations`, from `main` at `f320bd194`. Four pull requests, one per
slice (below); this document holds full tasks for **slice 1** only, and a short paragraph for each
later slice, whose task list is written when it is picked up. **Slices 3 and 4 wait for the owner's
answer to FYI A**; slices 1 and 2 do not. (2026-10-27: the owner answered FYI A with its default,
the staff language; slices 3 and 4 no longer wait. Slices 2 and 3 each have their own task list
below.)

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
| **3** | `feat/a918-3-venue-service-starters` — waited for FYI A (answered 2026-10-27) | Service steps, seasons, the counter zone and the "Open" period from `packages/venue-service/src/starter-content.ts`, at setup and when a department is added; the three places that find the starter period by the name "Open" | With FYI A's default: seasons, the counter zone and the period, English today, read in Spanish in a Spanish venue, for English-speaking staff too; steps unchanged |
| **4** | `feat/a918-4-catalogue-starters` — waited for FYI A (answered 2026-10-27) | Units and the first menu's names from `packages/catalogue/src/starter-content.ts`; the `EACH_UNIT` backlog entry; A918 deleted from the backlog | Units carry only the venue's languages (owner FYI B); with FYI A's default, the first menu and the units' staff names, English today, are Spanish in a Spanish venue |

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
**Review path: FULL** (review M7): `@waitron/layouts` loses an export (`defaultProfileName`) and
changes the `DefaultDeviceProfile` type, which `@waitron/provisioning` and an `apps/server` test
read, a cross-package contract. One fresh-context review of this task list ran first
(`~/waitron-campaign-b/a918-2-plan-review.md`: 0 Critical, 1 Important, 8 Minor, all folded; see
"Review rulings (slice 2)").

**The owner's answer to FYI A (2026-10-27, relayed by the watcher):** "One-name starter rows … are
written at setup in the venue's staff language, the same for everyone; existing venues keep their
rows. B–F stay as your defaults." That is this plan's default (decision 3), the alternative the
questions file numbered 2 (in this plan's own FYI A list it is the unnumbered default, and "2" is
the content-language option). Slices 3 and 4 no longer wait.

## Task 0 results (run 2026-10-27 on `947d6ac19`)

1. **A configuration import replaces the rows.** `importConfigurationTables`
   (`packages/provisioning/src/configuration-transfer.ts:640-810`) deletes every row of each table
   the bundle declares (the `persons` table keeps its administrators, `:722-726`), in reverse
   order, then inserts the bundle's; `kitchen_stations` and `device_profiles` are declared tables
   (`packages/db/src/configuration-transfer.ts:67`, `:78`). So a venue set up from an export keeps
   the exporting venue's station and profile names; nothing to change for imports.
2. **Readers of the profile data:** `git grep -n "nameByLocale\|defaultProfileName\|DEFAULT_DEVICE_PROFILES"`
   prints `packages/layouts/src/device-profile.ts`, its test, `packages/layouts/src/index.ts:35-36`,
   `packages/provisioning/src/venue-plan.ts:3-4`, `:175-176`, and `apps/server/src/payments-api.test.ts:37`,
   `:1377-1381` (a fixture insert that needs only a unique name).
3. **Readers of the station's word:** production code finds the station by `'Cocina'` only in the
   demo (`apps/server/scripts/demo-seed/seed-catalogue.ts:46-53`); `dev-setup.ts:293` already finds it
   by `isDefault`.
4. **`@waitron/layouts`'s dependencies** are `db`, `identity`, `printing`, `shared`, `ui-core`;
   `@waitron/provisioning` already depends on `@waitron/country-packs` and `@waitron/layouts`.

**Driver ruling: both sets of words go in ONE file, `packages/provisioning/src/starter-content.ts`,
not a second one in `@waitron/layouts`.** Decision 1 puts the file in "the package whose seed writes
the words", and the written rule says "the writing package's `src/starter-content.ts`"
(`docs/developers/conventions-data.md:108-109`). Provisioning writes both: the station in
`applyVenue`'s create-location step (`venue-apply.ts:302-310`) and the profiles through
`seedDeviceProfiles` (`venue-apply.ts:531-563`), from names `planVenue` picks. `@waitron/layouts`
only holds the profile data, so it keeps the English name and gains no dependency, and the
`workspace-cycles` question does not arise. Cost if wrong: the profile words sit one package away
from the profile data.

## What changes, and for whom (review I1)

**No change for a venue set up through the setup screens.** Those go through `parseVenue`, which
stores the province's name and accepts only Spain's receipt languages `es-ES`, `ca-ES`, `gl-ES`,
`eu-ES` (`apps/server/src/setup-api.ts:457-466`). The reviewer's probe compared today's
`defaultProfileName` with the new staff language over every Spanish area (by name and by code, and
none) and each of the four receipt languages: `spain matrix 420 diffs 0`. The existing `es-ES`
assertions (`venue-plan.test.ts:79-127`, `:410-416`; `venue-apply.test.ts:61`, `:75-88`, `:356`,
`:380`) are run **unedited** first, as the evidence.

**What does change**, all outside the setup screens:

- **The command-line tool `waitron-provision`** checks no receipt language
  (`packages/provisioning/README.md:176-178`; `cli.ts:582-599`), accepts a British venue (`GB-vat`),
  and can run a box's first setup (`cli.ts:303-310`). There, `en-US`, `en` or `EN-GB` receipts give
  Spanish profile names where today they are English (the staff language takes the receipt language
  only when it is exactly a staff-screen language, decision 3, as slice 1's reasons already do); and
  `en-GB` receipts, or a British venue, give a station called "Kitchen" where today it is «Cocina».
  Re-running the tool for an existing `en-US` venue adds three Spanish-named profiles beside the
  English ones, because `seedDeviceProfiles` finds a profile by its name (`venue-apply.ts:540-542`).
  Task 2 pins the `en-US` case as decided behaviour, and the pull request says so.
- **The English demo and the developer venue** (`en-GB` receipts) get a station called "Kitchen" at
  setup; the demo already renamed it to "Kitchen" (`seed-catalogue.ts:54-56`).

## Global constraints (slice 2)

Slice 1's global constraints hold, with these differences: Spanish appears only in
`packages/provisioning/src/starter-content.ts`; tests read expected words from that file. The
existing tests that spell «Mostrador», «Cocina» or «Móvil» for the provisioned starters are first run
unedited (the evidence above), then switched to read the same words from the file (review M5), each
switch named in its commit. No migration, no error code, no receipt or fiscal change.

## Changed test checks (slice 2)

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `packages/layouts/src/device-profile.test.ts:300-314` ("names every entry in both es and en", "uses the owner-decided Spanish and English names") | each profile's `nameByLocale` holds `es` and `en`, pinned to today's words | one case: the profiles' `name`s are `Counter`, `Kitchen`, `Handheld`. After step 5 no test spells the Spanish words: as in slice 1, only the starter file and its review hold them (`venue-plan.test.ts:79-127` checks the name the file gives, not the word) | 2 |
| `packages/layouts/src/device-profile.test.ts:324-340` (`defaultProfileName`) | the subtag lookup and its Spanish fallback | deleted with the function; the fallback's replacement is the staff language, pinned by `@waitron/country-packs`' slice-1 tests and Task 2's `ca-ES` and `en-US` cases | 2 |
| `packages/provisioning/src/venue-apply.test.ts:635-648`, `:687-700` (hand-built `create-location` actions, review M1) | no `stationName` | gain `stationName`, the file's `es` word (a field the type now requires; no assertion changes) | 2 |
| `packages/provisioning/src/venue-plan.test.ts` and `venue-apply.test.ts`, every literal «Mostrador», «Cocina», «Móvil» that names a provisioned starter (review M5) | spelled | read from `STARTER_PROFILE_NAMES` / `STARTER_STATION_NAMES`; same values | 2 |
| `apps/server/src/payments-api.test.ts:1381` | `name: nextName(profile.nameByLocale.es!)` | `name: nextName(profile.name)` (fixture data, not an assertion) | 2 |
| `apps/server/scripts/demo-seed/*.test.ts`, `apps/server/scripts/dev-setup.test.ts` | predicted unchanged | run unedited after Task 2 | 2 |

## Task 1: the demo finds the default station by `is_default` (first, review M2)

Done first so the English demo keeps working once Task 2 names its station "Kitchen".

1. Failing test first, in `apps/server/scripts/demo-seed/seed-catalogue.test.ts`: rename the
   provisioned default station to a word that is not «Cocina» before seeding, and expect the seed to
   succeed and the station to end up "Kitchen". Run it: today it throws `no "Cocina" station found`.
2. `seed-catalogue.ts:46-53`'s lookup becomes `where location_id = … and is_default = 1 and active = 1`,
   its error "no default station". Re-run `seed-catalogue.test.ts`, `seed.test.ts` and
   `apps/server/scripts/dev-setup.test.ts`, unedited apart from step 1's new case.

## Task 2: the station's and profiles' names from `packages/provisioning/src/starter-content.ts`

Files: `packages/provisioning/src/starter-content.ts` (new), `packages/provisioning/src/starter-content.test.ts`
(new), `venue-plan.ts`, `venue-plan.test.ts`, `venue-apply.ts`, `venue-apply.test.ts`,
`packages/layouts/src/device-profile.ts`, its test, `packages/layouts/src/index.ts`,
`apps/server/src/payments-api.test.ts`.

1. Failing tests first:
   - `starter-content.test.ts`: `Object.keys(STARTER_PROFILE_NAMES)` equals
     `DEFAULT_DEVICE_PROFILES.map((p) => p.name)` and `Object.keys(STARTER_STATION_NAMES)` equals
     `[DEFAULT_STATION_NAME]` (every starter has an entry, every entry is a starter; decision 6).
   - `venue-plan.test.ts`: the create-location action carries `stationName`, the file's `es` word for
     the fixture's `es-ES` venue and `"Kitchen"` for `en-GB`; a Barcelona venue (`province:
     "Barcelona"`, receipts `["ca-ES"]`, a receipt language the screens cannot show) gets the
     profiles' and the station's `es` words; an `en-US` venue (the command line's unchecked case)
     gets the `es` words too.
   - `venue-apply.test.ts`: an `en-GB` venue's default station is `"Kitchen"`.
   Run `pnpm --filter @waitron/provisioning exec vitest run src/starter-content.test.ts src/venue-plan.test.ts src/venue-apply.test.ts`:
   expect the new cases to fail (no file, no `stationName`, «Cocina» for `en-GB`, English profiles for `en-US`).
2. Code:
   - `starter-content.ts` exports `STARTER_STATION_NAMES = { Kitchen: { es: "Cocina" } }` and
     `STARTER_PROFILE_NAMES = { Counter: { es: "Mostrador" }, Kitchen: { es: "Cocina" }, Handheld: { es: "Móvil" } }`,
     each `as const satisfies StarterTranslations<Exclude<StarterStaffLanguage, "en">>` (one-name rows
     hold the staff languages only; a missing `es` is TS2741, an extra language TS2353, per the
     review's probe P2).
   - `DefaultDeviceProfile.nameByLocale` becomes `name: string` (English); `DEFAULT_PROFILE_LANGUAGE`
     and `defaultProfileName` are deleted, with their export from `packages/layouts/src/index.ts`.
   - `planVenue` resolves `staffLanguage` once with `resolveInstalledStarterLanguages({ country, area: request.location.province, receiptLocale: locales[0] })`,
     names each profile `starterName(STARTER_PROFILE_NAMES, profile.name, staffLanguage)`, and adds
     `stationName: starterName(STARTER_STATION_NAMES, DEFAULT_STATION_NAME, staffLanguage)` to the
     create-location action (`DEFAULT_STATION_NAME = "Kitchen"`, exported from `venue-plan.ts`).
     `describeVenueAction`'s line is unchanged (it never named the station; `:414-415` stay unedited).
   - `applyVenue` writes `action.stationName` where it wrote `"Cocina"`.
   - The two hand-built actions in `venue-apply.test.ts` gain `stationName`; `payments-api.test.ts:1381`
     reads `profile.name`.
3. Re-run step 1's command, then `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts`, and Task 1's three
   demo and dev-setup files; typecheck `@waitron/layouts`, `@waitron/provisioning`, `@waitron/server`.
4. Control: change the station's `starterName(…)` call to pass `"en"`; the unedited
   `venue-apply.test.ts:61` fails with `"Kitchen"` where it expects «Cocina». Restore.
5. Then (separate commit) switch the provisioning tests' spelled starter words to the file (the
   changed-checks row); re-run.

## Task 3: the written rule and the docs

1. `docs/developers/conventions-data.md:104-117`, the root `CLAUDE.md` line (`:373-375`) and its
   `conventions-data.md` twin (`:4476-4478`): the rule says "starter content Waitron writes into a new
   venue" (a module's seed or a core setup step: the station and profiles are written by core setup
   code, review M8) rather than "a module writes". The `:108-117` sentence names the station and the
   profiles as done, in `packages/provisioning/src/starter-content.ts`, says a one-name row gets the
   staff language and a file of one-name rows holds only the staff languages other than English
   (`es`), and drops them from the "still written from code" list.
2. `docs/backlog.md`'s A918 entry: slice 2 done in this pull request; slices 3 and 4 no longer wait
   (the owner chose the staff language for one-name rows, 2026-10-27).
3. Dated notes (review M6), not rewrites: `docs/backlog/architecture.md:417-423`'s A918 bullet (the
   station and profiles moved, the demo trap fixed) and `docs/backlog/english-only-audit.md:29-30`,
   `:131-132` (the station and profile rows).
4. English-only check of the diff, outside the plans folder (review M3):
   `LC_ALL=en_US.UTF-8 git diff -U0 main...HEAD -- . ':!docs/superpowers/plans' | grep -E '^\+\+\+ |^\+.*(Cocina|Mostrador|Móvil|[áéíóúñ])'`:
   hits only in `packages/provisioning/src/starter-content.ts` and in the dated doc notes and backlog
   lines that name the words, plus file headers.

Root guards before `/finish-branch`: the plan's list (below), and
`pnpm --filter @waitron/provisioning exec vitest run` whole (the package pins its plan and seed reports).

## Review rulings (slice 2)

| Finding | Ruling |
| --- | --- |
| **I1**: "no visible change for a real venue" broader than the evidence (the command-line tool) | Taken: "What changes, and for whom" narrows it to the setup screens and lists the command-line and demo cases; Task 2 pins `en-US`; the pull request says so. The receipt override stays exact-match, as slice 1's reasons do, so the two agree |
| **M1**: two hand-built `create-location` actions | Taken: Task 2's files and the changed checks |
| **M2**: the demo breaks between the two tasks | Taken: the demo's lookup is Task 1 |
| **M3**: the diff grep hits the plan | Taken: Task 3 step 4 excludes `docs/superpowers/plans` |
| **M4**: the owner's "2" is the questions file's numbering | Taken: recorded in words at the top of this section |
| **M5**: existing tests spell the Spanish words | Taken: run unedited first, then switched to read the file (Task 2 step 5) |
| **M6**: stale notes in `architecture.md` and the audit | Taken: Task 3 step 3, dated notes |
| **M7**: the light path's reason misses the `@waitron/layouts` contract change | Taken: FULL |
| **M8**: the line range and "a module writes" | Taken: Task 3 step 1 |

---

# Slice 3 — `feat/a918-3-venue-service-starters`

Written 2026-10-27 when the slice was picked up, from main `dd73ef87a` (slice 2 landed in #2130).
**Review path: FULL.** Risk trigger: a cross-package contract. `@waitron/venue-service` gains
exports (`STARTER_SEASON_NAMES`, `STARTER_ZONE_NAMES`, `STARTER_PERIOD_NAMES`,
`STARTER_OPEN_PERIOD_NAMES`) that `apps/server`'s setup check, demo seed and tests read, and
`@waitron/provisioning` gains a test-only dependency on it. One fresh-context review of this task
list ran first (`~/waitron-campaign-b/a918-3-plan-review.md`: 0 Critical, 3 Important, 10 Minor,
all taken, M2 in part, and M9 found unneeded by the round-3 check; see "Review rulings (slice
3)"). No fiscal
invariant, tenant isolation, migration, grant, permission or concurrency change.

**The owner's answer to FYI A (2026-10-27, relayed):** "A918 A: 2. One-name starter rows (seasons,
the Counter zone, the Open period, the first menu, units) are written at setup in the venue's staff
language, the same for everyone; existing venues keep their rows. B–F stay as your defaults." That
is decision 3's default (as recorded under slice 2, the questions file's "2" is this plan's
unnumbered default). Slices 3 and 4 no longer wait.

## Task 0 results (run 2026-10-27 on `dd73ef87a`)

The measurements below were taken in a throwaway worktree, `/private/tmp/a918-3-probe` (`git
worktree add --detach … dd73ef87a`, `pnpm install`), holding a rough version of this slice: the four
writers took the staff language (`resolveInstalledStarterLanguages` over a `locations` row
left-joined to `tenants` id 1) and wrote «Primavera», «Verano», «Otoño», «Invierno», «Mostrador» and
«Abierto» for `es`; the three "Open" lookups matched `"Open"` or «Abierto». Nothing in the slice's
worktree was changed by it, and the throwaway worktree was removed afterwards. Each run's command was `pnpm exec vitest run …` in the package named,
with `TESTCONTAINERS_RYUK_DISABLED=true`.

1. **A configuration import replaces all four tables; no seed runs after it.** `service_steps`,
   `menu_periods` and `seasons` are declared tables (`packages/venue-service/src/configuration-transfer.ts:701`,
   `:715`, `:720`), `floor_zones` too (`packages/db/src/configuration-transfer.ts:79`).
   `importConfigurationTables` deletes every row of each declared table, then inserts the bundle's
   (`packages/provisioning/src/configuration-transfer.ts:719-733`). It runs as `beforeCommit`
   (`apps/server/src/boot.ts:1386-1394`, `packages/provisioning/src/first-setup-command-deployment.ts:325-334`), which
   `applyVenue` calls after every seed (`packages/provisioning/src/venue-apply.ts:349-394`, `:487`).
   So an imported venue keeps the exporting venue's words, whichever language they are in; pinned
   today for seasons by `apps/server/src/configuration-transfer.test.ts:7831` (the target's seasons
   equal the source's). Only `readSetupOpeningHours` reads the result afterwards, through the
   "Open" match (Task 4b).
2. **Every writer.** `git grep -n "ensureDefaultSeasons\|addStarterServiceSteps\|placeOpenPeriod\|DEFAULT_SEASONS\|STARTER_STEPS"`
   and the starter-word greps (`'"(Open|Counter|Spring|Summer|Autumn|Winter|Set up|Take order|Anything else\?)"'`
   over `apps packages scripts`, outside tests) give:
   - **Steps**: `addStarterServiceSteps` (`packages/venue-service/src/service-steps.ts:116-136`, the
     words at `:110-114`, today's rule at `:125`), called by the seed (`provisioning.ts:63`), by
     `createDepartment` for every department a manager adds (`operations.ts:214`), and by the
     demo for its deli (`apps/server/scripts/demo-seed/seed-floor.ts:86`).
   - **Seasons**: `ensureDefaultSeasons` (`seasons.ts:44-53`, from `DEFAULT_SEASONS`,
     `season-rules.ts:24-33`), called by the seed (`provisioning.ts:149`), `saveSeasons`
     (`seasons.ts:82`) and `targetSeasons` before any week write (`season-weeks.ts:62`, `:73`). It
     writes only when the venue has no season (`seasons.ts:46`).
   - **Counter zone**: the seed only (`provisioning.ts:103-111`, the name at `:105`), when no active
     counter-default zone exists.
   - **Period**: `placeOpenPeriod` (`menu-timetable.ts:58-89`, the name at `:73`), called by the
     seed (`provisioning.ts:153`) and `createDepartment` (`operations.ts:220`); it writes only when
     the department has no period (`:65-70`).
   Each writer reads the venue only through its `locationId`: `VenueScope` is `{ locationId }`
   (`operations.ts:61-63`).
3. **Every lookup by a starter word.** In production code only the three "Open" lookups the plan
   names: `apps/server/src/setup-opening-hours.ts:27`, `apps/server/scripts/demo-seed/seed-floor.ts:174`
   and `seed-catalogue.ts:108`. The demo's own `"Open"` writes (`seed-floor.ts:178`, `:188`) and
   `dev-setup.ts:298` (a device called "Counter") are not lookups. No production code finds a
   season, the counter zone or a step by its name (same greps, single-quoted SQL forms included).
   **In tests**, many find a default season by its English name; item 4 lists them.
4. **Which existing tests change: 107 measured (100 here, 7 in item 8), all because a venue with
   Spanish receipts now gets Spanish seasons, counter zone or period.** The prototype ran `@waitron/venue-service`'s node
   project whole, `@waitron/provisioning`, `@waitron/staffing`, `@waitron/media`, `@waitron/bookings`
   and `@waitron/composition` whole (the packages whose tests reach the writers), and 54
   `apps/server` files: every test file spelling a starter word in quotes, plus the setup and
   configuration-transfer suites.
   - `@waitron/venue-service`: `Tests 95 failed | 2588 passed (2683)`, in ten files: season-weeks
     24, period-delete 23, period-delete-routes 13, season-routes 11, day-resolver 10,
     opening-hours-calendar 8, menu-timetable 3, zone-closed-times 1, menu-timetable-routes 1,
     service-steps 1. Every venue in the first nine has `invoiceLocales: ["es-ES"]`; all but
     opening-hours-calendar have **no tenant row**, and still get `es`, because with no country
     `resolveInstalledCountryLocale` takes the receipt language when the screens have it
     (`packages/country-packs/src/registry.ts:46-72`). A second prototype round changed only the
     one helper in each file that finds a season by name (the sites in Task 2 and Task 3) and
     left **20** failures, each an assertion that spells a default season's name; they are the
     rows of "Changed test checks". The service-steps failure is the `["fr"]` row (below).
     Counting failures misses two kinds of change, which the review found (I1, I2): a later
     assertion in a test that already failed (a test stops at its first failure;
     `opening-hours-calendar.test.ts:255`, `:507-510`), and a test that SENDS a default season's
     name and still passes with a changed meaning (`season-routes.test.ts:346`, `:518`, `:548`).
     Both are in the table now, and Task 3 step 1 greps for the second kind.
   - `@waitron/provisioning`: 8 failed; 7 of them (`cli-owned-entry` 5, `cli-same-hour-entry` 1,
     `first-setup-command-import` 1) fail identically with the prototype stashed, so they predate
     this slice (their stderr carries a `<claude-code-hint …>` line from this machine's session). The
     eighth is `venue-apply.test.ts`'s starting-zone case (`:382`, `:388`, "Counter" became
     «Mostrador»).
   - `apps/server`, the 54 files: `Tests 4 failed | 2351 passed (2355)`: `till-api.seasons.test.ts`
     3 (its `seasonId` helper, `:68-74`) and `configuration-transfer.test.ts` 1 (the seasons
     transfer case, `:7718-7871`). The rest of the server suite: item 8.
   - `@waitron/staffing` (279), `@waitron/media` (381), `@waitron/bookings` (145),
     `@waitron/composition` (132): all passed.
   - The browser suites (dashboard, till, setup, `packages/*/src/dashboard/`) were not run: they
     import none of the writers (`git grep -l` of the writers' names there finds only HTTP-client
     methods with similar names and one `import type`).
   **What `resolveInstalledStarterLanguages` answers for a test venue with no tenant row**, read from
   `registry.ts:46-72` and confirmed by the 95 failures: `es-ES` receipts give `es`, `en-GB` give
   `en`, and anything else (`fr`, `en`, `es`, none) gives `en`, the `FALLBACK_LOCALE`
   (`packages/shared/src/locales.ts:19`). A venue with a tenant row (`seedTenant` writes `ES`,
   `packages/db/src/testing/seed.ts:31-33`) and an unlisted receipt gets Spain's `es`.
5. **The demo's lookups.** With the prototype's two demo lookups put back to `"Open"`,
   `apps/server/scripts/demo-seed/seed.test.ts`'s five Spanish-demo cases ("a demo in %s takes the
   area's languages and misses no translation", `:747-790`) fail: `Tests 5 failed | 37 passed (42)`
   over the three demo files. Reverting each lookup alone, on the Madrid case: without
   `seed-catalogue.ts`'s fix it fails at `:787` (`expected [ { kind: 'menu', …(4) }, …(1) ] to
   deeply equal []`, a content gap from the unreused menu); **without `seed-floor.ts`'s fix it
   passes** (`Tests 1 passed | 19 skipped (20)`), so no existing test catches the second "Open"
   period that lookup's miss creates. Task 4b adds that check.
6. **Guides and docs.** `git grep` of the starter words, English and Spanish, over
   `apps/server/src/guide/`: only the steps' names, as examples
   (`guide/en/table-service.md:124-125`, `guide/es/table-service.md:128-130`). The steps a real
   venue gets do not change (below), so neither guide changes; no guide names a season, the counter
   zone or the period. «Mostrador» in `guide/es/kitchen-service.md:141` and `table-service.md:87`,
   `:226-227` is the till's counter screen and a counter order's label, not the zone. Docs that do
   need a line: `docs/developers/design-system.md:337-338` ("A new venue's four seasons are Spring
   green…"), `docs/developers/conventions-data.md:108-120` (the starter sentence), `:647` and
   `:715-716` (the "Open period" by that name), `docs/backlog.md:1819-1828` (A900, whose sentence
   says the steps follow the first receipt language "which … A918 fixes"), and the audit's steps row
   (`docs/backlog/english-only-audit.md:133`) and finding (`:31-33`). The root `CLAUDE.md` line
   (`:368-378`) lists no starter, so it does not change.
7. **The English-only guard.** `venue-service` is not in `GENERIC_PACKAGES`
   (`packages/db/src/english-only.ts:15-57`), so nothing in it is scanned today, tests included;
   `src/starter-content.ts` at the top of `src/` would be skipped anyway (`:105`, `:237`). The
   review's diff grep (Task 5) is the only check on this package's tests.

8. **The rest of the server suite** (the other 995 files, `pnpm exec vitest run --exclude
   '{<the 54 files>}'` in `apps/server`, 1431 s): `Tests 7 failed | 22392 passed | 25 skipped
   (22424)`, in three files, each passing on the stashed tree (`Tests 67 passed (67)`) and failing
   again with the prototype (`Tests 7 failed | 60 passed (67)`). None reads a starter word; each
   puts the test's own period "Always" (`packages/venue-service/src/testing/zone-menus.ts:33-41`)
   beside the provisioned starter period in the same department, and «Abierto» sorts before "Always"
   where "Open" sorted after it:
   - `apps/server/src/till-api.zone-closed.test.ts`, 5 tests: its `venue()` takes the department's
     first period from a select with no order (`:48-51`) and paints the whole week with it; it now
     gets the starter period, whose menu does not hold the test's "Caña", so `park` answers 400
     (`:101`).
   - `apps/server/src/testing-zone-offers.test.ts`, 1 test: `savedPeriod` (`:175-182`), the same
     unordered select; the received `keepOpen.periodId` is the starter period's.
   - `apps/server/src/till-api.sell-published.test.ts`, 1 test (`:976-978`): the zone's offers list
     the bacon from both menus, in period-name order (`packages/venue-service/src/operations.ts:895`),
     and `find` takes the first, now the starter period's unrepublished menu (`'public'`).
   These change the fixture's choice, not what the test checks: each names the test's own period or
   menu instead of taking the first row (Task 4c step 1). Production ordering by name is unchanged.
   Measured in the prototype: with those three changes (`eq(menuPeriods.name, "Always")` in the two
   selects, `offer.menuId === tables.menuId` in the `find`), the three files print
   `Tests 67 passed (67)`.

## Decisions (slice 3)

1. **One file, four objects**: `packages/venue-service/src/starter-content.ts` holds
   `STARTER_STEP_NAMES` (`"Set up"`, `"Take order"`, `"Anything else?"` → today's «Montar mesa»,
   «Tomar nota», «¿Algo más?», `service-steps.ts:111-113`), `STARTER_SEASON_NAMES` (Spring, Summer,
   Autumn, Winter → «Primavera», «Verano», «Otoño», «Invierno»), `STARTER_ZONE_NAMES` (`Counter` →
   «Mostrador», the profile's word for the same English) and `STARTER_PERIOD_NAMES` (`Open` →
   «Abierto»), each `as const satisfies StarterTranslations<Exclude<StarterStaffLanguage, "en">>`,
   as slice 2's file (one-name rows hold the staff languages only). The season, zone and period
   words are **new** (owner FYI D: unchecked by a native speaker; the pull request lists them).
2. **One reader of the staff language**, `readStarterStaffLanguage(tx, cfg)` in a new
   `packages/venue-service/src/starter-language.ts`: one select of `tenants.country`,
   `locations.province` and `locations.invoiceLocales` for `cfg.locationId`, **left**-joined to
   `tenants` id 1, into `resolveInstalledStarterLanguages(...).staffLanguage`. Slice 1's adjustments
   seed inner-joins (`packages/adjustments/src/provisioning.ts:83-91`), which drops the receipt
   language too when the tenant row is missing. The two differ only in a database with no tenant
   row, which setup never leaves a seed with (`ensure-tenant` is the plan's first action,
   `packages/provisioning/src/venue-plan.ts:164`); the left join keeps today's step rule for the
   test venues that have none (item 4), and `starter-language.test.ts` pins it. Slice 1 is not
   changed and no backlog entry is added for the difference: in production both joins answer the
   same.
3. **Each writer reads the language only when it writes, and a caller writing several reads it
   once**: `addStarterServiceSteps` on each call, `ensureDefaultSeasons` only past its "has
   seasons" return, `placeOpenPeriod` only past its "has a period" return. That covers a department
   added later and a venue whose seasons are created by its first week write. The three take an
   optional `staffLanguage` that skips the read (review M3): `createDepartment` reads once and passes
   it to the steps and the period; the seed reads once and passes it to the steps, the seasons, its
   zone and the period. Callers that pass nothing (week writes, the demo's deli) keep the read.
   `createDepartment` reads once in a venue that already has seasons (every set-up venue: the seed
   writes them, `provisioning.ts:149`, before the period, `:153`). In a venue with none,
   `ensureDefaultSeasons`, reached through `placeOpenPeriod`'s week write (`replaceMenuWeek` →
   `stageMenuWeek` → `targetSeasons`, `menu-timetable.ts:77-88`, `:497`; `season-weeks.ts:62`), reads
   again. Chosen: say so rather than pass the language down that chain, which would add a parameter
   to three week-write functions for a case only test venues reach (round 3, M2).
4. **The English names stay in code**: `STARTER_STEPS` keeps only the English (`name`), and is
   exported from `service-steps.ts` for the key test; `DEFAULT_SEASONS` is unchanged;
   `COUNTER_ZONE_NAME = "Counter"` (`provisioning.ts`) and `OPEN_PERIOD_NAME = "Open"`
   (`menu-timetable.ts`) replace the two literals.
5. **The "Open" lookups match a set**: `STARTER_OPEN_PERIOD_NAMES`, in `menu-timetable.ts`,
   `[OPEN_PERIOD_NAME, ...Object.values(STARTER_PERIOD_NAMES[OPEN_PERIOD_NAME])]`, exported from the
   package index. No column marks the starter period (`schema/menus.ts:20-35`), so this needs no
   migration. Its cost, as the plan said: a manager in an English venue who renames the period to
   «Abierto», with the hours unchanged, is still read as the starter period by setup's check.
6. **Existing tests that find a default season by name** keep their English handles through one
   test helper, `packages/venue-service/src/testing/starter-seasons.ts` (`src/testing/**` is outside
   coverage, `packages/venue-service/vitest.config.ts:56`): `starterSeasonName(english, staffLanguage)`
   and its reverse, `englishSeasonName(stored, staffLanguage)` (a season not in the file keeps its
   name). `englishSeasonName` is strict (review M2): with `staffLanguage` other than `"en"` it
   throws when `stored` is one of `DEFAULT_SEASONS`' English names, so every suite using it fails
   if the writer falls back to English. Every call states its staff language (`"es"` for those
   files' `es-ES` venues). The assertions that spell a default season's name read it through
   `starterSeasonName` instead. The alternative, an `en-GB` receipt on each file's venue, was
   rejected by the driver: those suites would stop running on a Spanish venue.

## What changes, and for whom

- **A venue set up through the setup screens** (Spain; receipts `es-ES`, `ca-ES`, `gl-ES` or
  `eu-ES`, `apps/server/src/setup-api.ts:457-466`; staff language `es` in every area, decision 3's
  table): its seasons, counter zone and starter period are «Primavera», «Verano», «Otoño»,
  «Invierno», «Mostrador» and «Abierto», for every member of staff (the owner's decision). Its steps
  stay Spanish, as today: today's rule gives Spanish for every receipt language but English
  (`service-steps.ts:125`), and the staff language is `es` for all four.
- **An existing venue** keeps every row it has (each writer writes only what is absent). A
  department a manager adds there from now on gets its period as «Abierto», beside the older "Open"
  ones; its steps are Spanish, as today.
- **An `en-GB`-receipt venue** (the English demo, the developer venue): everything English, as today.
- **The command-line tool `waitron-provision`**, which checks no receipt language (slice 2's note):
  with `en-US`, `en` or `EN-GB` receipts in Spain the steps become Spanish where today they are
  English (the staff language takes the receipt language only when it is exactly `es-ES` or
  `en-GB`), as slice 2 found and pinned for the profiles, and its seasons, counter zone and starter
  period, English today, become Spanish (review M5). Task 1 pins the `en-US` case as decided
  behaviour, and the pull request says so.
- **A Spanish demo** (`seedDemoRestaurant` with `locale: "es"`): its restaurant keeps the
  provisioned «Abierto» period (the fixed lookup updates it in place), while the deli's period is the
  demo's own English "Open" (`seed-floor.ts:188`): mixed words, but the demo's own content is A972's,
  so slice 3 changes only the lookups.
- **A venue imported from an export** keeps the exporting venue's words (Task 0 item 1).
- **Lists ordered by name** read differently in a new Spanish venue: «Abierto» sorts before a
  period such as "Always" where "Open" sorted after it (`operations.ts:895`, `menu-timetable.ts:173`),
  and the counter zone «Mostrador» ties at `displayOrder` 0 by name (`kitchen-screens.ts:116`,
  `apps/server/src/floor-plan-sets.ts:262`). A consequence of the owner's decision; one line in the pull request.

## Global constraints (slice 3)

Slice 1's global constraints hold, with these differences: Spanish appears only in
`packages/venue-service/src/starter-content.ts` and the dated doc notes; tests read expected words
from that file. `service-steps.test.ts` spells «Montar mesa», «Tomar nota», «¿Algo más?» today
(`:93-100`): its Spanish row is run unedited first, as evidence the Spanish venue's steps do not
change, then switched to read the file (Task 1 step 5). No migration, no error code, no receipt,
invoice, filed-record or report change. New test files: `packages/venue-service/src/starter-content.test.ts`
and `starter-language.test.ts`, in venue-service; **no new server test file**. A manifest change
needs the lockfile (Task 4a: `pnpm install`). Every implementer runs `pnpm format:check` before each
commit. Tasks 2 and 3 share a red window: Task 2's writer change fails Task 3's files until Task 3
lands, so Task 2 runs only its own files and says so in its handover.

## Changed test checks (slice 3)

The owner's decision changes what a Spanish venue's default seasons, counter zone and starter
period are called, and the staff-language rule changes one steps case. These are the only existing
assertions that may change; each is named in its task's commit and the pull request lists them.
Any other existing assertion that has to change is a STOP: say why in the handover. The prototype
counted the first failure in each test; a later assertion in a test already listed, failing for
the same reason (a default season's Spanish name in the received value), is expected and is not a
STOP; name it in the commit (review I2). "Lookup" rows change a helper that finds a default season
by its English name, and "fixture" rows change which of the test's own rows a fixture picks; they
change no assertion. Line numbers are on `dd73ef87a`.

| Where | Now | Becomes | Task |
| --- | --- | --- | --- |
| `packages/venue-service/src/service-steps.test.ts:97-101` (`["fr"]`, no tenant row) | Spanish names, "a venue whose first receipt language is neither starts with the Spanish names" | English names: with no country and a receipt language the screens lack, the staff language is the `FALLBACK_LOCALE`'s `en`; title says so. A new row keeps the old intent: the same `["fr"]` with a Spanish tenant row gives the file's `es` names | 1 |
| `packages/venue-service/src/service-steps.test.ts:91-96` (the `es-ES` row) | spells «Montar mesa»… | read from `STARTER_STEP_NAMES`; same values; title names no Spanish word | 1 (step 5) |
| Lookups: `season-weeks.test.ts:104-107` (`seasonIds`), `day-resolver.test.ts:104-106`, `zone-closed-times.test.ts:313`, `menu-timetable.test.ts:1247`, `:1271`, `:1352` | `season.name === "Winter"` / keyed by `season.name` | `starterSeasonName(name, "es")` / keyed by `englishSeasonName(season.name, "es")` | 2 |
| `packages/venue-service/src/menu-timetable.test.ts:1286-1291`, `:1389` | `name: "Spring"`… | `name: starterSeasonName("Spring", "es")`… | 2 |
| `packages/venue-service/src/menu-timetable-routes.test.ts:881` (`hours.clock_change_conflict`'s params) | `seasonName: "Autumn"` | `starterSeasonName("Autumn", "es")` | 2 |
| Lookups: `opening-hours-calendar.test.ts:90-92`, `:307-309`, `period-delete.test.ts:84`, `period-delete-routes.test.ts:98`, `season-routes.test.ts:98-100` | by English name | through the helper, as above | 3 |
| `packages/venue-service/src/opening-hours-calendar.test.ts:144`, `:249`, `:255`, `:378`, `:503`, `:507-510` (six assertions; the tenant is `ES`, Sevilla, `:48-61`) | default seasons' names spelled | `starterSeasonName(…, "es")` | 3 |
| `packages/venue-service/src/period-delete.test.ts:173`, `:192`, `:538`, `:607` | `name: "Summer"`…, and `"Summer 3 Dinner 20:00-23:00"`-style lines | the file's names, the lines built with `starterSeasonName` | 3 |
| `packages/venue-service/src/period-delete-routes.test.ts:260`, `:292`, `:391`, `:413` | as above, in route answers | as above | 3 |
| `packages/venue-service/src/season-routes.test.ts:154`, `:217`, `:376`, `:390` | default names spelled | `starterSeasonName(…, "es")` | 3 |
| `packages/venue-service/src/season-routes.test.ts:420-430` ("answers season.invalid with 400…") | renames Summer to `"Winter"`, a clash with the default Winter | renames it to `starterSeasonName("Winter", "es")`, still a clash; today's `"Winter"` no longer clashes and answers 200 (measured) | 3 |
| `packages/venue-service/src/season-routes.test.ts:346`, `:352`, `:358` ("PUT /seasons renames and moves a season", review I1) | renames Summer to `" Verano "` and expects `"Verano"`; after the slice Summer is already «Verano», so it renames nothing and still passes (measured by the review, E2) | an English name the file does not hold: `" High summer "` sent, `"High summer"` expected; the title stays true and the Spanish literal leaves the test | 3 |
| `packages/venue-service/src/season-routes.test.ts:518` ("refuses a call with no clock revision, a rename included") | the "rename" is `name: "Verano"` | `name: "High summer"`, still a rename | 3 |
| `packages/venue-service/src/season-routes.test.ts:548` ("refuses a stale clock revision on a move…") | sends `name: "Summer"`, today a move alone; after the slice a move plus a rename | `name: starterSeasonName("Summer", "es")`, a move alone again | 3 |
| `apps/server/src/till-api.seasons.test.ts:68-74` (lookup; its venue is a Spanish signed-in till) | `season.name === name` | `season.name === starterName(STARTER_SEASON_NAMES, name, "es")` (both from their packages; no venue-service test helper outside the package) | 3 |
| `apps/server/src/configuration-transfer.test.ts:7739`, `:7754`, `:7786`, `:7802`, `:7826-7829`, `:7834` (the seasons transfer; a Madrid `es-ES` venue, `:370-385`) | `'Winter'` in SQL, `eq(seasons.name, "Autumn")`, `ids.get("Winter")`, expected `"Spring"`, `"Summer"`, `"Winter"` | each read from `STARTER_SEASON_NAMES` (the SQL one as a bound value); `"Harvest"` and the round-trip assertions unchanged | 3 |
| `apps/server/src/till-api.zone-closed.test.ts:48-51` (fixture data, not an assertion: «Abierto» sorts before "Always") | the department's first period, unordered | the period named "Always", the helper's own (`zone-menus.ts:36`); its five tests' assertions unchanged | 4c |
| `apps/server/src/testing-zone-offers.test.ts:175-182` (fixture data, not an assertion: the same reason) | `savedPeriod`, the first row, unordered | the row named "Always"; the assertion at `:190-201` unchanged | 4c |
| `apps/server/src/till-api.sell-published.test.ts:976-978` (fixture data, not an assertion: the offers list in period-name order, and «Abierto» now comes first) | `offers.find((offer) => offer.productId === bacon.productId)` | the same `find` held to the test's own menu, `offer.menuId === tables.menuId` (an offer carries its `menuId`, `packages/catalogue/src/menu-types.ts:25`); the expected value unchanged | 4c |
| `packages/provisioning/src/venue-apply.test.ts:382`, `:388` (`starting_zone`) | `"Counter"` | `STARTER_ZONE_NAMES.Counter.es` (the `es-ES` venue `B10101010`); `@waitron/provisioning` gains a `devDependencies` entry for `@waitron/venue-service` (its closure does not reach provisioning: checked with a node walk over every workspace `package.json`, dependencies and devDependencies; the review's E5 repeated it), so the test reads the word and spells nothing; no change to CI's selection: provisioning already depends on venue-service through `@waitron/composition` (`packages/composition/package.json:33`), so `--filter "...@waitron/venue-service"` selects it today (checked with `pnpm ls -r --depth -1 --filter '...@waitron/venue-service'`, which lists `@waitron/provisioning`). The dependency is needed only because pnpm lets a package import what it names itself | 4a |

Predicted **unchanged**, each run unedited in its task: `packages/venue-service/src/provisioning.test.ts`
(its `en-GB` venues, `:52`, `:115`, `:546-563`, and its three `es-ES` venues with a tenant,
`:89-107`, `:359-…` and `:428-…`, none of which asserts a zone, season or period name; Tasks 4a and
4b extend `:89-107` rather than adding a venue), `operations.test.ts:276-286` (`en-GB`, `:386`),
`seasons.test.ts:69-110` (`en-GB`, `:60`),
`service-steps.test.ts`'s `["en"]` row (no country, `en` → `en`), `apps/server/src/setup-opening-hours.test.ts`
(`en-GB`, `:30`), `apps/server/scripts/demo-seed/seed.test.ts` and `seed-floor.test.ts` (the English
demo's `"Open"` at `seed.test.ts:430`, `seed-floor.test.ts:84`; the Spanish cases pass once the
lookups are fixed), and every other server file in Task 0 item 4.

## Task 1: the starter file, the staff-language reader, and the steps

Files: `packages/venue-service/src/starter-content.ts` (new), `starter-content.test.ts` (new),
`starter-language.ts` (new), `starter-language.test.ts` (new), `service-steps.ts`,
`service-steps.test.ts`, `provisioning.ts` and `menu-timetable.ts` (the two English constants
only), `index.ts`.

1. Tests first.
   - `starter-content.test.ts` (no database): `Object.keys(STARTER_STEP_NAMES)` equals
     `STARTER_STEPS.map((s) => s.name)`; `Object.keys(STARTER_SEASON_NAMES)` equals
     `DEFAULT_SEASONS.map((s) => s.name)`; `Object.keys(STARTER_ZONE_NAMES)` equals
     `[COUNTER_ZONE_NAME]`; `Object.keys(STARTER_PERIOD_NAMES)` equals `[OPEN_PERIOD_NAME]`
     (decision 6 of the plan: every starter has an entry, every entry is a starter).
   - `starter-language.test.ts` (`useVenueDb` with core, catalogue and venue-service migrations, as
     `service-steps.test.ts:24-27`), an `it.each`, each row a location insert and, where named,
     `seedTenant` (`ES`), expecting `readStarterStaffLanguage`'s literal answer: no tenant, `es-ES` →
     `es` (the left-join case); no tenant, `fr` → `en`; tenant, no province, `fr` → `es`; tenant,
     Madrid, `en-GB` → `en`; tenant, Barcelona, `ca-ES` → `es`; tenant, no province, `en-US` → `es`.
     And an unknown location id → `en`.
   - `service-steps.test.ts`, "a new department's starter steps" (`:83-109`): `seedVenue` gains an
     optional `{ tenant?: boolean; province?: string }` (tenant through `seedTenant`). Rows: change
     the `["fr"]` row and add its tenant twin (first table row); add `["en-US"]` with a tenant →
     the file's `es` names; add `["ca-ES"]`, Barcelona, with a tenant → `es` names. Leave the `en`
     and `es-ES` rows unedited.
   Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/starter-content.test.ts src/starter-language.test.ts src/service-steps.test.ts`;
   expected: the two new files fail to load (no `./starter-content.js`, no
   `./starter-language.js`); once they exist, `service-steps.test.ts`'s `["fr"]`-no-tenant row
   fails receiving the Spanish names and the `en-US` row fails receiving `Set up`, `Take order`,
   `Anything else?`.
2. Code.
   - `starter-content.ts`, the four objects of decision 1, the type as in
     `packages/provisioning/src/starter-content.ts:1-4`.
   - `starter-language.ts`, decision 2, importing `locations`, `tenants` from `@waitron/db` and
     `resolveInstalledStarterLanguages`, `type StarterStaffLanguage` from `@waitron/country-packs`
     (already a dependency, `packages/venue-service/package.json`).
   - `service-steps.ts`: `export const STARTER_STEPS` holds `{ name, start, minutes }` with the
     English name; `addStarterServiceSteps` gains an optional `staffLanguage` (decision 3) and
     writes `starterName(STARTER_STEP_NAMES, step.name, language)`, where `language` is the one
     passed or else `await readStarterStaffLanguage(tx, cfg)` (read once, before the loop); it drops
     its own `locations` select and the `:125` rule.
   - `provisioning.ts`: `export const COUNTER_ZONE_NAME = "Counter"` used at `:105`;
     `menu-timetable.ts`: `export const OPEN_PERIOD_NAME = "Open"` used at `:73`. No behaviour change.
   - `index.ts`: export `STARTER_SEASON_NAMES` only (the server tests read it, Task 3). Nothing
     outside the package reads `STARTER_STEP_NAMES` or `readStarterStaffLanguage`, so neither is
     exported (review M10); Tasks 4a and 4b export the zone's and the period's.
3. Re-run step 1's command: all pass; read the `Tests` line. Then the unedited
   `src/provisioning.test.ts` and `src/operations.test.ts` (the seed and `createDepartment`), and
   `pnpm --filter @waitron/server exec vitest run src/service-step-signals.test.ts src/till-api.service-steps.test.ts scripts/demo-seed/seed-floor.test.ts`
   (the server callers). `pnpm --filter @waitron/venue-service typecheck`.
4. Controls, each run and reverted:
   - In `starter-language.ts`, `innerJoin` for `leftJoin`: the no-tenant `es-ES` row fails,
     `expected 'en' to be 'es'`.
   - In `addStarterServiceSteps`, pass `"en"` instead of the read language: the unedited `es-ES` row
     fails, receiving `Set up`.
5. Separate commit: the `es-ES` row (`:91-96`) reads its names from `STARTER_STEP_NAMES` and its
   title names no Spanish word. Re-run the file.

## Task 2: the seasons, and the season tests that only need their lookup

Files: `packages/venue-service/src/seasons.ts`, `seasons.test.ts`, `starter-content.test.ts`,
`src/testing/starter-seasons.ts` (new), `season-weeks.test.ts`, `day-resolver.test.ts`, `zone-closed-times.test.ts`,
`menu-timetable.test.ts`, `menu-timetable-routes.test.ts`.

1. Tests first, in `seasons.test.ts`'s `ensureDefaultSeasons` block (`:69`): an `it.each` over three
   venues, each expecting the four seasons in start order with names `starterName(STARTER_SEASON_NAMES, english, language)`
   for the `DEFAULT_SEASONS` English, and today's colours: no tenant, `es-ES` → `es`; tenant,
   Valencia, `es-ES` → `es`; tenant, Madrid, `en-GB` → `en`. And "a venue whose seasons were all
   written by a later call gets them in the staff language": an `es-ES` venue's first
   `saveSeasons` (`seasons.ts:75-82`, whose first step is `ensureDefaultSeasons`) answers the
   file's names. The existing
   cases (`:70-110`, `en-GB`, no tenant) stay unedited.
   Also in `starter-content.test.ts` (review M1): for each staff language, the four season names
   `starterName` gives are distinct, non-empty and equal to their trimmed form. `seasons.name` is
   unique per venue (`schema/seasons.ts:40`) and the seed runs inside setup's one transaction, so a
   duplicate or empty word would undo the whole venue; `saveSeasons`' two-pass rename relies on no
   stored name starting with a space.
   Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/seasons.test.ts src/starter-content.test.ts`;
   expected: the two `es` rows and the `saveSeasons` case fail, receiving `Spring`…; the new
   `starter-content.test.ts` case passes from the start (a correct file), its red shown by the
   step 4 control (a duplicated word).
2. Code: `ensureDefaultSeasons` gains an optional `staffLanguage` (decision 3) and, after its early
   return, uses it or reads `readStarterStaffLanguage(tx, cfg)`, naming each `DEFAULT_SEASONS`
   entry `starterName(STARTER_SEASON_NAMES, season.name, language)`. The comment at
   `seasons.ts:150-153` names `ensureDefaultSeasons`' `DEFAULT_SEASONS` as a source of stored
   names: change it to name the starter file, or cut it to the invariant alone (review M1). Write
   `src/testing/starter-seasons.ts` (decision 6, with the strict `englishSeasonName`).
3. Re-run `seasons.test.ts`: all pass. Then run the five other files of this task and read the
   failures: they should be the prototype's (Task 0 item 4: 24, 10, 1, 3 and 1). Make their rows of
   "Changed test checks" (the Task 2 rows), importing the helper from `./testing/starter-seasons.js`,
   and re-run each file until it passes. A failure whose message shows no default season's Spanish
   name is a STOP.
4. Controls, each run and reverted:
   - In `ensureDefaultSeasons`, name the seasons with `"en"`: the two `es` rows fail with
     `Spring`…, and `season-weeks.test.ts` fails too, `englishSeasonName` refusing an English
     default name (decision 6).
   - In `starter-content.ts`, give Autumn the same `es` word as Summer: the distinct-names case
     fails.
   - In `englishSeasonName`, return `stored` unchanged: `season-weeks.test.ts` fails as in the
     prototype (`expected { Primavera: … } to deeply equal { Spring: … }`).
5. `pnpm --filter @waitron/venue-service typecheck`. The handover names Task 3's files as red until
   Task 3.

## Task 3: the season tests that spell a default season's name

Files: `packages/venue-service/src/opening-hours-calendar.test.ts`, `period-delete.test.ts`,
`period-delete-routes.test.ts`, `season-routes.test.ts`, `apps/server/src/till-api.seasons.test.ts`,
`apps/server/src/configuration-transfer.test.ts`. Test edits only; no production code.

1. Before editing, grep for requests that SEND a default season's name (review I1):
   `git grep -n -E 'name: " ?(Spring|Summer|Autumn|Winter|Primavera|Verano|Otoño|Invierno)' -- 'packages/venue-service/src/*.test.ts' 'apps/server/src/*.test.ts' ':!packages/venue-service/src/dashboard'`
   (90 hits on `dd73ef87a`; the `dashboard/` browser tests, 110 more hits, run with no venue).
   Expected classification. **Rows**: `season-routes.test.ts:346`, `:518`, `:548`, and `:427`
   inside the `:420-430` row. **Left alone**: `season-routes.test.ts:490` and `:504`, the
   malformed-body case (`:487-509`), which is refused `management.request_invalid` for the body's
   shape whatever the names, so its meaning does not change (it passed in the round-3 prototype);
   `seasons.test.ts`'s `autumnVenue` hits (`:154`, `:156`), custom seasons inserted before
   `ensureDefaultSeasons` runs, so no default is written; that file's other hits, for the same two
   reasons (line numbers on `dd73ef87a`): `:75-78`, `:469-473` and `:561-564` are in cases whose
   venues come from `newLocation`, which writes `en-GB` receipts (`:61`; `:69` on the slice's
   branch), so their staff language is `en`; `:235`, `:237` (`THREE`, `autumnVenue`'s own seasons
   as sent), `:317`, `:347`, `:349`, `:616` and `:707` are in `autumnVenue` cases, whose seasons
   are inserted before `createDepartment`, so no default is written. **Everything else** is an
   assertion
   already in the table, a venue whose staff language is `en` (`business-day-schedule.test.ts`, an
   `["en"]` venue with no tenant, `:124`; `service-delete-settings.test.ts:77`, venue-service's
   `configuration-transfer.test.ts:29` and `provisioning.test.ts:190-193`, all `en-GB`), or not a
   season (`themes-api.test.ts`'s "Summer terrace"). A hit outside these is a STOP. Then run the four venue-service files:
   the failures should be the prototype's (8, 23, 13 and 11). Make their Task 3 rows of "Changed
   test checks": the lookups first, then the spelled names, then the three sent names. A
   `"Summer 3 Dinner 20:00-23:00"`-style expected line is built with a template from
   `starterSeasonName("Summer", "es")`. Re-run each until it passes; read the `Tests` line. A failure
   whose message shows no default season's Spanish name is a STOP.
2. `pnpm --filter @waitron/server exec vitest run src/till-api.seasons.test.ts src/configuration-transfer.test.ts`:
   expected 3 and 1 failures. Make the two server rows, importing `STARTER_SEASON_NAMES` from
   `@waitron/venue-service` and `starterName` from `@waitron/country-packs` (both already
   `apps/server` dependencies, `apps/server/package.json:47`, `:75`): a literal key reads
   `STARTER_SEASON_NAMES.Winter.es`, a variable one `starterName(STARTER_SEASON_NAMES, name, "es")`
   (no string indexing, so no TS7053, slice 1's M9). Re-run: all pass.
3. Control: in `season-routes.test.ts`'s season.invalid case, put back `"Winter"`: it fails,
   `expected 200 to be 400`; restore.
4. Then `pnpm --filter @waitron/venue-service exec vitest run --project node` whole: every file
   passes.

## Task 4a: the counter zone

Files: `packages/venue-service/src/provisioning.ts`, `provisioning.test.ts`, `index.ts`,
`packages/provisioning/src/venue-apply.test.ts`, `packages/provisioning/package.json`,
`pnpm-lock.yaml`.

1. Test first, in `provisioning.test.ts`: extend "names the default department after the venue"
   (`:89-107`, an `es-ES` venue with a tenant, review M7) to also expect the counter-default zone's
   name `STARTER_ZONE_NAMES.Counter.es`; the `en-GB` cases (`:42-88`, `:113-…`) stay unedited, still
   "Counter" (where they check it) and English steps. Run
   `pnpm --filter @waitron/venue-service exec vitest run --project node src/provisioning.test.ts`:
   expected the extended case to fail, receiving `Counter`.
2. Code: the seed reads `readStarterStaffLanguage(tx, node)` **once**, at the top of its run, and
   passes it to `addStarterServiceSteps` and `ensureDefaultSeasons` (their optional parameter, Tasks
   1 and 2; review M3); the zone insert names
   `starterName(STARTER_ZONE_NAMES, COUNTER_ZONE_NAME, staffLanguage)`. Export
   `STARTER_ZONE_NAMES` from `index.ts`. Re-run: all pass.
3. Control: name the zone with `"en"` instead of the read language: the extended case fails with
   `Counter`. Restore.
4. `packages/provisioning/package.json` gains `"@waitron/venue-service": "workspace:*"` under
   `devDependencies`, so the test reads the zone's word from the file and spells nothing. This
   makes no change to CI's selection: provisioning already depends on venue-service through `@waitron/composition` (`packages/composition/package.json:33`), so `--filter "...@waitron/venue-service"` selects it today (checked with `pnpm ls -r --depth -1 --filter '...@waitron/venue-service'`, which lists `@waitron/provisioning`). The dependency is needed only because pnpm lets a package import what it names itself. `pnpm install` at the root;
   `git diff --stat pnpm-lock.yaml` shows the lockfile changed. Make `venue-apply.test.ts`'s row;
   run `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts` (all pass) and,
   at the root, `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/changed-scope.test.mjs`.
5. Typecheck `@waitron/venue-service` and `@waitron/provisioning`.

## Task 4b: the period, and the three "Open" lookups

Files: `packages/venue-service/src/menu-timetable.ts`, `operations.ts`, `provisioning.ts`,
`provisioning.test.ts`, `operations.test.ts`, `starter-content.test.ts`, `index.ts`,
`apps/server/src/setup-opening-hours.ts`, `setup-opening-hours.test.ts`,
`apps/server/scripts/demo-seed/seed-floor.ts`, `seed-catalogue.ts`, `seed.test.ts`.

1. Tests first.
   - `provisioning.test.ts`: the case Task 4a extended (`:89-107`) gains a catalogue and also
     expects the default department's one period `STARTER_PERIOD_NAMES.Open.es`.
   - `operations.test.ts`, "new department service periods" (`:275`): an `es-ES` twin of its
     first case (`:276-286`, an `en-GB` venue, `:386`, left unedited): `createDepartment` gives the
     new department one period named `STARTER_PERIOD_NAMES.Open.es`.
   - `starter-content.test.ts`: `STARTER_OPEN_PERIOD_NAMES` equals
     `["Open", STARTER_PERIOD_NAMES.Open.es]`.
   - `apps/server/src/setup-opening-hours.test.ts`: `seed()` gains an optional receipt language. A
     new case with `["es-ES"]` expects `{ departmentId }`. "Has no first-Open summary for an
     authored period" (`:77-81`) gains an `es-ES` twin (renamed to "Lunch": still `undefined`); it
     is never red, a control against a match that accepts any name. And decision 5's cost, pinned
     as decided behaviour (review M4): an `en-GB` venue whose period is renamed to
     `STARTER_PERIOD_NAMES.Open.es`, hours unchanged, expects `{ departmentId }`; the pull request
     names it.
   - `apps/server/scripts/demo-seed/seed.test.ts`, the Spanish-demo `it.each` (`:747-790`): add
     "the restaurant department holds one period": a `select count(*)` of `menu_periods` for the
     counter-default zone's department (the demo's `restaurantId`, `seed-floor.ts:171`), expected
     1, placed right after `seedDemoRestaurant` and before the `read` (`:777`), so it runs first.
     It is the check Task 0 item 5 found missing.
   Run `pnpm --filter @waitron/venue-service exec vitest run --project node src/provisioning.test.ts src/operations.test.ts src/starter-content.test.ts`:
   expected the new cases to fail (`Open`; no `STARTER_OPEN_PERIOD_NAMES`). The new server cases
   pass today (every venue's period is "Open"); they are run red in step 3.
2. Code, writers first: `placeOpenPeriod` gains the optional `staffLanguage` (review M3) and, past
   its early return, names the period `starterName(STARTER_PERIOD_NAMES, OPEN_PERIOD_NAME, …)`,
   reading the language only when none was passed; `createDepartment` reads it once and passes it
   to `addStarterServiceSteps` and `placeOpenPeriod`; the seed passes its one read to
   `placeOpenPeriod` too. `STARTER_OPEN_PERIOD_NAMES` (decision 5) and `STARTER_PERIOD_NAMES` are
   exported from `index.ts`. Re-run step 1's command: all pass.
3. Run, before touching the lookups:
   `pnpm --filter @waitron/server exec vitest run src/setup-opening-hours.test.ts scripts/demo-seed/seed.test.ts`.
   Expected: the new `es-ES` setup case fails (`undefined`), and the five Spanish-demo cases fail,
   each first at the new one-period check (received 2). The `en-GB`-renamed case also fails
   (`undefined`): the lookup does not yet accept «Abierto».
4. The lookups: `setup-opening-hours.ts:27` becomes
   `if (!STARTER_OPEN_PERIOD_NAMES.includes(period.name)) return undefined;` (the set's type is
   `string[]`, so this compiles: the review's E4); `seed-floor.ts:174`
   `inArray(menuPeriods.name, [...STARTER_OPEN_PERIOD_NAMES])`; `seed-catalogue.ts:108`
   `d.name in (${sql.join(STARTER_OPEN_PERIOD_NAMES.map((name) => sql`${name}`), sql`, `)})`. Re-run
   step 3's command: all pass. Controls, each run and reverted: put back `seed-floor.ts:174`'s
   `eq(…, "Open")`: the Spanish-demo cases fail at the one-period check (2); put back
   `seed-catalogue.ts:108`: they fail at the content-gap check (`:787`, measured in Task 0 item 5),
   and the setup cases are unaffected; put back `setup-opening-hours.ts:27`: the `es-ES` setup case
   and the `en-GB`-renamed case fail.
5. Typecheck `@waitron/venue-service` and `@waitron/server`. Then coverage of the new files only,
   node project (review M6; CI's merge job judges the package):
   `pnpm --filter @waitron/venue-service exec vitest run --project node --coverage --coverage.include=src/starter-content.ts --coverage.include=src/starter-language.ts`;
   read the per-file table: both files at 100% lines and branches.

## Task 4c: the three server fixtures, and the unedited server run

Files: `apps/server/src/till-api.zone-closed.test.ts`, `testing-zone-offers.test.ts`,
`till-api.sell-published.test.ts`. Test edits only; no production code. Runs after Task 4b (the
period's name is what makes these fail).

1. The three fixtures of Task 0 item 8: run
   `pnpm --filter @waitron/server exec vitest run src/till-api.zone-closed.test.ts src/testing-zone-offers.test.ts src/till-api.sell-published.test.ts`
   (expected `Tests 7 failed | 60 passed (67)`, as measured), make their three rows of "Changed
   test checks", and re-run: all pass (measured in the prototype: `Tests 67 passed (67)`). A
   failure there that the starter period's name does not explain is a STOP.
2. Unedited: `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/first-fiscal-setup.e2e.test.ts scripts/demo-seed/seed-floor.test.ts scripts/demo-seed/seed-catalogue.test.ts scripts/dev-setup.test.ts`.
   Typecheck `@waitron/server`.
## Task 5: the docs, the backlog and the English-only check

Files: `docs/developers/conventions-data.md`, `docs/developers/design-system.md`, `docs/backlog.md`,
`docs/backlog/service-periods.md`,
`docs/backlog/architecture.md`, `docs/backlog/english-only-audit.md`.

1. `conventions-data.md:108-120`: the sentence names the service steps, the seasons, the counter
   zone and the starter menu period as done, in `packages/venue-service/src/starter-content.ts`,
   written in the staff language whenever they are written (a department added later included); and
   drops them from "still written from code", which leaves the units and the first menu with its
   root section and home layout. `:647` and `:715-716`: "the first department's Open period" becomes
   "the first department's starter period (named "Open" in the staff language)", and `:647`'s
   completion-screen sentence says the check finds that period by any name the starter file gives
   "Open".
2. `design-system.md:337-338`: "A new venue's four seasons are Spring green, Summer amber, Autumn
   orange and Winter blue" says the colours are fixed and the names are written in the staff
   language (`STARTER_SEASON_NAMES`).
3. `docs/backlog.md`: the A918 entry (`:1979-1995`) says slice 3 is done in this pull request and
   only slice 4 (units, first menu) is left; the A900 entry's sentence at `:1825-1828` ("The starter
   names are English when the venue's first receipt language is English … A918 fixes it") becomes
   one dated sentence: since A918 slice 3 they come from `packages/venue-service/src/starter-content.ts`
   in the staff language. This goes in this pull request, not a push to `main` after the merge.
4. Dated notes, not rewrites: `docs/backlog/architecture.md:417-425`'s A918 bullet (the steps,
   seasons, zone and period moved); `docs/backlog/service-periods.md:490`, a decision record under
   "Decisions and deliberate limits" ("a new venue's are Spring green, Summer amber, Autumn orange
   and Winter blue"), gains a dated pointer that the names are now written in the staff language
   (review M8); and `docs/backlog/english-only-audit.md`, a dated line at the
   top beside slice 2's (`:3`) naming the steps row (`:133`) and the first finding's steps
   (`:31-33`) as the earlier tree.
5. The English-only check of the diff, outside the plans folder:
   `LC_ALL=en_US.UTF-8 git diff -U0 main...HEAD -- . ':!docs/superpowers/plans' | /usr/bin/grep -E '^\+\+\+ |^\+.*(Montar|Tomar|Algo|Primavera|Verano|Otoño|Invierno|Mostrador|Abierto|[áéíóúñ¿])'`:
   hits only in `packages/venue-service/src/starter-content.ts` and in the dated doc notes and
   backlog lines that name the words, plus file headers. A hit in a test file is a defect.
6. `pnpm exec vitest run scripts/guide-links.test.ts` (no guide changes; Task 0 item 6) and
   `pnpm format:check`.

Root guards before `/finish-branch`: the plan's list (below), plus
`pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts`. The seven provisioning
command-line failures of Task 0 item 4 predate this slice on this machine; CI's provisioning job on
the head is what judges them.

At the end of slice 3, before `/finish-branch`: `git diff --stat main...HEAD -- packages/fiscal-verifactu packages/core apps/server/src/receipt-document.ts apps/server/src/invoice-pdf.ts apps/server/src/receipt-figures.ts`
prints nothing.

## Review focus (slice 3)

- **Languages**: a `ca-ES` or `gl-ES` venue gets `es` words, an `en-GB` one English, a no-country
  `fr` one English; never a Catalan word in a one-name row.
- **Every writer**: the steps on `createDepartment`, the seasons through a first week write, the
  period on a department added later; one staff-language read per seed, and per `createDepartment`
  in a venue that already has seasons (decision 3 says where a second read happens).
- **Tests whose meaning changes without failing**: the sent-name grep (Task 3 step 1).
- **The "Open" set**: setup's check and both demo lookups find «Abierto»; the Spanish demo ends with
  one restaurant period.
- **No Spanish outside the starter file and the dated docs** (Task 5 step 5).
- **Codex run-it seat**: two reviews, the second told to set this plan aside.


## Review rulings (slice 3)

The fresh review (`~/waitron-campaign-b/a918-3-plan-review.md`, on `472904b3e`): 0 Critical, 3
Important, 10 Minor. The driver took all of them, with the specifics below.

| Finding | Ruling |
| --- | --- |
| **I1**: three `season-routes.test.ts` cases send a default season's name and change meaning without failing | Taken: three rows (`:346`/`:352`/`:358` and `:518` become "High summer"; `:548` reads the file's word through `starterSeasonName`); Task 3 step 1 greps for sent names; slice 4's paragraph carries the same grep |
| **I2**: `opening-hours-calendar.test.ts` has six assertions, not four; the STOP rule would halt Task 3 | Taken: the row lists `:255` and `:507-510`; the "Changed test checks" preamble says a later assertion in a listed test failing for the same reason is expected, not a STOP |
| **I3**: Task 4 too large for one medium implementer | Taken: split into 4a (the counter zone, the provisioning devDependency, `venue-apply.test.ts`) and 4b (the period, the three "Open" lookups, the demo check, the three server fixtures); round 3 moved the fixtures and the unedited server run into 4c |
| **M1**: a duplicated or untrimmed season word would stop setup; a comment goes stale | Taken: Task 2's distinct, non-empty, trimmed case with its control; the `seasons.ts:150-153` comment |
| **M2**: the reverse helper accepts both languages | Taken in part, by the driver's ruling: the shared helper stays (both functions); `englishSeasonName` throws on an English default name when the staff language is not `en`; Task 2's control updated |
| **M3**: the staff language read twice per department, up to four times per seed | Taken: decision 3's optional `staffLanguage`; `createDepartment` and the seed read once (Tasks 1, 2, 4a, 4b) |
| **M4**: decision 5's cost not pinned | Taken: Task 4b's `en-GB` venue renamed to the file's word, expecting `{ departmentId }`, named in the pull request |
| **M5**: the command-line bullet understated | Taken: seasons, zone and period turn Spanish there too |
| **M6**: whole-package coverage run too heavy | Taken: Task 4b step 5 measures the two new files, node project only |
| **M7**: citation errors | Taken: `:7786`, `:7802`; the `es-ES` venue at `provisioning.test.ts:89-107` is named, and Tasks 4a and 4b extend it |
| **M8**: `docs/backlog/service-periods.md:490` needs a dated pointer | Taken: Task 5 step 4 |
| **M9**: the devDependency widens CI selection | Not needed: the premise was wrong (round 3, I2: provisioning already depends on venue-service through `@waitron/composition`); the dependency stays, at no CI cost, so the test reads the zone's word and spells nothing |
| **M10**: exports with no consumer | Taken: `index.ts` exports only `STARTER_SEASON_NAMES`, `STARTER_ZONE_NAMES`, `STARTER_PERIOD_NAMES` and `STARTER_OPEN_PERIOD_NAMES` |
| Planner's points | The shared season helper: yes. The optional tenant join: yes, with the slice-1 difference noted in decision 2 and no change to slice 1. The three server fixture edits: accepted as fixture data, not assertions, listed with that reason |


### Round 3 (slice 3)

The round-3 check of the fold (`~/waitron-campaign-b/a918-3-plan-round3.md`, on `5570fb2eb`): 0
Critical, 2 Important, 6 Minor. The driver took all of them as the check proposed, and split Task
4b.

| Finding | Folded into |
| --- | --- |
| **I1**: Task 3 step 1's grep has 200 hits; `season-routes.test.ts:490`, `:504` are neither listed nor exempt | The grep excludes `dashboard/` (90 hits, counted again on `dd73ef87a`); the step lists the expected classification: rows, the malformed-body case left alone (its meaning does not change), `autumnVenue`'s inserts, `en` venues, "Summer terrace" |
| **I2**: the CI cost claim is false | Removed from "What changes", the `venue-apply.test.ts` row, Task 4a step 4 and the M9 ruling; each now says provisioning is already selected through `@waitron/composition` (`pnpm ls -r --depth -1 --filter '...@waitron/venue-service'` lists it, rerun by the planner) and the dependency is for the import alone. No pull-request sentence about CI |
| **M1**: `provisioning.test.ts` has three `es-ES` venues, not one | "Predicted unchanged" names `:89-107`, `:359-…`, `:428-…` |
| **M2**: "one read per `createDepartment`" is broader than the code | Narrowed in decision 3 and "Review focus": a venue with no seasons reads again through `placeOpenPeriod`'s week write; passing the language down that chain was not chosen, and decision 3 says why |
| **M3**: Task 5's files omit `docs/backlog/service-periods.md` | Added |
| **M4**: Task 2 never runs the new `starter-content.test.ts` case | Task 2 step 1's command runs it; it passes from the start, its red shown by the step 4 control |
| **M5**: `floor-plan-sets.ts:262` has no directory | `apps/server/src/floor-plan-sets.ts:262` |
| **M6**: the header's "all taken" | "all taken, M2 in part, and M9 found unneeded by the round-3 check" |
| Driver: split Task 4b | Its fixture and unedited-server steps are Task 4c; Task 0 item 8, the three fixture rows and the I3 ruling point to 4c |

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

**Slice 3 — `feat/a918-3-venue-service-starters`.** (Its task list is above, under "Slice 3"; this paragraph is the plan as first written.) **Waits for the owner's answer to FYI A** (answered 2026-10-27 with the default, so it no longer waits): with the
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

**Slice 4 — `feat/a918-4-catalogue-starters`. Waits for the owner's answer to FYI A** (answered 2026-10-27 with the default, so it no longer waits), because the
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
`units`, `catalogues` and `sections` (review M10c). Its Task 0 also greps for tests that SEND a
starter's name in a request (a unit's or the first menu's English or Spanish name), not only for
tests that fail: slice 3's review found three that pass with a changed meaning (slice 3's review
rulings, I1). Whichever of slices 2-4 lands last
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
