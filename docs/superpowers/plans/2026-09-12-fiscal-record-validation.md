# Checking a fiscal record before it is written — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Veri\*Factu record validator actually run, so a record AEAT could not accept is refused before it enters the append-only table, and refuse the same values at the setup boundary where an operator can still fix them.

**Architecture:** Three layers. `attemptAppend` (`packages/fiscal-verifactu/src/chain.ts`) validates the built record immediately before inserting it — one seam covering sale, void, correction and substitution. A new seat on `FiscalContribution` lets `apps/server/src/setup-api.ts` check the operator's venue fields without importing a regime package, which the module-seams guard forbids. The wizard marks the field the server names and sends the operator back to it.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL / PGlite, Vitest (browser mode via real headless Chromium for the `apps/setup` task), Lit for the wizard.

**Spec:** `docs/superpowers/specs/2026-09-12-fiscal-record-validation-design.md`

**This plan was reviewed against the code before execution**, and the review found that the change turns much of the existing suite red for a reason nobody had noticed. Task 1 step 5 is that finding; read it before starting Task 1.

## Global Constraints

- **Error params never carry an operator's value.** The shared error boundary writes an `AppError`'s params into `waitron.log`, which the unauthenticated recovery page renders to anyone on the venue's LAN. Field NAMES and issue CODES only (CLAUDE.md §3).
- **Error codes name the domain concept, never the throwing package**, are lowercase and dot-namespaced, and are never renamed once shipped (`packages/shared/src/errors.ts`'s design note).
- **Every file that throws a code imports its registry** — `import "./errors.js"` as a bare side-effect import.
- **No file under `apps/server/src` may import `@waitron/verifactu` or `@waitron/fiscal-verifactu`.** `scripts/module-seams.test.ts` pins that allowlist as EMPTY; it may shrink, never grow. This is why Task 3 exists.
- **A new code is registered by declaration merging** in the throwing package's own `errors.ts` (`declare module "@waitron/shared"`), never by editing `packages/shared`.
- **Never rewrite a test to match new code.** If a test goes red, work out which of the two is wrong. Task 1 step 5 is a case where the FIXTURE is wrong; it is the only one this plan sanctions, and it says why.
- **Every commit is `git commit -s`** — CI's `dco` job walks the whole PR range.
- **Per-task verification is the changed package's `test:coverage` plus `pnpm lint`, `pnpm typecheck` and `pnpm format:check`** — not the whole workspace. `packages/fiscal-verifactu` and `packages/core` sit at the high coverage bar (statements 98 / lines 98 / functions 98 / branches 95); `apps/server` and `apps/setup` at the 90/90/85/85 floor.
- **Before the browser-mode task (Task 5), check what else is testing on this machine** (`memory_pressure | grep free`, `ps -axo rss,command | sort -nr | head`) — the four browser packages run real headless Chromium.

---

### Task 1: Refuse an invalid record at the chain seam

**Files:**
- Modify: `packages/fiscal-verifactu/src/errors.ts` (add the `fiscal.record_invalid` declaration)
- Modify: `packages/fiscal-verifactu/src/chain.ts` — the `@waitron/verifactu` value import (line 12), and the check immediately after `const record = …` (line 213)
- Modify: `packages/fiscal-verifactu/src/testing/seed.ts` — `altaFor` (step 5)
- Test: `packages/fiscal-verifactu/src/chain.record-validation.test.ts` (create)

**Interfaces:**
- Consumes: `validate`, `ValidationIssue` from `@waitron/verifactu` (exported from its barrel, `index.ts:12` and `:27`).
- Produces: the error code `fiscal.record_invalid` with params `{ fields: string[]; codes: string[] }`. Task 2 adds a second behaviour at the same seam and relies on the `validate(record)` call sitting after the record is built.

- [ ] **Step 1: Write the failing test**

Create `packages/fiscal-verifactu/src/chain.record-validation.test.ts`. The harness below is the one `packages/fiscal-verifactu/src/write-path.e2e.test.ts` uses — open that file first and follow it rather than inventing a variation.

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { asAppUser, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";
import { anulacionFor } from "./testing/seed.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// PGlite, deliberately (CLAUDE.md §4): every case here asserts a refusal decided in application
// code before the insert. Nothing tested depends on grants being enforced or on two writers
// racing, which are the two properties PGlite cannot show.
let backend: VerifactuBackend;
let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** Point the seeded series at a code AEAT's character set forbids. A space is the shape an
 * operator actually types ("Serie A"), and it is what reached `registros_facturacion` before this
 * guard existed. */
async function useSeriesCode(code: string): Promise<void> {
  await pg.db.execute(sql`update invoice_series set code = ${code} where id = ${seriesId}`);
}

function sell() {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId }));
  });
}

describe("a record AEAT could not accept never enters the chain", () => {
  it("refuses a sale whose invoice number uses a forbidden character", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFactura"], codes: ["NUMSERIE_CHARSET"] },
    });
  });

  it("writes nothing at all when it refuses", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({ code: "fiscal.record_invalid" });

    const registros = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registros).toEqual([]);

    // The sale itself must be gone too — `recordSale` writes the sale and the fiscal record in ONE
    // transaction, so a refusal that left a sale behind would be a sale with no fiscal record.
    const soldRows = await pg.db.select().from(sales).where(eq(sales.tenantId, tenantId));
    expect(soldRows).toEqual([]);

    // And the chain head must not have advanced: a refused record leaves the node exactly where it
    // was, so the next legitimate sale is still the chain's first record.
    const heads = await pg.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where tenant_id = ${tenantId} and node_id = ${nodeId}`,
    );
    expect(heads.rows[0]?.secuencia ?? 0).toBe(0);
  });

  it("accepts the same sale once the series code is legal", async () => {
    await useSeriesCode("FS");
    const { saleId } = await sell();
    expect(saleId).toBeDefined();

    const [registro] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registro?.numSerieFactura).toBe("FS/1");
  });

  // The anulación arm reaches `validate` through the SAME `const record =` line as every alta, but
  // "the same line" is an argument, not evidence, so it gets its own case. It cannot be provoked
  // through `recordVoid`: that rebuilds its identity from the original alta's stored columns
  // (backend.ts), and after this guard exists the original is always valid. So the record is
  // appended directly, which is also the only way to reach the anulación branch with a bad value.
  it("refuses an anulación whose voided invoice number is illegal", async () => {
    const bad = anulacionFor(tillId, "00000000-0000-4000-8000-000000000001", 1);
    const registro = {
      ...bad,
      input: { ...bad.input, NumSerieFacturaAnulada: "Serie A/1" },
    };

    await expect(
      withTenant(pg.db, tenantId, (tx) => appendToChain(tx, tenantId, nodeId, registro)),
    ).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFacturaAnulada"] },
    });
  });
});
```

`anulacionFor`'s parameter list is `(tillId, saleId, invoiceNumber, …)` — open `packages/fiscal-verifactu/src/testing/seed.ts` and pass exactly what it declares, including any argument that feeds `generadoEn` (a missing one produces `Invalid date supplied` from `formatDateTime`, which is a fixture mistake and not a finding).

The R5 (correction) and F3 (substitution) arms are deliberately not given their own refusal cases: all three alta-shaped arms build their record through the one `const record = registro.tipo === "alta" ? buildAltaRecord(…)` expression, so a case per arm would re-test the same line. What differs between them — which `TipoFactura` and which extra fields each carries — is covered by `correction-path.e2e.test.ts` and `canje-path.e2e.test.ts`, which must stay green.

- [ ] **Step 2: Run it and watch the right cases fail**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.record-validation.test.ts`

Expected: cases 1, 2 and 4 FAIL (the sale resolves instead of rejecting; `registros_facturacion` holds a row with `num_serie_factura = "Serie A/1"`; the anulación appends happily). Case 3 passes already. That contrast reproduces the defect before fixing it.

- [ ] **Step 3: Register the error code**

In `packages/fiscal-verifactu/src/errors.ts`, inside the existing `declare module "@waitron/shared" { interface ErrorParams { … } }` block, beside `"chain.append_contention"`:

```ts
    /**
     * `attemptAppend` (./chain.ts) refused a record that `@waitron/verifactu`'s `validate` reports
     * as one AEAT could not accept — a forbidden character in the invoice number, a control
     * character in a free-text field, an out-of-range amount. Raised BEFORE the insert, so nothing
     * is written and the chain head does not move: `registros_facturacion` is append-only and
     * hash-chained, and a value written wrong there stays wrong (CLAUDE.md §5), so refusing a
     * record is the only remedy that leaves the venue repairable.
     *
     * `fiscal.*` and English, not `verifactu.*` and not Spanish: this names OUR local refusal, not
     * an AEAT wire state. The sibling distinction the registry already draws is
     * `fiscal.sale_not_recorded` (ours) beside `fiscal.registro_rechazado` (AEAT's answer).
     *
     * Params carry the offending FIELD NAMES and the validator's own ISSUE CODES — never the
     * offending values. The shared error boundary writes params into `waitron.log`, which the
     * unauthenticated recovery page renders to anyone on the venue's LAN
     * (`apps/server/src/recovery-surface.ts`), so an operator's data must never travel here.
     * Both arrays, because one record can breach several rules at once and a human fixing the
     * venue wants all of them, not the first.
     */
    "fiscal.record_invalid": { fields: string[]; codes: string[] };
```

- [ ] **Step 4: Add the check at the seam**

In `packages/fiscal-verifactu/src/chain.ts`, extend the existing `@waitron/verifactu` value import (line 12):

```ts
import { buildAltaRecord, buildAnulacionRecord, validate } from "@waitron/verifactu";
```

Then, immediately after the `const record = …` assignment and before `const row = toRegistroRow(…)`:

```ts
  // Refuse a record AEAT could not accept BEFORE it reaches the append-only table. This is the one
  // seam every record type passes through (alta and anulación, so sale, void, correction and
  // substitution alike), and the first moment the COMPLETE record exists — the chain pointer and
  // the huella are filled in above — so what is checked is what will be stored.
  //
  // Error severity only. `validate`'s two warnings are the amount cross-checks, which AEAT accepts
  // under its own ±10.00 tolerance (see validate.ts above CUOTA_TOTAL_MISMATCH); blocking a sale
  // for one would refuse a record the authority would have taken.
  const blocking = validate(record).filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    throw new AppError("fiscal.record_invalid", {
      fields: blocking.map((issue) => issue.field),
      codes: blocking.map((issue) => issue.code),
    });
  }
```

- [ ] **Step 5: Fix the shared test fixture the guard has just exposed**

**Read this whole step before running anything.** Turning the guard on makes much of this package's existing suite fail — **measured before the plan was written: 12 of 20 tests in `src/chain.test.ts` alone**. That is not the change breaking the suite. It is the guard finding that the shared alta fixture has been building records AEAT would reject, for as long as it has existed, because nothing validated.

`altaFor` in `packages/fiscal-verifactu/src/testing/seed.ts` produces two error-severity issues:

- `TipoImpositivo: "21"` — the validator requires exactly two decimal places (`TIPO_RANGE`). The real write path never produces this: it comes from `decimal(line.vatRate)`, which carries `"21.00"`.
- `TipoFactura: "F1"` with no `Destinatarios` — a full invoice must name its recipient (`DESTINATARIOS_REQUIRED`). The real till path emits `"F2"` for a simplified sale, which needs no recipient (`backend.ts`, the `counterparty === null` line).

So the fixture describes a record the production code cannot generate. Fix the fixture, do not weaken the guard and do not rewrite the tests that use it:

```ts
    TipoFactura: "F2",
```
```ts
        TipoImpositivo: "21.00",
```

Two consequences to expect, neither of which is a problem:

- **Every huella in those tests changes.** `TipoFactura` is one of the hashed fields (`packages/verifactu/src/huella.ts`). No test asserts a literal 64-character hash — they recompute and compare — so relational assertions survive. If one does assert a literal, that is a test to update with its new value, and the commit must say so.
- **`anulacionFor` needs no change.** `validate` returns early for an anulación before the alta-only rules, so the anulación fixture was always valid.

Nine test files use these fixtures (`chain.test.ts`, `chain.concurrency.test.ts`, `chain.node-rekey.concurrency.test.ts`, `chain.pglite-cannot-test-contention.test.ts`, `verify.test.ts`, `restore.test.ts`, `restore.pg.test.ts`, `replication-fidelity.pg.test.ts`, `write-path.e2e.test.ts`). Run the whole package after the fixture change, not one file.

If a test still fails after this fixture fix, STOP and report it rather than adjusting anything else. A second invalid fixture is a finding worth the owner seeing, not a thing to quietly patch.

- [ ] **Step 6: Run the package's whole suite**

Run: `pnpm --filter @waitron/fiscal-verifactu test:coverage`

Expected: PASS, including the four new cases. Note in the task report how many tests changed from red to green after step 5 — that number is the receipt for the fixture claim.

- [ ] **Step 7: Prove the guard by deletion**

Comment out the `if (blocking.length > 0) { … }` block and re-run `src/chain.record-validation.test.ts`. Expected: cases 1, 2 and 4 go RED naming the missing `fiscal.record_invalid`. Restore the block and confirm green again. Record in the commit message that this was done — a guard nobody has seen fail is a claim, not a guard (CLAUDE.md §1).

- [ ] **Step 8: Repo gate for this package**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`

If the new `if` branch drops branch coverage below 95, the deletion test above is what covers it — check it runs, do not lower the threshold.

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/chain.record-validation.test.ts packages/fiscal-verifactu/src/testing/seed.ts
git commit -s -m "Refuse a record AEAT could not accept before it enters the chain

The Veri*Factu record validator had no caller, so a series code with a space in
it reached registros_facturacion as \"Serie A/1\" and would have been rejected by
AEAT after the record was already immutable. attemptAppend now runs validate on
the built record and throws fiscal.record_invalid on any error-severity issue,
before the insert and before the chain head moves. Proven by deletion: removing
the check turns the reproduction cases red.

Turning the guard on also showed that the shared alta test fixture had been
building records AEAT would reject — a full invoice naming no recipient, and a
VAT rate written without its decimals, neither of which the real write path can
produce. The fixture is corrected here; that is the guard doing its job."
```

> **Correction, 2026-09-12 (review wave):** the VAT-rate half of that sentence is
> false and was not written into the commit. `buildAltaRecord` runs every rate
> through `formatAmountExact`, so a bare `"21"` reaches `validate` as `"21.00"`
> and raises no issue — measured, with a control that forced a bare `"21"` past
> the builder and did raise `TIPO_RANGE`. The missing recipient was the only
> fault the fixture ever had.

---

### Task 2: A warning is written, filed, and flagged

**Files:**
- Modify: `packages/fiscal-verifactu/src/errors.ts` (add `fiscal.record_totals_disagree`)
- Modify: `packages/fiscal-verifactu/src/chain.ts` (raise after the insert)
- Test: `packages/fiscal-verifactu/src/chain.record-validation.test.ts` (extend)

**Interfaces:**
- Consumes: `recordIncident` from `@waitron/core` (already a dependency — `drain.ts` and `reconcile.ts` import it); `fiscal.record_invalid` and the `validate` call site from Task 1.
- Produces: the error code `fiscal.record_totals_disagree` with params `{ fields: string[]; codes: string[] }`, written into an `incidents` row rather than thrown.

- [ ] **Step 1: Write the failing test**

Append to `packages/fiscal-verifactu/src/chain.record-validation.test.ts`:

```ts
describe("a record whose totals disagree with themselves is written, filed and flagged", () => {
  /** A sale whose stated total is far from its own VAT lines, breaching the 10.00 tolerance
   * without breaking any FORMAT rule — the only way to reach a warning without also reaching an
   * error, which Task 1's guard would refuse.
   *
   * `settlement: "deferred"` matters and is not incidental: `saleInput`'s default is an IMMEDIATE
   * settlement whose tender matches its original total, and `settleSale` throws
   * `sale.tender_shortfall` when the tendered sum disagrees with the due amount — so an immediate
   * fixture would abort in settlement, before the fiscal record is ever built, and this suite
   * would be testing nothing. A deferred sale still writes the sale and the fiscal record. */
  function mismatchedSale() {
    return {
      ...saleInput({ tenantId, tillId, nodeId, seriesId }),
      total: decimal("9999.00"),
      settlement: { kind: "deferred" } as const,
    };
  }

  it("records the sale rather than refusing it", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, mismatchedSale());
    });
    expect(saleId).toBeDefined();

    const registros = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId));
    expect(registros).toHaveLength(1);
  });

  it("raises a warning incident against that sale", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, mismatchedSale());
    });

    const rows = await pg.db.execute<{ code: string; severity: string; sale_id: string }>(
      sql`select code, severity, sale_id from incidents where tenant_id = ${tenantId}`,
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        code: "fiscal.record_totals_disagree",
        severity: "warning",
        sale_id: saleId,
      }),
    ]);
  });

  it("leaves a well-formed sale with no incident at all", async () => {
    await useSeriesCode("FS");
    await sell();

    const rows = await pg.db.execute(sql`select 1 from incidents where tenant_id = ${tenantId}`);
    expect(rows.rows).toEqual([]);
  });
});
```

Add `decimal` to the imports from `@waitron/shared`.

Expect exactly ONE incident, not two: at these amounts `CuotaTotal` still agrees with the desglose, so only `IMPORTE_TOTAL_MISMATCH` fires. If two arrive, the fixture moved both totals — say so rather than loosening the assertion.

- [ ] **Step 2: Run it and watch the middle case fail**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.record-validation.test.ts -t "disagree"`

Expected: the first and third cases pass (nothing refuses a warning today, and nothing raises one either); the second FAILS with an empty `incidents` table.

If the FIRST case fails with `fiscal.record_invalid`, the fixture is breaking a format rule as well and is being refused by Task 1's guard — adjust the amounts until only the tolerance is breached, and say in the commit what you changed. If it fails with `sale.tender_shortfall`, the `settlement: "deferred"` line was lost.

- [ ] **Step 3: Register the code**

In `packages/fiscal-verifactu/src/errors.ts`, beside Task 1's entry:

```ts
    /**
     * `attemptAppend` (./chain.ts) wrote a record whose stated totals disagree with its own VAT
     * breakdown by more than AEAT's ±10.00 euro tolerance. NEVER thrown — AEAT treats a breach as
     * an admissible error and accepts the record, so refusing the sale would block a record the
     * authority would have taken. Built only to hand its `.code`/`.params` to `@waitron/core`'s
     * `recordIncident`, exactly as `fiscal.registro_rechazado` is used from the drainer.
     *
     * It is raised at all because our own totals disagreeing with our own lines is a bug in the
     * money, happening while the venue keeps selling. Params carry the field names and issue codes,
     * never the amounts (see `fiscal.record_invalid` for why params never carry values).
     */
    "fiscal.record_totals_disagree": { fields: string[]; codes: string[] };
```

- [ ] **Step 4: Raise the incident after the insert**

In `packages/fiscal-verifactu/src/chain.ts`, add:

```ts
import { recordIncident } from "@waitron/core";
```

Change Task 1's line to keep all the issues rather than only the blocking ones:

```ts
  const issues = validate(record);
  const blocking = issues.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    throw new AppError("fiscal.record_invalid", {
      fields: blocking.map((issue) => issue.field),
      codes: blocking.map((issue) => issue.code),
    });
  }
```

Then, AFTER the `registrosFacturacion` insert and the `cadenas` update, immediately before `return { id: inserted.id, … }`:

```ts
  // A warning does not block: AEAT accepts these under its own tolerance. But our totals
  // disagreeing with our own VAT lines is a bug in the money while the venue keeps selling, so it
  // is raised where a human can find it rather than left in a log line.
  //
  // AFTER the insert, not before: this attempt is the one that won (a retried attempt never
  // reaches here), so the incident cannot outlive a rolled-back savepoint. On the caller's
  // transaction, like every other `recordIncident` caller — an incident that committed while its
  // sale rolled back would report a failure for a sale that never existed.
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (warnings.length > 0) {
    await recordIncident(tx, {
      tenantId,
      tillId: registro.tillId as TillId,
      saleId: registro.saleId as SaleId,
      error: new AppError("fiscal.record_totals_disagree", {
        fields: warnings.map((issue) => issue.field),
        codes: warnings.map((issue) => issue.code),
      }),
      severity: "warning",
      detectedAt: new Date(),
    });
  }
```

Add `SaleId`, `TillId` to the existing `import type { NodeId, TenantId } from "@waitron/shared"` line. `PendingRegistro` carries `saleId` and `tillId` as plain `string` on both arms, which is why the casts are here rather than a signature change — note that in the commit.

- [ ] **Step 5: Run the file, then the package**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.record-validation.test.ts` then `pnpm --filter @waitron/fiscal-verifactu test:coverage`

Expected: PASS, 7 tests in the new file, package green.

- [ ] **Step 6: Repo gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 7: Commit**

```bash
git add packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/chain.record-validation.test.ts
git commit -s -m "Flag a record whose totals disagree with its own VAT lines

AEAT accepts these under a 10.00 euro tolerance, so refusing the sale would block
a record the authority would take. It is raised as a warning incident against the
sale instead, after the insert that won, on the caller's transaction. Nothing
displays incidents yet — that gap is its own backlog item."
```

---

### Task 3: A fiscal contribution seat for the operator's venue fields

**Files:**
- Modify: `packages/fiscal/src/contribution.ts` (add the seat to the interface)
- Create: `packages/fiscal-verifactu/src/venue-fields.ts`
- Create: `packages/fiscal-verifactu/src/venue-fields.test.ts`
- Create: `packages/fiscal-verifactu/src/venue-fields.charset.test.ts`
- Modify: `packages/fiscal-verifactu/src/slot.ts` (fill the seat)
- Modify: `packages/fiscal-none/src/slot.ts` (comment), `packages/fiscal-none/src/slot.test.ts` (assert no seat)

**Interfaces:**
- Consumes: `MAX_BASE_CODE_LENGTH` from `./reserved-series.js` (exported, equals 38).
- Produces: `FiscalContribution.venueFields?: { validate(venue): void }` taking `{ legalName, seriesCode, rectificativeSeriesCode, operationDescription }`, throwing `setup.request_invalid` with `{ field }` naming ONE field path using the paths `parseVenue` already uses: `"legalName"`, `"seriesCode"`, `"rectificativeSeriesCode"`, `"location.operationDescription"`. Task 4 calls it; Task 5 maps those paths to screens.

- [ ] **Step 1: Write the failing test**

Create `packages/fiscal-verifactu/src/venue-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateVenueFiscalFields } from "./venue-fields.js";

const GOOD = {
  legalName: "Waitron SL",
  seriesCode: "FS",
  rectificativeSeriesCode: "FR",
  operationDescription: "Venta en establecimiento",
};

describe("validateVenueFiscalFields", () => {
  it("accepts an ordinary Spanish venue", () => {
    expect(() => validateVenueFiscalFields(GOOD)).not.toThrow();
  });

  it("refuses a series code AEAT's character set forbids, naming the field", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: "Serie A" })).toThrow(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "seriesCode" },
      }),
    );
  });

  it("refuses the rectificative code by its own name, not the standard one's", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, rectificativeSeriesCode: "Rectificativa A" }),
    ).toThrow(expect.objectContaining({ params: { field: "rectificativeSeriesCode" } }));
  });

  it("refuses a series code too long to survive a restore's installation suffix", () => {
    // MAX_BASE_CODE_LENGTH reserves room for one `-<installation number>` and the counter, each up
    // to ten digits, inside NumSerieFactura's 60-character cap. A code at the limit is accepted and
    // one character more is not — the boundary itself, not merely a value far past it.
    const atLimit = "F".repeat(38);
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: atLimit })).not.toThrow();
    expect(() => validateVenueFiscalFields({ ...GOOD, seriesCode: `${atLimit}F` })).toThrow(
      expect.objectContaining({ params: { field: "seriesCode" } }),
    );
  });

  it("refuses a control character in the legal name", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, legalName: "Waitron\u0001SL" })).toThrow(
      expect.objectContaining({ params: { field: "legalName" } }),
    );
  });

  it("refuses a control character in the operation description", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "Venta\u0001aqui" }),
    ).toThrow(expect.objectContaining({ params: { field: "location.operationDescription" } }));
  });

  it("refuses an operation description past AEAT's 500-character cap, at the boundary", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(501) }),
    ).toThrow(expect.objectContaining({ params: { field: "location.operationDescription" } }));
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(500) }),
    ).not.toThrow();
  });

  it("accepts a tab, which XML permits and the validator allows", () => {
    expect(() => validateVenueFiscalFields({ ...GOOD, legalName: "Waitron\tSL" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/venue-fields.test.ts`

Expected: FAIL — `Cannot find module './venue-fields.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/fiscal-verifactu/src/venue-fields.ts`:

```ts
// Side-effect only: this file throws `setup.request_invalid`, which ./errors.ts declares on the
// shared registry for this package — see that file for the code and the reasoning, and
// ./errors.reachability.test.ts for the check that keeps it reachable from the package barrel.
import "./errors.js";
import { AppError } from "@waitron/shared";
import { MAX_BASE_CODE_LENGTH } from "./reserved-series.js";

/**
 * The venue fields a Veri*Factu filing puts on the wire verbatim, as the host hands them over. The
 * host does not know these rules — `@waitron/verifactu` is a regime package and nothing under
 * `apps/server/src` may import one (`scripts/module-seams.test.ts`) — so they are reached through
 * `FiscalContribution.venueFields`, exactly as the AEAT certificate is reached through
 * `provisioningSecret`.
 */
export interface VenueFiscalFields {
  readonly legalName: string;
  readonly seriesCode: string;
  readonly rectificativeSeriesCode: string;
  readonly operationDescription: string;
}

/** The character set `@waitron/verifactu`'s own validator applies to `NumSerieFactura`. Restated
 * here rather than imported, because that module exports the whole-record validator and not its
 * individual patterns; ./venue-fields.charset.test.ts is what keeps the two in step. */
const NUMSERIE_CHARSET = /^[A-Za-z0-9/_.-]+$/;
/** AEAT's cap on DescripcionOperacion, as `validate` applies it. */
const DESCRIPTION_MAX = 500;
/** The C0 control characters XML forbids. Tab, line feed and carriage return are deliberately NOT
 * in the range — XML permits those three — which is why this is not a blanket `\x00-\x1F`. Same
 * pattern as `CONTROL_CHAR_PATTERN` in `packages/verifactu/src/validate.ts`. */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

function refuse(field: string): never {
  throw new AppError("setup.request_invalid", { field });
}

/** Refuse a venue whose fiscal text fields would produce a record AEAT cannot accept, naming the
 * offending field and writing nothing. Run BEFORE `provisionVenue` mints the unrepairable SIF and
 * hash chain (CLAUDE.md §5), so the operator fixes it in the wizard rather than discovering it at
 * the till when the first sale is refused. */
export function validateVenueFiscalFields(venue: VenueFiscalFields): void {
  for (const [field, code] of [
    ["seriesCode", venue.seriesCode],
    ["rectificativeSeriesCode", venue.rectificativeSeriesCode],
  ] as const) {
    if (!NUMSERIE_CHARSET.test(code)) refuse(field);
    // The cap is on the BASE, not on what is typed: a cold restore suffixes the installation
    // number and the counter is appended after a slash, and both must still fit inside
    // NumSerieFactura's 60 characters.
    if (code.length > MAX_BASE_CODE_LENGTH) refuse(field);
  }
  if (CONTROL_CHARS.test(venue.legalName)) refuse("legalName");
  if (CONTROL_CHARS.test(venue.operationDescription)) refuse("location.operationDescription");
  if (venue.operationDescription.length > DESCRIPTION_MAX) {
    refuse("location.operationDescription");
  }
}
```

The `eslint-disable-next-line no-control-regex` comment is required, not decorative: `js.configs.recommended` enables that rule as an error, which is why `validate.ts` carries the identical disable. Without it `pnpm lint` fails.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/venue-fields.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Pin the restated charset against the real validator**

Create `packages/fiscal-verifactu/src/venue-fields.charset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { TEST_SISTEMA } from "./testing/seed.js";
import { validateVenueFiscalFields } from "./venue-fields.js";

/** One alta built around a candidate invoice number, so the record validator's own verdict on the
 * CHARACTER SET can be compared with what the boundary check said about the series code it came
 * from. `F2` and no `TipoImpositivo` keep every other rule satisfied, so the only issue this
 * record can produce is the one under test. */
function recordFor(numSerie: string) {
  const input: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: numSerie,
    FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "111.10",
        CuotaRepercutida: "12.35",
      },
    ],
    CuotaTotal: "12.35",
    ImporteTotal: "123.45",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:30+01:00"),
    offsetMinutes: 60,
  };
  return buildAltaRecord(input);
}

const GOOD = {
  legalName: "Waitron SL",
  seriesCode: "FS",
  rectificativeSeriesCode: "FR",
  operationDescription: "Venta en establecimiento",
};

// The LENGTH rules deliberately DISAGREE and are not compared here: the boundary refuses a base
// over 38 characters so a cold restore's `-<installation number>` suffix still fits, while the
// record validator accepts NumSerieFactura up to 60. A future reader must not "fix" that.
describe("the restated character set matches the record validator's", () => {
  it.each(["Serie A", "Série A", "FAC 1", "FS", "A-2026", "A/B"])(
    "gives the same verdict as validate() for %j",
    (code) => {
      let boundaryRefused = false;
      try {
        validateVenueFiscalFields({ ...GOOD, seriesCode: code });
      } catch {
        boundaryRefused = true;
      }
      const validatorRefused = validate(recordFor(`${code}/1`)).some(
        (issue) => issue.field === "NumSerieFactura" && issue.severity === "error",
      );
      expect(boundaryRefused).toBe(validatorRefused);
    },
  );
});
```

`TEST_SISTEMA` comes from this package's own `./testing/seed.js` — do NOT deep-import another package's `test/` directory (`packages/verifactu/test/fixtures.ts` has a `SISTEMA`, but reaching into it would be a new cross-package test dependency).

Run it. Expected: PASS. If a case disagrees, the restated charset in `venue-fields.ts` is wrong — fix `venue-fields.ts`, never the expectation.

- [ ] **Step 6: Add the seat to the contract**

In `packages/fiscal/src/contribution.ts`, inside `interface FiscalContribution`, after `provisioningSecret`:

```ts
  /** The operator-typed venue fields this regime puts on the wire verbatim. The host collects them
   * and does not know the regime's rules, so — exactly as `provisioningSecret` does for the signing
   * certificate — it reaches them through this seat. `validate` throws `setup.request_invalid`
   * naming ONE offending field and writes nothing; it is run BEFORE `provisionVenue` mints the
   * unrepairable SIF and hash chain (CLAUDE.md §5). A regime that files nothing offers no seat and
   * its venues are not checked, because there is no filing format to violate. */
  readonly venueFields?: {
    validate(venue: {
      readonly legalName: string;
      readonly seriesCode: string;
      readonly rectificativeSeriesCode: string;
      readonly operationDescription: string;
    }): void;
  };
```

The shape is restated structurally rather than importing `VenueFiscalFields`, because `@waitron/fiscal` is the regime-neutral contract and must not depend on a regime package.

- [ ] **Step 7: Fill the seat, and assert the other regime offers none**

In `packages/fiscal-verifactu/src/slot.ts`:

```ts
import { validateVenueFiscalFields } from "./venue-fields.js";
```

```ts
  // The operator-typed fields that reach AEAT verbatim. Refused here, at provision time, so the
  // operator fixes them in the wizard — the alternative is the chain-append guard refusing the
  // venue's first sale at the till, which is the worst place to learn a series code has a space.
  venueFields: { validate: validateVenueFiscalFields },
```

`packages/fiscal-none/src/slot.ts` gets NO seat: extend its existing "No `provisioningSecret`" sentence to name `venueFields` too, with the reason (a venue under no fiscal obligation has no filing format to violate). Then add the assertion beside the sibling one in `packages/fiscal-none/src/slot.test.ts`:

```ts
  it("offers no venue-field seat: there is no filing format to violate", () => {
    expect(FISCAL_NONE_SLOT.venueFields).toBeUndefined();
  });
```

- [ ] **Step 8: Package gates**

Run: `pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/fiscal test:coverage && pnpm --filter @waitron/fiscal-none test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal/src/contribution.ts packages/fiscal-verifactu/src/venue-fields.ts packages/fiscal-verifactu/src/venue-fields.test.ts packages/fiscal-verifactu/src/venue-fields.charset.test.ts packages/fiscal-verifactu/src/slot.ts packages/fiscal-none/src/slot.ts packages/fiscal-none/src/slot.test.ts
git commit -s -m "Add a fiscal contribution seat for the operator's venue fields

The host collects the legal name, the two series codes and the operation
description, and puts them on the AEAT wire verbatim, but cannot import the rules
that govern them: the module seams pin the server's regime allowlist empty. The
seat is the same shape as provisioningSecret, for the same reason. A regime that
files nothing offers none."
```

---

### Task 4: Refuse at the setup boundary

**Files:**
- Modify: `apps/server/src/setup-api.ts` — `parseProvisionPayload`, right after `const contribution = selection.contribution;`
- Test: `apps/server/src/setup-api.test.ts` (extend — do NOT create a new suite)

**Interfaces:**
- Consumes: `FiscalContribution.venueFields` from Task 3.
- Produces: a `POST /setup-api/provision` that answers 400 `setup.request_invalid` with `params.field` for a bad venue field. Task 5 consumes those field paths.

**What the harness is.** `apps/server/src/setup-api.test.ts` is the sibling suite, and it is NOT end-to-end against a database: `makeDeps()` makes `provision` a `vi.fn()` spy and `db` a stub. So the "nothing was provisioned" property is expressed as `expect(deps.provision).not.toHaveBeenCalled()` — which the suite already does elsewhere — and NOT by counting tenant rows. Its helpers are `postProvision(app, body)` and `demoBody()`. Read them before writing.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/setup-api.test.ts`, following that file's existing `makeDeps` / `postProvision` / `demoBody` shape exactly:

```ts
describe("the venue's fiscal fields are refused at the boundary", () => {
  it("refuses a series code with a forbidden character, naming the field", async () => {
    const { app } = makeApp();
    const body = demoBody();
    const res = await postProvision(app, {
      ...body,
      venue: { ...body.venue, seriesCode: "Serie A" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "setup.request_invalid", params: { field: "seriesCode" } },
    });
  });

  it("provisions nothing when it refuses", async () => {
    const { app, deps } = makeApp();
    const body = demoBody();
    await postProvision(app, { ...body, venue: { ...body.venue, seriesCode: "Serie A" } });

    // The tenant, node and SIF are all unrepairable once minted (CLAUDE.md §5), so the property
    // that matters is that the mint was never reached at all.
    expect(deps.provision).not.toHaveBeenCalled();
  });

  it("still accepts the ordinary demo venue", async () => {
    const { app, deps } = makeApp();
    const res = await postProvision(app, demoBody());

    expect(res.status).toBe(200);
    expect(deps.provision).toHaveBeenCalled();
  });
});
```

`makeApp()` stands for however that file builds its app and deps together — use its real name and shape.

- [ ] **Step 2: Run it and watch the first two fail**

Run: `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts -t "fiscal fields"`

Expected: the first two FAIL — the provision succeeds with `Serie A`.

- [ ] **Step 3: Call the seat**

In `apps/server/src/setup-api.ts`, in `parseProvisionPayload`, immediately after `const contribution = selection.contribution;`:

```ts
  // The regime's own rules on the fields the operator typed, reached through the contract seat —
  // this file imports no regime package (`scripts/module-seams.test.ts` pins that allowlist empty).
  // Before the secret checks below and long before `provision`, so a refusal mints nothing.
  contribution.venueFields?.validate({
    legalName: venue.legalName,
    seriesCode: venue.seriesCode,
    rectificativeSeriesCode: venue.rectificativeSeriesCode,
    operationDescription: venue.location.operationDescription,
  });
```

The optional chaining is what makes a `fiscal-none` venue skip the check, which is the spec's §9 open point — it needs no separate host-side branch.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts`

Expected: PASS, whole file.

- [ ] **Step 5: Confirm the seam guard is still green**

Run: `pnpm exec vitest run scripts/module-seams.test.ts` from the repo root.

Expected: PASS, including the case asserting the `apps/server/src` regime allowlist is EMPTY. This is the check that proves Task 4 went through the seat rather than reaching for the regime; if it fails, the fix is the import, never the allowlist.

- [ ] **Step 6: Package gate**

Run: `pnpm --filter @waitron/server test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/setup-api.ts apps/server/src/setup-api.test.ts
git commit -s -m "Refuse a venue whose fiscal fields AEAT would reject

The provision route now runs the regime's venue-field rules through the contract
seat before anything is minted, so a series code with a space is refused with the
field named instead of surfacing as a refused sale at the till. A regime that
offers no seat skips the check by optional chaining. The module-seams guard stays
green: this file still imports no regime package."
```

---

### Task 5: The wizard marks the field and returns the operator to it

**Files:**
- Modify: `apps/setup/src/setup-app.ts` — the `case "setup.request_invalid"` arm in `#mapProvisionError` (around line 419), plus new state
- Modify: `apps/setup/src/screens/venue-screen.ts` — a new `invalidField` property, its clearing rule, and per-field messages
- Test: `apps/setup/src/setup-app.test.ts`, `apps/setup/src/screens/venue-screen.test.ts` (extend both)

**Interfaces:**
- Consumes: the field paths Task 3 produces — `"legalName"`, `"seriesCode"`, `"rectificativeSeriesCode"`, `"location.operationDescription"`.
- Produces: nothing later tasks depend on.

**The real helper names** (the plan's first draft invented three that do not exist — use these):
- `mountSetupApp(api: SetupApi = stubApi())` — `apps/setup/src/setup-app.test.ts`
- `stubApi({ provision: vi.fn().mockRejectedValue({ code, params }) })`, then `provisionRequest(el)`, then `await flush(el)` — the established rejection shape in that file
- `mountWidget<SetupVenueScreen>("setup-venue-screen", { … })` returning `{ el, host }` — `apps/setup/src/widgets/test-helpers.ts`
- `screen` and any new state are `@state() private`, so assert through the DOM (`[data-test=screen-venue]`) or use the `(el as unknown as { … })` cast that file already uses for `readDraft`.

- [ ] **Step 0: Check the machine before a browser run**

Run: `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`

`apps/setup` runs Vitest in real headless Chromium. Scale to what is free; if another session is already running browser suites or a whole-workspace run, wait rather than adding to it.

- [ ] **Step 1: Write the failing tests**

In `apps/setup/src/setup-app.test.ts`, following the existing rejection test's shape:

```ts
it("sends the operator back to the venue form with the field marked, not to review", async () => {
  const el = await mountSetupApp(
    stubApi({
      provision: vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "seriesCode" },
      }),
    }),
  );
  await provisionRequest(el);
  await flush(el);

  expect(el.shadowRoot!.querySelector("[data-test=screen-venue]")).not.toBeNull();
  const venue = el.shadowRoot!.querySelector("setup-venue-screen")!;
  expect(venue.getAttribute("invalidfield") ?? (venue as never as { invalidField?: string }).invalidField).toBe("seriesCode");
});

it("still routes a field the venue form does not own to review", async () => {
  const el = await mountSetupApp(
    stubApi({
      provision: vi.fn().mockRejectedValue({
        code: "setup.request_invalid",
        params: { field: "mode" },
      }),
    }),
  );
  await provisionRequest(el);
  await flush(el);

  expect(el.shadowRoot!.querySelector("[data-test=screen-review]")).not.toBeNull();
});
```

In `apps/setup/src/screens/venue-screen.test.ts`:

```ts
it("marks the field the server named and explains what is wrong with it", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    invalidField: "seriesCode",
  });

  const input = el.shadowRoot!.querySelector("[data-test=seriesCode]")!;
  expect(input.hasAttribute("invalid")).toBe(true);
  const message = el.shadowRoot!.querySelector("[data-test=seriesCode-field-error]");
  expect(message?.textContent).toContain("letters, numbers");
});

it("clears the server's mark once the operator edits that field, so Next works again", async () => {
  const { el } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {
    invalidField: "seriesCode",
    // plus whatever properties the sibling tests set to make a COMPLETE, valid venue — otherwise
    // Next is blocked by this screen's own validation and this test proves nothing.
  });

  const input = el.shadowRoot!.querySelector("[data-test=seriesCode]")!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "FS" }, bubbles: true, composed: true }));
  await el.updateComplete;

  expect(input.hasAttribute("invalid")).toBe(false);

  const advanced = new Promise((resolve) => el.addEventListener("setup-advance", resolve, { once: true }));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
  await expect(advanced).resolves.toBeDefined();
});
```

The second case is the one that matters most: without a clearing rule the server's mark either blocks Next forever or never goes away.

- [ ] **Step 2: Run both and watch them fail**

Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts src/screens/venue-screen.test.ts`

Expected: FAIL — the app routes to review, and the venue screen has no `invalidField` property.

- [ ] **Step 3: Route the venue field paths back to the venue screen**

In `apps/setup/src/setup-app.ts`, replace the `case "setup.request_invalid"` arm's body with:

```ts
      case "setup.request_invalid": {
        const field = typeof error.params?.field === "string" ? error.params.field : undefined;
        // A field the venue form owns goes BACK to that form with the field marked. The rest keep
        // the review-screen banner. This method's own comment used to call that banner a
        // belt-and-suspenders path because "the field's own screen already validates the same
        // rule" — true of every field the boundary could reject until the fiscal regime's
        // venue-field seat was added, and no longer true of these four.
        if (field !== undefined && VENUE_FORM_FIELDS.has(field)) {
          this.venueInvalidField = field;
          this.venueError = undefined;
          this.screen = "venue";
          return;
        }
        this.reviewError =
          field === undefined
            ? "The box rejected the details. Check your entries, then provision again."
            : `The box rejected the details (field: ${field}). Check your entries, then provision again.`;
        this.screen = "review";
        return;
      }
```

Update that method's doc comment to match — leaving it claiming the old behaviour is the §1 defect class.

Add near the module's other constants:

```ts
/** The field paths the venue form owns, as `apps/server/src/setup-api.ts` names them — the fiscal
 * regime's venue-field seat rejects exactly these (`packages/fiscal-verifactu/src/venue-fields.ts`). */
const VENUE_FORM_FIELDS = new Set([
  "legalName",
  "seriesCode",
  "rectificativeSeriesCode",
  "location.operationDescription",
]);
```

And the state, beside the existing `venueError`:

```ts
  @state() private venueInvalidField?: string;
```

Clear it everywhere `this.venueError = undefined` already appears (the goto handler, the advance handler, and the venue submit path) — a stale mark surviving into the next attempt is exactly the bug the second test catches. Pass it to the venue screen where that screen is rendered: `.invalidField=${this.venueInvalidField}`.

- [ ] **Step 4: Mark the field on the venue screen, and let it clear**

In `apps/setup/src/screens/venue-screen.ts`:

```ts
  /** A field the SERVER rejected, named by `setup.request_invalid`'s `params.field`. Marked
   * invalid on arrival so an operator returning from a refused provision lands on the form with
   * the offending field already flagged. Cleared as soon as they edit that field — see `#onField`,
   * without which `#next`'s `invalid.size > 0` early return would block Next forever. */
  @property() invalidField?: string;
```

Hold the server's mark in its own state rather than seeding `this.invalid` directly — `#next()` rebuilds `this.invalid` from scratch and returns early while it is non-empty, so a mark folded into that set would never clear:

```ts
  /** The server-marked field, as this screen's own key, until the operator edits it. */
  @state() private serverInvalid?: TextField;
```

Set it from `invalidField` when the property changes (`willUpdate`), mapping the server's path to this screen's key; clear it in `#onField` when the edited key matches. Render `?invalid=${this.invalid.has(key) || this.serverInvalid === key}` and the message beside the field:

```ts
/** The server's field paths, mapped to this screen's own field keys. */
const SERVER_FIELD_KEYS: Record<string, TextField> = {
  legalName: "legalName",
  seriesCode: "seriesCode",
  rectificativeSeriesCode: "rectificativeSeriesCode",
  "location.operationDescription": "operationDescription",
};

/** What is wrong with each field, in the operator's terms — never the raw rule. */
const FIELD_MESSAGES: Partial<Record<TextField, string>> = {
  seriesCode: "Use letters, numbers, and the characters / _ . - only, up to 38 characters.",
  rectificativeSeriesCode:
    "Use letters, numbers, and the characters / _ . - only, up to 38 characters.",
  legalName: "Remove any unusual characters from the legal name.",
  operationDescription: "Shorten this to 500 characters or fewer, and remove unusual characters.",
};
```

Give the message element `data-test="${key}-field-error"`, matching how `cert-screen.ts` names its own field errors.

- [ ] **Step 5: Run both test files**

Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts src/screens/venue-screen.test.ts`

Expected: PASS.

- [ ] **Step 6: Package gate**

Run: `pnpm --filter @waitron/setup test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 7: Commit**

```bash
git add apps/setup/src/setup-app.ts apps/setup/src/screens/venue-screen.ts apps/setup/src/setup-app.test.ts apps/setup/src/screens/venue-screen.test.ts
git commit -s -m "Return the operator to the field the box rejected

A venue field refused by the fiscal regime's seat now reopens the venue form with
that field marked and a sentence saying what is wrong with it, instead of a review
screen banner quoting a raw field path. The mark clears when the operator edits
that field, so Next is not blocked by a rule this screen cannot evaluate. Fields
the venue form does not own keep the old banner."
```

---

### Task 6: Whole-workspace verification and the backlog

**Files:**
- Modify: `docs/backlog.md`, possibly `CLAUDE.md`

- [ ] **Step 1: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`

This is the one moment the whole workspace runs — Task 3 changed `packages/fiscal`'s contract, which more than one package asserts against, and Task 1 changed a fixture nine test files share.

- [ ] **Step 2: Update the backlog in the same change that made it stale**

Rewrite the entry beginning "**Nothing checks a fiscal record against AEAT's rules before it is chained or sent**" to say what landed. Keep the experiment that established the problem (the sabotage and its control) — that receipt is why the rule exists and outlives the fix. **Add what the fix itself found**: the shared alta fixture had been building records AEAT would reject, so the guard's very first act was to expose test data nobody could have trusted. Leave the incidents-surface entry alone; it is a separate branch.

- [ ] **Step 3: Consider a CLAUDE.md entry, honestly**

Judge against §7's own bar: an entry is the rule, one line on what it cost, and a pointer. The candidate rule is that an exported check with no caller reads exactly like a check that runs — and that a test fixture nothing validates drifts into describing impossible data. If the deletion tests in Tasks 1 and 3 make that unrepeatable, no entry is needed; a written rule with a guard behind it does not need a paragraph as well. Decide, and say which way in the commit.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md CLAUDE.md
git commit -s -m "Backlog: the record validator is wired into the write path"
```

- [ ] **Step 5: Hand off to finish-branch**

Do NOT open the PR from inside a task. Report completion; the driver runs `/finish-branch`, which owns the review wave, the rebase and the PR.

---

## Review record

This plan was reviewed with fresh context against the code before execution. Eight findings were fixed into it, rather than left for an implementer to hit:

1. The guard turns much of the existing suite red because the shared alta fixture builds an invalid record — Task 1 step 5, with the measured receipt (12 of 20 in `chain.test.ts`).
2. Task 2's original fixture aborted in settlement with `sale.tender_shortfall` before ever reaching the chain — now a deferred sale.
3. The control-character regex was raw bytes and lacked the `eslint-disable no-control-regex` the rule requires — now escaped, with the disable.
4. `SISTEMA` is not exported from `fiscal-verifactu`'s test fixtures — now `TEST_SISTEMA` from the package's own `testing/seed.ts`.
5. `apps/server/src/setup-api.test.ts` stubs `provision`, so "nothing was provisioned" is a spy assertion, not a row count — Task 4 rewritten against the real harness.
6. `vitest run --project main` fails: the root config defines no named projects.
7. Task 5 named three helpers that do not exist — replaced with the real ones, and private `@state` is asserted through the DOM.
8. The server's field mark had no clearing rule, which would have blocked Next forever — now specified, with a test.

Also corrected: the anulación case proved nothing (now a direct `appendToChain` call), the refusal test did not check the `sales` row, the charset pins-test overclaimed agreement where the length rules deliberately differ, `venue-fields.ts`'s registry comment named the wrong declaring file, and `fiscal-none` had no assertion that it offers no seat.

## Self-review

**Spec coverage.** §3 layer 1 → Task 1. §6 warnings → Task 2. §4 layer 2 → Tasks 3 and 4. §5 layer 3 → Task 5. §7 testing → the test steps in every task, with the deletion proof at Task 1 step 7 and the charset agreement check at Task 3 step 5. §8 not-in-scope → no task touches the drain. §9's open points → the guard question is decided in Task 6 step 3; the `fiscal-none` question is answered by the optional chaining in Task 4 step 3 and asserted in Task 3 step 7.

**One spec point deliberately narrowed.** §4 lists the tax identifier among the fields the boundary seat covers. It is NOT in Task 3, because the country pack already validates it in the browser and again at the server boundary (`validateSpanishNif`, run from `setup-api.ts`), so a second check would duplicate a working one. The record validator's own `NIF_LENGTH` check still backstops it at the chain seam via Task 1.

**Naming consistency.** `validateVenueFiscalFields` (Task 3) is what `slot.ts` fills `venueFields.validate` with and what Task 4 calls through the seat; `VENUE_FORM_FIELDS` (Task 5) lists exactly the four paths Task 3 can throw; `SERVER_FIELD_KEYS` maps those same four to the venue screen's own keys.
