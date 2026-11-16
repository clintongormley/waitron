import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  UrlStateController,
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
import {
  TAX_OFFICE_KINDS,
  type DashboardApi,
  type TaxOfficeCursor,
  type TaxOfficeInvoiceDto,
  type TaxOfficeKind,
  type TaxOfficeQuery,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { dashboardPath } from "../navigation.js";
import { pdfFileName } from "../widgets/order-detail-dialog.js";

type Filter = Omit<TaxOfficeQuery, "after">;
type TextField = "q" | "rate" | "amount";
type Row =
  | { key: string; invoice: TaxOfficeInvoiceDto; vat?: TaxOfficeInvoiceDto["vat"][number] }
  | { key: string; parent: string; vat: TaxOfficeInvoiceDto["vat"][number] };

const FILTER_KEYS = [
  "from",
  "to",
  "q",
  "rate",
  "amount",
  "operationFrom",
  "operationTo",
  "kind",
] as const satisfies readonly (keyof Filter)[];
const FIELD_OF: Record<string, { control: string; message: StringKey }> = {
  from: { control: "from", message: "tax_office.refused.date" },
  to: { control: "to", message: "tax_office.refused.date" },
  range: { control: "to", message: "tax_office.refused.range" },
  operationFrom: { control: "operationFrom", message: "tax_office.refused.date" },
  operationTo: { control: "operationTo", message: "tax_office.refused.date" },
  operationRange: { control: "operationTo", message: "tax_office.refused.operation_range" },
  q: { control: "q", message: "tax_office.refused.search" },
  rate: { control: "rate", message: "tax_office.refused.rate" },
  amount: { control: "amount", message: "tax_office.refused.amount" },
  kind: { control: "kind", message: "tax_office.refused.kind" },
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The current month on the browser's own calendar. */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    from: day(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: day(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function rowsOf(invoices: readonly TaxOfficeInvoiceDto[]): Row[] {
  return invoices.flatMap((invoice): Row[] =>
    invoice.vat.length === 1
      ? [{ key: invoice.id, invoice, vat: invoice.vat[0] }]
      : [
          { key: invoice.id, invoice },
          ...invoice.vat.map((vat, index) => ({
            key: `${invoice.id}:${index}`,
            parent: invoice.id,
            vat,
          })),
        ],
  );
}

/** Every invoice the venue issued, for the tax office: find, open, download and print any one. */
@customElement("dashboard-tax-office-screen")
export class TaxOfficeScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
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
      .action-error {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-danger);
      }
      .more {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      wt-data-table::part(number) {
        display: block;
      }
      wt-data-table::part(mark) {
        display: block;
        white-space: normal;
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(cancelled) {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private filter: Filter = currentMonth();
  @state() private invoices: TaxOfficeInvoiceDto[] = [];
  @state() private next: TaxOfficeCursor | null = null;
  @state() private timeZone = "UTC";
  @state() private loading = true;
  @state() private loadingMore = false;
  /** A read's refusal: beside the field it names, or the table's load message when it names none. */
  @state() private refusal: { field: string | null; message: string } | null = null;
  @state() private moreError = "";
  /** An Open that failed; kept apart from a read's message so neither clears the other. */
  @state() private actionError = "";
  @state() private opening: ReadonlySet<string> = new Set();
  #read = 0;
  /** The filter of the read last sent, so the address change an apply writes does not send it twice. */
  #requested?: string;
  #textTimer?: ReturnType<typeof setTimeout>;
  /** The filter the listed rows answer; a half-typed range must not change what the next page reads. */
  #shown?: Filter;

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "invoices") return;
      this.filter = this.#readAddress();
      void this.#load();
    },
    dashboardPath,
  );

  override disconnectedCallback(): void {
    clearTimeout(this.#textTimer);
    this.#read++;
    this.#requested = undefined;
    super.disconnectedCallback();
  }

  #readAddress(): Filter {
    const read = (key: keyof Filter) => {
      const value = this.#url.read(key)?.trim();
      return value === undefined || value === "" ? undefined : value;
    };
    const from = read("from");
    const to = read("to");
    const kind = read("kind");
    const filter: Filter =
      from !== undefined && to !== undefined && DAY.test(from) && DAY.test(to)
        ? { from, to }
        : currentMonth();
    for (const key of ["q", "rate", "amount", "operationFrom", "operationTo"] as const) {
      const value = read(key);
      if (value !== undefined) filter[key] = value;
    }
    if ((TAX_OFFICE_KINDS as readonly string[]).includes(kind ?? ""))
      filter.kind = kind as TaxOfficeKind;
    return filter;
  }

  #apply(next: Filter, force = false): void {
    this.filter = next;
    this.#url.write(Object.fromEntries(FILTER_KEYS.map((key) => [key, next[key] ?? null])));
    void this.#load(force);
  }

  #set(key: keyof Filter, value: string, force = false): void {
    const next: Filter = { ...this.filter };
    if (value === "") delete next[key];
    else (next as Record<string, string>)[key] = value;
    if (key === "from" || key === "to") {
      if (next.from === undefined || next.to === undefined) {
        this.filter = next;
        return;
      }
    }
    this.#apply(next, force);
  }

  #text(key: TextField, value: string, immediate = false): void {
    clearTimeout(this.#textTimer);
    const apply = () => this.#set(key, value.trim(), immediate);
    if (immediate) apply();
    else this.#textTimer = setTimeout(apply, 400);
  }

  #failure(error: unknown): { field: string | null; message: string } {
    const raw = (error as { params?: { field?: unknown } } | null)?.params?.field;
    const field =
      codeOf(error) === "management.request_invalid" && typeof raw === "string"
        ? FIELD_OF[raw]
        : undefined;
    return field === undefined
      ? { field: null, message: codeMessage(codeOf(error)) }
      : { field: field.control, message: t(field.message) };
  }

  async #load(force = false): Promise<void> {
    const filter = this.filter;
    const key = JSON.stringify(FILTER_KEYS.map((name) => filter[name] ?? null));
    if (!force && key === this.#requested) return;
    this.#requested = key;
    const read = ++this.#read;
    this.loading = true;
    this.loadingMore = false;
    this.moreError = "";
    try {
      const page = await this.api.listTaxOfficeInvoices(filter);
      if (read !== this.#read) return;
      this.invoices = page.rows;
      this.next = page.next;
      this.timeZone = page.timeZone;
      this.#shown = filter;
      this.refusal = null;
    } catch (error) {
      if (read !== this.#read) return;
      this.invoices = [];
      this.next = null;
      this.refusal = this.#failure(error);
    } finally {
      if (read === this.#read) this.loading = false;
    }
  }

  async #more(): Promise<void> {
    if (this.next === null || this.#shown === undefined || this.loadingMore) return;
    const read = this.#read;
    this.loadingMore = true;
    this.moreError = "";
    try {
      const page = await this.api.listTaxOfficeInvoices({ ...this.#shown, after: this.next });
      if (read !== this.#read) return;
      this.invoices = [...this.invoices, ...page.rows];
      this.next = page.next;
    } catch (error) {
      if (read === this.#read) this.moreError = codeMessage(codeOf(error));
    } finally {
      if (read === this.#read) this.loadingMore = false;
    }
  }

  async #open(invoice: TaxOfficeInvoiceDto): Promise<void> {
    if (this.opening.has(invoice.id)) return;
    this.opening = new Set(this.opening).add(invoice.id);
    this.actionError = "";
    try {
      const file = await this.api.downloadTaxOfficeInvoicePdf(invoice.id);
      const url = URL.createObjectURL(file);
      if (window.open(url, "_blank") === null) {
        const link = document.createElement("a");
        link.href = url;
        link.download = pdfFileName(invoice.number);
        link.click();
      }
      // The new tab reads the file after this returns; a minute is ample for it to load.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      this.actionError = codeMessage(codeOf(error));
    } finally {
      const rest = new Set(this.opening);
      rest.delete(invoice.id);
      this.opening = rest;
    }
  }

  #columns(): DataTableColumn<Row>[] {
    const locale = currentLocale();
    const money = (value: string) => formatMoney(value, locale);
    const day = (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      );
    const venueDay = (instant: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: this.timeZone }).format(
        new Date(instant),
      );
    const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const of = (render: (invoice: TaxOfficeInvoiceDto) => unknown) => (row: Row) =>
      "invoice" in row ? render(row.invoice) : "";
    const vat = (render: (line: TaxOfficeInvoiceDto["vat"][number]) => unknown) => (row: Row) =>
      row.vat === undefined ? "" : render(row.vat);
    return [
      {
        key: "number",
        label: t("tax_office.col.number"),
        cell: of(
          (invoice) =>
            html`<span part="number"
              >${invoice.number}${
                invoice.corrects.length === 0
                  ? nothing
                  : html`<span part="mark"
                      >${fill(
                        invoice.kind === "F3" ? "tax_office.replaces" : "tax_office.corrects",
                        {
                          numbers: invoice.corrects.join(", "),
                        },
                      )}</span
                    >`
              }${
                invoice.cancelledAt === null
                  ? nothing
                  : html`<span part="cancelled"
                      >${fill("tax_office.cancelled_on", { date: venueDay(invoice.cancelledAt) })}</span
                    >`
              }</span
            >`,
        ),
      },
      {
        key: "kind",
        label: t("tax_office.col.kind"),
        cell: of(
          (invoice) =>
            html`${invoice.kind} <span part="mark">${t(`tax_office.kind.${invoice.kind}`)}</span>`,
        ),
      },
      {
        key: "issued",
        label: t("tax_office.col.issued"),
        cell: of(
          (invoice) =>
            html`${venueDay(invoice.issuedAt)}<span part="mark"
                >${new Intl.DateTimeFormat(locale, {
                  timeStyle: "short",
                  timeZone: this.timeZone,
                }).format(new Date(invoice.issuedAt))}</span
              >`,
        ),
      },
      {
        key: "operation",
        label: t("tax_office.col.operation"),
        choosable: "shown",
        cell: of((invoice) => (invoice.operationDate === null ? "" : day(invoice.operationDate))),
      },
      {
        key: "customer",
        label: t("tax_office.col.customer"),
        cell: of(
          (invoice) =>
            html`${invoice.customerName ?? ""}${invoice.customerTaxId === null ? nothing : html`<span part="mark">${invoice.customerTaxId}</span>`}`,
        ),
      },
      {
        key: "total",
        label: t("tax_office.col.total"),
        align: "end",
        cell: of((invoice) => money(invoice.total)),
      },
      {
        key: "base",
        label: t("tax_office.col.base"),
        align: "end",
        cell: vat((line) => money(line.base)),
      },
      {
        key: "rate",
        label: t("tax_office.col.rate"),
        align: "end",
        cell: vat((line) => `${percent.format(Number(line.rate))} %`),
      },
      {
        key: "tax",
        label: t("tax_office.col.tax"),
        align: "end",
        cell: vat((line) => money(line.tax)),
      },
      {
        key: "actions",
        label: t("tax_office.col.actions"),
        pinned: "end",
        align: "end",
        cell: of(
          (invoice) =>
            html`<wt-button
              data-test="open"
              size="sm"
              aria-label=${fill("tax_office.open_label", { number: invoice.number })}
              ?loading=${this.opening.has(invoice.id)}
              @click=${(event: Event) => {
                event.stopPropagation();
                void this.#open(invoice);
              }}
              >${t("tax_office.open")}</wt-button
            >`,
        ),
      },
    ];
  }

  #dateField(
    key: "from" | "to" | "operationFrom" | "operationTo",
    label: StringKey,
    required: boolean,
  ) {
    return html`<wt-input
      type="date"
      name=${key}
      label=${t(label)}
      ?required=${required}
      .error=${this.refusal?.field === key ? this.refusal.message : ""}
      .value=${this.filter[key] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#set(key, event.detail.value)}
    ></wt-input>`;
  }

  #textField(key: TextField, label: StringKey, hint: StringKey | null, decimal: boolean) {
    return html`<wt-input
      name=${key}
      label=${t(label)}
      placeholder=${hint === null ? "" : t(hint)}
      decimal-locale=${decimal ? currentLocale() : ""}
      .error=${this.refusal?.field === key ? this.refusal.message : ""}
      .value=${this.filter[key] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#text(key, event.detail.value)}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Enter" && !belongsToComposition(event))
          this.#text(key, (event.currentTarget as HTMLElement & { value: string }).value, true);
      }}
    ></wt-input>`;
  }

  override render() {
    const error = (field: string) => (this.refusal?.field === field ? this.refusal.message : "");
    return html`<h1>${t("tax_office.title")}</h1>
      <div class="filters">
        ${this.#dateField("from", "tax_office.issued_from", true)}
        ${this.#dateField("to", "tax_office.issued_to", true)}
        ${this.#textField("q", "tax_office.search", "tax_office.search_hint", false)}
        ${this.#textField("amount", "tax_office.amount", "tax_office.amount_hint", true)}
        ${this.#textField("rate", "tax_office.rate", null, true)}
        <wt-combobox
          ?preserve-order=${true /* The book's own order of kinds. */}
          name="kind"
          label=${t("tax_office.kind")}
          search="never"
          show-empty-option
          .error=${error("kind")}
          .options=${[
            { value: "", label: t("tax_office.kind_any") },
            ...TAX_OFFICE_KINDS.map((kind) => ({
              value: kind,
              label: `${kind} ${t(`tax_office.kind.${kind}`)}`,
            })),
          ]}
          .value=${this.filter.kind ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#set("kind", event.detail.value)}
        ></wt-combobox>
        ${this.#dateField("operationFrom", "tax_office.operation_from", false)}
        ${this.#dateField("operationTo", "tax_office.operation_to", false)}
      </div>
      ${
        this.actionError === ""
          ? nothing
          : html`<p class="action-error" role="alert" data-test="action-error">
              ${this.actionError}
            </p>`
      }
      <wt-data-table
        aria-label=${t("tax_office.title")}
        viewKey="waitron.tax-office.table"
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
        .rows=${rowsOf(this.invoices)}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => ("parent" in row ? row.parent : null)}
        .rowJoinsParent=${(row: Row) => "parent" in row}
        .rowCollapsible=${() => false}
        .rowKeepsChildOrder=${() => true}
        .loading=${this.loading}
        .loadingMessage=${t("tax_office.loading")}
        .emptyMessage=${tableNoMatches()}
        noMatchesMessage=${tableNoMatches()}
        .errorMessage=${
          this.refusal === null
            ? ""
            : this.refusal.field === null
              ? this.refusal.message
              : t("form.fix_fields")
        }
      ></wt-data-table>
      ${
        this.next === null && this.moreError === ""
          ? nothing
          : html`<div class="more">
              ${
                this.next === null
                  ? nothing
                  : html`<wt-button
                      data-test="more"
                      ?loading=${this.loadingMore}
                      @click=${() => void this.#more()}
                      >${t("tax_office.more")}</wt-button
                    >`
              }
              ${this.moreError === "" ? nothing : html`<span role="alert">${this.moreError}</span>`}
            </div>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-tax-office-screen": TaxOfficeScreen;
  }
}
