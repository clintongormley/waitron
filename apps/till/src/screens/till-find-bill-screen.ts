import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import type { DataTableColumn, WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import type { TillApi } from "../api/client.js";
import type {
  BillRow,
  BillsQuery,
  DateWindow,
  FindBillDates,
  FindBillOptions,
  TransactionRow,
  TransactionsQuery,
} from "../api/find-bill-types.js";
import { countText, currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";

type Tab = "bills" | "transactions";
type Row = BillRow | TransactionRow;
type QueryDetail = {
  search: string;
  sortKey: string;
  sortDirection: "ascending" | "descending";
  filters: Record<string, string | string[]>;
};
type View = {
  query?: QueryDetail;
  page: number;
  rows: Row[];
  total: number;
  loading: boolean;
  error: string;
};
const emptyView = (): View => ({ page: 0, rows: [], total: 0, loading: false, error: "" });
const states = ["unpaid", "held", "part-paid", "paid-not-handed-over"] as const;
const methods = ["cash", "card", "voucher", "transfer", "other"] as const;
const types = ["sale", "full-invoice", "correction", "refund"] as const;
const presets = [
  "today",
  "yesterday",
  "business-day",
  "last-7-days",
  "this-month",
  "custom",
  "any",
] as const;
const label = (key: string) => t(`find_page.${key}` as StringKey);
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

@customElement("till-find-bill-screen")
export class TillFindBillScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        color: var(--wt-color-text);
        padding: var(--wt-space-4);
      }
      header,
      .chips {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      header {
        margin-bottom: var(--wt-space-3);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
        margin: 0;
      }
      .dates {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(earlier) {
        color: var(--wt-color-text-muted);
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      .chips {
        padding-block: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) api!: TillApi;
  @property({ type: Boolean }) active = false;
  @property({ type: Boolean }) busy = false;
  @state() private tab: Tab = "bills";
  @state() private options?: FindBillOptions;
  @state() private optionsError = "";
  @state() private openCount: number | null = null;
  @state() private dates: FindBillDates = { preset: "today" };
  @state() private dateFrom = "";
  @state() private dateTo = "";
  @state() private dateInvalid = false;
  @state() private resolved: DateWindow = null;
  readonly #views: Record<Tab, View> = { bills: emptyView(), transactions: emptyView() };
  #controller?: AbortController;
  #optionsController?: AbortController;
  #generation = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #optionsGeneration = 0;

  protected override updated(changed: PropertyValues): void {
    if (changed.has("active") || changed.has("api")) {
      this.#cancel();
      this.#optionsController?.abort();
      this.#optionsGeneration++;
      if (changed.has("api") && changed.get("api") !== undefined) {
        this.options = undefined;
        for (const tab of ["bills", "transactions"] as const) this.#views[tab] = emptyView();
        this.optionsError = "";
      }
      if (this.active && this.api) {
        if (this.options) this.#read();
        else void this.#loadOptions();
      }
    }
  }
  override disconnectedCallback(): void {
    this.#cancel();
    this.#optionsController?.abort();
    this.#optionsGeneration++;
    super.disconnectedCallback();
  }
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && this.active) {
      if (this.options) this.#read();
      else void this.#loadOptions();
    }
  }
  #cancel(): void {
    this.#generation++;
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const view of Object.values(this.#views)) view.loading = false;
  }
  async #loadOptions(): Promise<void> {
    const generation = ++this.#optionsGeneration;
    this.#optionsController?.abort();
    const controller = (this.#optionsController = new AbortController());
    this.optionsError = "";
    try {
      const options = await this.api.findBillOptions({ signal: controller.signal });
      if (generation !== this.#optionsGeneration || !this.active || !this.isConnected) return;
      this.options = options;
    } catch {
      if (generation === this.#optionsGeneration && this.active && this.isConnected)
        this.optionsError = label("load_failed");
    }
  }
  #query(tab: Tab, event: CustomEvent<QueryDetail>): void {
    event.stopPropagation();
    const view = this.#views[tab],
      previous = view.query;
    view.query = event.detail;
    if (JSON.stringify(previous) === JSON.stringify(view.query)) return;
    view.page = 0;
    if (tab !== this.tab || !this.active) return;
    this.#schedule(previous !== undefined && previous.search !== view.query.search);
  }
  #schedule(debounce = false): void {
    this.#cancel();
    const view = this.#views[this.tab];
    view.error = "";
    view.rows = [];
    if (!this.active || !view.query || (this.dateInvalid && this.tab === "transactions")) {
      this.requestUpdate();
      return;
    }
    view.loading = true;
    this.requestUpdate();
    if (debounce)
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#read();
      }, 200);
    else void this.#read();
  }
  async #read(): Promise<void> {
    const tab = this.tab,
      view = this.#views[tab],
      query = view.query;
    if (!query || !this.active || !this.isConnected || (this.dateInvalid && tab === "transactions"))
      return;
    this.#cancel();
    const generation = this.#generation;
    const controller = (this.#controller = new AbortController());
    view.loading = true;
    view.error = "";
    view.rows = [];
    this.requestUpdate();
    const filter = (key: string) =>
      typeof query.filters[key] === "string" ? (query.filters[key] as string) : undefined;
    const common = {
      q: query.search,
      page: view.page,
      sort: {
        key: query.sortKey || (tab === "bills" ? "openedAt" : "when"),
        direction: query.sortKey ? query.sortDirection : ("descending" as const),
      },
      ...(filter("staff") ? { staffId: filter("staff") } : {}),
    };
    try {
      const result =
        tab === "bills"
          ? await this.api.listBills(
              {
                ...common,
                ...(filter("zone") ? { zoneId: filter("zone") } : {}),
                ...(filter("state") ? { state: filter("state") as BillsQuery["state"] } : {}),
              },
              { signal: controller.signal },
            )
          : await this.api.listTransactions(
              {
                ...common,
                dates: this.dates,
                ...(filter("method")
                  ? { method: filter("method") as TransactionsQuery["method"] }
                  : {}),
                ...(filter("type") ? { type: filter("type") as TransactionsQuery["type"] } : {}),
              },
              { signal: controller.signal },
            );
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      this.openCount = result.openCount;
      const last = Math.max(0, Math.ceil(result.total / 50) - 1);
      if (view.page > last) {
        view.total = result.total;
        view.page = last;
        void this.#read();
        return;
      }
      view.rows = result.rows;
      view.total = result.total;
      if ("dates" in result) this.resolved = result.dates;
    } catch {
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      view.error = label("load_failed");
    } finally {
      if (generation === this.#generation) {
        view.loading = false;
        this.requestUpdate();
      }
    }
  }
  #selectTab(event: CustomEvent<{ value: Tab }>): void {
    event.stopPropagation();
    this.#cancel();
    this.tab = event.detail.value;
    this.#read();
  }
  #setDates(preset: FindBillDates["preset"]): void {
    this.dates =
      preset === "custom" ? { preset, from: this.dateFrom, to: this.dateTo } : { preset };
    this.#dateChanged();
  }
  #dateChanged(): void {
    this.resolved = null;
    this.dateInvalid =
      this.dates.preset === "custom" &&
      (!validDate(this.dateFrom) || !validDate(this.dateTo) || this.dateFrom > this.dateTo);
    if (this.dates.preset === "custom")
      this.dates = { preset: "custom", from: this.dateFrom, to: this.dateTo };
    this.#views.transactions.page = 0;
    this.#schedule();
  }
  #clearFilters(tab: Tab, event: Event): void {
    event.stopPropagation();
    if (tab !== "transactions") return;
    this.dates = { preset: "any" };
    this.dateInvalid = false;
    this.resolved = null;
    this.#views.transactions.page = 0;
    const generation = this.#generation;
    void Promise.resolve()
      .then(() => this.#grid(tab)?.updateComplete)
      .then(() => {
        if (generation === this.#generation && this.active && this.tab === tab) this.#schedule();
      });
  }
  #emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #grid(tab: Tab): WtDataTable<Row> | null {
    return this.shadowRoot?.querySelector(`wt-data-table[data-tab="${tab}"]`) ?? null;
  }
  #columns(tab: Tab): DataTableColumn<Row>[] {
    const choices = (key: string, values: { value: string; label: string }[]) => ({
      label: label(key),
      allLabel: label(`any_${key}`),
      value: () => "",
      options: values,
    });
    const money = (value: string) => formatMoney(value, currentLocale());
    const column = (
      key: string,
      cell: (row: Row) => unknown,
      extra: Partial<DataTableColumn<Row>> = {},
    ): DataTableColumn<Row> => ({
      key,
      label: label(key),
      cell,
      sortValue: () => "",
      ...(key === (tab === "bills" ? "openedAt" : "when") ? {} : { choosable: "shown" }),
      ...extra,
    });
    const options = this.options!;
    if (tab === "bills") {
      const cell = (read: (row: BillRow) => unknown) => (row: Row) => read(row as BillRow);
      return [
        column(
          "openedAt",
          cell(
            (row) =>
              html`${new Date(row.openedAt).toLocaleString(currentLocale(), { timeZone: options.timeZone })}${row.earlierDay ? html`<span part="earlier">${label("earlier")}</span>` : nothing}`,
          ),
        ),
        column(
          "tableName",
          cell(
            (row) =>
              [row.tables.join(", "), row.partyName ?? row.label].filter(Boolean).join(" · ") ||
              `#${row.orderNumber}`,
          ),
        ),
        column(
          "zone",
          cell((row) => row.zoneName ?? "—"),
          {
            filter: choices(
              "zone",
              options.zones.map((o) => ({ value: o.id, label: o.name })),
            ),
          },
        ),
        column(
          "staff",
          cell((row) => row.staff.map((p) => p.name ?? "—").join(", ")),
          {
            filter: choices(
              "staff",
              options.billStaff.map((o) => ({ value: o.id, label: o.name })),
            ),
          },
        ),
        column(
          "items",
          cell((row) => row.itemCount),
          { align: "end" },
        ),
        column(
          "total",
          cell((row) => money(row.total)),
          { align: "end" },
        ),
        column(
          "paid",
          cell((row) => money(row.paid)),
          { align: "end" },
        ),
        column(
          "state",
          cell((row) => label(row.state)),
          {
            filter: choices(
              "state",
              states.map((value) => ({ value, label: label(value) })),
            ),
          },
        ),
      ];
    }
    const cell = (read: (row: TransactionRow) => unknown) => (row: Row) =>
      read(row as TransactionRow);
    return [
      column(
        "when",
        cell((row) =>
          new Date(row.issuedAt).toLocaleString(currentLocale(), { timeZone: options.timeZone }),
        ),
      ),
      column(
        "invoice",
        cell((row) => row.invoiceNumber),
      ),
      column(
        "type",
        cell((row) => label(row.type)),
        {
          filter: choices(
            "type",
            types.map((value) => ({ value, label: label(value) })),
          ),
        },
      ),
      column(
        "tableName",
        cell((row) => [row.tableName, row.customerName].filter(Boolean).join(" · ") || "—"),
      ),
      column(
        "method",
        cell(
          (row) =>
            row.methods
              .map((m) => `${label(m.method)}${m.last4 ? ` · ${m.last4}` : ""}`)
              .join(", ") || label("unpaid"),
        ),
        {
          filter: choices(
            "method",
            methods.map((value) => ({ value, label: label(value) })),
          ),
        },
      ),
      column(
        "staff",
        cell((row) => row.staff?.name ?? "—"),
        {
          filter: choices(
            "staff",
            options.transactionStaff.map((o) => ({ value: o.id, label: o.name })),
          ),
        },
      ),
      column(
        "amount",
        cell((row) => money(row.amount)),
        { align: "end" },
      ),
    ];
  }
  #dateControls() {
    return html`<div slot="filters-start" class="dates">
      <wt-combobox
        name="dates"
        label=${label("dates")}
        .value=${this.dates.preset}
        .options=${presets.map((value) => ({ value, label: label(value) }))}
        @wt-change=${(event: CustomEvent<{ value: FindBillDates["preset"] }>) => {
          event.stopPropagation();
          this.#setDates(event.detail.value);
        }}
      ></wt-combobox>
      ${
        this.dates.preset === "custom"
          ? html`
              <wt-input
                name="from"
                type="date"
                label=${label("from")}
                required
                .value=${this.dateFrom}
                .error=${this.dateInvalid ? label("invalid_dates") : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.dateFrom = event.detail.value;
                  this.#dateChanged();
                }}
              ></wt-input>
              <wt-input
                name="to"
                type="date"
                label=${label("to")}
                required
                .value=${this.dateTo}
                .error=${this.dateInvalid ? label("invalid_dates") : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.dateTo = event.detail.value;
                  this.#dateChanged();
                }}
              ></wt-input>
              ${this.dateInvalid ? html`<p class="error" role="alert">${label("invalid_dates")}</p>` : nothing}
            `
          : nothing
      }
    </div>`;
  }
  #table(tab: Tab) {
    const view = this.#views[tab],
      columns = this.#columns(tab);
    const chips = Object.entries(view.query?.filters ?? {});
    return html`<wt-data-table
      slot=${tab}
      data-tab=${tab}
      aria-label=${label(tab)}
      viewKey=${`waitron.find-bill.${tab}`}
      searchable
      searchLabel=${label("search")}
      searchPlaceholder=${label(tab === "bills" ? "bill_search" : "transaction_search")}
      filtersLabel=${label("filters")}
      filteredColumnLabel=${label("filtered")}
      filtersClearAllLabel=${label("clear_all")}
      filtersCloseLabel=${label("close_filters")}
      filterSearchPlaceholder=${label("search")}
      filterNoResultsLabel=${label("none")}
      noMatchesMessage=${label("none")}
      customiseColumnsLabel=${label("customise_columns")}
      customiseLabel=${label("customise")}
      restoreColumnsLabel=${label("restore")}
      doneLabel=${label("done")}
      moveColumnLabel=${label("move")}
      showColumnLabel=${label("show")}
      hideColumnLabel=${label("hide")}
      alwaysShownColumnLabel=${label("always_shown")}
      lastShownColumnLabel=${label("last_shown")}
      columnPositionLabel=${label("position")}
      previousPageLabel=${label("previous")}
      nextPageLabel=${label("next")}
      .pageRangeLabel=${(from: number, to: number, total: number) => label("range").replace("{from}", from.toLocaleString(currentLocale())).replace("{to}", to.toLocaleString(currentLocale())).replace("{total}", total.toLocaleString(currentLocale()))}
      .serverPaging=${{ page: view.page, pageSize: 50, total: view.total }}
      .externalFilterCount=${tab === "transactions" && this.dates.preset !== "any" ? 1 : 0}
      .rows=${view.rows}
      .columns=${columns}
      .rowKey=${(row: Row) => ("workingOrderId" in row && !("saleId" in row) ? row.workingOrderId : (row as TransactionRow).transactionId)}
      .sortKey=${tab === "bills" ? "openedAt" : "when"}
      sortDirection="descending"
      .rowClickLabel=${() => label(tab === "bills" ? "open_bill" : "open_receipt")}
      .rowClickable=${() => !view.loading && this.active && !this.busy}
      .rowClick=${(row: Row) => this.#emit(tab === "bills" ? "find-bill-open" : "find-transaction-open", { row })}
      .loading=${view.loading}
      loadingMessage=${label("loading")}
      emptyMessage=${label("none")}
      errorMessage=${view.error}
      @wt-query-change=${(event: CustomEvent<QueryDetail>) => this.#query(tab, event)}
      @wt-page-change=${(event: CustomEvent<{ page: number }>) => {
        event.stopPropagation();
        if (!view.loading) {
          view.page = event.detail.page;
          this.#schedule();
        }
      }}
      @wt-filters-clear=${(event: Event) => this.#clearFilters(tab, event)}
    >
      ${tab === "transactions" ? this.#dateControls() : nothing}
      <div slot="toolbar-bottom" class="chips">
        ${tab === "transactions" && this.dates.preset !== "any" ? html`<wt-button variant="secondary" data-chip="dates" aria-label=${label("remove_dates")} @click=${() => this.#setDates("any")}>${label(this.dates.preset)}${!this.dateInvalid && this.resolved ? ` · ${this.resolved.from} – ${this.resolved.to}` : ""} ×</wt-button>` : nothing}
        ${chips.map(([key, value]) => html`<wt-button variant="secondary" data-chip=${key} aria-label=${label("remove_filter").replace("{filter}", label(key))} @click=${() => this.#grid(tab)?.chooseFilter(key, [])}>${label(key)}: ${columns.find((c) => c.key === key)?.filter?.options.find((o) => o.value === value)?.label ?? value} ×</wt-button>`)}
        ${view.error ? html`<wt-button variant="secondary" @click=${() => this.#schedule()}>${label("retry")}</wt-button>` : nothing}
      </div>
    </wt-data-table>`;
  }
  override render() {
    return html`<header>
        <wt-button
          variant="secondary"
          @click=${() => {
            this.#cancel();
            this.#emit("find-bill-back");
          }}
          >${label("back")}</wt-button
        >
        <h1>${t("find_bill.title")}</h1>
      </header>
      ${
        this.options
          ? html`<wt-tabs
              label=${t("find_bill.title")}
              .items=${[
                {
                  key: "bills",
                  label:
                    this.openCount === null
                      ? label("bills")
                      : `${label("bills")} · ${countText(this.openCount, "find_page.open_count", "find_page.open_count_one")}`,
                },
                { key: "transactions", label: label("transactions") },
              ]}
              .value=${this.tab}
              @wt-tab-change=${this.#selectTab}
              >${this.#table("bills")}${this.#table("transactions")}</wt-tabs
            >`
          : this.optionsError
            ? html`<p role="alert" class="error">${this.optionsError}</p>
                <wt-button @click=${() => this.#loadOptions()}>${label("retry")}</wt-button>`
            : html`<p role="status">${label("loading")}</p>`
      }`;
  }
}
