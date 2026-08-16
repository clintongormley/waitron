# Purchase Invoices & Modelo 303 Deducible — Design Spec

**Date:** 2026-08-16
**Status:** APPROVED 2026-08-16 (implementation is a later, sliced track — see §10). Submittable output = a **raw DR303 fixed-layout file** (owner decision 2026-08-16, §8/D5).
**Sub-project:** 8 — Reporting (the input-VAT side deferred by #76/#66/#68).
**Depends on:** a NEW purchase-invoice module (this spec designs it); the output-VAT side already shipped (`computeVatReturn`, #76).

> **Provenance discipline (CLAUDE.md §1).** Every external fiscal claim below carries a source in the
> §13 provenance table, and quotes the source's own words. Where a fact could NOT be pinned to a
> primary source this session it is marked **[UNVERIFIED — confirm against DR303]** rather than
> stated as fact. Two casilla numbers the first draft assumed were wrong against the current form and
> are corrected here (§7).

---

## 1. Purpose & context

Waitron files the **output** side of the IVA return today: `computeVatReturn` (#76) aggregates the
IVA **devengado** (charged on sales) per rate over a calendar month, from the filed
`sales.vat_breakdown` desglose. A real modelo 303 also has an **input** side — the IVA **soportado /
deducible** (VAT the business paid its suppliers and may deduct) — and the bottom-line result is
`devengado − deducible`. Waitron has **no purchase-invoice data**, so #76 explicitly deferred the
whole deducible side "until a procurement/purchase-invoice module exists" (its spec §4).

This spec designs that module, and the reporting on top of it, to the scope the owner chose
(2026-08-16): **capture received supplier invoices → compute IVA deducible → extend the 303 to the
net → map the AEAT casillas → emit a submittable/pre-filled 303.** The casilla map and the
submittable form make primary-source rigor mandatory (§7, §8).

---

## 2. Fiscal boundary (H2) — what this is NOT

A purchase invoice is a **factura recibida** — issued by our *supplier*, not by us. It is therefore
**purely a commercial/accounting record** and must touch **nothing** in the fiscal core:

- **No huella, no `registros_facturacion` entry, no hash chain, no invoice number from our
  `invoice_series`.** Those are for invoices *we issue* (Veri\*Factu). A received invoice already
  carries the supplier's own number.
- **No `packages/verifactu` / `packages/fiscal-verifactu` change.** Exploration confirmed the tree
  has **zero** supplier/purchase/`iva_soportado`/`factura_recibida` concepts today — clean greenfield.
- Purchase invoices are **mutable** accounting records (fix a typo, correct a mis-keyed rate), the
  **opposite** of the immutable `sales`/`registros` lane: `GRANT ... UPDATE, DELETE`, no append-only
  trigger, no chain.

A whole-branch review must confirm this boundary on every implementation slice (the standing H2 rule).

---

## 3. Decisions

- **D1 — New package `@waitron/purchasing`, tables in `packages/db`.** Follow the #89 recipes
  precedent exactly: the Drizzle table definitions live in `packages/db/src/schema/` (so they are part
  of `CORE_MIGRATIONS` and are scanned by the `fiscal-verifactu` `inmutabilidad` guard), the
  operations live in a new optional `@waitron/purchasing` package. Rationale: the tables are
  tenant-scoped and must satisfy the FORCE-RLS guard, which only scans `packages/db`'s migrations;
  splitting ops into their own package keeps the reporting/purchasing logic out of the schema layer,
  as catalogue/recipes do.
- **D2 — Deducible reporting lives in `@waitron/reporting`, reusing `aggregateVatByRate`.** A new
  `computeInputVat` mirrors the output-side core (unnest a per-rate desglose, sum base/cuota per
  rate). `computeVatReturn` is extended to return `devengado` + `deducible` + the `net`. No schema
  change to `sales`.
- **D3 — The deduction period is driven by the RECEPTION date, not the supplier's invoice date.**
  Primary source (Manual Práctico IVA 2025): input VAT "*se deducirá en el período de liquidación en
  el que se reciba la factura, o en los siguientes*" — deductible from the period the invoice is
  received/possessed, within a 4-year window (§13). So the module stores **both** dates and
  `computeInputVat` buckets by `received_on`. (The 4-year carry-forward and the excess-compensation
  boxes are a later slice, §10/§11.)
- **D4 — Régimen general is the modelled default; recargo de equivalencia is a flagged seam, not
  assumed.** A trader under recargo de equivalencia **cannot deduct input VAT and does not file 303
  for those activities** (§9, quoted). A deli's food-service (hostelería) activity is generally
  régimen general, but a packaged-goods retail activity *could* be RE. The schema carries a regime
  marker so a RE line is excluded from the deducible aggregate; **which activities are RE is an
  asesor-fiscal call** we flag, never hardcode.
- **D5 — "Submittable" means a raw DR303 fixed-layout file (owner decision, 2026-08-16), NOT an API.**
  There is no public REST submission endpoint for modelo 303 (§8, quoted). Slice D produces a
  fixed-layout **DR303 diseño-de-registro** file (ISO-8859-1) that a human uploads via the AEAT sede
  "por fichero" path. A **libro registro de facturas recibidas → Pre303** export remains a possible
  later addition (and the libro is itself a legal obligation worth tracking) but is NOT the chosen
  primary output. The earlier implementation slices produce the *casilla-mapped aggregate* the DR303
  serializer consumes.
- **D6 — No backwards-compatibility / backfill code** (CLAUDE.md §3): nothing is deployed; new tables
  start empty.
- **D7 — Single currency per tenant** (memory): no currency column; money is `numeric(12,2)` in the
  tenant currency, `Decimal` strings via `@waitron/shared` `money.ts` (`percentOf` for cuota
  derivation), exactly as sales.

---

## 4. Data model

Two tenant-scoped tables in `packages/db/src/schema/purchase-invoices.ts`, both `.enableRLS()` +
FORCE-RLS + tenant-isolation policy + `app_user` grants in a hand-written companion migration (the
recipes `0038` auto-ENABLE / `0039` custom FORCE+policy+grant pair — §12).

### `purchase_invoices` (header — mutable)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `tenant_id` | uuid NOT NULL FK→tenants | RLS key |
| `supplier_tax_id` | text NOT NULL | supplier NIF/CIF (their identity; not validated as ours) |
| `supplier_name` | text NOT NULL | |
| `supplier_invoice_number` | text NOT NULL | THEIR number (never our series) |
| `issued_on` | date NOT NULL | supplier's *fecha de expedición* |
| `received_on` | date NOT NULL | our *fecha de recepción/registro* — **drives the deduction period (D3)** |
| `total` | numeric(12,2) NOT NULL | gross, tenant currency |
| `regime` | enum `general` \| `recargo_equivalencia` | default `general`; a RE invoice is excluded from the deducible aggregate (D4) |
| `deducible_proportion` | numeric(5,2) NOT NULL default `100.00` | the prorrata / partial-deductibility seam (0–100); asesor-fiscal (§9) |
| `note` | text NULL | |
| `created_at` / `updated_at` | timestamptz | mutable record |

Uniqueness: a partial/plain unique index on `(tenant_id, supplier_tax_id, supplier_invoice_number)`
to refuse entering the same supplier invoice twice (the libro-registro no-duplicate rule) — **confirm
the exact key with the asesor** (a supplier may legitimately reuse a number across years?). Flagged.

### `purchase_invoice_vat` (the per-rate desglose — mutable, one-to-many)
Modelled as normalized rows (not a header jsonb) so the deducible aggregate can `GROUP BY` in SQL like
the sales desglose, and so a single invoice can mix rates and kinds:
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL FK→tenants | RLS key (carried on every tenant table, per the guard) |
| `purchase_invoice_id` | uuid NOT NULL FK→purchase_invoices (cascade) | |
| `rate` | numeric(5,2) NOT NULL | e.g. `21.00`; check 0–100 like `sale_lines.vat_rate` |
| `base` | numeric(12,2) NOT NULL | taxable base |
| `cuota` | numeric(12,2) NOT NULL | VAT amount (`percentOf(base, rate)`, filed verbatim to allow the supplier's own rounding) |
| `kind` | enum `corriente` \| `inversion` | drives casilla 28/29 vs 30/31 (§7); default `corriente` |

Rationale for storing `cuota` explicitly rather than deriving it: the supplier's invoice is the source
of truth and may round per-line differently; we file what they charged (the same "sum the filed
cuotas, never `round(Σ base × rate)`" exactness rule #76 follows on the output side).

**Rectificación de facturas recibidas** (casilla 40/41) — a corrective purchase invoice — is a later
slice: add `corrects_purchase_invoice_id` (nullable self-FK) and route its base/cuota to casilla
40/41. Not in slice 1 (§10).

---

## 5. Package structure (`@waitron/purchasing`)

Mirror `@waitron/reporting` / `@waitron/recipes`:
- `package.json`: `"@waitron/purchasing"`, `private`, `type: module`, `main: ./src/index.ts` (no
  build step), deps `@waitron/db` + `@waitron/shared` + `drizzle-orm`.
- `src/index.ts` barrel re-exporting the ops + types, ending in the side-effect `import "./errors.js"`.
- `src/errors.ts`: `declare module "@waitron/shared"` adding domain-concept codes — **`purchase.*`**
  (the entity is the purchase invoice), e.g. `purchase.not_found`, `purchase.duplicate`,
  `purchase.invalid` — grepped against the registry before adding; never `purchasing.*` (package
  name) or `invoice.*` (collides with our issued-invoice concept). Codes never renamed.
- Ops: `createPurchaseInvoice`, `updatePurchaseInvoice`, `deletePurchaseInvoice`,
  `getPurchaseInvoice`, `listPurchaseInvoices` (tenant-scoped) — plain mutable CRUD over the two
  tables, each `tx`-based, tenant from the caller. `packages/db` is added to nothing fiscal.
- Added to `GENERIC_PACKAGES` in `english-only.ts` (both pins — `packages/db/src/english-only.ts` and
  the `fiscal-verifactu` `vocabulary-scope` test) since it is a generic (non-`apps/*`, non-fiscal)
  package the English-only guard scans; new Spanish schema tokens (`recargo_equivalencia`,
  `corriente`, `inversion`... — decide which are schema identifiers) go in `SPANISH_WORDS`.

---

## 6. Reporting — `computeInputVat` + extended `computeVatReturn`

- **`computeInputVat(tx, { tenantId, year, month, kind? })`** in `@waitron/reporting`, parallel to
  `computeVatReturn`'s output side. Reads `purchase_invoice_vat` joined to `purchase_invoices`,
  filtered to `regime = 'general'` (D4), bucketed by `received_on` civil date within the calendar
  month (the `make_date(year,month,1) ≤ received_on < +1 month` half-open bound `computeVatReturn`
  uses), grouped by `rate` (and optionally `kind` for the 28/29-vs-30/31 split), summing
  `base` and `cuota × deducible_proportion/100`. Reuse `aggregateVatByRate`'s shape if it generalises;
  otherwise a sibling core `aggregateDeducibleByRate` (do not force a bad reuse).
- **`computeVatReturn` extended** to return `{ devengado, deducible, resultado }` where `devengado` is
  today's per-rate output aggregate (casilla 27 side), `deducible` is `computeInputVat`'s per-rate +
  kind aggregate (casilla 45 side), and `resultado` is the régimen-general result (casilla 46 =
  27 − 45). Keep the existing `VatReturn` fields for backward-compatible callers (the demo, tests) —
  add the new fields, do not rename (there is no deployed consumer, but the #76 tests pin the shape).
- **Exactness inherited, not re-derived** — sum the filed per-invoice cuotas, never
  `round(Σ base × rate)` — pinned by a difference-method test as #76 does.

---

## 7. The modelo 303 casilla mapping

A `Modelo303` structure that maps the aggregates onto the official boxes. **All numbers below are
from AEAT Instrucciones 2026 unless marked; the two ⚠ rows correct the first draft (§13 has quotes).**

**IVA devengado — régimen general** (already produced by `computeVatReturn`):
- `01/02/03` = base/tipo/cuota @ 4%; `04/05/06` @ 10%; `07/08/09` @ 21%.
- `150/151/152` @ 0% (the 2023 addition, still current). `153/154/155` @ 5% **existed in 2024 but is
  GONE from the 2026 form** (the temporary energy rate expired) — do not emit it for current periods.
- `27` = **Total cuota devengada** — sum of the devengado cuota columns. **[UNVERIFIED — confirm the
  exact box-list against DR303]** (the sede renders it as a computed field; do not hardcode the
  summation from this spec).

**IVA deducible** (produced by `computeInputVat`):
- `28/29` = base/cuota **por cuotas soportadas en operaciones interiores corrientes** ← `kind =
  corriente`. **The primary deli box.**
- `30/31` = base/cuota **interiores de bienes de inversión** ← `kind = inversion`.
- `32/33` importaciones corrientes, `34/35` importaciones inversión, `36/37` intracomunitarias
  corrientes, `38/39` intracomunitarias inversión — **out of scope for a deli** (a local deli buys
  domestically); named for completeness, not populated.
- ⚠ `40/41` = **Rectificación de deducciones** (base/cuota) — a later slice (corrective invoices).
  *(First draft omitted this row, which is what shifts the numbers below.)*
- `42` compensaciones REAGP, `43` regularización bienes de inversión, `44` **regularización por
  aplicación del porcentaje definitivo de prorrata** (last period of the year) — deferred (§9/§11).
- `45` = **Total a deducir** — sum of the deducible cuota columns (29+31+…+44). **[UNVERIFIED —
  confirm the exact box-list against DR303].**

**Resultado:**
- `46` = **Resultado régimen general = 27 − 45** (verified arithmetic).
- `64` suma de resultados; `65` % atribuible al Estado (a common-territory-only deli = 100);
  `66 = 64 × 65`; `68` regularización anual (last period only); `77`, `78`; `69 = 66 + 77 − 78 + 68 +
  108`; `71 = 69 − 70 + 109` (108/109 are the 2024 autoliquidación-rectificativa boxes). ⚠ **Casilla
  67** (which the first draft named for prior-period compensation) **could not be located on the
  current form** — two sources returned not-found; compensation now flows through `78`. **[UNVERIFIED
  — confirm against DR303].**

**Mandatory before coding any box number or summation:** pull the **DR303 "diseño de registro"
(Excel)** linked from the AEAT technical-help page (§13) — it is the machine-readable, in-force
primary source for the exact box layout, positions and lengths, and the same artefact the
file-submission path validates against. The casilla map slice's first task is to transcribe DR303,
not this spec.

---

## 8. The submittable / pre-filled 303 (D5)

There is **no REST submission API** (§13, quoted). **Chosen output (owner decision, 2026-08-16): the
raw DR303 fixed-layout file.** The pipeline:

1. **Produce the casilla-mapped aggregate first** (§7's `Modelo303` structure) — the reusable core the
   file writer consumes; it also delivers value on its own (an operator can read the boxes directly).
2. **Then the DR303 fixed-layout file writer (the chosen submittable output)** — a
   `Modelo303 → DR303 record` serializer (ISO-8859-1, fixed positions transcribed from the official
   DR303 Excel record-design), which a human uploads via the AEAT sede "por fichero" path. This is the
   literal "submittable file" and is Slice D.
3. **Not chosen as the primary, but tracked:** a `libro registro de facturas recibidas` → **Pre303**
   assisted-pre-fill export. Lower-risk (AEAT does the box arithmetic) and the libro registro is itself
   a legal obligation, so this remains a worthwhile LATER addition — but the owner chose the raw DR303
   file as the submittable output, so the file writer (2), not Pre303, is Slice D.

SII is **not** in scope (it is the large-filer real-time libros feed, not the 303, and a small deli is
not on SII).

---

## 9. Deducibility, recargo, prorrata — asesor-fiscal open questions (flagged, not decided)

These are **asesor-fiscal** calls (the labour advisor ≠ fiscal advisor distinction, memory). The
design provides seams; it does not answer them:

- **Recargo de equivalencia (D4).** Quoted (Manual 2025): a RE trader "*no estarán obligados a
  consignar estas cuotas repercutidas en una autoliquidación ni a ingresar el impuesto. Tampoco
  pueden deducir el IVA soportado en estas actividades.*" So RE activity is **off-303 and
  non-deductible**. The `regime` marker excludes RE invoices from the deducible aggregate. **Whether
  any of the deli's activities are RE is the asesor's call** — the code must not assume either way.
- **Prorrata.** When the business has mixed exempt/taxable activity, input VAT is only partially
  deductible; the year-end true-up is casilla 44. The `deducible_proportion` column is the seam
  (default 100 = fully deductible); the *rule that sets it* is asesor-driven and out of scope.
- **Per-category deductibility restrictions** (e.g. the general limits on certain expenses). Modelled
  via `deducible_proportion` per invoice for now; a finer per-category rule is deferred.
- **The duplicate-invoice key** (§4) — whether `(supplier_tax_id, supplier_invoice_number)` is unique
  per year or forever — confirm with the asesor.

---

## 10. Implementation slicing

The scope is large; build it as sound, reviewable slices (prioritise by soundness, not calendar):

- **Slice A — Purchase-invoice capture (the module).** `packages/db` tables + FORCE-RLS companion
  migration + `inmutabilidad` proof; `@waitron/purchasing` CRUD ops + `purchase.*` errors; real-PG
  RLS differential tests. No reporting yet. Delivers the libro-registro data source.
- **Slice B — `computeInputVat` + extended `computeVatReturn` (net).** Read-only over Slice A's
  tables; the per-rate + kind deducible aggregate, bucketed by `received_on`; the net result; a
  difference-method exactness test; a `demo:modelo-303` extension reconciling devengado − deducible.
- **Slice C — The casilla map.** Transcribe DR303 (Excel) → a `Modelo303` structure mapping the
  aggregates onto the in-force boxes (§7), with the box numbers/summations taken from DR303, not this
  spec. Unit-tested against a worked example.
- **Slice D — Submittable output = the raw DR303 file** (owner decision, 2026-08-16). A
  `Modelo303 → DR303 record` serializer (ISO-8859-1, fixed positions transcribed from the official
  DR303 record-design), validated against that record-design; a human uploads it via the AEAT sede
  "por fichero" path. (A libro-registro/Pre303 export is a possible LATER addition, not this slice.)
- **Later:** rectificación de facturas recibidas (40/41), bienes de inversión regularización (43),
  prorrata definitiva (44), quarterly/annual periods, the 4-year carry-forward + compensation boxes,
  a purchase-invoice authoring UI (dashboard), and OCR/supplier-feed capture. Each its own slice.

A management-dashboard **UI** for entering purchase invoices is a parallel track (like the catalogue
UI to catalogue): the module is headless first.

---

## 11. Scope out / deferred (this design)

Intra-community / import VAT boxes (32–39), inversión del sujeto pasivo on the input side,
rectificación de deducciones (40/41) beyond the schema seam, bienes-de-inversión regularización (43),
prorrata (44) beyond the `deducible_proportion` seam, recargo de equivalencia *output* boxes,
quarterly/annual aggregation, the 4-year deduction window + excess-compensation boxes (78), SII, and
non-ES tax regimes (the `nodes.tax_module` seam remains the future home).

---

## 12. Testing strategy

- **Real Postgres (Testcontainers, `TESTCONTAINERS_RYUK_DISABLED=true`)** for the new tables' RLS:
  cross-tenant isolation + the `app_user` grant, proven by deletion, under FORCE RLS — and the
  `fiscal-verifactu` `inmutabilidad` guard must pass (both new tables have ENABLE + FORCE, or it goes
  red). PGlite for the pure aggregate/mapping logic (state why in a comment).
- **Difference-method exactness** for `computeInputVat` (sum filed cuotas, never re-round).
- **The casilla map** unit-tested against a worked 303 example, with the box numbers sourced from
  DR303.
- Coverage thresholds `98/98/98/95` for the new headless packages.

---

## 13. Provenance (external sources — every fiscal claim)

| Claim | Source (quoted in the research; URLs) |
|---|---|
| Modelo 303 approving order; trimestral vs mensual periods | Orden EHA/3786/2008 consolidated — boe.es/buscar/act.php?id=BOE-A-2008-20953 ("Se aprueba el modelo 303…"; Art 1.2 period split) |
| Current Anexo I in force 2026; anticipos | Orden HAC/27/2026 — boe.es/buscar/doc.php?id=BOE-A-2026-1761 |
| Autoliquidación rectificativa boxes (108/109) from Sept 2024 | Orden HAC/819/2024 — boe.es/buscar/doc.php?id=BOE-A-2024-16129 |
| Devengado rate rows 01–09; 0% at 150/151/152; 5% at 153/155 gone in 2026 | AEAT Instrucciones 2026 / 2024 — sede.agenciatributaria.gob.es …/modelo-303-iva-autoliquidacion_/instrucciones-2026.html (verbatim per-row quotes) |
| Deducible rows 28/29 corrientes, 30/31 bienes de inversión, **40/41 rectificación**, 42 REAGP, 43/44 regularización; 45 total a deducir; 46 = 27 − 45 | AEAT Instrucciones 2026/2025 (verbatim "28 a 39…", "40/41 rectificadas", "44 prorrata"); getquipu corroborating labels |
| Result formulas 66 = 64×65, 69 = 66+77−78+68+108, 71 = 69−70+109; **casilla 67 not found on current form** | AEAT Instrucciones 2026 (verbatim) |
| No submission API; DR303 diseño de registro (ISO-8859-1) file upload; fields non-editable | AEAT technical help — sede…/presentacion-electronica-modelo-303-fichero.html ("El fichero…deberá cumplir con las especificaciones del diseño de registro publicado…") |
| Pre303 assisted pre-fill from libros / SII import | AEAT — sede…/iva/pre-303.html ("Servicio de ayuda a la cumplimentación…", "Importación de libros en soporte electrónico") |
| Input VAT deductible in the reception period; 4-year window; excess carry-forward | Manual Práctico IVA 2025 (PDF) — sede…/Manual_IVA_2025.pdf ("…se deducirá en el período…en el que se reciba la factura…", "…caduca en el plazo de 4 años…") |
| Recargo de equivalencia: RE traders don't file 303 and can't deduct input VAT; who it applies to; rates | Manual Práctico IVA 2025 ("…Tampoco pueden deducir el IVA soportado en estas actividades."; "…exclusivamente a los comerciantes minoristas…") |
| **[UNVERIFIED]** casilla 27 & 45 exact summation box-lists; casilla 67 status; full recargo output block; monthly-filing trigger list (Art 71.3 RIVA) | Not pinned to a primary source this session — **confirm against the DR303 Excel record design before coding.** |
