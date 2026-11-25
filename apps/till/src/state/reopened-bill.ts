import type { BillBalance, BillEditExpected, BillPaymentResult, PartyBill } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { billLabel } from "./bill-state.js";

/** Where a Pay for items answer leaves the table, when not on the bill the Pay window paid from:
 * the reopened bill, which the answer names as the table's bill when the server reopened a printed
 * bill, unless the dishes were {@link keptOnOwnBill} (`kept`). */
export function billAfterItems(
  paidFrom: string,
  result: Pick<BillPaymentResult, "balance"> & { paidOn?: string; sourceBalance?: BillBalance },
  notCharged: boolean,
): { balance: BillBalance; kept: boolean } | undefined {
  const reopened = result.sourceBalance;
  if (reopened === undefined || reopened.workingOrderId === paidFrom) return undefined;
  const own = result.balance;
  const kept = keptOnOwnBill(own, result.paidOn, notCharged);
  return kept ? { balance: own, kept } : { balance: reopened, kept };
}

/** Whether a card that charged nothing left the chosen dishes on `own`, the bill Pay for items made
 * for them (`paidOn`), still open there because the server could not put them back. */
export function keptOnOwnBill(
  own: BillBalance,
  paidOn: string | undefined,
  notCharged: boolean,
): boolean {
  return notCharged && own.workingOrderId === paidOn && own.status === "open";
}

/** The Pay window `open` moved to the bill `balance` names. That bill has no receipt, and the edit
 * state of the bill it came from would be refused there, so the next preview reads its own. */
export function movedToBill<
  T extends {
    billId: string;
    printed?: boolean;
    balance: BillBalance | null;
    expectedEdit: BillEditExpected | null;
  },
>(open: T, balance: BillBalance): T {
  return { ...open, billId: balance.workingOrderId, printed: false, balance, expectedEdit: null };
}

type BillRef = Pick<PartyBill, "billNumber" | "billName">;

/** A notice above the table's bill, kept as facts and worded only when drawn, so it follows a
 * change of language: the bill on screen left the table (`gone`, null when it had no number), or
 * Pay for items credited a printed bill's receipt (`corrective`, null when the read named none),
 * the bill shown holding the chosen dishes when `kept`. */
export type BillNotice =
  | { kind: "gone"; gone: BillRef | null; shown: BillRef }
  | { kind: "credited"; corrective: string | null; shown: BillRef; kept?: true };

const refOf = ({ billNumber, billName }: BillRef): BillRef => ({ billNumber, billName });

export function goneNotice(gone: BillRef | undefined, shown: BillRef): BillNotice {
  return { kind: "gone", gone: gone === undefined ? null : refOf(gone), shown: refOf(shown) };
}

/** The notice on `to`, the bill Pay for items left the table on after crediting printed bill
 * `from` ({@link billAfterItems}), naming the corrective the bills read lists on `from`; null while
 * `to` is not listed. */
export function creditedNotice(
  bills: readonly PartyBill[],
  reopen: { from: string; to: string; kept?: boolean },
): BillNotice | null {
  const shown = bills.find((bill) => bill.workingOrderId === reopen.to);
  if (shown === undefined) return null;
  return {
    kind: "credited",
    corrective: latestCorrectiveOf(bills, reopen.from),
    shown: refOf(shown),
    ...(reopen.kept === true ? { kept: true as const } : {}),
  };
}

/** The latest corrective a read of the party's bills shows on bill `billId`. */
export function latestCorrectiveOf(
  bills: readonly PartyBill[] | null,
  billId: string,
): string | null {
  return bills?.find((row) => row.workingOrderId === billId)?.correctives?.at(-1) ?? null;
}

/** `notice` worded in the language shown now. */
export function billNoticeText(notice: BillNotice | null | undefined): string | null {
  if (notice === null || notice === undefined) return null;
  const shown = billLabel(notice.shown);
  if (notice.kind === "gone")
    return notice.gone === null
      ? fill(t("table.bill_gone_unnumbered"), { shown })
      : fill(t("table.bill_gone"), { gone: billLabel(notice.gone), shown });
  if (notice.kept === true)
    return notice.corrective === null
      ? fill(t("table.bill_credited_kept_unnumbered"), { shown })
      : fill(t("table.bill_credited_kept"), { number: notice.corrective, shown });
  return notice.corrective === null
    ? fill(t("table.bill_credited_unnumbered"), { shown })
    : fill(t("table.bill_credited"), { number: notice.corrective, shown });
}
