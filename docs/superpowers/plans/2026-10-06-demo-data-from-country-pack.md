# The demo data set comes from the country pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: the owner answered the six decisions on 2026-10-06 (~08:19, amended ~08:21); this plan
is amended to those answers (W109, lane A).** Nothing here is built. Two points the answers do not
settle are open, both about a country with no demo data (Task 2): see "Open points" below. Task 2
waits for them; Tasks 1, 3, 4 and 5 do not.

**Goal:** A demo venue's menus, floor, staff and example data belong to its country, the way its
company name and tax number already do (W108, #1276). A Spanish demo's customer-facing text is in
Spanish and English, with Spanish the default; where the area requires Catalan or Galician, that
language is the default and Spanish and English come with it — in Barcelona Catalan, Spanish and
English. A country whose pack has no demo data gets the existing demo data in English.

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

**A country with no demo data (decision 6, Task 2).** Its Demo is not refused. The venue is seeded
from the existing data set, `casa-delgado-es`, in English: content languages English (default),
staff names in English whatever the person setting it up speaks. **This plan's own choice, not the
owner's:** an area that requires a language also gets that language switched on beside English,
because `writeContentLanguages` refuses a list that leaves a required language out
(`content-languages.ts:185-186`); the text stays English only, so that language is listed as
missing translations. No pack today has such an area without demo data (the only other pack, the
United Kingdom's, has no areas). The wizard keeps offering Demo for every setup-ready country. Two things the
answer does not settle are the open points below: what identity such a demo carries (the pack has
no made-up company or tax number for it), and whether it gets practice sales. A pack whose
`demo.dataSet` names nothing still fails a test at build time, so it never ships.

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
   the existing demo data in English (Task 2). The W108 test that sends a Demo for a mocked UK pack
   (`apps/server/src/setup-api.country-pack.test.ts`, "keeps the typed tax id, postcode and
   province when the country has no rules for them") stays as it is: it stubs the seed
   (`seedDemo: vi.fn(…)`, `:63`), so it passes through the setup route with the fallback in place.

## Open points (asked in lane A's `questions.md`, "W109 — two open points"; Task 2 waits for them)

- **A. The identity of a fallback demo.** A pack with no `demo` has no made-up company, tax number,
  location name or trading names, and the wizard's Demo form hides the tax ID and legal name fields
  (`DEMO_HIDDEN`, `apps/setup/src/screens/venue-screen.ts:76-84`), so today the operator could not
  get past the venue screen. The same list hides the operation description, which Demo fills only
  from the filing module's default — and the United Kingdom pack files with `none`. **Recommended:**
  in Demo, a pack with no `demo` shows the tax ID and legal name fields (validated by the pack's
  own tax-ID rule, as in Prepare), and the operation description too where the filing module
  supplies no default; the location name starts empty; the summary drops its "fixed demo values"
  note for such a demo; and the two department trading names come from the data set
  (`fallbackTradingNames`, `Bar Casa Delgado` and `Deli Delgado`). Alternative: give the pack a
  made-up identity after all (only the pack can make a tax number its own rule accepts).
- **B. Practice sales in a fallback demo.** `seed-sales.ts` records every practice sale through
  `VerifactuBackend` (`seed-sales.ts:14, 170`) and places it in a Madrid business day, whatever the
  venue's filing module — so a non-Spanish venue would get Spanish fiscal records. **Recommended:**
  no practice sales in a fallback demo (`salesDays: 0`) until the seed records through the venue's
  own fiscal module (a known limit below). Alternative: build that first, as part of Task 2.

---

## Global Constraints

- The "⚠ THE RULE" block carried with W109 into lane A's queue applies, with the owner's 2026-09-27
  and 2026-10-05 test rules: an existing test changes only where this plan lists it (table at the
  end); any other existing test that goes red is a STOP, not a fix.
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
- Each task is its own PR with a backlog entry update; branches `feat/demo-data-<slug>`. **Order:
  Tasks 1, 3, 4, 5, then 2.** Task 2 needs the data set (Task 1), the language rule (Tasks 3 and 4)
  and Task 5's staff-language change, which it overrides for the fallback; it also waits for open
  points A and B.
- Look at anything visual in both themes and at phone width (CLAUDE.md §4): Task 2's venue screen
  (in the browser harness — no setup-ready pack without demo data exists to open it in the app),
  and in Task 4 the Content languages page of a Barcelona demo.

## Review Focus

1. **A Barcelona demo set up from a Spanish-language browser** — content default Catalan, Catalan,
   Spanish and English enabled, staff names in Spanish, practice receipts in Catalan, Missing
   translations empty. Pinned in Task 4 (languages, gaps) and Task 5 (staff names, receipts).
2. **A Galician demo** — Galician the default, Spanish and English enabled, every customer-facing
   text has all three. Pinned in Task 4.
3. **A Madrid or Balearic demo** — Spanish default, English, no Catalan. Pinned in Task 4.
4. **A Demo for a country with no demo data** — seeds the existing data in English with no practice
   sales (as open point B is answered), staff names English; nothing refused. Pinned in Task 2.
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

### Task 2: A country with no demo data gets the existing demo data in English

Branch `feat/demo-data-english-fallback`. **Built last, after Task 5, and only once open points A
and B are answered;** written here for their recommended defaults.

**Files:**
- Modify: `apps/server/scripts/demo-seed/data-set.ts` (`FALLBACK_DEMO_DATA_SET_ID =
  "casa-delgado-es"`; `DemoDataSet` gains `fallbackTradingNames`; `demoContentLanguages` gains the
  no-demo branch)
- Modify: `apps/server/scripts/demo-seed/data-sets/casa-delgado-es.ts` (`fallbackTradingNames:
  { restaurant: "Bar Casa Delgado", deli: "Deli Delgado" }`)
- Modify: `apps/server/src/demo-seed.ts` (`seedInstalledDemo`: a pack with no `demo` no longer
  throws; it seeds the fallback set with staff language `"en"`, the data set's trading names and
  `salesDays: 0`)
- Modify: `apps/setup/src/screens/venue-screen.ts` (in Demo, a pack with no `demo` shows the tax ID
  and legal name fields — `#shows` stops hiding them for that pack — and the location name is not
  prefilled; `#next` sends the typed values. Demo also hides the operation description
  (`DEMO_HIDDEN`, `:76-84`), fills it only from the filing module's default
  (`#descriptionDefault`, `:224-229`) and refuses Next while it is empty (`:483-486`); the United
  Kingdom pack's filing is `none` (`packages/country-gb/src/united-kingdom.ts:21`), so the field is
  also shown in Demo whenever the filing module supplies no default)
- Modify: `apps/setup/src/screens/review-screen.ts` and the `review.demo_defaults` strings
  (`apps/setup/src/i18n/strings/venue.ts:98`, `:283`): the summary's note that the legal name and
  tax ID are "Waitron's fixed demo values" (`review-screen.ts:150`) is shown only when the pack
  has a `demo`; a fallback demo, whose operator typed them, gets no such note. Spain's note and its
  pin (`review-screen.test.ts:374-387`) are unchanged.
- Test: `apps/server/src/demo-seed.test.ts`, `apps/server/scripts/demo-seed/data-set.test.ts`,
  `apps/server/scripts/demo-seed/seed.test.ts`, `apps/setup/src/screens/venue-screen.test.ts`,
  `apps/setup/src/screens/review-screen.test.ts`
- Test change: `apps/server/src/demo-seed.test.ts:78-85`, "refuses, seeding nothing, a venue whose
  country has no demo identity" becomes the fallback case (table at the end).
- Unchanged: `apps/server/src/setup-api.ts` (no refusal is added) and
  `setup-api.country-pack.test.ts`.

**Interfaces:**
- Consumes: `DemoDataSet`, `demoDataSet`, `demoContentLanguages` (Tasks 1 and 3), `demoSeedLocale`
  (Task 5).
- Produces:

```ts
// data-set.ts
export const FALLBACK_DEMO_DATA_SET_ID = "casa-delgado-es";
// DemoDataSet gains:
readonly fallbackTradingNames: { readonly restaurant: string; readonly deli: string };
// demoContentLanguages: when getCountryPack(country)?.demo is undefined, the languages are
// ["en", ...required.filter((language) => language !== "en")], default "en".
```

- [ ] **Step 1: Write the failing tests.**
  - `demo-seed.test.ts`: a `GB` venue (whose pack has no `demo`) calls `seedDemoRestaurant` once
    with `dataSet: DEMO_DATA_SETS["casa-delgado-es"]`, `locale: "en"` even when `admin.locale` is
    `es-ES`, `salesDays: 0`, and `departmentTradingNames: { restaurant: "Bar Casa Delgado", deli:
    "Deli Delgado" }` — the replacement for the refusal case (table).
  - `data-set.test.ts`: `demoContentLanguages(set, { country: "GB", area: null })` is
    `{ defaultLanguage: "en", languages: ["en"], required: [] }` (the real GB pack has no `demo`).
  - `seed.test.ts`, real database: provision the helper's venue, set its tenant's `country` to `GB`
    and its location's `province` to null (a fixture growing — the GB pack has no provinces), run
    `seedDemoRestaurant` with the fallback set, `locale: "en"`, `salesDays: 0`: content languages
    `{ defaultLanguage: "en", languages: ["en"] }`, no missing translations, a product's stored
    customer name is `{ en: … }` only.
  - `venue-screen.test.ts`: with a setup-ready pack lacking `demo` AND whose filing is `none` (not
    `SPARSE_PACK`, `:1192`, whose filing is `verifactu` and would pass either way), the Demo form
    shows the tax ID, legal name and operation description fields, refuses Next while they are
    empty, and sends the typed values; Spain's Demo still hides them and sends its demo identity
    (the existing cases at `:802` and `:941`, unchanged).
  - `review-screen.test.ts`: a Demo for a pack lacking `demo` shows no "fixed demo values" note.
- [ ] **Step 2: Run and watch them fail.**
  Run: `pnpm --filter @waitron/server exec vitest run src/demo-seed.test.ts scripts/demo-seed/data-set.test.ts scripts/demo-seed/seed.test.ts`
  and `pnpm --filter @waitron/setup exec vitest run src/screens/venue-screen.test.ts src/screens/review-screen.test.ts`
  Expected: FAIL — `seedInstalledDemo` throws for GB; the GB languages are `es, en`; the Demo form
  hides the three fields; the summary shows the fixed-values note.
- [ ] **Step 3: Implement** the four changes above.
- [ ] **Step 4: Make the listed `demo-seed.test.ts` change**; run Step 2's commands again and
  `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts src/setup-api.country-pack.test.ts src/demo-seed.db.test.ts`.
  Expected: PASS, with a `Tests` count printed.
- [ ] **Step 5: Prove by deletion**: put the throw back in `seedInstalledDemo`; the GB case fails.
  Make the no-demo branch of `demoContentLanguages` return the base languages; the GB language
  cases fail. Restore both.
- [ ] **Step 6: Look** at the venue screen and the summary in Demo for a pack without demo data, in
  the browser harness (no such pack is setup-ready in the app), light and dark, 1280 and 390 px.
- [ ] **Step 7: Commit, backlog entry** (W108's open question closed by decision 6; the practice
  sales limit stays recorded), **`finish-branch`**.

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
    if (pack.demo === undefined) continue;
    const set = demoDataSet(pack.demo.dataSet);
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
numbers are from `main` at `3137f5838`; the files they point into were unchanged at `401ecd27c`
(checked with `git diff --stat 3137f5838 401ecd27c` over them on 2026-10-06). **Re-check them
before each task:** no task starts until lane C's A261-5 Hours has landed, and that branch changes
`seed-floor.ts`, so the plan's `seed-floor.ts` line numbers (and maybe others) will have moved.

| Task | File | What changes | Kind |
| --- | --- | --- | --- |
| 1 | `packages/country-es/src/spain.test.ts` ~279-286 | `SPAIN.demo` `toEqual` gains `dataSet: "casa-delgado-es"` | whole-shape pin gains a key (owner rule 2026-09-27) |
| 1 | `apps/server/src/demo-seed.test.ts` ~49-58 | the `toStrictEqual` on the seed call's input gains `dataSet` | whole-shape pin gains a key |
| 1 | `apps/server/scripts/demo-seed/` — `seed-catalogue.test.ts` (6 `seedCatalogues`), `seed-media.test.ts` (2 `seedCatalogues`), `seed-option-lists.test.ts` (1 `seedCatalogues`, 1 `seedOptionLists`), `seed-floor.test.ts` (3), `seed-adjustments.test.ts` (5), `seed-staff.test.ts` (2), `seed-watchers.test.ts` (1), `seed.test.ts` (5 `seedDemoRestaurant`), `seed.integration.test.ts` (1) | each call gains `dataSet`; the `seedOptionLists` and `seedAdjustmentReasons` calls also gain `languages`, the literal pair the test's seed language gives today (counts are call sites, from `grep` on 2026-10-06) | call-site arguments; no assertion changes |
| 4 | `apps/server/scripts/demo-seed/seed-catalogue.test.ts:286-289` | content languages `{ defaultLanguage: "en", languages: ["en", "es"] }` → `{ defaultLanguage: "es", languages: ["es", "en"] }` (the Madrid test venue under the area rule) | assertion change — decisions 2 and 3 |
| 5 | `apps/server/src/demo-seed.test.ts:10-12` | the `venueWithLocales` helper also sets `admin.locale` to its first receipt language, so the existing cases keep their values | fixture grows |
| 5 | `apps/server/src/demo-seed.test.ts:22-30` | the `demoSeedLocale` table's title says it reads the admin's language (its rows keep their values through the helper above); new rows are added in Step 1 | test title change |
| 5 | `apps/server/scripts/demo-seed/seed-sales.test.ts` (4), `seed-sales.dated.test.ts` (1) | `locale: "es"` → `invoiceLocale: "es-ES"` | call-site argument; no assertion changes |
| 2 | `apps/server/src/demo-seed.test.ts:78-85`, "refuses, seeding nothing, a venue whose country has no demo identity" | becomes "seeds a venue whose country has no demo data from the existing set, in English, without practice sales": instead of a rejection and no seed call, exactly one seed call whose input is pinned whole (data set, `locale: "en"`, `salesDays: 0`, trading names) | assertion change — decision 6 (as strict: the whole input is pinned) |

Checked and NOT changed: `seed-option-lists.test.ts:57` is `toMatchObject`; `seed.test.ts`,
`seed.integration.test.ts`, `seed-media.test.ts`, `dev-setup.test.ts` and `demo-seed.db.test.ts`
assert nothing about content languages or whole customer-name maps (read on 2026-10-06 by the first
draft's reviewer; `demo-seed.db.test.ts`'s staff language flips from `es` to `en` in Task 5, since
its venue has no admin locale, and nothing there reads it). The three stored maps pinned whole in
`seed-catalogue.test.ts` (`:111-114`, `:318-331`, `:336-342`) stay `{ en, es }` in every task: the
Madrid test venue carries Spanish and English only. `boot.test.ts` (`:2036`, `:3677`) and
`dev-setup.test.ts` (`:218`) run the real seed on Madrid venues and assert nothing about languages
(grep by the amendment's reviewer). `setup-api.country-pack.test.ts`'s Demo cases for the mocked UK
pack stay as they are: they stub the seed, so nothing tests the path from the setup route into
`seedInstalledDemo` for such a country end to end — Task 2's `demo-seed.test.ts` and `seed.test.ts`
cases cover the two halves separately. `management-api.membership.test.ts`
and `mirror-bundle-api.test.ts` call a local `seedStaff` (`:97`, `:158`), not the demo writer.

## Known limits this plan leaves (recorded in the backlog, not built)

- **Practice sales are Spain-only.** `seed-sales.ts` files through `VerifactuBackend` directly and
  places sales in a Madrid business day; a second country's demo, or a fallback demo with practice
  sales (open point B), needs it to record through the venue's own fiscal module first.
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
  receipt language; Task 2 adds the fallback on top of all of them.
- The first draft was reviewed by a fresh-context reader in two rounds (2026-10-06, reading only);
  its findings were corrected before the owner's answers. The amendment to the answers replaced the
  "follow setup's list" rule (and with it the extracted `provisionedContentLanguages` and three
  changed checks in Task 4), the refusal in Task 2, and the order of tasks.
