import { describe, expect, it } from "vitest";
import { rewriteSource } from "./fiscal-next-number.mjs";

const file = "apps/server/src/series.test.ts";

describe("invoice counter references", () => {
  it("rewrites a selected column, adds its import once and leaves other values alone", () => {
    const before = [
      'import { invoiceSeries } from "@waitron/db";',
      "db.select({ code: invoiceSeries.code, next: invoiceSeries.nextNumber }).from(invoiceSeries);",
      "expect(reading).toEqual({ nextNumber: 7 });",
    ].join("\n");
    const expected = [
      'import { invoiceSeries, nextInvoiceNumberOf } from "@waitron/db";',
      "db.select({ code: invoiceSeries.code, next: nextInvoiceNumberOf(invoiceSeries.id) }).from(invoiceSeries);",
      "expect(reading).toEqual({ nextNumber: 7 });",
    ].join("\n");
    expect(rewriteSource(file, before)).toEqual({ text: expected, manual: [], refused: [] });
    expect(rewriteSource(file, expected)).toEqual({ text: expected, manual: [], refused: [] });
  });

  it("removes only default counters in new series inserts", () => {
    const before = [
      'db.insert(invoiceSeries).values({ nodeId, nextNumber: 1, code: "A" });',
      'db.insert(invoiceSeries).values([{ nodeId, code: "B", nextNumber: 1 }]);',
      'db.insert(other).values({ code: "C", nextNumber: 1 });',
      'db.insert(invoiceSeries).values({ nodeId, code: "D", nextNumber: 23 });',
    ].join("\n");
    const expected = [
      'db.insert(invoiceSeries).values({ nodeId, code: "A" });',
      'db.insert(invoiceSeries).values([{ nodeId, code: "B" }]);',
      'db.insert(other).values({ code: "C", nextNumber: 1 });',
      'db.insert(invoiceSeries).values({ nodeId, code: "D", nextNumber: 23 });',
    ].join("\n");
    expect(rewriteSource(file, before)).toEqual({
      text: expected,
      manual: [4],
      refused: [],
    });
  });

  it.each([
    "const query = sql`(select max(${sales.invoiceNumber}) from ${sales} where ${sales.seriesId} = ${invoiceSeries.id})`;",
    'const series = alias(invoiceSeries, "s"); const query = sql`(select max(invoice_number) from sales where series_id = ${series.id})`;',
  ])("refuses an unqualified series column in a sales subquery", (query) => {
    expect(rewriteSource(file, "\n" + query).refused).toEqual([2]);
  });

  it("passes a read through the qualified helper", () => {
    const query = "db.select({ next: nextInvoiceNumberOf(invoiceSeries.id) }).from(invoiceSeries);";
    expect(rewriteSource(file, query)).toEqual({ text: query, manual: [], refused: [] });
  });
});
