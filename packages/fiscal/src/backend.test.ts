import { describe, expect, it } from "vitest";
import { decimal, nodeId, saleId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { FiscalBackend, IntegrityReport, SaleForFiscalRecord } from "./backend.js";
import { FakeFiscalBackend } from "./testing/fake-backend.js";

const TENANT = tenantId("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
const TILL = tillId("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
const NODE = nodeId("7ba7b810-9dad-11d1-80b4-00c04fd430c1");

describe("FiscalBackend", () => {
  it("is satisfied structurally by the fake", () => {
    // If a method is added to the interface and not to the fake, this line stops compiling —
    // which is the point of writing it as an annotated binding rather than a runtime check.
    const backend: FiscalBackend = new FakeFiscalBackend(null as never);
    expect(backend).toBeInstanceOf(FakeFiscalBackend);
  });

  it("accepts a sale whose monetary fields are exact decimals", () => {
    const sale: SaleForFiscalRecord = {
      tenantId: TENANT,
      tillId: TILL,
      nodeId: NODE,
      saleId: saleId("11111111-2222-3333-4444-555555555555"),
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
    expect(sale.total).toBe("12.10");
  });

  it("reports integrity as a count plus issues, not a boolean alone", () => {
    // `ok` alone cannot distinguish "checked 400 records, all sound" from "checked nothing".
    // The count is what makes a green report meaningful.
    const report: IntegrityReport = { ok: true, checked: 400, issues: [] };
    expect(report.checked).toBe(400);
  });

  it("carries integrity issues as code plus params, never prose", () => {
    const report: IntegrityReport = {
      ok: false,
      checked: 400,
      issues: [{ code: "verifactu.predecessor_mismatch", params: { sequence: 399 } }],
    };
    expect(report.issues[0].code).toBe("verifactu.predecessor_mismatch");
    expect(typeof report.issues[0].params).toBe("object");
  });
});
