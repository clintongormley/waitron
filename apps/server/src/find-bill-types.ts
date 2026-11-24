import type {
  BillState,
  DateWindow,
  TenderMethod,
  TransactionType,
} from "@waitron/orders-sales/find-bill-types.js";

export type {
  BillsQuery,
  BillState,
  DateWindow,
  FindBillDates,
  FindBillQuery,
  FindBillSort,
  TenderMethod,
  TransactionsQuery,
  TransactionType,
} from "@waitron/orders-sales/find-bill-types.js";

export type FindBillPage<Row> = {
  rows: Row[];
  total: number;
  page: number;
  pageSize: 50;
  openCount: number;
};
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
  refundId: string | null;
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
