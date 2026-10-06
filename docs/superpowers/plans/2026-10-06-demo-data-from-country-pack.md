# The demo data set comes from the country pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: the owner answered the six decisions on 2026-10-06 (~08:19, amended ~08:21), and the
two open points about a country with no demo data on the same day (A at ~10:05, B at ~10:07); this
plan is amended to all of them (W109, lane A).** Nothing here is built. No task waits for an answer;
Task 2 is still built last. The three language points the owner sent to the backlog at ~10:58 do
not change this plan: it is built with the behaviour written here.

**Goal:** A demo venue's menus, floor, staff and example data belong to its country, the way its
company name and tax number already do (W108, #1276). A Spanish demo's customer-facing text is in
Spanish and English, with Spanish the default; where the area requires Catalan or Galician, that
language is the default and Spanish and English come with it — in Barcelona Catalan, Spanish and
English. A country whose pack carries its own made-up demo identity but no demo data of its own
gets the existing demo data in English, under that identity, and its practice sales are recorded
through the venue's own fiscal module.

**Architecture:** The data the demo seed writes today (menus, products, option lists, floor, staff,
adjustment reasons, a few names written inline) becomes one value, a _demo data set_, kept on the
server beside the seed code. The country pack names its data set by a plain string id, the way a
fiscal jurisdiction names its filing module. The seed code stays shared: it reads whichever data
set the venue's country names, or the fallback set when the pack names none. The demo works out its
content languages from the data set's own base languages and the area's required languages in the
pack, and writes every customer-facing text in each of them.

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
missing translations. No pack today has such an area without demo data (the only other pack, the
United Kingdom's, has no areas). Its month of practice sales is recorded like any other demo's,
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

**Languages follow the area, through the pack's own rules.** The demo writes its own
content-language row, replacing the one setup wrote (as it does today), but now derived from the
area rather than from the seed language. The data set names its _base languages_ — for Casa
Delgado `es` then `en`. The area's _required_ languages come from the pack, through
`resolveInstalledContentLanguageRules` (`packages/country-packs/src/registry.ts:89`, reading each
area's `requiredContentLocales`, `packages/country-es/src/spain.ts:194, 209, 223`). The required
languages that are not base languages are the area's regional languages; the demo's languages are
the regional ones first, then the base ones, and the first is the default. No second list: which
areas require what is read from the pack, and the owner's "Spanish and English" is the data set's
base list. By area, today (`spain.ts:164-237`):

| Area | Pack's required languages | Demo content languages (default first) | Setup's row, for comparison | Notes |
| --- | --- | --- | --- | --- |
| Catalonia (Barcelona, Girona, Lleida, Tarragona) | `ca, es` | **ca**, es, en | **ca**, es, en | The owner's example. Practice sales print in Catalan (Task 5): the receipt is fixed to Catalan there. |
| Valencian Community (Alicante, Castellón, Valencia) | `ca, es` | **ca**, es, en | **es**, ca, en | The area requires Catalan (written under `ca`; Valencian forms are not written separately), so by the owner's ~08:21 answer Catalan is the default — where setup itself keeps Spanish, because the pack names no default there. English is the foreign language the area's notice asks for. |
| Galicia (A Coruña, Lugo, Ourense, Pontevedra) | `gl, es` | **gl**, es, en | **es**, ca, en, gl | Galician is the default, by the same answer; setup keeps Spanish. The Content languages page still shows the two-foreign-language notice (it applies only to restaurants rated three forks or more); the demo carries one foreign language. |
| Balearic Islands | none | **es**, en | **es**, ca, en | Catalan is co-official there, but the pack requires no language, so the demo carries none (the owner: regional languages "only where the area requires it"). |
| Basque Country, Navarre, Canary Islands, Ceuta, Melilla | — | — | — | No venue can be set up there: setup refuses an unsupported fiscal jurisdiction (`apps/server/src/setup-api.ts:381`). No Basque text is written (decision 5). The pack gives the Basque provinces a display language (`spain.ts:170-175`) but no required content language, so if one became supported as the pack stands, its demo would be Spanish and English. |
| Everywhere else (single-language) | none | **es**, en | **es**, ca, en | Spain's starting list gives every venue Catalan; the demo drops it. |

So the Spanish data set carries text in **Spanish, English, Catalan and Galician**. Every
customer-facing text in it is typed `Readonly<Record<"es" | "en" | "ca" | "gl", string>>`, so a
missing translation fails the typecheck; a test then checks that every language the demo can
enable, in an area where a venue can be set up, is one the data set carries.

The demo writes its row through `writeContentLanguages` with the area's required languages
(`packages/catalogue/src/content-languages.ts:169-186`), so the required-language check the demo
skips today runs. Setup's own row is unchanged by this plan: the backlog's "Product languages are
hard-coded at setup" entry stays open, and the day it is fixed, setup's and the demo's rows may
agree; nothing here depends on it.

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
   Spanish as its default; staff names stay English.
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

## Open points

None. Points A and B are answered (decisions 7 and 8 above).

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
- No migration in any task. Existing demo venues change only when reset (pre-live rule, CLAUDE.md
  §3).
- A country pack stays browser-safe: plain values only, no import beyond `@waitron/country`
  (CLAUDE.md §3).
- Content-language codes are bare (`ca`, never `ca-ES`) wherever content is stored
  (`contentLanguageCode`, `packages/shared/src/content-languages.ts`); receipt languages are full
  tags.
- Every product keeps three DIFFERENT names — staff, customer-facing, kitchen — in every language
  (CLAUDE.md §3, `docs/developers/products.md`).
- Each task is its own PR with a backlog entry update; branches `feat/demo-data-<slug>`. **Order:
  Tasks 1, 3, 4, 5, then 2.** Task 2 needs the data set (Task 1), the language rule (Tasks 3 and 4)
  and Task 5's staff-language change, which it overrides for the fallback, and Task 5's
  `invoiceLocale` input to `seedSales`, which its golden copy is captured against.
- Look at anything visual in both themes and at phone width (CLAUDE.md §4): in Task 4 the Content
  languages page of a Barcelona demo. Task 2 changes nothing a screen draws.

## Review Focus

1. **A Barcelona demo set up from a Spanish-language browser** — content default Catalan, Catalan,
   Spanish and English enabled, staff names in Spanish, practice receipts in Catalan, Missing
   translations empty. Pinned in Task 4 (languages, gaps) and Task 5 (staff names, receipts).
2. **A Galician demo** — Galician the default, Spanish and English enabled, every customer-facing
   text has all three. Pinned in Task 4.
3. **A Madrid or Balearic demo** — Spanish default, English, no Catalan. Pinned in Task 4.
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

### Task 2: A country with no demo data gets the existing demo data in English, and every demo's practice sales go through the venue's own fiscal module

Branch `feat/demo-data-english-fallback`. **Built last, after Task 5.** Written to the owner's
answers A and B (decisions 7 and 8). Fiscal-adjacent: the full review a fiscal change gets, and the
fiscal suites below run unedited.

**Files:**
- Modify: `packages/country/src/country.ts` (`CountryDemoIdentity.dataSet` becomes optional,
  `readonly dataSet?: string`; absent means the demo seeds the fallback data set in English)
- Modify: `apps/server/scripts/demo-seed/data-set.ts` (`FALLBACK_DEMO_DATA_SET_ID =
  "casa-delgado-es"`; `demoDataSetFor(identity)`; `demoContentLanguages` gains the fallback
  branch)
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
- Consumes: `DemoDataSet`, `demoDataSet`, `demoContentLanguages` (Tasks 1 and 3), `demoSeedLocale`
  and `SeedSalesInput.invoiceLocale` (Task 5); `fiscalSlot`, `enabledModules` (`@waitron/module`),
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
// demoContentLanguages: when getCountryPack(geography.country)?.demo?.dataSet is undefined, the
// languages are ["en", ...required.filter((language) => language !== "en")], default "en".
```

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
    - `demoContentLanguages(set, { country: "GB", area: null })` is
      `{ defaultLanguage: "en", languages: ["en"], required: [] }` (the real United Kingdom pack
      names no data set; its rules give `required: []` with or without an area — measured
      2026-10-06 with `resolveInstalledContentLanguageRules` through `tsx`).
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
  and throws `no demo data set "undefined"`; `data-set.test.ts`'s United Kingdom languages are `es, en`; the
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
  - Make the fallback branch of `demoContentLanguages` return the base languages: the United
    Kingdom language cases fail.
  - Make `seedInstalledDemo` use `demoSeedLocale(venue)` for the fallback too: the `XX` case fails
    on `locale`.
- [ ] **Step 8: Commit, backlog entry** (W108's "Left open" item closed by the guard test: no
  setup-ready pack can lack an identity, so the setup route can no longer receive a Demo for one;
  decision 6's fallback built; the practice-sales
  limit replaced by what "Known limits" below still lists), **`finish-branch`**.

---

### Task 3: Catalan and Galician text, the demo's language rule, and a test that every reachable area is covered (no output change)

Branch `feat/demo-data-catalan-galician`. The data set gains the text and the rule; the seed still
writes the same languages as before, so every demo venue is seeded exactly as before.

**Files:**
- Modify: `apps/server/scripts/demo-seed/data-set.ts` — the content types move here from `menu.ts`
  and become generic over the data set's languages (below); `DemoDataSet` gains
  `contentLanguages`, `baseLanguages` and the menus' customer-facing names; new
  `demoContentLanguages`
- Modify: `apps/server/scripts/demo-seed/menu.ts` (re-exports the moved types for its own data;
  every customer-facing text gains `ca` and `gl`; each catalogue gains `customerName`),
  `seed-adjustments.ts` (each reason's `names` gains `ca` and `gl`),
  `data-sets/casa-delgado-es.ts` (`contentLanguages`, `baseLanguages`, `drinksCustomerName`)
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (the Drinks menu's `SeedCatalogue`
  literal at `:190-193` gains `customerName: dataSet.menus.drinksCustomerName`, or the typecheck
  stops on it; nothing writes a menu's customer name until Task 4)
- Modify: `packages/country-packs/src/registry.ts` — export the `VenueGeography` type (declared
  without `export` at `:75`; `index.ts` re-exports `registry.js`)
- Test: `apps/server/scripts/demo-seed/data-set.test.ts`

**Interfaces:**
- Consumes: `DemoDataSet`, `demoDataSet`, `inLanguages` (Task 1);
  `resolveInstalledContentLanguageRules` and the `VenueGeography` input it takes
  (`@waitron/country-packs`, `packages/country-packs/src/registry.ts:75, 89`).
- Produces:

```ts
// data-set.ts — L is the set of languages one data set carries in full. English and Spanish are
// always in it: the writers take staff names out of these maps by staff language or by English
// (seed-catalogue.ts:113, :123, :145, :160; seed-floor.ts:196; seed-adjustments.ts), and with no
// `noUncheckedIndexedAccess` in tsconfig.base.json a missing one would compile and store undefined.
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
  /** The languages every demo from this set carries, default first, before the area's own. */
  readonly baseLanguages: readonly [L, ...L[]];
  readonly menus: { /* ... */ readonly drinksCustomerName: DemoText<L> };
}

export interface DemoLanguages {
  readonly defaultLanguage: string;
  readonly languages: readonly string[];
  /** The area's required languages, for writeContentLanguages' check. */
  readonly required: readonly string[];
}

/** The area's required languages that are not base languages come first; the first is the default. */
export function demoContentLanguages(set: DemoDataSet, geography: VenueGeography): DemoLanguages {
  const { required } = resolveInstalledContentLanguageRules(geography);
  const regional = required.filter((language) => !set.baseLanguages.includes(language));
  const languages = [...regional, ...set.baseLanguages];
  return { defaultLanguage: languages[0]!, languages, required };
}

// data-sets/casa-delgado-es.ts
export const CASA_DELGADO_LANGUAGES = ["es", "en", "ca", "gl"] as const;
export type CasaDelgadoLanguage = (typeof CASA_DELGADO_LANGUAGES)[number];
export const CASA_DELGADO_ES: DemoDataSet<CasaDelgadoLanguage>; // a missing language is a type error
// with contentLanguages: CASA_DELGADO_LANGUAGES and baseLanguages: ["es", "en"]
```

  The registry stays `Readonly<Record<string, DemoDataSet>>`; the writers read texts as
  `Readonly<Record<string, string>>`, which every `DemoText<L>` is assignable to; staff-name reads
  stay typed through `SeedLocale`, which `DemoText` always contains.

- [ ] **Step 1: Write the failing tests** in `data-set.test.ts`:

```ts
import { resolveFiscalJurisdiction } from "@waitron/country";

it.each([
  ["Madrid", { defaultLanguage: "es", languages: ["es", "en"], required: [] }],
  ["07", { defaultLanguage: "es", languages: ["es", "en"], required: [] }], // Balearic Islands
  ["08", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }], // Barcelona
  ["46", { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] }], // Valencia
  ["15", { defaultLanguage: "gl", languages: ["gl", "es", "en"], required: ["gl", "es"] }], // A Coruña
])("gives a Casa Delgado demo in %s these content languages", (area, expected) => {
  expect(demoContentLanguages(demoDataSet("casa-delgado-es"), { country: "ES", area })).toEqual(expected);
});

it("carries every language the demo can enable where a venue can be set up", () => {
  for (const pack of COUNTRY_PACKS) {
    const id = pack.demo?.dataSet;
    if (id === undefined) continue;
    const set = demoDataSet(id);
    for (const area of pack.administrativeAreas) {
      if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
      const { languages } = demoContentLanguages(set, { country: pack.countryCode, area: area.code });
      const missing = languages.filter((language) => !set.contentLanguages.includes(language));
      expect(missing, `${pack.countryCode} ${area.name}`).toEqual([]);
    }
  }
});

it("gives every Casa Delgado customer-facing text a value of its own in every language", () => {
  // Walk every DemoText in CASA_DELGADO_ES (products, variants, descriptions, sections, units,
  // option lists and labels, reasons, menu customer names). For each: a non-blank value per
  // CASA_DELGADO_LANGUAGES, and its ca and gl values are not copies of its en or es value unless
  // the text is listed in an explicit allowance of proper names (e.g. "Casa Delgado").
});
```

  (Measured 2026-10-06 with a throwaway `tsx` probe by the amendment's reviewer: `Madrid`, `07`,
  `08`, `46` and `15` all resolve through `findAdministrativeArea`, and the five expected rows,
  `required` order included, come out exactly as written above.)

- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts`
  Expected: FAIL — `demoContentLanguages` is not exported; `contentLanguages` undefined.
- [ ] **Step 3: Add `demoContentLanguages`, `baseLanguages` and `contentLanguages`.**
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
  `CASA_DELGADO_LANGUAGES` and the Galician values; the test fails naming Galicia's provinces.
  Then put the values back but delete one Galician text; the typecheck fails. Restore.
- [ ] **Step 7: Write the side-by-side table** (English, Spanish, Catalan, Galician, one row per
  text) into the PR description; backlog entry saying the text is unchecked by a speaker
  (decision 4).
- [ ] **Step 8: Commit, `finish-branch`.**

---

### Task 4: The demo's content languages follow the area, and every text is written in them

Branch `feat/demo-data-area-languages`. This is the task that changes what a demo looks like.

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` — replace the literal pair at `:91-94`:
  read the venue's country and province (the same read the provisioning seed makes,
  `select l.province, t.country from locations l cross join tenants t where l.id = …`,
  `packages/catalogue/src/provisioning.ts`), compute `demoContentLanguages(dataSet, { country,
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
- Consumes: `inLanguages`, `demoContentLanguages`, the menus' `customerName` (Tasks 1, 3).
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
  ["Illes Balears", "07001", "es-ES", { defaultLanguage: "es", languages: ["es", "en"] }],
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
  what setup provisioned. Measured 2026-10-06 by the amendment's reviewer with a throwaway Vitest
  probe on venues provisioned through `applyVenue(planVenue(…))`: in Valencia (setup's row `es`;
  `es, ca, en`) `listContentTranslationGaps(tx, "ca")` returned no gaps and
  `writeContentLanguages(tx, { defaultLanguage: "ca", languages: ["ca", "es", "en"] }, "ca",
  undefined, ["ca", "es"])` stored exactly that; in A Coruña (setup's row `es`; `es, ca, en, gl`)
  there were no gaps in `gl` and the write stored `gl` with `gl, es, en`. (The provisioned units
  already carry `ca` and `gl`, `packages/catalogue/src/provisioning.ts:28-40`.) If a case is
  refused all the same, that is a STOP: record it in `questions.md` and mark the task `blocked`.
- [ ] **Step 4: Make the listed change** to `seed-catalogue.test.ts`; run the seed folder and the
  installed path:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`.
  Expected: PASS. Any other red is a STOP. (`seed-option-lists.test.ts` and
  `seed-adjustments.test.ts` stay unchanged: they pass their own `[en, es]` list since Task 1. The
  three stored maps pinned whole in `seed-catalogue.test.ts` stay `{ en, es }`: the Madrid test
  venue carries those two languages.)
- [ ] **Step 5: Prove by deletion**: put the literal pair back; the Barcelona, Valencia and A Coruña
  cases fail. Restore. (Passing `required` to `writeContentLanguages` is a guard against a later
  edit to the rule: the demo's list is built from the required languages, so no case here can make
  that check refuse, and no test shows it running.)
- [ ] **Step 6: Look** at a Barcelona demo's Content languages page and a product in the
  dashboard and on the till, both themes, phone width (`wa-wt demo` cannot pick a province — set
  one up through the wizard in a worktree's dev stack).
- [ ] **Step 7: Commit, backlog** (also update "Product languages are hard-coded at setup": the
  demo seed now runs the required-language check, and its languages differ from setup's by design
  — table above), **`finish-branch`**.

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
with no demo data" and "Practice sales go through…" above) reads `main` at `8cef37de4`.

| Task | File | What changes | Kind |
| --- | --- | --- | --- |
| 1 | `packages/country-es/src/spain.test.ts` ~279-286 | `SPAIN.demo` `toEqual` gains `dataSet: "casa-delgado-es"` | whole-shape pin gains a key (owner rule 2026-09-27) |
| 1 | `apps/server/src/demo-seed.test.ts` ~49-58 | the `toStrictEqual` on the seed call's input gains `dataSet` | whole-shape pin gains a key |
| 1 | `apps/server/scripts/demo-seed/` — `seed-catalogue.test.ts` (6 `seedCatalogues`), `seed-media.test.ts` (2 `seedCatalogues`), `seed-option-lists.test.ts` (1 `seedCatalogues`, 1 `seedOptionLists`), `seed-floor.test.ts` (3), `seed-adjustments.test.ts` (5), `seed-staff.test.ts` (2), `seed-watchers.test.ts` (1), `seed.test.ts` (5 `seedDemoRestaurant`), `seed.integration.test.ts` (1) | each call gains `dataSet`; the `seedOptionLists` and `seedAdjustmentReasons` calls also gain `languages`, the literal pair the test's seed language gives today (counts are call sites, from `grep` on 2026-10-06) | call-site arguments; no assertion changes |
| 4 | `apps/server/scripts/demo-seed/seed-catalogue.test.ts:286-289` | content languages `{ defaultLanguage: "en", languages: ["en", "es"] }` → `{ defaultLanguage: "es", languages: ["es", "en"] }` (the Madrid test venue under the area rule) | assertion change — decisions 2 and 3 |
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
- **The demo's languages differ from setup's** in most areas (table above): setup still starts
  every Spanish venue with Catalan, the demo does not. Settled by decisions 2 and 3; the backlog's
  "Product languages are hard-coded at setup" entry covers setup's side.
- Staff-facing names a demo writes in English whatever the staff language — reporting categories
  (`seed-catalogue.ts:113`) and the four kitchen stations (`seed-catalogue.ts:56-67`) — stay as
  they are.

## Self-review notes

- Brief coverage: where the data lives, no-demo country (Task 2, decision 6), shared vs
  per-country, W108's identity, each co-official area and the single-language areas (table), how
  languages are switched on (the area's required languages from the pack plus the data set's base
  list), who writes and checks the text (Task 3, decision 4), every test changed (table), order
  (Tasks 1, 3, 4, 5, 2, each green on its own).
- The order keeps `main` working after each task: Task 1 changes no output; Task 3 adds text and
  the language rule while the writers still cut to `[en, es]`; Task 4 is the first to change output
  and needs that text present for the Catalan and Galician defaults; Task 5 changes the staff and
  receipt language; Task 2 adds the fallback on top of all of them and moves every demo's practice
  sales onto the venue's own fiscal module, leaving a Spanish demo's records as they were.
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
