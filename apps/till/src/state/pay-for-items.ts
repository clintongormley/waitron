import type {
  AllocationPreview,
  BillBalance,
  BillEditExpected,
  BillPaymentResult,
  BillRevisions,
  ReadOptions,
  TillApi,
} from "../api/client.js";
import type {
  ItemPaymentAsk,
  ItemPaymentPreview,
  ItemPaymentRequest,
  ItemPick,
} from "../api/item-payment-types.js";
import { fill, t } from "../i18n/t.js";
import type { PayLine, PayRefusal, PayRequest } from "../widgets/bill-pay-dialog.js";
import { moneyPlus, paymentAsk, type Confirmation, type PayChoice } from "./bill-payment.js";

/** What Pay for items sends beyond a bill payment's confirmation, fixed when the waiter confirms:
 * the server's retry fingerprint reads all of it, so a resend after no answer sends the same. */
export type ItemsPart = {
  picks: ItemPick[];
  expectedEdits: BillEditExpected[];
  expectedPartyRevision?: number;
  partyId?: string;
};

type ItemsChoice = Extract<PayChoice, { kind: "items" }>;

function wholeLine(line: PayLine, units: number): boolean {
  return line.unitTotal === null || units === Number(line.quantity);
}

/** The choice for `picks` (units by line number) of the `offered` lines: every line of the bill
 * picked whole is the whole bill, paid as today. */
export function itemsChoiceOf(
  lines: readonly PayLine[],
  picks: ReadonlyMap<number, number>,
  offered: readonly PayLine[],
): PayChoice {
  const everyLine = lines.every((line) => {
    const units = picks.get(line.lineNo);
    return units !== undefined && wholeLine(line, units);
  });
  if (lines.length > 0 && everyLine) return { kind: "whole" };
  return {
    kind: "items",
    picks: offered.flatMap((line) => {
      const units = picks.get(line.lineNo);
      if (units === undefined) return [];
      const pick = { lineNo: line.lineNo, lineId: line.lineId };
      return [wholeLine(line, units) ? pick : { ...pick, units }];
    }),
  };
}

function itemsOf(asked: PayRequest): ItemsChoice {
  if (asked.choice.kind !== "items") throw new Error("Pay for items needs an items choice");
  return asked.choice;
}

function picksOf(choice: ItemsChoice): ItemPick[] {
  return choice.picks.map((pick) =>
    pick.units === undefined
      ? { lineId: pick.lineId }
      : { lineId: pick.lineId, quantity: String(pick.units) },
  );
}

export function itemsAsk(asked: PayRequest): ItemPaymentAsk {
  const ask: ItemPaymentAsk = { picks: picksOf(itemsOf(asked)), method: asked.pay.method };
  if (asked.pay.method === "cash") ask.tendered = asked.pay.tendered;
  if (asked.pay.addedTip !== undefined) ask.addedTip = asked.pay.addedTip;
  return ask;
}

/** The items preview as the dialog shows a bill payment's. */
export function itemsAllocated(
  preview: ItemPaymentPreview,
  method: "cash" | "card",
): AllocationPreview {
  return {
    kind: "allocated",
    choice: null,
    applied: preview.applied,
    tip: preview.tip,
    change: preview.change,
    charged: method === "card" ? moneyPlus(preview.applied, preview.tip) : null,
    total: preview.total,
  };
}

/** Whether `preview` is Pay for items': only it carries the chosen items' price, as they are paid
 * on a bill of their own. */
export function paysOnNewBill(
  preview: AllocationPreview | null,
): preview is Extract<AllocationPreview, { kind: "allocated" }> & { total: string } {
  return preview?.kind === "allocated" && preview.total !== undefined;
}

/** A `bill.allocation_changed` refusal's fresh preview: a whole payment of the would-be new bill,
 * which holds nothing else, so what it applies is the items' total. */
export function itemsAllocatedFrom(preview: AllocationPreview): AllocationPreview {
  return preview.kind === "allocated" ? { ...preview, total: preview.applied } : preview;
}

/** The Pay window's words for a set-menu dish chosen without its set menu. */
export function itemsRefusal(refusal: PayRefusal): PayRefusal {
  if (refusal.code !== "set_menu.moves_with_set_menu" || refusal.dishName === undefined)
    return refusal;
  return {
    ...refusal,
    text: fill(t("bill_pay.items_set_menu_dish"), { dishName: refusal.dishName }),
  };
}

/** `confirmation` with its items part, for an items choice paid on a bill of its own. */
export function withItems(
  confirmation: Confirmation,
  asked: PayRequest,
  expectedEdit: BillEditExpected | null,
  revisions: BillRevisions,
): Confirmation {
  if (asked.choice.kind !== "items") return confirmation;
  // The route refuses an items payment with no edit state, and a resend would repeat it.
  if (expectedEdit === null) throw new Error("Pay for items needs the bill's edit state");
  return {
    ...confirmation,
    items: {
      picks: picksOf(asked.choice),
      expectedEdits: [expectedEdit],
      ...(revisions.expectedPartyRevision === undefined
        ? {}
        : { expectedPartyRevision: revisions.expectedPartyRevision }),
      ...(revisions.partyId === undefined ? {} : { partyId: revisions.partyId }),
    },
  };
}

/** The items route's body: the route reads no guest count, own receipt or receipt language, and a
 * hand-keyed card's details only for a hand-keyed card. */
export function itemsRequestOf(
  request: Confirmation & { submissionId: string; items: ItemsPart },
): ItemPaymentRequest {
  const { items } = request;
  const body: ItemPaymentRequest = {
    submissionId: request.submissionId,
    picks: items.picks,
    expectedEdits: items.expectedEdits,
    ...(items.expectedPartyRevision === undefined
      ? {}
      : { expectedPartyRevision: items.expectedPartyRevision }),
    ...(items.partyId === undefined ? {} : { partyId: items.partyId }),
    method: request.method,
    applied: request.applied,
    tip: request.tip,
  };
  if (request.tendered !== undefined) body.tendered = request.tendered;
  if (request.addedTip !== undefined) body.addedTip = request.addedTip;
  if (request.method !== "card") return body;
  if (request.entry === "reader") {
    body.entry = "reader";
    if (request.readerId !== undefined) body.readerId = request.readerId;
    if (request.simulationOutcome !== undefined) body.simulationOutcome = request.simulationOutcome;
    return body;
  }
  if (request.externalRef !== undefined) body.externalRef = request.externalRef;
  if (request.externalProvider !== undefined) body.externalProvider = request.externalProvider;
  if (request.externalMachine !== undefined) body.externalMachine = request.externalMachine;
  return body;
}

/** The preview for `asked`: an items choice through Pay for items, every other through today's bill
 * payment preview. */
export async function previewPayment(
  api: TillApi,
  billId: string,
  asked: PayRequest,
  expectedEdit: BillEditExpected | null,
): Promise<AllocationPreview> {
  if (asked.choice.kind === "items")
    return itemsAllocated(await api.previewItemPayment(billId, itemsAsk(asked)), asked.pay.method);
  return api.previewBillPayment(
    billId,
    paymentAsk(asked.choice, asked.pay, asked.allocation, expectedEdit),
  );
}

/** Takes the payment: with an items part through Pay for items, answering the new bill as
 * `paidOn` and the bill the items came from as `sourceBalance`; otherwise through today's bill
 * payment. */
export async function takePayment(
  api: TillApi,
  billId: string,
  request: Confirmation & { submissionId: string },
  options: ReadOptions,
): Promise<BillPaymentResult & { paidOn?: string; sourceBalance?: BillBalance }> {
  const { items } = request;
  if (items === undefined) return api.takeBillPayment(billId, request, options);
  const paid = await api.payForItems(billId, itemsRequestOf({ ...request, items }), options);
  return { ...paid.payment, paidOn: paid.billId, sourceBalance: paid.sourceBalance };
}
