import type { TillApi } from "../api/client.js";
import type { BillRevisions } from "../api/floor-api.js";
import type { BillEditExpected } from "../api/order-types.js";
import type { AllocationPreview, BillBalance } from "../api/payments-api.js";
import type { PayRefusal, PayRequest } from "../widgets/bill-pay-dialog.js";
import { refusalOf } from "./bill-payment.js";
import { itemsRefusal, previewPayment } from "./pay-for-items.js";

export interface TablePayQuoteRequest {
  context: string;
  asked: PayRequest;
  card: boolean;
  cash: boolean;
}

export interface TablePayQuote {
  request: TablePayQuoteRequest;
  preview: AllocationPreview | null;
  cash: AllocationPreview | null;
  refusal: PayRefusal | null;
  revisions: BillRevisions;
}

export function tablePayContext(
  { id, balance }: { id: number; balance: BillBalance | null },
  edit: BillEditExpected | null | undefined,
  revisions: BillRevisions,
  unsent: boolean,
): string {
  return JSON.stringify([
    id,
    balance?.status,
    balance?.outstanding,
    balance?.reserved,
    edit,
    revisions,
    unsent,
  ]);
}

export async function readTablePayQuote(
  api: TillApi,
  billId: string,
  request: TablePayQuoteRequest,
  edit: BillEditExpected | null | undefined,
  revisions: BillRevisions,
): Promise<TablePayQuote> {
  const read = async (asked: PayRequest) => {
    try {
      if (edit == null) throw { code: "draft.out_of_date" };
      return { preview: await previewPayment(api, billId, asked, edit), refusal: null };
    } catch (error) {
      const refusal = itemsRefusal(refusalOf(error));
      return { preview: null, refusal: refusal.code === "network" ? { code: "unread" } : refusal };
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
  return { request, ...checked, cash: cashPreview, refusal, revisions };
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
