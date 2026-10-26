import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getCountryPack } from "@waitron/country-packs";
import { recordSale } from "@waitron/core";
import { invoiceDeliveries, invoiceSeries, sales, tenants } from "@waitron/db";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import {
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { inTx } from "./bill-venue.js";
import { parked, provisionOrderVenue, type OrderVenue } from "./order-venue.js";

export interface InvoiceCustomerSaleIds {
  j1: string;
  p1: string;
  j2: string;
  a1: string;
  c1: string;
  j3: string;
  s1: string;
}

/** Dashboard people beyond the venue's own administrator, supervisor and staff member. */
export interface InvoiceCustomerPeople {
  /** A second administrator, whose saved language is `es-ES`. */
  otherAdminId: string;
  otherAdminDashboard: string;
  managerId: string;
  managerDashboard: string;
}

export interface InvoiceCustomerVenue {
  venue: OrderVenue;
  fullSeriesId: string;
  sales: InvoiceCustomerSaleIds;
  people: InvoiceCustomerPeople;
}

interface Customer {
  name: string;
  taxId: string;
  address: string;
}

type Email = { recipient: string; status: "sent" | "failed" | "queued" };

/**
 * Starts an hour before the real time and moves one minute a reading, so every sale here has a
 * distinct `issued_at` in table order and every later real-clock write in the file is newer.
 */
function steppingClock(): TrustedClock {
  let next = Date.now() - 60 * 60_000;
  return {
    now: () => {
      const instant = new Date(next);
      next += 60_000;
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("invoice-customer-fixture: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

function checkedTaxId(value: string): string {
  if (!getCountryPack("ES")!.taxIdentifier!.validate(value).valid) {
    throw new Error(`invoice-customer-fixture: ${value} is not a valid tax number`);
  }
  return value;
}

/** Three lines adding to `total`: two of a third each, rounded down, and the rest. */
function threeLines(total: string, locale: string) {
  const cents = Math.round(Number(total) * 100);
  const third = Math.floor(cents / 3);
  return [third, third, cents - 2 * third].map((amount, index) => {
    const price = (amount / 100).toFixed(2);
    return {
      lineNo: index + 1,
      name: "Beer",
      descriptions: { [locale]: "Draught beer" },
      quantity: "1",
      unitPrice: price,
      vatRate: "10",
      lineTotal: price,
    };
  });
}

/**
 * The venue of plan A980 S3's fixture table: six full invoices (j1, p1, j2, a1, c1, j3) and one
 * simplified sale (s1), written through `recordSale` in that order, with the email deliveries the
 * table lists.
 */
export async function provisionInvoiceCustomerVenue(db: Database): Promise<InvoiceCustomerVenue> {
  const venue = await provisionOrderVenue(db);
  const clock = steppingClock();
  const fullSeriesId = await inTx(venue, async (tx) => {
    await tx.update(tenants).set({ taxpayerDomicile: "8 Fiscal Street, Madrid" });
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")));
    return series!.id;
  });

  async function sale(total: string, customer: Customer | null): Promise<string> {
    const billId = await parked(venue, "Caña");
    const { saleId } = await inTx(venue, (tx) =>
      recordSale(tx, venue.backend, {
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(customer ? fullSeriesId : venue.seriesId),
        workingOrderId: brandWorkingOrderId(billId),
        locale: venue.cfg.locale,
        invoiceLocales: venue.cfg.invoiceLocales,
        ...(customer && {
          counterparty: {
            taxId: checkedTaxId(customer.taxId),
            legalName: customer.name,
            countryCode: "ES",
          },
          recipientAddress: customer.address,
        }),
        total,
        lines: threeLines(total, venue.cfg.locale),
        clock,
        settlement: { kind: "deferred" },
        operatorId: venue.operatorId,
      }),
    );
    return saleId;
  }

  const sentReport = (at: string) => ({
    completedAt: at,
    reportedOutcome: "sent" as const,
    reportedAt: at,
  });

  async function emails(saleId: string, sent: readonly Email[]): Promise<void> {
    await inTx(venue, async (tx) => {
      for (const [index, email] of sent.entries()) {
        const at = clock.now().instant.toISOString();
        await tx.insert(invoiceDeliveries).values({
          saleId,
          requestKey: randomUUID(),
          medium: "email",
          designation: "original",
          status: email.status,
          generation: index + 1,
          recipient: email.recipient,
          personId: venue.operatorId,
          createdAt: at,
          // A minute after the request, so a reader giving one for the other is seen. An email
          // becomes sent only through its report, which records the outcome in the same write.
          ...(email.status === "sent" && sentReport(clock.now().instant.toISOString())),
        });
      }
    });
  }

  const jordi = { taxId: "12345678Z", address: "3 Port Avenue, 46024 Valencia" };
  const j1 = await sale("48.35", {
    name: "Jordi Puig",
    taxId: "12345678Z",
    address: "12 Harbour Road, 46023 Valencia",
  });
  await emails(j1, [{ recipient: "jordi@example.test", status: "sent" }]);
  await inTx(venue, async (tx) => {
    const at = clock.now().instant.toISOString();
    await tx.insert(invoiceDeliveries).values({
      saleId: j1,
      requestKey: randomUUID(),
      medium: "receipt",
      designation: "original",
      status: "sent",
      generation: 2,
      createdAt: at,
      completedAt: at,
    });
  });
  const p1 = await sale("310.07", {
    name: "Puig Electrical Ltd",
    taxId: "B76543214",
    address: "4 Mill Lane, 46001 Valencia",
  });
  await emails(p1, [{ recipient: "office@puig-electrical.example.test", status: "sent" }]);
  const j2 = await sale("112.40", { name: "Jordi Puig Electrician", ...jordi });
  await emails(j2, [
    { recipient: "jordi@example.test", status: "failed" },
    { recipient: "invoices@jordi.example.test", status: "sent" },
  ]);
  const a1 = await sale("23.18", {
    name: "Ana Garcia",
    taxId: "X1234567L",
    address: "9 Rose Street, 46010 Valencia",
  });
  const c1 = await sale("75.55", {
    name: "Main Street Residents",
    taxId: "E12345674",
    address: "1 Main Street, 46002 Valencia",
  });
  await emails(c1, [{ recipient: "board@mainstreet.example.test", status: "queued" }]);
  const j3 = await sale("23.95", { name: "Jordi Puig Electrician", ...jordi });
  const s1 = await sale("9.90", null);
  const people = await inTx(venue, async (tx) => {
    const [otherAdmin, manager] = await tx
      .insert(persons)
      .values([
        { displayName: "Otto Admin", role: "admin", locale: "es-ES" },
        { displayName: "Mia Manager", role: "manager" },
      ])
      .returning({ id: persons.id });
    const session = async (personId: string) =>
      `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId })).token}`;
    return {
      otherAdminId: otherAdmin!.id,
      otherAdminDashboard: await session(otherAdmin!.id),
      managerId: manager!.id,
      managerDashboard: await session(manager!.id),
    };
  });
  return { venue, fullSeriesId, sales: { j1, p1, j2, a1, c1, j3, s1 }, people };
}

/**
 * Plan decision 8's `invoices.json` for Jordi (12345678Z): j1, j2, j3 with what this fixture
 * wrote, the times and the tax-record flag read back from the database.
 */
export async function expectedJordiFile(fixture: InvoiceCustomerVenue) {
  const { db, backend } = fixture.venue;
  async function stored(saleId: string) {
    const [sale] = await db
      .select({ issuedAt: sales.issuedAt })
      .from(sales)
      .where(eq(sales.id, saleId));
    const deliveries = await db
      .select({
        createdAt: invoiceDeliveries.createdAt,
        completedAt: invoiceDeliveries.completedAt,
      })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, saleId))
      .orderBy(asc(invoiceDeliveries.generation));
    const filed = await backend.filedReceiptFor(db, brandSaleId(saleId));
    return {
      issuedAt: sale!.issuedAt,
      requestedAt: deliveries.map((row) => row.createdAt),
      completedAt: deliveries.map((row) => row.completedAt),
      taxRecord: filed !== undefined,
    };
  }
  const { j1, j2, j3 } = fixture.sales;
  const [one, two, three] = [await stored(j1), await stored(j2), await stored(j3)];
  return {
    taxId: "12345678Z",
    invoices: [
      {
        invoice: "FF/1",
        issuedAt: one.issuedAt,
        name: "Jordi Puig",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "12 Harbour Road, 46023 Valencia",
        total: "48.35",
        pdf: "invoices/FF-1.pdf",
        taxRecord: one.taxRecord,
        emails: [
          {
            to: "jordi@example.test",
            requestedAt: one.requestedAt[0],
            status: "sent",
            sentAt: one.completedAt[0],
            reportedOutcome: "sent",
            reportedAt: one.completedAt[0],
          },
        ],
      },
      {
        invoice: "FF/3",
        issuedAt: two.issuedAt,
        name: "Jordi Puig Electrician",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "3 Port Avenue, 46024 Valencia",
        total: "112.40",
        pdf: "invoices/FF-3.pdf",
        taxRecord: two.taxRecord,
        emails: [
          {
            to: "jordi@example.test",
            requestedAt: two.requestedAt[0],
            status: "failed",
            sentAt: null,
            reportedOutcome: null,
            reportedAt: null,
          },
          {
            to: "invoices@jordi.example.test",
            requestedAt: two.requestedAt[1],
            status: "sent",
            sentAt: two.completedAt[1],
            reportedOutcome: "sent",
            reportedAt: two.completedAt[1],
          },
        ],
      },
      {
        invoice: "FF/6",
        issuedAt: three.issuedAt,
        name: "Jordi Puig Electrician",
        taxId: "12345678Z",
        countryCode: "ES",
        address: "3 Port Avenue, 46024 Valencia",
        total: "23.95",
        pdf: "invoices/FF-6.pdf",
        taxRecord: three.taxRecord,
        emails: [],
      },
    ],
  };
}
