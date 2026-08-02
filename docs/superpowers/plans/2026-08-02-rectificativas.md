# Rectificativas (corrective invoices) — build-ready implementation spec

**Status:** ratified plan, ready to build. Called **"piece 2" in `docs/backlog.md`'s fiscal
sequence**; "piece 4" here follows the design doc's internal numbering
(`docs/superpowers/specs/2026-07-31-sale-settlement-model-design.md` §8, lines 431–474: order is
2 → 4 → 3; "touches the chain", must precede invoice-first) — same piece, two numbering schemes.

**Decisions ratified (2026-08-02, product owner):** R5 only (correct simplified tickets; R1/B2B and
R2–R4/accounting deferred); `TipoRectificativa` **derived as `I`** (por diferencias), not chosen;
**delta-in** correction-input model (the caller supplies the corrective's own signed lines/total);
refund **decoupled** (corrective recorded unsettled, refund is a separate payments action); the
caller passes a `purpose='rectificative'` `seriesId` (guarded, no auto-provisioning); guard against
correcting a **voided** sale and allow a sale to be corrected **more than once**
(`corrects_sale_id` not unique); include the `facturas_sustituidas` column **now** (unpopulated
until F3/piece 5). The appendix's open-decision list is thus settled — build to these.

**One-sentence summary.** A rectificativa is a *new* registro de alta whose `TipoFactura` is R1–R5
and which points at the invoice it corrects. It flows through the **same**
`recordSale → appendToChain → registros_facturacion` path as an ordinary sale — its own new number
from its own mandatory series, its own huella, its own chain position — plus four extra AEAT fields
and a generic-layer link to the original. It is **not** an anulación, and it does **not** go through
`settle-sale.ts` (the refund is a separate payments-layer action).

**The protocol layer is already done.** `packages/verifactu` fully types, builds, hashes, validates
and serialises rectificativas:

- `TipoFactura` includes `R1`–`R5` (`packages/verifactu/src/types.ts:2`).
- `IDFacturaAR` and `DesgloseRectificacion` types (`types.ts:74-89`); `RegistroAlta`/`AltaInput`
  carry `TipoRectificativa`, `FacturasRectificadas`, `FacturasSustituidas`, `ImporteRectificacion`
  (`types.ts:113-116`, `types.ts:226-232`).
- `buildAltaRecord` assembles all four (`packages/verifactu/src/records.ts:52-70, 100-118`).
- AEAT rules **1114** (TipoRectificativa mandatory iff R1–R5) and **1118** (ImporteRectificacion
  mandatory when `S`) are implemented and tested
  (`packages/verifactu/src/validate.ts:26-31, 215-241`).
- The XML serialiser emits every field
  (`packages/verifactu/src/xml/serialize.ts:113-155, 170-174`).
- The huella hashes only the 8 alta fields, `TipoFactura` among them, **none** of the four
  rectificativa fields (`packages/verifactu/src/huella.ts:45-58`; the invariant is pinned by
  `records.test.ts:243-254` — building with/without those fields yields an identical huella).

Everything this spec adds is the wiring **above** that library.

---

## 1. Scope & non-goals

### In scope
- Issuing a **rectificativa por diferencias (`TipoRectificativa` = `I`)** for a previously recorded
  **simplified** sale, `TipoFactura` **R5**, with a negative `ImporteTotal`
  (`docs/compliance/verifactu-findings.md:624-625` — the sourced recipe: *"Rectifying a simplified
  invoice … is `TipoFactura` R5 with `TipoRectificativa` I (por diferencias) and a negative
  `ImporteTotal`"*).
- The full write path for it: schema link + AEAT columns, backend assembly, chain append, core
  entry point, the mandatory separate series, and — critically — round-tripping the four AEAT
  fields through storage so the drainer submits them (§3.2 below).

### Reachability — which of R1–R5 v1 actually reaches
Only **R5** is reachable today, and the receipt is in the code:

- The till only ever issues `F2` (simplified). `backend.ts:257` emits
  `sale.counterparty === null ? "F2" : "F1"`, and `record-sale.ts:316` **always** passes
  `counterparty: null`. So `F1` is unreachable through the real write path, and the only invoice
  that exists to be corrected is a simplified `F2`.
- Rectifying an `F2` is **R5** (findings §10.2). Therefore **R5 is the only R-type v1 can reach.**

The others, for the record and for the "what unblocks them" note:

| R-type | What it rectifies | v1 status |
| --- | --- | --- |
| **R5** | a simplified invoice (`F2`) | **IN** — the only reachable case |
| **R1** | a full invoice (`F1`), ordinary error / art. 80.1/.2/.6 corrections | **DEFERRED** — unreachable until B2B/`F1` issuance lands (a future task wires a non-null `Counterparty`, `backend.ts:255-257`) |
| **R2** | art. 80.3 LIVA — concurso del destinatario (insolvency) | **DEFERRED** — accounting-driven, not a till action; needs tax-advisor input |
| **R3** | art. 80.4 LIVA — créditos incobrables (bad debt) | **DEFERRED** — as R2 |
| **R4** | "resto" — other full-invoice rectifications | **DEFERRED** — as R2, and blocked on `F1` |

> **Claim provenance (CLAUDE.md §1).** The R2/R3/R4 → art. 80.3/.4/resto mapping above is the
> well-known AEAT `L0` catalogue, but the repo's own compliance docs source art. 80 **only via a
> secondary summary, "NOT read at source"** (`verifactu-findings.md:732-734` and the Sources table
> at `:769`). Treat the R1–R4 legal mapping as **an assumption to be verified at BOE / with the
> asesor before any of them is built**, not a finding. Only R5 (findings §10.2, from AEAT worked
> examples) is sourced, and R5 is all v1 builds.

### `TipoRectificativa` — derived, not chosen
For the reachable case the value is fixed by the source: **`I` (por diferencias)**
(findings §10.2). The backend derives it; the generic layer never names it. `S` (sustitución) —
which additionally requires `ImporteRectificacion` (rule 1118, `validate.ts:235-241`) — is
**deferred** (open decision #2).

### Explicit non-goals
- **F3 canje is OUT.** A customer asking for a full invoice after a simplified one is a *factura de
  canje* `F3`, which AEAT states *«no tiene la consideración de rectificativa»*
  (`verifactu-findings.md:601-622`, sale-settlement design §8 lines 462-474). It is **piece 5**, its
  own spec. Do not fold it in. (The `facturas_sustituidas` column added in §2.2 exists for it but is
  **not populated** by this work — see §2.2.)
- **Anulación is not the correction path.** A meal that was really served cannot be annulled
  (`verifactu-findings.md:512-515`, findings §7: *«… no pueden anularse»*). Correcting a real sale
  is a rectificativa. The existing `recordVoid`/anulación path (`packages/core/src/record-void.ts`)
  stays as-is for the narrow "should never have existed" case; this spec adds a *parallel* path, it
  does not touch that one.
- **No refund handling.** Payment is separate. The corrective invoice is recorded unsettled; the
  customer refund is a later payments-layer action (the `tenders_amount_ck` `amount > 0` constraint,
  `sales.ts:181`, forbids a negative tender anyway).
- **No backfill / BWC.** Pre-production (CLAUDE.md §3): schema drops and recreates; all new columns
  are nullable with no backfill, exactly as `0009_registro_entorno` did.

---

## 2. Schema changes

Two new migrations, one per package. They are in **different** packages, so they serialise only
against their own journal, not against each other. **Verified journal heads:** `packages/db` is at
`0012_sale_settlement` (next = **0013**), `packages/fiscal-verifactu` is at `0009_registro_entorno`
(next = **0010**).

### 2.1 `packages/db` — migration `0013`: the generic-layer link + negative-total allowance

**`packages/db/src/schema/sales.ts`** — add a nullable self-referential link and relax the total
check:

- **New column** `correctsSaleId: uuid("corrects_sale_id")` — **nullable**. A corrective sale points
  at the sale it corrects; an ordinary sale leaves it `NULL`. This is the generic-layer projection
  of "this sale corrects that one", justified exactly as `sale_voids` and `fiscal_state`/
  `fiscal_backend` are (`sales.ts:59-64`, and the schema comment at `sales.ts:59` already
  anticipates it: *"a rectificativa inherits the original list"*). Core reads nothing fiscal from
  it; it exists so a Z-report/receipt/till can answer "is this a correction, and of what?" with no
  cross-boundary join.
- **Composite tenant-consistent FK** `(tenant_id, corrects_sale_id) → sales(tenant_id, id)`,
  `onDelete: "restrict"`, mirroring `sale_lines_sale_fk`/`tenders_sale_fk` (`sales.ts:132-146`).
  Under the default `MATCH SIMPLE`, a `NULL` `corrects_sale_id` satisfies the FK, so ordinary sales
  are unaffected; the target unique index `sales_tenant_id_key` already exists (`sales.ts:107`).
- **NOT unique** — a sale may be corrected more than once (successive rectificativas), unlike
  `sale_voids_sale_id_key` (`sale-voids.ts:53`) which is one-void-per-sale. Add
  `index("sales_corrects_idx").on(t.tenantId, t.correctsSaleId)` for the lookup.
- **Relax `sales_total_ck`.** Today it is `total >= 0` (`sales.ts:110`), but a rectificativa por
  diferencias carries a **negative** total (findings §10.2). Change it to:
  ```
  check("sales_total_ck", sql`${t.total} >= 0 OR ${t.correctsSaleId} IS NOT NULL`)
  ```
  A corrective sale (link set) may be negative; an ordinary sale may not. **This is load-bearing:**
  `record-sale.ts:310` passes `total: decimal(input.total)` straight into
  `SaleForFiscalRecord.total`, which the backend uses verbatim as `ImporteTotal` (`backend.ts:261`),
  which the huella hashes — so `sales.total` must be allowed to be the negative value the fiscal
  record needs.

`sale_lines` needs **no change**: `sale_lines_quantity_ck` is `quantity <> 0` (allows negative,
`sales.ts:142`) and there is no sign check on `line_total`/`unit_price`, so negative delta lines are
already representable. `validate.ts`'s `AMOUNT_PATTERN` (`validate.ts:72`) allows a leading `-`.

**Immutability & RLS carry automatically.** `sales` already `REVOKE`s UPDATE/DELETE from `app_user`
and enforces RLS (`sales.ts:116` `.enableRLS()` + `packages/db`'s immutability migrations). The new
column is written once at insert and is table-level immutable with no extra DDL — the same reasoning
`0009_registro_entorno` relied on.

**Migration mechanism.** ADD COLUMN + composite FK + index + a CHECK swap are all drizzle-kit-
expressible; generate with `pnpm --filter @waitron/db drizzle:generate` (or the repo's script). If
the CHECK modification does not diff cleanly, hand-write the `ALTER TABLE … DROP CONSTRAINT … ADD
CONSTRAINT …` and keep `drizzle/meta/*_snapshot.json` in sync (the snapshot-accuracy note in
`0009_registro_entorno.sql` applies).

### 2.2 `packages/fiscal-verifactu` — migration `0010`: the four AEAT columns on `registros_facturacion`

**`packages/fiscal-verifactu/src/schema/registros.ts`** — add four columns beside `tipo_factura`
(`registros.ts:76`):

| Column | Drizzle | Notes |
| --- | --- | --- |
| `tipo_rectificativa` | `text("tipo_rectificativa")` | nullable; `'S'` \| `'I'`. NULL on ordinary alta and on anulación. |
| `facturas_rectificadas` | `jsonb("facturas_rectificadas")` | nullable; stores `RegistroAlta["FacturasRectificadas"]` = `{ IDFacturaRectificada: IDFacturaAR[] }`. |
| `facturas_sustituidas` | `jsonb("facturas_sustituidas")` | nullable; stores `RegistroAlta["FacturasSustituidas"]`. **Written only by F3/piece 5** — added here so the immutable table is not re-migrated then (open decision #7). |
| `importe_rectificacion` | `jsonb("importe_rectificacion")` | nullable; stores `DesgloseRectificacion`. Populated only when `tipo_rectificativa = 'S'`. |

**Why `jsonb`, and why that's safe.** These four are **not huella inputs** (`huella.ts:45-58` hashes
8 named fields; none of these). They are only ever re-serialised into XML (`serialize.ts:124-155`),
never digested — identical to `desglose`/`sistema_informatico`, whose own `jsonb` choice is
justified on exactly this ground (`registros.ts:27-44`). `jsonb` key-reordering is harmless because
the serialiser reads named fields, not positions. The amount strings inside
`importe_rectificacion`/`facturas_rectificadas` are stored **already formatted** by
`buildAltaRecord`/`formatIDFacturaAR` (`records.ts:53-70`) and read back verbatim, so a
`"123.10"` vs `"123.1"` difference cannot arise. (A field that *were* hashed would need `text` — see
`registros.ts:79-89` on `cuota_total`/`importe_total`.)

**Constraints.**
- **Required:** `check("registros_tipo_rectificativa_ck", sql`${t.tipoRectificativa} is null or
  ${t.tipoRectificativa} in ('S', 'I')`)` — mirrors `registros_entorno_ck` (`registros.ts:156-159`).
- **Recommended (defense-in-depth, given §5 unrepairability):** encode AEAT rule 1115 at the DB —
  `tipo_rectificativa is null or tipo_factura ~ '^R[1-5]$'` (a `tipo_rectificativa` may only sit on a
  rectificativa TipoFactura). Full rule-1114 enforcement (R ⇒ `tipo_rectificativa` present) stays at
  the app layer (`validate.ts:215-231`), because `tipo_factura` is nullable (anulación) and the
  cross-field NULL logic is awkward and duplicative.

**Immutability & RLS carry automatically**, and the receipt is `0009_registro_entorno`: it added a
column with only `ADD COLUMN` + `CHECK` and no privilege/trigger/policy DDL, because
`registros_facturacion`'s immutability is enforced table-wide by `0001_registros_inmutables.sql`
(`REVOKE ALL … ; GRANT SELECT, INSERT …`, the row/statement `reject_mutation` triggers, and the
tenant-isolation policy — all table-level, covering any column). Generate `0010` the same way (plain
`drizzle-kit generate`, keeping the snapshot accurate — the `0009` note on `--custom`-vs-plain on an
already-tracked table applies).

### 2.3 english-only guard — no additions needed
`packages/db` and `packages/core`/`packages/fiscal` are scanned (`english-only.ts:8-16`,
`GENERIC_PACKAGES`); `packages/verifactu`/`packages/fiscal-verifactu` are exempt (`:19`). The scanner
matches **whole tokens** (`:248-257`). `SPANISH_WORDS` contains `rectificativa`/`rectificativas`,
`tipo`, `factura`, `importe`, `cuota` (`:125-126, 204, 132, 134, 118`) — but **not** `rectificative`
(the committed series-purpose value, `series.ts:60`), `corrects`, `correction`, `rectifies`. So:
- The Spanish column names (`tipo_rectificativa`, `facturas_rectificadas`, …) live only in the
  **exempt** `packages/fiscal-verifactu` — fine.
- The generic-layer names must be English: `corrects_sale_id` (db), `recordCorrection` (core +
  fiscal interface). This is **why** §4 names them that way. The guard running green is the proof.

---

## 3. Backend + chain changes (`packages/fiscal-verifactu`)

### 3.1 `VerifactuBackend.recordCorrection` — assembling the R5 AltaInput

New method, structurally a hybrid of `recordSale` (`backend.ts:231-288`, AltaInput assembly) and
`recordVoid` (`backend.ts:327-403`, reading the original registro):

```
recordCorrection(tx, sale: SaleForFiscalRecord, correction: { correctsSaleId: SaleId }): Promise<FiscalRecordRef>
```

1. Read the **original** alta registro by `correction.correctsSaleId`, exactly as `recordVoid` does
   (`backend.ts:333-342` — `select … from registros_facturacion where sale_id = … and tipo_registro
   = 'alta'`). Throw `fiscal.sale_not_recorded` if absent (the code `recordVoid` already throws,
   `backend.ts:341`). This row yields the `IDFacturaAR` triple for `FacturasRectificadas` directly:
   `id_emisor_factura`, `num_serie_factura`, `fecha_expedicion_factura` — **no reconstruction of the
   emisor NIF or the original number is needed** (the same shortcut `recordVoid` uses for the anulada
   identity).
2. Derive the R-type from the original's `tipo_factura`: `F2 → R5` (v1's only case; assert/throw if
   the original is not `F2`, since R1 for `F1` is deferred — open decision #1). Set
   `TipoRectificativa: "I"` (findings §10.2; hardcoded like `S1`/`F2` are today, `backend.ts:244,257`,
   with a comment that `S` is the future option — open decision #2).
3. Build the `AltaInput` like `recordSale` (`backend.ts:235-265`): `NumSerieFactura` from the
   corrective's **own** new number (`formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber)`),
   `FechaExpedicionFactura`/`generadoEn` = the corrective's own `sale.issuedAt`, `Desglose` from
   `sale.vatBreakdown` (values negative), `CuotaTotal`/`ImporteTotal` from the (negative) sale
   totals. Add:
   - `TipoFactura: "R5"`,
   - `TipoRectificativa: "I"`,
   - `FacturasRectificadas: [{ IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura }]` built
     from the original registro row. `FechaExpedicionFactura` is an `IDFacturaARInput.Date`
     (`types.ts:195-199`) that `formatIDFacturaAR` re-renders with the corrective's own
     `offsetMinutes` (`records.ts:53-58`) — so reconstruct the original `date` string to a `Date`
     that re-renders the **exact** stored calendar day, using the algebraic offset-cancellation
     `recordVoid` already documents and proves (`backend.ts:353-380`:
     `Date.parse(`${stored}T00:00:00Z`) - offset*60_000`). **Do not** re-invent the noon-anchor
     approach that comment supersedes.
   - **No `FacturasSustituidas`, no `ImporteRectificacion`** (I mode; 1118 requires the latter only
     for `S`).
4. `appendToChain(tx, tenantId, tillId, { tipo: "alta", saleId: sale.saleId, entorno:
   deploymentEnvironment, input }, sif)` — **unchanged**. A rectificativa is an alta; it takes the
   next `secuencia` in generation order (`chain.ts:149-231`), its own huella over the 8 fields
   (`TipoFactura = R5` and the negative `ImporteTotal`/`CuotaTotal` flow in correctly), and the
   `PendingRegistro` "alta" arm already carries everything (`chain.ts:45-52`). No change to
   `chain.ts` at all.
5. Insert the `envios` sidecar as `pendiente` and return the `FiscalRecordRef`, identical to
   `recordSale` (`backend.ts:278-288`).

**`entorno` invariant preserved (§5).** `recordCorrection` passes `entorno` beside `input` in
`PendingRegistro`, never inside it (`chain.ts:32-52`), so our metadata still never reaches
`computeHuella`. Nothing here changes what is hashed.

### 3.2 The round-trip gap — `registro-row.ts` (**the one non-obvious, load-bearing change**)

The drainer submits a stored record to AEAT by rebuilding it from its columns:
`drain.ts:722-729` → `toEnvioRegistro` → `fromRegistroRow(row)` → `serializeEnvio`. **`fromRegistroRow`
does not currently rehydrate the four rectificativa fields** (`registro-row.ts:305-326` builds a
`RegistroAlta` with only `IDFactura`/`NombreRazonEmisor`/`TipoFactura`/`DescripcionOperacion`/
`Desglose`/`CuotaTotal`/`ImporteTotal`). So a rectificativa stored with `TipoFactura = R5` but no
rehydrated `TipoRectificativa` would be **serialised and filed to AEAT missing its mandatory
`TipoRectificativa`, and rejected with AEAT error 1114** (`validate.ts:26, 215-224`). This is the gap
the brief flagged as "absent above the library" made concrete, and it is the single most important
correctness item in this spec.

Three edits, all in `packages/fiscal-verifactu/src/registro-row.ts`:

- **`RegistroRow` type** (`:215-247`): add
  `tipo_rectificativa: string | null`,
  `facturas_rectificadas: RegistroAlta["FacturasRectificadas"] | null`,
  `facturas_sustituidas: RegistroAlta["FacturasSustituidas"] | null`,
  `importe_rectificacion: DesgloseRectificacion | null` (jsonb comes back as a parsed object, per the
  `RegistroRow` doc comment, `:200-204`).
- **`toRegistroRow`** (`:110-170`, alta branch `:138-151`): write
  `tipoRectificativa: record.TipoRectificativa ?? null`,
  `facturasRectificadas: record.FacturasRectificadas ?? null`,
  `facturasSustituidas: record.FacturasSustituidas ?? null`,
  `importeRectificacion: record.ImporteRectificacion ?? null`. The anulación branch (`:154-169`)
  sets all four `null`.
- **`fromRegistroRow`** (`:263-327`, alta branch `:305-326`): conditionally spread the four back on
  (matching `buildAltaRecord`'s own conditional-spread shape, `records.ts:101-118`), e.g.
  `...(row.tipo_rectificativa !== null && { TipoRectificativa: row.tipo_rectificativa }), …`.

**Why this is safe for verification.** `verify.ts` recomputes the huella via `fromRegistroRow` →
`computeHuella`, which reads only the 8 hashed fields (`huella.ts:45-58`). Adding the four
non-hashed fields to the rehydrated record cannot change the recomputed huella —
`records.test.ts:243-254` already pins exactly this invariant. So closing the submission gap does not
touch chain verification.

No change to `huella.ts`, `records.ts`, `validate.ts`, `serialize.ts`, or `chain.ts` — the library
already does the right thing once the data reaches it.

---

## 4. Core entry point + fiscal interface

### 4.1 `packages/fiscal` — `FiscalBackend.recordCorrection` (interface)

Add one method to `FiscalBackend` (`packages/fiscal/src/backend.ts:205-255`):

```ts
/**
 * Records a corrective fiscal record (a credit-note / rectificativa) for a prior sale. Like
 * recordSale it takes the transaction — atomicity between the corrective sale and its fiscal
 * record is the point. `sale` is the corrective invoice's OWN data (its new number, its negative
 * total and breakdown); `correction.correctsSaleId` names the sale being corrected. The regime
 * maps this onto its own corrective mechanism (Veri*Factu: TipoFactura R5, TipoRectificativa I,
 * FacturasRectificadas). No fiscal condition blocks it (spec §4).
 */
recordCorrection(
  tx: Transaction,
  sale: SaleForFiscalRecord,
  correction: { correctsSaleId: SaleId },
): Promise<FiscalRecordRef>;
```

- Regime-neutral and English — no `TipoFactura`/R5/`S`/`I` leak into the generic interface, so the
  **no-regime-vocabulary guard** (`fiscal/src/backend.ts:186-204`, `./no-regime-vocabulary.test.ts`)
  and **english-only** both stay green. The Spanish/AEAT mapping is entirely inside the exempt
  `fiscal-verifactu` backend (§3.1).
- `SaleForFiscalRecord` is **reused unchanged** (`fiscal/src/backend.ts:48-63`) — the corrective's
  negative `total`/`vatBreakdown` fit its existing shape; no new interface field.
- The method has a real caller (§4.2) and a real fake, so it is not the "dead interface surface" the
  interface doc warns against (`fiscal/src/backend.ts:196-204`).
- **`FakeFiscalBackend`** (`packages/fiscal/src/testing/fake-backend.ts`) must implement it too,
  mirroring its `recordVoid`.

### 4.2 `packages/core` — `recordCorrection` (entry point)

New file `packages/core/src/record-correction.ts`, structurally mirroring
`record-void.ts` (`packages/core/src/record-void.ts:30-133`) and `record-sale.ts`:

```ts
interface RecordCorrectionInput {
  tenantId; tillId;
  seriesId;                 // MUST be a purpose='rectificative' series (§5)
  correctsSaleId: SaleId;   // the sale being corrected
  locale; invoiceLocales;   // snapshotted; the spec §9 rule that "a rectificativa inherits the
                            // original list" — read from the original sale (sales.ts:59)
  total: string;            // the corrective's own (negative) total
  lines: RecordSaleLine[];  // the delta lines (negative); see open decision #3
  fiscalBackend: string;
  clock: TrustedClock;
}
async function recordCorrection(tx, backend: FiscalBackend, input): Promise<{ saleId; fiscal }>;
```

Steps (mirroring `record-sale.ts` / `record-void.ts`):
1. Look up the **original** sale (`sales`, RLS-scoped); throw `sale.not_found` if absent
   (reuse the existing code, `record-void.ts:41-48`).
2. Look up the **corrective series** and enforce its purpose (§5): `select { code, tillId, purpose }`
   and throw `sale.series_wrong_purpose` unless `purpose === 'rectificative'` and `sale.series_wrong_till`
   as `record-sale.ts:167-184` already does.
3. `checkIntegrity` → **never block**, aggregate issues into one `chain.verification_failed`
   incident, proceed (identical to `record-sale.ts:138-165` / `record-void.ts:59-84`). A staff
   member correcting a sale must never be blocked by an incident about it.
4. One clock reading for the whole transaction (`record-sale.ts:198`).
5. `allocateInvoiceNumber(tx, input.seriesId)` from the corrective series (`allocate-number.ts` —
   works unchanged for any series).
6. Insert the corrective **sale** row: negative `total` (allowed by the relaxed CHECK, §2.1),
   `correctsSaleId: input.correctsSaleId`, `fiscalState: "recorded"`, `locale`/`invoiceLocales`
   inherited from the original. **No settlement, no tenders** (deferred/unsettled — the refund is a
   separate payments action). Then insert the (negative) `sale_lines`.
7. `backend.recordCorrection(tx, saleForFiscalRecord, { correctsSaleId })`, where
   `saleForFiscalRecord` is built exactly as `record-sale.ts:300-317` (with `counterparty: null`).
8. Return `{ saleId, fiscal }` inside the transaction (step 7 is the caller's commit,
   `record-sale.ts:319-322`).

**Also guard the ordinary path:** `record-sale.ts` must **reject** a `rectificative` series (a normal
sale must not draw a corrective number). Extend its series select to include `purpose`
(`record-sale.ts:167-170`) and throw `sale.series_wrong_purpose` unless `purpose === 'standard'`.

### 4.3 New / reused error codes (domain-named — CLAUDE.md §3)

Register in the **existing** `declare module "@waitron/shared"` blocks, never in
`packages/shared` itself (the convention every package follows, `core/src/errors.ts:16-58`):

- **New** `sale.series_wrong_purpose: { seriesId: string; expected: string; actual: string }` — in
  `packages/core/src/errors.ts` beside the other `sale.*` codes (`core/src/errors.ts:98-146`).
  Domain concept "this series is not the right kind for this operation"; models RD 1619/2012 art.
  6.1.a) "rectificativas need their own series, en todo caso" (`verifactu-findings.md:577-599`).
  Thrown by both `recordCorrection` (standard series supplied) and `recordSale` (rectificative
  series supplied). Grep the `sale.*` siblings first (`series.not_found`, `series_wrong_till`) — this
  matches their shape (CLAUDE.md §3: "grep the siblings").
- **Reused** `sale.not_found` (`core/src/errors.ts:115-121`) — original sale absent.
- **Reused** `fiscal.sale_not_recorded` — original has no alta registro (thrown by the backend,
  `backend.ts:341`; already registered).
- **(Recommended)** reject correcting an already-voided sale — reuse `sale.voided`
  (`core/src/errors.ts:140-146`) or add `sale.corrected_target_voided`. Minor; open decision #6.

`errors.reachability.test.ts` in each touched package must stay green (the new `record-correction.ts`
carries the same `import "./errors.js";` side-effect import as its siblings, `record-void.ts:5`).

---

## 5. The mandatory separate rectificativa series

**Already supported by the N-series-per-till model — no new mechanism.** A till owns N series and one
chain (`series.ts:5-23`); `invoice_series.purpose` already carries a
`check … in ('standard', 'rectificative')` constraint (`series.ts:48, 60`) put there for exactly
this. RD 1619/2012 art. 6.1.a) makes a separate rectificativa series obligatory *«en todo caso»*, and
Q5(b) is closed (`verifactu-findings.md:577-599`; sale-settlement design §8 lines 455-460).

So:
- A rectificativa draws its number from a series **row whose `purpose = 'rectificative'`**, via the
  same `allocateInvoiceNumber` + `seriesId`-passed-by-caller mechanism ordinary sales use today —
  nothing new in the allocator or the schema.
- The **purpose guard** (§4.2 step 2 and the `recordSale` addition) is what enforces the separation:
  a correction must use a `rectificative` series, an ordinary sale must use a `standard` one. The
  guard is the whole enforcement — the numbering itself is series-scoped and strictly increasing
  already (`allocate-number.ts:21-66`).
- **Series provisioning is out of scope** (no series is auto-created for *any* purpose yet — series
  rows exist only in tests today). The caller supplies the `rectificative` `seriesId`, exactly as it
  supplies the `standard` one for `recordSale`. Whether provisioning should mint a paired
  `rectificative` series per till is series-provisioning work — open decision #5.

---

## 6. Test strategy (CLAUDE.md §4)

**Target selection.** Anything touching RLS, the immutable-column REVOKE/trigger backstop, the
deployment role, or chain concurrency → **real Postgres via Testcontainers** (remember
`TESTCONTAINERS_RYUK_DISABLED=true` locally). Pure flatten/rehydrate and assembly logic → **PGlite**.
State the choice per suite.

Per slice:

- **Schema (§2), real PG:**
  - **Prove-by-deletion** the relaxed `sales_total_ck`: with the `OR corrects_sale_id IS NOT NULL`
    clause, a corrective sale (negative total, link set) inserts and an ordinary negative sale is
    rejected; **remove the clause → the corrective insert now fails** (guard proven). Negative
    control: an ordinary negative sale fails either way.
  - New columns are **immutable**: `UPDATE registros_facturacion SET tipo_rectificativa = …` is
    rejected with `WT001` (the table-level trigger, `0001_registros_inmutables.sql`) — confirms the
    backstop covers the new columns, no new DDL.
  - **Prove-by-deletion** `registros_tipo_rectificativa_ck`: an insert with
    `tipo_rectificativa = 'X'` is rejected; remove the check → it succeeds.
  - RLS still scopes `sales`/`registros_facturacion` after the column adds (a cross-tenant read sees
    nothing) — real PG as the non-superuser role (PGlite is always superuser, `harness` note, and
    would be a false pass here).
- **Round-trip (§3.2), PGlite (pure) + one real-PG e2e:**
  - PGlite: build an R5 `RegistroAlta` (TipoRectificativa I, FacturasRectificadas, negative totals)
    → `toRegistroRow` → insert → `select *` → `fromRegistroRow` → deep-equals the built record
    **including the four fields**. **Prove-by-deletion:** drop the `FacturasRectificadas` rehydration
    from `fromRegistroRow` → the round-trip test fails.
  - **Real-PG e2e (the gap-closing test):** after `recordCorrection` writes the corrective registro,
    `toEnvioRegistro(row)` / `serializeEnvio` produces XML containing `<sf:TipoRectificativa>I</…>`
    and `<sf:FacturasRectificadas>` — proving the drainer would file the mandatory fields (real PG
    because it exercises `appendToChain` under the deployment role + RLS, like
    `write-path.e2e.test.ts`).
- **Backend (§3.1), real-PG e2e** (`recordCorrection` end-to-end): the corrective is an alta at the
  next `secuencia`, its huella hashes the negative `ImporteTotal`, `FacturasRectificadas` carries the
  **original's** exact stored identity, `envios` row is `pendiente`. A concurrency test (two
  corrections racing on one till's chain/series) confirms the existing
  `unique(tenant, till, secuencia)` + append-retry (`chain.ts:139, 261-275`) still holds — real PG
  (PGlite serialises onto one backend and is a false pass for contention, §4).
- **Core (§4.2), PGlite for logic + real-PG for RLS-scoped guards:** `sale.series_wrong_purpose`
  fires for a `standard` series into `recordCorrection` and a `rectificative` series into
  `recordSale`; `sale.not_found`/`fiscal.sale_not_recorded` for missing originals; the corrective
  sale is unsettled; `corrects_sale_id` links correctly. The cross-tenant "hidden series/sale reads
  as not-found" cases want real PG (RLS).
- **Guard suites that apply (run unfiltered — a name-filtered run skips cross-cutting guards, §4):**
  - `english-only` (root Vitest project) — the new English generic-layer names pass; running it green
    **is** the naming proof.
  - `schema-ownership` in both `packages/db` and `packages/fiscal-verifactu` — new columns/tables
    pass ownership assertions.
  - `errors.reachability.test.ts` in every package whose `errors.ts` gains a code.
  - `guarded-teardowns.test.ts` — any new suite uses `usePgliteDb`/`useRealPostgres`
    (`@waitron/db/testing/lifecycle`), never a raw `beforeAll`/`afterAll` pair, so teardown is
    guarded by construction.
  - `no-regime-vocabulary.test.ts` (`packages/fiscal`) — `recordCorrection`'s regime-neutral naming
    passes.
- **CI reminder (CLAUDE.md §2):** run `pnpm --filter <pkg> test:coverage` (not plain `test`) per
  touched package before claiming green; coverage thresholds are 98/98/98/95 everywhere except
  `packages/ui`.

---

## 7. Phasing — independently reviewable, subagent-friendly slices

Migrations land **first and isolated** so each journal advances once; the code slices are journal-
free and stack on top.

- **Slice 1 — Schema + migrations (lands first).** `packages/db` `0013` (§2.1) and
  `packages/fiscal-verifactu` `0010` (§2.2) + the `schema/*.ts` edits + schema tests (§6 first
  bullet). This is the only slice that touches a journal. *May be split into two parallel PRs* (one
  per package — different journals, no contention) if reviewers prefer; otherwise one "schema" PR.
- **Slice 2 — Round-trip the AEAT fields (`fiscal-verifactu`, code-only).** `RegistroRow` +
  `toRegistroRow` + `fromRegistroRow` (§3.2) + the round-trip PGlite test + the drain-serialisation
  real-PG e2e that proves the submission gap is closed. Depends on Slice 1.
- **Slice 3 — Fiscal interface + backend + fake.** `FiscalBackend.recordCorrection` (§4.1),
  `VerifactuBackend.recordCorrection` (§3.1), `FakeFiscalBackend.recordCorrection`, the
  `fiscal-verifactu`/`core` error registrations reachable, `backend.test.ts` + the `recordCorrection`
  real-PG e2e. Depends on Slice 2.
- **Slice 4 — Core entry point + series-purpose guards.** `packages/core/src/record-correction.ts`
  (§4.2), `RecordCorrectionInput`, `sale.series_wrong_purpose` (§4.3), the `recordSale`
  reject-rectificative-series guard, core unit + e2e. Depends on Slice 3.

Update `docs/backlog.md` in the same change that lands each slice (CLAUDE.md §6). Piece 3
(invoice-first in the till) may begin once Slice 4 lands, since "the normal remedy for a disputed
bill is a rectificativa" then exists (sale-settlement design §8 line 443-445).

---

## Appendix — the genuinely open decisions (for the product owner)

These need a human's call; everything else is resolved above from the sources.

1. **R-type scope for v1.** Recommend **R5 only** — it is the only type reachable while the till
   issues only `F2` (`backend.ts:257`, `record-sale.ts:316`) and the only one the repo sources
   (findings §10.2). R1 waits on B2B/`F1`; R2/R3/R4 are art.-80 accounting cases whose legal mapping
   is unverified here (findings §12, Sources `:769`) and need the asesor.
2. **`S` vs `I`.** Recommend **derive `I`** (findings §10.2 — R5+I). Add `S` (sustitución, needs
   `ImporteRectificacion`, rule 1118) only if the product needs "restate the full corrected invoice"
   semantics — a separate, later increment.
3. **Correction-input model.** Recommend **delta-in** for v1 (the caller supplies the corrective's
   own already-signed lines/total; the till/UI computes what changed), because it keeps
   `recordCorrection` parallel to `recordSale` and puts no diff arithmetic in core. Alternative:
   corrected-state-in (core reads the original `sale_lines` and computes the difference) — cleaner
   for staff but more logic. Decision affects the `RecordCorrectionInput.lines` semantics only.
4. **Refund coupling.** Recommend **decoupled** — the corrective invoice is recorded unsettled; the
   customer refund is a separate payments-layer action (the `tenders_amount_ck amount > 0` constraint
   forbids a negative tender anyway). Confirm this is acceptable vs wanting refund atomic with the
   correction.
5. **Rectificative-series provisioning.** v1 has the caller pass a `purpose='rectificative'`
   `seriesId` (guarded). Confirm that's acceptable, vs wanting provisioning to auto-mint a paired
   rectificative series per till (series-provisioning is unbuilt for any purpose today).
6. **(minor) Correcting a voided sale / multiple corrections.** Recommend guarding "cannot correct a
   voided sale" (reuse `sale.voided`) and allowing a sale to be corrected more than once
   (`corrects_sale_id` not unique). Confirm.
7. **(minor) `facturas_sustituidas` column now or later.** Recommend **now** (one migration on the
   immutable table; column unpopulated until F3/piece 5) vs deferring to avoid speculative surface.
   Confirm.
