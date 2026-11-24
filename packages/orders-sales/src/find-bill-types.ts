export type FindBillDates =
  | { preset: "today" | "yesterday" | "business-day" | "last-7-days" | "this-month" }
  | { preset: "custom"; from: string; to: string }
  | { preset: "any" };
export type FindBillSort = { key: string; direction: "ascending" | "descending" };
export type FindBillQuery = { q: string; page: number; sort: FindBillSort; staffId?: string };
export type BillState = "unpaid" | "held" | "part-paid" | "paid-not-handed-over";
export type TransactionType = "sale" | "full-invoice" | "correction" | "replacement" | "refund";
export type TenderMethod = "cash" | "card" | "voucher" | "deferred" | "other";
export type BillsQuery = FindBillQuery & { zoneId?: string; state?: BillState };
export type TransactionsQuery = FindBillQuery & {
  dates: FindBillDates;
  method?: TenderMethod;
  type?: TransactionType;
};
export type DateWindow = { startAt: string; endAt: string; from: string; to: string } | null;
