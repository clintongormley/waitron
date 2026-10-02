import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { invoiceSeries, sales, tills } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordCorrection, recordSale, recordVoid } from "@waitron/core";
import { hashPin, loginWithPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import type { Logger } from "../logger.js";
import { mountOrdersApi } from "../orders-api.js";
import { SESSION_COOKIE } from "../till-session.js";
import { parkOrder, placeOrder } from "../working-order.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type Answer,
  type BillVenue,
} from "./bill-venue.js";
import { offerProducts } from "./zone-offers.js";

/** {@link provisionBillVenue} with a supervisor, the Orders routes, and an invoice-first counter. */
export interface OrderVenue extends BillVenue {
  printerId: string;
  invoiceFirstZone: string;
  supervisorId: string;
  /** The supervisor's till session on the first till's device. */
  supervisorTill: string;
  /** The supervisor's dashboard session: holds `report.view`. */
  supervisorDashboard: string;
  /** The staff operator Ana's dashboard session: holds no permission, so reads scope `unfinished`. */
  staffDashboard: string;
  /** The administrator's dashboard session: holds `print.resend`. */
  adminDashboard: string;
  orders: Hono;
}

const quiet: Logger = () => {};

export async function provisionOrderVenue(db: Database): Promise<OrderVenue> {
  const venue = await provisionBillVenue(db);
  const [assigned] = await db
    .select({ id: tills.receiptPrinterId })
    .from(tills)
    .where(eq(tills.id, venue.cfg.tillId));
  const invoiceFirstZone = (
    await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
    )
  ).zoneId;
  const made = await inTx(venue, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Sofía", pinHash: hashPin("7777"), role: "supervisor" })
      .returning({ id: persons.id });
    const till = await loginWithPin(tx, {
      tillId: venue.cfg.tillId,
      personId: person!.id,
      pin: "7777",
    });
    const dashboard = await startManagementSession(tx, { personId: person!.id });
    const staff = await startManagementSession(tx, { personId: venue.operatorId });
    const admin = await startManagementSession(tx, { personId: venue.adminId });
    return {
      supervisorId: person!.id,
      till: till.token,
      dashboard: dashboard.token,
      staff: staff.token,
      admin: admin.token,
    };
  });
  const device = venue.cookie.split("; ").slice(1);
  const orders = new Hono();
  mountOrdersApi(
    orders,
    { db, backend: venue.backend, cfg: { nodeId: venue.cfg.nodeId }, till: venue.cfg },
    quiet,
  );
  return {
    ...venue,
    printerId: assigned!.id!,
    invoiceFirstZone,
    supervisorId: made.supervisorId,
    supervisorTill: [`${SESSION_COOKIE}=${made.till}`, ...device].join("; "),
    supervisorDashboard: `${MANAGEMENT_COOKIE}=${made.dashboard}`,
    staffDashboard: `${MANAGEMENT_COOKIE}=${made.staff}`,
    adminDashboard: `${MANAGEMENT_COOKIE}=${made.admin}`,
    orders,
  };
}

/** A counter bill of the named dishes, sent under invoice-first, so it is invoiced and unpaid. */
export async function placedInvoiceFirst(venue: OrderVenue, ...names: string[]): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: venue.invoiceFirstZone,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  return id;
}

/** An open counter bill of the named dishes, never sent, its lines credited to Ana. */
export function parked(venue: OrderVenue, ...names: string[]): Promise<string> {
  return parkedBy(venue, venue.operatorId, ...names);
}

/** {@link parked}, its lines credited to `operatorId`. */
export async function parkedBy(
  venue: OrderVenue,
  operatorId: string,
  ...names: string[]
): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: names.map((name) => ({ menuItemId: venue.offerFor(name), quantity: "1" })),
    zoneId: venue.invoiceFirstZone,
    operatorId,
  });
  return id;
}

/** A party seated with the named dishes that then left without paying. */
export async function departed(venue: OrderVenue, ...names: string[]) {
  const party = await seatedWith(venue, ...names);
  const answer = await send(
    venue.app,
    venue.supervisorTill,
    "POST",
    `/api/parties/${party.partyId}/unpaid-departure`,
    {
      expectedPartyRevision: party.revision,
      reason: "Se marcharon sin pagar",
    },
  );
  if (answer.status !== 200) throw new Error(`departed: answered ${answer.status}`);
  return party;
}

export function collect(venue: OrderVenue, billId: string, amount: string): Promise<Answer> {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/collect`, {
    tender: { method: "cash", amount },
  });
}

async function invoiceOf(venue: OrderVenue, billId: string): Promise<string> {
  const [sale] = await inTx(venue, (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
  return sale!.id;
}

function adminSession(venue: OrderVenue, tx: Transaction) {
  return loginWithPin(tx, { tillId: venue.cfg.tillId, personId: venue.adminId, pin: "1234" });
}

/** A credit note of `base` at 21% totalling `total` against the bill's invoice, through `recordCorrection`. */
export async function credit(
  venue: OrderVenue,
  billId: string,
  base: string,
  total: string,
): Promise<void> {
  const saleId = await invoiceOf(venue, billId);
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "rectificative")),
      );
    const session = await adminSession(venue, tx);
    await recordCorrection(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(saleId),
      total,
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [venue.cfg.locale]: "Descuento" },
          quantity: "-1",
          unitPrice: base,
          vatRate: "21.00",
          lineTotal: `-${base}`,
        },
      ],
      clock: venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

/** Voids the bill's invoice through `recordVoid`, the only writer of `sale_voids`. */
export async function voidInvoice(venue: OrderVenue, billId: string): Promise<void> {
  const saleId = await invoiceOf(venue, billId);
  await inTx(venue, async (tx) => {
    const session = await adminSession(venue, tx);
    await recordVoid(tx, venue.backend, brandSaleId(saleId), "Error de cobro", {
      sessionId: session.id,
    });
  });
}

/** A cash contribution of `amount` taken on an open bill before its invoice, through the till's
 * bill-payment route (body as `contribute` in `apps/server/src/bill-payments-api.test.ts:377-387`). */
export async function contribute(venue: OrderVenue, billId: string, amount: string): Promise<void> {
  const answer = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
  );
  if (answer.status !== 200) throw new Error(`contribute: answered ${answer.status}`);
}

/** An invoice with no bill, written as the demo seed writes one (`recordSale`, no `workingOrderId`). */
export async function billlessSale(venue: OrderVenue): Promise<string> {
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: venue.cfg.seriesId,
      locale: venue.cfg.locale,
      invoiceLocales: venue.cfg.invoiceLocales,
      total: "12.10",
      lines: [
        {
          lineNo: 1,
          name: "Venta suelta",
          descriptions: { [venue.cfg.locale]: "Venta suelta" },
          quantity: "1",
          unitPrice: "10.00",
          vatRate: "21.00",
          lineTotal: "10.00",
        },
      ],
      clock: venue.clock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: new Date() }],
      },
      operatorId: venue.operatorId,
    }),
  );
  return saleId;
}
