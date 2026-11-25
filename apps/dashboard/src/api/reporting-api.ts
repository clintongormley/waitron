import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { TimingBand } from "@waitron/shared";
import { DevicesApi } from "./devices-api.js";

export interface HandoverInterval {
  operationId: string;
  inventoryReceived: boolean;
  sourceName: string;
  destinationName: string;
  lastChangeAtMs: number | null;
  declaredAtMs: number;
  activatedAt: string;
  reason: string;
}

export interface ReturnedInvoiceRecord {
  recordId: string;
  saleId: string;
  sourceNodeId: string;
  sourceName: string;
  generationId: string;
  installation: string;
  sequence: number;
  invoiceNumber: string;
  issueDate: string;
  kind: string;
  category: "invoice" | "simplified" | "replacement" | "correction" | "cancellation";
  correctsRecordId: string | null;
  taxable: string | null;
  gross: string | null;
  tax: string | null;
  receivedAt: string;
}

export interface ReturnedInvoicesQuery {
  search: string;
  page: number;
  sortKey: "" | "receivedAt";
  sortDirection: "ascending" | "descending";
}

export interface ReturnedInvoices {
  rows: ReturnedInvoiceRecord[];
  total: number;
  page: number;
  pageSize: number;
  timeZone: string;
}

export interface HandoverIntervals {
  intervals: HandoverInterval[];
  timeZone: string;
}
// ── Purchase-invoice types ──────────────────────────────────────────────────────────────────────
// Every decimal value crosses the wire as a string, never a number.

export type PurchaseRegime = "general" | "equivalence_surcharge";

export type PurchaseVatKind = "ordinary" | "capital";

export interface PurchaseInvoiceLine {
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

export interface PurchaseInvoice {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime: PurchaseRegime;
  deductibleProportion: string;
  note: string | null;
  lines: PurchaseInvoiceLine[];
}

export interface PurchaseInvoiceLineInput {
  rate: string;
  base: string;
  tax: string;
  kind?: PurchaseVatKind;
}

export interface PurchaseInvoiceHeaderInput {
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime?: PurchaseRegime;
  deductibleProportion?: string;
  note?: string | null;
}

export interface PurchaseInvoiceInput {
  header: PurchaseInvoiceHeaderInput;
  lines: PurchaseInvoiceLineInput[];
}
/** `lines`, when present, replaces the whole VAT breakdown. */
export interface PurchaseInvoicePatch {
  header?: Partial<PurchaseInvoiceHeaderInput>;
  lines?: PurchaseInvoiceLineInput[];
}
// ── Receipt-printer + print-mode configuration ───────────────────────────────────────────────────

// ── Reporting (sales & takings) types ────────────────────────────────────────────────────────────
// Every decimal value crosses the wire as a string, never a number.

/** `name` is the frozen staff name (`sale_lines.name`), not a locale map. */
export interface TopSellerRow {
  name: string;
  quantity: string;
  total: string;
  variants: TopSellerVariantRow[];
}

export interface TopSellerVariantRow {
  name: string;
  quantity: string;
  total: string;
}

export interface VatRateRow {
  rate: string;
  base: string;
  tax: string;
}

export interface VatSummaryDto {
  byRate: VatRateRow[];
  baseTotal: string;
  taxTotal: string;
  grossTotal: string;
}

export interface TenderMethodRow {
  method: string;
  amount: string;
  tip: string;
}
/** The money one device took, or one job source such as the Demo seed with no device. */
export interface OriginCashUpRow {
  source: string;
  deviceId: string | null;
  /** The device's name, kept after the device is revoked; null for a job source. */
  deviceName: string | null;
  byMethod: TenderMethodRow[];
  cashTakings: string;
}

export interface CashUpDto {
  byOrigin: OriginCashUpRow[];
  tenderTotal: string;
  tipTotal: string;
}

export interface SalesCounts {
  sales: number;
  corrections: number;
  voids: number;
}

export interface ClosureSummaryDto {
  billsClosed: { count: number; total: string };
  deferredPayments: string;
  received: string;
}

export interface DepartmentTakingsDto {
  departmentId: string | null;
  departmentName: string | null;
  active: boolean | null;
  byMethod: TenderMethodRow[];
  billsClosed: { count: number; total: string };
}

export interface SalesOverview {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  closureSummary: ClosureSummaryDto;
  departmentTakings: DepartmentTakingsDto[];
  counts: SalesCounts;
  openTables: { open: number; total: number };
  topSellers: TopSellerRow[];
}

export interface OverdueOrder {
  orderId: string;
  orderNumber: number;
  tableLabel: string | null;
  counter?: true;
  stationName: string;
  ageMinutes: number;
  band: TimingBand;
}

export interface OutsidePaymentDto {
  id: string;
  workingOrderId: string;
  orderNumber: number;
  saleId: string | null;
  invoiceNumber: string | null;
  nodeId: string | null;
  settledAt: string;
  amount: string;
  externalProvider: "connected_account" | "other" | null;
  externalMachine: string | null;
  externalRef: string | null;
  state:
    | "attempting"
    | "initiated"
    | "captured"
    | "voided"
    | "refunded"
    | "partially_refunded"
    | "failed";
  refunded: string;
}

export interface DailyCloseDto {
  timeZone: string;
  outsidePayments: OutsidePaymentDto[];
  businessDay: string;
  vat: VatSummaryDto;
  cash: CashUpDto;
  closureSummary: ClosureSummaryDto;
  departmentTakings: DepartmentTakingsDto[];
  counts: SalesCounts;
  topSellers: TopSellerRow[];
}

export interface SalesPeriodDto {
  from: string;
  to: string;
  vat: VatSummaryDto;
  topSellers: TopSellerRow[];
}

export type CategoryReportMode = "at_time_of_sale" | "current";
/**
 * One node of the category report. `name` is `""` for `set_menus`, `custom_items`, `uncategorised`,
 * `not_recorded` and `payments_on_account` (the screen names those); a `free_text` node's `id` and
 * `name` are the recorded free-text category. `gross` and `net` include the children; `direct` is
 * the lines whose own category is this node.
 */
export interface CategoryTotalDto {
  kind:
    | "category"
    | "set_menus"
    | "custom_items"
    | "uncategorised"
    | "not_recorded"
    | "payments_on_account"
    | "free_text";
  id: string;
  name: string;
  depth: number;
  gross: string;
  net: string;
  direct: { gross: string; net: string; lines: number };
  children: CategoryTotalDto[];
}

export interface CategorySalesDto {
  mode: CategoryReportMode;
  tree: CategoryTotalDto[];
  gross: string;
  net: string;
  grossComplete: boolean;
  linesWithoutGross: number;
}
interface DrawerCountDto {
  at: string;
  person: string;
  expected: string;
  counted: string;
  difference: string;
  cashMoved: boolean;
}

export interface DrawerCloseHistoryDto {
  timeZone: string;
  closes: {
    id: string;
    drawerId: string;
    drawerName: string;
    assigned: boolean;
    deleted: boolean;
    first: DrawerCountDto;
    recount: DrawerCountDto | null;
    finished: {
      id: string;
      person: string;
      at: string;
      bankWithdrawal: string;
      amountLeft: string;
      difference: string;
      cashAfterCount: string;
    } | null;
  }[];
}

export interface ReportPrinter {
  id: string;
  name: string;
}

export interface PrintCategorySalesInput {
  from: string;
  to: string;
  mode: CategoryReportMode;
  extrasIntoDish: boolean;
  printerId: string;
}

export const TAX_OFFICE_KINDS = ["F1", "F2", "F3", "R4", "R5"] as const;

export type TaxOfficeKind = (typeof TAX_OFFICE_KINDS)[number];
/** One issued document, as `GET /management-api/tax-office/invoices` answers it. */
export interface TaxOfficeInvoiceDto {
  id: string;
  number: string;
  kind: TaxOfficeKind;
  issuedAt: string;
  issueDate: string;
  /** Null when the operation happened on the issue day. */
  operationDate: string | null;
  customerName: string | null;
  customerTaxId: string | null;
  vat: { rate: string; base: string; tax: string }[];
  total: string;
  corrects: string[];
  cancelledAt: string | null;
}

export interface TaxOfficeCursor {
  at: string;
  id: string;
}

export interface TaxOfficePageDto {
  rows: TaxOfficeInvoiceDto[];
  next: TaxOfficeCursor | null;
  timeZone: string;
}
/** The person's own month file for the tax office, built on the box in the background. */
export type MonthDownloadDto =
  | { status: "none" }
  | { status: "building"; id: string; month: string }
  | { status: "ready"; id: string; month: string; bytes: number; expiresAt: string }
  | {
      status: "failed";
      id: string;
      month: string;
      /** Set when the build stopped because the disk was running out. */
      refusal: null | { code: "tax_office.space_ran_out"; params: { writtenBytes: number } };
    };
/** Issue dates are venue calendar days; the other filters are left out when not given. */
export interface TaxOfficeQuery {
  from: string;
  to: string;
  q?: string;
  rate?: string;
  amount?: string;
  operationFrom?: string;
  operationTo?: string;
  kind?: TaxOfficeKind;
  after?: TaxOfficeCursor;
}
/** `period` is the server's own token: `01`..`12` for a month, `1T`..`4T` for a quarter. */
export interface VatReturnFileInput {
  year: number;
  period: string;
  declarationType: string;
}

export class ReportingApi extends DevicesApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  // ── Purchase invoices ────────────────────────────────────────────────────────────────────────

  listPurchaseInvoices(): Promise<PurchaseInvoice[]> {
    return this.#request<PurchaseInvoice[]>("/management-api/purchase-invoices", "GET");
  }
  createPurchaseInvoice(input: PurchaseInvoiceInput): Promise<PurchaseInvoice> {
    return this.#request<PurchaseInvoice>("/management-api/purchase-invoices", "POST", input);
  }
  updatePurchaseInvoice(id: string, patch: PurchaseInvoicePatch): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "PATCH", patch);
  }
  deletePurchaseInvoice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "DELETE");
  }
  // ── Reporting (sales & takings) ─────────────────────────────────────────────────────────────────

  getSalesOverview(): Promise<SalesOverview> {
    return this.#request<SalesOverview>("/management-api/reports/overview", "GET");
  }
  getDailyClose(businessDay: string): Promise<DailyCloseDto> {
    return this.#request<DailyCloseDto>(
      `/management-api/reports/daily-close?businessDay=${businessDay}`,
      "GET",
    );
  }
  getSalesPeriod(from: string, to: string): Promise<SalesPeriodDto> {
    return this.#request<SalesPeriodDto>(
      `/management-api/reports/period?from=${from}&to=${to}`,
      "GET",
    );
  }
  listTaxOfficeInvoices(query: TaxOfficeQuery): Promise<TaxOfficePageDto> {
    const { after, ...filters } = query;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined && value !== "") params.set(key, value);
    if (after !== undefined) {
      params.set("afterAt", after.at);
      params.set("afterId", after.id);
    }
    return this.#request<TaxOfficePageDto>(`/management-api/tax-office/invoices?${params}`, "GET");
  }
  /** Any issued document as a PDF copy; the server records who downloaded it. */
  downloadTaxOfficeInvoicePdf(saleId: string): Promise<Blob> {
    return this.#request<Blob>(
      `/management-api/tax-office/invoices/${encodeURIComponent(saleId)}/pdf`,
      "POST",
      undefined,
      { as: "blob" },
    );
  }
  /** Starts building `month` (`YYYY-MM`) on the box; the server records who asked. */
  requestTaxOfficeMonth(month: string): Promise<MonthDownloadDto> {
    return this.#request<MonthDownloadDto>(
      `/management-api/tax-office/months/${encodeURIComponent(month)}`,
      "POST",
    );
  }
  getTaxOfficeMonthDownload(): Promise<MonthDownloadDto> {
    return this.#request<MonthDownloadDto>("/management-api/tax-office/month-download", "GET");
  }
  downloadAccountantExport(range: { from: string; to: string }): Promise<Blob> {
    return this.#request<Blob>(
      `/management-api/reports/accountant-export?from=${range.from}&to=${range.to}`,
      "POST",
      undefined,
      { as: "blob" },
    );
  }
  getCategorySales(
    from: string,
    to: string,
    mode: CategoryReportMode,
    extrasIntoDish: boolean,
  ): Promise<CategorySalesDto> {
    return this.#request<CategorySalesDto>(
      `/management-api/reports/categories?from=${from}&to=${to}&mode=${mode}&extrasIntoDish=${extrasIntoDish}`,
      "GET",
    );
  }
  getDrawerCloses(from: string, to: string): Promise<DrawerCloseHistoryDto> {
    const params = new URLSearchParams({ from, to });
    return this.#request<DrawerCloseHistoryDto>(
      `/management-api/reports/drawer-closes?${params}`,
      "GET",
    );
  }
  printDrawerClose(closeId: string, printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/reports/drawer-closes/${encodeURIComponent(closeId)}/print`,
      "POST",
      { printerId },
    );
  }
  getReportPrinters(): Promise<ReportPrinter[]> {
    return this.#request<ReportPrinter[]>("/management-api/reports/printers", "GET");
  }
  printCategorySales(input: PrintCategorySalesInput): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      "/management-api/reports/categories/print",
      "POST",
      input,
    );
  }
  /** The DR303 file (modelo 303) for one period; the server answers its ISO-8859-1 bytes. */
  downloadVatReturnFile(input: VatReturnFileInput): Promise<Blob> {
    const params = new URLSearchParams({
      year: String(input.year),
      period: input.period,
      declarationType: input.declarationType,
    });
    return this.#request<Blob>(`/management-api/reports/modelo-303?${params}`, "GET", undefined, {
      as: "blob",
    });
  }
  downloadVatCorrections(input: { year: number; period: string }): Promise<Blob> {
    const params = new URLSearchParams({ year: String(input.year), period: input.period });
    return this.#request<Blob>(`/management-api/reports/corrections?${params}`, "GET", undefined, {
      as: "blob",
    });
  }
  getHandoverWarning(): Promise<{ hasEmergencyHandover: boolean; hasReturnedInvoices: boolean }> {
    return this.#request<{ hasEmergencyHandover: boolean; hasReturnedInvoices: boolean }>(
      "/management-api/reports/handover-warning",
      "GET",
      undefined,
      { passive: true },
    );
  }
  listReturnedInvoices(query: ReturnedInvoicesQuery): Promise<ReturnedInvoices> {
    const params = new URLSearchParams({ ...query, page: String(query.page) });
    return this.#request<ReturnedInvoices>(
      `/management-api/reports/returned-invoices?${params}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  listHandoverIntervals(): Promise<HandoverIntervals> {
    return this.#request<HandoverIntervals>(
      "/management-api/reports/handover-intervals",
      "GET",
      undefined,
      { passive: true },
    );
  }
  getOverdueOrders(): Promise<{ orders: OverdueOrder[] }> {
    return this.#request<{ orders: OverdueOrder[] }>(
      "/management-api/reports/overdue-orders",
      "GET",
    );
  }
}
