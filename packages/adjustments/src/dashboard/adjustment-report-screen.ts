import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  QueryController,
  codeMessage,
  codeOf,
  currentLocale,
  formatIsoMinute,
  tableNoMatches,
} from "@waitron/dashboard-kit";
import { addDecimal, compareDecimal, decimal, formatMoney } from "@waitron/shared";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import { MAX_ENTRY_PAGE_SIZE } from "../entry-pages.js";
import type {
  AdjustmentAction,
  AdjustmentEntry,
  AdjustmentEntryPage,
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
import { kindTotalName, stageName, t, tf } from "./strings.js";

const COMP_ACTIONS: readonly AdjustmentAction[] = ["comp", "discount_percent", "discount_amount"];
const KINDS: readonly { kind: "void" | "comp"; actions: readonly AdjustmentAction[] }[] = [
  { kind: "void", actions: ["cancel"] },
  { kind: "comp", actions: COMP_ACTIONS },
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

/** The tallies of several actions, added together. */
function sumTallies(tallies: AdjustmentTally[]): AdjustmentTally {
  return tallies.reduce((sum, tally) => ({
    count: sum.count + tally.count,
    reduction: addDecimal(decimal(sum.reduction), decimal(tally.reduction)),
    cancelledNominalValue: addDecimal(
      decimal(sum.cancelledNominalValue),
      decimal(tally.cancelledNominalValue),
    ),
  }));
}

/** How many, and what they took off; just the count when there were none. */
function tallyCell(tally: AdjustmentTally): string {
  return tally.count === 0 ? count(0) : `${count(tally.count)} · ${money(tally.reduction)}`;
}

/** What was done, as staff name it: "Void", or "Comp" and how much (design §3.6). */
function entryWords(entry: AdjustmentEntry, locale: string): string {
  if (entry.action === "cancel") return t("adjustment_report.entry.void");
  const amount =
    entry.action === "comp" || tookWholeValue(entry)
      ? percentFormat(locale).format(1)
      : entry.percentBp !== null
        ? percentFormat(locale).format(entry.percentBp / 10000)
        : money(entry.reduction);
  return tf("adjustment_report.entry.comp", { amount });
}

/** An amount comp that took the item's whole list value is a full comp. */
function tookWholeValue(entry: AdjustmentEntry): boolean {
  return (
    entry.action === "discount_amount" &&
    compareDecimal(decimal(entry.afterAmount), decimal("0")) === 0 &&
    compareDecimal(decimal(entry.beforeAmount), decimal(entry.nominalValue)) === 0
  );
}

function personName(ref: PersonRef): string {
  return ref.name ?? t("adjustment_report.unknown_person");
}

/** One line per person with their count, then the guests' count when there is one. */
function peopleCell(
  people: (PersonRef & { count: number })[],
  guests = 0,
): TemplateResult[] | string {
  const lines = people.map(
    (person) => html`<div>${personName(person)} (${count(person.count)})</div>`,
  );
  if (guests > 0) lines.push(html`<div>${t("adjustment_report.guests")} (${count(guests)})</div>`);
  return lines.length === 0 ? NONE : lines;
}

function sameEntries(a: EntriesOf, b: EntriesOf): boolean {
  return typeof a === "string" || typeof b === "string" ? a === b : a.personId === b.personId;
}

/** The rows a read of the list brought, from the top; `met` when they reached a row shown. */
interface ListRead extends AdjustmentEntryPage {
  met: boolean;
}

/** What a list asked for; `reasonId` is absent while every reason is listed. */
interface Listed {
  from: string;
  to: string;
  of: EntriesOf;
  reasonId?: string;
}

/** The Reason field's value while no reason is chosen; a reason's id is a UUID, never this. */
const ALL_REASONS = "all";

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
      /* Sized by the date box, so a backwards range's message wraps under it rather than widening it. */
      .pickers wt-input {
        width: min-content;
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
      .breakdowns section.wide {
        flex-basis: 100%;
      }
      .scroll {
        overflow-x: auto;
      }
      wt-combobox[name="reason"] {
        width: calc(var(--wt-cell-name-max-width) + var(--wt-space-4));
        max-width: 100%;
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
  /** The reason the list is narrowed to, under the name it had when chosen: a later range may
   * hold no row for it. */
  @state() private reasonFilter?: { id: string; name: string };
  /** What the shown list asked for, so a further page asks for the same rows. */
  #listed?: Listed;
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
    const reasonId = this.reasonFilter?.id;
    const listed: Listed = { from, to, of, ...(reasonId === undefined ? {} : { reasonId }) };
    this.#listed = listed;
    void this.#entryQueries
      .watch(
        "entries",
        {
          key: JSON.stringify(["adjustments:entries", from, to, of, reasonId ?? null]),
          dependencies: QUERY_DEPENDENCIES.entries.map((type) => ({ type })),
          refreshMs: 60_000,
          read: firstReadThenPassive(
            () => this.api,
            (api) => this.#readList(api, listed),
          ),
        },
        (read) => this.#listRead(read),
      )
      .catch(() => {
        // The query's error callback has already said why.
      });
  }

  /**
   * Adjustments are never changed or removed, so between two reads a new row almost always arrives
   * at the top; a server clock stepping back, two adjustments saved in the same millisecond, or a
   * change to the location's day cutover or time zone can place one lower. A refresh reads from the
   * top until it meets a row already shown, at most a largest page of rows.
   */
  async #readList(api: AdjustmentsApi, listed: Listed): Promise<ListRead> {
    const generation = this.#pagesGeneration;
    const shown = new Set((this.entries ?? []).map((entry) => entry.id));
    const meets = (page: AdjustmentEntryPage) => page.entries.some((entry) => shown.has(entry.id));
    const first = await this.#ask(api, listed);
    const entries = [...first.entries];
    let next = first.next;
    let met = meets(first);
    while (
      !met &&
      shown.size > 0 &&
      next !== null &&
      entries.length < MAX_ENTRY_PAGE_SIZE &&
      generation === this.#pagesGeneration
    ) {
      const page = await this.#ask(api, listed, {
        after: next,
        limit: MAX_ENTRY_PAGE_SIZE - entries.length,
      });
      entries.push(...page.entries);
      next = page.next;
      met = meets(page);
    }
    return { entries, next, met };
  }

  /**
   * A read that met the list replaces it down to the last row both hold; the rows below, and the
   * cursor after them, stay, so a Show more on its way still continues the list. Rows read past
   * the last row both hold are dropped while a next page exists, because Show more's cursor brings
   * them back; when that row ends the list and there is no next page, the whole read and its cursor
   * are taken, since Show more can be loading only while a next page exists. Any other read starts
   * the list again.
   */
  #listRead({ entries, next, met }: ListRead): void {
    this.entriesError = undefined;
    if (!met) {
      this.#firstPage();
      this.entries = entries;
      this.entriesNext = next;
      return;
    }
    const shown = this.entries!;
    const read = new Set(entries.map((entry) => entry.id));
    let last = shown.length - 1;
    while (!read.has(shown[last]!.id)) last -= 1;
    if (last === shown.length - 1 && this.entriesNext === null) {
      this.entries = entries;
      this.entriesNext = next;
      return;
    }
    const upTo = entries.findIndex((entry) => entry.id === shown[last]!.id);
    this.entries = [...entries.slice(0, upTo + 1), ...shown.slice(last + 1)];
  }

  /** With every reason listed, a first page passes no options at all. */
  #ask(
    api: AdjustmentsApi,
    listed: Listed,
    page: { after?: string; limit?: number } = {},
  ): Promise<AdjustmentEntryPage> {
    const options = {
      ...page,
      ...(listed.reasonId === undefined ? {} : { reasonId: listed.reasonId }),
    };
    return Object.keys(options).length === 0
      ? api.listEntries(listed.from, listed.to, listed.of)
      : api.listEntries(listed.from, listed.to, listed.of, options);
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
    const listed = this.#listed!;
    const generation = this.#pagesGeneration;
    const button = this.renderRoot.querySelector<HTMLElement>('[data-test="show-more"]')!;
    const hadFocus = button.matches(":focus-within");
    this.loadingMore = true;
    this.moreError = undefined;
    try {
      const page = await this.#ask(this.api, listed, { after: this.entriesNext! });
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

  #onDateChange(field: "from" | "to", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    // A date box reads "" while it is cleared or not yet a whole day, which names no day.
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
    this.reasonFilter = undefined;
  }

  /** Every reason the range counted, by name, and the chosen one even when the range lost it. */
  #reasonOptions(report: AdjustmentReport): { value: string; label: string }[] {
    const reasons = report.overall.byReason.map((reason) => ({
      id: reason.reasonId,
      name: reason.reasonName,
    }));
    const chosen = this.reasonFilter;
    if (chosen !== undefined && !reasons.some((reason) => reason.id === chosen.id)) {
      reasons.push(chosen);
    }
    reasons.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return [
      { value: ALL_REASONS, label: t("adjustment_report.entries.all_reasons") },
      ...reasons.map((reason) => ({ value: reason.id, label: reason.name })),
    ];
  }

  #onReasonChange(event: CustomEvent<{ value: string }>, report: AdjustmentReport): void {
    event.stopPropagation();
    const value = event.detail.value;
    this.reasonFilter =
      value === ALL_REASONS
        ? undefined
        : {
            id: value,
            name: this.#reasonOptions(report).find((option) => option.value === value)!.label,
          };
    this.#loadEntries(this.entriesOf!);
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
        cell: (row) => peopleCell(row.approvers),
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
        cell: (entry) => html`<span part="amount">${formatIsoMinute(entry.createdAt)}</span>`,
      },
      {
        key: "action",
        label: t("adjustment_report.column.action"),
        choosable: "shown",
        sortValue: (entry) => entryWords(entry, locale),
        cell: (entry) => entryWords(entry, locale),
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
    lines: { label: string; tally: AdjustmentTally; extra?: (TemplateResult[] | string)[] }[],
    extraHeadings: string[] = [],
  ): TemplateResult {
    const id = `${test}-heading`;
    const wide = extraHeadings.length > 0;
    const table = html`<table data-test=${test} aria-labelledby=${id}>
      <thead>
        <tr>
          <th scope="col">${first}</th>
          <th scope="col" class="num">${t("adjustment_report.column.count")}</th>
          <th scope="col" class="num">${t("adjustment_report.column.reduction")}</th>
          <th scope="col" class="num">${t("adjustment_report.column.cancelled")}</th>
          ${extraHeadings.map((heading) => html`<th scope="col">${heading}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${lines.map(
          ({ label, tally, extra = [] }) =>
            html`<tr>
              <th scope="row">${label}</th>
              <td class="num">${count(tally.count)}</td>
              <td class="num">${money(tally.reduction)}</td>
              <td class="num">${money(tally.cancelledNominalValue)}</td>
              ${extra.map((cell) => html`<td>${cell}</td>`)}
            </tr>`,
        )}
      </tbody>
    </table>`;
    return html`<section class=${wide ? "wide" : ""}>
      <h2 id=${id} data-test=${id}>${heading}</h2>
      ${
        wide
          ? html`<div class="scroll" tabindex="0" role="region" aria-labelledby=${id}>
              ${table}
            </div>`
          : table
      }
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
        customiseColumnsLabel=${t("adjustments.customise_columns")}
        customiseLabel=${t("adjustments.customise")}
        restoreColumnsLabel=${t("adjustments.restore_columns")}
        doneLabel=${t("adjustments.done")}
        moveColumnLabel=${t("adjustments.move_column")}
        showColumnLabel=${t("adjustments.show_column")}
        hideColumnLabel=${t("adjustments.hide_column")}
        alwaysShownColumnLabel=${t("adjustments.column_always_shown")}
        lastShownColumnLabel=${t("adjustments.column_last_shown")}
        columnPositionLabel=${t("adjustments.column_position")}
        .rows=${this.#personRows(report)}
        .columns=${this.#personColumns()}
        .rowKey=${(row: PersonRow) => row.key}
        .rowClick=${(row: PersonRow) => void this.#openEntries(row.of, row.name)}
        .rowClickLabel=${(row: PersonRow) =>
          row.of === "guests"
            ? t("adjustment_report.open_guests")
            : tf("adjustment_report.open_person", { name: row.name })}
        .noMatchesMessage=${tableNoMatches()}
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
        KINDS.map(({ kind, actions }) => ({
          label: kindTotalName(kind),
          tally: sumTallies(actions.map((action) => totals.byAction[action])),
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
              totals.byReason.map((reason) => ({
                label: reason.reasonName,
                tally: reason,
                extra: [
                  peopleCell(reason.requesters, reason.guestRequests),
                  peopleCell(reason.approvers),
                ],
              })),
              [
                t("adjustment_report.entries.requested_by"),
                t("adjustment_report.column.approved_by"),
              ],
            )
      }
    </div>`;
  }

  #entriesSection(report: AdjustmentReport): TemplateResult | typeof nothing {
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
      <wt-combobox
        name="reason"
        label=${t("adjustment_report.column.reason")}
        search="auto"
        .options=${this.#reasonOptions(report)}
        .value=${this.reasonFilter?.id ?? ALL_REASONS}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onReasonChange(event, report)}
      ></wt-combobox>
      <wt-data-table
        data-test="entries"
        aria-label=${heading}
        viewKey="waitron.adjustments.report.entries"
        customiseColumnsLabel=${t("adjustments.customise_columns")}
        customiseLabel=${t("adjustments.customise")}
        restoreColumnsLabel=${t("adjustments.restore_columns")}
        doneLabel=${t("adjustments.done")}
        moveColumnLabel=${t("adjustments.move_column")}
        showColumnLabel=${t("adjustments.show_column")}
        hideColumnLabel=${t("adjustments.hide_column")}
        alwaysShownColumnLabel=${t("adjustments.column_always_shown")}
        lastShownColumnLabel=${t("adjustments.column_last_shown")}
        columnPositionLabel=${t("adjustments.column_position")}
        .rows=${this.entries ?? []}
        .columns=${this.#entryColumns()}
        .rowKey=${(entry: AdjustmentEntry) => entry.id}
        .loading=${this.entries === undefined}
        .loadingMessage=${t("adjustment_report.loading")}
        .emptyMessage=${this.reasonFilter === undefined ? t("adjustment_report.none") : tableNoMatches()}
        .noMatchesMessage=${tableNoMatches()}
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
      html`<wt-input
        type="date"
        name=${field}
        label=${t(`adjustment_report.${field}`)}
        .value=${this[field] ?? ""}
        error=${backwards ? t("adjustment_report.range_backwards") : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onDateChange(field, event)}
      ></wt-input>`;
    return html`<h1 data-test="heading">${t("adjustment_report.title")}</h1>
      <p class="intro" data-test="intro">${t("adjustment_report.intro")}</p>
      <div class="pickers">${picker("from")}${picker("to")}</div>
      ${
        this.loadError
          ? html`<p class="alert" role="alert" data-test="load-error">${this.loadError}</p>`
          : nothing
      }
      ${
        report
          ? html`${this.#summary(report)}${this.#people(report)}${this.#entriesSection(report)}${this.#breakdowns(report)}`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-adjustment-report-screen": AdjustmentReportScreen;
  }
}
