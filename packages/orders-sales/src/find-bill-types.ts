export type FindBillDates =
  | { preset: "today" | "yesterday" | "business-day" | "last-7-days" | "this-month" }
  | { preset: "custom"; from: string; to: string }
  | { preset: "any" };
export type FindBillSort = { key: string; direction: "ascending" | "descending" };
export type FindBillQuery = { q: string; page: number; staffId?: string };
export type BillState = "unpaid" | "held" | "part-paid" | "paid-not-handed-over";
export type TransactionType =
  "sale" | "full-invoice" | "correction" | "full-correction" | "replacement" | "refund";
export type TenderMethod = "cash" | "card" | "voucher" | "deferred" | "other";
/** `owed` and `counter` together ask for the bills either one names. */
export type BillsQuery = FindBillQuery & {
  sort: FindBillSort;
  owed?: true;
  counter?: true;
};
/** `corrective` asks for every `correction`, `full-correction` and `replacement`. */
export type TransactionKind = TransactionType | "corrective";
export type TransactionsQuery = FindBillQuery & {
  dates: FindBillDates;
  type?: TransactionKind;
};
export type DateWindow = { startAt: string; endAt: string; from: string; to: string } | null;
