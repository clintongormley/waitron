# The demo data set comes from the country pack — Implementation Plan

> 2026-10-08: A419 replaces this plan's Valencian code/default with `ca-ES-valencia`;
> see [Content languages per region](../../developers/products.md#content-languages-per-region).
> The decisions below record the earlier Catalan mapping.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: the owner answered the six decisions on 2026-10-06 (~08:19, amended ~08:21), and the
two open points about a country with no demo data on the same day (A at ~10:05, B at ~10:07); this
plan is amended to all of them (W109, lane A).** Nothing here is built. No task waits for an answer;
Task 2 is still built last.
_2026-10-07: all six tasks are now built — Task 1 (#1315), Task 6 (W109-6, #1320), Task 3 (W109-3,
#1321), Task 4 (W109-4, #1322), Task 5 (W109-5, #1323) and Task 2 (W109-2)._

**Amended 2026-10-06 to the owner's regional-language decisions of ~17:05–17:23** (decisions 9 to
12 below). They settle the three language points the owner had sent to the backlog at ~10:58, and
they change REAL venues as well as the demo: every Spanish area now requires at least Spanish, every
new venue starts with its area's required languages plus English, and the regional language is the
default wherever one is required. That real-venue change is a new task, **Task 6**, built before
Task 3; the demo then takes exactly the languages setup gives (Tasks 3 and 4).

**Goal:** A demo venue's menus, floor, staff and example data belong to its country, the way its
company name and tax number already do (W108, #1276). Every new venue, demo or not, starts with the
content languages its area requires plus English, with the area's regional language the default
where it requires one (Task 6). A Spanish demo writes its customer-facing text in exactly those
languages: in Madrid Spanish and English; in Catalonia, the Valencian Community and the Balearic
Islands Catalan (the default), Spanish and English; in Galicia Galician (the default), Spanish and
English. A country whose pack carries its own made-up demo identity but no demo data of its own
gets the existing demo data in English, under that identity, and its practice sales are recorded
through the venue's own fiscal module.

**Architecture:** The data the demo seed writes today (menus, products, option lists, floor, staff,
adjustment reasons, a few names written inline) becomes one value, a _demo data set_, kept on the
server beside the seed code. The country pack names its data set by a plain string id, the way a
fiscal jurisdiction names its filing module. The seed code stays shared: it reads whichever data
set the venue's country names, or the fallback set when the pack names none. The demo takes the
content languages setup gives a new venue in its area — one shared function over the pack's area
rules, added in Task 6 — and writes every customer-facing text in each of them.

**Tech Stack:** TypeScript, Vitest, the venue database through `useVenueDb`, Lit for the setup
wizard.

**Brief (no separate spec):** the owner's words, as recorded on W109 in lane C's queue:

- 2026-10-05 ~08:10: _"These names should be country pack specific, as should the demo data."_
- 2026-10-05 ~08:25: _"in Barcelona the demo data should be in catalán and Spanish and English."_
- The queue entry asks the plan to say: where the data lives (a pack stays browser-safe and names
  modules only as strings, CLAUDE.md §3); how a country with no demo data behaves; what stays
  shared; how W108's demo identity fits; how each co-official area and the single-language areas
  behave, reusing the pack's area rules rather than a second list; how the venue's content
  languages are switched on to match; who writes the Catalan (and other) text and how a speaker
  checks it; every existing test the plan would change; and the order of steps.

**The owner's answers (2026-10-06, said in the watcher session; recorded in
`~/waitron-campaign-c/questions.md`, "OWNER ANSWER … W109" ~08:19 and "OWNER AMENDMENT" ~08:21):**

- Decisions 1, 4 and 5 as recommended (below).
- Decisions 2 and 3, changed: _every Spanish demo carries Spanish and English, with Spanish the
  default content language, plus Catalan or Galician only where the area requires it._ Then, at
  ~08:21: _"For Catalan and Galician, that language would be the default, plus Spanish and
  English."_ An English-language setup in Madrid gets Spanish as its default content language;
  staff names stay English.
- Decision 6, changed: a Demo for a country whose pack has no demo data is not refused; it _"falls
  back to the existing demo data in English"_ (owner: _"fall back to English if there is no other
  demo data"_).

**The answers to the two open points (2026-10-06, said in the watcher session; recorded in
`~/waitron-campaign/questions.md`, "OWNER ANSWER … W109 point A" ~10:05 and "… W109 point B"
~10:07):**

- Point A, _"B, but for now the only country is Spain"_: _"a country pack carries its own made-up
  demo identity (company, tax number, location name), rather than the Demo form showing those
  fields. Spain is the only country today and already has one (W108), so build no form path for a
  pack without one; make the demo identity part of what a pack must provide to offer Demo (or what
  the English fallback requires), stated in the plan, so a future country cannot reach the venue
  screen without it."_
- Point B, _"B"_: _"build it now, inside W109-2 — the demo's practice sales are recorded through the
  venue's OWN fiscal module (the composition's fiscal seat), never hard-wired to Spanish
  Veri\*Factu. Spain stays the only country today, so the Spanish demo's records must come out
  exactly as before (prove it: same records for a Spanish demo before and after)."_ And: _"Fiscal
  code is touched only through its existing public seat — no change to hashing, chaining or
  issuance."_

**The regional-language decisions (2026-10-06 ~17:05–17:23, said in the watcher session; recorded
in `~/waitron-campaign/questions.md`, "2026-10-06 17:23 — OWNER ANSWERS", and in full in the
WATCHER NOTE of 17:23 above W109-1 in `~/waitron-campaign/queue.md`).** As relayed there:

- _"Required content languages per region … they apply to REAL venues too, not just the demo"_:
  every area not named below, _"**Spanish** required"_, because _"service must be offered in
  Spanish even where the law does not require Spanish on printed menus"_; Catalonia, _"Catalan +
  Spanish (unchanged; receipt stays fixed to Catalan)"_; Valencian Community, _"Catalan + Spanish
  (unchanged)"_, with _"'Valenciano' is Catalan (`ca`) for now"_, _"English is switched on but NOT
  required"_ and _"Keep the foreign-language notice"_; Balearic Islands, _"**Spanish + Catalan**
  required"_, _"Stricter than the law … the owner's choice"_; Galicia, _"Galician + Spanish
  (unchanged); keep its two-foreign-languages notice"_; Basque Country and Navarre, _"stays
  unsupported (already refused at setup as foral; no change)"_.
- _"English is switched on (not required) in every region. A NEW venue starts with its region's
  required languages plus English — this replaces setup's fixed `["es", "ca", "en"]` … So a
  Galician venue no longer gets Catalan, and Madrid gets Spanish + English."_
- _"The demo fills exactly those languages: the region's required languages plus English."_
- _"Default content language (owner 'a'): the regional language wherever one is required — Catalan
  in Catalonia, the Valencian Community and the Balearic Islands; Galician in Galicia; Spanish
  elsewhere. Setup and the demo agree (set `defaultContentLocale` in the pack for each). The venue
  can change it later on the Content languages page as today ('Set as default'); nothing locks
  it."_

---

## What happens today (measured)

Measured 2026-10-06 on `main` at `3137f5838`, in a throwaway worktree, with a probe test (not
committed) that provisions a venue through `applyVenue(planVenue(…))` in five provinces, reads
`content_languages`, runs `seedDemoRestaurant` with the seed language `demoSeedLocale` picks
(`apps/server/src/demo-seed.ts:11-13`) and `salesDays: 0`, then reads the row again and runs
`listTranslationGapReport`:

| Province (receipt language) | Languages setup gave the venue | Seed language | Languages after the demo seed | Missing translations after the seed |
| --- | --- | --- | --- | --- |
| Madrid (`es-ES`) | default `es`; `es, ca, en` | `es` | default `es`; `es, en` | 4 in English |
| Barcelona (`ca-ES`) | default `ca`; `ca, es, en` | **`en`** | **default `en`; `en, es`** | 4 in Spanish |
| Valencia (`es-ES`) | default `es`; `es, ca, en` | `es` | default `es`; `es, en` | 4 in English |
| Illes Balears (`es-ES`) | default `es`; `es, ca, en` | `es` | default `es`; `es, en` | 4 in English |
| A Coruña (`es-ES`) | default `es`; `es, ca, en, gl` | `es` | default `es`; `es, en` | 4 in English |

So today:

- **Setup already switches on the area's languages** (`packages/catalogue/src/provisioning.ts`,
  the `CATALOGUE_PROVISIONING` seed: Spain starts every venue with `es, ca, en`, adds the area's
  required languages, and takes the area's default where it names one).
- **The demo seed then throws that away.** `seedCatalogues` writes `[en, es]` or `[es, en]`
  (`apps/server/scripts/demo-seed/seed-catalogue.ts:91-94`) without the required-language check.
  Barcelona loses Catalan and gets English as its default; A Coruña loses Galician, which its area
  requires. (`docs/backlog.md` → "Product languages are hard-coded at setup" already names the
  demo seed as a writer that skips the check.)
- **Barcelona's demo is seeded in English**, because the seed language is read from the receipt
  language, and Catalonia's receipt is fixed to Catalan, which is neither `es` nor `en`.
- **The four missing translations are the four menus**: the seed gives no menu a customer-facing
  name, so every enabled language but the default lists Bebidas, Casa Delgado, Charcutería para
  llevar and Menú del Día as absent (printed by the same probe for Madrid).
- The seed's text exists only in English and Spanish (`SeedLocale = "en" | "es"`,
  `apps/server/scripts/demo-seed/menu.ts:8`).
- **A Demo for a country whose pack has no `demo` provisions the venue and then stops**:
  `seedInstalledDemo` throws (`apps/server/src/demo-seed.ts:21-24`), after `provision` has written
  the venue (`apps/server/src/setup-api.ts`, the `seedDemo` call after `provision`). The wizard
  cannot reach it today: it offers only setup-ready packs, and Spain is the only one (the United
  Kingdom pack says `availableForVenueSetup: false`, `packages/country-gb/src/united-kingdom.ts:13`).
  W108 found that refusing it in `parseProvisionPayload` turns one `setup-api.country-pack.test.ts`
  case red, and left the route and the test for the owner (`docs/backlog.md`, W108's "Left open").
- **Practice sales are hard-wired to Veri\*Factu, and on a venue that files nothing they stop at
  the first sale.** `seedSales` builds `new VerifactuBackend(…)` itself
  (`apps/server/scripts/demo-seed/seed-sales.ts:14, 170-178`) instead of asking the composition's
  fiscal seat. Measured 2026-10-06 on `main` at `8cef37de4`, in a throwaway worktree, with a probe
  test (not committed) that provisions a United Kingdom venue the way
  `apps/server/src/fiscal-none.e2e.test.ts:69-77` does (territory `GB-vat`, so the node is stamped
  `filing_module = "none"`) and runs `seedSales` for 3 days: it throws `sif.not_registered` — such a
  venue gets no practice sales at all, not Spanish fiscal records.

_Pointer, added 2026-10-06 with the regional-language amendment:_ the table above is what `main`
did when measured and stays as measured. Task 6 changes its "Languages setup gave the venue"
column (for example Madrid becomes `es, en` and A Coruña `gl, es, en`), and Tasks 3 and 4 make the
demo keep exactly what setup gave; the rows after the plan are in "Languages follow the area" below.

## How it works after this plan

**Where the data lives.** A new type `DemoDataSet` (`apps/server/scripts/demo-seed/data-set.ts`)
and one value of it, `CASA_DELGADO_ES`, assembled from what `menu.ts`, `floor.ts`, `staff.ts` and
`seed-adjustments.ts` hold today plus the six two-language strings written inline in the writers
(`seed-floor.ts:73, 83, 141, 217`, `seed-watchers.ts:21`, `seed-catalogue.ts:191`). A registry,
`DEMO_DATA_SETS`, maps an id to its data set. It is server-side, not in the pack: the pack must
stay browser-safe and small (the setup wizard bundles it), the data set points at 45 photographs,
and only the server seeds (`menu.ts` alone is about 600 lines). The pack names it:
`CountryDemoIdentity` gains `dataSet` (a required string in Task 1; Task 2 makes it optional, for
the fallback below), and Spain's is `"casa-delgado-es"`. A test fails if any pack's `demo.dataSet`
names no registered set — the same shape as `scripts/module-seams.test.ts`'s check that every
filing id names a fiscal module.

**How W108's identity fits.** Unchanged: the company name, tax number, location name and the two
department trading names stay in the pack, because the setup wizard shows them (prefilled location
name, the summary). The data set holds everything only the server needs. The trading names stay
keyed `restaurant` and `deli`, which are the two departments this data set builds; a second
country's data set with other departments would widen that type then, not now. **Since answer A,
the identity is what a pack must carry to be offered at setup at all** (Task 2): a test fails if a
setup-ready pack (`VENUE_SETUP_COUNTRY_PACKS`, `packages/country-packs/src/registry.ts:23-25`) has no
`demo`. That list is the venue screen's one country dropdown for every mode
(`apps/setup/src/screens/venue-screen.ts:673`), so the guard holds Prepare and Live to it too — this
plan's reading of answer A (decision 7). The guard is the enforcement: the setup route only finds
setup-ready packs (`getVenueSetupCountryPack`, `apps/server/src/setup-api.ts:358-359`), so while the
guard holds, no Demo request can name a pack without an identity.

**What stays shared.** The seed code (every `seed-*.ts` writer), the demo printer, publishing the
menus last, back-dated practice sales, the login constants (`DEMO_PIN`, `DEMO_ADMIN_EMAIL`,
`DEMO_DASHBOARD_PASSWORD`), the photo folder, and `INSTALLED_DEMO_SALES_DAYS`. **Per country:**
menus, products and their prices and VAT classes, option lists, units, floor (zones, tables,
statuses, department internal names), staff names, adjustment reasons, the watcher's name, the
Drinks menu's name.

**A country with no demo data (decision 6 and answers A and B, Task 2).** "No demo data" now means
a pack whose demo identity names no data set of its own (`demo.dataSet` absent); by answer A it
still carries the identity — company, tax number, location name and the two trading names — and
the demo uses those, exactly as Spain's does today. Its Demo is not refused. The venue is seeded
from the existing data set, `casa-delgado-es`, in English: content languages English (default),
staff names in English whatever the person setting it up speaks. **This plan's own choice, not the
owner's:** an area that requires a language also gets that language switched on beside English,
because `writeContentLanguages` refuses a list that leaves a required language out
(`content-languages.ts:185-186`); the text stays English only, so that language is listed as
missing translations. English stays the default even where the pack names another default for the
area, because the writers refuse a text with nothing in the saved default language
(`contentTranslationGap`, `packages/catalogue/src/content-languages.ts:34-47`, which looks up only
the default; read, not run), and the fallback's text is English only. Since the 17:23 decisions
every Spanish area where a venue can be set up requires Spanish, so a pack shaped like Spain's but
without demo data would get a fallback demo of English (default) plus Spanish and any regional
language, each of those listed as missing translations. No pack today has such an area without
demo data (the only other pack, the United Kingdom's, has no areas, and its starting languages are
English alone). _2026-10-07, as built (W109-2): the seed writes the data set's own text in every
enabled language, so a required language is listed as missing only when the set has no text in
it; English is the default by the owner's decision, not because the text is English only. See
`docs/backlog/setup.md`, W109-2._ Its month of practice sales is recorded like any other demo's,
through the venue's own fiscal module (below). No real pack reaches the fallback today — Spain
names `casa-delgado-es`, and the United Kingdom carries no identity at all — so only Task 2's tests
reach it. **A pack with no identity at all cannot offer Demo:** the
guard test above stops it, and the seed's own refusal (`apps/server/src/demo-seed.ts:21-24`) stays
behind it. There is no form path for it: the Demo
form keeps hiding the tax ID, legal name and operation description (`DEMO_HIDDEN`,
`apps/setup/src/screens/venue-screen.ts:80-90`).

**Practice sales go through the venue's own fiscal module (answer B, Task 2).** `seedSales` stops
building `VerifactuBackend` itself and asks the composition's fiscal seat for the venue's backend.
It works the venue's modules out from its fiscal territory, as provisioning did
(`venueModuleConfig`, `apps/server/src/provision.ts:28-30`, called by the setup route's provision
at `apps/server/src/boot.ts:1009-1012`, whose result `provisionVenue` saves at `provision.ts:151`);
the running server instead reads that saved list (`readModuleConfig`, `boot.ts:798-800`). Both end
at the same call: `fiscalSlot(modules, stamped)` returns the one fiscal contribution, checked
against the node's recorded `filing_module` (`packages/module/src/fiscal-slot.ts:12-30`), and its
`makeBackend` builds the backend (`boot.ts:1377-1378`, through
`apps/server/src/till-backend.ts:38-49`, for the till). Working the list out afresh picks the same
fiscal module as the saved one: `venueModuleConfig` sets every fiscal-slot member's switch from the
territory whatever the base list says (`venueFiscalSelection`, `packages/provisioning/src/venue-fiscal.ts:23-32`, then `selectFiscalModule`, `packages/module/src/fiscal-slot.ts:37-47`). The seed passes the same back-dating clock and the same
environment it passes today. For Veri\*Factu, `makeBackend` builds
`new VerifactuBackend({ clock, db, environment, deploymentEnvironment: environment, resolveClient })`
(`packages/fiscal-verifactu/src/slot.ts:46-53`) — the options `seed-sales.ts:170-178` passes by
hand today, with a `resolveClient` that likewise always rejects — so a Spanish demo's records are
unchanged; Task 2 proves it against a golden copy. For a venue whose filing module is `none`, the
backend is `NoneBackend`, which writes nothing (`packages/fiscal-none/src/backend.ts:12-42`):
measured 2026-10-06 with the probe above and the seed routed through the seat, a United Kingdom
venue got 38 practice sales, every one `fiscal_backend = "none"`, and no `registros_facturacion` or
`envios` row; a whole `seedDemoRestaurant` with `salesDays: 3` on such a venue completed the same
way. **This plan's reading, not the owner's:** `none` needs no decision — its practice sales are ordinary sales with no fiscal record, which
is what a till sale there records too (`apps/server/src/fiscal-none.e2e.test.ts:21-26`). Two things stay as they are, because changing either would
change the Spanish records: the sales sit at fixed UTC hours chosen for a Madrid business day
(`seed-sales.ts:188-190, 203-208`), and each line's VAT rate comes from `vatRateOn`'s default table
(`seed-sales.ts:226`), which is Spain's (`packages/catalogue/src/vat-rates.ts:19-27`). That table is
also what every till sale is priced at, whatever the country: the till paths rate lines through
`issueMoment` → `rateLines` → `vatRatesOn(on)` with no table given
(`apps/server/src/issue-moment.ts:14-20`, `packages/catalogue/src/pricing.ts:178-179`). `grep -rn
"vatRateOn\|vatRatesOn" apps packages --include='*.ts'`, leaving out tests, imports and
`vat-rates.ts` itself, finds three calls — `pricing.ts:179`, `seed-sales.ts:226` and
`apps/dashboard/src/widgets/product-editor.ts:643` — none passing a table. So a fallback demo's practice sales carry
Spain's VAT rates, the rates its own till would: this plan's probe of a three-day United Kingdom
demo recorded 10% and 21%, and the fresh-context reviewer's probe of the same path recorded 21, 10,
4 and 0% (its own run, not repeated here). Both are known limits below.

**Languages follow the area, through the pack's own rules — for every new venue, and the demo
takes the same (decisions 9 to 12).** Task 6 gives every area of Spain's pack but the Basque
Country and Navarre a required list and a default content language (`requiredContentLocales` and `defaultContentLocale`, read today at
`packages/country-es/src/spain.ts:194-238`), and adds one function beside the pack registry's
existing readers (`packages/country-packs/src/registry.ts:88-108`):
`resolveInstalledStartingContentLanguages({ country, area })`. It returns the area's required
languages, its default, and the languages a new venue starts with — the default first, then the
required ones, then English (switched on, never required). Where the pack names no default for the
area, the default is the country's own language (`pack.defaultLocale`); where there is no installed
pack, it is English. Setup's provisioning seed (`packages/catalogue/src/provisioning.ts:57-81`,
today's fixed `["es", "ca", "en"]` for Spain) writes exactly that list. The demo writes its own
content-language row as it does today, replacing the one setup wrote, but with the same function's
answer for the same area, so the two rows agree and no second list exists. By area, after Task 6:

| Area | Pack's required languages (after Task 6) | Default (after Task 6) | Setup's row and the demo's row (default first) | Setup's row before Task 6, for comparison | Notes |
| --- | --- | --- | --- | --- | --- |
| Catalonia (Barcelona, Girona, Lleida, Tarragona) | `ca, es` (unchanged) | `ca` (unchanged) | **ca**, es, en | **ca**, es, en | The owner's example. The receipt stays fixed to Catalan, so practice sales print in Catalan (Task 5). |
| Valencian Community (Alicante, Castellón, Valencia) | `ca, es` (unchanged) | `ca` (new) | **ca**, es, en | **es**, ca, en | Valencian is written as Catalan, under `ca` (decision 9). English is on, not required; the area's one-foreign-language notice stays, and with English on it does not show (`apps/dashboard/src/screens/content-languages-screen.ts:312-315` shows it only while the venue has fewer foreign languages than the notice asks for). |
| Balearic Islands | `ca, es` (new; was none) | `ca` (new) | **ca**, es, en | **es**, ca, en | Stricter than the law, which asks for at least one official language (`docs/compliance/regional-language-rules.md`, Balearic Islands): the owner's choice (decision 9). The receipt stays free to choose, Spanish by default (`spain.test.ts:226-235`). |
| Galicia (A Coruña, Lugo, Ourense, Pontevedra) | `gl, es` (unchanged) | `gl` (new) | **gl**, es, en | **es**, ca, en, gl | No Catalan any more. The two-foreign-languages notice stays and still shows: English is the one foreign language (it applies only to restaurants rated three forks or more). |
| Basque Country, Navarre | none (unchanged) | none | (no venue can be set up) | — | Setup refuses an unsupported fiscal jurisdiction (`apps/server/src/setup-api.ts:381`); the owner: _"no change"_. No Basque text is written (decision 5). Were one supported as the pack stands, the function would give Spain's own language plus English: **es**, en. |
| Canary Islands, Ceuta, Melilla | `es` (new) | `es` (new) | (no venue can be set up) | — | Unsupported fiscal jurisdictions too; they take "every area not named" (decision 9), which changes nothing reachable. |
| Everywhere else (Madrid and the other single-language areas) | `es` (new; was none) | `es` (new) | **es**, en | **es**, ca, en | Spanish can no longer be removed on the Content languages page (it shows **Required**). |
| A Spanish venue with no province, or a province the pack does not know | none | none | **es**, en | **es**, ca, en | Setup's route cannot produce one: it refuses a Spanish venue whose province it cannot find (`apps/server/src/setup-api.ts:367-370`). Test fixtures and the command line can; rules are per area, so nothing is required there (an open point for the owner, below). |
| A country with no areas (the United Kingdom) or no installed pack | none | none | **en** | **en** | English is the country's own language and the one added everywhere, so nothing changes (`packages/catalogue/src/provisioning.test.ts:79-80`). |

The venue can still pick another default on the Content languages page ("Set as default");
`writeContentLanguages` checks only that every required language is kept and that the new default
has no missing text (`packages/catalogue/src/content-languages.ts:169-207`), never the pack's
default.

So the Spanish data set carries text in **Spanish, English, Catalan and Galician**. Every
customer-facing text in it is typed `Readonly<Record<"es" | "en" | "ca" | "gl", string>>`, so a
missing translation fails the typecheck; a test then checks that every language the demo can
enable, in an area where a venue can be set up, is one the data set carries.

The demo writes its row through `writeContentLanguages` with the area's required languages
(`packages/catalogue/src/content-languages.ts:169-186`), so the required-language check the demo
skips today runs. For a venue provisioned through setup's seed after Task 6, the demo's default is
the one setup already wrote, so the check that runs only when the default changes
(`content-languages.ts:188-198`) does not run.

**Staff-facing names follow the person setting up, not the area.** Staff names of products, menus
and sections, kitchen names, department and zone names, table statuses and the watcher are plain
text, not translations, and the staff apps exist only in English and Spanish
(`packages/shared/src/locales.ts`). They are written in the _staff language_: Spanish when the
admin's display language (`admin.locale`) is Spanish, English otherwise. Setup never leaves
`admin.locale` empty: it takes the browser's language when that is English or Spanish, and
otherwise the area's or country's supported language (`apps/server/src/setup-api.ts:428-435`) — so
in Spain a browser set to Catalan alone gets Spanish staff names. Today the staff language is read
from the receipt language instead, which is why Barcelona's demo is English. The fallback for a
country with no demo data always uses English (decision 6).

**Practice sales print in the venue's receipt language.** Today a sale line's words are resolved in
`en-GB` or `es-ES` from the seed language (`seed-sales.ts:167`); after Task 5 they are resolved in
the location's own receipt language, so a Barcelona demo's practice receipts read in Catalan.

**Who writes the new text, and how a speaker checks it (decision 4, answered as recommended).**
Claude drafts the Catalan and Galician in Task 3 (about 80 short texts per language: product,
variant, section, unit and option names, two descriptions, seven adjustment reasons, four menu
names). The PR carries a side-by-side table (English, Spanish, Catalan, Galician) for a speaker to
read, and the backlog records the text as unchecked until one has. The PR does not wait for that
check.

## Owner decisions (answered 2026-10-06)

1. **Where the data lives and how the pack names it** — as recommended: a server-side data set
   named by the pack's `demo.dataSet` string (above).
2. and 3. **Content languages** — changed from the recommendation ("follow setup's whole starting
   list"): Spanish and English, Spanish the default; where the area requires Catalan or Galician,
   that language is the default, plus Spanish and English. An English-language setup in Madrid gets
   Spanish as its default; staff names stay English. _Superseded in part by decisions 9 to 12
   (2026-10-06 ~17:23):_ the demo's languages are now setup's starting languages for the area, and
   setup's own list changes (Task 6). What still stands from these two: an English-language setup in
   Madrid gets Spanish as its default, and staff names stay English.
4. **Speaker check of the Catalan and Galician** — as recommended: Task 3 lands with Claude's
   draft, the side-by-side table in the PR, and a backlog entry saying the text is unchecked.
5. **Basque** — as recommended: not written now.
6. **A country with no demo data** (W108's open question) — changed: not refused; it falls back to
   the existing demo data in English (Task 2). With answer A this means a pack whose identity
   names no data set; a pack with no identity cannot offer Demo.
7. **Answer A, the identity of a fallback demo** (2026-10-06 ~10:05) — the pack carries its own
   made-up identity; no form path for a pack without one. How this plan holds a pack to it: a test
   that every setup-ready pack carries `demo` (Task 2); that test is the enforcement. **This plan's
   reading of the answer, not the owner's words:** because the venue screen shows one country list
   for every mode (`apps/setup/src/screens/venue-screen.ts:673`), the test makes a demo identity a
   condition of offering a country in Prepare and Live too, not only in Demo — making the United
   Kingdom setup-ready would need an identity in its pack and a default operation description
   (below). The alternative, if the owner objects: offer such a pack in Prepare and Live and hide
   only the Demo choice for it, which is a form change this plan does not make. No refusal is added
   to the setup route: the route only finds setup-ready packs (`apps/server/src/setup-api.ts:358-359`),
   so while the test holds such a refusal could never fire, and W108's "Left open" item
   (`docs/backlog.md`) is closed by the test instead. The guard test also requires that Demo can fill the operation
   description, which the Demo form hides and fills only from the filing module's default
   (`#descriptionDefault`, `apps/setup/src/screens/venue-screen.ts:243-247`; `#next` stops while
   it is empty, `:510-513`): the `none` module has no such default
   (`packages/fiscal-none/src/slot.ts:19-26`, which declares no `venueFields`), so a future pack filing with `none` would reach the
   venue screen and stop there. Read, not run. The test makes that pack's author choose then (a
   default in the module, or a description in the identity); this plan adds neither.
8. **Answer B, practice sales in a fallback demo** (2026-10-06 ~10:07) — built now, in Task 2:
   every demo's practice sales go through the venue's own fiscal module, through the composition's
   fiscal seat; a Spanish demo's records come out exactly as before, proven against a golden copy
   captured before the change. **This plan's reading, not the owner's:** routing through the seat
   needed no further decision — a venue whose filing module is `none` records its practice sales as
   ordinary sales with no fiscal record (measured, above). A fallback demo's practice sales carry
   Spain's VAT rates, as its own till's sales would (above; a known limit).
9. **Required content languages per area, for real venues too** (2026-10-06 ~17:23; the owner's
   words as relayed are quoted under "The regional-language decisions" above) — Spanish in every
   area not otherwise named, _"service must be offered in Spanish even where the law does not
   require Spanish on printed menus"_; Catalan and Spanish in Catalonia and the Valencian Community
   (unchanged), with _"'Valenciano' is Catalan (`ca`) for now"_; **Spanish and Catalan in the
   Balearic Islands**, _"Stricter than the law … the owner's choice"_; Galician and Spanish in
   Galicia (unchanged); the Basque Country and Navarre _"no change"_ — named by the owner, so
   "every area not named" does not reach them, and they keep no language rule (were one supported,
   the function would still start it with Spanish and English). Built in Task 6. **Replaces**
   this plan's earlier Balearic row ("the pack requires no language, so the demo carries none"),
   which applied the earlier answer's _"only where the area requires it"_ to a pack that then
   required nothing there. That wording still holds; the Balearic Islands now require Catalan.
10. **English switched on, never required, everywhere; a new venue starts with its area's required
    languages plus English** (2026-10-06 ~17:23) — _"this replaces setup's fixed `["es", "ca",
    "en"]` … So a Galician venue no longer gets Catalan, and Madrid gets Spanish + English."_ Built
    in Task 6. **Replaces** this plan's earlier statement that setup's own row is unchanged and that
    the demo's languages differ from setup's by design (Madrid's demo dropping the Catalan setup
    gave): setup now drops it too. **This plan's reading, not the owner's words:** English is added
    by the shared function for every country, not only Spain's areas; for the only other pack, the
    United Kingdom's, and for a country with no installed pack the starting list is English alone
    either way.
11. **The demo fills exactly those languages** (2026-10-06 ~17:23) — the demo's content languages
    are setup's starting languages for the area (Tasks 3 and 4). **Replaces** the data set's
    "base languages" (Spanish and English) as the source of the demo's list.
12. **Default content language: the regional language wherever one is required, Spanish elsewhere**
    (2026-10-06 ~17:23, owner "a") — Catalan in Catalonia, the Valencian Community and the Balearic
    Islands; Galician in Galicia; set as `defaultContentLocale` in the pack for each, so setup and
    the demo agree; nothing locks it. Built in Task 6. **Confirms** this plan's earlier reading that
    the Valencian demo defaults to Catalan, and makes setup default to it as well.

## Open points

None that block a task. Points A and B are answered (decisions 7 and 8 above). The regional-language
decisions leave these cases unsettled; each task builds the default written here, and the owner may
overrule it:

- **A Spanish venue with no province, or a province the pack does not know.** The rules are per
  area, so nothing is required there and it starts with Spanish (the country's own language) and
  English. Setup's route cannot create such a venue (`apps/server/src/setup-api.ts:367-370`); test
  fixtures can, and so can the command line, whose `planVenue` copies the province as typed
  (`packages/provisioning/src/venue-plan.ts:194`; read, not run); two boot cases rely on it
  (`apps/server/src/boot.test.ts:3352-3387`: one saves a French-only list and expects the
  missing-text refusal, which a required Spanish would turn into `content.language_required`; the
  other pins `required: []`). Default: leave it so, since setup cannot create such a venue. The
  owner's reason for requiring Spanish (_"service must be offered in Spanish"_) leans the other way:
  it applies to a Spanish venue whatever its province, so the owner may prefer Spanish required
  there too — a country-level rule, which would change those two boot cases.
- **Receipts in the Valencian Community, the Balearic Islands and Galicia** stay free to choose with
  Spanish the default (`packages/country-es/src/spain.test.ts:226-235`), while their content
  default becomes the regional language. The decisions do not mention receipts outside Catalonia.
  Default: unchanged.

---

## Global Constraints

- The "⚠ THE RULE" block carried with W109 into lane A's queue applies, with the owner's 2026-09-27
  and 2026-10-05 test rules: an existing test changes only where this plan lists it (table at the
  end); any other existing test that goes red is a STOP, not a fix.
- The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
  `inmutabilidad` pass **unedited** in every task. Task 5 changes the words on demo practice sales
  (fiscal-adjacent). **Task 2 changes which code builds the fiscal backend demo practice sales are
  recorded through** — the composition's fiscal seat instead of a hand-built `VerifactuBackend` —
  so it takes the full review a fiscal change gets, and it also runs
  `apps/server/src/fiscal-none.e2e.test.ts` unedited. It reaches fiscal code only through that
  existing public seat (`fiscalSlot`, `FiscalContribution.makeBackend`). No task
  touches `computeHuella`, the chain, numbering, issuance, `registros_facturacion`, any fiscal
  module's package or `recordSale`'s builder.
- No migration in any task. An existing venue's STORED content-language row changes only when the
  venue is reset (pre-live rule, CLAUDE.md §3): Task 6 changes the languages a venue starts with,
  which only setup's provisioning seed writes, and the seed never overwrites a saved row
  (`onConflictDoNothing`, `packages/catalogue/src/provisioning.ts:86-89`). The required-language
  RULES are another matter: the server reads them from the pack at every start
  (`readVenueContentLanguageRules`, `apps/server/src/boot.ts:1390-1392`), so Task 6's rules apply
  to every venue from its first start on the new version — an existing Madrid venue sees Spanish
  marked **Required**, and the next save on its Content languages page puts back a required
  language its row lacks (the screen adds every missing required language to a save,
  `apps/dashboard/src/screens/content-languages-screen.test.ts:192-227`).
- A country pack stays browser-safe: plain values only, no import beyond `@waitron/country`
  (CLAUDE.md §3).
- Content-language codes are bare (`ca`, never `ca-ES`) wherever content is stored
  (`contentLanguageCode`, `packages/shared/src/content-languages.ts`); receipt languages are full
  tags.
- Every product keeps three DIFFERENT names — staff, customer-facing, kitchen — in every language
  (CLAUDE.md §3, `docs/developers/products.md`).
- Each task is its own PR with a backlog entry update; branches `feat/demo-data-<slug>`, except
  Task 6's `feat/content-languages-by-region`, which changes real venues rather than the demo.
  **Order: Tasks 1, 6, 3, 4, 5, then 2.** Task 6 reads nothing Task 1 adds, so the two may land in
  either order; Task 3 needs both (the data set, and Task 6's shared function). Task 2 needs the
  data set (Task 1), the language rule (Tasks 6, 3 and 4) and Task 5's staff-language change,
  which it overrides for the fallback, and Task 5's `invoiceLocale` input to `seedSales`, which its
  golden copy is captured against.
- **Overlap:** Task 6 changes `packages/catalogue/src/provisioning.ts`, a package lane C works in;
  check lane C's open branches for that file before starting, and do not run beside one that
  changes it. Tasks 1 and 6 both edit `packages/country-es/src/spain.ts` and `spain.test.ts`, in
  different places (the demo identity, and the language rules).
- Look at anything visual in both themes and at phone width (CLAUDE.md §4): in Task 6 the Content
  languages page of a new Madrid venue (Spanish marked **Required**) and of a new Balearic venue
  (Catalan the default); in Task 4 the Content languages page of a Barcelona demo. Task 2 changes
  nothing a screen draws.

## Review Focus

1. **A Barcelona demo set up from a Spanish-language browser** — content default Catalan, Catalan,
   Spanish and English enabled, staff names in Spanish, practice receipts in Catalan, Missing
   translations empty. Pinned in Task 4 (languages, gaps) and Task 5 (staff names, receipts).
2. **A Galician demo** — Galician the default, Spanish and English enabled, every customer-facing
   text has all three. Pinned in Task 4.
3. **A Madrid demo** — Spanish default, English, no Catalan. **A Balearic demo** — Catalan default,
   Spanish and English. Pinned in Task 4.
4. **A Demo for a country with no demo data** — a pack whose identity names no data set is seeded
   from the existing data in English, under its own identity and trading names, staff names
   English, with a month of practice sales recorded through its own fiscal module (for `none`:
   sales with no fiscal record); no setup-ready pack lacks an identity (the guard test);
   and a Spanish demo's practice-sale records are the same as before, row for row. Pinned in
   Task 2.
5. **`wa-wt reset demo` in English** — still seeds, staff names English, content default Spanish.
   Pinned in Task 4 (dev path case).
6. **A data set that misses one language for one text** — the typecheck fails, and the
   reachability test fails for an area whose languages the set does not carry. Pinned in Task 3.
7. **A new real venue in each area (Task 6)** — Madrid starts with Spanish (required, the default)
   and English; a Galician venue with Galician (the default), Spanish and English and no Catalan;
   the Valencian Community and the Balearic Islands with Catalan (the default), Spanish and
   English; Catalonia unchanged; English required nowhere. Pinned in Task 6. A venue already set
   up keeps its stored row (the existing case at `packages/catalogue/src/provisioning.test.ts:95-101`)
   but takes the new required-language rules at its next start.

---

### Task 1: The demo data is one value the pack names (no behaviour change)

Branch `feat/demo-data-set`. Every demo venue is seeded exactly as before.

**Files:**
- Create: `apps/server/scripts/demo-seed/data-set.ts` (the type, the registry, `demoDataSet(id)`,
  `inLanguages`)
- Create: `apps/server/scripts/demo-seed/data-sets/casa-delgado-es.ts` (`CASA_DELGADO_ES`)
- Create: `apps/server/scripts/demo-seed/data-set.test.ts`
- Modify: `packages/country/src/country.ts` (`CountryDemoIdentity.dataSet`)
- Modify: `packages/country-es/src/spain.ts` (`demo.dataSet: "casa-delgado-es"`)
- Modify: `apps/server/scripts/demo-seed/seed-adjustments.ts` (export `SeedReason`, today
  unexported at `:13`)
- Modify: `apps/server/scripts/demo-seed/seed.ts`, `seed-catalogue.ts`, `seed-option-lists.ts`,
  `seed-floor.ts`, `seed-watchers.ts`, `seed-staff.ts`, `seed-adjustments.ts` (read the data set
  passed in; no module-level import of `menu.ts`/`floor.ts`/`staff.ts` data left in a writer —
  `seed-floor.ts:32` and `:194-196` read `CASA_DELGADO`'s bar categories today, and read
  `dataSet.menus.restaurant` instead)
- Modify: `apps/server/src/demo-seed.ts`, `apps/server/scripts/dev-setup.ts` (pass
  `demoDataSet(identity.dataSet)`)
- Test changes (listed in the table at the end): `packages/country-es/src/spain.test.ts`,
  `apps/server/src/demo-seed.test.ts`, and the seed suites' call sites.

**Interfaces:**
- Produces:

```ts
// apps/server/scripts/demo-seed/data-set.ts
import type { SeedLocale, SeedCatalogue, SeedProductOptionLists } from "./menu.js";
import type { SeedZone, SeedTable, SeedStatus } from "./floor.js";
import type { SeedPerson } from "./staff.js";
import type { SeedReason } from "./seed-adjustments.js";

/** The language staff-facing plain names are written in; the staff apps exist in these two. */
export type StaffLanguage = SeedLocale;
export type StaffText = Readonly<Record<StaffLanguage, string>>;

export interface DemoDataSet {
  readonly id: string;
  readonly menus: {
    readonly restaurant: SeedCatalogue; // today's CASA_DELGADO
    readonly deli: SeedCatalogue; // DELI_TAKEAWAY
    readonly lunch: SeedCatalogue; // MENU_DEL_DIA
    readonly drinksName: StaffText; // { en: "Drinks", es: "Bebidas" }, seed-catalogue.ts:191
  };
  readonly productOptionLists: readonly SeedProductOptionLists[];
  readonly floor: {
    readonly zones: readonly SeedZone[];
    readonly tables: readonly SeedTable[];
    readonly statuses: readonly SeedStatus[];
    readonly departmentNames: { readonly restaurant: StaffText; readonly deli: StaffText };
    readonly upstairsBarZone: StaffText; // seed-floor.ts:141
    readonly deliCounterZone: StaffText; // seed-floor.ts:217
  };
  readonly watcherName: StaffText; // seed-watchers.ts:21
  readonly staff: readonly SeedPerson[];
  readonly adjustmentReasons: readonly SeedReason[];
}

export const DEMO_DATA_SETS: Readonly<Record<string, DemoDataSet>>;
/** Throws for an id no data set has; `data-set.test.ts` holds that every pack's id resolves. */
export function demoDataSet(id: string): DemoDataSet;

/** Customer-facing text cut to the venue's enabled languages; a language the map lacks is left out. */
export function inLanguages(
  text: Readonly<Record<string, string>>,
  languages: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    languages.flatMap((language) =>
      text[language] === undefined ? [] : [[language, text[language]!] as const],
    ),
  );
}
```

As built (2026-10-06): `inLanguages` lives in `apps/server/scripts/demo-seed/in-languages.ts` and
`data-set.ts` re-exports it. Kept in `data-set.ts` it made a circular import (`data-set.ts` imports
`data-sets/casa-delgado-es.ts`, which imports `seed-adjustments.ts`, which uses `inLanguages`) that
left the data set undefined in the seed suites. It also keeps each text's own key order, filtering
`Object.entries(text)`, rather than the venue's language order shown above: that order stored the
same values with `es` before `en` in 120 texts of a Spanish seed. Tasks 3 and 4 use this version.
`demoDataSet` checks the id with `Object.hasOwn`, so `"toString"` throws too, and its message starts
`demoDataSet: `.

- `SeedDemoInput` gains `dataSet: DemoDataSet`.
- Every inner writer takes the whole data set as a required `dataSet` field. The two that write a
  translated map from outside the catalogue also take the venue's languages as a required field:
  `seedOptionLists(tx, { productsByImage, locale, dataSet, languages })` and
  `seedAdjustmentReasons(tx, { locale, dataSet, languages })`; each passes every map through
  `inLanguages`. `seedCatalogues` cuts its own maps to the list it writes. `seedDemoRestaurant`
  reads the languages once, after `seedCatalogues` has written them (`readContentLanguages`), and
  passes them down. In this task the maps hold only `en` and `es` and the list is `[en, es]` or
  `[es, en]`, so nothing written changes.
- `CountryDemoIdentity` gains `readonly dataSet: string`. Task 2 makes it optional (a pack whose
  identity names no data set gets the English fallback), so the tests here and in Task 3 that walk
  the packs read it as `pack.demo?.dataSet` and skip `undefined`, and Task 2 leaves them as they
  are.

- [ ] **Step 1: Write the failing tests** in `apps/server/scripts/demo-seed/data-set.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { CASA_DELGADO, DELI_TAKEAWAY, MENU_DEL_DIA, PRODUCT_OPTION_LISTS } from "./menu.js";
import { DEMO_STAFF } from "./staff.js";
import { DEMO_ADJUSTMENT_REASONS } from "./seed-adjustments.js";
import { DEMO_DATA_SETS, demoDataSet, inLanguages } from "./data-set.js";

describe("demo data sets", () => {
  it("resolves every country pack's demo data set", () => {
    const named = COUNTRY_PACKS.flatMap((pack) => {
      const id = pack.demo?.dataSet;
      return id === undefined ? [] : [id];
    });
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(demoDataSet(id).id).toBe(id);
  });

  it("refuses an id no data set has", () => {
    expect(() => demoDataSet("no-such-set")).toThrow(/no-such-set/);
  });

  it("holds Casa Delgado's existing data unchanged", () => {
    const set = DEMO_DATA_SETS["casa-delgado-es"]!;
    expect(set.menus.restaurant).toBe(CASA_DELGADO);
    expect(set.menus.deli).toBe(DELI_TAKEAWAY);
    expect(set.menus.lunch).toBe(MENU_DEL_DIA);
    expect(set.productOptionLists).toBe(PRODUCT_OPTION_LISTS);
    expect(set.staff).toBe(DEMO_STAFF);
    expect(set.adjustmentReasons).toBe(DEMO_ADJUSTMENT_REASONS);
    expect(set.menus.drinksName).toEqual({ en: "Drinks", es: "Bebidas" });
    expect(set.watcherName).toEqual({ en: "Pass", es: "Pase" });
    expect(set.floor.departmentNames).toEqual({
      restaurant: { en: "Restaurant and bar", es: "Restaurante y bar" },
      deli: { en: "Deli", es: "Charcutería" },
    });
    expect(set.floor.upstairsBarZone).toEqual({ en: "Upstairs bar", es: "Bar de arriba" });
    expect(set.floor.deliCounterZone).toEqual({ en: "Deli counter", es: "Mostrador de charcutería" });
  });

  it("keeps only the venue's languages", () => {
    expect(inLanguages({ es: "Pan", en: "Bread", ca: "Pa" }, ["es", "en"])).toEqual({
      es: "Pan",
      en: "Bread",
    });
    expect(inLanguages({ es: "Pan" }, ["es", "gl"])).toEqual({ es: "Pan" });
  });
});
```

And in `apps/server/src/demo-seed.test.ts`, a new case: `seedInstalledDemo` passes
`dataSet: DEMO_DATA_SETS["casa-delgado-es"]` for an `ES` venue.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts src/demo-seed.test.ts`
  Expected: FAIL — `./data-set.js` does not exist; `pack.demo.dataSet` is undefined.

- [ ] **Step 3: Implement.** Add `dataSet` to `CountryDemoIdentity` and Spain's pack. Create
  `data-set.ts` and `data-sets/casa-delgado-es.ts`, the latter only REFERENCING today's exports
  (no data copied) plus the six inline strings moved out of the writers. `demoDataSet` throws
  `new Error(\`no demo data set "${id}"\`)`. Thread `dataSet` (and `languages`) through the
  writers, replacing each module-level data import and each inline `locale === "en" ? … : …` with
  the passed value (`dataSet.floor.departmentNames.restaurant[locale]` and so on).
  `seedInstalledDemo` and `dev-setup.ts` pass `demoDataSet(identity.dataSet)`.

- [ ] **Step 4: Add the new arguments at each listed test call site** (call sites only; no
  assertion changes — table at the end). Where a test passes `languages`, it passes the literal
  pair its seed language gives today (`["en", "es"]` for `"en"`, `["es", "en"]` for `"es"`), so
  later tasks leave it as it is. Then run the seed folder and the installed path:
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`
  and `pnpm --filter @waitron/country-es exec vitest run`
  Expected: PASS, with a `Tests` count printed.

- [ ] **Step 5: Prove the registry test by deletion.** Change Spain's `dataSet` to
  `"casa-delgado"`; `data-set.test.ts` must fail naming it. Restore.

- [ ] **Step 6: Commit** (`git commit -s`), backlog entry, and `finish-branch`.

---

### Task 6: Every new venue starts with its area's required languages plus English (built second, before Task 3)

Branch `feat/content-languages-by-region`. Decisions 9, 10 and 12. This task changes REAL venues,
not the demo: it changes the content languages setup gives a new venue, and which languages the
Content languages page will not let a venue remove. It touches no file under
`apps/server/scripts/demo-seed/`; until Task 4 lands, the demo still replaces setup's row with its
own pair, as it does today. It is placed here, before the demo's language work, so that Tasks 3 and
4 can take the demo's languages from the function it adds instead of building a rule of their own.

**What it must NOT change:**
- No migration, and no venue's stored row: the provisioning seed never overwrites a saved row
  (`onConflictDoNothing`, `packages/catalogue/src/provisioning.ts:86-89`; pinned by "preserves
  authored languages and reuses the initial menu on another seed",
  `packages/catalogue/src/provisioning.test.ts:95-101`). The stored row changes only when the venue
  is reset (CLAUDE.md §3, pre-live rule). The new required-language rules, though, reach every
  venue from its first start on the new version, because the server reads them from the pack at
  start (`apps/server/src/boot.ts:1390-1392`): an existing Madrid venue sees Spanish marked
  **Required**, and its next Content languages save puts back a required language its row lacks
  (Global Constraints).
- Receipt languages (`invoiceLocales`, `fixedReceiptLocale`), the areas' display languages
  (`defaultLocale`, pinned at `packages/country-es/src/spain.test.ts:82-102`) and the two
  foreign-language notices stay exactly as they are.
- No screen logic: the Content languages page already marks a required language and hides its
  **Remove** from the rules it is given. Only the wording of three messages changes (Files).
- The Prepare-to-Live configuration copy (`packages/catalogue/src/configuration-transfer.ts`) still
  copies the saved row without the required-language check; that stays open in the backlog.
- `docs/compliance/regional-language-rules.md` stays as it is: it describes the law and states no
  Waitron policy for the Balearic Islands' stricter rule to contradict (`grep -n -i waitron` on it
  printed nothing, 2026-10-06).

**Files:**
- Modify: `packages/country-es/src/spain.ts` — `VALENCIAN_COMMUNITY` (`:209-218`) gains
  `defaultContentLocale: "ca-ES"`; `GALICIA` (`:223-232`) gains `defaultContentLocale: "gl-ES"`; two
  new language laws, `BALEARIC_ISLANDS` (`requiredContentLocales: ["ca-ES", "es-ES"]`,
  `defaultContentLocale: "ca-ES"`, no notice, no fixed receipt) and `SPANISH`
  (`requiredContentLocales: ["es-ES"]`, `defaultContentLocale: "es-ES"`); `languageLawFor`
  (`:234-239`) returns `BALEARIC_ISLANDS` for `07`, nothing for the Basque Country (`01`, `20`,
  `48`) and Navarre (`31`), and `SPANISH` for every other area it does not already name. Each new
  law gets a one-line comment pointing at the backlog entry that records decision 9 and the owner's
  reason; the Balearic one also says it asks for more than the law, which wants at least one
  official language (`docs/compliance/regional-language-rules.md`, "Balearic Islands"). The
  existing comments at `:183-193`, `:206-208` and `:220-222` stay true and stay.
  > 2026-10-07, finish-branch review: `languageLawFor` and `LanguageLaw` are now `languageRulesFor` and `LanguageRules` in `packages/country-es/src/spain.ts`.
- Modify: `packages/country-packs/src/registry.ts` — export `VenueGeography` (declared without
  `export` at `:75`; `index.ts` re-exports `registry.js`), and add
  `resolveInstalledStartingContentLanguages` (below).
- Modify: `packages/catalogue/src/provisioning.ts` — replace `:57-81` (the fixed `["es", "ca",
  "en"]`, the backlog pointer and the merge with the required list) with one call to
  `resolveInstalledStartingContentLanguages({ country, area })`; delete `geographicLocales`
  (`:15-25`) and the imports that leave unused.
- Modify: `docs/content-and-images.md:12-14` (user-facing; follows `~/.claude/docs-writing-style.md`)
  — the sentence "A venue in Spain starts with Spanish, Catalan and English: in Catalonia Catalan is
  the default, elsewhere Spanish, and a venue in Galicia also gets Galician. A venue anywhere else
  starts with one language, worked out from where it is." becomes, for example: "A new venue starts
  with the languages Waitron keeps enabled for its region, plus English. In Spain Waitron keeps
  Spanish enabled in every region, and Catalan as well in Catalonia, the Valencian Community and
  the Balearic Islands, and Galician in Galicia; there that regional language is the default.
  Elsewhere in Spain Spanish is the default. A venue in another country starts with its country's
  language and English." And `:21-22`, "Some regions have rules about the languages a menu uses. A
  language your venue's region requires is marked **Required**", becomes, for example: "Waitron
  keeps some languages enabled for every venue in a region — the ones a regional law asks for, and
  Spanish everywhere in Spain. Such a language is marked **Required**". In Madrid the requirement
  is the owner's choice, not a law, so no text may say the region requires it.
- Modify: `apps/dashboard/src/i18n/codes.ts:172-173` (`content.language_required`) — "This venue's
  region requires that language, so it cannot be removed." / "La región del local exige ese
  idioma, así que no se puede quitar." become, for example, "Waitron keeps this language enabled
  for venues in this region, so it cannot be removed." / "Waitron mantiene este idioma activado en
  los locales de esta región, así que no se puede quitar."
- Modify: `apps/dashboard/src/i18n/strings.ts:404-407` and `:2700-2703`
  (`content_gaps.required_warning_one` and `content_gaps.required_warning`) — "{language} is
  required in this region, and …" / "El {language} es obligatorio en esta región y …" become, for
  example, "{language} stays enabled for venues in this region, and …" / "El {language} se mantiene
  activado en los locales de esta región y …", the rest of each sentence unchanged.
- Modify: the comment on `requiredContentLocales`, `packages/country/src/country.ts:29` ("Locales
  Waitron keeps enabled for a venue in this area, following its language rules.") — drop
  "following its language rules", which reads as a law; the pack's own comments say where each
  list comes from.
- Test: `packages/country-es/src/spain.test.ts`, `packages/country-packs/src/registry.test.ts`,
  `packages/catalogue/src/provisioning.test.ts`, `apps/server/src/venue-locale.test.ts`,
  `apps/dashboard/src/i18n/codes.test.ts`, `apps/dashboard/src/screens/content-languages-screen.test.ts`
  (listed changes, table at the end, plus new cases). Run the two dashboard files with
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/codes.test.ts src/screens/content-languages-screen.test.ts`
  (a browser-mode package: check free memory first, CLAUDE.md §2).

**Interfaces:**
- Produces (Tasks 3, 4 and 2 consume it):

```ts
// packages/country-packs/src/registry.ts
export interface VenueGeography {
  readonly country?: string | null;
  readonly area?: string | null;
}

export interface StartingContentLanguages {
  readonly defaultLanguage: string;
  /** The default first, then the area's required languages, then English. */
  readonly languages: readonly string[];
  readonly required: readonly string[];
}

/** Switched on for every new venue, required nowhere (owner, 2026-10-06; docs/backlog.md). */
const ENGLISH = "en";

/** The content languages a NEW venue starts with in this area, as language codes. */
export function resolveInstalledStartingContentLanguages(
  input: VenueGeography,
): StartingContentLanguages {
  const { required } = resolveInstalledContentLanguageRules(input);
  const defaultLanguage =
    resolveInstalledDefaultContentLanguage(input) ??
    contentLanguageCode(packFor(input)?.defaultLocale ?? FALLBACK_LOCALE);
  return {
    defaultLanguage,
    languages: [...new Set([defaultLanguage, ...required, ENGLISH])],
    required,
  };
}
```

  `FALLBACK_LOCALE` comes from `@waitron/shared` (`packages/shared/src/locales.ts:19`, `"en-GB"`),
  which `@waitron/country-packs` already depends on. In `provisioning.ts` the seed then reads:

```ts
const { defaultLanguage, languages } = resolveInstalledStartingContentLanguages({ country, area });
await tx
  .insert(contentLanguages)
  .values({ defaultLanguage, languages: [...languages] })
  .onConflictDoNothing({ target: contentLanguages.id });
```

- [ ] **Step 1: Write the failing tests.**
  In `packages/country-packs/src/registry.test.ts`, a new `describe("starting content languages")`:

```ts
// Add resolveFiscalJurisdiction to the file's existing "@waitron/country" import (it has
// findAdministrativeArea), and resolveInstalledStartingContentLanguages to its "./registry.js" one.
it.each([
  [{ country: "ES", area: "Madrid" }, { defaultLanguage: "es", languages: ["es", "en"], required: ["es"] }],
  [{ country: "ES", area: "Barcelona" }, { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
  [{ country: "ES", area: "46" }, { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
  [{ country: "ES", area: "07" }, { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }],
  [{ country: "ES", area: "A Coruña" }, { defaultLanguage: "gl", languages: ["gl", "es", "en"], required: ["gl", "es"] }],
  [{ country: "ES", area: "Bizkaia" }, { defaultLanguage: "es", languages: ["es", "en"], required: [] }],
  [{ country: "ES", area: null }, { defaultLanguage: "es", languages: ["es", "en"], required: [] }],
  [{ country: "GB", area: null }, { defaultLanguage: "en", languages: ["en"], required: [] }],
  [{ country: "XX", area: "Barcelona" }, { defaultLanguage: "en", languages: ["en"], required: [] }],
])("starts a new venue in %o with these content languages", (input, expected) => {
  expect(resolveInstalledStartingContentLanguages(input)).toStrictEqual(expected);
});

it("requires a language, and switches English on without requiring it, wherever a venue can be set up", () => {
  for (const pack of VENUE_SETUP_COUNTRY_PACKS)
    for (const area of pack.administrativeAreas) {
      if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
      const starting = resolveInstalledStartingContentLanguages({
        country: pack.countryCode,
        area: area.code,
      });
      expect(starting.required.length, area.name).toBeGreaterThan(0);
      expect(starting.required, area.name).not.toContain("en");
      expect(starting.languages, area.name).toContain("en");
      expect(starting.languages[0], area.name).toBe(starting.defaultLanguage);
    }
});
```

  The listed changes to existing cases (table at the end) are made in this step too, so they fail
  for the same reason: `spain.test.ts`'s Valencian and Galician defaults and its "everywhere else"
  case, which becomes three cases —

```ts
it("requires Catalan and Spanish in the Balearic Islands, with Catalan the default", () => {
  expect(area("07").requiredContentLocales).toEqual(["ca-ES", "es-ES"]);
  expect(area("07").defaultContentLocale).toBe("ca-ES");
  expect(area("07").foreignLanguageNotice).toBeUndefined();
});

it("requires nothing in the Basque Country and Navarre", () => {
  for (const code of ["01", "20", "48", "31"]) {
    expect(area(code).requiredContentLocales, code).toBeUndefined();
    expect(area(code).defaultContentLocale, code).toBeUndefined();
    expect(area(code).foreignLanguageNotice, code).toBeUndefined();
  }
});

it("requires Spanish, with Spanish the default, everywhere else", () => {
  const ruled = new Set([...CATALONIA, ...VALENCIAN_COMMUNITY, ...GALICIA, "07", "01", "20", "48", "31"]);
  const others = SPAIN.administrativeAreas.filter(({ code }) => !ruled.has(code));
  expect(others.map(({ code }) => code)).toEqual(expect.arrayContaining(["28", "35", "51", "52"]));
  for (const other of others) {
    expect(other.requiredContentLocales, other.code).toEqual(["es-ES"]);
    expect(other.defaultContentLocale, other.code).toBe("es-ES");
    expect(other.foreignLanguageNotice, other.code).toBeUndefined();
  }
});
```

  — `registry.test.ts`'s Madrid and default-language cases, `provisioning.test.ts`'s table (which
  also gains Valencia and Illes Balears rows), and `venue-locale.test.ts`'s Madrid case.
- [ ] **Step 2: Run them and watch them fail.**
  Run: `pnpm --filter @waitron/country-packs exec vitest run`,
  `pnpm --filter @waitron/country-es exec vitest run`,
  `pnpm --filter @waitron/catalogue exec vitest run src/provisioning.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/venue-locale.test.ts`.
  Expected: FAIL — `resolveInstalledStartingContentLanguages` is not exported; Valencia's and
  Galicia's `defaultContentLocale` are `undefined`; the Balearic Islands and Madrid require
  nothing; a Madrid venue starts with `es, ca, en` and an A Coruña venue with `es, ca, en, gl`.
- [ ] **Step 3: Implement** the three source changes under Files.
- [ ] **Step 4: Run** Step 2's commands again, then the content-language suites and the two boot
  cases that read the venue's content languages and rules through the server:
  `pnpm --filter @waitron/catalogue exec vitest run src/content-languages.test.ts src/content-translation-report.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/setup-api.test.ts scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`
  and, on its own because it is a name filter (its `Tests` count must read 2),
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "content-language rules it worked out|library image with no name in the new default"`.
  Expected: PASS, each with a `Tests` count, and no existing test changed beyond the table. The
  boot cases use a Spanish venue with no province (`boot.test.ts:3385`), which still requires
  nothing (open points, above). The demo-seed suites provision Madrid venues and still replace
  setup's row with their own pair until Task 4.
- [ ] **Step 5: Prove by deletion**, restoring after each:
  - Put Spain's fixed `["es", "ca", "en"]` back in `provisioning.ts`: the Madrid, A Coruña and
    Bizkaia rows of `provisioning.test.ts` fail (Catalan comes back). The Barcelona, Valencia and
    Illes Balears rows pass either way, since the pack's new defaults reorder the old list into
    the same answer — which is why those three are not the proof.
  - Leave `ENGLISH` out of the list: every Spanish row of the new `registry.test.ts` table and the
    every-area case fail; the United Kingdom and `XX` rows pass, because English is their default
    anyway — the control that shows the rows can tell the two apart.
  - Map `07` to `SPANISH` in `languageLawFor`: the Balearic case in `spain.test.ts`, the `07` row in
    `registry.test.ts` and the Illes Balears row in `provisioning.test.ts` fail.
  - Make `languageLawFor`'s last branch return `{}`: the "everywhere else" case, the every-area
    case, the Madrid row in `registry.test.ts` and the Madrid case in `venue-locale.test.ts` fail.
    `provisioning.test.ts`'s Madrid row passes either way — with no rule the default falls back to
    Spain's own language, so the list is still `es, en` — which is why the required list is pinned
    in the other three files.
    > 2026-10-07, finish-branch review: `languageLawFor` and `LanguageLaw` are now `languageRulesFor` and `LanguageRules` in `packages/country-es/src/spain.ts`.
- [ ] **Step 6: Look.** In a worktree's dev stack (`wa-wt onboarding <worktree-name>`), set up a
  Prepare venue in Madrid and, after a reset, one in the Balearic Islands; open each one's Content
  languages page in both themes and at phone width. Madrid: Spanish (default, **Required**, no
  **Remove**) and English. Balearic Islands: Catalan (default, Required), Spanish (Required) and
  English. Prepare rather than Demo, because until Task 4 the demo seed still replaces setup's row.
- [ ] **Step 7: Commit, backlog** — A9's "Product languages are hard-coded at setup" closes, except
  the two writers that still skip the required-language check, kept in a line of their own: the
  demo seed until Task 4, and the Prepare-to-Live configuration copy, which stays open; and
  the "Content languages per region" entry (A2) notes that setup's half is built —
  **`finish-branch`**.
  The change reaches three packages and what the server's content-language rules answer for every
  Spanish area; `finish-branch` decides the review weight.

---

### Task 2: A country with no demo data gets the existing demo data in English, and every demo's practice sales go through the venue's own fiscal module

Branch `feat/demo-data-english-fallback`. **Built last, after Task 5.** Written to the owner's
answers A and B (decisions 7 and 8). Fiscal-adjacent: the full review a fiscal change gets, and the
fiscal suites below run unedited.

**Files:**
- Modify: `packages/country/src/country.ts` (`CountryDemoIdentity.dataSet` becomes optional,
  `readonly dataSet?: string`; absent means the demo seeds the fallback data set in English)
- Modify: `apps/server/scripts/demo-seed/data-set.ts` (`FALLBACK_DEMO_DATA_SET_ID =
  "casa-delgado-es"`; `demoDataSetFor(identity)`; `englishFallbackLanguages` and
  `demoLanguagesFor`, below; Task 3's `demoContentLanguages` is left as it is)
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (the one call Task 4 added,
  `demoContentLanguages({ country, area: province })`, becomes
  `demoLanguagesFor(dataSet, { country, area: province })`)
- Modify: `apps/server/src/demo-seed.ts` (`seedInstalledDemo`: `dataSet: demoDataSetFor(identity)`,
  and staff language `"en"` when the identity names no data set; `salesDays` stays
  `INSTALLED_DEMO_SALES_DAYS` and the trading names stay the identity's own; the refusal of a pack
  with no identity at `:21-24` stays)
- Modify: `apps/server/scripts/dev-setup.ts` (`demoDataSetFor(DEMO_IDENTITY)` in place of Task 1's
  `demoDataSet(…dataSet)`, which stops typechecking once `dataSet` is optional; Spain names its set,
  so nothing it seeds changes)
- Modify: `apps/server/scripts/demo-seed/seed-sales.ts` — the backend comes from the composition's
  fiscal seat: drop the `@waitron/fiscal-verifactu` import (`:14`) and the hand-built
  `new VerifactuBackend(…)` (`:170-178`); in their place read the node's stamped `filing_module`
  and its location's `fiscal_territory` (`nodes` joined to `locations` on `nodes.location_id`,
  `packages/db/src/schema/nodes.ts:20-29`, `packages/db/src/schema/tenants.ts:95`), and build
  `fiscalSlot(enabledModules(ALL_MODULES, venueModuleConfig({ overrides: new Map() }, territory)),
  filingModule).makeBackend({ db, clock: backDating.clock, environment })` — `ALL_MODULES` from
  `../../src/modules.js`, `venueModuleConfig` from `../../src/provision.js`, `enabledModules` and
  `fiscalSlot` from `@waitron/module`. The empty base is enough: `venueModuleConfig` forces every
  fiscal-slot member's switch from the territory whatever the base says
  (`venueFiscalSelection`, `packages/provisioning/src/venue-fiscal.ts:23-32`, then `selectFiscalModule`, `packages/module/src/fiscal-slot.ts:37-47`). Nothing else in the file changes: the Madrid
  placement, the VAT lookup, the deterministic sequence and `demoSeedEnvironment`'s refusal of
  production stay as they are. `SeedSalesInput` is unchanged.
- Create: `apps/server/scripts/demo-seed/seed-sales.golden.test.ts` and its fixture
  `apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json` (Step 1)
- Test helper (grown in Step 2, before the cases that use it): `apps/server/scripts/demo-seed/testing/provision-venue.ts` gains an optional
  `country: "GB"` that provisions a United Kingdom venue the way
  `apps/server/src/fiscal-none.e2e.test.ts:69-77, 98-130` does — territory `GB-vat`, the modules
  `enabledModules(ALL_MODULES, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"))`
  for both `planVenue` and `applyVenue`, receipt `en-GB`, a GB tax ID, time zone `Europe/London`
  (a fixture growing; Spain stays the default)
- Test: `apps/server/scripts/demo-seed/data-set.test.ts`, `apps/server/src/demo-seed.test.ts`,
  `apps/server/scripts/demo-seed/seed-sales.test.ts`, `apps/server/scripts/demo-seed/seed.test.ts`
  (new cases only; no existing test changes in this task)
- Unchanged: `apps/server/src/demo-seed.test.ts:78-85`, "refuses, seeding nothing, a venue whose
  country has no demo identity" — still true with answer A; `apps/server/src/setup-api.ts` and
  `setup-api.country-pack.test.ts` (no route refusal; the guard is the enforcement, decision 7); no
  setup screen and no setup test (no form path); every fiscal package.

**Interfaces:**
- Consumes: `DemoDataSet`, `demoDataSet`, `demoContentLanguages` (Tasks 1 and 3),
  `StartingContentLanguages` (Task 6), `demoSeedLocale` and `SeedSalesInput.invoiceLocale`
  (Task 5); `fiscalSlot`, `enabledModules` (`@waitron/module`),
  `venueModuleConfig` (`apps/server/src/provision.ts:28-30`), `FiscalContribution.makeBackend`
  (`packages/fiscal/src/contribution.ts:53-55`).
- Produces:

```ts
// packages/country/src/country.ts — CountryDemoIdentity
/** The demo data set this country's demo seeds; absent, the fallback set in English. */
readonly dataSet?: string;

// apps/server/scripts/demo-seed/data-set.ts
export const FALLBACK_DEMO_DATA_SET_ID = "casa-delgado-es";
/** The pack's own data set, or the fallback when its identity names none. */
export function demoDataSetFor(identity: CountryDemoIdentity): DemoDataSet {
  return demoDataSet(identity.dataSet ?? FALLBACK_DEMO_DATA_SET_ID);
}

/** A fallback demo's text is English only, so English is its default (the writers refuse a text
 * with nothing in the saved default); the area's required languages stay switched on. */
export function englishFallbackLanguages(starting: StartingContentLanguages): DemoLanguages {
  const { required } = starting;
  return {
    defaultLanguage: "en",
    languages: ["en", ...required.filter((language) => language !== "en")],
    required,
  };
}

/** The languages a demo from `set` is written in: the area's starting languages when `set` is the
 * one the venue's pack names, the English fallback otherwise. */
export function demoLanguagesFor(set: DemoDataSet, geography: VenueGeography): DemoLanguages {
  const starting = demoContentLanguages(geography);
  return getCountryPack(geography.country ?? "")?.demo?.dataSet === set.id
    ? starting
    : englishFallbackLanguages(starting);
}
```

  _2026-10-07, as built (W109-2): the built doc comments differ, because the set's text is not
  English only. `dataSet`'s reads "absent, the demo seeds the fallback set with English as its
  default"; `englishFallbackLanguages`'s says English is the default by the owner's decision for a
  country with no demo data of its own. Neither `FALLBACK_DEMO_DATA_SET_ID` nor
  `englishFallbackLanguages` is exported, and `demoDataSetFor` has no doc comment._

  Deciding by comparing the set with the pack's own, rather than by asking only whether the pack
  names one, is what lets a test reach the fallback branch with a Spanish area: the one real pack
  that reaches it, the United Kingdom's, starts with English alone, so there the two branches give
  the same answer.

- [ ] **Step 1: Capture the Spanish practice sales as they are, before any other change.** Write
  `seed-sales.golden.test.ts`:
  - Its first statement is `process.env.TZ = "Europe/Madrid"`: the seed stamps each sale with the
    host's offset (`seed-sales.ts:215`), and that offset is inside every record's hash. Measured
    2026-10-06 with a probe of this shape on `main` at `8cef37de4`: the same run under `TZ=UTC`
    differed from the Madrid run in `huella` and `offset_minutos` on all 31
    `registros_facturacion` rows, in `anterior_huella` on 30 of them (the first record has no
    previous hash; these row counts are the fresh-context reviewer's, this plan's probe recorded
    only which columns differed) and in `issued_offset_minutes` on all 31 sales.
  - It pins the date with `vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T09:30:00.000Z") })`
    before provisioning and restores real timers after seeding: the seed anchors its days on
    `Date.now()` (`seed-sales.ts:184`), and `creado_en` defaults to the current time.
  - It provisions a Spanish venue through `createDemoVenueProvisioner` with a fixed `nifBase` and
    `nifFormat: "calculated"` (the NIF is in every record and its hash), leaves `WAITRON_ENV` unset
    as `seed.test.ts` does (its header, `:1-5`), and calls **`seedSales` directly** with `days: 3`,
    `invoiceLocale: "es-ES"` and a fixed product list — one product per VAT class (`general`,
    `reduced`, `super_reduced`, `zero`) and one with `customerName: null`. Not `seedDemoRestaurant`:
    measured with the same probe, two runs of the whole seed on the same pinned date and zone
    differed in line names, totals and VAT rates, and so in every hash, because the order of the
    product pool it hands `seedSales` (`listAvailableProducts`, `seed.ts:75`) changes between
    runs; with a fixed list, two runs agreed in every column but the generated ids. Task 2 changes
    only how `seedSales` gets its backend, so the comparison sits there.
  - It reads `sales`, `sale_lines`, `tenders`, `registros_facturacion` and `envios`, ordered by
    invoice number, line number and `secuencia`, through a **named column list** per table: every
    column the table has when the fixture is captured, less the generated ids (`id`, `node_id`,
    `series_id`, `sale_id`, `sif_id`, `registro_id`, which differed between the two probe runs).
    Named rather than `select *`, so a later migration that adds a column does not break the
    comparison; such a column is simply not compared. It compares the rows with `toEqual` against
    the fixture. With `WAITRON_WRITE_GOLDEN=1` it writes the fixture instead (the probe's three days
    came to 31 sales, 68 lines and about 130 KB of JSON).
  - The test stays in the suite after Task 2, as the guard on the Spanish practice sales.
    `WAITRON_WRITE_GOLDEN=1` is for this first capture only: it is never used to make a failing
    comparison pass. A comparison that fails means the Spanish records changed, which is a STOP;
    a re-recorded fixture in a diff is a review finding unless the owner asked for the change.
  - What a failing comparison prints: the rows whose values differ — every `huella` from the first
    changed record onwards, since each record's hash covers the one before. A seed that recorded
    through a backend writing no fiscal record would print all 31 `registros_facturacion` rows as
    missing (the `none` backend writes none — measured, above).

  Run it once with `WAITRON_WRITE_GOLDEN=1` on the unchanged branch, then format the fixture —
  prettier does not ignore that path (`pnpm exec prettier --file-info` on it prints
  `"ignored": false`, parser `json`), so the pre-push format check reads it:
  `pnpm exec prettier --write apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json`
  — then run it without the variable:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`.
  Expected: PASS with a `Tests` count. Commit the test and the fixture alone (`git commit -s`), as
  the branch's first commit; no later commit on the branch touches the fixture.

- [ ] **Step 2: Grow the test helper, then write the failing tests.** First add the helper's
  `country: "GB"` option (Files, above), so the United Kingdom cases below fail for the reason
  Step 3 names and not for a missing option.
  - `data-set.test.ts`:
    - `demoLanguagesFor(DEMO_DATA_SETS["casa-delgado-es"]!, { country: "GB", area: null })` is
      `{ defaultLanguage: "en", languages: ["en"], required: [] }` (the real United Kingdom pack
      names no data set; its rules give `required: []` with or without an area — measured
      2026-10-06 with `resolveInstalledContentLanguageRules` through `tsx`).
    - A set that is not the venue's pack's own takes the fallback, in an area that requires
      languages: `demoLanguagesFor({ ...DEMO_DATA_SETS["casa-delgado-es"]!, id: "not-spains" },
      { country: "ES", area: "08" })` is `{ defaultLanguage: "en", languages: ["en", "ca", "es"],
      required: ["ca", "es"] }`; and the control, Spain's own set in the same area, is
      `{ defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }`.
    - `demoDataSetFor(getCountryPack("ES")!.demo!)` and `demoDataSetFor` of an identity with no
      `dataSet` both return `DEMO_DATA_SETS["casa-delgado-es"]`.
    - **The guard (answer A, and the enforcement of it):** a function in the test file lists what
      stops a pack being offered at setup — in any mode, since the venue screen has one country
      list (decision 7) — no `demo`, or a supported jurisdiction whose filing module (the `ALL_MODULES` member whose
      `fiscal.id` is that jurisdiction's `modules.filing`) has no
      `venueFields.defaults.operationDescription`, the value the Demo form fills its hidden
      operation description from (`apps/server/src/setup-api.ts:535-549`,
      `apps/setup/src/screens/venue-screen.ts:243-247`). One case: it lists nothing for every pack
      in `VENUE_SETUP_COUNTRY_PACKS`. The other direction, a case of its own: for
      `{ ...getCountryPack("GB")!, availableForVenueSetup: true }` it lists both problems (no
      identity; filing module `none` has no default).
  - `demo-seed.test.ts`: the file mocks `@waitron/country-packs` so that `getCountryPack` also
    answers a made-up country `XX` whose `demo` has a legal name, tax ID, location name and its own
    trading names but no `dataSet`, and passes every other code to the real registry (a fixture
    growing). A `XX` venue with `admin.locale` `es-ES` calls `seedDemoRestaurant` once, its input
    pinned whole with `toStrictEqual`: the venue's ids, `dataSet: DEMO_DATA_SETS["casa-delgado-es"]`,
    `locale: "en"`, `salesDays: 30`, and `XX`'s own trading names.
  - `seed-sales.test.ts`, real database: on a United Kingdom venue from the helper, `seedSales` with
    `days: 3` records at least one sale, every sale's `fiscal_backend` is `"none"`, and
    `registros_facturacion` and `envios` hold no row.
  - `seed.test.ts`, real database: on a United Kingdom venue from the helper, `seedDemoRestaurant`
    with `dataSet: DEMO_DATA_SETS["casa-delgado-es"]`, `locale: "en"` and `salesDays: 3` leaves
    content languages `{ defaultLanguage: "en", languages: ["en"] }`, no missing translations, a
    product's stored customer name `{ en: … }` only, and practice sales whose `fiscal_backend` is
    `"none"` with no `registros_facturacion` row.
- [ ] **Step 3: Run them and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts src/demo-seed.test.ts scripts/demo-seed/seed-sales.test.ts scripts/demo-seed/seed.test.ts`
  Expected: FAIL — `demoDataSetFor` is not exported; the `XX` venue reaches `demoDataSet(undefined)`
  and throws `demoDataSet: no demo data set "undefined"`; `data-set.test.ts`'s language cases fail because
  `demoLanguagesFor` is not exported; the
  two real-database United Kingdom cases throw `sif.not_registered` from the practice sales
  (measured, "What happens today"), before any language is checked. The guard's two cases
  pass already — Spain carries an identity and Veri\*Factu supplies a default — and the second one
  is their check that the guard can fail.
- [ ] **Step 4: Implement** the changes listed under Files.
- [ ] **Step 5: Run** Step 3's command again, the golden copy, the setup route, the two boot cases
  that run the real setup route into `seedInstalledDemo` for a Spanish Demo, the installed path and
  the fiscal suites:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed src/setup-api.test.ts src/setup-api.country-pack.test.ts src/fiscal-none.e2e.test.ts scripts/dev-setup.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/boot.test.ts -t "provisions a demo venue, writes trading.env|finishes a provision whose venue had already committed"`
  (`boot.test.ts:2012` and `:3659`; a name filter, so run on its own — it would filter every file
  given beside it, and its `Tests` count must read 2),
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`,
  `pnpm --filter @waitron/country-es exec vitest run` and
  `pnpm --filter @waitron/country-packs exec vitest run`.
  Expected: PASS, each with a `Tests` count; the golden copy, the golden huella test,
  `inmutabilidad` and `fiscal-none.e2e.test.ts` unedited
  (`git diff <Step 1's commit> HEAD -- apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json`
  prints nothing). Measured 2026-10-06 in the throwaway worktree, on `main`'s code before Tasks 1
  to 5: with `seedSales` routed through the seat as above, the golden probe matched the unchanged
  seed's output in every column but the generated ids; the seed folder, `src/demo-seed` and
  `scripts/dev-setup.test.ts` passed unchanged (14 files, 67 tests); and `tsc --noEmit` on
  `apps/server`, whose `tsconfig.json` includes `scripts`, passed.
- [ ] **Step 6: Check the seed no longer names a regime:**
  `grep -n '@waitron/fiscal-verifactu\|@waitron/verifactu\|VerifactuBackend' apps/server/scripts/demo-seed/seed-sales.ts`
  prints nothing. `scripts/module-seams.test.ts` does not read `apps/server/scripts` (its header,
  `:21-23`), so the United Kingdom cases are what keep the seed off a hard-wired module.
- [ ] **Step 7: Prove by deletion**, restoring after each:
  - Put `new VerifactuBackend(…)` back in `seedSales`: the United Kingdom cases in
    `seed-sales.test.ts` and `seed.test.ts` fail with `sif.not_registered`. The golden copy still
    passes — it proves the Spanish records did not change, not that the seat is used.
  - Change the deterministic sequence's seed (`makeLcg(0x9e3779b9)`, `seed-sales.ts:183`) by one:
    the golden copy fails, printing the changed rows.
  - Make `demoLanguagesFor` return `starting` whatever the set: the not-Spain's-set Barcelona case
    fails (its default comes out `ca`). The United Kingdom cases do not fail, because for that pack
    both branches give English alone — which is why the Barcelona case exists.
  - Make `seedInstalledDemo` use `demoSeedLocale(venue)` for the fallback too: the `XX` case fails
    on `locale`.
- [ ] **Step 8: Commit, backlog entry** (W108's "Left open" item closed by the guard test: no
  setup-ready pack can lack an identity, so the setup route can no longer receive a Demo for one;
  decision 6's fallback built; the practice-sales
  limit replaced by what "Known limits" below still lists), **`finish-branch`**.

---

### Task 3: Catalan and Galician text, the demo's language rule, and a test that every reachable area is covered (no output change)

Branch `feat/demo-data-catalan-galician`. The data set gains the text and the rule; the seed still
writes the same languages as before, so every demo venue is seeded exactly as before. Needs Task 1
(the data set) and Task 6 (the function the rule reads). Since the regional-language amendment the
rule is no longer the demo's own: it is setup's starting languages for the area (decision 11).

**Files:**
- Modify: `apps/server/scripts/demo-seed/data-set.ts` — the content types move here from `menu.ts`
  and become generic over the data set's languages (below); `DemoDataSet` gains
  `contentLanguages` and the menus' customer-facing names; new `demoContentLanguages`
- Modify: `apps/server/scripts/demo-seed/menu.ts` (imports the moved types from `data-set.ts`;
  every customer-facing text gains `ca` and `gl`; each catalogue gains `customerName`),
  `seed-adjustments.ts` (each reason's `names` gains `ca` and `gl`),
  `data-sets/casa-delgado-es.ts` (`contentLanguages`, `drinksCustomerName`)
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (the Drinks menu's `SeedCatalogue`
  literal at `:190-193` gains `customerName: dataSet.menus.drinksCustomerName`, or the typecheck
  stops on it; nothing writes a menu's customer name until Task 4)
- Test: `apps/server/scripts/demo-seed/data-set.test.ts`
- (`VenueGeography` is exported by Task 6, which this task follows.)

**Interfaces:**
- Consumes: `DemoDataSet`, `demoDataSet`, `inLanguages` (Task 1);
  `resolveInstalledStartingContentLanguages`, `StartingContentLanguages` and `VenueGeography`
  (Task 6, `@waitron/country-packs`).
- Produces:

```ts
// data-set.ts — L is the set of languages one data set carries in full. English and Spanish are
// always in it: the writers take staff names out of these maps by staff language or by English
// (seed-catalogue.ts:113, :123, :145, :160; seed-floor.ts:196; seed-adjustments.ts), and with no
// `noUncheckedIndexedAccess` in tsconfig.base.json a missing one would still compile.
export type DemoText<L extends string> = Readonly<Record<L | SeedLocale, string>>;
// SeedProduct<L>, SeedCategory<L>, SeedCatalogue<L>, SeedOptionLabel<L>, SeedOptionList<L>,
// SeedProductOptionLists<L> and SeedReason<L>: every CUSTOMER-FACING field (customerName,
// description, unit name and abbreviation, variant customerName, section names = SeedCategory.name,
// reason names) becomes DemoText<L>. Staff-facing fields keep StaffText: SeedCatalogue.name (the
// menu's staff name) stays Record<SeedLocale, string>, so Task 1's drinksName pin is untouched.
// SeedCatalogue<L> gains `customerName: DemoText<L>` (the menu's customer-facing name).

export interface DemoDataSet<L extends string = string> {
  // ...Task 1's fields, with the content types instantiated at L...
  /** Every language this set has text in. */
  readonly contentLanguages: readonly L[];
  readonly menus: { /* ... */ readonly drinksCustomerName: DemoText<L> };
}

/** The demo's content languages; `required` is passed to writeContentLanguages' check. */
export type DemoLanguages = StartingContentLanguages;

/** Exactly the languages setup gives a new venue in this area (decision 11). */
export function demoContentLanguages(geography: VenueGeography): DemoLanguages {
  return resolveInstalledStartingContentLanguages(geography);
}

// data-sets/casa-delgado-es.ts
export const CASA_DELGADO_LANGUAGES = ["es", "en", "ca", "gl"] as const;
export type CasaDelgadoLanguage = (typeof CASA_DELGADO_LANGUAGES)[number];
export const CASA_DELGADO_ES: DemoDataSet<CasaDelgadoLanguage>; // a missing language is a type error
// with contentLanguages: CASA_DELGADO_LANGUAGES
```

  `demoContentLanguages` is a one-line wrapper on purpose: the demo seed calls it, the reachability
  test below walks it, and Task 2 puts the English fallback in front of it, so the demo's
  languages have one home without a second list. The data set's former "base languages" (Spanish
  and English, the earlier draft of this task) are gone: the pack now decides every language.

  The registry stays `Readonly<Record<string, DemoDataSet>>`; the writers read texts as
  `Readonly<Record<string, string>>`, which every `DemoText<L>` is assignable to; staff-name reads
  stay typed through `SeedLocale`, which `DemoText` always contains.

- [ ] **Step 1: Write the failing tests** in `data-set.test.ts`:

```ts
import { resolveFiscalJurisdiction } from "@waitron/country";

it.each([
  ["Madrid", { defaultLanguage: "es", languages: ["es", "en"], required: ["es"] }],
  ["07", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }], // Balearic Islands
  ["08", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }], // Barcelona
  ["46", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }], // Valencia
  ["15", { defaultLanguage: "gl", languages: ["gl", "es", "en"], required: ["gl", "es"] }], // A Coruña
])("gives a demo in %s these content languages", (area, expected) => {
  expect(demoContentLanguages({ country: "ES", area })).toEqual(expected);
});

it("carries every language the demo can enable where a venue can be set up", () => {
  for (const pack of COUNTRY_PACKS) {
    const id = pack.demo?.dataSet;
    if (id === undefined) continue;
    const set = demoDataSet(id);
    for (const area of pack.administrativeAreas) {
      if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
      const { languages } = demoContentLanguages({ country: pack.countryCode, area: area.code });
      const missing = languages.filter((language) => !set.contentLanguages.includes(language));
      expect(missing, `${pack.countryCode} ${area.name}`).toEqual([]);
    }
  }
});

it("gives every Casa Delgado customer-facing text a value of its own in every language", () => {
  // Walk every DemoText in CASA_DELGADO_ES (products, variants, descriptions, sections, units,
  // option lists and labels, reasons, menu customer names). For each: a non-blank value per
  // CASA_DELGADO_LANGUAGES, and its ca and gl values are not copies of its en or es value unless
  // the text is listed in an explicit allowance of proper names (e.g. "Negroni").
});
```

  (Measured 2026-10-06 with a throwaway `tsx` probe by the first amendment's reviewer: `Madrid`,
  `07`, `08`, `46` and `15` all resolve through `findAdministrativeArea`. The probe also produced
  the `08`, `46` and `15` rows exactly as written, but through the rule this amendment replaced; the
  `Madrid` and `07` rows were changed by the regional-language amendment and are worked out from
  Task 6's pack values, not measured — Task 6's own `registry.test.ts` table pins the same five
  answers.)

- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts`
  Expected: FAIL — `demoContentLanguages` is not exported; `contentLanguages` undefined.
- [ ] **Step 3: Add `demoContentLanguages` and `contentLanguages`.**
- [ ] **Step 4: Make the types generic and write the Catalan and Galician text** into `menu.ts`,
  the reasons, and the four menus' customer names. The three-names rule holds per language. A dish
  whose name a speaker would leave untranslated goes in the test's allowance.
- [ ] **Step 5: Run the seed folder and the installed path.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`
  Expected: PASS with no test changed — the proof that the output did not change: the writers cut
  every map to `[en, es]` (Task 1), and the stored maps pinned whole at
  `seed-catalogue.test.ts:111-114, 318-331, 336-342` and `seed-option-lists.test.ts:66-70` still
  read `{ en, es }`.
- [ ] **Step 6: Prove the reachability test by deletion**: remove `"gl"` from
  `CASA_DELGADO_LANGUAGES` and the Galician values; the test fails naming Galicia's provinces, and
  no other area. Then put the values back but delete one Galician text; the typecheck fails.
  Restore.
- [ ] **Step 7: Write the side-by-side table** (English, Spanish, Catalan, Galician, one row per
  text) into the PR description; backlog entry saying the text is unchecked by a speaker
  (decision 4).
- [ ] **Step 8: Commit, `finish-branch`.**

---

### Task 4: The demo's content languages follow the area, and every text is written in them

Branch `feat/demo-data-area-languages`. This is the task that changes what a demo looks like: after
it, a demo keeps exactly the content languages setup gave the venue (Task 6), and writes every
customer-facing text in each of them (decision 11).

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` — replace the literal pair at `:91-94`:
  read the venue's country and province (the same read the provisioning seed makes,
  `select l.province, t.country from locations l cross join tenants t where l.id = …`,
  `packages/catalogue/src/provisioning.ts`), compute `demoContentLanguages({ country,
  area: province })`, and write it with `writeContentLanguages(tx, { defaultLanguage, languages },
  defaultLanguage, undefined, required)` so the required-language check runs; cut every map to the
  languages; pass each menu's `customerName` as `names` to `createCatalogue` /
  `updateMenuDetails`
- Unchanged: `seed.ts` — since Task 1 it reads the languages after `seedCatalogues` has written
  them and passes them to `seedOptionLists` and `seedAdjustmentReasons`
- Test: `apps/server/scripts/demo-seed/seed.test.ts` (new cases), `seed-catalogue.test.ts`
  (one listed change)
- Test helper: `apps/server/scripts/demo-seed/testing/provision-venue.ts` gains optional
  `province`, `postalCode` and `city` (a fixture growing; Madrid stays the default)

**Interfaces:**
- Consumes: `inLanguages`, `demoContentLanguages`, the menus' `customerName` (Tasks 1, 3), and
  through them Task 6's starting languages.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts`, one per area, each provisioning
  through `createDemoVenueProvisioner` with the province, running `seedDemoRestaurant` with
  `locale: "es"` and `salesDays: 0`, then reading `readContentLanguages` and
  `listTranslationGapReport`:

```ts
it.each([
  ["Barcelona", "08001", "ca-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
  ["Valencia", "46001", "es-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
  ["A Coruña", "15001", "es-ES", { defaultLanguage: "gl", languages: ["gl", "es", "en"] }],
  ["Illes Balears", "07001", "es-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
  ["Madrid", "28013", "es-ES", { defaultLanguage: "es", languages: ["es", "en"] }],
])("a demo in %s takes the area's languages and misses no translation", async (province, postalCode, invoiceLocale, expected) => {
  // provision, seed, then:
  expect(languages).toEqual(expected);
  expect(gaps.flatMap((language) => language.gaps)).toEqual([]);
  // and one product's stored customer name has exactly the expected languages' keys
});
```

  And the dev path (Review Focus 5): `seedDemoRestaurant` with `locale: "en"` on a Madrid venue
  writes default `es` and staff names in English (`"Mixed salad"` as a product's staff name, as
  `seed-catalogue.test.ts` already pins).
- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts`
  Expected: FAIL — languages are `[en, es]` / `[es, en]`; four menus listed as missing.
- [ ] **Step 3: Implement.** The writers' fallback-language argument (`createSectionIn`,
  `createUnit`, `setProductVariants`, `createOptionList`) needs no change: `readContentLanguages`
  uses its fallback only when no row is saved (`contentLanguagesOr`,
  `packages/catalogue/src/content-languages.ts:154-167`), and the demo saves one before its first
  text write; the writers require text only in the saved default (`content-languages.ts:34-47`).
  Changing the default runs a gap check in the new default (`content-languages.ts:188-198`) over
  what setup provisioned. After Task 6 the demo writes the default setup already wrote, so for a
  venue provisioned through setup's seed that check does not run at all. The probe below was taken
  before the regional-language amendment, when the demo did move setup's Spanish default; it shows
  the write succeeds should the two ever differ. Measured 2026-10-06 by the first amendment's
  reviewer with a throwaway Vitest probe on venues provisioned through `applyVenue(planVenue(…))`:
  in Valencia (setup's row then `es`; `es, ca, en`) `listContentTranslationGaps(tx, "ca")` returned
  no gaps and `writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] },
  "ca", undefined, ["ca", "es"])` stored exactly that; in A Coruña (setup's row then `es`; `es, ca,
  en, gl`) there were no gaps in `gl` and the write stored `gl` with `gl, es, en`. (The provisioned
  units already carry `ca` and `gl`, `packages/catalogue/src/provisioning.ts:28-40`.) If a case is
  refused all the same, that is a STOP: record it in `questions.md` and mark the task `blocked`.
- [ ] **Step 4: Make the listed change** to `seed-catalogue.test.ts`; run the seed folder and the
  installed path:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`.
  Expected: PASS. Any other red is a STOP. (`seed-option-lists.test.ts` and
  `seed-adjustments.test.ts` stay unchanged: they pass their own `[en, es]` list since Task 1. The
  three stored maps pinned whole in `seed-catalogue.test.ts` stay `{ en, es }`: the Madrid test
  venue carries those two languages.)
- [ ] **Step 5: Prove by deletion**: put the literal pair back; the Barcelona, Valencia, A Coruña
  and Illes Balears cases fail (the Madrid case passes either way, since the pair for `locale: "es"`
  is Madrid's own answer). Restore. (Passing `required` to `writeContentLanguages` is a guard against a later
  edit to the rule: the demo's list is built from the required languages, so no case here can make
  that check refuse, and no test shows it running.)
- [ ] **Step 6: Look** at a Barcelona demo's Content languages page and a product in the
  dashboard and on the till, both themes, phone width (`wa-wt demo` cannot pick a province — set
  one up through the wizard in a worktree's dev stack).
- [ ] **Step 7: Commit, backlog** (the demo seed now runs the required-language check and keeps
  setup's languages; strike the demo seed from the backlog's list of writers that skip the check,
  which Task 6 left holding it and the Prepare-to-Live configuration copy; the "Content languages
  per region" entry is then fully built), **`finish-branch`**.

---

### Task 5: Staff names in the setup person's language; practice sales in the receipt language

Branch `feat/demo-data-staff-language`.

A demo for a country with no demo data keeps English staff names whatever the admin's language;
that is Task 2's, built after this one.

**Files:**
- Modify: `apps/server/src/demo-seed.ts` (`demoSeedLocale` reads `venue.admin.locale`, not the
  receipt language)
- Modify: `apps/server/scripts/demo-seed/seed.ts` (read the location's receipt language through
  drizzle's `locations.invoiceLocales` — a `labelList` column, `packages/db/src/schema/tenants.ts:93`;
  raw SQL would return JSON text — and pass its first entry to `seedSales`)
- Modify: `apps/server/scripts/demo-seed/seed-sales.ts` (`SeedSalesInput.locale` becomes
  `invoiceLocale: string`; `SEED_INVOICE_LOCALE` no longer read there)
- Test: `apps/server/src/demo-seed.test.ts`, `apps/server/scripts/demo-seed/seed.test.ts`,
  `apps/server/src/demo-seed.db.test.ts`; listed changes in `demo-seed.test.ts`,
  `seed-sales.test.ts` and `seed-sales.dated.test.ts`

2026-10-07, as built: `seed.ts` reads the receipt language with `readReceiptLanguage`, and `seedSales`
falls back to the venue's content default (`readContentLanguages`) where a dish has no text in the
receipt language, as a till sale does (commit 434704160).

**Interfaces:**
- Produces:

```ts
/** The staff language of an installed demo: Spanish when the person setting it up uses Spanish. */
export function demoSeedLocale(venue: VenueRequest): SeedLocale {
  return venue.admin.locale?.toLowerCase().startsWith("es") === true ? "es" : "en";
}
```

  (`admin.locale?: string | null`, `packages/provisioning/src/venue-plan.ts:51`.)

- [ ] **Step 1: Write the failing tests.** In `demo-seed.test.ts`: receipt `ca-ES` with admin
  `es-ES` seeds `"es"`; admin `en-GB` with receipt `es-ES` seeds `"en"`; admin `null` seeds
  `"en"`. In `seed.test.ts` (a Barcelona venue through Task 4's helper, `salesDays: 3`): every
  practice sale's line descriptions are in Catalan — read the descriptions the sales stored and
  compare them with the data set's `ca` texts. In `demo-seed.db.test.ts` (real database, a
  Barcelona venue with admin `es-ES`): staff names Spanish, content default Catalan.
- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run src/demo-seed.test.ts src/demo-seed.db.test.ts scripts/demo-seed/seed.test.ts`
  Expected: FAIL — a `ca-ES` receipt seeds `"en"`; descriptions are English.
- [ ] **Step 3: Implement** the three changes above.
- [ ] **Step 4: Make the listed test changes** and run the seed folder, the installed path, and
  the fiscal gates:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`.
  Expected: PASS; the golden huella test and `inmutabilidad` unedited.
- [ ] **Step 5: Prove by deletion**: make `demoSeedLocale` read the receipt language again; the
  `ca-ES`/`es-ES` case fails. Restore.
- [ ] **Step 6: Look** at one stored Barcelona practice sale where the till or dashboard shows a
  stored sale's lines. The receipt preview route cannot show one: it draws a sample sale
  (`apps/server/src/receipt-preview-api.ts:145-157`).
- [ ] **Step 7: Commit, backlog, `finish-branch`.**

---

## Existing tests this plan changes

Every change below is the whole list; any other existing test that has to change is a STOP. Line
numbers are from `main` at `3137f5838`; the files they point into were unchanged at `401ecd27c`
(checked with `git diff --stat 3137f5838 401ecd27c` over them on 2026-10-06). **Re-check them
before each task:** no task starts until lane C's A261-5 Hours has landed, and that branch changes
`seed-floor.ts`, so the plan's `seed-floor.ts` line numbers (and maybe others) will have moved.
The amendment to answers A and B (every line number in Task 2 and in "A country
with no demo data" and "Practice sales go through…" above) reads `main` at `8cef37de4`. The
regional-language amendment (Task 6, the Task 6 rows below, and every line
number it added elsewhere) reads `947948aa2`; the files it cites were unchanged at `fb7d4b348`
(checked with `git diff --stat 947948aa2 fb7d4b348` over them on 2026-10-06; only
`docs/backlog.md` differed, in an unrelated entry).

| Task | File | What changes | Kind |
| --- | --- | --- | --- |
| 1 | `packages/country-es/src/spain.test.ts` ~279-286 | `SPAIN.demo` `toEqual` gains `dataSet: "casa-delgado-es"` | whole-shape pin gains a key (owner rule 2026-09-27) |
| 1 | `apps/server/src/demo-seed.test.ts` ~49-58 | the `toStrictEqual` on the seed call's input gains `dataSet` | whole-shape pin gains a key |
| 1 | `apps/server/scripts/demo-seed/` — `seed-catalogue.test.ts` (6 `seedCatalogues`), `seed-media.test.ts` (2 `seedCatalogues`), `seed-option-lists.test.ts` (1 `seedCatalogues`, 1 `seedOptionLists`), `seed-floor.test.ts` (3), `seed-adjustments.test.ts` (5), `seed-staff.test.ts` (2), `seed-watchers.test.ts` (1), `seed.test.ts` (5 `seedDemoRestaurant`), `seed.integration.test.ts` (1) | each call gains `dataSet`; the `seedOptionLists` and `seedAdjustmentReasons` calls also gain `languages`, the literal pair the test's seed language gives today (counts are call sites, from `grep` on 2026-10-06) | call-site arguments; no assertion changes |
| 6 | `packages/country-es/src/spain.test.ts:160-170` | the Valencian case's `defaultContentLocale` `toBeUndefined()` → `toBe("ca-ES")`; its title gains "with Catalan the default" | assertion change — decision 12 |
| 6 | `packages/country-es/src/spain.test.ts:172-182` | the Galician case's `defaultContentLocale` `toBeUndefined()` → `toBe("gl-ES")`; its title gains "with Galician the default" | assertion change — decision 12 |
| 6 | `packages/country-es/src/spain.test.ts:184-193` | "requires nothing anywhere else, the Balearics, the Basque Country and Navarre included" → three cases (Task 6, Step 1): the Balearic Islands require `ca-ES, es-ES` with `ca-ES` the default; the Basque Country and Navarre require nothing; every other area requires `es-ES` with `es-ES` the default | assertion change, one case split in three — decisions 9 and 12 |
| 6 | `packages/country-packs/src/registry.test.ts:109-115` | "requires nothing for a Madrid venue or a Spanish venue with no province" splits: Madrid → `{ required: ["es"], official }`; no province stays `{ required: [], official }` | assertion change — decision 9 |
| 6 | `packages/country-packs/src/registry.test.ts:125-134` | "gives Catalan as a new Barcelona venue's default content language and nothing elsewhere": Valencia → `"ca"` and Madrid → `"es"` move out of the `toBeUndefined()` loop; `XX` and no country stay undefined; the title says the regional language where one is required, Spanish elsewhere in Spain | assertion change — decision 12 |
| 6 | `packages/catalogue/src/provisioning.test.ts:68-80` | rows: Madrid `["es", "ca", "en"]` → `["es", "en"]`; A Coruña default `es` and `["es", "ca", "en", "gl"]` → default `gl` and `["gl", "es", "en"]`; Bizkaia `["es", "ca", "en"]` → `["es", "en"]`; Barcelona, United Kingdom and `XX` unchanged; new rows Valencia and Illes Balears (default `ca`, `["ca", "es", "en"]`); the comment at `:69-73`, which points at the backlog entry Task 6 closes, says the list is the area's required languages plus English | assertion change — decisions 9, 10 and 12 |
| 6 | `apps/dashboard/src/i18n/codes.test.ts:384-391` | "says a required content language cannot be removed, in both languages": both expected sentences follow the new `content.language_required` wording | assertion change — decision 9 (the requirement is not always a law) |
| 6 | `apps/dashboard/src/screens/content-languages-screen.test.ts:1077-1092` | "writes the required-language warning in English when the UI is in English": "Catalan is required in this region, and 2 names …" follows the new `content_gaps.required_warning` wording (the cases at `:817` and `:887` build their expectation through `t(…)` and need no change) | assertion change — decision 9 |
| 6 | `apps/server/src/venue-locale.test.ts:87-100` | "requires nothing for a Madrid venue" → "requires Spanish for a Madrid venue", `{ required: ["es"], official }` | assertion change — decision 9 |
| 4 | `apps/server/scripts/demo-seed/seed-catalogue.test.ts:286-289` | content languages `{ defaultLanguage: "en", languages: ["en", "es"] }` → `{ defaultLanguage: "es", languages: ["es", "en"] }` (the Madrid test venue: its required Spanish plus English, Spanish the default) | assertion change — decisions 10 to 12 (and 2 and 3 before them) |
| 5 | `apps/server/src/demo-seed.test.ts:10-12` | the `venueWithLocales` helper also sets `admin.locale` to its first receipt language, so the existing cases keep their values | fixture grows |
| 5 | `apps/server/src/demo-seed.test.ts:22-30` | the `demoSeedLocale` table's title says it reads the admin's language (its rows keep their values through the helper above); new rows are added in Step 1 | test title change |
| 5 | `apps/server/scripts/demo-seed/seed-sales.test.ts` (4), `seed-sales.dated.test.ts` (1) | `locale: "es"` → `invoiceLocale: "es-ES"` | call-site argument; no assertion changes |

Checked and NOT changed: `seed-option-lists.test.ts:57` is `toMatchObject`; `seed.test.ts`,
`seed.integration.test.ts`, `seed-media.test.ts`, `dev-setup.test.ts` and `demo-seed.db.test.ts`
assert nothing about content languages or whole customer-name maps (read on 2026-10-06 by the first
draft's reviewer; `demo-seed.db.test.ts`'s staff language flips from `es` to `en` in Task 5, since
its venue has no admin locale, and nothing there reads it). The three stored maps pinned whole in
`seed-catalogue.test.ts` (`:111-114`, `:318-331`, `:336-342`) stay `{ en, es }` in every task: the
Madrid test venue carries Spanish and English only. `boot.test.ts`'s two Demo cases (`:2012`, `:3659`, below) and
`dev-setup.test.ts` (`:218`) run the real seed on Madrid venues and assert nothing about languages
(grep by the amendment's reviewer). `setup-api.country-pack.test.ts` stays as it is: Task 2 adds no
route refusal. Its cases stub the seed (`seedDemo: vi.fn(…)`, `:63`). Two `boot.test.ts` cases run
the real setup route into `seedInstalledDemo` for a Spanish Demo (`:2012` and `:3659`, in Task 2's
Step 5), but nothing does so for a fallback country: no real pack is one, so Task 2's
`demo-seed.test.ts` and `seed.test.ts` cases cover the two halves separately. Task 2 adds cases to
`seed-sales.test.ts` and `seed.test.ts` but changes none of the existing ones: measured, every
suite in the demo seed folder, `src/demo-seed*` and `scripts/dev-setup.test.ts` passed unchanged
with the seed routed through the seat (14 files, 67 tests, on `main`'s code before Tasks 1 to
5). `demo-seed.test.ts:78-85` (the refusal of a pack with no identity) stays as it is. `management-api.membership.test.ts`
and `mirror-bundle-api.test.ts` call a local `seedStaff` (`:97`, `:158`), not the demo writer.

Checked for Task 6 and NOT changed (by `grep` on 2026-10-06 for `requiredContentLocales`,
`defaultContentLocale`, the two `resolveInstalled…ContentLanguage…` readers, the literal
`["es", "ca", "en"]` and `content_languages` across `packages/`, `apps/` and `scripts/`, then
reading each hit): `boot.test.ts:3352-3378` and `:3380-3387` run on a Spanish venue with no
province (`seedTradingVenue`, `:3212-3229`, inserts its location without one), which still requires
nothing — the first reads the default rather than pinning it, the second pins `required: []`; the
`readContentLanguages` callers in `till-sale.test.ts`, `till-api.test.ts`,
`till-api.fiscal-sale-paths.test.ts`, `split-bill.test.ts`, `kitchen-print.test.ts` and
`working-order.test.ts` read the default (Spanish for their Madrid venues before and after);
`receipt-language.test.ts:126-129` writes its own row; `catalogue-api.test.ts`,
`content-languages.test.ts`, `content-translation-report.test.ts` and the dashboard's
`content-languages-screen*.test.ts` hand the code their own languages and rules rather than reading
the pack; `packages/country/src/country.test.ts:119-165` uses a made-up pack;
`spain.test.ts:82-102` (display languages) and `:226-235` (free receipt choice, `07` included) are
untouched by the decisions. One stub now carries a name that no longer matches the pack:
`content-languages-screen.test.ts:72` (`MADRID`, `required: []`), used by "offers Remove on every
language but the default where the region requires none" (`:112`). The screen behaviour it tests is
still reachable (a Spanish venue with no province requires nothing), so it stays unchanged.
> 2026-10-07, finish-branch review: the stub is now named `NOTHING_REQUIRED` and the test "…where none is required"; its value is unchanged.

## Known limits this plan leaves (recorded in the backlog, not built)

- **Practice sales are placed for Madrid.** Task 2 records them through the venue's own fiscal
  module, but they stay at fixed UTC hours chosen to sit inside a Madrid business day
  (`seed-sales.ts:188-190, 203-208`), stamped with the host's offset as a till sale is
  (`seed-sales.ts:215`, `apps/server/src/till-backend.ts:21`). Moving them would change the
  Spanish records, which answer B keeps as they are. A future pack in a time zone far from Madrid
  may see some practice sales land on a neighbouring business day in its reports (worked out from
  the hours, not measured).
- **Practice sales carry Spain's VAT rates, as every till sale does.** The rates come from the one
  shipped table (`packages/catalogue/src/vat-rates.ts:19-27`), which the till's own pricing also
  reads whatever the country (above). A per-country rate table is product-wide work, not this
  plan's.
- **A demo identity is a condition of being offered at setup in any mode.** Task 2's guard reads
  the one country list the venue screen shows for Demo, Prepare and Live alike
  (`apps/setup/src/screens/venue-screen.ts:673`), so a country cannot be offered for Prepare or
  Live without a made-up demo identity either — this plan's reading of answer A (decision 7). The
  alternative, if the owner objects: keep the country and hide only the Demo choice for a pack
  without an identity (a form change, not made here).
- **A pack whose filing module has no default operation description cannot be offered at setup.**
  The same guard fails for it, in every mode for the same reason (no setup-ready pack is such a
  pack today; the United Kingdom's filing module `none` has none,
  `packages/fiscal-none/src/slot.ts:19-26`, which declares no `venueFields`); whoever makes such a pack setup-ready chooses then
  between a default in the module and a description in the demo identity (decision 7).
- **One photo folder.** The 45 photographs stay where they are (`deploy/Dockerfile` copies that
  folder); a second data set with its own photos moves them into per-set folders then.
- **Two departments, `restaurant` and `deli`,** fixed by `CountryDemoIdentity`'s type.
- **Valencian is written as Catalan.** The Valencian Community's content language is `ca`
  (decision 9); Valencian as a language of its own stays in the parked C125 work.
- **A venue set up before Task 6 keeps the languages it started with** until it is reset: no
  migration, and the provisioning seed never overwrites a saved row (pre-live rule, CLAUDE.md §3).
  The new required-language rules reach it at its first start on the new version all the same
  (Global Constraints), so its Content languages page can show a required language its row lacks
  until the next save there puts it back.
- **A country's per-area display language no longer picks its venues' starting content language.**
  Task 6 deletes `geographicLocales` (`packages/catalogue/src/provisioning.ts:15-25`), through which
  a non-Spanish pack's area `defaultLocale` could choose the first language; the new function uses
  the area's `defaultContentLocale`, else the pack's `defaultLocale`. Nothing changes today: the
  only non-Spanish pack, the United Kingdom's, has no areas.
- **The Prepare-to-Live configuration copy still skips the required-language check**
  (`packages/catalogue/src/configuration-transfer.ts`), as before; it stays in the backlog when
  Task 6 closes the rest of "Product languages are hard-coded at setup".
- **A fallback demo in an area that requires languages** lists every required language under
  Missing translations, because its text is English only (Task 2). No pack reaches this today.
  _2026-10-07, as built (W109-2): wrong — the seed writes the data set's own text in every enabled
  language, so only a required language the set lacks is listed; see `docs/backlog/setup.md`, W109-2._
- Staff-facing names a demo writes in English whatever the staff language — reporting categories
  (`seed-catalogue.ts:113`) and the four kitchen stations (`seed-catalogue.ts:56-67`) — stay as
  they are.

## Self-review notes

- Brief coverage: where the data lives, no-demo country (Task 2, decision 6), shared vs
  per-country, W108's identity, each co-official area and the single-language areas (table), how
  languages are switched on (since the regional-language amendment: setup's starting languages
  for the area, which the demo takes as they are), who writes and checks the text (Task 3,
  decision 4), every test changed (table), order (Tasks 1, 6, 3, 4, 5, 2, each green on its own).
- The order keeps `main` working after each task: Task 1 changes no output; Task 6 changes only
  what a new real venue starts with, while the demo still replaces it with its own pair; Task 3
  adds text and the language rule while the writers still cut to `[en, es]`; Task 4 is the first to
  change a demo's output and needs that text present for the Catalan and Galician defaults; Task 5
  changes the staff and receipt language; Task 2 adds the fallback on top of all of them and moves
  every demo's practice sales onto the venue's own fiscal module, leaving a Spanish demo's records
  as they were.
- The first draft was reviewed by a fresh-context reader in two rounds (2026-10-06, reading only);
  its findings were corrected before the owner's answers. The amendment to the answers replaced the
  "follow setup's list" rule (and with it the extracted `provisionedContentLanguages` and three
  changed checks in Task 4), the refusal in Task 2, and the order of tasks.
- The amendment to answers A and B (2026-10-06) rewrote Task 2: the venue-screen and review-screen
  form path and `fallbackTradingNames` are gone (the pack's own identity supplies the trading
  names); a guard test holds every setup-ready pack to an identity (no route refusal: the route only
  finds setup-ready packs); practice
  sales go through the composition's fiscal seat for every demo, with a golden copy of the Spanish
  records taken before the change; `CountryDemoIdentity.dataSet` becomes optional in Task 2, and
  the pack-walking tests of Tasks 1 and 3 read it through `pack.demo?.dataSet` so that change
  leaves them as they are. Its receipts come from probes run 2026-10-06 in a throwaway worktree at
  `8cef37de4`, none committed.
- The regional-language amendment (2026-10-06, decisions 9 to 12) replaced the "Languages follow
  the area" table, added Task 6 (setup's starting languages, the pack's required lists and
  defaults, one shared function), removed the data set's "base languages", made Task 3's rule a
  wrapper over Task 6's function, moved the `VenueGeography` export from Task 3 to Task 6, gave
  Task 2's English fallback a function of its own (`englishFallbackLanguages`, chosen by
  `demoLanguagesFor`) with a test that can tell the two branches apart, and changed the Balearic
  rows of Tasks 3 and 4. Why Task 6 is its own task rather than part of Task 3 or 4: it changes real
  venues, it touches no demo file, and the demo's rule then has nothing to decide. It was written
  by reading the code at `947948aa2` and grepping for the tests named in the table; nothing was
  run, so every "Expected" in Task 6 is a prediction its first run checks. A fresh-context
  reviewer then read it (reading only) and found one claim wider than the code — existing venues
  were said to change only on reset, true of the stored row but not of the required-language
  rules, which the server reads at every start — plus wording that called Waitron's own choice a
  regional requirement, two open points that needed restating, an incomplete list of writers that
  skip the check, and a missing known limit; all were corrected in the next commit.
