import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { actionChoiceStyles } from "@waitron/ui/src/components/wt-row-actions.js";
import type { TillApi } from "../api/client.js";
import type { OpenInvoiceCorrection } from "../api/invoice-correction-types.js";
import type {
  BillRow,
  FindBillDates,
  FindBillOptions,
  TransactionRow,
  TransactionsPage,
} from "../api/find-bill-types.js";
import { countText, currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { findBillRow, findBillRowStyles } from "./find-bill-row.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-menu-row.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-top-bar.js";

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
const dayText = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString(currentLocale(), { timeZone: "UTC" });

@customElement("till-find-bill-screen")
export class TillFindBillScreen extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    actionChoiceStyles,
    findBillRowStyles,
    css`
      :host {
        display: block;
        block-size: 100%;
        min-width: 0;
        color: var(--wt-color-text);
      }
      .band {
        display: grid;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
        background: var(--wt-color-surface);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .days::part(trigger) {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        min-height: var(--wt-tap-min);
        padding-inline: var(--wt-space-3);
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      .days [slot="trigger"] {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
      }
      .dates {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .sections {
        padding: var(--wt-space-3) var(--wt-space-4) 0;
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
      .order {
        margin: 0;
        padding: var(--wt-space-3) var(--wt-space-4) calc(var(--wt-space-1) + var(--wt-space-1) / 2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .state {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-4);
      }
      .state p {
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
  @state() private search = "";
  @state() private rows: TransactionRow[] = [];
  /** The count the answer to the current search and days gave; null until it arrives. */
  @state() private found: number | null = null;
  @state() private more = false;
  @state() private listLoading: "list" | "more" | null = null;
  @state() private listError: "list" | "more" | null = null;
  #page = 0;
  #opened?: string;
  @state() private corrections: OpenInvoiceCorrection[] = [];
  @state() private correctionsError = false;
  #correctionsController?: AbortController;
  @state() private owed: BillRow[] = [];
  @state() private owedMore = false;
  @state() private owedLoading = false;
  @state() private owedError: "list" | "more" | null = null;
  #owedPage = 0;
  #owedController?: AbortController;
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
        this.rows = [];
        this.#page = 0;
        this.found = null;
        this.more = false;
        this.listError = null;
        this.optionsError = "";
        this.owed = [];
        this.owedMore = false;
        this.corrections = [];
      }
      if (this.active && this.api) {
        if (this.options) void this.#reread();
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
      if (this.options) void this.#reread();
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
    this.listLoading = null;
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
      void this.#read();
    } catch {
      if (generation === this.#optionsGeneration && this.active && this.isConnected)
        this.optionsError = label("load_failed");
    }
  }
  #schedule(debounce = false): void {
    this.#cancel();
    this.listError = null;
    this.rows = [];
    this.found = null;
    this.#page = 0;
    this.#opened = undefined;
    if (!this.active || !this.options || this.dateInvalid) return;
    this.listLoading = "list";
    if (debounce)
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.#read();
      }, 200);
    else void this.#read();
  }
  async #read(more = false): Promise<void> {
    if (!this.options || !this.active || !this.isConnected || this.dateInvalid) return;
    this.#cancel();
    const generation = this.#generation;
    const controller = (this.#controller = new AbortController());
    const page = more ? this.#page + 1 : 0;
    this.listError = null;
    this.listLoading = more ? "more" : "list";
    if (!more) {
      this.rows = [];
      this.found = null;
      this.#page = 0;
      this.#opened = undefined;
    }
    try {
      const result = await this.#readPage(page, controller.signal);
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      this.#take(result, page, more ? this.rows : []);
    } catch {
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      this.listError = more ? "more" : "list";
    } finally {
      if (generation === this.#generation) this.listLoading = null;
    }
  }
  /** Reads every page shown before again, in turn, so a return to the screen keeps staff's place. */
  async #reread(): Promise<void> {
    if (!this.options || !this.active || !this.isConnected || this.dateInvalid) return;
    this.#cancel();
    const generation = this.#generation;
    const controller = (this.#controller = new AbortController());
    const through = this.#page;
    this.listError = null;
    this.listLoading = "list";
    this.rows = [];
    this.found = null;
    const read: { result: TransactionsPage; page: number }[] = [];
    let failed = false;
    try {
      for (let page = 0; page <= through; page++) {
        const result = await this.#readPage(page, controller.signal);
        if (generation !== this.#generation || !this.active || !this.isConnected) return;
        read.push({ result, page });
        if ((page + 1) * result.pageSize >= result.total) break;
      }
    } catch {
      if (generation !== this.#generation || !this.active || !this.isConnected) return;
      failed = true;
    } finally {
      if (generation === this.#generation) this.listLoading = null;
    }
    // A visit ended part-way leaves #page alone, so the next visit reads the same pages again.
    for (const { result, page } of read) this.#take(result, page, this.rows);
    if (failed) this.listError = read.length === 0 ? "list" : "more";
    void this.#showOpened();
  }
  /** The reread draws the list from empty, losing its scroll position and the sale staff opened. */
  async #showOpened(): Promise<void> {
    const opened = this.#opened;
    this.#opened = undefined;
    if (opened === undefined) return;
    await this.updateComplete;
    const button = this.renderRoot.querySelector<HTMLElement>(
      `button[data-transaction="${CSS.escape(opened)}"]`,
    );
    if (button === null) return;
    button.scrollIntoView({ block: "center" });
    if (document.activeElement === document.body) button.focus({ preventScroll: true });
  }
  #readPage(page: number, signal: AbortSignal) {
    return this.api.listTransactions({ q: this.search, page, dates: this.dates }, { signal });
  }
  #take(result: TransactionsPage, page: number, shown: TransactionRow[]): void {
    // Paging is by offset, so a sale recorded between reads would come back a second time.
    const held = new Set(shown.map((row) => row.transactionId));
    this.rows = [...shown, ...result.rows.filter((row) => !held.has(row.transactionId))];
    this.found = result.total;
    this.#page = page;
    this.more = (page + 1) * result.pageSize < result.total;
  }
  #onSearch(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (event.detail.value === this.search) return;
    this.search = event.detail.value;
    this.#schedule(true);
  }
  #setDates(preset: FindBillDates["preset"]): void {
    if (preset === this.dates.preset) return;
    this.dates =
      preset === "custom" ? { preset, from: this.dateFrom, to: this.dateTo } : { preset };
    this.#dateChanged();
  }
  #dateChanged(): void {
    this.dateInvalid =
      this.dates.preset === "custom" &&
      (!validDate(this.dateFrom) || !validDate(this.dateTo) || this.dateFrom > this.dateTo);
    if (this.dates.preset === "custom")
      this.dates = { preset: "custom", from: this.dateFrom, to: this.dateTo };
    this.#schedule();
  }
  #emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  get #searching(): boolean {
    return this.search.trim() !== "";
  }
  #subtitle(): string {
    if (this.#searching && this.found !== null)
      return countText(this.found, "find_page.found", "find_page.found_one");
    if (this.dates.preset !== "custom") return label(`paid_${this.dates.preset}`);
    if (this.dateInvalid) return label("custom");
    return fill(label("paid_custom"), { from: dayText(this.dateFrom), to: dayText(this.dateTo) });
  }
  #daysChip() {
    const chosen = this.dates.preset;
    return html`<wt-row-actions
      class="days"
      data-days
      bottom-sheet
      sheet-variant="menu"
      label=${fill(label("days_chip"), { dates: label(chosen) })}
      sheet-heading=${label("dates")}
    >
      <span slot="trigger"
        >${label(chosen)}<wt-icon name="chevron-down" aria-hidden="true"></wt-icon
      ></span>
      <div role="menu" aria-label=${label("dates")}>
        ${presets.map(
          (preset) =>
            html`<button
              type="button"
              role="menuitemradio"
              data-row-choice
              data-preset=${preset}
              aria-checked=${preset === chosen ? "true" : "false"}
              @click=${() => this.#setDates(preset)}
            >
              <wt-menu-row label=${label(preset)} .check=${preset === chosen}></wt-menu-row>
            </button>`,
        )}
      </div>
    </wt-row-actions>`;
  }
  #dateFields() {
    if (this.dates.preset !== "custom") return nothing;
    const field = (name: "from" | "to", value: string) =>
      html`<wt-input
        name=${name}
        type="date"
        label=${label(name)}
        required
        .value=${value}
        .error=${this.dateInvalid ? label("invalid_dates") : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (name === "from") this.dateFrom = event.detail.value;
          else this.dateTo = event.detail.value;
          this.#dateChanged();
        }}
      ></wt-input>`;
    return html`<div class="dates">
      ${field("from", this.dateFrom)} ${field("to", this.dateTo)}
      ${this.dateInvalid ? html`<p class="error" role="alert">${label("invalid_dates")}</p>` : nothing}
    </div>`;
  }
  #header() {
    return html`<div slot="header">
      <wt-top-bar
        .heading=${t("find_bill.title")}
        .subtitle=${this.#subtitle()}
        .backLabel=${t(this.backKey)}
        @wt-back=${() => {
          this.#cancel();
          this.#emit("find-bill-back");
        }}
      ></wt-top-bar>
      <div class="band">
        <wt-input
          name="search"
          type="search"
          variant="outlined"
          label=${label("transaction_search")}
          placeholder=${label("transaction_search")}
          autocapitalize="none"
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSearch(event)}
          ><wt-icon slot="start" name="search" aria-hidden="true"></wt-icon
        ></wt-input>
        <div class="chips">${this.#daysChip()}</div>
        ${this.#dateFields()}
      </div>
    </div>`;
  }
  #orderLabel(): string {
    if (this.rows[0]?.amountMatch === "amount") return label("amount_match");
    return this.#searching ? label("best_match") : label("newest_first");
  }
  #list(timeZone: string) {
    const failure = (more: boolean) =>
      html`<div class="state" data-list-error>
        <p role="alert" class="error">${label("load_failed")}</p>
        <wt-button variant="secondary" data-list-retry @click=${() => void this.#read(more)}
          >${label("retry")}</wt-button
        >
      </div>`;
    if (this.listError === "list") return failure(false);
    if (this.listLoading === "list")
      return html`<p class="state" role="status" data-list-loading>${label("loading")}</p>`;
    if (this.rows.length === 0)
      return this.dateInvalid
        ? nothing
        : html`<p class="state" data-list-empty>${label("none")}</p>`;
    const disabled = this.busy || !this.active;
    return html`<p class="order" data-order-label>${this.#orderLabel()}</p>
      <div data-transactions>
        ${this.rows.map((row) =>
          findBillRow(row, {
            timeZone,
            disabled,
            open: () => {
              if (!this.busy && this.active) {
                this.#opened = row.transactionId;
                this.#emit("find-transaction-open", { row });
              }
            },
          }),
        )}
      </div>
      ${
        this.listError === "more"
          ? failure(true)
          : this.more
            ? html`<div class="state">
                <wt-button
                  variant="secondary"
                  data-list-more
                  ?loading=${this.listLoading === "more"}
                  @click=${() => {
                    if (this.listLoading === null) void this.#read(true);
                  }}
                  >${label("show_more")}</wt-button
                >
              </div>`
            : nothing
      }`;
  }
  #body() {
    const options = this.options;
    if (!options)
      return this.optionsError
        ? html`<div class="state">
            <p role="alert" class="error">${this.optionsError}</p>
            <wt-button data-options-retry @click=${() => this.#loadOptions()}
              >${label("retry")}</wt-button
            >
          </div>`
        : html`<p class="state" role="status">${label("loading")}</p>`;
    return html`${
      this.#searching
        ? nothing
        : html`<div class="sections">
            ${this.#correctionsList(options.timeZone)}${this.#billSections(options.timeZone)}
          </div>`
    }
    ${this.#list(options.timeZone)}`;
  }
  override render() {
    return html`<wt-full-screen-panel .bodyLabel=${t("find_bill.title")}>
      ${this.#header()} ${this.#body()}
    </wt-full-screen-panel>`;
  }
}
