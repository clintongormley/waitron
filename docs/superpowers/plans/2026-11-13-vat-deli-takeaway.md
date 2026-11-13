# VAT-deli-takeaway — takeaway drinks at 21% in the Spanish demo's deli

Status: approved by the watcher 2026-11-13 12:27 (lane L questions.md, option (a)). Lane L, fiscal
data: the owner lands it.

## The ask

Owner, 13 Nov about 10:00 (watcher window, verbatim): "we will probably also need example products
like coca cola to buy in the deli to take away which charge 21% vat". Follows #3007, which put the
demo's dine-in drinks at 10% (`reduced`) and left the deli's goods at 10% / 4%.

**When this lands:** the Spanish demo's deli menu ("Deli takeaway") has a "Drinks to take away"
category with Coca-Cola, Coca-Cola Zero and a bottle of beer, each charged at the general rate (21%,
VAT class `general`), in the Spanish demo and its Valencian, Catalan and Galician variants.

**Not in scope:** any rule that changes a product's rate by eat-in or takeaway at sale time (adviser
question T17 / S10). Bottled water (10%, art. 91.Uno.1.4.º) is left out.

## The law (for the PR; quote, then paraphrase)

BOE-A-1992-28740 (Ley 37/1992, del IVA), art. 91.Uno.1.1.º, fetched 2026-11-13: food goods are 10%,
"Se excluyen …: a) Las bebidas alcohólicas … b) Las bebidas refrescantes, zumos y gaseosas con
azúcares o edulcorantes añadidos". So a sugared cola, a sweetened (zero-sugar) cola and beer sold as
goods to take away fall outside the reduced rate and take the general rate (art. 90.Uno, 21%). The
driver re-fetches the BOE text with `curl` and quotes it in the PR; the implementers do not.

## Task 1 — the data (packages/country-es)

Files: `packages/country-es/src/demo/menu.ts` (`DELI_TAKEAWAY`, line ~1394), `data.test.ts`,
`packages/country-es/test-fixtures/demo/plain-names.json`,
`packages/country-es/demo-media/casa-delgado-{es,ca,valencia,gl}/`. The three regional variants
inherit the deli through `...CASA_DELGADO_ES.menus` (ca:146, gl:158, valencia:190) and need no edit,
but each has its own image folder and `seed.regional.test.ts:155` reads every picture from it.

1. Red first: extend the existing expected map in the deli VAT test (`data.test.ts:335`, which
   already loops over all four sets) with the three drinks at `general`. Run it, see it fail. The
   three-different-names rule is already enforced by `seed-names.test.ts:74` (en, es) and
   `regional.test.ts:101/234/367` (ca, valencia, gl); add no duplicate names test.
2. Append a fourth category to `DELI_TAKEAWAY.categories` ITSELF (after the
   `COMBINED_CASA_DELGADO_CATEGORIES.slice(0, 3).map(...)`), never to
   `COMBINED_CASA_DELGADO_CATEGORIES`, whose `slice(3)` / `slice(0, 3)` split would shift. `station:
   "deli"`, a lowercase `color: "#rrggbb"` as siblings use, five languages (en, es, ca,
   ca-ES-valencia, gl): en "Drinks to take away", es "Bebidas para llevar", ca "Begudes per
   emportar", ca-ES-valencia "Begudes per a emportar", gl "Bebidas para levar".
   Products, `pricingUnit: "each"` (as the bar drinks have; every existing deli product is
   `"weight"`), prices VAT-inclusive (`docs/developers/products.md:103`), `vatClass: "general"`
   (21%, `packages/shared/src/menu-document/vat-rates.ts:24`):
   - Coca-Cola can, 33 cl — €1.80.
   - Coca-Cola Zero can, 33 cl — €1.80.
   - Bottled lager, 33 cl (no brand) — €1.60.
   Three different names each (staff short, customer full, kitchen). Kitchen names follow each
   language's sibling pattern: en upper-case "… · DELI", es "… · CHARCUTERÍA", ca and valencia
   lower-case "… · xarcuteria", gl "… · CHARCUTARÍA". `data.test.ts:263` refuses Galician customer
   text equal to the Spanish: word the Galician so it differs (preferred) or, if it truly must be
   identical, add it to `SAME_AS_SPANISH_OR_ENGLISH`. Match the sibling products' field set.
3. Images: run the generator per set,
   `apps/server/node_modules/.bin/tsx packages/country-es/scripts/gen-demo-media.mjs <set>` for the
   four sets (plain `node` cannot run it), then `git checkout --
   packages/country-es/demo-media/*/negroni.png` (the generator rewrites it differently) and commit
   only the 12 new PNGs. Check `git status` shows no other changed media.
4. `apps/server/scripts/demo-seed/seed-names.test.ts:63` requires the product count to equal the
   entries in `packages/country-es/test-fixtures/demo/plain-names.json`: add three entries (list
   under "Changed test checks").
5. Run `pnpm --filter @waitron/country-es exec vitest run src/demo`, the country-es typecheck, and
   `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-names.test.ts
   scripts/demo-seed/seed.regional.test.ts`.

## Task 2 — the frozen Madrid capture (apps/server/scripts/demo-seed)

`seed.madrid-baseline.test.ts` compares the seeded demo row by row with a frozen, checksummed capture
that is never edited; reviewed differences are applied by helpers in `testing/`
(`madrid-vat-class-changes.ts` from #3007 is the closest model, with its own test). No existing
helper adds rows. New products add rows in about eleven tables (products, categories,
category_details, sections, section_members, menu_items, routing_cells, three media tables,
menu_version_images), add a section to the deli menu's published document and change its
fingerprint, and raise the per-table row counts in `phases` (checked at line ~1113).

1. Red first: a new helper `testing/madrid-added-rows.ts` with its own test
   (`madrid-added-rows.test.ts`). The route (the honest middle):
   - The baseline test DECLARES, per locale, the facts that matter for each new product: staff /
     customer / kitchen names, VAT class, price, pricing unit, category, and image key (the
     `<sha>.webp` literal). These are never read back from seeded output.
   - The helper takes the incidental rows (ids, sort keys, join rows, media rows) from the seeded
     output, but ONLY rows that are pure additions, sit in a listed set of tables, and point to a
     declared product or category; it checks each declared fact against them; it throws on a
     declared product that is absent, on any added row outside the listed tables or not tied to a
     declared product/category, and on any changed or removed existing row.
   - For the deli menu's published document: removing the new section must give back the
     capture's document exactly; fingerprints follow via `recomputeMadridHashes`.
   - `phases` row counts rise by exactly the added rows.
   - The helper's file states plainly, at the export, what it does NOT check (the incidental fields
     it trusts).
   Prove by control: drop one declared drink, and separately change one drink's class to `reduced`
   in menu.ts; each makes the baseline test fail; record each in one sentence. Revert the controls.
2. Apply it in `seed.madrid-baseline.test.ts` beside `madridWithVatClassChanges` (line ~357), for
   both locales the test runs.
   _As built (2026-11-13): applied inside the per-phase loop for the seeded phase, after the column
   renames, drops and folds, immediately before the row-count check, because it reads the live
   seeded output, whose rows are in the current schema._
3. Run every suite under `apps/server/scripts/demo-seed/` (`pnpm --filter @waitron/server exec
   vitest run scripts/demo-seed`) and the server typecheck. (The golden sales file
   `testing/spanish-practice-sales.golden.json` uses its own fixed product list,
   `seed-sales.golden.test.ts:135`, and should not move; if it does, STOP and report.)

## Checks before finish-branch

Golden huella + inmutabilidad unedited
(`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`);
country-es and server typecheck; the focused suites above; root `scripts/english-only.test.ts`
(the guard skips Spain-specific packages' official text, but the new helper is English).
