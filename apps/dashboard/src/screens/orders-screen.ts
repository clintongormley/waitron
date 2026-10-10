import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { UrlStateController, baseStyles, type DataTableColumn } from "@waitron/ui";
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
  type OrderStatusFilter,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { dashboardPath } from "../navigation.js";
import {
  DEFAULT_ORDERS_FILTER,
  readOrdersFilter,
  withStatus,
  writeOrdersFilter,
  type OrdersFilter,
} from "./orders-filter.js";
import "../widgets/order-detail-dialog.js";
import "../widgets/order-reprint-dialog.js";

const money = (value: string) => formatMoney(value, currentLocale());
const fill = (template: string, key: string, value: string) =>
  template.replace(`{${key}}`, () => value);
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

@customElement("dashboard-orders-screen")
export class OrdersScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
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
      .more {
        margin-top: var(--wt-space-3);
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
  @state() private filter: OrdersFilter = DEFAULT_ORDERS_FILTER;
  @state() private pages = 1;
  @state() private page?: OrdersPageDto;
  @state() private staff: { id: string; name: string | null }[] = [];
  @state() private refusal: { field: string | null; message: string } | null = null;
  @state() private loadingMore = false;
  @state() private openId: string | null = null;
  @state() private reprintRow: OrderRowDto | null = null;
  #textTimer?: ReturnType<typeof setTimeout>;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.loadingMore = false;
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
      this.filter = readOrdersFilter((key) => this.#url.read(key));
      this.pages = 1;
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
      this.#queries.release("listOrderPages");
      this.refusal = { field: "to", message: t("orders.range_backwards") };
      return;
    }
    void this.#queries
      .watch("listOrderPages", [this.filter, this.pages], (page) => {
        this.page = page;
        this.loadingMore = false;
        this.refusal = null;
      })
      .catch(() => undefined);
  }

  #apply(next: OrdersFilter): void {
    const filter = next.from && next.to ? next : { ...next, from: undefined, to: undefined };
    this.filter = filter;
    this.pages = 1;
    this.page = undefined;
    this.#url.write(writeOrdersFilter(filter));
    this.#watch();
  }

  #date(field: "from" | "to", value: string): void {
    const next = { ...this.filter, [field]: value };
    if (next.from && next.to) this.#apply(next);
    else this.filter = next;
  }

  #text(field: "table" | "q", value: string, immediate = false): void {
    clearTimeout(this.#textTimer);
    const kept = field === "q" ? value : value.trim();
    const apply = () =>
      this.#apply({ ...this.filter, [field]: value.trim() === "" ? undefined : kept });
    if (immediate) apply();
    else this.#textTimer = setTimeout(apply, 400);
  }

  #mayReprint(row: OrderRowDto): boolean {
    return row.kind === "bill" && row.invoiceNumber !== null;
  }

  #columns(): DataTableColumn<OrderRowDto>[] {
    return [
      {
        key: "opened",
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
            : fill(t("orders.order_number"), "number", String(row.orderNumber)),
      },
      {
        key: "table",
        label: t("orders.col.table"),
        cell: (row) => row.tables.join(", ") || (row.counter ? t("orders.counter") : ""),
      },
      {
        key: "invoice",
        label: t("orders.col.invoice"),
        cell: (row) =>
          html`${row.invoiceNumber ?? ""}${row.invoiceType === null ? nothing : html`<span part="invoice-type">${t(row.invoiceType === "F1" ? "orders.invoice_full" : "orders.invoice_simplified")}</span>`}${row.creditNotes.map(
            (number) => html`<span part="mark">${number}</span>`,
          )}`,
      },
      {
        key: "status",
        label: t("orders.col.status"),
        choosable: "shown",
        cell: (row) =>
          html`${t(`orders.status.${row.status}`)}${row.credited ? html`<span part="mark">${t(row.credited === "in_full" ? "orders.credited_in_full" : "orders.credited_in_part")}</span>` : nothing}${row.departedAt && (row.status === "paid" || row.status === "cancelled") ? html`<span part="mark">${fill(t("orders.left_on"), "date", new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(new Date(row.departedAt)))}</span>` : nothing}`,
      },
      { key: "total", label: t("orders.col.total"), cell: (row) => money(row.total) },
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
              variant="secondary"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.openId = row.id;
              }}
              >${t("orders.view")}</wt-button
            >${
              this.#mayReprint(row)
                ? html`<wt-button
                    variant="secondary"
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      this.reprintRow = row;
                    }}
                    >${t("orders.reprint")}</wt-button
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
    return html`<h1>${t("orders.title")}</h1>
      <div class="filters">
        <wt-combobox
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
            if (event.key === "Enter" && !event.isComposing)
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
            if (event.key === "Enter" && !event.isComposing)
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
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(row: OrderRowDto) => row.id}
        .rowClick=${(row: OrderRowDto) => {
          this.openId = row.id;
        }}
        .rowClickLabel=${() => t("orders.view")}
        .loading=${this.page === undefined && this.refusal === null}
        .loadingMessage=${t("orders.loading")}
        .emptyMessage=${tableNoMatches()}
        .errorMessage=${this.refusal?.field === null ? this.refusal.message : this.refusal ? t("form.fix_fields") : ""}
      ></wt-data-table>
      ${
        this.page?.next
          ? html`<wt-button
              class="more"
              variant="secondary"
              data-test="show-more"
              ?loading=${this.loadingMore}
              @click=${() => {
                this.loadingMore = true;
                this.pages++;
                this.#watch();
              }}
              >${t("orders.show_more")}</wt-button
            >`
          : nothing
      }
      <dashboard-order-detail-dialog
        .api=${this.api}
        .orderId=${this.openId}
        .mayReprint=${(row: OrderRowDto) => this.#mayReprint(row)}
        @order-reprint=${(event: CustomEvent<{ id: string }>) => {
          this.reprintRow = rows.find((row) => row.id === event.detail.id) ?? null;
        }}
        @wt-close=${() => {
          this.openId = null;
        }}
      ></dashboard-order-detail-dialog>
      <dashboard-order-reprint-dialog
        .api=${this.api}
        .row=${this.reprintRow}
        @wt-close=${() => {
          this.reprintRow = null;
        }}
      ></dashboard-order-reprint-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-orders-screen": OrdersScreen;
  }
}
