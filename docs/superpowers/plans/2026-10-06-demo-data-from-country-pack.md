# The demo data set comes from the country pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: PLAN ONLY, waiting for the owner's review (W109, 2026-10-06).** Nothing here is built.
The questions the owner has to answer before any task starts are in "Owner decisions" below; each
has a recommended default.

**Goal:** A demo venue's menus, floor, staff and example data belong to its country, the way its
company name and tax number already do (W108, #1276), and the demo's customer-facing text is
written in every language a venue in that area starts with — in Barcelona Catalan, Spanish and
English.

**Architecture:** The data the demo seed writes today (menus, products, option lists, floor, staff,
adjustment reasons, a few names written inline) becomes one value, a _demo data set_, kept on the
server beside the seed code. The country pack names its data set by a plain string id, the way a
fiscal jurisdiction names its filing module. The seed code stays shared: it reads whichever data
set the venue's country names. The demo stops choosing its own content languages: it keeps the ones
setup already gave the venue for its area, and writes every customer-facing text in each of them.

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


## How it works after this plan

**Where the data lives.** A new type `DemoDataSet` (`apps/server/scripts/demo-seed/data-set.ts`)
and one value of it, `CASA_DELGADO_ES`, assembled from what `menu.ts`, `floor.ts`, `staff.ts` and
`seed-adjustments.ts` hold today plus the six two-language strings written inline in the writers
(`seed-floor.ts:73, 83, 141, 217`, `seed-watchers.ts:21`, `seed-catalogue.ts:191`). A registry,
`DEMO_DATA_SETS`, maps an id to its data set. It is server-side, not in the pack: the pack must
stay browser-safe and small (the setup wizard bundles it), the data set points at 45 photographs,
and only the server seeds (`menu.ts` alone is about 600 lines). The pack names it:
`CountryDemoIdentity` gains `dataSet: string`, and Spain's is `"casa-delgado-es"`. A test fails if
any pack's `demo.dataSet` names no registered set — the same shape as
`scripts/module-seams.test.ts`'s check that every filing id names a fiscal module.

**How W108's identity fits.** Unchanged: the company name, tax number, location name and the two
department trading names stay in the pack, because the setup wizard shows them (prefilled location
name, the summary). The data set holds everything only the server needs. The trading names stay
keyed `restaurant` and `deli`, which are the two departments this data set builds; a second
country's data set with other departments would widen that type then, not now.

**What stays shared.** The seed code (every `seed-*.ts` writer), the demo printer, publishing the
menus last, back-dated practice sales, the login constants (`DEMO_PIN`, `DEMO_ADMIN_EMAIL`,
`DEMO_DASHBOARD_PASSWORD`), the photo folder, and `INSTALLED_DEMO_SALES_DAYS`. **Per country:**
menus, products and their prices and VAT classes, option lists, units, floor (zones, tables,
statuses, department internal names), staff names, adjustment reasons, the watcher's name, the
Drinks menu's name.

**A country with no demo data.** A pack with no `demo` offers no Demo: the wizard's venue screen,
in Demo, lists only countries whose pack has one, and the server refuses a Demo request for any
other country before writing anything (Task 2 — W108's open question, built as the owner answers
it). A pack whose `demo.dataSet` names nothing fails a test at build time, so it never ships.

**Languages follow the area, through setup's own list.** The demo writes no content-language row
of its own. It keeps the row setup wrote for the venue's area and writes every customer-facing text
in each language that row enables. Setup's list is Spain's starting list (`es, ca, en`) plus the
area's required languages from the pack, with the area's default where the pack names one
(`packages/catalogue/src/provisioning.ts`, through `contentLanguageRules`). The demo keeps no
second list: the day the backlog's "Product languages are hard-coded at setup" entry is fixed, the
demo follows with no change here. By area, today (the measurement above and
`packages/country-es/src/spain.ts`):

| Area | Demo content languages (default first) | Receipt | Notes |
| --- | --- | --- | --- |
| Catalonia (Barcelona, Girona, Lleida, Tarragona) | **ca**, es, en | Catalan (fixed) | The owner's example. Practice sale lines print in Catalan (Task 5). |
| Valencian Community (Alicante, Castellón, Valencia) | **es**, ca, en | as chosen | Valencian is written under `ca`; the demo's Catalan text is used. English is the foreign language the area's notice asks for (Waitron shows the notice, it does not check it). |
| Balearic Islands | **es**, ca, en | as chosen | No required languages; Catalan comes from Spain's starting list. |
| Galicia (A Coruña, Lugo, Ourense, Pontevedra) | **es**, ca, en, gl | as chosen | The Content languages page still shows the two-foreign-language notice (it applies only to restaurants rated three forks or more); the demo carries one foreign language. |
| Basque Country, Navarre, Canary Islands, Ceuta, Melilla | — | — | No venue can be set up there: setup refuses an unsupported fiscal jurisdiction (`apps/server/src/setup-api.ts:381`). No Basque text is written. If the Basque Country became supported as the pack stands, setup would start it with `es, ca, en` — the pack gives its provinces a Basque display language (`spain.ts:170-175`) but no required content language — so Basque would arrive with that pack change, not by itself. |
| Everywhere else (single-language) | **es**, ca, en | as chosen | Catalan is there because Spain's starting list holds it for every venue (the backlog entry above). |

So the Spanish data set carries text in **Spanish, English, Catalan and Galician**. Every
customer-facing text in it is typed `Readonly<Record<"es" | "en" | "ca" | "gl", string>>`, so a
missing translation fails the typecheck; a test then checks that every language setup can enable,
in an area where a venue can be set up, is one the data set carries.

**Staff-facing names follow the person setting up, not the area.** Staff names of products, menus
and sections, kitchen names, department and zone names, table statuses and the watcher are plain
text, not translations, and the staff apps exist only in English and Spanish
(`packages/shared/src/locales.ts`). They are written in the _staff language_: Spanish when the
admin's display language (`admin.locale`) is Spanish, English otherwise. Setup never leaves
`admin.locale` empty: it takes the browser's language when that is English or Spanish, and
otherwise the area's or country's supported language (`apps/server/src/setup-api.ts:428-435`) — so
in Spain a browser set to Catalan alone gets Spanish staff names. Today the staff language is read
from the receipt language instead, which is why Barcelona's demo is English.

**Practice sales print in the venue's receipt language.** Today a sale line's words are resolved in
`en-GB` or `es-ES` from the seed language (`seed-sales.ts:167`); after Task 5 they are resolved in
the location's own receipt language, so a Barcelona demo's practice receipts read in Catalan.

**Who writes the new text, and how a speaker checks it.** Claude drafts the Catalan and Galician in
Task 3 (about 80 short texts per language: product, variant, section, unit and option names, two
descriptions, seven adjustment reasons, four menu names). The PR carries a side-by-side table
(English, Spanish, Catalan, Galician) for a speaker to read, and the backlog records the text as
unchecked until one has. Whether the PR waits for that check is the owner's choice (decision 4).

## Owner decisions (each with the recommended default)

1. **Where the data lives and how the pack names it.** Recommended: server-side data set named by
   the pack's `demo.dataSet` string (above). Alternative: no pack field; the server finds the data
   set by country code. The named id follows the fiscal-filing pattern and lets the pack, not the
   server, say whether a country has a demo.
2. **Every Spanish demo carries Catalan** (Madrid gets `es, ca, en`), because setup's starting list
   does. Recommended: follow setup's list, as asked ("rather than a second list"). Alternative: a
   demo-only list per area — rejected by the brief.
3. **An English demo in Madrid gets Spanish as its default content language** (today English):
   the default comes from the area, so customer-facing names fall back to Spanish, while staff
   names stay English. Recommended: accept — it is what a real Madrid venue starts with.
4. **Speaker check of the Catalan and Galician.** (a) Land Task 3 with Claude's draft, the
   side-by-side table in the PR, and a backlog entry saying the text is unchecked (recommended,
   since the whole-app translations, C125, are parked "for much later"); (b) park Task 3's PR until
   a speaker has read it. Valencian forms are not written separately, the same as C125 leaves them.
5. **Basque.** Recommended: not written now — no venue can be set up in the Basque Country, and
   setup would not switch Basque on there even if one could (table above). Alternative: write it
   now beside Catalan and Galician, and have Task 3's test demand every one of the pack's official
   languages (`officialLocales`) rather than the reachable ones.
6. **A country with no demo data — W108's open question** (`questions.md`, "should the server
   refuse a Demo for a country whose pack has no demo business?"). Task 2 builds the answer; it is
   written for the recommended option (a): refuse up front and change that one test to `prepare`.

---

## Global Constraints

- Lane C's "⚠ THE RULE" for these items applies, with the owner's 2026-09-27 and 2026-10-05 test
  rules: an existing test changes only where this plan lists it (table at the end); any other
  existing test that goes red is a STOP, not a fix.
- The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
  `inmutabilidad` pass **unedited** in every task. Task 5 changes the words on demo practice sales
  (fiscal-adjacent); no task touches `computeHuella`, the chain, numbering, `registros_facturacion`
  or `recordSale`'s builder.
- No migration in any task. Existing demo venues change only when reset (pre-live rule, CLAUDE.md
  §3).
- A country pack stays browser-safe: plain values only, no import beyond `@waitron/country`
  (CLAUDE.md §3).
- Content-language codes are bare (`ca`, never `ca-ES`) wherever content is stored
  (`contentLanguageCode`, `packages/shared/src/content-languages.ts`); receipt languages are full
  tags.
- Every product keeps three DIFFERENT names — staff, customer-facing, kitchen — in every language
  (CLAUDE.md §3, `docs/developers/products.md`).
- Each task is its own PR with a backlog entry update; branches `feat/demo-data-<slug>`. Tasks 1,
  3, 4 and 5 run in that order; Task 2 depends on none of them.
- Look at anything visual in both themes and at phone width (CLAUDE.md §4): Task 2's venue screen,
  and in Task 4 the Content languages page of a Barcelona demo.

## Review Focus

1. **A Barcelona demo set up from a Spanish-language browser** — content default Catalan, Catalan,
   Spanish and English all enabled, staff names in Spanish, practice receipts in Catalan, Missing
   translations empty. Pinned in Task 4 (languages, gaps) and Task 5 (staff names, receipts).
2. **A Galician demo** — Galician stays enabled (its area requires it) and every customer-facing
   text has it. Pinned in Task 4.
3. **A Demo request for a country with no demo data** sent straight to the server — refused before
   anything is provisioned, not halfway through the seed. Pinned in Task 2.
4. **`wa-wt reset demo` in English** — still seeds, staff names English, content default Spanish.
   Pinned in Task 4 (dev path case).
5. **A data set that misses one language for one text** — the typecheck fails, and the
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
- `CountryDemoIdentity` gains `readonly dataSet: string`.

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
    const named = COUNTRY_PACKS.flatMap((pack) => (pack.demo ? [pack.demo.dataSet] : []));
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

### Task 2: A country with no demo data offers no Demo

Branch `feat/demo-data-no-demo-country`. Independent of the other tasks. Built only as the owner
answers W108's open question; written here for option (a).

**Files:**
- Modify: `apps/server/src/setup-api.ts` (`parseProvisionPayload`, after `parseVenue` and the
  fiscal selection at `:467-471`: in Demo mode, refuse a country whose pack has no `demo`).
  `parseVenue` itself is not told the mode (`:346`), and placing the refusal at its country check
  (`:358`) would change the answer of two existing Demo-mode cases in
  `setup-api.country-pack.test.ts` (the time-zone case and the `ZZ` case).
- Modify: `apps/setup/src/screens/venue-screen.ts` (in Demo, the country list is
  `VENUE_SETUP_COUNTRY_PACKS.filter((pack) => pack.demo !== undefined)`)
- Keep: `apps/server/src/demo-seed.ts`'s own refusal, as the second line.
- Test: `apps/server/src/setup-api.country-pack.test.ts` (new case; it already mocks a
  setup-ready GB pack with no `demo`), `apps/setup/src/screens/venue-screen.test.ts`
- Test change: in `setup-api.country-pack.test.ts`, "keeps the typed tax id, postcode and province
  when the country has no rules for them" sends `mode: "prepare"` instead of `"demo"` (it tests
  tax ID, postcode and province handling, not Demo).

**Interfaces:**
- Consumes: `CountryPack.demo` (already on `main`, `packages/country/src/country.ts:102`).
- Produces: the refusal `setup.request_invalid` with `params.field = "country"`, the code and field
  W108 tried (`questions.md`, W108 entry).

- [ ] **Step 1: Write the failing tests.** In `setup-api.country-pack.test.ts`, send a Demo
  provision for the mocked GB pack and assert a 400 with `code: "setup.request_invalid"`,
  `params.field: "country"`, and that neither the stubbed provisioner nor `seedDemo` was called.
  In `venue-screen.test.ts`, with a second setup pack lacking `demo`, the Demo form's country
  choices are only the packs with one, and Prepare still lists both.
- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run src/setup-api.country-pack.test.ts` and
  `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts`
  Expected: FAIL — the Demo provision succeeds; both packs are listed.
- [ ] **Step 3: Implement** the refusal and the filtered list.
- [ ] **Step 4: Make the listed `setup-api.country-pack.test.ts` change; run both commands and
  `src/setup-api.test.ts` again.** Expected: PASS.
- [ ] **Step 5: Prove by deletion**: remove the refusal; the new server case fails. Restore.
- [ ] **Step 6: Look** at the venue screen in Demo, light and dark, 1280 and 390 px.
- [ ] **Step 7: Commit, backlog entry, `finish-branch`.**

---

### Task 3: Catalan and Galician text, and a test that every reachable area is covered (no output change)

Branch `feat/demo-data-catalan-galician`. The data set gains the text; the seed still writes the
same languages as before, so every demo venue is seeded exactly as before.

**Files:**
- Modify: `apps/server/scripts/demo-seed/data-set.ts` — the content types move here from `menu.ts`
  and become generic over the data set's languages (below); `DemoDataSet` gains
  `contentLanguages` and the menus' customer-facing names
- Modify: `apps/server/scripts/demo-seed/menu.ts` (re-exports the moved types for its own data;
  every customer-facing text gains `ca` and `gl`; each catalogue gains `customerName`),
  `seed-adjustments.ts` (each reason's `names` gains `ca` and `gl`),
  `data-sets/casa-delgado-es.ts` (`contentLanguages`, `drinksCustomerName`)
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (the Drinks menu's `SeedCatalogue`
  literal at `:190-193` gains `customerName: dataSet.menus.drinksCustomerName`, or the typecheck
  stops on it; nothing writes a menu's customer name until Task 4)
- Modify: `packages/catalogue/src/provisioning.ts` — move the language computation (the
  `starting` / `withRequired` / `defaultLanguage` lines, `:58-81`) into an exported pure function
  `provisionedContentLanguages`, called from the same place (no behaviour change; catalogue's
  provisioning tests unchanged); `packages/catalogue/src/index.ts` exports it
- Test: `apps/server/scripts/demo-seed/data-set.test.ts`, `packages/catalogue/src/provisioning.test.ts`
  (a new case for the pure function)

**Interfaces:**
- Consumes: `DemoDataSet`, `demoDataSet`, `inLanguages` (Task 1).
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
  readonly contentLanguages: readonly L[];
  readonly menus: { /* ... */ readonly drinksCustomerName: DemoText<L> };
}

// data-sets/casa-delgado-es.ts
export const CASA_DELGADO_LANGUAGES = ["es", "en", "ca", "gl"] as const;
export type CasaDelgadoLanguage = (typeof CASA_DELGADO_LANGUAGES)[number];
export const CASA_DELGADO_ES: DemoDataSet<CasaDelgadoLanguage>; // a missing language is a type error

// packages/catalogue/src/provisioning.ts
export function provisionedContentLanguages(geography: {
  readonly country: string | undefined;
  readonly area: string | null | undefined;
}): ContentLanguages; // { defaultLanguage, languages }, exactly what setup writes today
```

  The registry stays `Readonly<Record<string, DemoDataSet>>`; the writers read texts as
  `Readonly<Record<string, string>>`, which every `DemoText<L>` is assignable to; staff-name reads
  stay typed through `SeedLocale`, which `DemoText` always contains.

- [ ] **Step 1: Write the failing tests.**

```ts
// data-set.test.ts
import { resolveFiscalJurisdiction } from "@waitron/country";
import { provisionedContentLanguages } from "@waitron/catalogue";

it("carries every language setup can enable where a venue can be set up", () => {
  for (const pack of COUNTRY_PACKS) {
    if (pack.demo === undefined) continue;
    const set = demoDataSet(pack.demo.dataSet);
    for (const area of pack.administrativeAreas) {
      if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
      const { languages } = provisionedContentLanguages({ country: pack.countryCode, area: area.code });
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

```ts
// packages/catalogue/src/provisioning.test.ts — one new case, values from the 2026-10-06 measurement
it.each([
  ["Madrid", { defaultLanguage: "es", languages: ["es", "ca", "en"] }],
  ["08", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
  ["15", { defaultLanguage: "es", languages: ["es", "ca", "en", "gl"] }],
])("starts a venue in %s with these content languages", (area, expected) => {
  expect(provisionedContentLanguages({ country: "ES", area })).toEqual(expected);
});
```

- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/data-set.test.ts` and
  `pnpm --filter @waitron/catalogue exec vitest run src/provisioning.test.ts`
  Expected: FAIL — `provisionedContentLanguages` is not exported; `contentLanguages` undefined.
- [ ] **Step 3: Extract `provisionedContentLanguages`** and call it from the provisioning seed.
  Run catalogue's provisioning suite: PASS, no existing case changed.
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

### Task 4: The demo keeps the area's content languages and writes every text in them

Branch `feat/demo-data-area-languages`. This is the task that changes what a demo looks like.

**Files:**
- Modify: `apps/server/scripts/demo-seed/seed-catalogue.ts` (delete the `writeContentLanguages`
  call at `:91-94`; read the row setup wrote; cut every map to it; pass each menu's
  `customerName` as `names` to `createCatalogue` / `updateMenuDetails`)
- Modify: `apps/server/scripts/demo-seed/seed.ts` (read the languages BEFORE `seedCatalogues`, not
  after)
- Test: `apps/server/scripts/demo-seed/seed.test.ts` (new cases), `seed-catalogue.test.ts`
  (listed changes)
- Test helper: `apps/server/scripts/demo-seed/testing/provision-venue.ts` gains optional
  `province`, `postalCode` and `city` (a fixture growing; Madrid stays the default)

**Interfaces:**
- Consumes: `inLanguages`, `DemoDataSet.contentLanguages`, the menus' `customerName` (Tasks 1, 3).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts`, one per area, each provisioning
  through `createDemoVenueProvisioner` with the province, running `seedDemoRestaurant` with
  `salesDays: 0`, then reading `readContentLanguages` and `listTranslationGapReport`:

```ts
it.each([
  ["Barcelona", "08001", "ca-ES", { defaultLanguage: "ca", languages: ["ca", "es", "en"] }],
  ["A Coruña", "15001", "es-ES", { defaultLanguage: "es", languages: ["es", "ca", "en", "gl"] }],
  ["Madrid", "28013", "es-ES", { defaultLanguage: "es", languages: ["es", "ca", "en"] }],
])("a demo in %s keeps the area's languages and misses no translation", async (province, postalCode, invoiceLocale, expected) => {
  // provision, seed, then:
  expect(languages).toEqual(expected);
  expect(gaps.flatMap((language) => language.gaps)).toEqual([]);
  // and one product's stored customer name has exactly the expected languages' keys
});
```

  And the dev path (Review Focus 4): `seedDemoRestaurant` with `locale: "en"` on a Madrid venue
  leaves the default `es` and writes staff names in English (`"Mixed salad"` as a product's staff
  name, as `seed-catalogue.test.ts` already pins).
- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.test.ts`
  Expected: FAIL — languages are `[en, es]` / `[es, en]`; four menus listed as missing.
- [ ] **Step 3: Implement.** Remove the `writeContentLanguages` call; read the languages once with
  `readContentLanguages(tx, locale)` before the first write. The writers' fallback-language
  argument (`createSectionIn`, `createUnit`, `setProductVariants`, `createOptionList`) needs no
  change: `readContentLanguages` uses its fallback only when no row is saved
  (`contentLanguagesOr`, `packages/catalogue/src/content-languages.ts:154-167`), and setup always
  saves one; the writers require text only in the saved default
  (`content-languages.ts:34-47`).
- [ ] **Step 4: Make the listed changes** to `seed-catalogue.test.ts` (four places); run the seed
  folder and the installed path:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed src/demo-seed scripts/dev-setup.test.ts`.
  Expected: PASS. Any other red is a STOP. (`seed-option-lists.test.ts` and
  `seed-adjustments.test.ts` stay unchanged: they pass their own `[en, es]` list since Task 1.)
- [ ] **Step 5: Prove by deletion**: put the `writeContentLanguages` call back; the Barcelona and
  A Coruña cases fail. Remove it again.
- [ ] **Step 6: Look** at a Barcelona demo's Content languages page and a product in the
  dashboard and on the till, both themes, phone width (`wa-wt demo` cannot pick a province — set
  one up through the wizard in a worktree's dev stack).
- [ ] **Step 7: Commit, backlog** (also update "Product languages are hard-coded at setup": the
  demo seed no longer skips the required-language check), **`finish-branch`**.

---

### Task 5: Staff names in the setup person's language; practice sales in the receipt language

Branch `feat/demo-data-staff-language`.

**Files:**
- Modify: `apps/server/src/demo-seed.ts` (`demoSeedLocale` reads `venue.admin.locale`, not the
  receipt language)
- Modify: `apps/server/scripts/demo-seed/seed.ts` (read the location's receipt language through
  drizzle's `locations.invoiceLocales` — a `labelList` column, `packages/db/src/schema/tenants.ts:95`;
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
  Expected: PASS; the golden and immutability suites unedited.
- [ ] **Step 5: Prove by deletion**: make `demoSeedLocale` read the receipt language again; the
  `ca-ES`/`es-ES` case fails. Restore.
- [ ] **Step 6: Look** at one stored Barcelona practice sale where the till or dashboard shows a
  stored sale's lines. The receipt preview route cannot show one: it draws a sample sale
  (`apps/server/src/receipt-preview-api.ts:145-157`).
- [ ] **Step 7: Commit, backlog, `finish-branch`.**

---

## Existing tests this plan changes

Every change below is the whole list; any other existing test that has to change is a STOP. Line
numbers are from `main` at `3137f5838`.

| Task | File | What changes | Kind |
| --- | --- | --- | --- |
| 1 | `packages/country-es/src/spain.test.ts` ~279-286 | `SPAIN.demo` `toEqual` gains `dataSet: "casa-delgado-es"` | whole-shape pin gains a key (owner rule 2026-09-27) |
| 1 | `apps/server/src/demo-seed.test.ts` ~49-58 | the `toStrictEqual` on the seed call's input gains `dataSet` | whole-shape pin gains a key |
| 1 | `apps/server/scripts/demo-seed/` — `seed-catalogue.test.ts` (6 `seedCatalogues`), `seed-media.test.ts` (2 `seedCatalogues`), `seed-option-lists.test.ts` (1 `seedCatalogues`, 1 `seedOptionLists`), `seed-floor.test.ts` (3), `seed-adjustments.test.ts` (5), `seed-staff.test.ts` (2), `seed-watchers.test.ts` (1), `seed.test.ts` (5 `seedDemoRestaurant`), `seed.integration.test.ts` (1) | each call gains `dataSet`; the `seedOptionLists` and `seedAdjustmentReasons` calls also gain `languages`, the literal pair the test's seed language gives today (counts are call sites, from `grep` on 2026-10-06) | call-site arguments; no assertion changes |
| 2 | `apps/server/src/setup-api.country-pack.test.ts`, "keeps the typed tax id, postcode and province when the country has no rules for them" | sends `mode: "prepare"` instead of `"demo"` | W108's option (a) |
| 4 | `apps/server/scripts/demo-seed/seed-catalogue.test.ts:111-114` | the lunch menu's section-name maps gain their `ca` text | assertion change — decision 2 |
| 4 | `seed-catalogue.test.ts:286-289` | content languages `{ defaultLanguage: "en", languages: ["en", "es"] }` → `{ defaultLanguage: "es", languages: ["es", "ca", "en"] }` (the Madrid test venue as setup provisions it) | assertion change — decisions 2 and 3 |
| 4 | `seed-catalogue.test.ts:318-331` | the coffee's description map gains its `ca` text | assertion change — decision 2 |
| 4 | `seed-catalogue.test.ts:336-342` | the custom unit's name and abbreviation maps gain their `ca` text | assertion change — decision 2 |
| 5 | `apps/server/src/demo-seed.test.ts:10-12` | the `venueWithLocales` helper also sets `admin.locale` to its first receipt language, so the existing cases keep their values | fixture grows |
| 5 | `apps/server/src/demo-seed.test.ts:22-30` | the `demoSeedLocale` table's title says it reads the admin's language (its rows keep their values through the helper above); new rows are added in Step 1 | test title change |
| 5 | `apps/server/scripts/demo-seed/seed-sales.test.ts` (4), `seed-sales.dated.test.ts` (1) | `locale: "es"` → `invoiceLocale: "es-ES"` | call-site argument; no assertion changes |

Checked and NOT changed (read on 2026-10-06 by the plan's reviewer): `seed-option-lists.test.ts:57`
is `toMatchObject`; `seed.test.ts`, `seed.integration.test.ts`, `seed-media.test.ts`,
`dev-setup.test.ts` and `demo-seed.db.test.ts` assert nothing about content languages or whole
customer-name maps (`demo-seed.db.test.ts`'s staff language flips from `es` to `en` in Task 5,
since its venue has no admin locale, and nothing there reads it).
`management-api.membership.test.ts` and `mirror-bundle-api.test.ts` call a local `seedStaff`
(`:97`, `:158`), not the demo writer.

## Known limits this plan leaves (recorded in the backlog, not built)

- **Practice sales are Spain-only.** `seed-sales.ts` files through `VerifactuBackend` directly and
  places sales in a Madrid business day; a second country's demo needs it to record through the
  venue's own fiscal module first.
- **One photo folder.** The 45 photographs stay where they are (`deploy/Dockerfile` copies that
  folder); a second data set with its own photos moves them into per-set folders then.
- **Two departments, `restaurant` and `deli`,** fixed by `CountryDemoIdentity`'s type.
- Staff-facing names a demo writes in English whatever the staff language — reporting categories
  (`seed-catalogue.ts:113`) and the four kitchen stations (`seed-catalogue.ts:56-67`) — stay as
  they are.

## Self-review notes

- Brief coverage: where the data lives, no-demo country (Task 2), shared vs per-country, W108's
  identity, each co-official area and the single-language areas (table), how languages are switched
  on (setup's own row, kept), who writes and checks the text (Task 3, decision 4), every test
  changed (table), order (Tasks 1, 3, 4, 5, each green on its own; Task 2 any time).
- The order keeps `main` working after each task: Task 1 changes no output; Task 3 adds text the
  writers still cut to `[en, es]`; Task 4 is the first to change output and needs that text present
  for Barcelona's Catalan default.
- A fresh-context review on 2026-10-06 (reading only) found twelve problems in the first draft —
  among them a Task 3 step that would have turned `seed-adjustments.test.ts` red, three missed
  pins in `seed-catalogue.test.ts`, a refusal placed where it changed two other tests' answers, and
  a false claim that a test would make Basque due. All are corrected above. A second round on the
  corrections found two more in Task 3 (a missing file, and a text type that did not guarantee
  English and Spanish), also corrected.
