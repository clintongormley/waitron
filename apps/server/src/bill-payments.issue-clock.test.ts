import { randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments, locations, withTransaction, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import { departmentReceipts, departments } from "@waitron/venue-service";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { completeBillPayment } from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { createTable } from "./testing/live-table.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { DeviceRequestConfig } from "./till-config.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { readSettledTicket } from "./testing/whole-payment-fixture.js";
import "./errors.js";
import { openPartyTab } from "./testing/serve-line.js";
import { deviceRequestCfg, openTillSession } from "./testing/session-device.js";

// These cases issue invoices on a fixed past clock, so their database holds no record from a later
// clock: the chain refuses a record more than a minute earlier than the latest one.

// Synchronous work runs from case to case; let the venue watchdog tick between them.
afterEach(() => yieldTurn());

const LOCALE = "es-ES";
const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provision(db);
  },
});

let backend: FiscalBackend;
let clock: TrustedClock;

interface Venue {
  cfg: DeviceRequestConfig;
  /** OPERATOR's open session on the venue's device, which a bill payment is taken under. */
  operator: { personId: string; sessionId: string };
  offers: ZoneOffers;
  productIds: Map<string, string>;
}
let venue: Venue;

const MENU: { name: string; customer: string; kitchen: string; price: string }[] = [
  { name: "Chuletón", customer: "Chuletón a la brasa", kitchen: "CHULETA", price: "25.00" },
  { name: "Tarta", customer: "Tarta de queso", kitchen: "TARTA", price: "18.00" },
  { name: "Caña", customer: "Caña de cerveza", kitchen: "CANA", price: "3.00" },
];

async function provision(db: typeof suite.db): Promise<Venue> {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("bill-payments.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const provisioned = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "62000001M",
        legalName: "Pagos SL",
        taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });
  const rows = await db
    .select()
    .from(departments)
    .where(eq(departments.locationId, cfg.locationId));
  for (const department of rows)
    await db
      .insert(departmentReceipts)
      .values({ departmentId: department.id, receipt: { operationDescription: "Restaurante" } });
  const operator = {
    personId: OPERATOR,
    sessionId: await openTillSession(db, { deviceId: cfg.origin.deviceId, personId: OPERATOR }),
  };
  return withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: "Platos" });
    const productIds = new Map<string, string>();
    for (const item of MENU) {
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name: item.name,
        customerName: { [LOCALE]: item.customer },
        kitchenName: item.kitchen,
        pricingUnit: "each",
        unitPrice: item.price,
        vatClass: "general",
      });
      productIds.set(item.name, product.id);
    }
    await assignCatalogueToLocation(tx, provisioned.locationId, cat.id);
    const printer = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      { name: "Recibos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await tx.run(
      sql`update devices set receipt_printer_id = ${printer.id}, payment_slip_printer_id = ${printer.id}`,
    );
    return {
      cfg,
      operator,
      offers: await offerProducts(tx, cfg, { zone: "tables" }),
      productIds,
    };
  });
}

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const fiscal = () => ({ db: suite.db, backend, clock });

function offer(name: string): string {
  return venue.offers.offerFor(venue.productIds.get(name)!);
}

async function freshTable(): Promise<string> {
  return inTx(async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.offers.zoneId,
    });
    return table.id;
  });
}

async function tabWith(...names: string[]): Promise<string> {
  const tableId = await freshTable();
  return inTx(async (tx) => {
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId,
      lines: names.map((name) => ({ menuItemId: offer(name), quantity: "1" })),
    });
    return tabId;
  });
}

/** A bill payment written directly, in the state a card on a reader leaves it (plan Part 3). */
async function insertPayment(
  billId: string,
  values: Partial<typeof billPayments.$inferInsert>,
): Promise<string> {
  const [row] = await inTx((tx) =>
    tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: 1000,
        state: "pending",
        requestedBy: OPERATOR,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        ...values,
      })
      .returning({ id: billPayments.id }),
  );
  return row!.id;
}

describe("the invoice at full payment", () => {
  it.each([60, 0, -480])(
    "retains saved F1 issue offset %s across replay and a live zone change",
    async (offsetMinutes) => {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const issueClock: TrustedClock = {
        ...clock,
        now: () => ({
          instant: new Date("2026-10-06T22:10:00Z"),
          offsetMinutes,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
      };
      const completed = await inTx((tx) =>
        completeBillPayment(
          tx,
          { ...fiscal(), clock: issueClock },
          venue.cfg,
          paymentId,
          new Date("2026-10-06T22:10:00Z"),
        ),
      );
      const [location] = await inTx((tx) =>
        tx.select().from(locations).where(eq(locations.id, venue.cfg.locationId)),
      );
      try {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: "Pacific/Honolulu" })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
        const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
        for (const invoice of [completed.invoice!, replay]) {
          expect(invoice).toHaveProperty("issuedOffsetMinutes", offsetMinutes);
          expect(invoice.issuedAt).toBe("2026-10-06T22:10:00.000Z");
        }
        expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
      } finally {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: location!.timeZone })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
      }
    },
  );

  it.each([
    ["2026-10-06T21:50:00Z", "2026-10-06"],
    ["2026-10-06T22:05:00Z", undefined],
  ])(
    "retains the full-invoice service date from bill opening %s across replay",
    async (openedAt, expected) => {
      const billId = await tabWith("Caña");
      await inTx((tx) =>
        tx.update(workingOrders).set({ openedAt }).where(eq(workingOrders.id, billId)),
      );
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const issueClock: TrustedClock = {
        ...clock,
        now: () => ({
          instant: new Date("2026-10-06T22:10:00Z"),
          offsetMinutes: 120,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
      };
      const completed = await inTx((tx) =>
        completeBillPayment(
          tx,
          { ...fiscal(), clock: issueClock },
          venue.cfg,
          paymentId,
          new Date("2026-10-06T22:10:00Z"),
        ),
      );
      const [location] = await inTx((tx) =>
        tx.select().from(locations).where(eq(locations.id, venue.cfg.locationId)),
      );
      try {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: "Pacific/Honolulu" })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
        const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
        for (const invoice of [completed.invoice!, replay]) {
          expect(invoice.issuedAt).toBe("2026-10-06T22:10:00.000Z");
          if (expected === undefined) expect(invoice).not.toHaveProperty("operationDate");
          else expect(invoice).toMatchObject({ operationDate: expected });
        }
        expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
      } finally {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: location!.timeZone })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
      }
    },
  );
});
