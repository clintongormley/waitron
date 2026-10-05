import { ContentLanguageController } from "@waitron/ui";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { metricStyles, renderMetric } from "../widgets/metric-row.js";
import { sourceLabel } from "../widgets/alert-format.js";
import {
  renderTopSellers,
  topSellersStyles,
  type TopSellersLabels,
} from "../widgets/top-sellers-table.js";
import type {
  CashUpDto,
  CategoryReportMode,
  CategorySalesDto,
  CategoryTotalDto,
  DailyCloseDto,
  DashboardApi,
  ReportPrinter,
  SalesPeriodDto,
  VatSummaryDto,
} from "../api/client.js";
import { today } from "../date-utils.js";
import { PATH_SEPARATOR } from "../widgets/classification-fields.js";

const money = (value: string): string => formatMoney(value, currentLocale());

interface CategoryRow {
  kind: CategoryTotalDto["kind"] | "direct";
  label: string;
  /** The ancestors' names, before the row's own. */
  path: string[];
  /** A category's ancestors are its path and are shown; Not recorded is no category, so under it
   * they are only read out. */
  pathShown: boolean;
  depth: number;
  gross: string;
  net: string;
  parent: boolean;
}

function fill(template: string, key: string, value: string): string {
  // A function replacement, so a `$&` in a category or printer name is not read as a pattern.
  return template.replace(`{${key}}`, () => value);
}

/**
 * A single day (`from === to`) shows the full daily close; a range shows a period roll-up of VAT and
 * top sellers only, because the per-device cash-up does not roll up across days. A `from > to`
 * range is left for the server to reject. The category report follows either range, and is not
 * asked for over a backwards one, whose refusal the banner already shows.
 */
@customElement("dashboard-sales-screen")
export class SalesScreen extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    metricStyles,
    topSellersStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      h2 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text-muted);
      }
      .pickers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-4);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-2);
        text-align: left;
      }
      th.num,
      td.num {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
      }
      .metric {
        display: flex;
        gap: var(--wt-space-2);
        color: var(--wt-color-text);
      }
      .muted {
        color: var(--wt-color-text-muted);
        margin-top: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .category-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin-bottom: var(--wt-space-2);
        color: var(--wt-color-text);
      }
      fieldset {
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--wt-space-4);
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--wt-space-1);
      }
      .choice {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      .choice input {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      th.cat-name {
        padding-inline-start: calc(var(--wt-space-2) + var(--depth, 0) * var(--wt-space-4));
        overflow-wrap: anywhere;
      }
      /* The name column takes the spare width, so the amounts sit together at the right. */
      th.name-col {
        width: 100%;
      }
      tr.direct th,
      tr.leaf th {
        font-weight: var(--wt-font-weight-normal);
      }
      tr.direct th {
        font-style: italic;
      }
      .path {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-normal);
      }
      .warning {
        margin: var(--wt-space-2) 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .print {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin-top: var(--wt-space-4);
      }
      .print wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
    (error) => {
      if (this.errorKey === codeOf(error)) this.errorKey = null;
      // Released here rather than in its own apply, which would stop this callback from firing.
      if (this.#rangeChosen) this.#queries.release("getSalesOverview");
      else void this.#loadInitialRange();
    },
  );

  // The category report and the printer list keep their own errors, so a refused current report
  // explains itself beside the report and leaves the close or period on screen.
  readonly #categoryQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.categories = null;
      this.categoryErrorKey = codeOf(error);
    },
  );
  readonly #printerQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.printersErrorKey = codeOf(error);
    },
  );

  @state() private from = today();
  @state() private to = today();
  @state() private close: DailyCloseDto | null = null;
  @state() private period: SalesPeriodDto | null = null;
  @state() private errorKey: string | null = null;
  @state() private mode: CategoryReportMode = "at_time_of_sale";
  @state() private extrasIntoDish = false;
  @state() private categories: CategorySalesDto | null = null;
  @state() private categoryErrorKey: string | null = null;
  @state() private printers: ReportPrinter[] | null = null;
  @state() private printerId: string | null = null;
  @state() private printing = false;
  @state() private printSentTo: string | null = null;
  @state() private printErrorKey: string | null = null;
  @state() private printersErrorKey: string | null = null;
  #rangeChosen = false;
  /** Bumped on every new category question, so a print sent for an earlier one reports nothing. */
  #categoryGeneration = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadCategories();
    void this.#loadInitialRange();
    void this.#printerQueries
      .watch("getReportPrinters", [], (value) => {
        this.printers = value;
        this.printersErrorKey = null;
        if (!value.some((printer) => printer.id === this.printerId)) {
          this.printerId = value[0]?.id ?? null;
        }
      })
      .catch(() => {
        // The query's error callback has already recorded the code.
      });
  }

  #rangeRunsBackwards(): boolean {
    return this.from > this.to;
  }

  async #loadInitialRange(): Promise<void> {
    if (this.#rangeChosen) return;
    try {
      await this.#queries.watch("getSalesOverview", [], ({ businessDay }) => {
        if (this.#rangeChosen) return;
        this.#rangeChosen = true;
        if (this.from === businessDay && this.to === businessDay) return;
        this.from = businessDay;
        this.to = businessDay;
        void this.#load();
        void this.#loadCategories();
      });
    } catch {
      // The query's error callback has already recorded the code; the read stays watched so it is
      // retried, and the recovery callback releases it.
      return;
    }
    this.#queries.release("getSalesOverview");
  }

  /** Cleared before the request, like `#load`, so a refusal never sits beside an older report. */
  async #loadCategories(): Promise<void> {
    this.#categoryGeneration += 1;
    this.categories = null;
    this.categoryErrorKey = null;
    this.printSentTo = null;
    this.printErrorKey = null;
    if (this.#rangeRunsBackwards()) {
      this.#categoryQueries.release("getCategorySales");
      return;
    }
    await this.#categoryQueries
      .watch("getCategorySales", [this.from, this.to, this.mode, this.extrasIntoDish], (value) => {
        this.categories = value;
        this.categoryErrorKey = null;
      })
      .catch(() => {
        // The query's error callback has already recorded the code.
      });
  }

  #onModeChange(mode: CategoryReportMode, event: Event): void {
    event.stopPropagation();
    this.mode = mode;
    void this.#loadCategories();
  }

  #onExtrasChange(event: Event): void {
    event.stopPropagation();
    this.extrasIntoDish = (event.target as HTMLInputElement).checked;
    void this.#loadCategories();
  }

  #onPrinterChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.printerId = event.detail.value;
  }

  async #print(): Promise<void> {
    const printer = this.printers?.find((p) => p.id === this.printerId);
    if (printer === undefined || this.printing) return;
    this.printing = true;
    this.printSentTo = null;
    this.printErrorKey = null;
    const generation = this.#categoryGeneration;
    try {
      await this.api.printCategorySales({
        from: this.from,
        to: this.to,
        mode: this.mode,
        extrasIntoDish: this.extrasIntoDish,
        printerId: printer.id,
      });
      if (generation === this.#categoryGeneration) this.printSentTo = printer.name;
    } catch (error) {
      if (generation === this.#categoryGeneration) this.printErrorKey = codeOf(error);
    } finally {
      this.printing = false;
    }
  }

  /** BOTH branches' state is cleared before the request, so a rejection can never leave a stale close
   * or period rendering beside the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.close = null;
    this.period = null;
    try {
      if (this.from === this.to) {
        this.#queries.release("getSalesPeriod");
        await this.#queries.watch("getDailyClose", [this.from], (value) => {
          this.close = value;
        });
      } else {
        this.#queries.release("getDailyClose");
        await this.#queries.watch("getSalesPeriod", [this.from, this.to], (value) => {
          this.period = value;
        });
      }
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onDateChange(field: "from" | "to", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    // A date field reads "" while cleared or part-typed, which builds an Invalid Date → NaN; ignore
    // it rather than reloading with a bogus window.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.#rangeChosen = true;
    this[field] = value;
    void this.#load();
    void this.#loadCategories();
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("sales.title")}</h1>
      <div class="pickers">
        <wt-input
          type="date"
          name="from"
          data-test="from-picker"
          label=${t("sales.from")}
          .value=${this.from}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDateChange("from", e)}
        ></wt-input>
        <wt-input
          type="date"
          name="to"
          data-test="to-picker"
          label=${t("sales.to")}
          .value=${this.to}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDateChange("to", e)}
        ></wt-input>
      </div>
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${this.close ? this.#renderClose(this.close) : nothing}
      ${this.period ? this.#renderPeriod(this.period) : nothing}
      ${this.#rangeRunsBackwards() ? nothing : this.#renderCategories()}
    `;
  }

  #renderCategories(): TemplateResult {
    const heading =
      this.mode === "current"
        ? t("sales.categories_current")
        : t("sales.categories_at_time_of_sale");
    return html`
      <section data-test="categories" aria-labelledby="categories-heading">
        <h2 id="categories-heading" data-test="categories-heading">${heading}</h2>
        <div class="category-controls">
          <fieldset>
            <legend>${t("sales.categories_mode")}</legend>
            ${(["at_time_of_sale", "current"] as const).map(
              (mode) =>
                html`<label class="choice">
                  <input
                    type="radio"
                    name="mode"
                    value=${mode}
                    .checked=${this.mode === mode}
                    @change=${(e: Event) => this.#onModeChange(mode, e)}
                  />
                  ${t(mode === "current" ? "sales.mode_current" : "sales.mode_at_time_of_sale")}
                </label>`,
            )}
          </fieldset>
          <label class="choice">
            <input
              type="checkbox"
              name="extrasIntoDish"
              data-test="extras-into-dish"
              .checked=${this.extrasIntoDish}
              @change=${(e: Event) => this.#onExtrasChange(e)}
            />
            ${t("sales.extras_into_dish")}
          </label>
        </div>
        ${
          this.categoryErrorKey
            ? html`<p class="error" role="alert" data-test="categories-error">
                ${codeMessage(this.categoryErrorKey)}
              </p>`
            : nothing
        }
        ${this.categories ? this.#renderCategoryReport(this.categories) : nothing}
        ${this.#renderPrint()}
      </section>
    `;
  }

  #renderCategoryReport(report: CategorySalesDto): TemplateResult {
    if (report.tree.length === 0) {
      return html`<p class="muted" data-test="categories-empty">${t("sales.empty_sellers")}</p>`;
    }
    const rows = report.tree.flatMap((node) => this.#categoryRows(node, []));
    return html`
      ${
        report.grossComplete
          ? nothing
          : html`<p class="warning" id="gross-incomplete" data-test="gross-incomplete">
              ${
                report.linesWithoutGross === 1
                  ? t("sales.gross_incomplete_one")
                  : fill(t("sales.gross_incomplete"), "count", String(report.linesWithoutGross))
              }
            </p>`
      }
      <table data-test="category-table">
        <thead>
          <tr>
            <th scope="col" class="name-col">${t("sales.category")}</th>
            <th scope="col" class="num">${t("sales.gross")}</th>
            <th scope="col" class="num">${t("sales.net")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) =>
              html`<tr
                data-test="category-row"
                data-depth=${row.depth}
                data-kind=${row.kind}
                class=${row.kind === "direct" ? "direct" : row.parent ? "parent" : "leaf"}
              >
                <th scope="row" class="cat-name" style="--depth: ${row.depth}">
                  ${
                    row.path.length === 0
                      ? nothing
                      : row.pathShown
                        ? html`<span class="path" data-test="category-path"
                            >${row.path.join(PATH_SEPARATOR)}${PATH_SEPARATOR}</span
                          >`
                        : html`<span class="visually-hidden"
                            >${row.path.join(PATH_SEPARATOR)}${PATH_SEPARATOR}</span
                          >`
                  }<span data-test="category-label">${row.label}</span>
                </th>
                <td class="num" data-test="category-gross">${money(row.gross)}</td>
                <td class="num" data-test="category-net">${money(row.net)}</td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">${t("sales.total")}</th>
            <td
              class="num"
              data-test="category-total-gross"
              aria-describedby=${report.grossComplete ? nothing : "gross-incomplete"}
            >
              ${money(report.gross)}
            </td>
            <td class="num" data-test="category-total-net">${money(report.net)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  #categoryName(node: CategoryTotalDto): string {
    if (node.kind === "uncategorised") return t("sales.uncategorised");
    if (node.kind === "not_recorded") return t("sales.not_recorded");
    return node.name;
  }

  /** Depth first; before a parent's children, the part of it no child accounts for, when it has one. */
  #categoryRows(node: CategoryTotalDto, path: string[]): CategoryRow[] {
    const name = this.#categoryName(node);
    const parent = node.children.length > 0;
    const rows: CategoryRow[] = [
      {
        kind: node.kind,
        label: name,
        path,
        pathShown: node.kind === "category",
        depth: node.depth,
        gross: node.gross,
        net: node.net,
        parent,
      },
    ];
    const inside = [...path, name];
    if (parent && node.direct.lines > 0) {
      const category = node.kind !== "not_recorded";
      rows.push({
        kind: "direct",
        label: category
          ? fill(t("sales.directly_in"), "name", inside.join(PATH_SEPARATOR))
          : t("sales.no_category_recorded"),
        path: category ? [] : inside,
        pathShown: false,
        depth: node.depth + 1,
        gross: node.direct.gross,
        net: node.direct.net,
        parent: false,
      });
    }
    for (const child of node.children) rows.push(...this.#categoryRows(child, inside));
    return rows;
  }

  #renderPrint(): TemplateResult {
    const printers = this.printers ?? [];
    return html`
      <div class="print">
        ${
          printers.length > 0
            ? html`<wt-combobox
                name="printerId"
                data-test="print-printer"
                label=${t("sales.printer")}
                search="auto"
                searchPlaceholder=${t("categories.combobox_search")}
                noResultsLabel=${t("categories.combobox_no_results")}
                .options=${printers.map((printer) => ({ value: printer.id, label: printer.name }))}
                .value=${this.printerId ?? ""}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPrinterChange(e)}
              ></wt-combobox>`
            : nothing
        }
        <wt-button
          variant="secondary"
          data-test="print-categories"
          ?disabled=${printers.length === 0}
          ?loading=${this.printing}
          @click=${() => void this.#print()}
          >${t("sales.print_categories")}</wt-button
        >
      </div>
      ${
        this.printers !== null && printers.length === 0
          ? html`<p class="muted" data-test="no-printers">${t("sales.no_printers")}</p>`
          : nothing
      }
      ${
        this.printSentTo === null
          ? nothing
          : html`<p class="muted" role="status" data-test="print-status">
              ${fill(t("sales.print_sent"), "printer", this.printSentTo)}
            </p>`
      }
      ${
        this.printErrorKey
          ? html`<p class="error" role="alert" data-test="print-error">
              ${codeMessage(this.printErrorKey)}
            </p>`
          : nothing
      }
      ${
        this.printersErrorKey
          ? html`<p class="error" role="alert" data-test="printers-error">
              ${codeMessage(this.printersErrorKey)}
            </p>`
          : nothing
      }
    `;
  }

  #renderClose(close: DailyCloseDto): TemplateResult {
    return html`
      <div data-test="daily-close">
        ${this.#renderTender(close.cash)} ${this.#renderVat(close.vat)}
        <h2>${t("sales.counts_title")}</h2>
        <div class="counts" data-test="counts">
          ${renderMetric(t("sales.sales"), String(close.counts.sales), "count-sales")}
          ${renderMetric(t("sales.corrections"), String(close.counts.corrections), "count-corrections")}
          ${renderMetric(t("sales.voids"), String(close.counts.voids), "count-voids")}
        </div>
        <h2>${t("sales.top_sellers_title")}</h2>
        ${renderTopSellers(close.topSellers, this.#topSellerLabels())}
      </div>
    `;
  }

  #renderPeriod(period: SalesPeriodDto): TemplateResult {
    return html`
      <div data-test="period">
        ${this.#renderVat(period.vat)}
        <h2>${t("sales.top_sellers_title")}</h2>
        ${renderTopSellers(period.topSellers, this.#topSellerLabels())}
        <p class="muted" data-test="period-note">${t("sales.period_note")}</p>
      </div>
    `;
  }

  #renderTender(cash: CashUpDto): TemplateResult {
    return html`
      <h2>${t("sales.tender_title")}</h2>
      <table data-test="tender-table">
        <thead>
          <tr>
            <th scope="col">${t("sales.device")}</th>
            <th scope="col">${t("sales.method")}</th>
            <th scope="col" class="num">${t("sales.amount")}</th>
            <th scope="col" class="num">${t("sales.tip")}</th>
          </tr>
        </thead>
        <tbody>
          ${cash.byOrigin.map((origin) =>
            origin.byMethod.map(
              (line) =>
                html`<tr
                  data-test=${`tender-row-${origin.deviceId ?? origin.source}-${line.method}`}
                >
                  <th scope="row">${sourceLabel(origin)}</th>
                  <td>${line.method}</td>
                  <td class="num">${money(line.amount)}</td>
                  <td class="num">${money(line.tip)}</td>
                </tr>`,
            ),
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="2">${t("sales.tender_total")}</th>
            <td class="num" data-test="tender-total">${money(cash.tenderTotal)}</td>
            <td class="num" data-test="tip-total">${money(cash.tipTotal)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  #renderVat(vat: VatSummaryDto): TemplateResult {
    return html`
      <h2>${t("sales.vat_title")}</h2>
      <table data-test="vat-table">
        <thead>
          <tr>
            <th scope="col">${t("sales.rate")}</th>
            <th scope="col" class="num">${t("sales.base")}</th>
            <th scope="col" class="num">${t("sales.tax")}</th>
          </tr>
        </thead>
        <tbody>
          ${vat.byRate.map(
            (row) =>
              html`<tr data-test=${`vat-row-${row.rate}`}>
                <th scope="row">${row.rate}</th>
                <td class="num">${money(row.base)}</td>
                <td class="num">${money(row.tax)}</td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">${t("sales.base_total")}</th>
            <td class="num" data-test="vat-base-total">${money(vat.baseTotal)}</td>
            <td class="num" data-test="vat-tax-total">${money(vat.taxTotal)}</td>
          </tr>
          <tr>
            <th scope="row" colspan="2">${t("sales.gross_total")}</th>
            <td class="num" data-test="vat-gross-total">${money(vat.grossTotal)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  /** This screen's `sales.*` labels for the shared top-sellers table (the namespace is deliberately
   * not shared with the overview's `overview.*` keys). */
  #topSellerLabels(): TopSellersLabels {
    return {
      title: t("sales.top_sellers_title"),
      quantity: t("sales.quantity"),
      total: t("sales.total"),
      empty: t("sales.empty_sellers"),
      emptyTest: "empty",
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-sales-screen": SalesScreen;
  }
}
