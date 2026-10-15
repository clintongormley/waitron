export type FindBillDates =
  | { preset: "today" | "yesterday" | "business-day" | "last-7-days" | "this-month" }
  | { preset: "custom"; from: string; to: string }
  | { preset: "any" };
export type FindBillSort = { key: string; direction: "ascending" | "descending" };
export type FindBillQuery = { q: string; page: number; sort: FindBillSort; staffId?: string };
export type BillState = "unpaid" | "held" | "part-paid" | "paid-not-handed-over";
export type TransactionType = "sale" | "full-invoice" | "correction";
export type TenderMethod = "cash" | "card" | "voucher" | "transfer" | "other";
export type BillsQuery = FindBillQuery & { zoneId?: string; state?: BillState };
export type TransactionsQuery = FindBillQuery & {
  dates: FindBillDates;
  method?: TenderMethod;
  type?: TransactionType;
};
export type FindBillPage<Row> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: 50;
  openCount: number;
};
export type DateWindow = { startAt: string; endAt: string; from: string; to: string } | null;
export type FindBillOptions = {
  zones: { id: string; name: string }[];
  billStaff: { id: string; name: string }[];
  transactionStaff: { id: string; name: string }[];
};
