import { beforeEach, describe, expect, it } from "vitest";
import { AppError, decimal, nodeId, saleId, seriesId, tillId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleForFiscalRecord } from "../backend.js";
import { FakeFiscalBackend } from "./fake-backend.js";

// The fake keys its records on node and ignores the till.
const NODE_A = nodeId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const NODE_B = nodeId("6ba7b810-9dad-11d1-80b4-00c04fd430c9");
const SNAPSHOT_TILL = tillId("7ba7b810-9dad-11d1-80b4-00c04fd430c0");

let backend: FakeFiscalBackend;

function saleOn(node: typeof NODE_A, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tillId: SNAPSHOT_TILL,
    nodeId: node,
    saleId: saleId(`11111111-2222-3333-4444-${String(invoiceNumber).padStart(12, "0")}`),
    seriesId: seriesId("99999999-8888-7777-6666-555555555555"),
    seriesCode: "T1",
    invoiceNumber,
    issuedAt: new Date("2027-03-14T10:00:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Restauración",
    total: decimal("12.10"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
    counterparty: null,
  };
}

const suite = useVenueDb({ migrations: [], setup: (db) => FakeFiscalBackend.install(db) });

beforeEach(async () => {
  await FakeFiscalBackend.truncate(suite.db);
  backend = new FakeFiscalBackend(suite.db);
});

describe("registration", () => {
  it("records a registration and returns an opaque registration id", () => {
    return suite.db.transaction(async (tx) => {
      const registration = await backend.registerNode(tx, NODE_A);
      expect(registration.nodeId).toBe(NODE_A);
      expect(registration.registrationId).toMatch(/^fake-/);
    });
  });

  it("refuses to record a sale for a node that was never registered", async () => {
    await expect(
      suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1))),
    ).rejects.toThrowError(AppError);
  });

  it("names the node in the refusal params", async () => {
    try {
      await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
      expect.unreachable("recordSale should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.node_not_registered");
      expect((error as AppError).params).toEqual({ nodeId: NODE_A });
    }
  });
});

describe("recordSale", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("returns a ref naming the backend and the record", async () => {
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    expect(ref.backend).toBe("fake");
    expect(ref.recordId).toMatch(/^fake-/);
    expect(ref.state).toBe("pending");
  });

  it("stores the exact total it was given, digit for digit", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    const [record] = await backend.recordsFor(NODE_A);
    expect(record.total).toBe("12.10");
  });

  it("rejects a total that is not an exact decimal string", async () => {
    const sale = { ...saleOn(NODE_A, 1), total: 12.1 as never };
    await expect(suite.db.transaction((tx) => backend.recordSale(tx, sale))).rejects.toThrowError(
      AppError,
    );
  });

  it("assigns strictly increasing sequences within a node", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 2)));
    const sequences = (await backend.recordsFor(NODE_A)).map((r) => r.sequence);
    expect(sequences).toEqual([1, 2]);
  });

  it("numbers nodes independently of each other", async () => {
    await suite.db.transaction((tx) => backend.registerNode(tx, NODE_B));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_B, 1)));
    expect((await backend.recordsFor(NODE_A)).map((r) => r.sequence)).toEqual([1]);
    expect((await backend.recordsFor(NODE_B)).map((r) => r.sequence)).toEqual([1]);
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    await expect(
      suite.db.transaction(async (tx) => {
        await backend.recordSale(tx, saleOn(NODE_A, 1));
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect(await backend.recordsFor(NODE_A)).toEqual([]);
  });
});

describe("checkIntegrity", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("reports how many records it checked, not merely that it is happy", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 2)));
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, NODE_A));
    expect(report).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("reports zero checked on a node with no records, without complaining", async () => {
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, NODE_A));
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("surfaces an injected issue", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    backend.breakIntegrity(NODE_A, { code: "fake.tampered", params: { sequence: 1 } });
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, NODE_A));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([{ code: "fake.tampered", params: { sequence: 1 } }]);
  });

  it("still records the next sale after a failed check", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    backend.breakIntegrity(NODE_A, { code: "fake.tampered", params: { sequence: 1 } });
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 2)));
    expect(ref.recordId).toMatch(/^fake-/);
    expect((await backend.recordsFor(NODE_A)).map((r) => r.sequence)).toEqual([1, 2]);
  });

  it("recovers when the injected issue is cleared", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    backend.breakIntegrity(NODE_A, { code: "fake.tampered", params: { sequence: 1 } });
    backend.restoreIntegrity(NODE_A);
    expect((await suite.db.transaction((tx) => backend.checkIntegrity(tx, NODE_A))).ok).toBe(true);
  });
});

describe("pendingCount", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("counts records that have not been acknowledged", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 2)));
    expect(await backend.pendingCount(NODE_A)).toBe(2);
  });

  it("drops when a record is acknowledged, so it is not a constant", async () => {
    // A stub returning the record count would pass the test above and fail this one.
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 2)));
    await backend.acknowledge(ref.recordId);
    expect(await backend.pendingCount(NODE_A)).toBe(1);
  });

  it("is scoped to one node", async () => {
    await suite.db.transaction((tx) => backend.registerNode(tx, NODE_B));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(NODE_A, 1)));
    expect(await backend.pendingCount(NODE_B)).toBe(0);
  });

  it("is zero for a node that has never recorded anything", async () => {
    expect(await backend.pendingCount(NODE_A)).toBe(0);
  });
});

describe("recordVoid", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("refuses to void a sale that was never recorded", async () => {
    const unknown = saleId("00000000-0000-0000-0000-000000000000");
    try {
      await suite.db.transaction((tx) => backend.recordVoid(tx, unknown, "staff error"));
      expect.unreachable("recordVoid should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("records a second record rather than editing the first", async () => {
    const sale = saleOn(NODE_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, sale));
    const ref = await suite.db.transaction((tx) =>
      backend.recordVoid(tx, sale.saleId, "staff error"),
    );
    const records = await backend.recordsFor(NODE_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(ref.recordId).toBe(records[1].recordId);
  });
});

describe("recordCorrection", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("refuses to correct a sale that was never recorded", async () => {
    const unrecorded = saleId("00000000-0000-0000-0000-000000000000");
    const corrective = { ...saleOn(NODE_A, 2), total: decimal("-12.10") };
    try {
      await suite.db.transaction((tx) =>
        backend.recordCorrection(tx, corrective, { correctsSaleId: unrecorded }),
      );
      expect.unreachable("recordCorrection should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("records the correction as its own new record referencing the corrected sale", async () => {
    const original = saleOn(NODE_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, original));
    const corrective = {
      ...saleOn(NODE_A, 2),
      saleId: saleId("22222222-3333-4444-5555-666666666666"),
      total: decimal("-12.10"),
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") }],
    };
    const ref = await suite.db.transaction((tx) =>
      backend.recordCorrection(tx, corrective, { correctsSaleId: original.saleId }),
    );

    const records = await backend.recordsFor(NODE_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(records[1].saleId).toBe(corrective.saleId);
    expect(records[1].total).toBe("-12.10");
    expect(ref.recordId).toBe(records[1].recordId);
    expect(ref.state).toBe("pending");
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    const original = saleOn(NODE_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, original));
    await expect(
      suite.db.transaction(async (tx) => {
        await backend.recordCorrection(
          tx,
          { ...saleOn(NODE_A, 2), total: decimal("-12.10") },
          { correctsSaleId: original.saleId },
        );
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect((await backend.recordsFor(NODE_A)).map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("recordSubstitution", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("refuses to substitute a sale that was never recorded", async () => {
    const unrecorded = saleId("00000000-0000-0000-0000-000000000000");
    try {
      await suite.db.transaction((tx) =>
        backend.recordSubstitution(tx, saleOn(NODE_A, 2), { substitutedSaleIds: [unrecorded] }),
      );
      expect.unreachable("recordSubstitution should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("refuses an empty substitutedSaleIds list", async () => {
    await expect(
      suite.db.transaction((tx) =>
        backend.recordSubstitution(tx, saleOn(NODE_A, 2), { substitutedSaleIds: [] }),
      ),
    ).rejects.toThrow();
  });

  it("records the substitution as its own new record referencing the substituted sales, without annulling them", async () => {
    const t1 = saleOn(NODE_A, 1);
    const t2 = saleOn(NODE_A, 2);
    await suite.db.transaction((tx) => backend.recordSale(tx, t1));
    await suite.db.transaction((tx) => backend.recordSale(tx, t2));
    const substitute = { ...saleOn(NODE_A, 3), total: decimal("24.20") };

    const ref = await suite.db.transaction((tx) =>
      backend.recordSubstitution(tx, substitute, {
        substitutedSaleIds: [t1.saleId, t2.saleId],
      }),
    );

    const records = await backend.recordsFor(NODE_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "sale", "substitution"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(records[2].saleId).toBe(substitute.saleId);
    expect(records[2].total).toBe("24.20");
    expect(ref.recordId).toBe(records[2].recordId);
    expect(ref.state).toBe("pending");
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    const t1 = saleOn(NODE_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, t1));
    await expect(
      suite.db.transaction(async (tx) => {
        await backend.recordSubstitution(tx, saleOn(NODE_A, 2), {
          substitutedSaleIds: [t1.saleId],
        });
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect((await backend.recordsFor(NODE_A)).map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("filedReceiptFor", () => {
  beforeEach(() => suite.db.transaction((tx) => backend.registerNode(tx, NODE_A)));

  it("returns the sale's stored breakdown and a stable verification url", async () => {
    const sale = saleOn(NODE_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, sale));

    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, sale.saleId));
    expect(filed).toBeDefined();
    expect(filed!.verificationUrl.length).toBeGreaterThan(0);
    expect(filed!.vatBreakdown).toEqual(sale.vatBreakdown);

    // An idempotent replay must reprint the SAME url.
    const again = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, sale.saleId));
    expect(again!.verificationUrl).toBe(filed!.verificationUrl);
  });

  it("returns undefined for a sale it never recorded", async () => {
    const unknown = saleId("00000000-0000-0000-0000-000000000000");
    const filed = await suite.db.transaction((tx) => backend.filedReceiptFor(tx, unknown));
    expect(filed).toBeUndefined();
  });
});
