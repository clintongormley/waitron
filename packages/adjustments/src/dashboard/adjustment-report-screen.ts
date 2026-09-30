import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import { formatMoney } from "@waitron/shared";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import type {
  AdjustmentAction,
  AdjustmentEntry,
  AdjustmentReport,
  AdjustmentStageGroup,
  AdjustmentTally,
  AdjustmentTotals,
  AdjustmentsApi,
  EntriesOf,
  PersonRef,
} from "./client.js";
import { firstReadThenPassive } from "./first-read.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { perLocale } from "./per-locale.js";
import { actionName, actionTotalName, stageName, t, tf } from "./strings.js";

const ACTIONS: readonly AdjustmentAction[] = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
];
const STAGES: readonly AdjustmentStageGroup[] = [
  "beforeFiring",
  "afterFiring",
  "afterServing",
  "billDiscount",
];
const NO_TALLY: AdjustmentTally = { count: 0, reduction: "0.00", cancelledNominalValue: "0.00" };
/** The breakdowns of a person the range holds no row for. */
const NO_TOTALS: AdjustmentTotals = {
  ...NO_TALLY,
  byAction: {
    cancel: NO_TALLY,
    comp: NO_TALLY,
    discount_percent: NO_TALLY,
    discount_amount: NO_TALLY,
  },
  byStage: {
    beforeFiring: NO_TALLY,
    afterFiring: NO_TALLY,
    afterServing: NO_TALLY,
    billDiscount: NO_TALLY,
  },
  byReason: [],
};
/** Shown where a value does not apply: a guest's sales, a rate without sales, a missing note. */
const NONE = "—";

/** A row of the per-person table: a person, or the guests, who have no sales of their own. */
interface PersonRow {
  key: string;
  of: EntriesOf;
  name: string;
  totals: AdjustmentTotals;
  sales: string | null;
  ratePercent: string | null;
  approvers: (PersonRef & { count: number })[];
  approvalsGiven: number | null;
}

const rateFormat = perLocale(
  (locale) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
);
const percentFormat = perLocale(
  (locale) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }),
);
const quantityFormat = perLocale(
  (locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }),
);
const countFormat = perLocale((locale) => new Intl.NumberFormat(locale));

const money = (value: string): string => formatMoney(value, currentLocale());
const count = (value: number): string => countFormat(currentLocale()).format(value);

/** The route writes a rate as a one-place decimal string; it is only ever displayed. */
function rate(value: string | null): string {
  return value === null ? NONE : rateFormat(currentLocale()).format(Number(value) / 100);
}

/** How many, and what they took off; just the count when there were none. */
function tallyCell(tally: AdjustmentTally): string {
  return tally.count === 0 ? count(0) : `${count(tally.count)} · ${money(tally.reduction)}`;
}

function personName(ref: PersonRef): string {
  return ref.name ?? t("adjustment_report.unknown_person");
}

/** `YYYY-MM-DD HH:MM` in the browser's own time zone, as the dashboard writes a moment elsewhere. */
function minute(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function sameEntries(a: EntriesOf, b: EntriesOf): boolean {
  return typeof a === "string" || typeof b === "string" ? a === b : a.personId === b.personId;
}

@customElement("dashboard-adjustment-report-screen")
export class AdjustmentReportScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      h2 {
        margin: var(--wt-space-6) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      .intro,
      .hint {
        margin-top: 0;
        color: var(--wt-color-text-muted);
      }
      .alert {
        color: var(--wt-color-danger);
      }
      .pickers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-4);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      input[type="date"] {
        font: inherit;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      input[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }
      .range-error {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-danger);
      }
      .summary {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3) var(--wt-space-6);
        margin: 0 0 var(--wt-space-3);
      }
      .summary dt {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .summary dd {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
      .breakdowns {
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--wt-space-6);
      }
      .breakdowns section {
        flex: 1 1 calc(var(--wt-tap-min) * 8);
        min-width: 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        border-bottom: 1px solid var(--wt-color-border);
        text-align: start;
      }
      thead th {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      tbody th {
        font-weight: var(--wt-font-weight-normal);
      }
      .num {
        text-align: end;
        font-variant-numeric: tabular-nums;
      }
      td.num {
        white-space: nowrap;
      }
      .entries-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        margin: var(--wt-space-6) 0 var(--wt-space-2);
      }
      .entries-head h2 {
        margin: 0;
      }
      .more {
        margin-top: var(--wt-space-3);
      }
      /* Cell markup lives in the table's shadow root, so only a part reaches it. */
      wt-data-table::part(amount) {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      /* A table cell does not wrap, so a long note would widen the whole list. */
      wt-data-table::part(note) {
        display: block;
        min-width: calc(var(--wt-tap-min) * 4);
        max-width: calc(var(--wt-tap-min) * 8);
        white-space: normal;
      }
    `,
  ];

  @property({ attribute: false }) api!: AdjustmentsApi;
  /** Empty until the first answer names the venue's current business day. */
  @state() private from?: string;
  @state() private to?: string;
  @state() private report?: AdjustmentReport;
  @state() private loadError?: string;
  @state() private entriesOf?: EntriesOf;
  /** The person's name as the report showed it when their list was opened: a later range may
   * hold no row for them. */
  @state() private entriesName = "";
  @state() private entries?: AdjustmentEntry[];
  @state() private entriesError?: string;
  /** The cursor of the list's next page; null when the rows shown end the list. */
  @state() private entriesNext: string | null = null;
  @state() private loadingMore = false;
  @state() private moreError?: string;
  /** What the shown list asked for, so a further page asks for the same rows. */
  #listed?: { from: string; to: string; of: EntriesOf };
  /** Moved on whenever the list starts again from its first page, so a further page asked for
   * before then is dropped. */
  #pagesGeneration = 0;
  /** Set once the person picks a day; until then the report follows the venue's current business
   * day, which the routes answer when no range is given. */
  #rangeChosen = false;
  readonly #reports = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.report = undefined;
      this.loadError = tf("adjustment_report.load_error", { reason: codeMessage(codeOf(error)) });
    },
  );
  readonly #entryQueries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.#firstPage();
      this.entries = [];
      this.entriesError = tf("adjustment_report.entries.error", {
        reason: codeMessage(codeOf(error)),
      });
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    // Synchronously: a watch started after an await could outlive a screen already closed.
    this.#load();
  }

  #backwards(): boolean {
    return this.from !== undefined && this.to !== undefined && this.from > this.to;
  }

  /** Cleared before the request, so a refusal never sits beside an older report. */
  #load(): void {
    this.report = undefined;
    this.loadError = undefined;
    const { from, to } = this;
    let range: { from: string; to: string } | undefined;
    if (this.#rangeChosen) {
      if (from === undefined || to === undefined || this.#backwards()) {
        this.#reports.release("report");
        this.#entryQueries.release("entries");
        return;
      }
      range = { from, to };
    }
    void this.#reports
      .watch(
        "report",
        {
          key: JSON.stringify(["adjustments:report", range ?? "current"]),
          dependencies: QUERY_DEPENDENCIES.report.map((type) => ({ type })),
          refreshMs: 60_000,
          read: firstReadThenPassive(
            () => this.api,
            (api) => api.getReport(range),
          ),
        },
        (report) => this.#answered(report),
      )
      .catch(() => {
        // The query's error callback has already said why.
      });
    if (range !== undefined && this.entriesOf !== undefined) this.#loadEntries(this.entriesOf);
  }

  /** Until a day is chosen, the answer's days are the range, and a new business day moves it. */
  #answered(report: AdjustmentReport): void {
    this.report = report;
    this.loadError = undefined;
    if (this.#rangeChosen) return;
    if (report.fromBusinessDay === this.from && report.toBusinessDay === this.to) return;
    this.from = report.fromBusinessDay;
    this.to = report.toBusinessDay;
    if (this.entriesOf !== undefined) this.#loadEntries(this.entriesOf);
  }

  /** Only once a report is shown, so both days are known. */
  #loadEntries(of: EntriesOf): void {
    this.#firstPage();
    this.entries = undefined;
    this.entriesError = undefined;
    const from = this.from!;
    const to = this.to!;
    this.#listed = { from, to, of };
    void this.#entryQueries
      .watch(
        "entries",
        {
          key: JSON.stringify(["adjustments:entries", from, to, of]),
          dependencies: QUERY_DEPENDENCIES.entries.map((type) => ({ type })),
          refreshMs: 60_000,
          read: firstReadThenPassive(
            () => this.api,
            (api) => api.listEntries(from, to, of),
          ),
        },
        (page) => {
          this.#firstPage();
          this.entries = page.entries;
          this.entriesNext = page.next;
          this.entriesError = undefined;
        },
      )
      .catch(() => {
        // The query's error callback has already said why.
      });
  }

  /** Drops any further page still on its way, and what the list said about the last one. */
  #firstPage(): void {
    this.#pagesGeneration += 1;
    this.entriesNext = null;
    this.loadingMore = false;
    this.moreError = undefined;
  }

  /** The person's own request. Focus stays on Show more, or moves to the list's heading once there
   * is no more to show. */
  async #showMore(): Promise<void> {
    const { from, to, of } = this.#listed!;
    const generation = this.#pagesGeneration;
    const button = this.renderRoot.querySelector<HTMLElement>('[data-test="show-more"]')!;
    const hadFocus = button.matches(":focus-within");
    this.loadingMore = true;
    this.moreError = undefined;
    try {
      const page = await this.api.listEntries(from, to, of, { after: this.entriesNext! });
      if (generation !== this.#pagesGeneration) return;
      this.entries = [...this.entries!, ...page.entries];
      this.entriesNext = page.next;
    } catch (error) {
      if (generation !== this.#pagesGeneration) return;
      this.moreError = tf("adjustment_report.entries.more_error", {
        reason: codeMessage(codeOf(error)),
      });
    }
    this.loadingMore = false;
    await this.updateComplete;
    if (!hadFocus) return;
    const target = this.entriesNext === null ? "entries-heading" : "show-more";
    this.renderRoot.querySelector<HTMLElement>(`[data-test="${target}"]`)!.focus();
  }

  #onDateChange(field: "from" | "to", event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A cleared date input reads "", which names no day.
    if (value === "") return;
    this.#rangeChosen = true;
    this[field] = value;
    this.#load();
  }

  async #openEntries(of: EntriesOf, name = ""): Promise<void> {
    this.entriesName = name;
    if (this.entriesOf === undefined || !sameEntries(this.entriesOf, of)) {
      this.entriesOf = of;
      this.#loadEntries(of);
    }
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('[data-test="entries-heading"]')!.focus();
  }

  #closeEntries(): void {
    this.#entryQueries.release("entries");
    this.#firstPage();
    this.entriesOf = undefined;
    this.entries = undefined;
    this.entriesError = undefined;
  }

  #personRows(report: AdjustmentReport): PersonRow[] {
    return [
      ...report.people.map((person) => ({
        key: person.personId,
        of: { personId: person.personId },
        name: personName(person),
        totals: person,
        sales: person.sales,
        ratePercent: person.ratePercent,
        approvers: person.approvers,
        approvalsGiven: person.approvalsGiven,
      })),
      {
        key: "guests",
        of: "guests" as const,
        name: t("adjustment_report.guests"),
        totals: report.guests,
        sales: null,
        ratePercent: null,
        approvers: [],
        approvalsGiven: null,
      },
    ];
  }

  #personColumns(): DataTableColumn<PersonRow>[] {
    const amount = (value: string) => html`<span part="amount">${money(value)}</span>`;
    const stage = (key: AdjustmentStageGroup): DataTableColumn<PersonRow> => ({
      key,
      label: stageName(key),
      align: "end",
      choosable: "shown",
      sortValue: (row) => row.totals.byStage[key].count,
      cell: (row) => html`<span part="amount">${tallyCell(row.totals.byStage[key])}</span>`,
    });
    return [
      {
        key: "name",
        label: t("adjustment_report.column.name"),
        sortValue: (row) => row.name,
        cell: (row) => row.name,
      },
      {
        key: "count",
        label: t("adjustment_report.column.count"),
        align: "end",
        choosable: "shown",
        sortValue: (row) => row.totals.count,
        cell: (row) => count(row.totals.count),
      },
      {
        key: "reduction",
        label: t("adjustment_report.column.reduction"),
        align: "end",
        choosable: "shown",
        sortValue: (row) => Number(row.totals.reduction),
        cell: (row) => amount(row.totals.reduction),
      },
      {
        key: "sales",
        label: t("adjustment_report.column.sales"),
        align: "end",
        choosable: "shown",
        sortValue: (row) => (row.sales === null ? null : Number(row.sales)),
        cell: (row) => (row.sales === null ? NONE : amount(row.sales)),
      },
      {
        key: "rate",
        label: t("adjustment_report.column.rate"),
        align: "end",
        choosable: "shown",
        sortValue: (row) => (row.ratePercent === null ? null : Number(row.ratePercent)),
        cell: (row) => html`<span part="amount">${rate(row.ratePercent)}</span>`,
      },
      {
        key: "cancelled",
        label: t("adjustment_report.column.cancelled"),
        align: "end",
        choosable: "shown",
        sortValue: (row) => Number(row.totals.cancelledNominalValue),
        cell: (row) => amount(row.totals.cancelledNominalValue),
      },
      ...STAGES.map(stage),
      {
        key: "approvedBy",
        label: t("adjustment_report.column.approved_by"),
        choosable: "shown",
        cell: (row) =>
          row.approvers.length === 0
            ? NONE
            : row.approvers.map(
                (approver) => html`<div>${personName(approver)} (${count(approver.count)})</div>`,
              ),
      },
      {
        key: "approvalsGiven",
        label: t("adjustment_report.column.approvals_given"),
        align: "end",
        choosable: "hidden",
        sortValue: (row) => row.approvalsGiven,
        cell: (row) => (row.approvalsGiven === null ? NONE : count(row.approvalsGiven)),
      },
    ];
  }

  #entryColumns(): DataTableColumn<AdjustmentEntry>[] {
    const amount = (value: string) => html`<span part="amount">${money(value)}</span>`;
    const locale = currentLocale();
    return [
      {
        key: "time",
        label: t("adjustment_report.entries.time"),
        sortValue: (entry) => entry.createdAt,
        cell: (entry) => html`<span part="amount">${minute(entry.createdAt)}</span>`,
      },
      {
        key: "action",
        label: t("adjustment_report.column.action"),
        choosable: "shown",
        sortValue: (entry) => actionName(entry.action),
        cell: (entry) =>
          entry.percentBp === null
            ? actionName(entry.action)
            : `${actionName(entry.action)} (${percentFormat(locale).format(entry.percentBp / 10000)})`,
      },
      {
        key: "stage",
        label: t("adjustment_report.entries.when"),
        choosable: "shown",
        cell: (entry) => stageName(entry.stageGroup),
      },
      {
        key: "reason",
        label: t("adjustment_report.column.reason"),
        choosable: "shown",
        sortValue: (entry) => entry.reasonName,
        cell: (entry) => entry.reasonName,
      },
      {
        key: "note",
        label: t("adjustment_report.entries.note"),
        choosable: "shown",
        cell: (entry) =>
          entry.note === null ? NONE : html`<span part="note">${entry.note}</span>`,
      },
      {
        key: "item",
        label: t("adjustment_report.entries.item"),
        choosable: "shown",
        cell: (entry) => entry.lineName ?? stageName("billDiscount"),
      },
      {
        key: "quantity",
        label: t("adjustment_report.entries.quantity"),
        align: "end",
        choosable: "shown",
        cell: (entry) =>
          entry.quantity === null ? NONE : quantityFormat(locale).format(Number(entry.quantity)),
      },
      {
        key: "reduction",
        label: t("adjustment_report.column.reduction"),
        align: "end",
        choosable: "shown",
        sortValue: (entry) => Number(entry.reduction),
        cell: (entry) => amount(entry.reduction),
      },
      {
        key: "listValue",
        label: t("adjustment_report.entries.list_value"),
        align: "end",
        choosable: "shown",
        sortValue: (entry) => Number(entry.nominalValue),
        cell: (entry) => amount(entry.nominalValue),
      },
      {
        key: "requestedBy",
        label: t("adjustment_report.entries.requested_by"),
        choosable: "shown",
        cell: (entry) =>
          entry.byGuest ? t("adjustment_report.entries.guest") : personName(entry.requestedBy),
      },
      {
        key: "approvedBy",
        label: t("adjustment_report.column.approved_by"),
        choosable: "shown",
        cell: (entry) => (entry.approvedBy === null ? NONE : personName(entry.approvedBy)),
      },
      {
        key: "creditedTo",
        label: t("adjustment_report.entries.credited_to"),
        choosable: "hidden",
        cell: (entry) => (entry.creditedTo === null ? NONE : personName(entry.creditedTo)),
      },
      {
        key: "order",
        label: t("adjustment_report.entries.order"),
        align: "end",
        choosable: "shown",
        sortValue: (entry) => entry.orderNumber,
        cell: (entry) => String(entry.orderNumber),
      },
    ];
  }

  #breakdown(
    test: string,
    heading: string,
    first: string,
    lines: { label: string; tally: AdjustmentTally }[],
  ): TemplateResult {
    const id = `${test}-heading`;
    return html`<section>
      <h2 id=${id} data-test=${id}>${heading}</h2>
      <table data-test=${test} aria-labelledby=${id}>
        <thead>
          <tr>
            <th scope="col">${first}</th>
            <th scope="col" class="num">${t("adjustment_report.column.count")}</th>
            <th scope="col" class="num">${t("adjustment_report.column.reduction")}</th>
            <th scope="col" class="num">${t("adjustment_report.column.cancelled")}</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(
            ({ label, tally }) =>
              html`<tr>
                <th scope="row">${label}</th>
                <td class="num">${count(tally.count)}</td>
                <td class="num">${money(tally.reduction)}</td>
                <td class="num">${money(tally.cancelledNominalValue)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </section>`;
  }

  #summary(report: AdjustmentReport): TemplateResult {
    const { overall } = report;
    const figure = (name: string, label: string, value: string) =>
      html`<div data-figure=${name}>
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>`;
    return html`<section>
      <h2 id="summary-heading">${t("adjustment_report.summary")}</h2>
      ${
        overall.count === 0 ? html`<p data-test="none">${t("adjustment_report.none")}</p>` : nothing
      }
      <dl class="summary" data-test="summary">
        ${figure("count", t("adjustment_report.figure.count"), count(overall.count))}
        ${figure("reduction", t("adjustment_report.figure.reduction"), money(overall.reduction))}
        ${figure("cancelled", t("adjustment_report.figure.cancelled"), money(overall.cancelledNominalValue))}
        ${figure("sales", t("adjustment_report.figure.sales"), money(overall.sales))}
        ${figure("rate", t("adjustment_report.figure.rate"), rate(overall.ratePercent))}
      </dl>
      <wt-button
        variant="secondary"
        data-test="show-all"
        @click=${() => void this.#openEntries("everyone")}
        >${t("adjustment_report.show_all")}</wt-button
      >
    </section>`;
  }

  #people(report: AdjustmentReport): TemplateResult {
    return html`<section>
      <h2 id="people-heading">${t("adjustment_report.people")}</h2>
      <p class="hint">${t("adjustment_report.people_hint")}</p>
      <wt-data-table
        data-test="people"
        aria-label=${t("adjustment_report.people")}
        viewKey="waitron.adjustments.report.people"
        columnsLabel=${t("adjustments.columns")}
        .rows=${this.#personRows(report)}
        .columns=${this.#personColumns()}
        .rowKey=${(row: PersonRow) => row.key}
        .rowClick=${(row: PersonRow) => void this.#openEntries(row.of, row.name)}
        .rowClickLabel=${(row: PersonRow) =>
          row.of === "guests"
            ? t("adjustment_report.open_guests")
            : tf("adjustment_report.open_person", { name: row.name })}
      ></wt-data-table>
    </section>`;
  }

  /** The open list's person, or the guests, when one is open; everyone's otherwise. */
  #breakdownOf(report: AdjustmentReport): {
    totals: AdjustmentTotals;
    heading: (by: "action" | "stage" | "reason") => string;
  } {
    const of = this.entriesOf;
    if (of === undefined || of === "everyone")
      return { totals: report.overall, heading: (by) => t(`adjustment_report.by_${by}`) };
    if (of === "guests")
      return { totals: report.guests, heading: (by) => t(`adjustment_report.guests_by_${by}`) };
    const name = this.entriesName;
    return {
      totals: report.people.find((person) => person.personId === of.personId) ?? NO_TOTALS,
      heading: (by) => tf(`adjustment_report.person_by_${by}`, { name }),
    };
  }

  #breakdowns(report: AdjustmentReport): TemplateResult {
    const { totals, heading } = this.#breakdownOf(report);
    return html`<div class="breakdowns">
      ${this.#breakdown(
        "by-action",
        heading("action"),
        t("adjustment_report.column.action"),
        ACTIONS.map((action) => ({
          label: actionTotalName(action),
          tally: totals.byAction[action],
        })),
      )}
      ${this.#breakdown(
        "by-stage",
        heading("stage"),
        t("adjustment_report.column.stage"),
        STAGES.map((stage) => ({ label: stageName(stage), tally: totals.byStage[stage] })),
      )}
      ${
        totals.byReason.length === 0
          ? html`<section>
              <h2 id="by-reason-heading" data-test="by-reason-heading">${heading("reason")}</h2>
              <p class="hint" data-test="no-reasons">${t("adjustment_report.no_reasons")}</p>
            </section>`
          : this.#breakdown(
              "by-reason",
              heading("reason"),
              t("adjustment_report.column.reason"),
              totals.byReason.map((reason) => ({ label: reason.reasonName, tally: reason })),
            )
      }
    </div>`;
  }

  #entriesSection(): TemplateResult | typeof nothing {
    const of = this.entriesOf;
    if (of === undefined) return nothing;
    const heading =
      of === "everyone"
        ? t("adjustment_report.entries.everyone")
        : of === "guests"
          ? t("adjustment_report.entries.guests")
          : tf("adjustment_report.entries.person", { name: this.entriesName });
    return html`<section>
      <div class="entries-head">
        <h2 id="entries-heading" tabindex="-1" data-test="entries-heading">${heading}</h2>
        <wt-button
          variant="secondary"
          size="sm"
          data-test="close-entries"
          @click=${() => this.#closeEntries()}
          >${t("adjustment_report.entries.close")}</wt-button
        >
      </div>
      <wt-data-table
        data-test="entries"
        aria-label=${heading}
        viewKey="waitron.adjustments.report.entries"
        columnsLabel=${t("adjustments.columns")}
        .rows=${this.entries ?? []}
        .columns=${this.#entryColumns()}
        .rowKey=${(entry: AdjustmentEntry) => entry.id}
        .loading=${this.entries === undefined}
        .loadingMessage=${t("adjustment_report.loading")}
        .emptyMessage=${t("adjustment_report.none")}
        .errorMessage=${this.entriesError ?? ""}
      ></wt-data-table>
      ${
        this.entriesNext === null
          ? nothing
          : html`<wt-button
              class="more"
              variant="secondary"
              data-test="show-more"
              ?loading=${this.loadingMore}
              @click=${() => void this.#showMore()}
              >${t("adjustment_report.entries.show_more")}</wt-button
            >`
      }
      ${
        this.moreError
          ? html`<p class="alert" role="alert" data-test="more-error">${this.moreError}</p>`
          : nothing
      }
    </section>`;
  }

  override render(): TemplateResult {
    const backwards = this.#backwards();
    const report = this.report;
    const picker = (field: "from" | "to") =>
      html`<label class="picker"
        >${t(`adjustment_report.${field}`)}
        <input
          type="date"
          name=${field}
          .value=${this[field] ?? ""}
          aria-invalid=${backwards ? "true" : "false"}
          aria-describedby=${backwards ? "range-error" : nothing}
          @change=${(event: Event) => this.#onDateChange(field, event)}
      /></label>`;
    return html`<h1 data-test="heading">${t("adjustment_report.title")}</h1>
      <p class="intro" data-test="intro">${t("adjustment_report.intro")}</p>
      <div class="pickers">${picker("from")}${picker("to")}</div>
      ${
        backwards
          ? html`<p id="range-error" class="range-error" data-test="range-error">
              ${t("adjustment_report.range_backwards")}
            </p>`
          : nothing
      }
      ${
        this.loadError
          ? html`<p class="alert" role="alert" data-test="load-error">${this.loadError}</p>`
          : nothing
      }
      ${
        report
          ? html`${this.#summary(report)}${this.#people(report)}${this.#entriesSection()}${this.#breakdowns(report)}`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-adjustment-report-screen": AdjustmentReportScreen;
  }
}
