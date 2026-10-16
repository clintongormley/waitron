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
  timeZone: string;
  zones: { id: string; name: string }[];
  billStaff: { id: string; name: string }[];
  transactionStaff: { id: string; name: string }[];
};

export interface BillRow {
  workingOrderId: string;
  openedAt: string;
  orderNumber: number;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];
  zoneId: string | null;
  zoneName: string | null;
  staff: { id: string; name: string | null }[];
  itemCount: number;
  total: string;
  paid: string;
  stillOwed: string;
  state: BillState;
  earlierDay: boolean;
  invoiceNumber: string | null;
  departedAt: string | null;
  orderStatus: "open" | "placed" | "settled" | "abandoned";
  collectionStatus: "waiting_for_payment" | "left_without_paying" | null;
}

export interface TransactionRow {
  transactionId: string;
  saleId: string;
  workingOrderId: string | null;
  scopeOrderIds: string[];
  issuedAt: string;
  invoiceNumber: string;
  type: TransactionType;
  tableName: string | null;
  customerName: string | null;
  methods: { method: TenderMethod; last4: string | null }[];
  staff: { id: string; name: string | null } | null;
  amount: string;
}
export type TransactionsPage = FindBillPage<TransactionRow> & { dates: DateWindow };
