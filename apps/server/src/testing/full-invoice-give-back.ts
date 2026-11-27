import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { adjustments, parties, sales, workingOrders, type Transaction } from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { readBillEditState } from "../bill-editing.js";
import { DEVICE_COOKIE } from "../device-session.js";
import type { GiveBackPlan, GiveBackRequest } from "../give-back-plan.js";
import { cancelItem } from "../line-cancel.js";
import { readCancellationContext } from "../line-cancel-context.js";
import { SESSION_COOKIE } from "../till-session.js";
import { inTx, send, tabWith, type BillVenue } from "./bill-venue.js";
import { testTradingAdmission } from "./trading-admission.js";

/** The customer every full invoice here names. */
export const CUSTOMER_TAX_ID = "B12345674";

/** The administrator signed in on the venue's first till, holding every right; its cookie. */
export async function adminTillCookie(tx: Transaction, venue: BillVenue): Promise<string> {
  const session = await loginWithPin(tx, {
    deviceId: venue.deviceId,
    personId: venue.adminId,
    pin: "1234",
  });
  const proof = venue.cookie.split("; ").find((part) => part.startsWith(`${DEVICE_COOKIE}=`));
  return `${SESSION_COOKIE}=${session.token}; ${proof}`;
}

/** Sets the unpaid bill's invoice to a full invoice naming Harbour Foods. */
export async function chooseFullInvoice(venue: BillVenue, billId: string): Promise<void> {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const chosen = await send(
    venue.app,
    venue.cookie,
    "PUT",
    `/api/working-orders/${billId}/invoice-choice`,
    {
      revision: order!.revision,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      invoiceType: "F1",
      recipient: {
        taxId: CUSTOMER_TAX_ID,
        legalName: "Harbour Foods",
        address: "2 Main Street, 28013 Madrid, Madrid",
        countryCode: "ES",
      },
    },
  );
  expect(chosen.status, JSON.stringify(chosen.json)).toBe(200);
}

export type Part = { cash: string } | { card: string } | { reader: string };

/** Pays `part` on the bill: cash, a hand-keyed card or the till's reader. */
export async function payPart(
  venue: BillVenue,
  billId: string,
  part: Part,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const amount = "cash" in part ? part.cash : "card" in part ? part.card : part.reader;
  const paid = await send(
    venue.app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      ...("cash" in part
        ? { method: "cash", tendered: amount }
        : { method: "card", entry: "card" in part ? "manual" : "reader" }),
      applied: amount,
      tip: "0.00",
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, billId)),
      ...extra,
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
}

export async function saleOf(venue: BillVenue, billId: string): Promise<string> {
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, billId));
  return sale!.id;
}

/** A full invoice naming Harbour Foods for a Steak (€25.00) and a House salad (€12.00), paid in
 * `parts`; its sale and the bill. */
export async function fullInvoice(venue: BillVenue, ...parts: Part[]) {
  const billId = await tabWith(venue, "Steak", "House salad");
  await chooseFullInvoice(venue, billId);
  for (const part of parts) await payPart(venue, billId, part);
  return { billId, saleId: await saleOf(venue, billId) };
}

/** The sale's first payment by `method`. */
export function tenderOf(venue: BillVenue, saleId: string, method: "cash" | "card"): string {
  return venue.db.all<{ id: string }>(
    sql`select id from tenders where sale_id = ${saleId} and method = ${method}`,
  )[0]!.id;
}

export const ask = (
  purpose: GiveBackRequest["purpose"],
  amount: string,
  more: Partial<GiveBackRequest> = {},
): GiveBackRequest => ({ purpose, amount, extra: "0.00", way: "cash", ...more });

/** Previews `request` on the till as `cookie`, and the press body carrying what it planned. */
export async function giveBackBody(
  venue: BillVenue,
  cookie: string,
  saleId: string,
  request: GiveBackRequest,
  reasonId: string,
  app = venue.app,
) {
  const previewed = await send(
    app,
    cookie,
    "POST",
    `/api/transactions/${saleId}/give-back/preview`,
    request,
  );
  expect(previewed.status, JSON.stringify(previewed.json)).toBe(200);
  return {
    ...request,
    reasonId,
    note: "Cold",
    submissionIds: {
      refund: randomUUID(),
      extra: randomUUID(),
      correction: randomUUID(),
      leg: randomUUID(),
    },
    expected: (previewed.json as unknown as GiveBackPlan).parts,
  };
}

/** A corrective full invoice by differences naming Harbour Foods, as `correctiveRecordsOf` reads
 * it, of `total` cents. */
export const r1 = (total: number) => ({
  type: "R1",
  by: "differences",
  purpose: "full_corrective",
  customer: CUSTOMER_TAX_ID,
  total,
});

/** The administrator's still-charge cancel, with Refund ticked, of the bill's line `lineNo`, for
 * `reasonId`; its id. */
export async function cancelLine(
  venue: BillVenue,
  billId: string,
  lineNo: number,
  reasonId: string,
): Promise<string> {
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  const [line] = venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${billId} and line_no = ${lineNo}`,
  );
  await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, order!.partyId!));
    return cancelItem(
      tx,
      venue.cfg,
      order!.partyId!,
      line!.id,
      {
        quantity: "1",
        expectedEdit: await readBillEditState(tx, billId),
        outcome: "keep_charge",
        reasonId,
        expectedPartyRevision: party!.revision,
        expectedBillRevision: order!.revision,
        expectedContext: await readCancellationContext(tx, order!.partyId!, line!.id),
        submissionId: randomUUID(),
        refundHandoff: true,
        admission: testTradingAdmission(),
      },
      venue.adminId,
    );
  });
  const rows = await venue.db.select().from(adjustments).where(eq(adjustments.lineId, line!.id));
  return rows.find((row) => row.action === "cancel")!.id;
}
