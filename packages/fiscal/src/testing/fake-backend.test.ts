import { beforeEach, describe, expect, it } from "vitest";
import { AppError, decimal, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { SaleForFiscalRecord } from "../backend.js";
import { FakeFiscalBackend } from "./fake-backend.js";

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL_A = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const TILL_B = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c9");

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

// No migration set at all: the fake's own `fake_till_registrations`/`fake_fiscal_records` tables
// are the only schema this suite touches, and `install` creates them.
const suite = usePgliteDb({ migrations: [], setup: (db) => FakeFiscalBackend.install(db) });

beforeEach(async () => {
  await FakeFiscalBackend.truncate(suite.db);
  backend = new FakeFiscalBackend(suite.db);
});

describe("registration", () => {
  it("records a registration and returns an opaque registration id", () => {
    return suite.db.transaction(async (tx) => {
      const registration = await backend.registerTill(tx, TILL_A, { tenantId: TENANT });
      expect(registration.tillId).toBe(TILL_A);
      expect(registration.registrationId).toMatch(/^fake-/);
    });
  });

  it("refuses to record a sale for a till that was never registered", async () => {
    // A stub that recorded regardless would let packages/core skip registration entirely and
    // every core test would still pass, right up to the point where a real backend refuses.
    await expect(
      suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1))),
    ).rejects.toThrowError(AppError);
  });

  it("names the till in the refusal params", async () => {
    try {
      await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
      expect.unreachable("recordSale should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.till_not_registered");
      expect((error as AppError).params).toEqual({ tillId: TILL_A });
    }
  });
});

describe("recordSale", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("returns a ref naming the backend and the record", async () => {
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(ref.backend).toBe("fake");
    expect(ref.recordId).toMatch(/^fake-/);
    expect(ref.state).toBe("pending");
  });

  it("stores the exact total it was given, digit for digit", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    const [record] = await backend.recordsFor(TILL_A);
    expect(record.total).toBe("12.10");
  });

  it("rejects a total that is not an exact decimal string", async () => {
    // The money boundary, asserted at the interface rather than trusted. A number arriving
    // through an `as never` cast is exactly how a float reaches a fiscal record in practice.
    const sale = { ...saleOn(TILL_A, 1), total: 12.1 as never };
    await expect(suite.db.transaction((tx) => backend.recordSale(tx, sale))).rejects.toThrowError(
      AppError,
    );
  });

  it("assigns strictly increasing sequences within a till", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const sequences = (await backend.recordsFor(TILL_A)).map((r) => r.sequence);
    expect(sequences).toEqual([1, 2]);
  });

  it("numbers tills independently of each other", async () => {
    await suite.db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_B, 1)));
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
      suite.db.transaction(async (tx) => {
        await backend.recordSale(tx, saleOn(TILL_A, 1));
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect(await backend.recordsFor(TILL_A)).toEqual([]);
  });
});

describe("checkIntegrity", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("reports how many records it checked, not merely that it is happy", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, TENANT, TILL_A));
    expect(report).toEqual({ ok: true, checked: 2, issues: [] });
  });

  it("reports zero checked on a till with no records, without complaining", async () => {
    // The start-of-chain case in generic clothing: nothing recorded is a normal state, not a
    // failure. A backend for a regime with nothing to check answers exactly this shape.
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, TENANT, TILL_A));
    expect(report).toEqual({ ok: true, checked: 0, issues: [] });
  });

  it("surfaces an injected issue", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const report = await suite.db.transaction((tx) => backend.checkIntegrity(tx, TENANT, TILL_A));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([{ code: "fake.tampered", params: { sequence: 1 } }]);
  });

  it("still records the next sale after a failed check", async () => {
    // The requirement AEAT states outright: «la facturación por este motivo NUNCA debe
    // interrumpirse». Without an injectable failure the fake could not exercise this at all,
    // and packages/core would ship the opposite behaviour untested.
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(ref.recordId).toMatch(/^fake-/);
    expect((await backend.recordsFor(TILL_A)).map((r) => r.sequence)).toEqual([1, 2]);
  });

  it("recovers when the injected issue is cleared", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.breakIntegrity(TILL_A, { code: "fake.tampered", params: { sequence: 1 } });
    backend.restoreIntegrity(TILL_A);
    expect(
      (await suite.db.transaction((tx) => backend.checkIntegrity(tx, TENANT, TILL_A))).ok,
    ).toBe(true);
  });
});

describe("pendingCount", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("counts records that have not been acknowledged", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    expect(await backend.pendingCount(TENANT, TILL_A)).toBe(2);
  });

  it("drops when a record is acknowledged, so it is not a constant", async () => {
    // A stub returning the record count would pass the test above and fail this one. That pair
    // is the difference between a count and a number.
    const ref = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    await backend.acknowledge(ref.recordId);
    expect(await backend.pendingCount(TENANT, TILL_A)).toBe(1);
  });

  it("is scoped to one till", async () => {
    await suite.db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: TENANT }));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    expect(await backend.pendingCount(TENANT, TILL_B)).toBe(0);
  });

  it("is zero for a till that has never recorded anything", async () => {
    expect(await backend.pendingCount(TENANT, TILL_A)).toBe(0);
  });
});

describe("drain", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("acknowledges pending records so pendingCount drops to zero", async () => {
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 2)));
    const before = await backend.pendingCount(TENANT, TILL_A);
    expect(before).toBeGreaterThan(0);
    const result = await backend.drain(new Date("2026-07-21T00:00:00Z"));
    expect(result.recordsAccepted).toBe(before);
    expect(result.nextDueAt).toBeNull();
    expect(await backend.pendingCount(TENANT, TILL_A)).toBe(0);
  });
});

describe("recordVoid", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

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
    // Once recorded, nothing is ever edited. A void is a new record referencing the old one,
    // and the two interleave in generation order.
    const sale = saleOn(TILL_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, sale));
    const ref = await suite.db.transaction((tx) =>
      backend.recordVoid(tx, sale.saleId, "staff error"),
    );
    const records = await backend.recordsFor(TILL_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(ref.recordId).toBe(records[1].recordId);
  });
});

describe("recordCorrection", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("refuses to correct a sale that was never recorded", async () => {
    // Mirrors recordVoid's precondition: a correction references a prior sale (spec §4), and there
    // is nothing to correct if that sale was never recorded. A stub that recorded regardless would
    // let a core test skip the original entirely and still pass, right up to a real backend refusing.
    const unrecorded = saleId("00000000-0000-0000-0000-000000000000");
    const corrective = { ...saleOn(TILL_A, 2), total: decimal("-12.10") };
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
    // A correction is a NEW record carrying its own (negative) data — unlike a void, which has no
    // data of its own — that interleaves after the original in generation order. The corrective's
    // own saleId is recorded (not the corrected one), so it is distinguishable from the sale it
    // corrects, and the corrected sale must exist first for it to be issued at all.
    const original = saleOn(TILL_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, original));
    const corrective = {
      ...saleOn(TILL_A, 2),
      saleId: saleId("22222222-3333-4444-5555-666666666666"),
      total: decimal("-12.10"),
      vatBreakdown: [{ rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") }],
    };
    const ref = await suite.db.transaction((tx) =>
      backend.recordCorrection(tx, corrective, { correctsSaleId: original.saleId }),
    );

    const records = await backend.recordsFor(TILL_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "correction"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2]);
    expect(records[1].saleId).toBe(corrective.saleId);
    expect(records[1].total).toBe("-12.10");
    expect(ref.recordId).toBe(records[1].recordId);
    expect(ref.state).toBe("pending");
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    // The atomicity property, for corrections too: the interface takes a transaction handle so a
    // correction and any surrounding work commit or roll back together. A fake holding an in-memory
    // array could not show this — it writes through the caller's own transaction instead.
    const original = saleOn(TILL_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, original));
    await expect(
      suite.db.transaction(async (tx) => {
        await backend.recordCorrection(
          tx,
          { ...saleOn(TILL_A, 2), total: decimal("-12.10") },
          { correctsSaleId: original.saleId },
        );
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect((await backend.recordsFor(TILL_A)).map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("recordSubstitution", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("refuses to substitute a sale that was never recorded", async () => {
    // Mirrors recordCorrection's precondition, extended to the N:1 fan-out: a substitution replaces
    // one or more prior sales (spec §4), and there is nothing to substitute if a named sale was
    // never recorded. A stub that recorded regardless would let a core test skip the substituted
    // sale entirely and still pass, right up to a real backend refusing.
    const unrecorded = saleId("00000000-0000-0000-0000-000000000000");
    try {
      await suite.db.transaction((tx) =>
        backend.recordSubstitution(tx, saleOn(TILL_A, 2), { substitutedSaleIds: [unrecorded] }),
      );
      expect.unreachable("recordSubstitution should have thrown");
    } catch (error) {
      expect((error as AppError).code).toBe("fiscal.sale_not_recorded");
    }
  });

  it("refuses an empty substitutedSaleIds list", async () => {
    // An F3 substitutes at least one ticket; a list of none has nothing to substitute and would
    // file a full invoice naming nothing it replaces.
    await expect(
      suite.db.transaction((tx) =>
        backend.recordSubstitution(tx, saleOn(TILL_A, 2), { substitutedSaleIds: [] }),
      ),
    ).rejects.toThrow();
  });

  it("records the substitution as its own new record referencing the substituted sales, without annulling them", async () => {
    // A substitution is a NEW full-invoice record carrying its OWN (positive) data — unlike a void,
    // which has none of its own — that interleaves after the tickets it replaces in generation
    // order. The replaced tickets are NEITHER edited NOR annulled: only the substitution record is
    // appended, and both original 'sale' records stay exactly where they were.
    const t1 = saleOn(TILL_A, 1);
    const t2 = saleOn(TILL_A, 2);
    await suite.db.transaction((tx) => backend.recordSale(tx, t1));
    await suite.db.transaction((tx) => backend.recordSale(tx, t2));
    const substitute = { ...saleOn(TILL_A, 3), total: decimal("24.20") };

    const ref = await suite.db.transaction((tx) =>
      backend.recordSubstitution(tx, substitute, {
        substitutedSaleIds: [t1.saleId, t2.saleId],
      }),
    );

    const records = await backend.recordsFor(TILL_A);
    expect(records.map((r) => r.kind)).toEqual(["sale", "sale", "substitution"]);
    expect(records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(records[2].saleId).toBe(substitute.saleId);
    expect(records[2].total).toBe("24.20");
    expect(ref.recordId).toBe(records[2].recordId);
    expect(ref.state).toBe("pending");
  });

  it("leaves no record behind when the transaction rolls back", async () => {
    // The atomicity property, for substitutions too: the interface takes a transaction handle so a
    // substitution and any surrounding work commit or roll back together.
    const t1 = saleOn(TILL_A, 1);
    await suite.db.transaction((tx) => backend.recordSale(tx, t1));
    await expect(
      suite.db.transaction(async (tx) => {
        await backend.recordSubstitution(tx, saleOn(TILL_A, 2), {
          substitutedSaleIds: [t1.saleId],
        });
        throw new Error("rolled back by the caller");
      }),
    ).rejects.toThrow();
    expect((await backend.recordsFor(TILL_A)).map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("reconcile", () => {
  beforeEach(() =>
    suite.db.transaction((tx) => backend.registerTill(tx, TILL_A, { tenantId: TENANT })),
  );

  it("counts zero for a tenant with no records, without complaining", async () => {
    // The start-of-period case in generic clothing, mirroring checkIntegrity's identical
    // "nothing recorded is normal" test above.
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result).toEqual({
      year: "2027",
      month: "03",
      checked: 0,
      lostAck: [],
      noTrace: [],
      drift: [],
      incidentsRaised: 0,
    });
  });

  it("reports a clean audit when a pending record has no reported state yet", async () => {
    // In-flight tolerance: local 'pending' + no reported state at all is ordinary, not a
    // mismatch — the regime simply has not gotten to it yet.
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.checked).toBe(1);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  it("reports a clean audit when an acknowledged record is reported accepted", async () => {
    const sale = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await backend.acknowledge(sale.recordId);
    backend.setReportedState(sale.recordId, "accepted");
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.checked).toBe(1);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  it("classifies a pending record the regime already reported on as lostAck", async () => {
    const sale = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    backend.setReportedState(sale.recordId, "accepted");
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.lostAck).toEqual([
      { recordId: sale.recordId, localState: "pending", reportedState: "accepted" },
    ]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  it("classifies an acknowledged record the regime has no trace of as noTrace", async () => {
    const sale = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await backend.acknowledge(sale.recordId);
    // No setReportedState call at all: the regime has nothing recorded for this record.
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.noTrace).toEqual([
      { recordId: sale.recordId, localState: "acknowledged", reportedState: null },
    ]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
  });

  it("classifies an acknowledged record the regime rejected as drift", async () => {
    const sale = await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await backend.acknowledge(sale.recordId);
    backend.setReportedState(sale.recordId, "rejected");
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.drift).toEqual([
      { recordId: sale.recordId, localState: "acknowledged", reportedState: "rejected" },
    ]);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
  });

  it("echoes the requested period back on the result", async () => {
    const result = await backend.reconcile(TENANT, { year: "2026", month: "12" });
    expect(result.year).toBe("2026");
    expect(result.month).toBe("12");
  });

  it("counts only the records belonging to the requested tenant", async () => {
    const otherTenant = tenantId("6ba7b810-9dad-11d1-80b4-00c04fd430ca");
    await suite.db.transaction((tx) => backend.registerTill(tx, TILL_B, { tenantId: otherTenant }));
    await suite.db.transaction((tx) => backend.recordSale(tx, saleOn(TILL_A, 1)));
    await suite.db.transaction((tx) =>
      backend.recordSale(tx, { ...saleOn(TILL_B, 1), tenantId: otherTenant }),
    );
    const result = await backend.reconcile(TENANT, { year: "2027", month: "03" });
    expect(result.checked).toBe(1);
  });
});
