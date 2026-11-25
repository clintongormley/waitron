import type { RecipientIdentifierType, RecipientIdentifier } from "@waitron/country-packs";
import type { DashboardRequest, DownloadedFile } from "@waitron/dashboard-kit";
import type { AllergenDeclaration as AllergenEntry } from "@waitron/shared";
import { ReportingApi } from "./reporting-api.js";

export interface InvoiceCustomerSearchDto {
  taxId: string;
  identifierType?: RecipientIdentifierType;
  identifierCountryCode?: string;
  invoices: { invoice: string; issuedAt: string; name: string; total: string }[];
}
/** `null` = not yet reviewed, which is not the same as allergen-free; `{}` = reviewed, none
 * present. */
export type AllergenDeclaration = Record<string, AllergenEntry> | null;

export const ORDER_STATUS_FILTERS = [
  "all",
  "open",
  "waiting_for_payment",
  "left_without_paying",
  "unpaid",
  "paid",
  "deferred_payment",
  "cancelled",
  "voided",
] as const;

export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

export type OrderStatus = Exclude<OrderStatusFilter, "all" | "unpaid">;

export interface OrdersQuery {
  status: OrderStatusFilter;
  from?: string;
  to?: string;
  anyDate: boolean;
  credited: boolean;
  staff?: string;
  table?: string;
  q?: string;
}

export interface OrdersPageQuery extends OrdersQuery {
  page: number;
  sortKey: "" | "opened" | "invoice" | "total";
  sortDirection: "ascending" | "descending";
}

export interface OrderRowDto {
  kind: "bill" | "sale";
  id: string;
  at: string;
  orderNumber: number | null;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];
  counter: boolean;
  saleId: string | null;
  invoiceNumber: string | null;
  invoiceType: "F1" | "F2" | null;
  correctives: string[];
  status: OrderStatus;
  credited: "in_full" | "in_part" | null;
  total: string;
  stillOwed: string | null;
  staff: { id: string; name: string | null }[];
  departedAt: string | null;
}

export interface OrdersPageDto {
  rows: OrderRowDto[];
  total: number;
  page: number;
  pageSize: number;
  from: string | null;
  to: string | null;
}

export interface OrderDetailDto {
  row: OrderRowDto;
  lines: {
    lineNo: number;
    name: string;
    variantName: string | null;
    quantity: string;
    total: string;
    listUnitPrice: string | null;
    creditedTo: string | null;
    sent: boolean;
    sentNutrition: { allergens: AllergenDeclaration; dietaryDeclarations: string[] } | null;
  }[];
  invoices: {
    kind: "invoice" | "corrective" | "replacement" | "substitution";
    invoiceType?: "F1" | "F2";
    recipient?: {
      taxId: string;
      legalName: string;
      countryCode: string;
      address: string;
      identifierType?: RecipientIdentifierType;
      identifierCountryCode?: string;
    };
    taxpayerDomicile?: string;
    number: string;
    issuedAt: string;
    total: string;
    rungBy: string | null;
  }[];
  tenders: { method: string; amount: string; tip: string }[];
  payments: {
    method: string;
    state: string;
    applied: string;
    tip: string;
    createdAt: string;
    refunds: { applied: string; tip: string; state: string; reason: string; createdAt: string }[];
  }[];
  party: {
    name: string | null;
    guestCount: number | null;
    openedAt: string;
    closedAt: string | null;
    openedBy: string | null;
    closedBy: string | null;
    tables: string[];
  } | null;
  departure: {
    recordedAt: string;
    reason: string;
    recordedBy: string | null;
    authorizedBy: string | null;
    amount: string;
  } | null;
  reprints: {
    requestedAt: string;
    personId: string;
    personName: string | null;
    printerName: string;
  }[];
  /** Null unless the bill's invoice is a full invoice. */
  deliveries: OrderDeliveries | null;
  invoicePdfDownloads: { requestedAt: string; personId: string; personName: string | null }[];
}
/** One attempt to deliver a full invoice (`readInvoiceDeliveries`, `apps/server/src/invoice-delivery-status.ts`). */
export interface OrderDeliveryAttempt {
  /** Null for a receipt original that no delivery row tracks. */
  id: string | null;
  medium: "email" | "a4" | "receipt";
  designation: "original" | "duplicate";
  status: "queued" | "sending" | "sent" | "failed" | "unknown";
  failureCode: string | null;
  requestedAt: string;
  at: string | null;
  personId: string | null;
  personName: string | null;
  /** What the office printer holds an A4 for; the server may send a code `holdReason` has no words for. */
  printerHold: string | null;
  invoiceRecipientEmail?: string;
  lateSuccess: boolean;
}
/** A printer the Orders screen may print a full invoice on. */
export interface OfferedPrinter {
  id: string;
  name: string;
  kind: "a4" | "receipt";
}

export interface OrderDeliveries {
  current: OrderDeliveryAttempt | null;
  originalCompleted: boolean;
  /** The printer the original went to; null when it went by email or there is none. */
  originalPrinterId: string | null;
  actions: {
    retryOriginal: { medium: OrderDeliveryAttempt["medium"] } | null;
    /** Every active printer: receipt printers first, then A4 printers. */
    print: {
      printers: OfferedPrinter[];
      designation: OrderDeliveryAttempt["designation"];
    } | null;
    receiptInstead: { deliveryId: string } | null;
    /** Offered while nothing is on its way and the server can send invoice email now. */
    email: { designation: OrderDeliveryAttempt["designation"] } | null;
  };
  /** Newest first, the current attempt included. */
  history: OrderDeliveryAttempt[];
}

export class OrdersApi extends ReportingApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  findInvoiceCustomer(
    taxId: string,
    identity?: Pick<RecipientIdentifier, "identifierType" | "identifierCountryCode">,
  ): Promise<InvoiceCustomerSearchDto> {
    return this.#request<InvoiceCustomerSearchDto>(
      `/management-api/invoice-customers/personal-data?taxId=${encodeURIComponent(taxId)}${identity === undefined ? "" : `&identifierType=${encodeURIComponent(identity.identifierType ?? "")}&identifierCountryCode=${encodeURIComponent(identity.identifierCountryCode ?? "")}`}`,
      "GET",
    );
  }
  downloadInvoiceCustomerData(
    taxId: string,
    identity?: Pick<RecipientIdentifier, "identifierType" | "identifierCountryCode">,
  ): Promise<DownloadedFile> {
    return this.#request<DownloadedFile>(
      `/management-api/invoice-customers/personal-data/export?taxId=${encodeURIComponent(taxId)}${identity === undefined ? "" : `&identifierType=${encodeURIComponent(identity.identifierType ?? "")}&identifierCountryCode=${encodeURIComponent(identity.identifierCountryCode ?? "")}`}`,
      "GET",
      undefined,
      { as: "file" },
    );
  }
  listOrdersPage(query: OrdersPageQuery): Promise<OrdersPageDto> {
    const params = new URLSearchParams();
    if (query.status !== "all") params.set("status", query.status);
    if (query.anyDate) params.set("anyDate", "true");
    else if (query.from !== undefined && query.to !== undefined) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    if (query.credited) params.set("credited", "true");
    if (query.staff !== undefined) params.set("staff", query.staff);
    if (query.table !== undefined) params.set("table", query.table);
    if (query.q !== undefined) params.set("q", query.q);
    params.set("page", String(query.page));
    params.set("sortKey", query.sortKey);
    params.set("sortDirection", query.sortDirection);
    return this.#request<OrdersPageDto>(`/management-api/orders?${params}`, "GET");
  }
  listOrderStaff(): Promise<{ staff: { id: string; name: string | null }[] }> {
    return this.#request("/management-api/orders/staff", "GET");
  }
  getOrder(id: string): Promise<OrderDetailDto> {
    return this.#request(`/management-api/orders/${encodeURIComponent(id)}`, "GET");
  }
  getOrderPrinters(): Promise<{ id: string; name: string }[]> {
    return this.#request("/management-api/orders/printers", "GET");
  }
  reprintOrder(id: string, printerId: string): Promise<{ jobId: string }> {
    return this.#request(`/management-api/orders/${encodeURIComponent(id)}/reprint`, "POST", {
      printerId,
    });
  }
  requestOrderPrintDelivery(
    id: string,
    printerId: string,
    requestKey: string,
  ): Promise<OrderDeliveryAttempt> {
    return this.#request(
      `/management-api/orders/${encodeURIComponent(id)}/invoice-deliveries`,
      "POST",
      { medium: "print", printerId, requestKey },
    );
  }
  requestOrderEmailDelivery(
    id: string,
    recipient: string,
    requestKey: string,
  ): Promise<OrderDeliveryAttempt> {
    return this.#request(
      `/management-api/orders/${encodeURIComponent(id)}/invoice-deliveries`,
      "POST",
      { medium: "email", recipient, requestKey },
    );
  }
  /** Emails the invoice again to the address recorded on the ended attempt. */
  retryOrderEmailDelivery(
    id: string,
    deliveryId: string,
    requestKey: string,
  ): Promise<OrderDeliveryAttempt> {
    return this.#request(
      `/management-api/orders/${encodeURIComponent(id)}/invoice-deliveries/${encodeURIComponent(deliveryId)}/retry`,
      "POST",
      { requestKey },
    );
  }
  /** The bill's full invoice as a PDF copy; the server records who downloaded it. */
  downloadOrderInvoicePdf(id: string): Promise<Blob> {
    return this.#request<Blob>(
      `/management-api/orders/${encodeURIComponent(id)}/invoice-pdf`,
      "POST",
      undefined,
      { as: "blob" },
    );
  }
}
