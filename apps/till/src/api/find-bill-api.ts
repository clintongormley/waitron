import { DrawerApi } from "./drawer-api.js";
import type {
  BillsQuery,
  TransactionsQuery,
  FindBillPage,
  BillRow,
  TransactionsPage,
  FindBillOptions,
} from "./find-bill-types.js";
import type {
  GiveBackView,
  GiveBackRequest,
  GiveBackPreview,
  GiveBackWrite,
  GiveBackOutcome,
} from "./give-back-types.js";
import type {
  InvoiceCorrectionCashRequest,
  InvoiceCorrectionCashGiven,
  OpenInvoiceCorrection,
  InvoiceCorrectionView,
  InvoiceCorrectionFileRequest,
} from "./invoice-correction-types.js";
import type { BillEditState } from "./order-types.js";
import type {
  RefundableTender,
  TenderRefundRequest,
  TenderRefundView,
  TenderRefundAcknowledgment,
} from "./tender-refund-types.js";
import type { TillRequest, ReadOptions } from "./till-request.js";

function findBillParams(query: BillsQuery | TransactionsQuery): string {
  const params = new URLSearchParams({ q: query.q, page: String(query.page) });
  if (query.staffId !== undefined) params.set("staffId", query.staffId);
  if ("dates" in query) {
    params.set("preset", query.dates.preset);
    if (query.dates.preset === "custom") {
      params.set("from", query.dates.from);
      params.set("to", query.dates.to);
    }
    if (query.type !== undefined) params.set("type", query.type);
  } else {
    params.set("sort", query.sort.key);
    params.set("direction", query.sort.direction);
    if (query.owed === true) params.set("owed", "true");
    if (query.counter === true) params.set("counter", "true");
  }
  return params.toString();
}

export interface InvoiceLookupRow {
  workingOrderId: string;
  invoiceNumber: string;
  issuedAt: string;
  customerName: string;
  total: string;
}

export interface BillLookupRow {
  workingOrderId: string;
  orderNumber: number | null;
  label: string | null;
  partyName: string | null;
  tables: string[];
  invoiceNumber: string | null;
  openedAt: string;
  departedAt: string | null;
  status: "waiting_for_payment" | "left_without_paying";
  stillOwed: string;
}

export class FindBillApi extends DrawerApi {
  readonly #request: TillRequest;
  constructor(request: TillRequest) {
    super(request);
    this.#request = request;
  }
  lookUpInvoices(q: string, options: ReadOptions = {}): Promise<{ invoices: InvoiceLookupRow[] }> {
    return this.#request<{ invoices: InvoiceLookupRow[] }>(
      `/api/invoices/lookup?q=${encodeURIComponent(q)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  listBills(query: BillsQuery, options: ReadOptions = {}): Promise<FindBillPage<BillRow>> {
    return this.#request(`/api/bills?${findBillParams(query)}`, "GET", undefined, options.signal);
  }
  listTransactions(query: TransactionsQuery, options: ReadOptions = {}): Promise<TransactionsPage> {
    return this.#request(
      `/api/transactions?${findBillParams(query)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  getFindBill(
    workingOrderId: string,
    options: ReadOptions = {},
  ): Promise<BillRow & { edit: BillEditState | null }> {
    return this.#request(
      `/api/bills/${encodeURIComponent(workingOrderId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  findBillOptions(options: ReadOptions = {}): Promise<FindBillOptions> {
    return this.#request("/api/find-bill/options", "GET", undefined, options.signal);
  }
  getRefundableTenders(saleId: string, options: ReadOptions = {}): Promise<RefundableTender[]> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/refundable-tenders`,
      "GET",
      undefined,
      options.signal,
    );
  }
  refundTransaction(saleId: string, request: TenderRefundRequest): Promise<TenderRefundView> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/refunds`,
      "POST",
      request,
    );
  }
  readGiveBack(saleId: string, options: ReadOptions = {}): Promise<GiveBackView> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/give-back`,
      "GET",
      undefined,
      options.signal,
    );
  }
  previewGiveBack(saleId: string, request: GiveBackRequest): Promise<GiveBackPreview> {
    return this.#request(
      `/api/transactions/${encodeURIComponent(saleId)}/give-back/preview`,
      "POST",
      request,
    );
  }
  giveBack(saleId: string, { request, ...rest }: GiveBackWrite): Promise<GiveBackOutcome> {
    // Copied by name, so a stray property on `request` never reaches the server's top-level fields.
    const fields = {
      purpose: request.purpose,
      lineIds: request.lineIds,
      amount: request.amount,
      extra: request.extra,
      way: request.way,
      fromCancel: request.fromCancel,
      correctiveDelivery: request.correctiveDelivery,
    } satisfies Record<keyof GiveBackRequest, unknown>;
    return this.#request(`/api/transactions/${encodeURIComponent(saleId)}/give-back`, "POST", {
      ...fields,
      ...rest,
    });
  }
  giveInvoiceCorrectionCash(
    correctionId: string,
    request: InvoiceCorrectionCashRequest,
  ): Promise<InvoiceCorrectionCashGiven> {
    return this.#request(
      `/api/invoice-corrections/${encodeURIComponent(correctionId)}/cash`,
      "POST",
      request,
    );
  }
  async listInvoiceCorrections(options: ReadOptions = {}): Promise<OpenInvoiceCorrection[]> {
    const { corrections } = await this.#request<{ corrections: OpenInvoiceCorrection[] }>(
      "/api/invoice-corrections",
      "GET",
      undefined,
      options.signal,
    );
    return corrections;
  }
  getInvoiceCorrection(
    correctionId: string,
    options: ReadOptions = {},
  ): Promise<InvoiceCorrectionView> {
    return this.#request(
      `/api/invoice-corrections/${encodeURIComponent(correctionId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  /** Files the correction for the money given back so far; `expectedSplit` is the split shown. */
  fileInvoiceCorrection(
    correctionId: string,
    request: InvoiceCorrectionFileRequest,
  ): Promise<InvoiceCorrectionView> {
    return this.#request(
      `/api/invoice-corrections/${encodeURIComponent(correctionId)}/file`,
      "POST",
      request,
    );
  }
  /** Ends the correction without filing: discarded with nothing back, or closed keeping its
   * refunds when filing it is refused for good. */
  closeInvoiceCorrection(
    correctionId: string,
    request: { override?: InvoiceCorrectionFileRequest["override"] },
  ): Promise<InvoiceCorrectionView> {
    return this.#request(
      `/api/invoice-corrections/${encodeURIComponent(correctionId)}/close`,
      "POST",
      request,
    );
  }
  getTenderRefund(refundId: string, options: ReadOptions = {}): Promise<TenderRefundView> {
    return this.#request(
      `/api/tender-refunds/${encodeURIComponent(refundId)}`,
      "GET",
      undefined,
      options.signal,
    );
  }
  retryTenderRefund(
    refundId: string,
    override?: TenderRefundRequest["override"],
  ): Promise<TenderRefundView> {
    return this.#request(
      `/api/tender-refunds/${encodeURIComponent(refundId)}/retry`,
      "POST",
      override === undefined ? {} : { override },
    );
  }
  getTenderRefundAcknowledgment(
    refundId: string,
    options: ReadOptions = {},
  ): Promise<TenderRefundAcknowledgment> {
    return this.#request(
      `/api/tender-refunds/${encodeURIComponent(refundId)}/receipt`,
      "GET",
      undefined,
      options.signal,
    );
  }
  async reprintTenderRefund(refundId: string, language?: string): Promise<void> {
    await this.#request(
      `/api/tender-refunds/${encodeURIComponent(refundId)}/reprint`,
      "POST",
      language === undefined ? {} : { language },
    );
  }
}
