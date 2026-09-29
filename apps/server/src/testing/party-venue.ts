import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  addProductToMenu,
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import {
  billPayments,
  diningTables,
  parties,
  partyTables,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { allowMenuInZone } from "@waitron/venue-service";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { splitBill } from "../bill-actions.js";
import { takeBillPayment } from "../bill-payments.js";
import { deploymentEnvironment } from "../config.js";
import { ALL_MODULES, VENUE_SERVICE } from "../modules.js";
import { placeGroups } from "../order-groups.js";
import { memberTables, seatTable, setPartyName } from "../parties.js";
import { joinTables } from "../table-actions.js";
import { createTable } from "../tables.js";
import type { TillConfig } from "../till-config.js";
import { systemClock } from "../till-backend.js";
import { payWorkingOrder } from "../till-sale.js";
import { addTabRound, listTablesWithState, parkOrder } from "../working-order.js";
import { publishWorkingMenu } from "./publish-menu.js";
import { offerProducts, type ZoneOffers } from "./zone-offers.js";

/**
 * A provisioned venue for the party suites: real Veri*Factu filing that never contacts AEAT, one
 * catalogue sold in the "tables" zone, and helpers that seat, order and pay as the till does.
 */
const LOCALE = "es-ES";

export const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

// Each product's staff, customer-facing and kitchen names differ (docs/developers/products.md).
const MENU: { name: string; customer: string; kitchen: string; price: string }[] = [
  { name: "Burger", customer: "Hamburguesa de la casa", kitchen: "BURG", price: "12.00" },
  { name: "Vino", customer: "Rioja crianza", kitchen: "TINTO", price: "30.00" },
  { name: "Agua", customer: "Agua mineral", kitchen: "AGUA", price: "2.00" },
  { name: "Flan", customer: "Flan de huevo", kitchen: "FLAN", price: "5.00" },
  { name: "Paella", customer: "Paella valenciana", kitchen: "PAELLA", price: "20.00" },
  { name: "Tarta", customer: "Tarta de queso", kitchen: "TARTA", price: "15.00" },
  { name: "Caña", customer: "Caña de cerveza", kitchen: "CANA", price: "3.00" },
];

export interface PartyVenue {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TillConfig;
  /** The "tables" zone. */
  tables: ZoneOffers;
  /** The venue's counter-default zone, selling the same offers as the tables zone. */
  counter: ZoneOffers;
  /** The offer selling the product named `name` in the tables zone. */
  item(name: string): string;
  /** The offer selling the product named `name` in the counter zone. */
  counterItem(name: string): string;
  productId(name: string): string;
  /** A fresh dining table, in the tables zone unless another is named. */
  table(label: string, zoneId?: string): Promise<string>;
}

/** What the database-only helpers need: a suite's `useVenueDb` handle passes too. */
type HasDb = Pick<PartyVenue, "db">;

export async function setupPartyVenue(db: Database): Promise<PartyVenue> {
  const clock = systemClock();
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("party venue: filing a sale never contacts AEAT")),
  });
  const venue: VenueResult = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "60000001K",
        legalName: "Visitas SL",
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
        tillName: "Caja 1",
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
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { tables, counter, productIds } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
    for (const product of MENU) {
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name: product.name,
        customerName: { [LOCALE]: product.customer },
        kitchenName: product.kitchen,
        pricingUnit: "each",
        unitPrice: product.price,
        vatClass: "general",
      });
    }
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    return {
      tables: await offerProducts(tx, cfg, { zone: "tables" }),
      counter: await offerProducts(tx, cfg, { zone: "counter" }),
      productIds: new Map(available.map((p) => [p.name, p.id])),
    };
  });
  return {
    db,
    backend,
    clock,
    cfg,
    tables,
    counter,
    item: (name) => tables.offerFor(productIds.get(name)!),
    counterItem: (name) => counter.offerFor(productIds.get(name)!),
    productId: (name) => productIds.get(name)!,
    table: (label, zoneId = tables.zoneId) =>
      withTransaction(db, async (tx) => {
        const { id } = await createTable(tx, cfg, { label, zoneId });
        return id;
      }),
  };
}

/** A dining table in the tables zone at a chosen id, for a test whose answer must not follow id order. */
export async function tableAt(v: PartyVenue, id: string, label: string): Promise<string> {
  await inTx(v, (tx) =>
    tx
      .insert(diningTables)
      .values({ id, locationId: v.cfg.locationId, label, zoneId: v.tables.zoneId }),
  );
  return id;
}

export function inTx<T>(v: HasDb, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(v.db, fn);
}

export async function seat(
  v: PartyVenue,
  tableId: string,
  guestCount: number | null = null,
): Promise<{ partyId: string; tabId: string; revision: number }> {
  return inTx(v, (tx) => seatTable(tx, v.cfg, { tableId, guestCount, operatorId: OPERATOR }));
}

/** One of each dish named, added to that bill as a round. */
export async function order(v: PartyVenue, billId: string, ...names: string[]): Promise<void> {
  await inTx(v, (tx) =>
    addTabRound(
      tx,
      v.cfg,
      billId,
      names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
    ),
  );
}

/** One of each dish named, sent as one fired group by {@link OPERATOR}, to `billId` when given. */
export async function orderForParty(
  v: PartyVenue,
  partyId: string,
  names: string[],
  billId?: string,
): Promise<{ tabId: string; revision: number }> {
  const { tabId, revision } = await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: [
        {
          lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
          release: "fire",
        },
      ],
      operatorId: OPERATOR,
      ...(billId === undefined ? {} : { billId }),
    }),
  );
  return { tabId, revision };
}

/** What a tab path is sent on a party: the revision the caller read, and who acts. */
export async function commandFor(
  v: HasDb,
  partyId: string,
): Promise<{ expectedPartyRevision: number; operatorId: string }> {
  return { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
}

/** Splits the named lines off the bill onto a new bill of the party, as the till's split does. */
export async function split(
  v: PartyVenue,
  partyId: string,
  billId: string,
  lineNos: number[],
): Promise<string> {
  const sent = await commandFor(v, partyId);
  const split = await inTx(v, (tx) =>
    splitBill(
      tx,
      v.cfg,
      billId,
      lineNos.map((lineNo) => ({ lineNo })),
      sent,
    ),
  );
  return split.billId;
}

/**
 * Waits until the clock reads a later millisecond. `joined_at` is stamped to the millisecond and a
 * tie orders by random id, so a test that expects tables in the order they joined calls this before
 * each later join.
 */
export async function nextMillisecond(): Promise<void> {
  const start = Date.now();
  while (Date.now() <= start) await new Promise((resolve) => setTimeout(resolve, 1));
}

/** Joins a free table to the party, as the till's join does, a millisecond after the last. */
export async function join(v: PartyVenue, partyId: string, tableId: string): Promise<void> {
  await nextMillisecond();
  const sent = await commandFor(v, partyId);
  await inTx(v, (tx) =>
    joinTables(tx, v.cfg, partyId, tableId, { ...sent, bills: "merge", otherPartyId: null }),
  );
}

/** Names the party, as the till's rename does. */
export async function nameParty(v: HasDb, partyId: string, name: string): Promise<void> {
  const expectedPartyRevision = await revisionOf(v, partyId);
  await inTx(v, (tx) => setPartyName(tx, { partyId, name, expectedPartyRevision }));
}

/** The table as the till's floor lists it. */
export async function floorRow(v: Pick<PartyVenue, "db" | "cfg">, tableId: string) {
  const rows = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
  return rows.find((row) => row.id === tableId)!;
}

/** Pays the bill in cash in one go. */
export async function pay(v: PartyVenue, billId: string, amount: string): Promise<void> {
  await payWorkingOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, {
    id: billId,
    lines: [],
    tender: { method: "cash", amount },
  });
}

/**
 * A bill that is placed but unpaid. By direct write: no product path places a bill that belongs to a
 * table's party — a split bill takes its source's `table_tab` mode, which files nothing at placing.
 */
export async function placeByHand(v: HasDb, billId: string): Promise<void> {
  await inTx(v, (tx) =>
    tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, billId)),
  );
}

export async function revisionOf(v: HasDb, partyId: string): Promise<number> {
  const [row] = await inTx(v, (tx) =>
    tx.select({ revision: parties.revision }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.revision;
}

export async function partyRow(v: HasDb, partyId: string): Promise<typeof parties.$inferSelect> {
  const [row] = await inTx(v, (tx) => tx.select().from(parties).where(eq(parties.id, partyId)));
  return row!;
}

/** The tables the party holds, in the order they joined it. */
export async function activeTablesOf(v: HasDb, partyId: string): Promise<string[]> {
  return inTx(v, (tx) => memberTables(tx, partyId));
}

export async function tableRow(
  v: HasDb,
  tableId: string,
): Promise<typeof diningTables.$inferSelect> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return row!;
}

export async function billRow(
  v: HasDb,
  billId: string,
): Promise<typeof workingOrders.$inferSelect> {
  const [row] = await inTx(v, (tx) =>
    tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
  );
  return row!;
}

export async function statusOf(v: HasDb, billId: string): Promise<string> {
  return (await billRow(v, billId)).status;
}

/** The party's own bills, in the order they were opened. */
export async function billsOfParty(v: HasDb, partyId: string): Promise<string[]> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId))
      .orderBy(asc(workingOrders.openedAt), asc(workingOrders.orderNumber)),
  );
  return rows.map((row) => row.id);
}

/** The bill's lines in line order, as stored: quantity in thousandths, price in cents. */
export async function linesOf(
  v: HasDb,
  billId: string,
): Promise<
  {
    lineNo: number;
    name: string;
    quantity: number;
    unitPriceGross: number;
    vatClass: string;
    groupId: string | null;
  }[]
> {
  return inTx(v, (tx) =>
    tx
      .select({
        lineNo: workingOrderLines.lineNo,
        name: workingOrderLines.name,
        quantity: workingOrderLines.quantity,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatClass: workingOrderLines.vatClass,
        groupId: workingOrderLines.groupId,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** An open counter order of no party in the counter zone, one of each dish named. */
export async function counterOrder(v: PartyVenue, ...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: v.db }, v.cfg, {
    id,
    zoneId: v.counter.zoneId,
    lines: names.map((name) => ({ menuItemId: v.counterItem(name), quantity: "1" })),
    operatorId: OPERATOR,
  });
  return id;
}

/**
 * A menu of its own offering the product at `price`, allowed in the zone and made its default, and
 * published; answers the offer. Every other zone keeps selling the product at its own price.
 */
export async function pricedInZone(
  v: PartyVenue,
  zoneId: string,
  productName: string,
  price: string,
): Promise<string> {
  return inTx(v, async (tx) => {
    const menu = await createCatalogue(tx, { name: `Precios ${randomUUID().slice(0, 8)}` });
    const offer = await addProductToMenu(tx, {
      menuId: menu.id,
      productId: v.productId(productName),
      grossPrice: price,
    });
    await allowMenuInZone(tx, v.cfg, zoneId, menu.id, { makeDefault: true });
    await publishWorkingMenu(tx, menu.id);
    return offer.id;
  });
}

/** The party holding the table now, or null. */
export async function partyAt(v: HasDb, tableId: string): Promise<string | null> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ partyId: partyTables.partyId })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt))),
  );
  return row?.partyId ?? null;
}

/** A cash contribution of `amount` towards the bill; answers the payment's id. */
export async function cashContribution(
  v: PartyVenue,
  billId: string,
  amount: string,
): Promise<string> {
  const result = await takeBillPayment(
    { db: v.db, backend: v.backend, clock: v.clock },
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
    OPERATOR,
  );
  return result.payment.id;
}

/** The bill's payments, oldest first. */
export async function paymentsOf(v: HasDb, billId: string) {
  return inTx(v, (tx) =>
    tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId))
      .orderBy(asc(billPayments.createdAt)),
  );
}

/** The service zone the bill's context names, or null when it has none. */
export async function zoneOf(v: Pick<PartyVenue, "db" | "cfg">, billId: string) {
  const context = await inTx(v, (tx) => VENUE_SERVICE.findOrderContext(tx, v.cfg, billId));
  return context?.zoneId ?? null;
}
