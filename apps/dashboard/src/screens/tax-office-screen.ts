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
import { formatBytes, formatMoney, isCalendarDate } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-input.js";
import {
  TAX_OFFICE_KINDS,
  type DashboardApi,
  type MonthDownloadDto,
  type TaxOfficeCursor,
  type TaxOfficeInvoiceDto,
  type TaxOfficeKind,
  type TaxOfficeQuery,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { guideHref } from "../help-guide.js";
import { dashboardPath } from "../navigation.js";
import {
  clockTime,
  monthName,
  paramsOf,
  saveTaxOfficeFile,
  startBrowserDownload,
  type StartDownload,
} from "../tax-office-download.js";
import { goToLabel } from "../widgets/alert-format.js";
import { pdfFileName } from "../widgets/order-detail-dialog.js";

type Filter = Omit<TaxOfficeQuery, "after">;
const TEXT_FIELDS = ["q", "rate", "amount"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

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
const keyOf = (filter: Filter) => JSON.stringify(FILTER_KEYS.map((name) => filter[name] ?? null));

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
        margin: 0 0 var(--wt-space-2);
      }
      .guide {
        color: var(--wt-color-primary-text);
      }
      .guide-line {
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
      .notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin: 0 0 var(--wt-space-3);
      }
      .notice p {
        margin: 0;
      }
      .action-error,
      .month-file.failed p {
        color: var(--wt-color-danger);
      }
      .more {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      wt-data-table::part(open) {
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        color: var(--wt-color-primary-text);
        text-decoration: underline;
        cursor: pointer;
      }
      wt-data-table::part(open):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      wt-data-table::part(opening) {
        cursor: progress;
        opacity: var(--wt-opacity-disabled);
      }
      wt-data-table::part(mark),
      wt-data-table::part(line) {
        display: block;
      }
      wt-data-table::part(mark) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(customer),
      wt-data-table::part(refs) {
        display: block;
        max-width: var(--wt-cell-name-max-width);
        white-space: normal;
      }
      wt-data-table::part(line) {
        white-space: nowrap;
      }
      wt-data-table::part(cancelled) {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) startDownload: StartDownload = startBrowserDownload;
  /** The person's own month file on the server, as the app shell last read it. */
  @property({ attribute: false }) monthFile: MonthDownloadDto = { status: "none" };
  /** A file saved or found gone, whose line no longer applies until the server says otherwise. */
  @property({ attribute: false }) settledFile: string | null = null;
  @property({ attribute: false }) canOpenBackups = false;
  /** The fields as the person left them, text untrimmed; a read waits until both issue dates are filled. */
  @state() private filter: Filter = currentMonth();
  @state() private invoices: TaxOfficeInvoiceDto[] = [];
  @state() private next: TaxOfficeCursor | null = null;
  @state() private timeZone = "UTC";
  @state() private loading = true;
  @state() private loadingMore = false;
  /** A read's refusal: beside the field it names, or the table's load message when it names none. */
  @state() private refusal: { field: string | null; message: string } | null = null;
  @state() private moreError = "";
  /** A press that failed; kept apart from a read's message so neither clears the other. */
  @state() private actionRefusal: { code: string; message: string } | null = null;
  @state() private opening: ReadonlySet<string> = new Set();
  /** The `YYYY-MM` being asked for: the month pressed, which a later Issued from change does not move. */
  @state() private requestingMonth: string | null = null;
  #read = 0;
  /** The filter of the read last sent, so the address change this screen writes does not send it twice. */
  #requested?: string;
  #textTimer?: ReturnType<typeof setTimeout>;
  /** The filter the listed rows answer; a half-typed range must not change what the next page reads. */
  #shown?: Filter;

  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "invoices") return;
      clearTimeout(this.#textTimer);
      const address = this.#readAddress();
      const fields = this.#query(this.filter);
      // The address this screen just wrote leaves the fields' own spelling, such as a space still being typed, alone.
      if (fields === null || keyOf(fields) !== keyOf(address)) this.filter = address;
      void this.#load(address);
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

  /** The read the fields ask for, or null while an issue date is empty. */
  #query(fields: Filter): Filter | null {
    if (fields.from === undefined || fields.to === undefined) return null;
    const query: Filter = { ...fields };
    for (const key of TEXT_FIELDS) {
      const value = fields[key]?.trim();
      if (value) query[key] = value;
      else delete query[key];
    }
    return query;
  }

  #edit(key: keyof Filter, value: string): void {
    const next: Filter = { ...this.filter };
    if (value === "") delete next[key];
    else (next as Record<string, string>)[key] = value;
    this.filter = next;
  }

  #send(force = false): void {
    clearTimeout(this.#textTimer);
    const query = this.#query(this.filter);
    if (query === null) return;
    // Read first: the address change that follows then finds this read already sent.
    void this.#load(query, force);
    this.#url.write(Object.fromEntries(FILTER_KEYS.map((key) => [key, query[key] ?? null])));
  }

  #text(key: TextField, value: string, immediate = false): void {
    this.#edit(key, value);
    clearTimeout(this.#textTimer);
    if (immediate) this.#send(true);
    else this.#textTimer = setTimeout(() => this.#send(), 400);
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

  async #load(filter: Filter, force = false): Promise<void> {
    const key = keyOf(filter);
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
    this.actionRefusal = null;
    try {
      const file = await this.api.downloadTaxOfficeInvoicePdf(invoice.id);
      const url = URL.createObjectURL(file);
      if (window.open(url, "_blank") === null) {
        const link = document.createElement("a");
        link.href = url;
        link.download = pdfFileName(invoice.number);
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      this.#refused(error);
    } finally {
      const rest = new Set(this.opening);
      rest.delete(invoice.id);
      this.opening = rest;
    }
  }

  /** The `YYYY-MM` of the issue range's start, or null while that date is not a calendar day. */
  #month(): string | null {
    const from = this.filter.from;
    return from !== undefined && isCalendarDate(from) ? from.slice(0, 7) : null;
  }

  #refused(error: unknown): void {
    const code = codeOf(error);
    this.actionRefusal = { code, message: codeMessage(code, currentLocale(), paramsOf(error)) };
  }

  #tell(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** The answer goes to the app shell, which keeps it unless a read already saw that build. */
  async #requestMonth(): Promise<void> {
    const month = this.#month();
    if (month === null || this.#busyMonth() !== null) return;
    this.requestingMonth = month;
    this.actionRefusal = null;
    try {
      this.#tell("tax-office-month-requested", await this.api.requestTaxOfficeMonth(month));
    } catch (error) {
      this.#refused(error);
    } finally {
      this.requestingMonth = null;
    }
  }

  async #saveMonth(file: { id: string; month: string }): Promise<void> {
    this.actionRefusal = null;
    try {
      const id = await saveTaxOfficeFile(this.api, file.month, this.startDownload);
      this.#tell("tax-office-month-settled", { id });
    } catch (error) {
      this.#refused(error);
      // Only a file found gone is settled; any other refusal leaves Save to try again.
      if (codeOf(error) === "tax_office.download_missing")
        this.#tell("tax-office-month-settled", { id: file.id });
    }
  }

  /** Space is freed on Backups; a session that cannot open it is offered an administrator's sign-in. */
  #spaceNextStep() {
    return this.canOpenBackups
      ? html`<wt-button
          variant="secondary"
          data-test="space-go-to-backups"
          @click=${() => this.#tell("wt-alert-go-to", { screen: "backup" })}
          >${goToLabel("backup")}</wt-button
        >`
      : html`<wt-button
          variant="secondary"
          data-test="space-admin-sign-in"
          @click=${() => this.#tell("admin-sign-in", null)}
          >${t("staff.sign_in_as_admin")}</wt-button
        >`;
  }

  /** The month the server is preparing for this person, or the one being asked for. */
  #busyMonth(): string | null {
    return (
      this.requestingMonth ?? (this.monthFile.status === "building" ? this.monthFile.month : null)
    );
  }

  #monthAction() {
    const busy = this.#busyMonth();
    const month = busy ?? this.#month();
    const label = (key: StringKey, yearMonth: string) => fill(key, { month: monthName(yearMonth) });
    return html`<wt-button
      data-test="download-month"
      variant=${month === null ? "secondary" : "primary"}
      ?disabled=${month === null}
      ?loading=${busy !== null}
      @click=${() => void this.#requestMonth()}
      >${
        busy !== null
          ? label("tax_office.downloading_month", busy)
          : month === null
            ? t("tax_office.download_no_month")
            : label("tax_office.download_month", month)
      }</wt-button
    >`;
  }

  #monthFileLine() {
    const file = this.monthFile;
    if (file.status === "none" || file.id === this.settledFile) return nothing;
    const month = monthName(file.month);
    if (file.status !== "ready") {
      const stopped = file.status === "failed" ? file.refusal : null;
      return html`<div
        class="notice month-file ${file.status}"
        data-test="month-file"
        role="status"
      >
        <p>
          ${
            stopped !== null
              ? codeMessage(stopped.code, currentLocale(), stopped.params)
              : fill(
                  file.status === "building"
                    ? "tax_office.month_building"
                    : "tax_office.notice_failed",
                  { month },
                )
          }
        </p>
        ${stopped === null ? nothing : this.#spaceNextStep()}
      </div>`;
    }
    return html`<div class="notice month-file" data-test="month-file" role="status">
      <p>${fill("tax_office.notice_ready", { month, time: clockTime(file.expiresAt) })}</p>
      <wt-button
        variant="secondary"
        data-test="save-month-file"
        @click=${() => void this.#saveMonth(file)}
        >${fill("tax_office.save_file_size", {
          size: formatBytes(file.bytes, currentLocale()),
        })}</wt-button
      >
    </div>`;
  }

  #columns(): DataTableColumn<TaxOfficeInvoiceDto>[] {
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
    const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
    const lines = (
      invoice: TaxOfficeInvoiceDto,
      part: string,
      value: (line: TaxOfficeInvoiceDto["vat"][number]) => string,
    ) => invoice.vat.map((line) => html`<span part="line ${part}">${value(line)}</span>`);
    return [
      {
        key: "number",
        label: t("tax_office.col.number"),
        cell: (invoice) => {
          const busy = this.opening.has(invoice.id);
          return html`<button
              type="button"
              part=${busy ? "open opening" : "open"}
              data-test="open"
              aria-label=${fill("tax_office.open_label", { number: invoice.number })}
              aria-busy=${busy ? "true" : nothing}
              @click=${(event: Event) => {
                event.stopPropagation();
                void this.#open(invoice);
              }}
            >
              ${invoice.number}</button
            >${
              invoice.corrects.length === 0
                ? nothing
                : html`<span part="mark refs"
                    >${fill(invoice.kind === "F3" ? "tax_office.replaces" : "tax_office.corrects", {
                      numbers: invoice.corrects.join(", "),
                    })}</span
                  >`
            }${
              invoice.cancelledAt === null
                ? nothing
                : html`<span part="cancelled">${t("tax_office.cancelled")}</span
                    ><span part="mark">${venueDay(invoice.cancelledAt)}</span>`
            }`;
        },
      },
      {
        key: "kind",
        label: t("tax_office.col.kind"),
        choosable: "shown",
        cell: (invoice) =>
          html`<abbr title=${t(`tax_office.kind.${invoice.kind}`)}>${invoice.kind}</abbr>`,
      },
      {
        key: "issued",
        label: t("tax_office.col.issued"),
        choosable: "shown",
        cell: (invoice) =>
          html`${venueDay(invoice.issuedAt)}<span part="mark"
              >${new Intl.DateTimeFormat(locale, {
                timeStyle: "short",
                timeZone: this.timeZone,
              }).format(new Date(invoice.issuedAt))}</span
            >${
              invoice.operationDate === null
                ? nothing
                : html`<span part="mark"
                    >${fill("tax_office.operation_on", { date: day(invoice.operationDate) })}</span
                  >`
            }`,
      },
      {
        key: "customer",
        label: t("tax_office.col.customer"),
        choosable: "shown",
        cell: (invoice) =>
          html`<span part="customer">${invoice.customerName ?? ""}</span
            >${invoice.customerTaxId === null ? nothing : html`<span part="mark">${invoice.customerTaxId}</span>`}`,
      },
      {
        key: "total",
        label: t("tax_office.col.total"),
        choosable: "shown",
        align: "end",
        cell: (invoice) => money(invoice.total),
      },
      {
        key: "base",
        label: t("tax_office.col.base"),
        choosable: "shown",
        align: "end",
        cell: (invoice) => lines(invoice, "base", (line) => money(line.base)),
      },
      {
        key: "rate",
        label: t("tax_office.col.rate"),
        choosable: "shown",
        align: "end",
        cell: (invoice) =>
          lines(invoice, "rate", (line) => percent.format(Number(line.rate) / 100)),
      },
      {
        key: "tax",
        label: t("tax_office.col.tax"),
        choosable: "shown",
        align: "end",
        cell: (invoice) => lines(invoice, "tax", (line) => money(line.tax)),
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
      .error=${
        (key === "from" || key === "to") && this.filter[key] === undefined
          ? t("tax_office.date_required")
          : this.refusal?.field === key
            ? this.refusal.message
            : ""
      }
      .value=${this.filter[key] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        this.#edit(key, event.detail.value);
        this.#send();
      }}
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
      <p class="guide-line">
        <a class="guide" href=${guideHref("invoices.overview")}>${t("tax_office.guide")}</a>
      </p>
      <div class="filters">
        ${this.#dateField("from", "tax_office.issued_from", true)}
        ${this.#dateField("to", "tax_office.issued_to", true)} ${this.#monthAction()}
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
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.#edit("kind", event.detail.value);
            this.#send();
          }}
        ></wt-combobox>
        ${this.#dateField("operationFrom", "tax_office.operation_from", false)}
        ${this.#dateField("operationTo", "tax_office.operation_to", false)}
      </div>
      ${this.#monthFileLine()}
      ${
        this.actionRefusal === null
          ? nothing
          : html`<div class="notice">
              <p class="action-error" role="alert" data-test="action-error">
                ${this.actionRefusal.message}
              </p>
              ${this.actionRefusal.code === "tax_office.space_low" ? this.#spaceNextStep() : nothing}
            </div>`
      }
      <wt-data-table
        aria-label=${t("tax_office.title")}
        viewKey="waitron.invoices.table"
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
        .rows=${this.invoices}
        .columns=${this.#columns()}
        .rowKey=${(invoice: TaxOfficeInvoiceDto) => invoice.id}
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
