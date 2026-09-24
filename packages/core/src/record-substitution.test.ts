import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  constraintTarget,
  isRefusal,
  isUniqueViolation,
  incidents,
  invoiceSeries,
  RESTRICT_VIOLATION,
  saleLines,
  saleSubstitutions,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin, persons } from "@waitron/identity";
import { recordSubstitution } from "./record-substitution.js";
import type { RecordSubstitutionInput } from "./record-substitution.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId; // the ordinary (purpose='standard') series — the F3 reuses it (owner decision)
// A manager's session authorizes the one precondition void this suite performs.
let voidSessionId: string;

const suite = useVenueDb({
  // `recordVoid` calls `authorize`, which reads identity's tables.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "P", pinHash: hashPin("1234"), role: "manager" })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId, personId: person!.id, pin: "1234" }),
  );
  voidSessionId = session.id;
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` from `now()` alone; nothing under test calls anything else on it. */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale/recordSubstitution");
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

/** The recipient every F3 must carry. */
const RECIPIENT = { taxId: "B12345678", legalName: "Acme Corp SL", countryCode: "ES" };

/** An ordinary simplified (F2) ticket, settled immediately, so "the F3 is unsettled" is not
 * vacuous. */
function saleInput(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tillId,
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Coffee",
        descriptions: { "es-ES": "Coffee" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Water",
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
    clock: steadyClock,
    ...overrides,
  };
}

/** A full invoice restating the tickets: positive total, naming the recipient, drawn from the
 * same standard series the tickets used. */
function substitutionInput(
  substitutedSaleIds: SaleId[],
  overrides: Partial<RecordSubstitutionInput> = {},
): RecordSubstitutionInput {
  return {
    tillId,
    nodeId,
    seriesId,
    substitutedSaleIds,
    counterparty: RECIPIENT,
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Coffee",
        descriptions: { "es-ES": "Coffee" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Water",
        descriptions: { "es-ES": "Water" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    locale: "es-ES",
    invoiceLocales: ["es-ES", "ca-ES"],
    clock: steadyClock,
    ...overrides,
  };
}

/** Records a simplified ticket in one transaction, on a node registered with the backend. */
async function sellTicket(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, saleInput(overrides));
  });
}

async function substitute(
  backend: FiscalBackend,
  substitutedSaleIds: SaleId[],
  overrides: Partial<RecordSubstitutionInput> = {},
) {
  return withTransaction(suite.db, async (tx) => {
    return recordSubstitution(tx, backend, substitutionInput(substitutedSaleIds, overrides));
  });
}

/** Counts every row in `table`; the suite helper empties the tables between tests. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)}`,
  );
  return result.rows[0]!.n;
}

/** Rows for one sale: each ticket, settled by `sellTicket`, has tenders and a settlement of its
 * own. */
async function countForSale(table: string, saleId: SaleId): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)} where sale_id = ${saleId}`,
  );
  return result.rows[0]!.n;
}

describe("recordSubstitution — the substituted tickets (input guards)", () => {
  it("rejects an empty substitutedSaleIds list (an F3 must name at least one ticket)", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(substitute(backend, [])).rejects.toThrow(/at least one/i);
  });

  it("rejects duplicate ids in the input list (defense-in-depth, never trusting the backend)", async () => {
    // Refused in core, and distinct from `sale.already_substituted`, which is a ticket exchanged by
    // a prior, committed F3.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await expect(substitute(backend, [saleId, saleId])).rejects.toThrow(/duplicate/i);
  });

  it("rejects a substituted ticket that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(
      substitute(backend, [brandSaleId("00000000-0000-4000-8000-000000000000")]),
    ).rejects.toMatchObject({
      code: "sale.not_found",
      params: { saleId: "00000000-0000-4000-8000-000000000000" },
    });
  });

  it("refuses to substitute a voided ticket (a voided ticket is exchanged by nothing)", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await withTransaction(suite.db, async (tx) => {
      await recordVoid(tx, backend, saleId, "Wrong table", { sessionId: voidSessionId });
    });
    await expect(substitute(backend, [saleId])).rejects.toMatchObject({
      code: "sale.voided",
      params: { saleId },
    });
  });

  it("refuses to substitute a ticket already substituted by a prior F3 (at most once)", async () => {
    // The unique `substituted_sale_id` is the control: a ticket exchanged twice would put one
    // operation in two canje invoices.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await substitute(backend, [saleId]); // the first F3 succeeds
    await expect(substitute(backend, [saleId])).rejects.toMatchObject({
      code: "sale.already_substituted",
      params: { saleId },
    });
  });
});

describe("recordSubstitution — error propagation", () => {
  it("propagates a sale_substitutions error that is not a unique violation, untranslated", async () => {
    // Any other insert failure must reach the caller as it arrived, not as
    // `sale.already_substituted`. Provoked by a `RAISE(ABORT)` trigger, because SQLite cannot add a
    // CHECK to an existing table; its refusal is not a unique violation. Dropped in `finally`.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await suite.db.execute(
      sql`create trigger tmp_refuse_everything before insert on sale_substitutions
          for each row begin select raise(abort, 'refused'); end`,
    );
    try {
      const error = await captureError(() =>
        withTransaction(suite.db, (tx) =>
          recordSubstitution(tx, backend, substitutionInput([saleId])),
        ),
      );
      expect(error).not.toBeInstanceOf(AppError);
      expect(isUniqueViolation(error)).toBe(false);
      expect(isRefusal(error, RESTRICT_VIOLATION)).toBe(true);
    } finally {
      await suite.db.execute(sql`drop trigger tmp_refuse_everything`);
    }
  });
});

describe("recordSubstitution — the series (node-ownership guards)", () => {
  it("rejects a series that does not exist", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await expect(
      substitute(backend, [saleId], {
        seriesId: brandSeriesId("00000000-0000-4000-8000-000000000000"),
      }),
    ).rejects.toMatchObject({ code: "sale.series_not_found" });
  });

  it("rejects a series belonging to another node", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    const other = await seedTenant(suite.db);
    await expect(substitute(backend, [saleId], { seriesId: other.seriesId })).rejects.toMatchObject(
      {
        code: "sale.series_wrong_node",
        params: { seriesId: other.seriesId, expected: other.nodeId, actual: nodeId },
      },
    );
  });

  it("rejects a non-standard series: an F3 draws its number from the standard series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    const rectSeries = await seedRectificativeSeries(suite.db, nodeId);
    await expect(substitute(backend, [saleId], { seriesId: rectSeries })).rejects.toMatchObject({
      code: "sale.series_wrong_purpose",
      params: { seriesId: rectSeries, expected: "standard", actual: "rectificative" },
    });
    expect(await countRows("sale_substitutions")).toBe(0);
    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale"]); // only the ticket's sale record, no F3
  });

  it("rejects a RETIRED series: a restored box must never number from the series it was restored with", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    const retiredAt = new Date("2026-09-06T10:00:00.000Z");
    await suite.db.update(invoiceSeries).set({ retiredAt }).where(eq(invoiceSeries.id, seriesId));
    try {
      await expect(substitute(backend, [saleId])).rejects.toMatchObject({
        code: "sale.series_retired",
        params: { seriesId, retiredAt: retiredAt.toISOString() },
      });
    } finally {
      await suite.db
        .update(invoiceSeries)
        .set({ retiredAt: null })
        .where(eq(invoiceSeries.id, seriesId));
    }
  });
});

describe("recordSubstitution — the F3 sale", () => {
  it("records a positive-total F3 naming its recipient, correcting nothing, in state recorded", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    // Read straight off `sales`, so the total is a count of whole cents: 1441 is 14.41.
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, f3Id));
    expect(row?.total).toBe(1441);
    expect(row?.correctsSaleId).toBe(null); // an F3 is NOT a corrective invoice — it corrects nothing
    expect(row?.fiscalState).toBe("recorded");
    expect(row?.counterpartyTaxId).toBe("B12345678");
    expect(row?.counterpartyLegalName).toBe("Acme Corp SL");
    expect(row?.counterpartyCountryCode).toBe("ES");
    expect(row?.locale).toBe("es-ES");
    expect(row?.invoiceLocales).toEqual(["es-ES", "ca-ES"]);
  });

  it("writes the backend's own id into sales.fiscal_backend", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, f3Id));
    expect(backend.id).toBe("fake");
    expect(row?.fiscalBackend).toBe(backend.id);
  });

  it("allocates the F3 number from the reused standard series", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend); // takes number 1 from the standard series

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, f3Id));
    expect(row?.seriesId).toBe(seriesId);
    expect(row?.invoiceNumber).toBe(2); // the next number after the ticket's own
    const [series] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(series?.n).toBe(3);
  });

  it("records the F3's own positive lines", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    const lines = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, f3Id));
    expect(lines).toHaveLength(2);
    // Whole cents off the table, and a numeric sort: the default one orders numbers as text.
    expect(lines.map((l) => l.lineTotal).sort((x, y) => x - y)).toEqual([210, 1000]);
  });

  it("links every substituted ticket via sale_substitutions (the N:1 fan-out)", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: t1 } = await sellTicket(backend);
    const { saleId: t2 } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [t1, t2]);

    const links = await suite.db
      .select()
      .from(saleSubstitutions)
      .where(eq(saleSubstitutions.substitutionSaleId, f3Id));
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.substitutedSaleId).sort()).toEqual([t1, t2].sort());
  });

  it("asks the backend for a substitution record naming the F3", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "substitution"]);
    const substitution = records[1];
    expect(substitution?.saleId).toBe(f3Id);
    expect(substitution?.total).toBe("14.41");
  });
});

describe("recordSubstitution — no double charge (the F3 is unsettled)", () => {
  it("records no tenders and no settlement for the F3 (the money was collected on the tickets)", async () => {
    // «no cobrar dos veces»: the customer paid on the tickets.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    expect(await countForSale("tenders", f3Id)).toBe(0);
    expect(await countForSale("sale_settlements", f3Id)).toBe(0);
  });
});

describe("recordSubstitution — a mixed batch fails atomically", () => {
  it("chains nothing when one ticket in the batch was never fiscally recorded", async () => {
    // One ticket is recorded; the other exists in `sales` with no fiscal record. The fake backend
    // refuses the batch and the whole transaction rolls back.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: recorded } = await sellTicket(backend); // number 1, has a fiscal record
    const unrecorded = await seedBareSale(
      suite.db,
      { tillId, nodeId, seriesId },
      { invoiceNumber: 99 }, // distinct number: avoids the series-unique collision with the ticket
    );

    await expect(substitute(backend, [recorded, unrecorded])).rejects.toMatchObject({
      code: "fiscal.sale_not_recorded",
      params: { saleId: unrecorded },
    });

    // Nothing partial survived the rollback.
    expect(await countRows("sale_substitutions")).toBe(0);
    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale"]); // only the ticket's own sale record, no F3
    const [series] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(series?.n).toBe(2); // the F3's allocation rolled back — no permanent hole
  });
});

describe("recordSubstitution — no fiscal condition blocks an F3 (§5)", () => {
  it("completes when chain verification fails, recording an incident on the F3", async () => {
    // A customer is waiting for a proper invoice; a chain-integrity failure must never block it.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);
    backend.breakIntegrity(nodeId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "substitution"]);
    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, f3Id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
  });

  it("records a warning incident when the clock is degraded, and still records the F3", async () => {
    const degraded: TrustedClock = fixedClock(() => ({
      instant: BASE,
      offsetMinutes: 60,
      confident: false,
      confidence: "degraded",
      anchorAgeSeconds: 999,
      warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
    }));
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket], { clock: degraded });

    const rows = await suite.db.select().from(incidents).where(eq(incidents.saleId, f3Id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("clock.degraded");
    expect(rows[0]?.severity).toBe("warning");
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, f3Id));
    expect(row?.total).toBe(1441); // the F3 itself still landed, 1441 cents being 14.41
  });

  it("records nothing to incidents when verification and the clock are both clean", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    await substitute(backend, [ticket]);

    // The ticket's own recordSale ran clean too.
    expect(await countRows("incidents")).toBe(0);
  });
});

it("persists the frozen options answers and child links on the issued lines", async () => {
  const backend = new FakeFiscalBackend(suite.db);
  const original = await sellTicket(backend);
  // Three different texts per name, so an assertion cannot pass while the wrong one is read.
  const optionSnapshots = [
    {
      listName: { en: "Milk" },
      listCustomerName: { en: "Which milk?" },
      listKitchenName: "MILK",
      labelName: { en: "Oat" },
      labelCustomerName: { en: "Oat milk" },
      labelKitchenName: "OAT",
    },
    {
      listName: { en: "Ice" },
      listCustomerName: { en: "How much ice?" },
      listKitchenName: "ICE",
      labelName: { en: "None" },
      labelCustomerName: { en: "No ice" },
      labelKitchenName: "NOICE",
    },
  ];
  const lines = substitutionInput([original.saleId]).lines.map((line, index) => ({
    ...line,
    optionSnapshots: index === 0 ? optionSnapshots : [],
    parentLineNo: index === 0 ? null : 1,
    category: "Drinks",
  }));
  const { saleId } = await substitute(backend, [original.saleId], { lines });
  const saved = await suite.db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.lineNo);
  expect(saved.map((line) => line.optionSnapshots)).toEqual([optionSnapshots, []]);
  expect(saved[0]!.parentLineId).toBeNull();
  expect(saved[1]!.parentLineId).toBe(saved[0]!.id);
  expect(saved.map((line) => line.category)).toEqual(["Drinks", "Drinks"]);
});

it("rejects repeated line numbers in a multi-ticket substitution without recording a sale", async () => {
  const backend = new FakeFiscalBackend(suite.db);
  const first = await sellTicket(backend);
  const second = await sellTicket(backend);
  const ids = [first.saleId, second.saleId];
  const lines = substitutionInput(ids).lines.map((line) => ({ ...line, lineNo: 1 }));
  const before = await countRows("sales");
  const error = await captureError(() => substitute(backend, ids, { lines }));
  // WHICH key: the repeated line number.
  expect(isUniqueViolation(error)).toBe(true);
  expect(constraintTarget(error)).toEqual({ table: "sale_lines", columns: ["sale_id", "line_no"] });
  expect(await countRows("sales")).toBe(before);
  expect(await countRows("sale_substitutions")).toBe(0);
});
