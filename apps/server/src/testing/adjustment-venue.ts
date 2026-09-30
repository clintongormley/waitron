import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { createAdjustmentReason, type AdjustmentReasonInput } from "@waitron/adjustments";
import {
  deviceProfiles,
  kitchenStations,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "../config.js";
import { DEVICE_COOKIE } from "../device-session.js";
import type { Logger } from "../logger.js";
import { ALL_MODULES } from "../modules.js";
import { placeGroups } from "../order-groups.js";
import { seatTable } from "../parties.js";
import { attachPrinterToStation } from "../station-printers.js";
import { createTable } from "../tables.js";
import { mountTillApi } from "../till-api.js";
import { systemClock } from "../till-backend.js";
import type { TillConfig } from "../till-config.js";
import { SESSION_COOKIE } from "../till-session.js";
import { enrolDeviceForTest } from "./enrol.js";
import { offerProducts, type ZoneOffers } from "./zone-offers.js";

/**
 * A provisioned venue for the adjustment suites: real Veri*Factu filing that never contacts AEAT, a
 * kitchen printer on the default station, people at every role, and the reasons the cases apply.
 */
const LOCALE = "es-ES";

// Each product's staff, customer-facing and kitchen names differ (docs/developers/products.md).
const MENU: {
  name: string;
  customer: string;
  kitchen: string;
  price: string;
  unit: "each" | "weight";
  vat: "general" | "reduced";
}[] = [
  {
    name: "Burger",
    customer: "Hamburguesa",
    kitchen: "BURG",
    price: "12.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Steak",
    customer: "Chuletón a la brasa",
    kitchen: "CHULETA",
    price: "25.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Bottle",
    customer: "Rioja crianza",
    kitchen: "TINTO",
    price: "30.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Croquetas",
    customer: "Croquetas de jamón",
    kitchen: "CROQ",
    price: "3.33",
    unit: "each",
    vat: "general",
  },
  {
    name: "Ham",
    customer: "Jamón ibérico",
    kitchen: "JAMON",
    price: "24.00",
    unit: "weight",
    vat: "reduced",
  },
  {
    name: "Fish",
    customer: "Merluza a la plancha",
    kitchen: "MERLUZA",
    price: "12.99",
    unit: "weight",
    vat: "reduced",
  },
  {
    name: "Bread",
    customer: "Pan de pueblo",
    kitchen: "PAN",
    price: "2.50",
    unit: "each",
    vat: "reduced",
  },
  {
    name: "Water",
    customer: "Agua mineral",
    kitchen: "AGUA",
    price: "2.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Salad",
    customer: "Ensalada de la casa",
    kitchen: "ENSAL",
    price: "10.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Tortilla",
    customer: "Tapa de tortilla",
    kitchen: "TORT",
    price: "3.33",
    unit: "each",
    vat: "reduced",
  },
  {
    name: "Pimientos",
    customer: "Tapa de pimientos",
    kitchen: "PIMI",
    price: "3.33",
    unit: "each",
    vat: "reduced",
  },
  {
    name: "Cana",
    customer: "Caña de cerveza",
    kitchen: "CANA",
    price: "3.34",
    unit: "each",
    vat: "general",
  },
  {
    name: "Pizza",
    customer: "Pizza margarita",
    kitchen: "PIZZA",
    price: "9.00",
    unit: "each",
    vat: "general",
  },
  {
    name: "Olives",
    customer: "Aceitunas",
    kitchen: "ACEIT",
    price: "1.50",
    unit: "each",
    vat: "general",
  },
  // Poured at the bar: routed to no preparation, so it is stamped sent and gets no kitchen item.
  {
    name: "Coffee",
    customer: "Café solo",
    kitchen: "CAFE",
    price: "1.50",
    unit: "each",
    vat: "general",
  },
];

/** The reasons every suite shares; a case that edits a reason makes its own. */
export const REASONS = {
  /** Comp and every discount; €30.00 a bill and 50% a line; supervisors apply, managers approve. */
  complaint: {
    name: "Complaint",
    names: { en: "Complaint", es: "Queja" },
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: 5000,
    maxAmount: decimal("30.00"),
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: false,
  },
  /** Every action, no limits, anyone. */
  house: {
    name: "House",
    names: { en: "House", es: "Casa" },
    actions: ["cancel", "comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "staff",
    noteRequired: false,
  },
  /** Cancel only, with a note. */
  mistake: {
    name: "Mistake",
    names: { en: "Mistake", es: "Error" },
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "staff",
    noteRequired: true,
  },
} satisfies Record<string, AdjustmentReasonInput>;

export interface AdjustmentVenue {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TillConfig;
  /** The display language the till routes are mounted with; the same code as `cfg.locale`. */
  venueLocale: string;
  tables: ZoneOffers;
  /** The offer selling the product named `name` in the tables zone. */
  item(name: string): string;
  /** The extras list offered with the Pizza, holding the Olives at €1.50. */
  pizzaExtras: string;
  olivesId: string;
  stationId: string;
  printerId: string;
  reasonId: Record<keyof typeof REASONS, string>;
  /** People by role; each one's PIN is in {@link PINS}. */
  staffId: string;
  supervisorId: string;
  managerId: string;
  app: Hono;
  /** A till device and the session of each person, by role. */
  cookie: { staff: string; supervisor: string; manager: string };
}

export const PINS = { staff: "5555", supervisor: "6666", manager: "7777" } as const;

const quiet: Logger = () => {};

export async function provisionAdjustmentVenue(db: Database): Promise<AdjustmentVenue> {
  const clock = systemClock();
  const backend = new VerifactuBackend({
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
        taxId: "62000003K",
        legalName: "Ajustes SL",
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
    tillId: brandTillId(provisioned.tillId),
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const [station] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.isDefault, true));
    const printer = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      { name: "Cocina", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await attachPrinterToStation(tx, { stationId: station!.id, printerId: printer.id });
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
    const productIds = new Map<string, string>();
    for (const item of MENU) {
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name: item.name,
        customerName: { [LOCALE]: item.customer },
        kitchenName: item.kitchen,
        pricingUnit: item.unit,
        unitPrice: item.price,
        vatClass: item.vat,
      });
      productIds.set(item.name, product.id);
    }
    const extras = await createExtraList(
      tx,
      {
        name: "Toppings",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [
          {
            productId: productIds.get("Olives")!,
            maxQuantity: 2,
            preselected: false,
            price: "1.50",
          },
        ],
      },
      LOCALE,
    );
    await writeProductModifiers(tx, productIds.get("Pizza")!, [{ kind: "extras", id: extras.id }]);
    await assignCatalogueToLocation(tx, provisioned.locationId, cat.id);
    const tables = await offerProducts(tx, cfg, { zone: "tables" });
    await tx.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = ${productIds.get("Coffee")!}`);
    const people = await tx
      .insert(persons)
      .values([
        { displayName: "Ana", pinHash: hashPin(PINS.staff), role: "staff" },
        { displayName: "Sara", pinHash: hashPin(PINS.supervisor), role: "supervisor" },
        { displayName: "Marta", pinHash: hashPin(PINS.manager), role: "manager" },
      ])
      .returning({ id: persons.id });
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: "Counter till", formFactor: "till", capabilities: [] })
      .returning({ id: deviceProfiles.id });
    const reasonId = {} as Record<keyof typeof REASONS, string>;
    for (const [key, input] of Object.entries(REASONS)) {
      reasonId[key as keyof typeof REASONS] = (await createAdjustmentReason(tx, input)).id;
    }
    return {
      productIds,
      tables,
      stationId: station!.id,
      printerId: printer.id,
      pizzaExtras: extras.id,
      people: people.map((person) => person.id),
      profileId: profile!.id,
      reasonId,
    };
  });
  const [staffId, supervisorId, managerId] = seeded.people as [string, string, string];
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId: seeded.profileId });
  const cookieOf = async (personId: string, pin: string) => {
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { tillId: cfg.tillId, personId, pin }),
    );
    return `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  };
  const app = new Hono();
  mountTillApi(app, { db, backend, clock, cfg, secureCookies: false, venueLocale: LOCALE }, quiet);
  return {
    db,
    backend,
    clock,
    cfg,
    venueLocale: LOCALE,
    tables: seeded.tables,
    item: (name) => seeded.tables.offerFor(seeded.productIds.get(name)!),
    pizzaExtras: seeded.pizzaExtras,
    olivesId: seeded.productIds.get("Olives")!,
    stationId: seeded.stationId,
    printerId: seeded.printerId,
    reasonId: seeded.reasonId,
    staffId,
    supervisorId,
    managerId,
    app,
    cookie: {
      staff: await cookieOf(staffId, PINS.staff),
      supervisor: await cookieOf(supervisorId, PINS.supervisor),
      manager: await cookieOf(managerId, PINS.manager),
    },
  };
}

export function inTx<T>(venue: Pick<AdjustmentVenue, "db">, fn: (tx: Transaction) => Promise<T>) {
  return withTransaction(venue.db, fn);
}

/** One round line: a product by name, a quantity, and extras picks for the Pizza. */
export interface RoundLine {
  name: string;
  quantity?: string;
  olives?: number;
}

/**
 * A party seated at a fresh table by `operatorId`, with `lines` placed on its bill as one group,
 * fired or held. Answers the party, its bill and the bill's revision.
 */
export async function billWith(
  venue: AdjustmentVenue,
  lines: RoundLine[],
  opts: { release?: "fire" | "hold"; operatorId?: string } = {},
): Promise<{ partyId: string; billId: string; revision: number }> {
  const operatorId = opts.operatorId ?? venue.staffId;
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.tables.zoneId,
    });
    const seated = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId,
    });
    if (lines.length > 0) {
      await placeGroups(tx, venue.cfg, seated.partyId, {
        groups: [
          {
            lines: lines.map((line) => ({
              menuItemId: venue.item(line.name),
              quantity: line.quantity ?? "1",
              ...(line.olives === undefined
                ? {}
                : {
                    extras: [
                      {
                        listId: venue.pizzaExtras,
                        picks: [{ productId: venue.olivesId, quantity: line.olives }],
                      },
                    ],
                  }),
            })),
            release: opts.release ?? "fire",
          },
        ],
        operatorId,
        billId: seated.tabId,
      });
    }
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, seated.tabId));
    return { partyId: seated.partyId, billId: seated.tabId, revision: order!.revision };
  });
}

/** A bill's rows in line order, as the cases read them: prices and totals as decimal strings. */
export async function rowsOf(venue: Pick<AdjustmentVenue, "db">, billId: string) {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({
        id: workingOrderLines.id,
        lineNo: workingOrderLines.lineNo,
        name: workingOrderLines.name,
        parentLineId: workingOrderLines.parentLineId,
        quantity: workingOrderLines.quantity,
        unitPriceGross: workingOrderLines.unitPriceGross,
        listUnitPriceGross: workingOrderLines.listUnitPriceGross,
        lineTotal: workingOrderLines.lineTotal,
        groupId: workingOrderLines.groupId,
        creditedTo: workingOrderLines.creditedTo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
  return rows.map((row) => ({
    ...row,
    quantity: (row.quantity / 1000).toFixed(3),
    unitPriceGross: (row.unitPriceGross / 100).toFixed(2),
    listUnitPriceGross:
      row.listUnitPriceGross === null ? null : (row.listUnitPriceGross / 100).toFixed(2),
    lineTotal: (row.lineTotal / 100).toFixed(2),
  }));
}

/** Line `lineNo`'s id on the bill. */
export async function lineIdOf(
  venue: Pick<AdjustmentVenue, "db">,
  billId: string,
  lineNo: number,
): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      ),
  );
  if (row === undefined) throw new Error(`no line ${lineNo} on bill ${billId}`);
  return row.id;
}

/** The ticket item of line `lineNo`. */
export async function ticketOf(venue: Pick<AdjustmentVenue, "db">, billId: string, lineNo: number) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: ticketItems.id, stationId: ticketItems.stationId, state: ticketItems.state })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      ),
  );
  if (row === undefined) throw new Error(`no ticket item for line ${lineNo}`);
  return row;
}
