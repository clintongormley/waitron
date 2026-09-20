import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
// See record-correction.test.ts's own note: there is no `@waitron/fiscal/testing` subpath; the real
// import path is `@waitron/fiscal/src/testing/fake-backend.js`, used in test files only.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  captureError,
  incidents,
  invoiceSeries,
  pgErrorCode,
  saleLines,
  saleSubstitutions,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import { recordSubstitution } from "./record-substitution.js";
import type { RecordSubstitutionInput } from "./record-substitution.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedBareSale, seedRectificativeSeries, seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId; // the ordinary (purpose='standard') series — the F3 reuses it (owner decision)
// A manager shift session authorizes the ONE precondition void this suite performs — recordVoid now
// requires `sale.void`, and only the void's authorization matters here, not the substitution's caller.
let voidSessionId: string;

// The deployment holds one tenant per database. PGlite for everything in this file: the guards
// here are pure logic (an empty list, a duplicate id, an unknown/voided/already-substituted
// ticket, a wrong-node series) that a superuser backend exercises just as well as a non-superuser
// one. `sale.not_found` and `sale.series_not_found` are asserted below for a genuinely ABSENT
// row, which is what those codes mean here — the same shape record-correction.test.ts uses.
const suite = useVenueDb({
  // IDENTITY_MIGRATIONS after CORE: recordVoid now calls `authorize`, which reads persons/sessions.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  // FakeFiscalBackend.recordSale/recordSubstitution/checkIntegrity read and write
  // fake_node_registrations/fake_fiscal_records, and nothing else creates those tables.
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
  // Seed a manager (holds `sale.void`) as the superuser owner and open its session — the precondition
  // void below needs an authorizer, exactly as the record-void suite arranges.
  const { rows } = await suite.db.execute<{ id: string }>(
    sql`insert into persons (display_name, pin_hash, role)
        values ('P', ${hashPin("1234")}, 'manager') returning id`,
  );
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId, personId: rows[0]!.id, pin: "1234" }),
  );
  voidSessionId = session.id;
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** Mirrors record-correction.test.ts's helper: the real `TrustedClock` also requires `anchor`/
 * `currentAnchor`, which neither `recordSale` nor `recordSubstitution` ever calls. */
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

/** The recipient every F3 must carry — a full invoice always names its recipient (findings
 * §10.2). Neutral English-ish legal name; `test/` is out of english-only's scan (it walks `src/`
 * only), but a Spanish token here would still read as noise. */
const RECIPIENT = { taxId: "B12345678", legalName: "Acme Corp SL", countryCode: "ES" };

/** An ordinary simplified (F2) ticket, settled immediately so the ORIGINAL is fully paid — which
 * makes "the F3 is unsettled" a real assertion rather than a vacuous one. */
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

/** The F3 input: a full invoice restating the substituted tickets, POSITIVE total, naming the
 * recipient. Drawn from the SAME standard series the tickets used (the reuse decision). */
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

/** Records an ORIGINAL simplified ticket exactly as the application will: as `app_user`, in one
 * transaction, on a node already registered with the backend. */
async function sellTicket(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, saleInput(overrides));
  });
}

/** Runs `recordSubstitution` as `app_user`, in one transaction — the real write path. */
async function substitute(
  backend: FiscalBackend,
  substitutedSaleIds: SaleId[],
  overrides: Partial<RecordSubstitutionInput> = {},
) {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return recordSubstitution(tx, backend, substitutionInput(substitutedSaleIds, overrides));
  });
}

/** Counts every row in `table`. The suite helper truncates between tests (`resetPerTest`, the
 * default in `@waitron/db/testing/lifecycle.js`), so the count is what THIS test wrote. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)}`,
  );
  return result.rows[0]!.n;
}

/** Rows for one specific sale — what "the F3 is unsettled" actually means, since each substituted
 * ticket (settled immediately by `sellTicket`) carries tenders and a settlement of its own. */
async function countForSale(table: string, saleId: SaleId): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where sale_id = ${saleId}`,
  );
  return result.rows[0]!.n;
}

describe("recordSubstitution — the substituted tickets (input guards)", () => {
  it("rejects an empty substitutedSaleIds list (an F3 must name at least one ticket)", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    await expect(substitute(backend, [])).rejects.toThrow(/at least one/i);
  });

  it("rejects duplicate ids in the input list (defense-in-depth, never trusting the backend)", async () => {
    // A repeated id would double an F3's `FacturasSustituidas` and its `sale_substitutions` rows.
    // Rejected HERE at the core layer, distinct from `sale.already_substituted` (a ticket substituted
    // by a PRIOR, committed F3) — the message names the distinct concept so a caller can tell them
    // apart.
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
    // A ticket annulled because it should never have existed cannot be exchanged for a full invoice;
    // reuses `sale.voided`, the same code `recordCorrection` reuses for the analogous refusal.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
      await recordVoid(tx, backend, saleId, "Wrong table", { sessionId: voidSessionId });
    });
    await expect(substitute(backend, [saleId])).rejects.toMatchObject({
      code: "sale.voided",
      params: { saleId },
    });
  });

  it("refuses to substitute a ticket already substituted by a prior F3 (at most once)", async () => {
    // The `unique(substituted_sale_id)` on sale_substitutions is the real control — a
    // ticket exchanged twice would put the same operation in two canje invoices. Translated to
    // `sale.already_substituted`, the way `recordVoid` translates its own double-void unique
    // violation into `sale.already_voided`.
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
    // The insert's OTHER failure path: any reason `sale_substitutions` could reject BESIDES the
    // `substituted_sale_id` unique (a constraint added later, an FK violation) must reach the caller
    // as-is rather than being misreported as `sale.already_substituted` — mirrors record-void.ts's
    // identical "not a unique violation" test.
    //
    // Provoked by adding a CHECK that no row can satisfy, which is the "a constraint added later"
    // case stated literally: the insert then fails with 23514, not 23505. The constraint is dropped
    // in the `finally` so nothing after this case sees it.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sellTicket(backend);
    await suite.db.execute(
      sql`alter table sale_substitutions add constraint tmp_refuse_everything check (false) not valid`,
    );
    try {
      const error = await captureError(() =>
        withTransaction(suite.db, (tx) =>
          recordSubstitution(tx, backend, substitutionInput([saleId])),
        ),
      );
      expect(error).not.toBeInstanceOf(AppError);
      expect(pgErrorCode(error)).toBe("23514"); // check_violation, not 23505 (unique)
    } finally {
      await suite.db.execute(
        sql`alter table sale_substitutions drop constraint tmp_refuse_everything`,
      );
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
    // A node may own several series, but a series belongs to exactly one node — drawing the F3's
    // number from another node's counter would let two chains issue from one series.
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
    // The F3 reuses the `standard` series; a `rectificative` (or any non-standard) series must be
    // refused, or the F3 would draw an invoice number from a series reserved for a different
    // purpose — corrupting a legally-load-bearing, unrepairable series. Mirrors record-sale.ts /
    // record-correction.ts's symmetric purpose guard. The guard fires before any write, so nothing
    // is chained.
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

    const [row] = await suite.db.select().from(sales).where(eq(sales.id, f3Id));
    expect(row?.total).toBe("14.41");
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
    expect(lines.map((l) => l.lineTotal).sort()).toEqual(["10.00", "2.10"]);
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
    // «no cobrar dos veces» (findings §10.2): the customer paid on the simplified ticket(s); the F3
    // introduces no new charge, so it carries no tender and no settlement.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    const { saleId: f3Id } = await substitute(backend, [ticket]);

    expect(await countForSale("tenders", f3Id)).toBe(0);
    expect(await countForSale("sale_settlements", f3Id)).toBe(0);
  });
});

describe("recordSubstitution — a mixed batch fails atomically", () => {
  it("chains nothing when one ticket in the batch was never fiscally recorded", async () => {
    // One ticket is real and recorded; the other exists in `sales` but has NO backend record. The
    // backend rejects the batch (`fiscal.sale_not_recorded`) and the WHOLE transaction rolls back —
    // no F3 sale, no sale_substitutions rows, no chained record, no burned series number.
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
    // A customer is waiting for a proper invoice; a chain-integrity failure must never block issuing
    // it. The failed check is recorded against the F3 and the F3 proceeds.
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
    expect(row?.total).toBe("14.41"); // the F3 itself still landed
  });

  it("records nothing to incidents when verification and the clock are both clean", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: ticket } = await sellTicket(backend);

    await substitute(backend, [ticket]);

    // Only the F3 path could add one — the ticket's own recordSale ran clean too.
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
  expect(pgErrorCode(error)).toBe("23505");
  expect(await countRows("sales")).toBe(before);
  expect(await countRows("sale_substitutions")).toBe(0);
});
