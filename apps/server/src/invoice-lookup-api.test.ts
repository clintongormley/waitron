import { sql } from "drizzle-orm";
import { lookUpInvoices } from "./invoice-lookup-api.js";
import { describe, expect, it } from "vitest";
import { invoiceSeries, sales, printJobs, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue, seatedWith, send, type BillVenue } from "./testing/bill-venue.js";
import "./errors.js";

let venue: BillVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      await tx.insert(invoiceSeries).values([
        { nodeId: venue.cfg.nodeId, code: "LOOKUP-A", purpose: "full" },
        { nodeId: venue.cfg.nodeId, code: "LOOKUP-F", purpose: "full" },
      ]);
    });
    const series = await db.select().from(invoiceSeries);
    const add = async (code: string, number: number, name: string, issuedAt: string) => {
      const party = await seatedWith(venue, "Caña");
      await withTransaction(db, async (tx) => {
        await tx.insert(sales).values({
          source: "device",
          deviceId: venue.deviceId,
          nodeId: venue.cfg.nodeId,
          seriesId: series.find((row) => row.code === code)!.id,
          invoiceNumber: number,
          workingOrderId: party.tabId,
          issuedAt,
          issuedOffsetMinutes: 120,
          total: 300,
          vatBreakdown: [{ rate: "21.00", base: "2.48", tax: "0.52" }],
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "none",
          fiscalState: "not_applicable",
          counterpartyTaxId: "B12345674",
          counterpartyLegalName: name,
          counterpartyCountryCode: "ES",
          counterpartyAddress: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        });
      });
    };
    await add("LOOKUP-A", 12, "Old invoice SL", "2026-10-01T10:00:00.000Z");
    await add("LOOKUP-F", 12, "Other series SL", "2026-10-02T10:00:00.000Z");
    await add("LOOKUP-A", 112, "Unrelated SL", "2026-10-03T10:00:00.000Z");
    await add("LOOKUP-A", 13, "Calle 12 Catering", "2026-10-04T10:00:00.000Z");
    await add("LOOKUP-A", 14, "12 Club", "2026-10-05T10:00:00.000Z");
    await add("LOOKUP-A", 15, "12th Avenue", "2026-10-06T10:00:00.000Z");
    for (let index = 0; index < 21; index++) {
      await add("LOOKUP-F", 30 + index, "Calle 12 Catering", "2026-10-07T10:00:00.000Z");
    }
  },
});

async function lookup(q: string) {
  const answer = await send(
    venue.app,
    venue.cookie,
    "GET",
    `/api/invoices/lookup?q=${encodeURIComponent(q)}`,
  );
  expect(answer.status).toBe(200);
  return (
    answer.json as { invoices: { invoiceNumber: string; customerName: string; total: string }[] }
  ).invoices;
}

describe("full invoice number lookup", () => {
  it("puts the exact bare number in every series before ranked names, before the twenty-row limit", async () => {
    const rows = await lookup("12");
    expect(rows).toHaveLength(20);
    expect(rows.slice(0, 4).map((row) => row.invoiceNumber)).toEqual([
      "LOOKUP-F/12",
      "LOOKUP-A/12",
      "LOOKUP-A/14",
      "LOOKUP-F/50",
    ]);
    expect(rows.some((row) => row.invoiceNumber === "LOOKUP-A/112")).toBe(false);
    expect(rows.every((row) => row.total === "3.00")).toBe(true);
  });

  it("keeps series-and-number searches exact even when names contain the number", async () => {
    expect((await lookup(" LOOKUP-A / 12 ")).map((row) => row.invoiceNumber)).toEqual([
      "LOOKUP-A/12",
    ]);
    expect(await lookup("LOOKUP-A/99")).toEqual([]);
  });

  it("trims the number form while a trailing space still finishes the customer-name word", async () => {
    const rows = await lookup(" 00012 ");
    expect(rows.map((row) => row.invoiceNumber)).toEqual(["LOOKUP-F/12", "LOOKUP-A/12"]);
    const scoped = (query: string) =>
      withTransaction(suite.db, (tx) =>
        lookUpInvoices(
          tx,
          query,
          (orderId) =>
            sql`${orderId} in (select working_order_id from sales where invoice_number <= 15)`,
        ),
      );
    expect((await scoped("12")).map((row) => row.invoiceNumber)).toEqual([
      "LOOKUP-F/12",
      "LOOKUP-A/12",
      "LOOKUP-A/14",
      "LOOKUP-A/13",
      "LOOKUP-A/15",
    ]);
    expect((await scoped("12 ")).map((row) => row.invoiceNumber)).toEqual([
      "LOOKUP-F/12",
      "LOOKUP-A/12",
      "LOOKUP-A/14",
      "LOOKUP-A/13",
    ]);
  });

  it("retains every-word accent folding and match order for non-numeric text", async () => {
    expect((await lookup("catering calle")).map((row) => row.invoiceNumber)).toEqual([
      ...Array.from({ length: 20 }, (_, index) => `LOOKUP-F/${50 - index}`),
    ]);
    expect((await lookup("óld invoice")).map((row) => row.invoiceNumber)).toEqual(["LOOKUP-A/12"]);
    expect(await lookup("&")).toEqual([]);
  });

  it("does not write sale, numbering or print-job facts during number and name lookups", async () => {
    const snapshot = () =>
      withTransaction(suite.db, async (tx) => ({
        sales: await tx.select().from(sales),
        series: await tx.select().from(invoiceSeries),
        jobs: await tx.select().from(printJobs),
      }));
    const before = await snapshot();
    for (const q of ["12", "LOOKUP-A/12", "catering calle"]) await lookup(q);
    expect(await snapshot()).toEqual(before);
  });
});
