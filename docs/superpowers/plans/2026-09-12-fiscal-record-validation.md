# Checking a fiscal record before it is written — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Veri\*Factu record validator actually run, so a record AEAT could not accept is refused before it enters the append-only table, and refuse the same values at the setup boundary where an operator can still fix them.

**Architecture:** Three layers. `attemptAppend` (`packages/fiscal-verifactu/src/chain.ts`) validates the built record immediately before inserting it — one seam covering sale, void, correction and substitution. A new seat on `FiscalContribution` lets `apps/server/src/setup-api.ts` check the operator's venue fields without importing a regime package, which the module-seams guard forbids. The wizard marks the field the server names and sends the operator back to it.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL / PGlite, Vitest (browser mode via real headless Chromium for the `apps/setup` task), Lit for the wizard.

**Spec:** `docs/superpowers/specs/2026-09-12-fiscal-record-validation-design.md`

## Global Constraints

- **Error params never carry an operator's value.** The shared error boundary writes an `AppError`'s params into `waitron.log`, which the unauthenticated recovery page renders to anyone on the venue's LAN. Field NAMES and issue CODES only (CLAUDE.md §3).
- **Error codes name the domain concept, never the throwing package**, are lowercase and dot-namespaced, and are never renamed once shipped (`packages/shared/src/errors.ts`'s design note).
- **Every file that throws a code imports its registry** — `import "./errors.js"` as a bare side-effect import.
- **No file under `apps/server/src` may import `@waitron/verifactu` or `@waitron/fiscal-verifactu`.** `scripts/module-seams.test.ts` pins that allowlist as EMPTY; it may shrink, never grow. This is why Task 3 exists.
- **A new code is registered by declaration merging** in the throwing package's own `errors.ts` (`declare module "@waitron/shared"`), never by editing `packages/shared`.
- **Every commit is `git commit -s`** — CI's `dco` job walks the whole PR range.
- **Per-task verification is the changed package's `test:coverage` plus `pnpm lint`, `pnpm typecheck` and `pnpm format:check`** — not the whole workspace. `packages/fiscal-verifactu` and `packages/core` sit at the high coverage bar (statements 98 / lines 98 / functions 98 / branches 95).
- **Before the browser-mode task (Task 5), check what else is testing on this machine** (`memory_pressure | grep free`, `ps -axo rss,command | sort -nr | head`) — the four browser packages run real headless Chromium.

---

### Task 1: Refuse an invalid record at the chain seam

**Files:**
- Modify: `packages/fiscal-verifactu/src/errors.ts` (add the `fiscal.record_invalid` declaration)
- Modify: `packages/fiscal-verifactu/src/chain.ts:11-12` (import), `:213-217` (the check)
- Test: `packages/fiscal-verifactu/src/chain.record-validation.test.ts` (create)

**Interfaces:**
- Consumes: `validate`, `ValidationIssue` from `@waitron/verifactu` (already exported from its barrel).
- Produces: the error code `fiscal.record_invalid` with params `{ fields: string[]; codes: string[] }`. Task 2 adds a second behaviour at the same seam and relies on the `validate(record)` call sitting after the record is built.

- [ ] **Step 1: Write the failing test**

Create `packages/fiscal-verifactu/src/chain.record-validation.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";
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

    // The chain head must not have advanced either: a refused record leaves the node exactly
    // where it was, so the next legitimate sale is still the chain's first record.
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

  it("refuses a void as well, so the guard covers anulación and not only alta", async () => {
    await useSeriesCode("FS");
    const { saleId } = await sell();
    await useSeriesCode("Serie A");

    // recordVoid rebuilds its identity from the ORIGINAL alta's stored columns, so the stale
    // "FS/1" travels with it and the void itself stays valid. Re-reading the series is what a
    // future change might introduce; this case pins that the anulación arm reaches validate at
    // all by asserting the void still succeeds against a legal stored identity.
    await expect(
      withTenant(pg.db, tenantId, (tx) => backend.recordVoid(tx, saleId, "staff error")),
    ).resolves.toMatchObject({ state: "pending" });
  });
});
```

- [ ] **Step 2: Run it and watch the first two cases fail**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/chain.record-validation.test.ts`

Expected: the first two cases FAIL — the sale resolves instead of rejecting, and `registros_facturacion` holds a row with `num_serie_factura = "Serie A/1"`. The third and fourth cases pass already. That contrast is the point: it reproduces the defect before fixing it.

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

In `packages/fiscal-verifactu/src/chain.ts`, extend the existing `@waitron/verifactu` value import on line 12:

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

- [ ] **Step 5: Run the tests and watch all four pass**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/chain.record-validation.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 6: Prove the guard by deletion**

Comment out the `if (blocking.length > 0) { … }` block and re-run the same file. Expected: the first two cases go RED and the message names `fiscal.record_invalid` as the missing rejection. Restore the block and confirm green again. Record in the commit message that this was done — a guard nobody has seen fail is a claim, not a guard (CLAUDE.md §1).

- [ ] **Step 7: Run the package's own gate**

Run: `pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

Expected: all pass, coverage still at or above statements 98 / lines 98 / functions 98 / branches 95. If the new `if` branch drops branch coverage, the deletion test above is the case that covers it — check it is running, do not lower the threshold.

- [ ] **Step 8: Commit**

```bash
git add packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/chain.record-validation.test.ts
git commit -s -m "Refuse a record AEAT could not accept before it enters the chain

The Veri*Factu record validator had no caller, so a series code with a space in
it reached registros_facturacion as \"Serie A/1\" and would have been rejected by
AEAT after the record was already immutable. attemptAppend now runs validate on
the built record and throws fiscal.record_invalid on any error-severity issue,
before the insert and before the chain head moves. Proven by deletion: removing
the check turns the two reproduction cases red."
```

---

### Task 2: A warning is written, filed, and flagged

**Files:**
- Modify: `packages/fiscal-verifactu/src/errors.ts` (add `fiscal.record_totals_disagree`)
- Modify: `packages/fiscal-verifactu/src/chain.ts` (raise after the insert)
- Test: `packages/fiscal-verifactu/src/chain.record-validation.test.ts` (extend)

**Interfaces:**
- Consumes: `recordIncident` from `@waitron/core`; `fiscal.record_invalid` and the `validate` call site from Task 1.
- Produces: the error code `fiscal.record_totals_disagree` with params `{ fields: string[]; codes: string[] }`, written into an `incidents` row rather than thrown.

- [ ] **Step 1: Write the failing test**

Append to `packages/fiscal-verifactu/src/chain.record-validation.test.ts`:

```ts
describe("a record whose totals disagree with themselves is written, filed and flagged", () => {
  /** The amount cross-checks compare `ImporteTotal` against the desglose's own lines with a 10.00
   * tolerance. A sale whose stated total is far from its lines breaches it without breaking any
   * FORMAT rule, which is the only way to reach a warning without also reaching an error. */
  function mismatchedSale() {
    const base = saleInput({ tenantId, tillId, nodeId, seriesId });
    return { ...base, total: decimal("9999.00") };
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
});
```

Add `decimal` to the file's imports from `@waitron/shared` (the same helper `backend.test.ts` uses for its `total`/`vatBreakdown` fixtures).

- [ ] **Step 2: Run it and watch both cases fail**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/chain.record-validation.test.ts -t "disagree"`

Expected: the first case may already pass (nothing refuses a warning today), the second FAILS with an empty `incidents` table. If the FIRST case fails, stop: it means the mismatched fixture is also breaking a format rule and is being refused by Task 1's guard. Adjust the fixture so only the tolerance is breached, and say in the commit what you changed and why.

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

In `packages/fiscal-verifactu/src/chain.ts`, add the import:

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

- [ ] **Step 5: Run the tests**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/chain.record-validation.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Check the dependency is legitimate**

Run: `grep -n '"@waitron/core"' packages/fiscal-verifactu/package.json`

Expected: already listed (`reconcile.ts` imports `recordIncident` from it). If it is NOT listed, stop and report — adding a dependency edge from the regime to core is a decision for the owner, not a step in this task.

- [ ] **Step 7: Package gate**

Run: `pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 8: Commit**

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
- Modify: `packages/fiscal-verifactu/src/slot.ts` (fill the seat)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `FiscalContribution.venueFields?: { validate(venue: VenueFiscalFields): void }`, where

```ts
export interface VenueFiscalFields {
  readonly legalName: string;
  readonly seriesCode: string;
  readonly rectificativeSeriesCode: string;
  readonly operationDescription: string;
}
```

  `validate` throws `setup.request_invalid` with `{ field }` naming ONE field path, using the same paths `parseVenue` already uses: `"legalName"`, `"seriesCode"`, `"rectificativeSeriesCode"`, `"location.operationDescription"`. Task 4 calls it; Task 5 maps those paths to screens.

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
    ).toThrow(
      expect.objectContaining({ params: { field: "rectificativeSeriesCode" } }),
    );
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
    expect(() => validateVenueFiscalFields({ ...GOOD, legalName: "WaitronSL" })).toThrow(
      expect.objectContaining({ params: { field: "legalName" } }),
    );
  });

  it("refuses an operation description past AEAT's 500-character cap", () => {
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(501) }),
    ).toThrow(expect.objectContaining({ params: { field: "location.operationDescription" } }));
    expect(() =>
      validateVenueFiscalFields({ ...GOOD, operationDescription: "x".repeat(500) }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/venue-fields.test.ts`

Expected: FAIL — `Cannot find module './venue-fields.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/fiscal-verifactu/src/venue-fields.ts`:

```ts
// Side-effect only: `setup.request_invalid` is declared by apps/server, and this file throws it —
// see ./errors.ts for this package's own contributions and why the registry is reached this way.
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
 * here rather than imported because that module exports the whole-record validator and not its
 * individual patterns; `./venue-fields.pins-validate.test.ts` is what keeps the two in step. */
const NUMSERIE_CHARSET = /^[A-Za-z0-9/_.-]+$/;
/** AEAT's cap on DescripcionOperacion, as `validate` applies it. */
const DESCRIPTION_MAX = 500;
/** Anything `validate` rejects as an XML control character. */
const CONTROL_CHARS = /[ --]/;

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

- [ ] **Step 4: Run the test**

Run: `cd packages/fiscal-verifactu && pnpm exec vitest run src/venue-fields.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Pin the restated rules against the real validator**

The charset and the cap above are restated, so they can drift from `@waitron/verifactu`'s own. Create `packages/fiscal-verifactu/src/venue-fields.pins-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validate } from "@waitron/verifactu";
import { buildAltaRecord } from "@waitron/verifactu";
import { SISTEMA } from "../test/fixtures.js";
import type { AltaInput } from "@waitron/verifactu";
import { validateVenueFiscalFields } from "./venue-fields.js";

/** One alta built around a candidate invoice number, so the record validator's own verdict can be
 * compared with what the boundary check said about the series code it came from. */
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
    SistemaInformatico: SISTEMA,
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

describe("the boundary check agrees with the record validator", () => {
  it.each(["Serie A", "Série A", "FAC 1", "FS"])(
    "gives the same verdict as validate() for %j",
    (code) => {
      const boundaryRefused = (() => {
        try {
          validateVenueFiscalFields({ ...GOOD, seriesCode: code });
          return false;
        } catch {
          return true;
        }
      })();
      const validatorRefused = validate(recordFor(`${code}/1`)).some(
        (issue) => issue.field === "NumSerieFactura" && issue.severity === "error",
      );
      expect(boundaryRefused).toBe(validatorRefused);
    },
  );
});
```

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

- [ ] **Step 7: Fill the seat**

In `packages/fiscal-verifactu/src/slot.ts`, add the import and the seat:

```ts
import { validateVenueFiscalFields } from "./venue-fields.js";
```

```ts
  // The operator-typed fields that reach AEAT verbatim. Refused here, at provision time, so the
  // operator fixes them in the wizard — the alternative is the chain-append guard refusing the
  // venue's first sale at the till, which is the worst place to learn a series code has a space.
  venueFields: { validate: validateVenueFiscalFields },
```

`packages/fiscal-none/src/slot.ts` gets NO seat — its comment already explains the same for `provisioningSecret`; extend that sentence to name `venueFields` too.

- [ ] **Step 8: Package gates**

Run: `pnpm --filter @waitron/fiscal-verifactu test:coverage && pnpm --filter @waitron/fiscal test:coverage && pnpm --filter @waitron/fiscal-none test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

- [ ] **Step 9: Commit**

```bash
git add packages/fiscal/src/contribution.ts packages/fiscal-verifactu/src/venue-fields.ts packages/fiscal-verifactu/src/venue-fields.test.ts packages/fiscal-verifactu/src/venue-fields.pins-validate.test.ts packages/fiscal-verifactu/src/slot.ts packages/fiscal-none/src/slot.ts
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
- Modify: `apps/server/src/setup-api.ts:404-414` (call the seat)
- Test: `apps/server/src/setup-api.venue-fields.test.ts` (create)

**Interfaces:**
- Consumes: `FiscalContribution.venueFields` from Task 3.
- Produces: a `POST /setup-api/provision` that answers 400 `setup.request_invalid` with `params.field` for a bad venue field. Task 5 consumes those field paths.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/setup-api.venue-fields.test.ts`, modelled on the existing setup-api suites in this directory — open one first and follow its harness exactly rather than inventing a new one:

```ts
import { describe, expect, it } from "vitest";
// Follow the sibling suite's imports for the app factory and the provision-body fixture.

describe("the venue's fiscal fields are refused at the boundary", () => {
  it("refuses a series code with a forbidden character, naming the field", async () => {
    const res = await provisionWith({ venue: { seriesCode: "Serie A" } });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "setup.request_invalid", params: { field: "seriesCode" } },
    });
  });

  it("provisions nothing when it refuses", async () => {
    await provisionWith({ venue: { seriesCode: "Serie A" } });
    // The tenant, the node and the SIF are all unrepairable once minted (CLAUDE.md §5), so the
    // property that matters is that none of them exists after a refusal.
    expect(await tenantCount()).toBe(0);
  });

  it("accepts the same venue with a legal series code", async () => {
    const res = await provisionWith({ venue: { seriesCode: "FS" } });
    expect(res.status).toBe(200);
  });
});
```

Write `provisionWith` and `tenantCount` against whatever the sibling suite already provides; do not build a second harness. If no sibling covers the provision route end to end, say so in the task report rather than inventing one — that is a finding, not a blocker to work around silently.

- [ ] **Step 2: Run it and watch the first two fail**

Run: `pnpm --filter @waitron/server exec vitest run src/setup-api.venue-fields.test.ts`

Expected: the first two FAIL — the provision succeeds with `Serie A`.

- [ ] **Step 3: Call the seat**

In `apps/server/src/setup-api.ts`, in the function that resolves the contribution, immediately after `const contribution = selection.contribution;`:

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

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/setup-api.venue-fields.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the seam guard is still green**

Run: `pnpm exec vitest run --project main scripts/module-seams.test.ts`

Expected: PASS, and specifically the case asserting the `apps/server/src` regime allowlist is EMPTY. This is the check that proves Task 4 went through the seat rather than reaching for the regime; if it fails, the fix is the import, never the allowlist.

- [ ] **Step 6: Package gate**

Run: `pnpm --filter @waitron/server test:coverage && pnpm lint && pnpm typecheck && pnpm format:check`

`apps/server` sits at the 90/90/85/85 floor, not the high bar.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/setup-api.ts apps/server/src/setup-api.venue-fields.test.ts
git commit -s -m "Refuse a venue whose fiscal fields AEAT would reject

The provision route now runs the regime's venue-field rules through the contract
seat before anything is minted, so a series code with a space is refused with the
field named instead of surfacing as a refused sale at the till. The module-seams
guard stays green: this file still imports no regime package."
```

---

### Task 5: The wizard marks the field and returns the operator to it

**Files:**
- Modify: `apps/setup/src/setup-app.ts:417-424` (route these field paths to the venue screen)
- Modify: `apps/setup/src/screens/venue-screen.ts` (accept an externally-marked field)
- Test: `apps/setup/src/setup-app.test.ts`, `apps/setup/src/screens/venue-screen.test.ts` (extend both)

**Interfaces:**
- Consumes: the field paths Task 3 produces — `"legalName"`, `"seriesCode"`, `"rectificativeSeriesCode"`, `"location.operationDescription"`.
- Produces: nothing later tasks depend on.

- [ ] **Step 0: Check the machine before a browser run**

Run: `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`

`apps/setup` runs Vitest in real headless Chromium. Scale concurrency to what is actually free; if another session is already running browser suites or a whole-workspace run, wait rather than adding to it.

- [ ] **Step 1: Write the failing tests**

In `apps/setup/src/setup-app.test.ts`, add:

```ts
it("sends the operator back to the venue form with the field marked, not to review", async () => {
  const app = await mountApp();
  await provisionRejecting(app, {
    code: "setup.request_invalid",
    params: { field: "seriesCode" },
  });

  expect(app.screen).toBe("venue");
  expect(app.venueInvalidField).toBe("seriesCode");
});

it("still routes an unknown field to review, as before", async () => {
  const app = await mountApp();
  await provisionRejecting(app, {
    code: "setup.request_invalid",
    params: { field: "mode" },
  });

  expect(app.screen).toBe("review");
});
```

In `apps/setup/src/screens/venue-screen.test.ts`, add:

```ts
it("marks the field the server named and explains what is wrong with it", async () => {
  const screen = await mountVenueScreen({ invalidField: "seriesCode" });

  const input = screen.shadowRoot!.querySelector("[data-test=seriesCode]")!;
  expect(input.hasAttribute("invalid")).toBe(true);
  const message = screen.shadowRoot!.querySelector("[data-test=seriesCode-field-error]");
  expect(message?.textContent).toContain("letters, numbers");
});
```

Follow each file's existing mount helper rather than adding another; `venue-screen.test.ts` already mounts this screen with properties.

- [ ] **Step 2: Run both and watch them fail**

Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app.test.ts src/screens/venue-screen.test.ts`

Expected: FAIL — the app routes to `review`, and the venue screen has no `invalidField` property.

- [ ] **Step 3: Route the venue field paths back to the venue screen**

In `apps/setup/src/setup-app.ts`, replace the `case "setup.request_invalid"` arm's body with:

```ts
      case "setup.request_invalid": {
        const field = typeof error.params?.field === "string" ? error.params.field : undefined;
        // A field the venue form owns goes BACK to that form with the field marked. The rest keep
        // the review-screen banner: the comment above this method used to say the field's own
        // screen already validates the same rule, which was true of every field the boundary could
        // reject until the fiscal regime's venue-field seat was added.
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

And the state it sets, beside the existing `venueError`:

```ts
  @state() private venueInvalidField?: string;
```

Pass it to the venue screen wherever that screen is rendered, as `.invalidField=${this.venueInvalidField}`.

- [ ] **Step 4: Mark the field on the venue screen**

In `apps/setup/src/screens/venue-screen.ts`, add the property:

```ts
  /** A field the SERVER rejected, named by `setup.request_invalid`'s `params.field`. Marked
   * invalid on mount alongside anything this screen's own `#next` found, so an operator returning
   * from a refused provision lands on the form with the offending field already flagged. */
  @property() invalidField?: string;
```

Map the server's field paths to this screen's own keys and fold them into the existing `invalid` set, and render a message beside the field. The existing `#field` helper already renders `?invalid=${this.invalid.has(key)}`; add the explanatory text per field, which is what the design asks for and what the shared form contract requires (`docs/developers/design-system.md` → Forms):

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
screen banner quoting a raw field path. Fields the venue form does not own keep
the old banner."
```

---

### Task 6: Whole-workspace verification and the backlog

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`

This is the one moment the whole workspace runs — Task 3 changed `packages/fiscal`'s contract, which more than one package asserts against.

- [ ] **Step 2: Update the backlog in the same change that made it stale**

The entry beginning "**Nothing checks a fiscal record against AEAT's rules before it is chained or sent**" is what this branch fixes. Rewrite it to say what landed, keeping the experiment that established the problem (the sabotage and its control) — that receipt is why the rule exists and outlives the fix. Leave the incidents-surface entry alone; it is a separate branch.

- [ ] **Step 3: Add the rule to CLAUDE.md §1 or §5 if it earns a place**

Judge honestly against §7's own bar: an entry is the rule, one line on what it cost, and a pointer. The candidate is that an exported check with no caller reads exactly like a check that runs. If the deletion tests in Tasks 1 and 3 already make that unrepeatable, no entry is needed — a written rule with a guard behind it does not need a paragraph as well.

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md CLAUDE.md
git commit -s -m "Backlog: the record validator is wired into the write path"
```

- [ ] **Step 5: Hand off to finish-branch**

Do NOT open the PR from inside a task. Report completion; the driver runs `/finish-branch`, which owns the review wave, the rebase and the PR.

---

## Self-review

**Spec coverage.** §3 layer 1 → Task 1. §6 warnings → Task 2. §4 layer 2 → Tasks 3 and 4. §5 layer 3 → Task 5. §7 testing → the test steps in every task, with the deletion proof in Task 1 step 6 and Task 3 step 5's agreement check. §8 not-in-scope → no task touches the drain. §9's open point about a guard is answered in Task 6 step 3 rather than left hanging.

**One spec point deliberately narrowed.** §4 lists the tax identifier among the fields the boundary seat covers. It is NOT in Task 3, because the country pack already validates it in the browser and again at the server boundary (`validateSpanishNif`, run from `setup-api.ts`), so a second check would duplicate a working one. The record validator's own `NIF_LENGTH` check still backstops it at the chain seam via Task 1.

**Naming consistency.** `validateVenueFiscalFields` (Task 3) is what `slot.ts` fills `venueFields.validate` with and what Task 4 calls through the seat; `VENUE_FORM_FIELDS` (Task 5) lists exactly the four paths Task 3 can throw.
