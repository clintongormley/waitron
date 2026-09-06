import { describe, expect, it } from "vitest";
import { decimal, nodeId, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { FiscalBackend, SaleForFiscalRecord } from "@waitron/fiscal";
import { NoneBackend } from "./backend.js";

// Exercise NoneBackend through the interface it claims to implement. The class drops the interface
// params it never reads (a no-op needs none), so calling through `FiscalBackend` both proves the
// structural conformance and lets each call pass the contract's full argument list.
const make = (): FiscalBackend => new NoneBackend();

// NoneBackend touches no database — every method is a pure no-op returning a fixed shape — so the
// suite needs no db/withTenant. A stub transaction proves the point: the interface hands it in, the
// backend never uses it.
const tx = {} as never;

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const NODE = nodeId("7ba7b810-9dad-11d1-80b4-00c04fd430c1");
const SALE = saleId("11111111-2222-3333-4444-555555555555");

function sampleSale(): SaleForFiscalRecord {
  return {
    tenantId: TENANT,
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

  it("recordVoid returns a recorded ref", async () => {
    const ref = await make().recordVoid(tx, SALE, "mistake");
    expect(ref).toMatchObject({ backend: "none", state: "recorded", verificationUrl: undefined });
  });

  it("recordCorrection returns a recorded ref carrying the corrective sale's instants", async () => {
    const sale = sampleSale();
    const ref = await make().recordCorrection(tx, sale, { correctsSaleId: SALE });
    expect(ref).toEqual({
      backend: "none",
      recordId: sale.saleId,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    });
  });

  it("recordSubstitution returns a recorded ref", async () => {
    const sale = sampleSale();
    const ref = await make().recordSubstitution(tx, sale, {
      substitutedSaleIds: [SALE],
    });
    expect(ref).toMatchObject({ backend: "none", state: "recorded", verificationUrl: undefined });
  });

  it("registerNode returns an empty registration for the node", async () => {
    const reg = await make().registerNode(tx, NODE, { tenantId: TENANT });
    expect(reg).toMatchObject({ backend: "none", nodeId: NODE, registrationId: "" });
    expect(reg.registeredAt).toBeInstanceOf(Date);
  });

  it("pendingCount is 0, checkIntegrity is checked:0, filedReceiptFor is undefined", async () => {
    const b = make();
    expect(await b.pendingCount(TENANT, NODE)).toBe(0);
    expect(await b.checkIntegrity(tx, TENANT, NODE)).toEqual({
      ok: true,
      checked: 0,
      issues: [],
    });
    expect(await b.filedReceiptFor(tx, SALE)).toBeUndefined();
  });
});
