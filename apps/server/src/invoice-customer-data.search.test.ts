import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { findInvoiceCustomerSales } from "./invoice-customer-data.js";
import {
  provisionInvoiceCustomerVenue,
  type InvoiceCustomerVenue,
} from "./testing/invoice-customer-fixture.js";

let fixture: InvoiceCustomerVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    fixture = await provisionInvoiceCustomerVenue(db);
  },
});

function search(taxId: string, options?: { chunk?: number }) {
  return suite.db.withWriteLock(() => findInvoiceCustomerSales(suite.db, taxId, options));
}

async function issuedAt(saleId: string): Promise<string> {
  const [row] = await suite.db
    .select({ issuedAt: sales.issuedAt })
    .from(sales)
    .where(eq(sales.id, saleId));
  return row!.issuedAt;
}

async function ids(taxId: string): Promise<string[]> {
  return (await search(taxId)).map((sale) => sale.saleId);
}

describe("findInvoiceCustomerSales", () => {
  it("finds Jordi's three invoices, oldest first, every field as stored", async () => {
    const { j1, j2, j3 } = fixture.sales;
    expect(await search("12345678Z")).toEqual([
      {
        saleId: j1,
        invoice: "FF/1",
        code: "FF",
        number: 1,
        issuedAt: await issuedAt(j1),
        name: "Jordi Puig",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "12 Harbour Road, 46023 Valencia",
        total: "48.35",
      },
      {
        saleId: j2,
        invoice: "FF/3",
        code: "FF",
        number: 3,
        issuedAt: await issuedAt(j2),
        name: "Jordi Puig Electrician",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "3 Port Avenue, 46024 Valencia",
        total: "112.40",
      },
      {
        saleId: j3,
        invoice: "FF/6",
        code: "FF",
        number: 6,
        issuedAt: await issuedAt(j3),
        name: "Jordi Puig Electrician",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "3 Port Avenue, 46024 Valencia",
        total: "23.95",
      },
    ]);
  });

  it("finds the company, the NIE and the E entity each alone by its own number", async () => {
    expect(await ids("B76543214")).toEqual([fixture.sales.p1]);
    expect(await ids("X1234567L")).toEqual([fixture.sales.a1]);
    expect(await ids("E12345674")).toEqual([fixture.sales.c1]);
  });

  it("matches no part of a number", async () => {
    expect(await search("12345678")).toEqual([]);
    expect(await search("2345678Z")).toEqual([]);
  });

  it("never returns the simplified sale, and finds nothing for a number nobody holds", async () => {
    const all = await suite.db.select({ id: sales.id }).from(sales);
    expect(all.map((row) => row.id)).toContain(fixture.sales.s1);
    const found = [
      ...(await ids("12345678Z")),
      ...(await ids("B76543214")),
      ...(await ids("X1234567L")),
      ...(await ids("E12345674")),
    ];
    expect(found).not.toContain(fixture.sales.s1);
    expect(await search("01234567L")).toEqual([]);
  });

  it("normalises each stored number before comparing it", async () => {
    const [j1] = await suite.db.select().from(sales).where(eq(sales.id, fixture.sales.j1));
    const raw = randomUUID();
    await suite.db.withWriteLock(() =>
      suite.db.insert(sales).values({
        ...j1!,
        id: raw,
        invoiceNumber: 900001,
        workingOrderId: null,
        counterpartyTaxId: "es 87654321x",
      }),
    );
    expect(await ids("87654321X")).toEqual([raw]);
  });

  it("takes the searched number as already normalised, and does not normalise it again", async () => {
    const [j1] = await suite.db.select().from(sales).where(eq(sales.id, fixture.sales.j1));
    const raw = randomUUID();
    await suite.db.withWriteLock(() =>
      suite.db.insert(sales).values({
        ...j1!,
        id: raw,
        invoiceNumber: 900002,
        workingOrderId: null,
        counterpartyTaxId: "ESES55555555K",
      }),
    );
    expect(await ids("ES55555555K")).toEqual([raw]);
    expect(await search("ES12345678Z")).toEqual([]);
  });

  describe("the statement", () => {
    it("scans with no ORDER BY, then reads the matches by key in chunks", async () => {
      const recorded = await suite.db.withWriteLock(async () => {
        const { recording, statements } = recordingEveryStatement(suite.db);
        const found = await findInvoiceCustomerSales(recording, "12345678Z", { chunk: 2 });
        return { found: found.length, statements: statements.map((s) => s.sql) };
      });
      expect(recorded.found).toBe(3);
      expect(recorded.statements).toHaveLength(3);
      const [scan, ...lookups] = recorded.statements;
      expect(scan!.toLowerCase()).toContain("from sales");
      expect(scan!.toLowerCase()).not.toContain("order by");
      expect(lookups.map(placeholders)).toEqual([2, 1]);
    });

    it("reads at most 500 ids a statement by default", async () => {
      const recorded = await suite.db.withWriteLock(async () => {
        const { recording, statements } = recordingEveryStatement(suite.db);
        await findInvoiceCustomerSales(recording, "12345678Z");
        return statements.map((s) => s.sql);
      });
      expect(recorded.slice(1).map(placeholders)).toEqual([3]);
    });
  });
});

function placeholders(statement: string): number {
  return (statement.match(/\?/g) ?? []).length;
}

interface CompiledStatement {
  sql: string;
  params: unknown[];
}

interface DrizzleSession {
  prepareQuery(query: CompiledStatement, ...rest: unknown[]): { all(): unknown };
}

/** `tx` with the SQL of every statement drizzle compiles on it recorded. */
function recordingEveryStatement(tx: Transaction) {
  const statements: { sql: string }[] = [];
  const recording = new Proxy(tx, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "session") return value;
      const session = value as DrizzleSession;
      return new Proxy(session, {
        get: (inner, innerKey, innerReceiver) =>
          innerKey === "prepareQuery"
            ? (query: CompiledStatement, ...rest: unknown[]) => {
                statements.push({ sql: query.sql });
                return inner.prepareQuery(query, ...rest);
              }
            : Reflect.get(inner, innerKey, innerReceiver),
      });
    },
  });
  return { recording, statements };
}
