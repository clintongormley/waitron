import { describe, expect, it } from "vitest";
import { decimal, nodeId, saleId, seriesId, tillId } from "@waitron/shared";
import type { FiscalBackend, SaleForFiscalRecord } from "@waitron/fiscal";
import { NoneBackend } from "./backend.js";

// Exercise NoneBackend through the interface it claims to implement. The class drops the interface
// params it never reads (a no-op needs none), so calling through `FiscalBackend` both proves the
// structural conformance and lets each call pass the contract's full argument list.
const make = (): FiscalBackend => new NoneBackend();

// NoneBackend touches no database — every method is a pure no-op returning a fixed shape — so the
// suite needs no db/withTransaction. A stub transaction proves the point: the interface hands it in, the
// backend never uses it.
const tx = {} as never;

const TILL = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const NODE = nodeId("7ba7b810-9dad-11d1-80b4-00c04fd430c1");
const SALE = saleId("11111111-2222-3333-4444-555555555555");
const EARLIER_SALE = saleId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

function sampleSale(): SaleForFiscalRecord {
  return {
    tillId: TILL,
    nodeId: NODE,
    saleId: SALE,
    seriesId: seriesId("99999999-8888-7777-6666-555555555555"),
    seriesCode: "T1",
    invoiceNumber: 1,
    issuedAt: new Date("2027-03-14T10:00:00.000Z"),
    offsetMinutes: 60,
    descriptionOfOperation: "Restauración",
    total: decimal("12.10"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
    counterparty: null,
  };
}

describe("NoneBackend records nothing", () => {
  it("identifies itself as the none backend", () => {
    expect(make().id).toBe("none");
  });

  it("recordSale writes nothing and returns a recorded ref carrying the sale's own instants", async () => {
    const sale = sampleSale();
    const ref = await make().recordSale(tx, sale);
    expect(ref).toEqual({
      backend: "none",
      recordId: SALE,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    });
  });

  it("recordVoid returns a recorded ref for the voided sale, stamped now at a zero offset", async () => {
    const before = Date.now();
    const ref = await make().recordVoid(tx, SALE, "mistake");
    expect(ref).toEqual({
      backend: "none",
      recordId: SALE,
      state: "recorded",
      issuedAt: expect.any(Date),
      offsetMinutes: 0,
      verificationUrl: undefined,
    });
    expect(ref.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(ref.issuedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("recordCorrection returns a recorded ref carrying the corrective sale's instants", async () => {
    const sale = sampleSale();
    const ref = await make().recordCorrection(tx, sale, { correctsSaleId: EARLIER_SALE });
    expect(ref).toEqual({
      backend: "none",
      recordId: sale.saleId,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    });
  });

  it("recordSubstitution returns a recorded ref carrying the substituting sale's instants", async () => {
    const sale = sampleSale();
    const ref = await make().recordSubstitution(tx, sale, {
      substitutedSaleIds: [EARLIER_SALE],
    });
    expect(ref).toEqual({
      backend: "none",
      recordId: sale.saleId,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    });
  });

  it("registerNode returns an empty registration for the node, stamped now", async () => {
    const before = Date.now();
    const reg = await make().registerNode(tx, NODE);
    expect(reg).toEqual({
      backend: "none",
      nodeId: NODE,
      registrationId: "",
      registeredAt: expect.any(Date),
    });
    expect(reg.registeredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(reg.registeredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("pendingCount is 0, checkIntegrity is checked:0, filedReceiptFor is undefined", async () => {
    const b = make();
    expect(await b.pendingCount(NODE)).toBe(0);
    expect(await b.checkIntegrity(tx, NODE)).toEqual({
      ok: true,
      checked: 0,
      issues: [],
    });
    expect(await b.filedReceiptFor(tx, SALE)).toBeUndefined();
  });
});
