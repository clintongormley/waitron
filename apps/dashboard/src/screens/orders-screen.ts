import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  UrlStateController,
  TableRequestController,
  baseStyles,
  belongsToComposition,
  pageTitleStyles,
  type DataTableColumn,
} from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import { DashboardQueries } from "../api/query-controller.js";
import {
  ORDER_STATUS_FILTERS,
  type DashboardApi,
  type OrderRowDto,
  type OrdersPageDto,
  type OrdersPageQuery,
  type OrderStatusFilter,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { dashboardPath } from "../navigation.js";
import {
  DEFAULT_ORDERS_FILTER,
  readOrdersFilter,
  withStatus,
  writeOrdersFilter,
  type OrdersFilter,
} from "./orders-filter.js";
import "../widgets/invoice-customer-dialog.js";
import "../widgets/order-detail-dialog.js";
import "../widgets/order-reprint-dialog.js";

const money = (value: string) => formatMoney(value, currentLocale());
const FIELD_OF: Record<string, { control: string; message: StringKey }> = {
  status: { control: "status", message: "orders.refused.status" },
  from: { control: "from", message: "orders.refused.date" },
  to: { control: "to", message: "orders.refused.date" },
  range: { control: "to", message: "orders.range_backwards" },
  anyDate: { control: "anyDate", message: "orders.refused.any_date" },
  credited: { control: "credited", message: "orders.refused.credited" },
  staff: { control: "staff", message: "orders.refused.staff" },
  table: { control: "table", message: "orders.refused.table" },
  q: { control: "q", message: "orders.refused.search" },
};
/** The filter as read and written to the address; `filter.table` keeps the field's text as typed. */
const sent = (filter: OrdersFilter): OrdersFilter => ({
  ...filter,
  table: filter.table?.trim() || undefined,
});
const addressOf = (filter: OrdersFilter) => JSON.stringify(writeOrdersFilter(filter));

@customElement("dashboard-orders-screen")
export class OrdersScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      h1 {
        margin: 0;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: end;
        margin-bottom: var(--wt-space-4);
      }
      .filters wt-combobox {
        width: calc(var(--wt-cell-name-max-width) + var(--wt-space-4));
      }
      wt-data-table::part(owed) {
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(mark) {
        display: block;
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(invoice-type) {
        display: block;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  /** The session holds `report.export`. */
  @property({ attribute: false }) canExport = false;
  /** The session holds `personal_data.export`. */
  @property({ attribute: false }) canExportPersonalData = false;
  @state() private filter: OrdersFilter = DEFAULT_ORDERS_FILTER;
  @state() private page?: OrdersPageDto;
  @state() private staff: { id: string; name: string | null }[] = [];
  @state() private refusal: { field: string | null; message: string } | null = null;
  @state() private loading = true;
  @state() private openId: string | null = null;
  @state() private reprintRow: OrderRowDto | null = null;
  @state() private reprintMode: "receipt" | "choose" = "receipt";
  @state() private findingCustomer = false;
  #textTimer?: ReturnType<typeof setTimeout>;
  #sort?: Pick<OrdersPageQuery, "sortKey" | "sortDirection">;
  #rangeReleased = false;
  #shownQuery?: Omit<OrdersPageQuery, "q" | "page"> & { search: string };
  readonly #pages = new TableRequestController<
    Omit<OrdersPageQuery, "q" | "page"> & { search: string }
  >(this, async (query, page) => {
    this.loading = this.page === undefined;
    const { search, ...filters } = query;
    try {
      await this.#queries.watch(
        "listOrdersPage",
        [{ ...filters, q: search || undefined, page }],
        (value) => {
          this.page = value;
          this.#shownQuery = query;
          this.loading = false;
          this.refusal = null;
          if (this.#pages.query === query) this.#pages.move(value.page);
        },
      );
    } catch {
      if (this.#pages.query === query && this.#shownQuery === query)
        this.#pages.page = this.page!.page;
    }
  });

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.loading = false;
      const raw = (error as { params?: { field?: unknown } } | null)?.params?.field;
      const field =
        codeOf(error) === "management.request_invalid" && typeof raw === "string"
          ? FIELD_OF[raw]
          : undefined;
      this.refusal =
        field === undefined
          ? { field: null, message: codeMessage(codeOf(error)) }
          : { field: field.control, message: t(field.message) };
    },
  );
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "orders") return;
      clearTimeout(this.#textTimer);
      const address = readOrdersFilter((key) => this.#url.read(key));
      // The address this screen just wrote leaves the Table field's own spelling, such as a space
      // still being typed, alone.
      if (addressOf(sent(this.filter)) !== addressOf(address)) this.filter = address;
      this.#watch();
    },
    dashboardPath,
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#queries
      .watch("listOrderStaff", [], ({ staff }) => {
        this.staff = staff;
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#textTimer);
    super.disconnectedCallback();
  }

  #watch(): void {
    if (
      !this.filter.anyDate &&
      this.filter.from !== undefined &&
      this.filter.to !== undefined &&
      this.filter.from > this.filter.to
    ) {
      this.#pages.hostDisconnected();
      this.#queries.release("listOrdersPage");
      this.#rangeReleased = true;
      this.loading = false;
      this.refusal = { field: "to", message: t("orders.range_backwards") };
      return;
    }
    if (this.#sort === undefined) return;
    const previous = this.#pages.query;
    const released = this.#rangeReleased;
    this.#rangeReleased = false;
    const { q, ...filter } = sent(this.filter);
    this.#pages.setQuery({ ...filter, search: q ?? "", ...this.#sort });
    if (released && previous === this.#pages.query) void this.#pages.reload();
  }

  #apply(next: OrdersFilter, replace = false): void {
    clearTimeout(this.#textTimer);
    const filter = next.from && next.to ? next : { ...next, from: undefined, to: undefined };
    this.filter = filter;
    this.#url.write(writeOrdersFilter(sent(filter)), replace);
    this.#watch();
  }

  #date(field: "from" | "to", value: string): void {
    const next = { ...this.filter, [field]: value };
    if (next.from && next.to) this.#apply(next);
    else this.filter = next;
  }

  #text(field: "table" | "q", value: string, immediate = false): void {
    if (field === "q") {
      this.#apply({ ...this.filter, q: value.trim() === "" ? undefined : value }, true);
      if (immediate) void this.#pages.reload();
      return;
    }
    clearTimeout(this.#textTimer);
    this.filter = { ...this.filter, table: value };
    if (immediate) this.#apply(this.filter);
    else this.#textTimer = setTimeout(() => this.#apply(this.filter), 400);
  }

  #tableQuery(event: CustomEvent<Pick<OrdersPageQuery, "sortKey" | "sortDirection">>): void {
    event.stopPropagation();
    const { sortKey, sortDirection } = event.detail;
    this.#sort = {
      sortKey: ["opened", "invoice", "total"].includes(sortKey)
        ? (sortKey as OrdersPageQuery["sortKey"])
        : "",
      sortDirection,
    };
    this.#watch();
  }

  /** A full invoice is printed again through its own print action instead. */
  #mayReprint(row: OrderRowDto): boolean {
    return row.kind === "bill" && row.invoiceNumber !== null && row.invoiceType !== "F1";
  }

  /** The row carries no delivery status, so its menu cannot tell a copy; the dialog's heading does. */
  #mayPrintInvoice(row: OrderRowDto): boolean {
    return row.kind === "bill" && row.invoiceNumber !== null && row.invoiceType === "F1";
  }

  #openPrint(row: OrderRowDto): void {
    this.reprintMode = row.invoiceType === "F1" ? "choose" : "receipt";
    this.reprintRow = row;
  }

  #columns(): DataTableColumn<OrderRowDto>[] {
    return [
      {
        key: "opened",
        sortValue: (row) => row.at,
        label: t("orders.col.opened"),
        cell: (row) =>
          new Intl.DateTimeFormat(currentLocale(), {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(row.at)),
      },
      {
        key: "bill",
        label: t("orders.col.bill"),
        cell: (row) =>
          row.orderNumber === null
            ? (row.label ?? "")
            : fill("orders.order_number", { number: String(row.orderNumber) }),
      },
      {
        key: "table",
        label: t("orders.col.table"),
        cell: (row) => row.tables.join(", ") || (row.counter ? t("orders.counter") : ""),
      },
      {
        key: "invoice",
        sortValue: (row) => row.invoiceNumber ?? "",
        label: t("orders.col.invoice"),
        cell: (row) =>
          html`${row.invoiceNumber ?? ""}${row.invoiceType === null ? nothing : html`<span part="invoice-type">${t(row.invoiceType === "F1" ? "orders.invoice_full" : "orders.invoice_simplified")}</span>`}${row.correctives.map(
            (number) => html`<span part="mark">${number}</span>`,
          )}`,
      },
      {
        key: "status",
        label: t("orders.col.status"),
        choosable: "shown",
        cell: (row) =>
          html`${t(`orders.status.${row.status}`)}${row.credited ? html`<span part="mark">${t(row.credited === "in_full" ? "orders.credited_in_full" : "orders.credited_in_part")}</span>` : nothing}${row.departedAt && (row.status === "paid" || row.status === "deferred_payment" || row.status === "cancelled") ? html`<span part="mark">${fill("orders.left_on", { date: new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(new Date(row.departedAt)) })}</span>` : nothing}`,
      },
      {
        key: "total",
        label: t("orders.col.total"),
        sortValue: (row) => row.total,
        cell: (row) => money(row.total),
      },
      {
        key: "owed",
        label: t("orders.col.owed"),
        choosable: "shown",
        cell: (row) =>
          row.stillOwed === null ? "" : html`<span part="owed">${money(row.stillOwed)}</span>`,
      },
      {
        key: "staff",
        label: t("orders.col.staff"),
        choosable: "shown",
        cell: (row) =>
          row.staff.map((person) => person.name ?? t("orders.staff_unknown")).join(", "),
      },
      {
        key: "actions",
        label: t("orders.col.actions"),
        pinned: "end",
        align: "end",
        cell: (row) =>
          html`<wt-row-actions
            align="end"
            label=${`${t("orders.col.actions")}: ${row.invoiceNumber ?? row.label ?? row.id}`}
            ><wt-button
              icon="menu-open"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.openId = row.id;
              }}
              >${t("orders.view")}</wt-button
            >${
              this.#mayReprint(row) || this.#mayPrintInvoice(row)
                ? html`<wt-button
                    icon="menu-print"
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      this.#openPrint(row);
                    }}
                    >${t("orders.print_document.title_dialog")}</wt-button
                  >`
                : nothing
            }</wt-row-actions
          >`,
      },
    ];
  }

  override render() {
    const rows = this.page?.rows ?? [];
    const errorFor = (field: string) => (this.refusal?.field === field ? this.refusal.message : "");
    return html`<div class="heading">
        <h1>${t("orders.title")}</h1>
        ${
          this.canExportPersonalData
            ? html`<wt-button
                variant="secondary"
                data-test="find-invoice-customer"
                @click=${() => {
                  this.findingCustomer = true;
                }}
                >${t("invoice_customer.heading")}</wt-button
              >`
            : nothing
        }
      </div>
      <div class="filters">
        <wt-combobox
          ?preserve-order=${true /* Preserve order lifecycle. */}
          name="status"
          label=${t("orders.status")}
          .error=${errorFor("status")}
          .options=${ORDER_STATUS_FILTERS.map((status) => ({ value: status, label: t(`orders.status.${status}`) }))}
          .value=${this.filter.status}
          @wt-change=${(event: CustomEvent<{ value: OrderStatusFilter }>) => this.#apply(withStatus(this.filter, event.detail.value))}
        ></wt-combobox>
        <wt-input
          type="date"
          name="from"
          label=${t("orders.opened_from")}
          .error=${errorFor("from")}
          .value=${this.filter.from ?? this.page?.from ?? ""}
          ?disabled=${this.filter.anyDate}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#date("from", event.detail.value)}
        ></wt-input>
        <wt-input
          type="date"
          name="to"
          label=${t("orders.opened_to")}
          .error=${errorFor("to")}
          .value=${this.filter.to ?? this.page?.to ?? ""}
          ?disabled=${this.filter.anyDate}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#date("to", event.detail.value)}
        ></wt-input>
        <wt-switch
          name="any-date"
          label=${t("orders.any_date")}
          .checked=${this.filter.anyDate}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#apply({ ...this.filter, anyDate: event.detail.checked })}
        ></wt-switch>
        <wt-switch
          name="credited"
          label=${t("orders.credited_only")}
          .checked=${this.filter.credited}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#apply({ ...this.filter, credited: event.detail.checked })}
        ></wt-switch>
        <wt-combobox
          name="staff"
          label=${t("orders.staff")}
          search="auto"
          show-empty-option
          .error=${errorFor("staff")}
          .options=${[{ value: "", label: t("orders.staff_anyone") }, ...this.staff.map((person) => ({ value: person.id, label: person.name ?? t("orders.staff_unknown") }))]}
          .value=${this.filter.staff ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#apply({ ...this.filter, staff: event.detail.value || undefined })}
        ></wt-combobox>
        <wt-input
          name="table"
          label=${t("orders.table")}
          .error=${errorFor("table")}
          .value=${this.filter.table ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#text("table", event.detail.value)}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter" && !belongsToComposition(event))
              this.#text("table", (event.currentTarget as HTMLInputElement).value, true);
          }}
        ></wt-input>
        <wt-input
          name="q"
          label=${t("orders.search")}
          placeholder=${t("orders.search_hint")}
          .error=${errorFor("q")}
          .value=${this.filter.q ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#text("q", event.detail.value)}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter" && !belongsToComposition(event))
              this.#text("q", (event.currentTarget as HTMLInputElement).value, true);
          }}
        ></wt-input>
      </div>
      <wt-data-table
        noMatchesMessage=${tableNoMatches()}
        aria-label=${t("orders.title")}
        viewKey="waitron.orders.table"
        customiseColumnsLabel=${t("table.customise_columns")}
        customiseLabel=${t("table.customise")}
        restoreColumnsLabel=${t("table.restore_columns")}
        doneLabel=${t("table.done")}
        moveColumnLabel=${t("table.move_column")}
        showColumnLabel=${t("table.show_column")}
        hideColumnLabel=${t("table.hide_column")}
        alwaysShownColumnLabel=${t("table.column_always_shown")}
        lastShownColumnLabel=${t("table.column_last_shown")}
        columnPositionLabel=${t("table.column_position")}
        .serverPaging=${{ page: this.page?.page ?? 0, pageSize: 50, total: this.page?.total ?? 0 }}
        .pageRangeLabel=${(from: number, to: number, total: number) => fill("table.page_range", { from: from.toLocaleString(currentLocale()), to: to.toLocaleString(currentLocale()), total: total.toLocaleString(currentLocale()) })}
        previousPageLabel=${t("table.previous_page")}
        nextPageLabel=${t("table.next_page")}
        @wt-query-change=${this.#tableQuery}
        @wt-page-change=${(event: CustomEvent<{ page: number }>) => {
          event.stopPropagation();
          this.#pages.move(event.detail.page);
        }}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(row: OrderRowDto) => row.id}
        .rowClick=${(row: OrderRowDto) => {
          this.openId = row.id;
        }}
        .rowClickLabel=${() => t("orders.view")}
        .loading=${this.loading}
        .loadingMessage=${t("orders.loading")}
        .emptyMessage=${tableNoMatches()}
        .errorMessage=${this.refusal?.field === null ? this.refusal.message : this.refusal ? t("form.fix_fields") : ""}
      ></wt-data-table>
      <dashboard-order-detail-dialog
        .api=${this.api}
        .orderId=${this.openId}
        .mayReprint=${(row: OrderRowDto) => this.#mayReprint(row)}
        .mayExport=${this.canExport}
        @order-reprint=${(event: CustomEvent<{ row: OrderRowDto }>) => {
          this.#openPrint(event.detail.row);
        }}
        @order-invoice-print=${(event: CustomEvent<{ row: OrderRowDto }>) => {
          this.#openPrint(event.detail.row);
        }}
        @wt-close=${() => {
          this.openId = null;
        }}
      ></dashboard-order-detail-dialog>
      <dashboard-order-reprint-dialog
        .api=${this.api}
        .row=${this.reprintRow}
        .mode=${this.reprintMode}
        @wt-close=${() => {
          this.reprintRow = null;
        }}
      ></dashboard-order-reprint-dialog>
      <dashboard-invoice-customer-dialog
        .api=${this.api}
        .open=${this.findingCustomer}
        @wt-close=${() => {
          this.findingCustomer = false;
        }}
      ></dashboard-invoice-customer-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-orders-screen": OrdersScreen;
  }
}
