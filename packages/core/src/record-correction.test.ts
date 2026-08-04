import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, seriesId as brandSeriesId } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
// See record-sale.test.ts's own deviation note: there is no `@waitron/fiscal/testing` subpath. The
// real import path — stated verbatim in `packages/fiscal/src/index.ts`'s closing comment — is
// `@waitron/fiscal/src/testing/fake-backend.js`, used in test files only.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  incidents,
  invoiceSeries,
  saleLines,
  sales,
  withTenant,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import { recordCorrection } from "./record-correction.js";
import type { RecordCorrectionInput } from "./record-correction.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId; // the ordinary (purpose='standard') series seedTenant creates
let rectSeriesId: SeriesId; // a purpose='rectificative' series on the same node
let workingOrderId: WorkingOrderId;
// A manager shift session authorizes the ONE precondition void this suite performs — recordVoid now
// requires `sale.void`, and only the void's authorization matters here, not the correction's caller.
let voidSessionId: string;

// PGlite for everything in this file: the guards here are pure logic (an unknown id, a series of
// the wrong purpose, an unsettled corrective) that a superuser backend exercises just as well as a
// forced-RLS one. The two cross-tenant "hidden reads as not-found" cases genuinely need RLS and
// live in record-correction.rls.test.ts (real Postgres), per the plan's §6 target split.
const suite = usePgliteDb({
  // IDENTITY_MIGRATIONS after CORE: recordVoid now calls `authorize`, which reads persons/sessions.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  // FakeFiscalBackend.recordSale/recordCorrection/checkIntegrity read and write
  // fake_node_registrations/fake_fiscal_records, and nothing else creates those tables.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId, workingOrderId } = await seedTenant(suite.db));
  rectSeriesId = await seedRectificativeSeries(suite.db, tenantId, nodeId);
  // Seed a manager (holds `sale.void`) as the superuser owner and open its session, exactly as the
  // record-void suite does — the precondition void below needs an authorizer.
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'P', ${hashPin("1234")}, 'manager') returning id`,
  );
  const session = await withTenant(suite.db, tenantId, (tx) =>
    loginWithPin(tx, { tenantId, tillId, personId: rows[0]!.id, pin: "1234" }),
  );
  voidSessionId = session.id;
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** Mirrors record-sale.test.ts's helper: the real `TrustedClock` also requires `anchor`/
 * `currentAnchor`, which neither `recordSale` nor `recordCorrection` ever calls. */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale/recordCorrection");
    },
    currentAnchor: () => null,
  };
}

const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

/** The ordinary sale input, later corrected. Immediate settlement so the ORIGINAL is fully paid —
 * which makes "the CORRECTIVE is unsettled" a real assertion rather than a vacuous one. */
function saleInput(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tenantId,
    tillId,
    nodeId,
    seriesId,
    workingOrderId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Coffee" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Water" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    fiscalBackend: "fake",
    clock: steadyClock,
    ...overrides,
  };
}

/** The corrective input: a full reversal of the €14.41 sale — negative total and negative delta
 * lines, drawn from the rectificative series. Descriptions are inherited by neither layer (they
 * reach no fiscal record); the corrective sale's own locale/invoice-locale list is inherited from
 * the original, not supplied here. */
function correctionInput(
  correctsSaleId: SaleId,
  overrides: Partial<RecordCorrectionInput> = {},
): RecordCorrectionInput {
  return {
    tenantId,
    tillId,
    nodeId,
    seriesId: rectSeriesId,
    correctsSaleId,
    total: "-14.41",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Coffee" },
        quantity: "-2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "-10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Water" },
        quantity: "-1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "-2.10",
      },
    ],
    fiscalBackend: "fake",
    clock: steadyClock,
    ...overrides,
  };
}

/** Records an ORIGINAL sale exactly as the application will: as `app_user`, in one transaction,
 * on a node already registered with the backend. */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    await backend.registerNode(tx, nodeId, { tenantId });
    return recordSale(tx, backend, saleInput(overrides));
  });
}

/** Runs `recordCorrection` as `app_user`, in one transaction — the real write path. */
async function correct(
  backend: FiscalBackend,
  correctsSaleId: SaleId,
  overrides: Partial<RecordCorrectionInput> = {},
) {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordCorrection(tx, backend, correctionInput(correctsSaleId, overrides));
  });
}

/** Rows for the CURRENT test's tenant, table-wide. The suite shares one PGlite instance across the
 * file and seeds a fresh tenant per test, so an unscoped count would fold in every earlier test —
 * mirrors record-sale.test.ts's own scoped `countRows`. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where tenant_id = ${tenantId}`,
  );
  return result.rows[0]!.n;
}

/** Rows for one specific sale — what "the CORRECTIVE sale is unsettled" actually means, since the
 * ORIGINAL sale (settled immediately by `sell`) carries tenders and a settlement of its own. */
async function countForSale(table: string, saleId: SaleId): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where sale_id = ${saleId}`,
  );
  return result.rows[0]!.n;
}

describe("recordCorrection — series purpose guard (§5)", () => {
  it("rejects an ordinary (standard) series: a correction must draw a corrective number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expect(correct(backend, saleId, { seriesId })).rejects.toMatchObject({
      code: "sale.series_wrong_purpose",
      params: { seriesId, expected: "rectificative", actual: "standard" },
    });
  });

  it("rejects a series that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await expect(
      correct(backend, saleId, {
        seriesId: brandSeriesId("00000000-0000-4000-8000-000000000000"),
      }),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });

  it("rejects a rectificative series belonging to another node", async () => {
    // A node may own several series, but a series belongs to exactly one node — drawing from
    // another node's counter would let two chains issue from one series.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const other = await seedTenant(suite.db, { tenantId });
    const otherRect = await seedRectificativeSeries(suite.db, tenantId, other.nodeId, "R2");
    await expect(correct(backend, saleId, { seriesId: otherRect })).rejects.toMatchObject({
      code: "sale.series_wrong_node",
      params: { seriesId: otherRect, expected: other.nodeId, actual: nodeId },
    });
  });
});

describe("recordCorrection — the sale being corrected", () => {
  it("rejects a correction of a sale that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(
      correct(backend, "00000000-0000-4000-8000-000000000000" as SaleId),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("rejects a correction when the original was never fiscally recorded", async () => {
    // The original exists in `sales` (so it is not `sale.not_found`) but has no backend record, so
    // there is nothing to reference: the backend throws `fiscal.sale_not_recorded`, mirroring the
    // same precondition `recordVoid` enforces.
    const backend = new FakeFiscalBackend(suite.db);
    const bareOriginal = await seedBareSale(suite.db, { tenantId, tillId, nodeId, seriesId });
    await expect(correct(backend, bareOriginal)).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: bareOriginal },
    });
  });

  it("refuses to correct a voided sale (a voided sale is corrected by nothing)", async () => {
    // A real sale that should never have existed is annulled, not corrected; correcting an already
    // annulled sale is a staff/UI error. Reuses `sale.voided` (ratified decision, plan §4.3).
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await recordVoid(tx, backend, saleId, "Wrong table", { sessionId: voidSessionId });
    });
    await expect(correct(backend, saleId)).rejects.toMatchObject({
      code: "sale.voided",
      params: { saleId },
    });
  });
});

describe("recordCorrection — the corrective sale", () => {
  it("records a negative-total corrective sale linked to the original, in state recorded", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe("-14.41");
    expect(row?.correctsSaleId).toBe(originalId);
    expect(row?.fiscalState).toBe("recorded");
    // Inherited from the original (spec §9: a rectificativa inherits the original list), never
    // supplied on the input.
    expect(row?.locale).toBe("es-ES");
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("allocates the corrective number from the rectificative series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.seriesId).toBe(rectSeriesId);
    expect(row?.invoiceNumber).toBe(1);
    const [series] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, rectSeriesId));
    expect(series?.n).toBe(2); // advanced past the number just allocated
  });

  it("records the negative delta lines against the corrective sale", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, correctiveId));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.lineTotal).sort()).toEqual(["-10.00", "-2.10"]);
  });

  it("asks the backend for a correction record referencing the original", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    const correction = records[1];
    expect(correction?.saleId).toBe(correctiveId);
    expect(correction?.total).toBe("-14.41");
  });
});

describe("recordCorrection — decoupled refund (the corrective is unsettled)", () => {
  it("records no tenders and no settlement for the corrective sale", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId);

    expect(await countForSale("tenders", correctiveId)).toBe(0);
    expect(await countForSale("sale_settlements", correctiveId)).toBe(0);
  });
});

describe("recordCorrection — a sale may be corrected more than once", () => {
  it("allows the same original to be corrected twice, each with its own number", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const first = await correct(backend, originalId);
    const second = await correct(backend, originalId);

    const rows = await suite.db.select().from(sales).where(eq(sales.correctsSaleId, originalId));
    expect(rows.map((r) => r.id).sort()).toEqual([first.saleId, second.saleId].sort());
    const numbers = rows.map((r) => r.invoiceNumber).sort();
    expect(numbers).toEqual([1, 2]);
  });
});

describe("recordCorrection — no fiscal condition blocks a correction (§5)", () => {
  it("completes the correction when chain verification fails, recording an incident on it", async () => {
    // A staff member correcting the very sale an incident concerns must never be blocked by it
    // («NUNCA debe interrumpirse»). The failed check is recorded against the CORRECTIVE sale and
    // the correction proceeds.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);
    backend.breakIntegrity(nodeId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });

    const { saleId: correctiveId } = await correct(backend, originalId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, correctiveId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
  });

  it("records a warning incident when the clock is degraded, and still records the correction", async () => {
    // Clock-confidence degraded is WARN ONLY, never blocking — the same rule the sale path follows.
    const degraded: TrustedClock = fixedClock(() => ({
      instant: BASE,
      offsetMinutes: 60,
      confident: false,
      confidence: "degraded",
      anchorAgeSeconds: 999,
      warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
    }));
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    const { saleId: correctiveId } = await correct(backend, originalId, { clock: degraded });

    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, correctiveId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("clock.degraded");
    expect(rows[0]?.severity).toBe("warning");
    // The correction itself still landed.
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, correctiveId));
    expect(row?.total).toBe("-14.41");
  });

  it("records nothing to incidents when verification and the clock are both clean", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: originalId } = await sell(backend);

    await correct(backend, originalId);

    // Only the corrective path could add one — the original sale's own recordSale ran clean too.
    expect(await countRows("incidents")).toBe(0);
  });
});
