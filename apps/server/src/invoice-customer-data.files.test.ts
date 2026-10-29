import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceDeliveries, withTransaction, type Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { jsonFile } from "@waitron/module";
import { eq } from "drizzle-orm";
import {
  INVOICE_CUSTOMER_FILE,
  buildInvoiceCustomerFiles,
  findInvoiceCustomerSales,
  type InvoiceCustomerFilesDeps,
} from "./invoice-customer-data.js";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceEmailDelivery,
  reserveInvoiceDelivery,
} from "./invoice-delivery.js";
import type { Logger } from "./logger.js";
import {
  expectedJordiFile,
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

const STUB_PDF = new TextEncoder().encode("%PDF-stub");
const quiet: Logger = () => {};

function jordi() {
  return suite.db.withWriteLock(() => findInvoiceCustomerSales(suite.db, "12345678Z"));
}

function deps(overrides: Partial<InvoiceCustomerFilesDeps> = {}): InvoiceCustomerFilesDeps {
  return {
    db: suite.db,
    backend: fixture.venue.backend,
    tradingContext: fixture.venue.cfg,
    log: quiet,
    render: () => Promise.resolve(STUB_PDF),
    ...overrides,
  };
}

async function build(overrides: Partial<InvoiceCustomerFilesDeps> = {}) {
  return buildInvoiceCustomerFiles(deps(overrides), "12345678Z", await jordi());
}

function invoicesText(files: readonly { name: string; content: string | Uint8Array }[]): string {
  const file = files.find((f) => f.name === INVOICE_CUSTOMER_FILE);
  expect(typeof file?.content).toBe("string");
  return file!.content as string;
}

/** The backend, answering `filedReceiptFor` with nothing for the sales `unfiled` names. */
function backendWithout(unfiled: (saleId: string) => boolean): FiscalBackend {
  const real = fixture.venue.backend;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "filedReceiptFor") {
        return (tx: Parameters<FiscalBackend["filedReceiptFor"]>[0], saleId: string) =>
          unfiled(saleId)
            ? Promise.resolve(undefined)
            : target.filedReceiptFor(tx, saleId as Parameters<FiscalBackend["filedReceiptFor"]>[1]);
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

describe("buildInvoiceCustomerFiles", () => {
  it("writes Jordi's invoices.json exactly, emails only, in decision 8's key order", async () => {
    const { j1 } = fixture.sales;
    const receipts = await suite.db
      .select({ medium: invoiceDeliveries.medium })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, j1));
    expect(receipts.map((row) => row.medium).sort()).toEqual(["email", "receipt"]);

    const built = await build();
    const expected = await expectedJordiFile(fixture);
    const text = invoicesText(built.files);
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).toBe(jsonFile(INVOICE_CUSTOMER_FILE, expected).content);
    expect(built.files.map((f) => f.name)).toEqual([
      "invoices.json",
      "invoices/FF-1.pdf",
      "invoices/FF-3.pdf",
      "invoices/FF-6.pdf",
    ]);
    for (const file of built.files.slice(1)) expect(file.content).toEqual(STUB_PDF);
    expect(built.anyEmail).toBe(true);
    expect(built.anyTaxRecord).toBe(expected.invoices.some((invoice) => invoice.taxRecord));
  });

  it("writes the tax number it is given as invoices.json's own, without normalising it again", async () => {
    const built = await buildInvoiceCustomerFiles(deps(), "ES12345678Z", await jordi());
    expect((JSON.parse(invoicesText(built.files)) as { taxId: string }).taxId).toBe("ES12345678Z");
  });

  it("keeps a late report that an email went, beside the attempt's own state", async () => {
    // The company's invoice, so Jordi's exact file in the other cases is untouched.
    const { p1 } = fixture.sales;
    const claimedAt = new Date(Date.now() + 60_000);
    const expiredAt = new Date(claimedAt.getTime() + 120_000);
    const reportedAt = new Date(expiredAt.getTime() + 1_000);
    const request = (recipient: string) => ({
      requestKey: randomUUID(),
      personId: fixture.venue.adminId,
      medium: "email" as const,
      recipient,
    });
    const late = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, p1, request("late@example.test")),
    );
    const claim = await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, late.id, "files-test", claimedAt),
    );
    await withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, expiredAt));
    await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, p1, request("newer@example.test")),
    );
    const outcome = await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(tx, claim!, { status: "sent" }, reportedAt),
    );
    expect(outcome.historical).toBe(true);
    const [stored] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.id, late.id));

    const sales = await suite.db.withWriteLock(() =>
      findInvoiceCustomerSales(suite.db, "B76543214"),
    );
    const built = await buildInvoiceCustomerFiles(deps(), "B76543214", sales);
    const file = JSON.parse(invoicesText(built.files)) as {
      invoices: { emails: { to: string }[] }[];
    };
    expect(file.invoices[0]!.emails.find((email) => email.to === "late@example.test")).toEqual({
      to: "late@example.test",
      requestedAt: stored!.createdAt,
      status: "unknown",
      sentAt: null,
      reportedOutcome: "sent",
      reportedAt: reportedAt.toISOString(),
    });
  });

  it("names nothing of the other customers' or of staff in invoices.json", async () => {
    const text = invoicesText((await build()).files);
    const staff = await suite.db
      .select({ personId: invoiceDeliveries.personId })
      .from(invoiceDeliveries);
    const personIds = staff.flatMap((row) => (row.personId === null ? [] : [row.personId]));
    expect(personIds.length).toBeGreaterThan(0);
    for (const value of [
      "Puig Electrical",
      "B76543214",
      "X1234567L",
      "E12345674",
      "310.07",
      "office@puig-electrical.example.test",
      "board@mainstreet.example.test",
      ...personIds,
    ])
      expect(text).not.toContain(value);
    expect(text).toContain("invoices@jordi.example.test");
  });

  it("marks taxRecord from filedReceiptFor, each invoice on its own", async () => {
    const { j1 } = fixture.sales;
    const one = await build({ backend: backendWithout((id) => id === j1) });
    const flags = (
      JSON.parse(invoicesText(one.files)) as { invoices: { taxRecord: boolean }[] }
    ).invoices.map((invoice) => invoice.taxRecord);
    expect(flags).toEqual([false, true, true]);
    expect(one.anyTaxRecord).toBe(true);

    const none = await build({ backend: backendWithout(() => true) });
    expect(
      (JSON.parse(invoicesText(none.files)) as { invoices: { taxRecord: boolean }[] }).invoices.map(
        (invoice) => invoice.taxRecord,
      ),
    ).toEqual([false, false, false]);
    expect(none.anyTaxRecord).toBe(false);
  });

  /** Counts the lock turns; each turn and each render queues a `setImmediate` marker of its index,
   * and the start of every turn and every render records which markers had run by then. */
  function observedDb() {
    const turns: number[][] = [];
    const renders: number[][] = [];
    const ran: number[] = [];
    const rendered: number[][] = [];
    const renderRan: number[] = [];
    let open = false;
    const db = new Proxy(suite.db, {
      get(target, prop) {
        if (prop === "withWriteLock") {
          return <T>(body: () => Promise<T>) =>
            target.withWriteLock(async () => {
              const index = turns.length;
              turns.push([...ran]);
              setImmediate(() => ran.push(index));
              open = true;
              try {
                return await body();
              } finally {
                open = false;
              }
            });
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as Database;
    const render = async (): Promise<Uint8Array> => {
      renders.push([...ran]);
      const index = rendered.length;
      rendered.push([...renderRan]);
      setImmediate(() => renderRan.push(index));
      expect(open).toBe(false);
      // The lock is not re-entrant: this resolves only when no turn is open.
      await suite.db.withWriteLock(() => Promise.resolve());
      return STUB_PDF;
    };
    return { db, render, turns, renders, rendered };
  }

  it("reads each invoice in one lock turn and renders outside every turn", async () => {
    const seen = observedDb();
    await build({ db: seen.db, render: seen.render });
    expect(seen.turns).toHaveLength(3);
    expect(seen.renders).toHaveLength(3);
  });

  it("lets the event loop take a turn after every invoice turn and every render", async () => {
    const seen = observedDb();
    await build({ db: seen.db, render: seen.render });
    expect(seen.turns).toEqual([[], [0], [0, 1]]);
    expect(seen.renders).toEqual([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]);
    expect(seen.rendered).toEqual([[], [0], [0, 1]]);
  });
});
