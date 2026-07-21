import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError, decimal, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { createPgliteDb } from "@waitron/db";
import type { SaleForFiscalRecord } from "../backend.js";
import { FakeFiscalBackend } from "./fake-backend.js";

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL_A = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const TILL_B = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c9");

let db: Database;
let backend: FakeFiscalBackend;

function saleOn(till: typeof TILL_A, invoiceNumber: number): SaleForFiscalRecord {
  return {
    tenantId: TENANT,
    tillId: till,
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

beforeAll(async () => {
  db = await createPgliteDb();
  await FakeFiscalBackend.install(db);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await FakeFiscalBackend.truncate(db);
  backend = new FakeFiscalBackend(db);
});

describe("registration", () => {
  it("records a registration and returns an opaque registration id", () => {
    return db.transaction(async (tx) => {
      const registration = await backend.registerTill(tx, TILL_A, { tenantId: TENANT });
      expect(registration.tillId).toBe(TILL_A);
      expect(registration.registrationId).toMatch(/^fake-/);
    });
  });

  it("refuses to record a sale for a till that was never registered", async () => {
    // A stub that recorded regardless would let packages/core skip registration entirely and
    // every core test would still pass, right up to the point where a real backend refuses.
    await expect(
      db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1))),
    ).rejects.toThrowError(AppError);
  });

  it("names the till in the refusal params", async () => {
    try {
      await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
      expect.unreachable("recordSale should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.till_not_registered");
      expect((error as AppError).params).toEqual({ tillId: TILL_A });
    }
  });
});

describe("recordSale", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("returns a ref naming the backend and the record", async () => {
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(ref.backend).toBe("fake");
    expect(ref.recordId).toMatch(/^fake-/);
    expect(ref.state).toBe("pending");
  });

  it("stores the exact total it was given, digit for digit", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    const [record] = await backend.recordsFor(TILL_A);
    expect(record.total).toBe("12.10");
  });

  it("rejects a total that is not an exact decimal string", async () => {
    // The money boundary, asserted at the interface rather than trusted. A number arriving
    // through an `as never` cast is exactly how a float reaches a fiscal record in practice.
    const sale = { ...saleOn(TILL_A, 1), total: 12.1 as never };
    await expect(db.transaction((tx) => backend.recordSale(tx, sale))).rejects.toThrowError(
      AppError,
    );
  });

  it("assigns strictly increasing sequences within a till", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const sequences = (await backend.recordsFor(TILL_A)).map((r) => r.sequence);
    expect(sequences).toEqual([1, 2]);
  });

  it("numbers tills independently of each other", async () => {
    await db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_B, 1)));
    expect((await backend.recordsFor(TILL_A)).map((r) => r.sequence)).toEqual([1]);
    expect((await backend.recordsFor(TILL_B)).map((r) => r.sequence)).toEqual([1]);
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    // The single most important test in this file. The interface takes a transaction handle
    // BECAUSE atomicity between the sale and the fiscal record is the entire point, and a fake
    // holding an in-memory array cannot roll back — so a core test asserting "a failed sale
    // records nothing" would pass against the fake while the property was untested. The fake
    // therefore writes through the same transaction as everything else.
    await expect(
      db.transaction(async (tx) => {
        await backend.recordSale(tx, saleOn(TILL_A, 1));
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect(await backend.recordsFor(TILL_A)).toEqual([]);
  });
});

describe("checkIntegrity", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("reports how many records it checked, not merely that it is happy", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("reports zero checked on a till with no records, without complaining", async () => {
    // The start-of-chain case in generic clothing: nothing recorded is a normal state, not a
    // failure. A backend for a regime with nothing to check answers exactly this shape.
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("surfaces an injected issue", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const report = await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([{ code: "fake.tampered", params: { sequence: 1 } }]);
  });

  it("still records the next sale after a failed check", async () => {
    // The requirement AEAT states outright: «la facturación por este motivo NUNCA debe
    // interrumpirse». Without an injectable failure the fake could not exercise this at all,
    // and packages/core would ship the opposite behaviour untested.
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(ref.recordId).toMatch(/^fake-/);
    expect((await backend.recordsFor(TILL_A)).map((r) => r.sequence)).toEqual([1, 2]);
  });

  it("recovers when the injected issue is cleared", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    backend.restoreIntegrity(TILL_A);
    expect((await db.transaction((tx) => backend.checkIntegrity(tx, TILL_A))).ok).toBe(true);
  });
});

describe("pendingCount", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("counts records that have not been acknowledged", async () => {
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(await backend.pendingCount(TILL_A)).toBe(2);
  });

  it("drops when a record is acknowledged, so it is not a constant", async () => {
    // A stub returning the record count would pass the test above and fail this one. That pair
    // is the difference between a count and a number.
    const ref = await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    await backend.acknowledge(ref.recordId);
    expect(await backend.pendingCount(TILL_A)).toBe(1);
  });

  it("is scoped to one till", async () => {
    await db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(await backend.pendingCount(TILL_B)).toBe(0);
  });

  it("is zero for a till that has never recorded anything", async () => {
    expect(await backend.pendingCount(TILL_A)).toBe(0);
  });
});

describe("recordVoid", () => {
  beforeEach(() => db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })));

  it("refuses to void a sale that was never recorded", async () => {
    const unknown = saleId("00000000-0000-0000-0000-000000000000");
    try {
      await db.transaction((tx) => backend.recordVoid(tx, unknown, "staff error"));
      expect.unreachable("recordVoid should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("records a second record rather than editing the first", async () => {
    // Once recorded, nothing is ever edited. A void is a new record referencing the old one,
    // and the two interleave in generation order.
    const sale = saleOn(TILL_A, 1);
    await db.transaction((tx) => backend.recordSale(tx, sale));
    const ref = await db.transaction((tx) => backend.recordVoid(tx, sale.saleId, "staff error"));
    const records = await backend.recordsFor(TILL_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(ref.recordId).toBe(records[1].recordId);
  });
});
