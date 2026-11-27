import type { TillApi } from "../api/client.js";
import type { BillRevisions } from "../api/floor-api.js";
import type { BillEditExpected } from "../api/order-types.js";
import type { AllocationPreview, BillBalance } from "../api/payments-api.js";
import type * as PayDialog from "../widgets/bill-pay-dialog.js";
import { refusalOf } from "./bill-payment.js";
import { counterItemsEditFor, itemsRefusal, previewEdit, previewPayment } from "./pay-for-items.js";
import type { BillNotice } from "./reopened-bill.js";

/** The order a bill payment dialog pays: the table's bill on screen, whose `visit` is the order
 * visit, or the counter's stored order in the basket, whose `visit` is the operator session. */
export interface PayingOrder {
  surface: "table" | "counter";
  billId: string;
  visit: number;
  /** The bill's receipt was issued before the window opened, so the payment settling it issues none. */
  printed?: boolean;
  counterPayPanel?: boolean;
  /** A bill Find bill pays without loading it into a screen: the edit state its row was read with,
   * sent in place of the basket's; undefined when the row carried none. */
  found?: { expectedEdit: BillEditExpected | null | undefined };
}

export interface BillPaying extends PayingOrder {
  id: number;
  way: PayDialog.PayWay;
  amount: string;
  lines: PayDialog.PayLine[];
  balance: BillBalance | null;
  asked: PayDialog.PayRequest | null;
  preview: AllocationPreview | null;
  quote?: TablePayQuote;
  expectedEdit: BillEditExpected | null;
  refusal: PayDialog.PayRefusal | null;
  taken: PayDialog.PayTaken | null;
  refunded: PayDialog.RefundNotice | null;
  /** The printed bill this window paid from was credited and reopened as the bill it is now on. */
  credited?: BillNotice;
  busy: boolean;
}

export interface TablePayQuoteRequest {
  context: string;
  asked: PayDialog.PayRequest;
  card: boolean;
  cash: boolean;
}

export interface TablePayQuote {
  request: TablePayQuoteRequest;
  preview: AllocationPreview | null;
  cash: AllocationPreview | null;
  refusal: PayDialog.PayRefusal | null;
  revisions: BillRevisions;
}

export function tablePayContext(
  { id, balance }: { id: number; balance: BillBalance | null },
  edit: BillEditExpected | null | undefined,
  revisions: BillRevisions,
  unsent: boolean,
  counterVisit?: readonly [session: number, visit: number, revision: number],
): string {
  return JSON.stringify([
    id,
    balance?.status,
    balance?.outstanding,
    balance?.reserved,
    edit,
    revisions,
    unsent,
    counterVisit,
  ]);
}

export async function readTablePayQuote(
  api: TillApi,
  billId: string,
  request: TablePayQuoteRequest,
  edit: BillEditExpected | null | undefined,
  revisions: BillRevisions,
  surface: PayingOrder["surface"],
  current: () => boolean = () => true,
): Promise<TablePayQuote> {
  const editForQuote = async () => {
    const { expectedEdit, readCounterEdit } = previewEdit(edit, { surface }, request.asked.choice);
    return readCounterEdit
      ? counterItemsEditFor(api, { billId, preview: null, expectedEdit })
      : expectedEdit;
  };
  let checkedEdit: Promise<BillEditExpected | null> | undefined;
  const read = async (asked: PayDialog.PayRequest) => {
    try {
      checkedEdit ??= editForQuote();
      const paidEdit = await checkedEdit;
      return {
        preview: current() ? await previewPayment(api, billId, asked, paidEdit) : null,
        refusal: null,
      };
    } catch (error) {
      const refusal = itemsRefusal(refusalOf(error));
      const unread = refusal.code === "network" || refusal.code === "server.internal";
      return { preview: null, refusal: unread ? { code: "unread" } : refusal };
    }
  };
  const { asked, card, cash } = request;
  const checked = card ? await read(asked) : { preview: null, refusal: null };
  let cashPreview = cash ? checked.preview : null;
  let refusal = checked.refusal;
  if (cash && (!card || refusal?.code === "bill.tip_not_allowed")) {
    const choice = asked.choice;
    const answer = await read({
      choice,
      pay:
        choice.kind === "contribution"
          ? { method: "cash", tendered: choice.amount }
          : { method: "card" },
    });
    cashPreview = answer.preview;
    refusal ??= answer.refusal;
  }
  return {
    request,
    ...checked,
    cash: cashPreview,
    refusal,
    revisions: surface === "table" ? revisions : {},
  };
}

export function sameCardAllocation(a: AllocationPreview | null, b: AllocationPreview): boolean {
  return a?.applied === b.applied && a.tip === b.tip && a.charged === b.charged;
}

export function replaceCardAllocation(
  quote: TablePayQuote,
  preview: AllocationPreview,
): TablePayQuote {
  return { ...quote, preview, cash: quote.cash === null ? null : preview };
}
