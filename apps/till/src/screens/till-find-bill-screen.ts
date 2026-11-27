import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import type { DataTableColumn, WtDataTable } from "@waitron/ui/src/components/wt-data-table.js";
import type { TillApi } from "../api/client.js";
import type { OpenInvoiceCorrection } from "../api/invoice-correction-types.js";
import type {
  BillRow,
  DateWindow,
  FindBillDates,
  FindBillOptions,
  TransactionRow,
  TransactionsQuery,
} from "../api/find-bill-types.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";

type Row = TransactionRow;
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
const methods = ["cash", "card", "voucher", "deferred", "other"] as const;
const types = [
  "sale",
  "full-invoice",
  "correction",
  "full-correction",
  "replacement",
  "refund",
] as const;
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
      .chips {
        padding-block: var(--wt-space-2);
      }
      .strip {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }
      .strip-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin: 0;
      }
    `,
  ];
  @property({ attribute: false }) api!: TillApi;
  @property({ type: Boolean }) active = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) backKey: "find_page.back" | "action.back" = "find_page.back";
  @state() private options?: FindBillOptions;
  @state() private optionsError = "";
  @state() private dates: FindBillDates = { preset: "today" };
  @state() private dateFrom = "";
  @state() private dateTo = "";
  @state() private dateInvalid = false;
  @state() private resolved: DateWindow = null;
  @state() private corrections: OpenInvoiceCorrection[] = [];
  @state() private correctionsError = false;
  #correctionsController?: AbortController;
  @state() private owed: BillRow[] = [];
  @state() private owedMore = false;
  @state() private owedLoading = false;
  @state() private owedError: "list" | "more" | null = null;
  #owedPage = 0;
  #owedController?: AbortController;
  #view: View = emptyView();
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
        this.#view = emptyView();
        this.optionsError = "";
        this.owed = [];
        this.owedMore = false;
        this.corrections = [];
      }
      if (this.active && this.api) {
        if (this.options) this.#read();
        else void this.#loadOptions();
      }
      void this.#loadCorrections();
      void this.#loadOwed();
    }
  }
  override disconnectedCallback(): void {
    this.#correctionsController?.abort();
    this.#owedController?.abort();
    this.#owedController = undefined;
    this.owedLoading = false;
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
      void this.#loadCorrections();
      void this.#loadOwed();
    }
  }
  async #loadOwed(more = false): Promise<void> {
    this.#owedController?.abort();
    this.#owedController = undefined;
    this.owedError = null;
    this.owedLoading = false;
    if (!this.active || !this.api) return;
    const page = more ? this.#owedPage + 1 : 0;
    const controller = (this.#owedController = new AbortController());
    this.owedLoading = true;
    try {
      const result = await this.api.listBills(
        {
          q: "",
          page,
          sort: { key: "openedAt", direction: "descending" },
          owed: true,
          counter: true,
        },
        { signal: controller.signal },
      );
      if (controller !== this.#owedController) return;
      const shown = new Set(more ? this.owed.map((row) => row.workingOrderId) : []);
      this.owed = [
        ...(more ? this.owed : []),
        ...result.rows.filter((row) => !shown.has(row.workingOrderId)),
      ];
      this.#owedPage = page;
      this.owedMore = (page + 1) * result.pageSize < result.total;
    } catch {
      if (controller !== this.#owedController) return;
      this.owedError = more ? "more" : "list";
      if (!more) {
        this.owed = [];
        this.owedMore = false;
      }
    } finally {
      if (controller === this.#owedController) this.owedLoading = false;
    }
  }
  #billText(row: BillRow, timeZone: string): string {
    const place =
      [
        ...new Set(
          [
            row.tables.join(", ") || (row.partyId === null ? t("station.counter") : ""),
            row.partyName,
            row.label,
          ].filter(Boolean),
        ),
      ].join(" · ") || `#${row.orderNumber}`;
    const money = (value: string) => formatMoney(value, currentLocale());
    if (row.partyId === null)
      return `#${row.orderNumber} · ${place} · ${label(row.state)} · ${money(row.total)}`;
    const left =
      row.departedAt === null
        ? []
        : [
            t("find_bill.left_on").replace(
              "{date}",
              new Date(row.departedAt).toLocaleDateString(currentLocale(), { timeZone }),
            ),
          ];
    return [place, ...left, t("find_bill.owes").replace("{amount}", money(row.stillOwed))].join(
      " · ",
    );
  }
  #owedFailure() {
    return html`<p role="alert" class="error">${label("load_failed")}</p>
      <wt-button
        variant="secondary"
        data-owed-retry
        @click=${() => void this.#loadOwed(this.owedError === "more")}
        >${label("retry")}</wt-button
      >`;
  }
  #billSections(timeZone: string) {
    if (this.owedError === "list")
      return html`<section class="strip" data-owed-error>
        <h2>${label("unpaid_and_counter_orders")}</h2>
        ${this.#owedFailure()}
      </section>`;
    const counter = this.owed.filter((row) => row.partyId === null);
    return html`${this.#billSection(
      this.owed.filter((row) => row.partyId !== null),
      "owed",
      t("find_bill.unpaid"),
      timeZone,
    )}${this.#billSection(counter, "counter", label("counter_orders"), timeZone)}${
      this.owedError === "more"
        ? html`<div class="strip">${this.#owedFailure()}</div>`
        : this.owedMore
          ? html`<div class="strip">
              <wt-button
                variant="secondary"
                data-owed-more
                ?loading=${this.owedLoading}
                @click=${() => void this.#loadOwed(true)}
                >${label("show_more")}</wt-button
              >
            </div>`
          : nothing
    }`;
  }
  #billSection(rows: BillRow[], attribute: string, heading: string, timeZone: string) {
    if (rows.length === 0) return nothing;
    return html`<section
      class="strip"
      ?data-owed=${attribute === "owed"}
      ?data-counter-orders=${attribute === "counter"}
    >
      <h2>${heading}</h2>
      ${rows.map(
        (row) =>
          html`<wt-button
            variant="secondary"
            align="start"
            data-bill=${row.workingOrderId}
            .disabled=${this.busy}
            @click=${() => this.#emit("find-bill-open", { row })}
            ><span class="strip-text">${this.#billText(row, timeZone)}</span></wt-button
          >`,
      )}
    </section>`;
  }
  async #loadCorrections(): Promise<void> {
    this.#correctionsController?.abort();
    this.#correctionsController = undefined;
    this.correctionsError = false;
    if (!this.active || !this.api) return;
    const controller = (this.#correctionsController = new AbortController());
    try {
      const corrections = await this.api.listInvoiceCorrections({ signal: controller.signal });
      if (controller === this.#correctionsController) this.corrections = corrections;
    } catch {
      if (controller === this.#correctionsController) this.correctionsError = true;
    }
  }
  /** Fills every placeholder in one pass, so a reason holding `{left}` or `$&` stays as typed. */
  #correctionRow(correction: OpenInvoiceCorrection, timeZone: string): string {
    const money = (value: string) => formatMoney(value, currentLocale());
    const values: Record<string, string> = {
      invoice: correction.invoiceNumber,
      when: new Date(correction.openedAt).toLocaleString(currentLocale(), { timeZone }),
      reason: correction.reason,
      left: money(correction.left),
      gross: money(correction.gross),
    };
    return label("correction_row").replace(
      /\{(\w+)\}/g,
      (match, key: string) => values[key] ?? match,
    );
  }
  #correctionsList(timeZone: string) {
    if (this.corrections.length === 0 && !this.correctionsError) return nothing;
    return html`<section class="strip" data-corrections>
      <h2>${label("corrections")}</h2>
      ${
        this.correctionsError
          ? html`<p role="alert" class="error">${label("load_failed")}</p>
              <wt-button
                variant="secondary"
                data-corrections-retry
                @click=${() => void this.#loadCorrections()}
                >${label("retry")}</wt-button
              >`
          : nothing
      }
      ${this.corrections.map(
        (correction) =>
          html`<wt-button
            variant="secondary"
            align="start"
            data-correction=${correction.id}
            .disabled=${this.busy}
            @click=${() => this.#emit("find-correction-open", { correction })}
            ><span class="strip-text" data-correction-text
              >${this.#correctionRow(correction, timeZone)}</span
            ></wt-button
          >`,
      )}
    </section>`;
  }
  #cancel(): void {
    this.#generation++;
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#view.loading = false;
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
  #query(event: CustomEvent<QueryDetail>): void {
    event.stopPropagation();
    const view = this.#view,
      previous = view.query;
    view.query = event.detail;
    if (JSON.stringify(previous) === JSON.stringify(view.query)) return;
    view.page = 0;
    if (!this.active) return;
    this.#schedule(previous !== undefined && previous.search !== view.query.search);
  }
  #schedule(debounce = false): void {
    this.#cancel();
    const view = this.#view;
    view.error = "";
    view.rows = [];
    if (!this.active || !view.query || this.dateInvalid) {
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
    const view = this.#view,
      query = view.query;
    if (!query || !this.active || !this.isConnected || this.dateInvalid) return;
    this.#cancel();
    const generation = this.#generation;
    const controller = (this.#controller = new AbortController());
    view.loading = true;
    view.error = "";
    view.rows = [];
    this.requestUpdate();
    const filter = (key: string) =>
      typeof query.filters[key] === "string" ? (query.filters[key] as string) : undefined;
    try {
      const result = await this.api.listTransactions(
        {
          q: query.search,
          page: view.page,
          sort: {
            key: query.sortKey || "when",
            direction: query.sortKey ? query.sortDirection : ("descending" as const),
          },
          ...(filter("staff") ? { staffId: filter("staff") } : {}),
          dates: this.dates,
          ...(filter("method") ? { method: filter("method") as TransactionsQuery["method"] } : {}),
          ...(filter("type") ? { type: filter("type") as TransactionsQuery["type"] } : {}),
        },
        { signal: controller.signal },
      );
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      const last = Math.max(0, Math.ceil(result.total / 50) - 1);
      if (view.page > last) {
        view.total = result.total;
        view.page = last;
        void this.#read();
        return;
      }
      view.rows = result.rows;
      view.total = result.total;
      this.resolved = result.dates;
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
    this.#view.page = 0;
    this.#schedule();
  }
  #clearFilters(event: Event): void {
    event.stopPropagation();
    this.dates = { preset: "any" };
    this.dateInvalid = false;
    this.resolved = null;
    this.#view.page = 0;
    const generation = this.#generation;
    void Promise.resolve()
      .then(() => this.#grid()?.updateComplete)
      .then(() => {
        if (generation === this.#generation && this.active) this.#schedule();
      });
  }
  #emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  #grid(): WtDataTable<Row> | null {
    return this.shadowRoot?.querySelector<WtDataTable<Row>>("wt-data-table") ?? null;
  }
  #columns(): DataTableColumn<Row>[] {
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
      ...(key === "when" ? {} : { choosable: "shown" }),
      ...extra,
    });
    const options = this.options!;
    const cell = (read: (row: TransactionRow) => unknown) => read;
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
        ?preserve-order=${true /* Preserve date-preset progression. */}
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
  /** The name starts with the chip's drawn text so it holds what is seen (WCAG 2.5.3). */
  #chip(key: string, text: string, remove: string, onClick: () => void) {
    return html`<wt-button
      variant="secondary"
      data-chip=${key}
      aria-label=${`${text}, ${remove}`}
      @click=${onClick}
      >${text} ×</wt-button
    >`;
  }
  #table() {
    const view = this.#view,
      columns = this.#columns();
    const chips = Object.entries(view.query?.filters ?? {});
    return html`<wt-data-table
      aria-label=${label("transactions")}
      viewKey="waitron.find-bill.transactions"
      searchable
      searchLabel=${label("search")}
      searchPlaceholder=${label("transaction_search")}
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
      .externalFilterCount=${this.dates.preset !== "any" ? 1 : 0}
      .rows=${view.rows}
      .columns=${columns}
      .rowKey=${(row: Row) => row.transactionId}
      .sortKey=${"when"}
      sortDirection="descending"
      .rowClickLabel=${() => label("open_receipt")}
      .rowActivation=${() => (!view.loading && this.active && !this.busy ? "click" : "none")}
      .rowClick=${(row: Row) => this.#emit("find-transaction-open", { row })}
      .loading=${view.loading}
      loadingMessage=${label("loading")}
      emptyMessage=${label("none")}
      errorMessage=${view.error}
      @wt-query-change=${(event: CustomEvent<QueryDetail>) => this.#query(event)}
      @wt-page-change=${(event: CustomEvent<{ page: number }>) => {
        event.stopPropagation();
        if (!view.loading) {
          view.page = event.detail.page;
          this.#schedule();
        }
      }}
      @wt-filters-clear=${(event: Event) => this.#clearFilters(event)}
    >
      ${this.#dateControls()}
      <div slot="toolbar-bottom" class="chips">
        ${this.dates.preset !== "any" ? this.#chip("dates", `${label(this.dates.preset)}${!this.dateInvalid && this.resolved ? ` · ${this.resolved.from} – ${this.resolved.to}` : ""}`, label("remove_dates"), () => this.#setDates("any")) : nothing}
        ${chips.map(([key, value]) => this.#chip(key, `${label(key)}: ${columns.find((c) => c.key === key)?.filter?.options.find((o) => o.value === value)?.label ?? value}`, label("remove_filter").replace("{filter}", label(key)), () => this.#grid()?.chooseFilter(key, [])))}
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
          >${t(this.backKey)}</wt-button
        >
        <h1>${t("find_bill.title")}</h1>
      </header>
      ${this.options ? this.#correctionsList(this.options.timeZone) : nothing}
      ${this.options ? this.#billSections(this.options.timeZone) : nothing}
      ${
        this.options
          ? this.#table()
          : this.optionsError
            ? html`<p role="alert" class="error">${this.optionsError}</p>
                <wt-button @click=${() => this.#loadOptions()}>${label("retry")}</wt-button>`
            : html`<p role="status">${label("loading")}</p>`
      }`;
  }
}
