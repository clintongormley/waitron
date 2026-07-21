import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
// See record-sale.test.ts's identical deviation note: there is no `@waitron/fiscal/testing`
// subpath. `packages/fiscal/src/index.ts`'s own closing comment states the real path.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  createPgliteDb,
  incidents,
  pgErrorMessage,
  runMigrations,
  sales,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { openIncidents, recordIncident } from "./incidents.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { seedTenant } from "../test/fixtures.js";

let db: Database;
let tenantId: TenantId;
let tillId: TillId;
let seriesId: SeriesId;
let workingOrderId: WorkingOrderId;

// PGlite boots a WASM PostgreSQL and then runs @waitron/db's own migrations, well past Vitest's
// 5s default hook timeout — mirrors record-sale.test.ts's identical beforeAll for the identical
// reason.
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await FakeFiscalBackend.install(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  ({ tenantId, tillId, seriesId, workingOrderId } = await seedTenant(db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * Builds a `TrustedClock` from a `now()` implementation alone, matching record-sale.test.ts's
 * and record-void.test.ts's identical helper: the real `TrustedClock` interface also requires
 * `anchor`/`currentAnchor`, which `recordSale` never calls.
 */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

/** Confident, fixed, +01:00 — the ordinary case. */
const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

/**
 * Degraded, fixed. Reads `tillId` lazily (inside `now()`, invoked only once a test's own
 * `beforeEach` has already set it) rather than capturing it at module-eval time.
 *
 * Carries `warning` itself, exactly as `packages/fiscal`'s real `createTrustedClock` would
 * construct it (`clock.ts`'s own `now()`) — `recordSale` forwards `now.warning` verbatim (see
 * `./record-sale.ts`), so a fixture that omitted it would test a codepath `recordSale` never
 * actually takes with a real clock.
 */
const degradedClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: false,
  confidence: "degraded",
  anchorAgeSeconds: 999,
  warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
}));

function input(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tenantId,
    tillId,
    seriesId,
    workingOrderId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    tipAmount: "1.90",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    tenders: [{ method: "card", amount: "16.31", settledAt: BASE }],
    fiscalBackend: "fake",
    clock: steadyClock,
    ...overrides,
  };
}

/**
 * A backend whose `checkIntegrity` reports one failed issue on the current test's `tillId`.
 *
 * **Deviation from the brief.** The brief's `failingChain()` set `backend.chainVerification =
 * { ok: false, error: new AppError(...) }` — not a real affordance on `FakeFiscalBackend`, and
 * itself contradicted by this same task's own governing dispatch, which states the real
 * `IntegrityReport` shape is `{ ok, checked, issues }`. The actual test-only control is
 * `breakIntegrity(tillId, issue)`, taking a plain `IntegrityIssue` (`{ code, params, recordId? }`)
 * — the identical substitution record-sale.test.ts's and record-void.test.ts's own
 * "no fiscal condition blocks a sale"/"no fiscal condition blocks a void" tests already made.
 */
function failingChain(): FakeFiscalBackend {
  const backend = new FakeFiscalBackend(db);
  backend.breakIntegrity(tillId, {
    code: "predecessor-hash-mismatch",
    params: { sequence: 7, expected: "ABC" },
  });
  return backend;
}

/**
 * Runs the write path exactly as the application will: registers the till with the injected
 * backend, then sells as `app_user` inside one transaction — mirrors record-sale.test.ts's own
 * `run` helper (registration is required; `FakeFiscalBackend` refuses `recordSale` for a till
 * with no prior `registerTill`, exactly like a real backend).
 */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.registerTill(tx, tillId, { tenantId });
    return recordSale(tx, backend, input(overrides));
  });
}

/**
 * Scoped to the CURRENT test's own till, never the bare table. This suite shares ONE PGlite
 * instance across the whole file (booting a fresh WASM Postgres per test would be far slower) and
 * reseeds a fresh tenant/till per test rather than truncating, so an earlier test's incident rows
 * would otherwise be counted here too — the identical "Deviation from the brief" record-sale.
 * test.ts's own `countRows` helper documents for `sales`/`sale_lines`/`tenders`.
 */
async function incidentsForTill(till: TillId) {
  return db.select().from(incidents).where(eq(incidents.tillId, till));
}

describe("incidents — chain verification failure", () => {
  it("records an incident and still completes the sale", async () => {
    const backend = failingChain();
    const { saleId } = await sell(backend);

    const rows = await incidentsForTill(tillId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
    expect(rows[0]?.saleId).toBe(saleId);
    // The sale completed and the record was chained ANYWAY. Both halves matter: a suite
    // asserting only the incident row would pass against an implementation that recorded the
    // incident and then aborted.
    expect(await db.select().from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
    expect(await backend.recordsFor(tillId)).toHaveLength(1);
  });

  it("carries the module's structured issue detail, not a rendered message", async () => {
    // **Deviation from the brief.** The brief expected `row.params` to equal the injected issue's
    // OWN params flatly (`{ tillId, sequence, expected }`). This task's own dispatch resolves
    // Step 2's ambiguity explicitly: `chain.verification_failed` is the `ErrorCode` recordSale
    // maps an ISSUE onto when rendering an incident, not something `checkIntegrity` returns —
    // so every chain-verification incident carries this ONE stable, translatable code regardless
    // of which regime-specific issue kind the module actually reported, with that issue's own
    // code and params nested underneath for support to read. See ./errors.ts's doc comment on
    // this code.
    await sell(failingChain());
    const [row] = await incidentsForTill(tillId);
    expect(row?.params).toEqual({
      tillId,
      issueCode: "predecessor-hash-mismatch",
      recordId: null,
      issueParams: { sequence: 7, expected: "ABC" },
    });
  });

  it("writes the incident in the same transaction as the sale", async () => {
    // A separate connection would let an incident exist for a sale that rolled back, or a sale
    // exist for an incident that did. Force the rollback after recordSale returns and confirm
    // neither survives.
    const backend = failingChain();
    await expect(
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await backend.registerTill(tx, tillId, { tenantId });
        await recordSale(tx, backend, input());
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash");

    expect(await incidentsForTill(tillId)).toHaveLength(0);
    expect(await db.select().from(sales).where(eq(sales.tillId, tillId))).toHaveLength(0);
  });
});

describe("incidents — clock degradation", () => {
  it("records a warning, not an error", async () => {
    // Spec §4: clock confidence degraded is WARN ONLY. Recording it at error severity would put
    // it in the same visual channel as a chain failure and train staff to ignore both.
    await sell(new FakeFiscalBackend(db), { clock: degradedClock });
    const [row] = await incidentsForTill(tillId);
    expect(row?.code).toBe("clock.degraded");
    expect(row?.severity).toBe("warning");
    expect(await db.select().from(sales).where(eq(sales.tillId, tillId))).toHaveLength(1);
  });

  it("records both incidents when the chain fails and the clock is degraded", async () => {
    await sell(failingChain(), { clock: degradedClock });
    const rows = await incidentsForTill(tillId);
    expect(rows.map((r) => r.code).sort()).toEqual(["chain.verification_failed", "clock.degraded"]);
  });

  it("records nothing when verification passes and the clock is confident", async () => {
    // The negative case. Without it, an implementation that records an incident unconditionally
    // passes every test above.
    await sell(new FakeFiscalBackend(db));
    expect(await incidentsForTill(tillId)).toHaveLength(0);
  });
});

describe("recordIncident — no sale attached", () => {
  it("records an incident with a null sale_id when the caller supplies no saleId", async () => {
    // `RecordIncidentInput.saleId` is optional: plan 3's drainer raises incidents (a submission
    // failure discovered hours after the sale) with no sale in hand at the call site — see
    // ./incidents.ts's own doc comment on `saleId`. Nothing in Task 18's own write path omits it
    // (`recordSale`/`recordVoid` always have one), so this is the one place that path is
    // exercised at all before plan 3 exists to call it for real.
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await recordIncident(tx, {
        tenantId,
        tillId,
        error: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
        severity: "warning",
        detectedAt: BASE,
      });
    });
    const [row] = await incidentsForTill(tillId);
    expect(row?.saleId).toBeNull();
  });
});

describe("openIncidents", () => {
  it("returns unacknowledged incidents for a till, newest first", async () => {
    // Two DISTINCT instants, not one fixed `BASE` shared by both sells: with an identical
    // `detected_at` on both rows, "newest first" is unverifiable rather than merely untested.
    const later: TrustedClock = fixedClock(() => ({
      instant: new Date(BASE.getTime() + 60_000),
      offsetMinutes: 60,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }));
    await sell(failingChain());
    await sell(failingChain(), { clock: later });
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detectedAt.getTime()).toBeGreaterThan(rows[1]!.detectedAt.getTime());
  });

  it("excludes acknowledged incidents", async () => {
    await sell(failingChain());
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      // The one permitted mutation, and it must be permitted for app_user — a column-level GRANT
      // that omitted acknowledged_at would fail here. No WHERE clause: RLS already scopes this
      // update to the current tenant, and this test's tenant owns exactly the one row `sell` just
      // wrote.
      await tx.update(incidents).set({ acknowledgedAt: new Date().toISOString() });
    });
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(0);
  });

  it("scopes incidents to one till", async () => {
    const other = await seedTenant(db, { tenantId });
    await sell(failingChain());
    const rows = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return openIncidents(tx, other.tillId);
    });
    expect(rows).toHaveLength(0);
  });

  it("refuses to rewrite an incident's code as the application role", async () => {
    // The column-level GRANT is the control. Without it, "an incident is a record, not a note"
    // would rest on nobody writing the UPDATE.
    //
    // **Deviation from the brief.** `.rejects.toThrow(/permission denied/i)` inspects only
    // `Error.message`, and drizzle-orm@0.45.2 wraps every failed query in a `DrizzleQueryError`
    // whose own `.message` is `Failed query: <sql>` — the real Postgres text lives on `.cause`.
    // `captureError`/`pgErrorMessage` (this task's own governing conventions) read that instead.
    await sell(failingChain());
    const error = await captureError(() =>
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.update(incidents).set({ code: "nothing.happened" });
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table incidents/);
  });
});
