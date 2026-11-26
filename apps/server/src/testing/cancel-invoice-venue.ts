import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect } from "vitest";
import {
  invoiceSeries,
  nextInvoiceNumberOf,
  saleLines,
  sales,
  workingOrders,
  type Database,
} from "@waitron/db";
import {
  createExtraList,
  createProduct,
  setTakeawayVatRate,
  units,
  writeProductModifiers,
} from "@waitron/menu";
import { verifactuRecords } from "@waitron/fiscal-verifactu";
import { hashPin, loginWithPin } from "@waitron/identity";
import { removeBuiltInPermissionForTest, seedPersons } from "@waitron/identity/test/person-rows.js";
import { decimal, deviceId as brandDeviceId, negateDecimal } from "@waitron/shared";
import { SESSION_COOKIE } from "../till-session.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./bill-venue.js";
import { issueOrderInvoice } from "./issue-order.js";
import { testTradingAdmission } from "./trading-admission.js";
import { offerProducts } from "./zone-offers.js";

export const SUPERVISOR_PIN = "7777";

/** A bill venue whose invoice-first counter zone offers the products a credit is checked on. */
export interface CancelInvoiceVenue {
  venue: BillVenue;
  ticketThenPayZone: string;
  /** Menu-item id of each product by its staff name, offered in the invoice-first counter zone. */
  offerOf: (name: string) => string;
  productIdOf: (name: string) => string;
  /** Café's extras list, offering Leche at 0.50. */
  extraListId: string;
  portionListId: string;
  supervisorId: string;
  /** The supervisor's own session on the first till's device: holds `sale.rectify`. */
  supervisorCookie: string;
  supervisorSessionId: string;
}

export async function provisionCancelInvoiceVenue(db: Database): Promise<CancelInvoiceVenue> {
  const venue = await provisionBillVenue(db);
  let extraListId = "";
  let portionListId = "";
  await inTx(venue, (tx) => removeBuiltInPermissionForTest(tx, "staff", "cash.drawer"));
  const productIds = await inTx(venue, async (tx) => {
    const [kg] = await tx
      .insert(units)
      .values({
        staffName: "Staff unit",
        staffAbbreviation: "su",
        seedKey: "credit-test-kg",
        name: { "es-ES": "kilogramo" },
        abbreviation: { "es-ES": "kg" },
        precision: 3,
        hardwareUnit: "kg",
      })
      .returning({ id: units.id });
    const [category] = db.all<{ id: string }>(sql`select id from categories where name = 'Platos'`);
    // Taken away at 21%, 0.55 is invoiced 0.45 + 0.10 by the menu's gross arithmetic and 2.10 is
    // 1.74 + 0.36, while those bases taxed at 21% are 0.09 and 0.37; Café with two 0.50 extras at
    // 10% matches both ways.
    const created = new Map<string, string>();
    for (const [name, price, vatClass, takeawayVatRate] of [
      ["Mosto", "0.55", "general", "21.00"],
      ["Zumo", "2.10", "general", "21.00"],
      ["Café", "3.00", "reduced", "10.00"],
      ["Leche", "1.00", "reduced", "10.00"],
    ] as const) {
      const product = await createProduct(tx, {
        categoryId: category!.id,
        name,
        customerName: { [venue.cfg.locale]: `${name} de la casa` },
        kitchenName: name.toUpperCase(),
        pricingUnit: "each",
        unitPrice: price,
        vatClass,
        takeawayVatRate,
      });
      created.set(name, product.id);
    }
    const extras = await createExtraList(
      tx,
      {
        name: "Añadidos",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [
          { productId: created.get("Leche"), maxQuantity: 2, preselected: false, price: "0.50" },
        ],
      },
      venue.cfg.locale,
    );
    extraListId = extras.id;
    const ham = await createProduct(tx, {
      categoryId: category!.id,
      name: "Jamón",
      unitId: kg!.id,
      unitPrice: "0.27",
      vatClass: "general",
      takeawayVatRate: "21.00",
    });
    const portions = await createExtraList(
      tx,
      {
        name: "Porciones",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 3,
        active: true,
        items: [
          {
            productId: ham.id,
            portion: "0.050",
            maxQuantity: 3,
            preselected: false,
            price: null,
          },
        ],
      },
      venue.cfg.locale,
    );
    portionListId = portions.id;
    await writeProductModifiers(tx, created.get("Café")!, [{ kind: "extras", id: extras.id }]);
    const [beer] = db.all<{ id: string }>(sql`select id from products where name = 'Small beer'`);
    await setTakeawayVatRate(tx, beer!.id, "21.00");
    await writeProductModifiers(tx, created.get("Mosto")!, [{ kind: "extras", id: portions.id }]);
    return new Map(
      db
        .all<{ id: string; name: string }>(sql`select id, name from products`)
        .map((row) => [row.name, row.id]),
    );
  });
  const offers = await inTx(venue, (tx) =>
    offerProducts(tx, { zone: "counter", orderStart: "counter" }),
  );
  const productIdOf = (name: string) => productIds.get(name)!;
  const { supervisorId, session } = await inTx(venue, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Sophia",
      pinHash: hashPin(SUPERVISOR_PIN),
      role: "supervisor",
    });
    return {
      supervisorId: person!.id,
      session: await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: person!.id,
        pin: SUPERVISOR_PIN,
      }),
    };
  });
  const [, ...device] = venue.cookie.split("; ");
  return {
    venue,
    ticketThenPayZone: offers.zoneId,
    offerOf: (name) => offers.offerFor(productIdOf(name)),
    productIdOf,
    extraListId,
    portionListId,
    supervisorId,
    supervisorCookie: [`${SESSION_COOKIE}=${session.token}`, ...device].join("; "),
    supervisorSessionId: session.id,
  };
}

/** Park and place through the routes, optionally seeding an issued invoice between them. */
export async function placed(
  v: CancelInvoiceVenue,
  lines: { name: string; quantity: string; extras?: unknown[] }[],
  zoneId = v.ticketThenPayZone,
  issued = true,
  dining: "eat_in" | "takeaway" = "eat_in",
): Promise<string> {
  const { venue } = v;
  const id = randomUUID();
  const parked = await send(venue.app, venue.cookie, "POST", "/api/working-orders", {
    dining: "eat_in",
    id,
    zoneId,
    lines: lines.map(({ name, ...line }) => ({ menuItemId: v.offerOf(name), ...line })),
  });
  expect(parked.status).toBe(200);
  // The counter department sells eaten in; the way is switched before the kitchen has the order.
  if (dining === "takeaway") {
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, id)),
    );
  }
  if (issued) {
    await issueOrderInvoice(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      { ...venue.cfg, origin: { source: "device", deviceId: brandDeviceId(venue.deviceId) } },
      id,
      venue.operatorId,
    );
  }
  const place = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/place`);
  expect(place.status).toBe(200);
  return id;
}

/** The bill's own invoice: the sale its order filed. */
export async function invoiceOf(venue: BillVenue, billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return row!;
}

export function creditsOf(venue: BillVenue, saleId: string) {
  return inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.correctsSaleId, saleId)));
}

export async function fiscalRecordOf(venue: BillVenue, saleId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(verifactuRecords).where(eq(verifactuRecords.saleId, saleId)),
  );
  return row as typeof row & {
    desglose: {
      BaseImponibleOimporteNoSujeto: string;
      TipoImpositivo: string;
      CuotaRepercutida: string;
    }[];
    facturasRectificadas: { IDFacturaRectificada: Record<string, string>[] } | null;
  };
}

export async function linesOf(venue: BillVenue, saleId: string) {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({
        id: saleLines.id,
        parentLineId: saleLines.parentLineId,
        line: {
          lineNo: saleLines.lineNo,
          name: saleLines.name,
          descriptions: saleLines.descriptions,
          kitchenName: saleLines.kitchenName,
          quantity: saleLines.quantity,
          priceQuantity: saleLines.priceQuantity,
          unitPrice: saleLines.unitPrice,
          vatRate: saleLines.vatRate,
          lineTotal: saleLines.lineTotal,
          lineGross: saleLines.lineGross,
          productId: saleLines.productId,
        },
      })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId))
      .orderBy(saleLines.lineNo),
  );
  const lineNoOf = new Map(rows.map((row) => [row.id, row.line.lineNo]));
  return rows.map((row) => ({
    ...row.line,
    parentLineNo: row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
  }));
}

export async function activeCorrective(venue: BillVenue) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: invoiceSeries.id, next: nextInvoiceNumberOf(invoiceSeries.id) })
      .from(invoiceSeries)
      .where(
        and(
          eq(invoiceSeries.nodeId, venue.cfg.nodeId),
          eq(invoiceSeries.purpose, "corrective"),
          isNull(invoiceSeries.retiredAt),
        ),
      ),
  );
  return row;
}

export const negate = (amount: string) => negateDecimal(decimal(amount));
