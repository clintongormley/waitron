import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, readVenueClock, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  seedSale,
  seedSubstitution,
  seedVenueWithSeries,
  seedVoid,
} from "@waitron/reporting/test/fixtures.js";
import type { SaleId } from "@waitron/shared";
import { mountTaxOfficeApi } from "./tax-office-api.js";
import type { TaxOfficeMonthBuilds } from "./tax-office-month-builds.js";
import { sessionHolding } from "./testing/session-holding.js";
import {
  listTaxOfficeInvoices,
  type TaxOfficeFilter,
  type TaxOfficeInvoice,
} from "./tax-office-list.js";
import type { TradingContext } from "./trading-context.js";

const at = (day: string, time = "12:00:00") => `2026-11-${day}T${time}.000Z`;
const ids: Record<string, SaleId> = {};
let nodeId = "";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    const venue = await seedVenueWithSeries(db);
    nodeId = venue.nodeId;
    const sale = async (
      name: string,
      opts: Omit<Parameters<typeof seedSale>[2], "lines"> & {
        lines?: Parameters<typeof seedSale>[2]["lines"];
      },
    ) => {
      ids[name] = await seedSale(db, venue, { lines: [], ...opts });
    };
    await sale("f1", {
      invoiceNumber: 1,
      issuedAt: at("02"),
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
      counterpartyTaxId: "B12345674",
      counterpartyLegalName: "Harbour Foods",
    });
    await sale("f2a", {
      invoiceNumber: 2,
      issuedAt: at("03"),
      total: "5.50",
      lines: [{ vatRate: "10.00", lineTotal: "5.00" }],
    });
    await sale("f2b", {
      invoiceNumber: 3,
      issuedAt: at("03"),
      total: "7.70",
      lines: [{ vatRate: "10.00", lineTotal: "7.00" }],
    });
    await sale("f3", {
      invoiceNumber: 4,
      issuedAt: at("04"),
      total: "13.20",
      lines: [{ vatRate: "10.00", lineTotal: "12.00" }],
      counterpartyTaxId: "B98765432",
      counterpartyLegalName: "Casa Pepe",
    });
    await seedSubstitution(db, { substitutionSaleId: ids.f3!, substitutedSaleId: ids.f2a! });
    await seedSubstitution(db, { substitutionSaleId: ids.f3!, substitutedSaleId: ids.f2b! });
    await sale("f2c", {
      invoiceNumber: 5,
      issuedAt: at("05"),
      total: "33.00",
      lines: [{ vatRate: "10.00", lineTotal: "30.00" }],
    });
    await sale("r5", {
      invoiceNumber: 6,
      issuedAt: at("06"),
      total: "-2.20",
      lines: [{ vatRate: "10.00", lineTotal: "-2.00", quantity: "-1.000" }],
      correctsSaleId: ids.f2c,
    });
    await sale("voided", {
      invoiceNumber: 7,
      issuedAt: at("07"),
      total: "3.30",
      lines: [{ vatRate: "10.00", lineTotal: "3.00" }],
    });
    await seedVoid(db, { saleId: ids.voided }, at("07", "13:00:00"));
    await sale("f2d", {
      invoiceNumber: 8,
      issuedAt: at("01"),
      total: "4.40",
      lines: [{ vatRate: "10.00", lineTotal: "4.00" }],
    });
    await sale("replacement", {
      invoiceNumber: 9,
      issuedAt: at("09"),
      total: "4.40",
      lines: [{ vatRate: "10.00", lineTotal: "4.00" }],
      correctsSaleId: ids.f2d,
      replacesOriginal: true,
      supplyDay: "2026-11-01",
    });
    await sale("twoRates", {
      invoiceNumber: 10,
      issuedAt: at("10"),
      total: "78.10",
      lines: [
        { vatRate: "10.00", lineTotal: "16.00" },
        { vatRate: "21.00", lineTotal: "50.00" },
      ],
    });
    await sale("october", {
      invoiceNumber: 11,
      issuedAt: "2026-10-15T12:00:00.000Z",
      total: "9.90",
      lines: [{ vatRate: "10.00", lineTotal: "9.00" }],
    });
    // December holds sales no other case's range reaches.
    await sale("lateNight", {
      invoiceNumber: 12,
      issuedAt: "2026-12-04T23:30:00.000Z",
      issuedOffsetMinutes: 60,
      total: "2.20",
      lines: [{ vatRate: "10.00", lineTotal: "2.00" }],
    });
    await sale("dni", {
      invoiceNumber: 13,
      issuedAt: "2026-12-10T12:00:00.000Z",
      total: "12.10",
      lines: [{ vatRate: "21.00", lineTotal: "10.00" }],
      counterpartyTaxId: "12345678Z",
      counterpartyLegalName: "Ana Ruiz",
    });
  },
});

let db: Database;
let app: Hono;
let inspector: string;
let reporter: string;

beforeAll(async () => {
  db = suite.db;
  app = new Hono();
  // The list route reads neither the fiscal seat, the trading context nor the month builds.
  mountTaxOfficeApi(
    app,
    {
      db,
      cfg: { nodeId },
      backend: {} as FiscalBackend,
      tradingContext: {} as TradingContext,
      venueLocale: "es-ES",
      builds: {} as TaxOfficeMonthBuilds,
      freeBytes: () => Promise.resolve(null),
    },
    () => {},
  );
  inspector = (await sessionHolding(db, ["invoice.inspect"])).cookie;
  reporter = (await sessionHolding(db, ["report.view", "report.export"])).cookie;
});

const NOVEMBER = "from=2026-11-01&to=2026-11-30";

async function list(
  query: string,
  cookie = inspector,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.request(`/management-api/tax-office/invoices?${query}`, {
    headers: { cookie },
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function numbers(query: string): Promise<string[]> {
  const { status, json } = await list(query);
  expect(status).toBe(200);
  return (json.rows as TaxOfficeInvoice[]).map((row) => row.number);
}

describe("the tax office's invoice list", () => {
  it("lists every sale issued in the range, newest first, with the book's columns", async () => {
    const { status, json } = await list(NOVEMBER);
    expect(status).toBe(200);
    const rows = json.rows as TaxOfficeInvoice[];
    expect(rows.map((row) => [row.number, row.kind])).toEqual([
      ["A/10", "F2"],
      ["A/9", "R5"],
      ["A/7", "F2"],
      ["A/6", "R5"],
      ["A/5", "F2"],
      ["A/4", "F3"],
      ...[[ids.f2a!, ["A/2", "F2"]] as const, [ids.f2b!, ["A/3", "F2"]] as const]
        .sort(([left], [right]) => (left < right ? 1 : -1))
        .map(([, row]) => row),
      ["A/1", "F1"],
      ["A/8", "F2"],
    ]);
    expect(json.next).toBeNull();
    const byNumber = new Map(rows.map((row) => [row.number, row]));
    expect(byNumber.get("A/1")).toEqual({
      id: ids.f1,
      number: "A/1",
      kind: "F1",
      issuedAt: at("02"),
      issueDate: "2026-11-02",
      issueTime: "12:00:00",
      operationDate: null,
      customerName: "Harbour Foods",
      customerTaxId: "B12345674",
      vat: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
      total: "12.10",
      corrects: [],
      cancelledAt: null,
    });
    expect(byNumber.get("A/4")).toMatchObject({
      kind: "F3",
      customerName: "Casa Pepe",
      customerTaxId: "B98765432",
      corrects: ["A/2", "A/3"],
    });
    expect(byNumber.get("A/6")).toMatchObject({
      kind: "R5",
      total: "-2.20",
      vat: [{ rate: "10.00", base: "-2.00", tax: "-0.20" }],
      corrects: ["A/5"],
    });
    expect(byNumber.get("A/7")).toMatchObject({ cancelledAt: at("07", "13:00:00") });
    expect(byNumber.get("A/9")).toMatchObject({
      issueDate: "2026-11-09",
      operationDate: "2026-11-01",
      corrects: ["A/8"],
    });
    expect(byNumber.get("A/10")).toMatchObject({
      vat: [
        { rate: "10.00", base: "16.00", tax: "1.60" },
        { rate: "21.00", base: "50.00", tax: "10.50" },
      ],
      total: "78.10",
    });
    expect(json.timeZone).toBe((await withTransaction(db, readVenueClock)).timeZone);
  });

  it.each([
    ["a customer name, folded", "q=harb%C3%B3ur", ["A/1"]],
    ["a tax id prefix", "q=b1234", ["A/1"]],
    ["a series and number", "q=a%2F4", ["A/4"]],
    ["a bare number", "q=6", ["A/6"]],
    ["a VAT rate", "rate=21", ["A/10", "A/1"]],
    ["an amount equal to a base", "amount=50.00", ["A/10"]],
    ["an amount equal to a VAT amount", "amount=10.5", ["A/10"]],
    ["an amount equal to a total, compared as a number", "amount=33", ["A/5"]],
    ["a negative amount", "amount=-2.20", ["A/6"]],
    ["an operation date range", "operationFrom=2026-11-01&operationTo=2026-11-01", ["A/9", "A/8"]],
    ["an operation date from", "operationFrom=2026-11-10", ["A/10"]],
    ["a kind", "kind=F3", ["A/4"]],
    ["a corrective kind", "kind=R5", ["A/9", "A/6"]],
    ["two filters together", "kind=F2&rate=10&amount=3.30", ["A/7"]],
  ])("narrows to %s", async (_name, filter, expected) => {
    expect(await numbers(`${NOVEMBER}&${filter}`)).toEqual(expected);
  });

  const DECEMBER = "from=2026-12-01&to=2026-12-31";

  it("dates a sale by the offset filed with it, not by its UTC day", async () => {
    const { json } = await list(DECEMBER);
    expect((json.rows as TaxOfficeInvoice[]).find((row) => row.number === "A/12")).toMatchObject({
      issueDate: "2026-12-05",
      issueTime: "00:30:00",
      operationDate: null,
    });
    expect(await numbers(`${DECEMBER}&operationFrom=2026-12-05&operationTo=2026-12-05`)).toEqual([
      "A/12",
    ]);
    expect(await numbers(`${DECEMBER}&operationFrom=2026-12-04&operationTo=2026-12-04`)).toEqual(
      [],
    );
  });

  it("matches a bare number against the start of a customer's tax id", async () => {
    expect(await numbers(`${DECEMBER}&q=1234`)).toEqual(["A/13"]);
  });

  it("leaves out sales issued outside the range", async () => {
    expect(await numbers("from=2026-10-01&to=2026-10-31")).toEqual(["A/11"]);
  });

  it.each([
    ["a range over 366 days", "from=2025-01-01&to=2026-01-02", "range"],
    ["a range ending before it starts", "from=2026-11-30&to=2026-11-01", "range"],
    ["no range", "", "from"],
    ["a malformed day", "from=2026-11-31&to=2026-12-01", "from"],
    ["a malformed rate", `${NOVEMBER}&rate=abc`, "rate"],
    ["a malformed amount", `${NOVEMBER}&amount=1.234`, "amount"],
    ["an unknown kind", `${NOVEMBER}&kind=F9`, "kind"],
    ["a malformed operation day", `${NOVEMBER}&operationFrom=2026-13-01`, "operationFrom"],
    [
      "an operation range ending before it starts",
      `${NOVEMBER}&operationFrom=2026-11-05&operationTo=2026-11-01`,
      "operationRange",
    ],
    ["a search over a hundred characters", `${NOVEMBER}&q=${"x".repeat(101)}`, "q"],
    ["half a cursor", `${NOVEMBER}&afterAt=${at("03")}`, "after"],
    ["a malformed cursor", `${NOVEMBER}&afterAt=yesterday&afterId=${randomUUID()}`, "after"],
  ])("refuses %s as the period report refuses a bad range", async (_name, query, field) => {
    expect(await list(query)).toEqual({
      status: 400,
      json: { error: { code: "management.request_invalid", params: { field } } },
    });
  });

  it("accepts a range of exactly 366 days", async () => {
    expect((await list("from=2025-01-01&to=2026-01-01")).status).toBe(200);
  });

  it("refuses a session without invoice.inspect", async () => {
    expect(await list(NOVEMBER, reporter)).toMatchObject({
      status: 403,
      json: { error: { code: "authorization.not_permitted" } },
    });
  });

  it("continues a page from its cursor", async () => {
    const { json } = await list(`${NOVEMBER}&afterAt=${at("04")}&afterId=${ids.f3}`);
    expect((json.rows as TaxOfficeInvoice[]).map((row) => row.number).sort()).toEqual([
      "A/1",
      "A/2",
      "A/3",
      "A/8",
    ]);
  });

  it("walks every page with no gap or repeat when two sales share an issue time", async () => {
    const timeZone = (await withTransaction(db, readVenueClock)).timeZone;
    const filter: TaxOfficeFilter = {
      issued: { from: "2026-11-01", to: "2026-11-30", timeZone },
      limit: 7,
    };
    const first = await withTransaction(db, (tx) => listTaxOfficeInvoices(tx, filter));
    expect(first.rows).toHaveLength(7);
    // The seventh row is one of the two sales issued at the same instant; the eighth is the other.
    expect(first.rows[6]!.issuedAt).toBe(at("03"));
    expect(first.next).toEqual({ at: at("03"), id: first.rows[6]!.id });
    const second = await withTransaction(db, (tx) =>
      listTaxOfficeInvoices(tx, { ...filter, after: first.next! }),
    );
    expect(second.next).toBeNull();
    const walked = [...first.rows, ...second.rows].map((row) => row.number);
    expect(walked).toHaveLength(10);
    expect(new Set(walked).size).toBe(10);
    expect(second.rows[0]!.issuedAt).toBe(at("03"));
  });
});
