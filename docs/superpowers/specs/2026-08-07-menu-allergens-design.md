# Menu & allergens — design (sub-project 18, slice 1)

**Date:** 2026-08-07 · **Status:** approved in brainstorm, spec under review · **Branch:** `feat/menu-allergens`

## Purpose

A deli that sells food to the public in Spain has a **launch-day legal duty** to declare allergens.
This slice gives every sellable product a structured allergen declaration and puts that declaration
in front of the customer *before they order*, which is what the law requires. It is the first slice
of sub-project 18 (menu & allergens).

It is deliberately the **minimum that discharges the legal duty**, sized by YAGNI: direct allergen
tags per product, not a recipes/BOM subsystem. Recipes/BOM (the memory's "linchpin" for allergens +
procurement #20 + inventory) is **out** — see §9. When recipes arrive later they become a *source*
that fills the same tags, without a rewrite.

## Legal basis

The design rests on the following facts, verified against primary/authoritative sources (§10). The
Spanish means-of-provision rule (point 4) is the load-bearing one, and it is **settled on primary
source** — the design maps one-to-one onto it, so this is not left to the advisor.

1. **The 14 allergens are a fixed, EU-wide, closed list** — Regulation (EU) No 1169/2011, Annex II.
   The current in-force wording (as amended by Commission Delegated Regulation (EU) No 78/2014) names
   the specific substances: item 1 is _"Cereals containing gluten, namely: wheat (such as spelt and
   khorasan wheat), rye, barley, oats…"_ and item 8 lists the specific tree nuts (almonds, hazelnuts,
   walnuts, cashews, pecans, Brazil, pistachio, macadamia). RD 126/2015 Art. 4.1.b requires _"una
   referencia clara a la sustancia o producto de que se trate según figura en el anexo II"_ (a clear
   reference to the substance concerned as it appears in Annex II) — so a product with gluten should
   name the cereal (wheat), not only "gluten". The model's per-allergen `source` note carries this.
2. **Declaring the presence of an Annex II substance is mandatory** — Art. 9(1)(c): _"any ingredient
   or processing aid listed in Annex II … used in the manufacture or preparation of a food and still
   present in the finished product, even if in an altered form."_
3. **A deli's counter food is "non-prepacked"** (Art. 44). For that category the allergen particular
   (Art. 9(1)(c)) is expressly mandatory, and Member States _"may adopt national measures concerning
   the means through which the particulars … are to be made available and … their form of expression
   and presentation."_
4. **Spain's national measure is Real Decreto 126/2015, de 27 de febrero (BOE-A-2015-2293).** Its
   Art. 6 sets exactly how non-prepacked allergen info must be provided, and the design is built to
   satisfy it:
   - **Art. 6.2** — the default is **written**: labels on the food, or signs where it is sold.
   - **Art. 6.5.a** — the info **may instead be given orally by staff**, but only if (1) staff can
     supply it easily, on request, before the purchase completes, **and** (2) _"la información se
     registre de forma escrita o electrónica en el establecimiento"_ (it is recorded in writing or
     electronically in the establishment) and kept accessible to staff, authorities and consumers.
   - **Art. 6.5.b** — **visible, legible signage is required** telling customers where the
     information is available, or that they may ask staff.

   The design's three elements map one-to-one onto Art. 6.5: the **allergen matrix** is the recorded
   written/electronic record (6.5.a.2°); the **operator lookup** is staff supplying it orally on
   request (6.5.a.1°); the **standard notice** is the required signage (6.5.b). So matrix + operator
   lookup + notice is a _complete_ compliant configuration, not merely one option — and because an
   on-screen electronic matrix already satisfies "recorded … electronically … accessible", **printing
   is a convenience, not a legal necessity**.

**"May contain" (cross-contamination) is voluntary.** Precautionary allergen labelling is voluntary
information under Art. 36 (no implementing act adopted), confirmed voluntary by AESAN's EPA guidance
(_"el EPA es actualmente voluntario"_). `contains` is the legally load-bearing state; the model
carries `may_contain` as an optional second state because it is good practice and cheap.

## Context — what exists (from the code map)

- **Catalogue (#59)** owns products. `products` lives in `packages/db`
  (`packages/db/src/schema/catalogue.ts`), carries a **`descriptions jsonb` (locale→text)** field and
  a nullable `category_id`, is priced gross-inclusive, and already has **FORCE ROW LEVEL SECURITY** +
  a tenant-isolation policy + `GRANT SELECT, INSERT, UPDATE` to `app_user` (migration
  `packages/db/drizzle/0027_*.sql`). The catalogue shipped **headless** — no management UI/CLI/HTTP;
  products are created via `createProduct` in seeds/demos.
- **The immutability/snapshot guard** forbids any catalogue FK on the *line* tables (`sale_lines`,
  `working_order_lines`); those carry snapshotted **values** only. This design **does not touch the
  line tables**, so the guard is not engaged (see §2).
- **The till** (`apps/till` + `apps/server/src/till-api.ts`) fetches products via `GET /api/products`
  → `listAvailableProducts`. A field reaching the till travels three shapes: `AvailableProduct` → the
  `/api/products` select → the browser's `TillProduct`. The till is **operator-only**; the only
  customer-facing output today is the printed receipt. There is no customer browse screen and no KDS.
- **Localisation** has two mechanisms, kept strictly separate: UI chrome = translation keys in
  `apps/till/src/i18n` (English source of truth, `es` map); content (product names) = structured
  per-locale **data** (`descriptions`), never formatted English.
- **The `english-only` guard** scans generic packages' `src/` for Spanish tokens. `@waitron/catalogue`
  is a generic package. This constrains **where** the Spanish allergen display names may live (§3).

## Decisions

- **D1 — Direct allergen tags, not recipes/BOM.** A product carries its own allergen declaration.
  Recipes/BOM deferred to its own sub-project; when built it fills the same tags as a source.
- **D2 — Stored as one additive jsonb column on `products`, not a join table.** A tiny fixed
  per-product set, read whole by both surfaces; mirrors `descriptions`. A `product_allergens` join
  table would buy cross-product queries ("everything with peanuts") nobody needs here and cost a
  whole FORCE-RLS migration. (Revisit if a query need appears.)
- **D3 — Allergens are pre-purchase, catalogue-side only; they do NOT land on `sale_lines` or the
  fiscal receipt.** The duty is availability *before ordering*; the receipt is post-sale and not a
  required surface. This keeps the immutability/snapshot guard and `computeHuella` entirely
  untouched — no fiscal-path change.
- **D4 — `null` (unreviewed) is distinct from `{}` (reviewed, none of the 14).** A product that has
  never been assessed must not silently read as allergen-free. The matrix surfaces `null` products as
  a compliance gap.
- **D5 — The EU-14 codes + presence enum are a code-level constant in `@waitron/catalogue`
  (English/regime-neutral); the localised display names live in `apps/till` i18n (guard-exempt).**
  This deliberately keeps Spanish allergen names out of a generic package's `src/`, which the
  `english-only` guard would reject.
- **D6 — Headless authoring, matching catalogue #59.** `createProduct`/`updateProduct` gain an
  `allergens` param; a seed/demo sets them; no authoring UI. Real product-management authoring is the
  catalogue-admin gap, a separate slice.
- **D7 — One till surface serves both jobs.** The "matrix" (printable written artifact) and the
  "operator lookup" (on-screen) are the same allergen screen; see §4.

## Data model (§2 detail)

One additive column, no new table, no new RLS migration (products already has the full recipe from
`0027`):

```sql
ALTER TABLE products ADD COLUMN allergens jsonb;   -- NULL = not yet reviewed
```

Value shape (Drizzle `$type`):

```ts
// null            -> not yet reviewed (compliance gap; surfaced distinctly)
// {}              -> reviewed, contains none of the 14
// { "<code>": { presence: "contains" | "may_contain", source?: string } }
type ProductAllergens = Record<AllergenCode, { presence: AllergenPresence; source?: string }>;
```

- `source` is an optional free-text detail ("wheat", "almonds") authored in the deli's content
  locale, so the matrix can print *"gluten (wheat)"* per Annex II's specific-substance rule. It is a
  single string (not a locale map) in this slice — a note, not primary content; can become a locale
  map later if a bilingual deli needs it.
- Absence of a code key = that allergen is not declared present. Only present allergens are stored.

**Guard note:** `products` is mutable (app_user holds UPDATE) and already tenant-isolated, so adding
a column changes nothing for the `inmutabilidad` guard. Nothing here is a `tenant_id`-bearing *new*
table.

## Taxonomy & localisation (§3 detail)

- **Codes (in `@waitron/catalogue`)** — the closed EU-14, as regime-neutral English tokens:
  `gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame,
  sulphites, lupin, molluscs`. Plus `AllergenPresence = "contains" | "may_contain"`. A validator
  rejects unknown codes / bad presence.
- **Display names (in `apps/till/src/i18n`)** — `en` + `es` maps keyed by code, the canonical EU
  translations. `apps/*` is exempt from the `english-only` guard, so the Spanish names live safely
  here rather than in the catalogue package.
- **`source` note** — authored data on the product row (guard-exempt as data, like `descriptions`).

## Surfaces (§4 detail) — one allergen screen, two hats

```
Till  ──"Allergens" button──▶  Allergen screen (this location's catalogue)
   • product × 14-allergen grid
   • on-screen   = the operator's lookup (scan / search to the item)
   • "Print"     = the written matrix artifact for the counter
   • tap a row   = detail: presence + source, e.g. "gluten (wheat)"
   • header      = standard "Allergen information available — ask staff" notice
   • products with allergens = NULL shown distinctly ("allergen info pending")
```

- A **dedicated Allergens button**, not the product tiles (tapping a tile adds to basket).
- Rendered in the **operator locale** on-screen; **invoice locale** when printed (reusing the ticket
  print path). Built from `wt-*` primitives (`wt-button`, `wt-card`, `wt-dialog` for row detail); a
  presence indicator uses `wt-icon` (registered pictograms/letters).
- **Compliance mapping (RD 126/2015 Art. 6.5):** the on-screen grid _is_ the "recorded … in writing
  or electronically … accessible" record (6.5.a.2°), so it stands alone without printing; the operator
  lookup is the staff-oral-on-request path (6.5.a.1°). The **physical, visible point-of-sale signage**
  required by 6.5.b ("ask staff / allergen information available here") is an **operational** duty the
  deli discharges with a physical sign — the screen header carries the same standard wording, but the
  legally-required sign is the physical one at the counter, not the software.

## Server & data flow (§5 detail)

- **Only server change:** add `allergens` to the `GET /api/products` response (the triple-mirror:
  `AvailableProduct` → the select → `TillProduct`). Both surfaces render **client-side** from that one
  product list — **no new endpoint**.
- **Authoring:** `createProduct`/`updateProduct` accept `allergens`, validated against the EU-14; a
  seed/demo sets them and proves the flow end-to-end (as #59 shipped).
- **Flow:** author (headless) → till boots, fetches `/api/products` incl. allergens → operator lookup
  and matrix both render from the cached list; print for the artifact.

## Migration, validation, testing (§6 detail)

- **Migration:** one additive `ALTER products ADD COLUMN allergens jsonb` in `packages/db`. **Must be
  sequenced against the parallel cierre Z (#8) `packages/db` migration** — `drizzle/meta/_journal.json`
  collides on concurrent branches; rebase one on the other.
- **Validation:** a new registered error for an unknown allergen code / bad presence. **Grep the
  sibling catalogue error codes first** and follow their exact domain-concept convention before
  naming it (house rule — codes are never renamed once shipped).
- **Testing (TDD):**
  - allergen constant + validator unit tests (the 14, presence, rejection of unknowns);
  - `createProduct`/`updateProduct` round-trip allergens under RLS (real-PG where the write path
    warrants it, PGlite otherwise);
  - `listAvailableProducts` returns allergens; the `/api/products` mirror carries them;
  - allergen-screen component tests: grid render, operator vs invoice locale, `contains`/`may_contain`
    distinction, `source` detail, and the `null`/unreviewed state;
  - a demo script: seed a catalogue with allergens → render the matrix → operator lookup.

## Scope out / deferred (§9)

- **Recipes / BOM / ingredients** — deferred; tags are the source now (D1). Seeds procurement (#20)
  and inventory later.
- **Product-authoring UI** — the whole catalogue-management gap; its own slice. This slice authors
  headlessly (D6).
- **Customer-facing browse screen / KDS** — not built; matrix + operator lookup only.
- **Allergens on the fiscal receipt / `sale_line`** — not a required surface (D3).
- **`source` as a locale map** — single string for now.
- **Variants / modifiers** — unrelated catalogue #18 items, not in this slice.

## Advisor / open questions (§8) — non-blocking

- **Means of provision — CLOSED on primary source** (RD 126/2015 Art. 6, §Legal basis point 4). No
  advisor needed: the matrix (written/electronic record, Art. 6.5.a.2°) + operator lookup (staff oral
  on request, Art. 6.5.a.1°) + the required signage (Art. 6.5.b) is a complete compliant
  configuration.
- **Specific-substance naming — largely settled; the model covers it.** Art. 4.1.b requires "a clear
  reference to the substance … as it appears in Annex II", and Annex II names the specific
  cereals/nuts — so the safe reading is to name the specific substance (wheat, almonds), which the
  `source` field does. Whether "cereals containing gluten" alone would also satisfy an inspector is
  the only residual interpretive margin; the model does not depend on the answer.
- **Regional specifics (open).** Any autonomous-community / local-authority requirements for the
  actual trading location (e.g. Andalucía). Worth a check before launch; does not shape the schema.
- **Provenance caveat to close before launch (§10).** EUR-Lex could not be machine-fetched here (AWS
  WAF); the EU quotes were verified against legislation.gov.uk's reproduction of the identical
  consolidated text and pre-Brexit snapshots, while the load-bearing Spanish text was fetched
  first-hand at BOE. Eyeball the two EUR-Lex CELEX URLs in a browser (or have the advisor confirm)
  before this ships — the same posture the fiscal findings take when a primary portal is unreachable.

## Provenance (§10)

Verified against primary/authoritative sources. **Caveat:** `eur-lex.europa.eu` was blocked by an AWS
WAF challenge in this environment, so the EU quotes were verified against **legislation.gov.uk's
reproduction of the identical EU consolidated text** (which cites `CELEX:02011R1169-20180101` as its
source) plus a pre-Brexit point-in-time snapshot for Art. 44; the canonical EUR-Lex URLs are real and
load in a browser but were not machine-fetched. The **load-bearing Spanish text (RD 126/2015) and the
AESAN guidance were fetched first-hand** at boe.es / aesan.gob.es. Confirm the two EUR-Lex URLs in a
browser (or via the advisor) before launch — same posture as the fiscal findings when a primary portal
is unreachable.

| Claim | Source | URL | Verbatim (orig → gloss) |
| --- | --- | --- | --- |
| The 14 allergens, current wording (post Reg 78/2014) | Reg. (EU) 1169/2011, Annex II — consolidated CELEX 02011R1169-20180101 | [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02011R1169-20180101) · [gov.uk mirror](https://www.legislation.gov.uk/eur/2011/1169/annex/II) | Item 1: "Cereals containing gluten, namely: wheat (such as spelt and khorasan wheat), rye, barley, oats…"; item 8 names the 8 specific tree nuts. |
| Item 1 amended (kamut/spelt → wheat) | Commission Delegated Reg. (EU) 78/2014, Recital 1 | [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014R0078) | "'Khorasan wheat' and 'spelt' should therefore be indicated as types of wheat in point 1 of that Annex." |
| Allergen declaration is mandatory | Reg. (EU) 1169/2011, Art. 9(1)(c) | [gov.uk](https://www.legislation.gov.uk/eur/2011/1169/article/9) | "…any ingredient or processing aid listed in Annex II … used in the manufacture or preparation of a food and still present in the finished product, even if in an altered form". |
| Non-prepacked: allergens mandatory; MS set the means | Reg. (EU) 1169/2011, Art. 44 | [gov.uk (2020-12-30 EU snapshot)](https://www.legislation.gov.uk/eur/2011/1169/article/44/2020-12-30) | "…(a) the provision of the particulars specified in point (c) of Article 9(1) is mandatory … 2. Member States may adopt national measures concerning the means through which the particulars … are to be made available…". |
| Spain: RD 126/2015 governs non-prepacked allergen info; the means-of-provision rules | Real Decreto 126/2015, de 27 feb (BOE-A-2015-2293), Arts. 4.1.b, 6.2, 6.5.a, 6.5.b | [BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2015-2293) | Art. 6.5.a.2°: "la información se registre de forma escrita o electrónica en el establecimiento …" (recorded in writing or electronically in the establishment); Art. 6.5.b: "se indicará de manera que sea fácilmente visible, claramente legible y accesible … el lugar del establecimiento donde se encuentra disponible la información …" (it shall indicate, visibly and legibly, where the information is available). |
| "May contain" is voluntary | AESAN, "Etiquetado Precautorio de Alérgenos" (2016) + Reg. 1169/2011 Art. 36 | [AESAN EPA](https://www.aesan.gob.es/AECOSAN/docs/documentos/noticias/2016/DOCUMENTO_EPA.PDF) | "…el etiquetado voluntario empleado para indicar que uno o más alérgenos legislados podrían estar de forma involuntaria …"; "como el EPA es actualmente voluntario" (as EPA is currently voluntary). |

**Residual provenance gaps (small):** the 2011 _original_ Annex II item-1 wording was confirmed only
indirectly (via the Reg 78/2014 recital naming the words it replaced), not from the 2011 OJ text; and
AESAN issued a newer precautionary-labelling guide (Dec 2025) not pulled here — it does not change the
voluntariness conclusion, but cite the 2025 version if current AESAN guidance is ever quoted.
