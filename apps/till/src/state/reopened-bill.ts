import type { BillBalance, BillEditExpected, PartyBill } from "../api/client.js";
import { fill, t } from "../i18n/t.js";
import { billLabel } from "./bill-state.js";

/** The table's bill a Pay for items answer carries, when it is not the bill the Pay window paid
 * from: on a printed bill the server reopens it, and the answer names the reopened bill. */
export function reopenedBill(
  paidFrom: string,
  sourceBalance: BillBalance | undefined,
): BillBalance | undefined {
  return sourceBalance === undefined || sourceBalance.workingOrderId === paidFrom
    ? undefined
    : sourceBalance;
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
 * Pay for items credited a printed bill's receipt (`corrective`, null when the read named none). */
export type BillNotice =
  | { kind: "gone"; gone: BillRef | null; shown: BillRef }
  | { kind: "credited"; corrective: string | null; shown: BillRef };

const refOf = ({ billNumber, billName }: BillRef): BillRef => ({ billNumber, billName });

export function goneNotice(gone: BillRef | undefined, shown: BillRef): BillNotice {
  return { kind: "gone", gone: gone === undefined ? null : refOf(gone), shown: refOf(shown) };
}

/** The notice on `to`, the bill Pay for items reopened printed bill `from` as, naming the
 * corrective the bills read lists on `from`; null while `to` is not listed. */
export function creditedNotice(
  bills: readonly PartyBill[],
  reopen: { from: string; to: string },
): BillNotice | null {
  const shown = bills.find((bill) => bill.workingOrderId === reopen.to);
  if (shown === undefined) return null;
  const corrective = bills.find((bill) => bill.workingOrderId === reopen.from)?.correctives?.at(-1);
  return { kind: "credited", corrective: corrective ?? null, shown: refOf(shown) };
}

/** `notice` worded in the language shown now. */
export function billNoticeText(notice: BillNotice | null | undefined): string | null {
  if (notice === null || notice === undefined) return null;
  const shown = billLabel(notice.shown);
  if (notice.kind === "gone")
    return notice.gone === null
      ? fill(t("table.bill_gone_unnumbered"), { shown })
      : fill(t("table.bill_gone"), { gone: billLabel(notice.gone), shown });
  return notice.corrective === null
    ? fill(t("table.bill_credited_unnumbered"), { shown })
    : fill(t("table.bill_credited"), { number: notice.corrective, shown });
}
