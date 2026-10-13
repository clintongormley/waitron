import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { codeOf, currentLocale } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { isLocalDate } from "../hours-rules.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { Paint } from "../paint-model.js";
import { samePaint } from "../paint-model.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import type { AddDates } from "./add-dates-calendar.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { PaintColumn } from "./paint-grid.js";
import {
  browserToday,
  format,
  formatDate,
  formatLongDate,
  formatMonthDay,
  formatWeekday,
} from "./hours-view.js";
import { t } from "./strings.js";
import "./add-dates-calendar.js";
import "./painter-frame.js";
import "./paint-grid.js";

type DateFacts = { date: LocalDate; closedAllDay: boolean };
/** The paint of one department (`d:<id>`) or zone (`z:<id>`), per date; a zone's Open paints as
 *  {@link ZONE_OPEN} and its Closed as `null`. */
type OwnerPaint = Map<string, Map<LocalDate, Paint[]>>;
interface Draft {
  name: string;
  repeatsYearly: boolean;
  /** Sorted by date. */
  dates: DateFacts[];
  paint: OwnerPaint;
}
interface Refused {
  message: string;
  field?: "name" | "dates";
  column?: LocalDate;
}

/** A zone's Open, which no period id can equal: period ids are uuids. */
const ZONE_OPEN = "open";
const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();
/** A month read that fails leaves the calendar unmarked; the server still refuses a taken date. */
const ignore = () => {};

const byDate = (a: DateFacts, b: DateFacts) => a.date.localeCompare(b.date);
const copyPaint = (paint: OwnerPaint): OwnerPaint =>
  new Map(
    [...paint].map(([owner, days]) => [
      owner,
      new Map([...days].map(([date, day]) => [date, day.map((entry) => ({ ...entry }))])),
    ]),
  );
const copyDraft = (draft: Draft): Draft => ({
  ...draft,
  dates: draft.dates.map((entry) => ({ ...entry })),
  paint: copyPaint(draft.paint),
});
function samePaintMap(a: OwnerPaint, b: OwnerPaint): boolean {
  const owners = new Set([...a.keys(), ...b.keys()]);
  return [...owners].every((owner) => {
    const left = a.get(owner) ?? new Map<LocalDate, Paint[]>();
    const right = b.get(owner) ?? new Map<LocalDate, Paint[]>();
    const dates = new Set([...left.keys(), ...right.keys()]);
    return [...dates].every((date) => samePaint(left.get(date) ?? [], right.get(date) ?? []));
  });
}
const sameDraft = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.repeatsYearly === b.repeatsYearly &&
  a.dates.length === b.dates.length &&
  a.dates.every(
    (entry, index) =>
      entry.date === b.dates[index]!.date && entry.closedAllDay === b.dates[index]!.closedAllDay,
  ) &&
  samePaintMap(a.paint, b.paint);

function blank(dates: readonly LocalDate[]): Draft {
  return {
    name: "",
    repeatsYearly: false,
    dates: dates.map((date) => ({ date, closedAllDay: false })),
    paint: new Map(),
  };
}
/** The draft a stored special day opens on: its stored facts and stored paint, never the season's. */
function fromDetail(detail: SpecialDayDetail): Draft {
  const paint: OwnerPaint = new Map();
  const put = (owner: string, date: LocalDate, day: Paint[]) => {
    if (!paint.has(owner)) paint.set(owner, new Map());
    paint.get(owner)!.set(date, day);
  };
  for (const { departmentId, date, ranges } of detail.paint)
    put(
      `d:${departmentId}`,
      date,
      ranges.map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt })),
    );
  for (const { zoneId, date, ranges } of detail.zonePaint)
    put(
      `z:${zoneId}`,
      date,
      ranges.map(({ kind, startsAt, endsAt }) => ({
        periodId: kind === "open" ? ZONE_OPEN : null,
        startsAt,
        endsAt,
      })),
    );
  return {
    name: detail.name,
    repeatsYearly: detail.repeatsYearly,
    dates: detail.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })).sort(byDate),
    paint,
  };
}
const columnLabel = (date: LocalDate) =>
  `${formatWeekday(date, "short")} ${formatMonthDay(date.slice(5))}`;

/**
 * One special day in a full-screen painter: its name, dates and Every year in a side panel, and a
 * column per date with that date's Closed tick under its heading. A stored day opens on what is
 * stored; Save sends the facts and takes the answer as the new saved state.
 */
@customElement("special-day-painter")
export class SpecialDayPainter extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .body {
        display: flex;
        gap: var(--wt-space-4);
        min-height: 0;
      }
      .panel {
        flex: none;
        inline-size: calc(var(--wt-space-6) * 9);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        overflow-y: auto;
        padding: var(--wt-field-line-width-active);
      }
      .dates {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
      }
      paint-grid {
        flex: 1 1 0;
        min-width: 0;
        container-type: size;
        --paint-grid-fill: calc(100cqb - var(--wt-tap-min) * 2 - 3px);
      }
      @media (width < 720px) {
        .body {
          flex-direction: column;
          overflow-y: auto;
        }
        .panel {
          inline-size: auto;
          overflow-y: visible;
        }
        .dates {
          flex: none;
          block-size: calc(var(--wt-space-6) * 16);
        }
      }
      p {
        margin: 0;
      }
      .label,
      legend {
        margin-block-end: var(--wt-space-1);
        padding: 0;
        font-weight: var(--wt-font-weight-medium);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      ul {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        border: 1px solid var(--wt-color-palette-purple);
        border-radius: var(--wt-radius-full);
        padding-inline-start: var(--wt-space-3);
      }
      .chip button {
        min-inline-size: var(--wt-tap-min);
        min-block-size: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-full);
        background: none;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .chip button:focus-visible,
      .segmented input:focus-visible + span,
      .tick input:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      add-dates-calendar {
        margin-block-start: var(--wt-space-2);
      }
      .segmented {
        display: inline-flex;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
      }
      .segmented label {
        position: relative;
        display: inline-flex;
      }
      .segmented input {
        position: absolute;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
      }
      .segmented span {
        display: inline-flex;
        align-items: center;
        min-block-size: var(--wt-tap-min);
        padding: 0 var(--wt-space-4);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .segmented input:checked + span {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      .segmented input:disabled + span {
        color: var(--wt-color-text-muted);
      }
      .segmented input:checked:disabled + span {
        background: var(--wt-color-border);
        color: var(--wt-color-text);
      }
      .note,
      .explain {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .note {
        margin-block-start: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .tick {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        cursor: pointer;
      }
      .tick input {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
    `,
  ];

  @property({ attribute: false }) api!: OpeningHoursApi;
  /** The host's live model; while nothing is edited, a save sends its clock revision. */
  @property({ attribute: false }) model!: OpeningHoursModel;
  @property({ type: Boolean }) open = false;
  /** The stored special day to paint, or `null` for a new one; a change starts again from it. */
  @property({ attribute: false }) specialDayId: string | null = null;
  /** A new special day's first date. */
  @property({ attribute: false }) date: LocalDate | null = null;
  /** The public holidays the host knows of on the dates in view, for the Every year note. */
  @property({ attribute: false }) holidays: readonly HolidayFact[] = [];
  @property({ type: Boolean }) readOnly = false;

  @state() private draft: Draft = blank([]);
  @state() private loading = false;
  @state() private loadFailed = false;
  @state() private attempted = false;
  @state() private refused?: Refused;
  @state() private saving = false;
  @state() private adding = false;
  @state() private month = "";
  @state() private taken: ReadonlyMap<LocalDate, string> = new Map();
  @state() private deleting?: { busy: boolean; message: string };
  private baseline: Draft = blank([]);
  /** What the draft was seeded from: a special day's id, or `new:<date>`. */
  private seeded?: string;
  /** The stored dates, each with the public holiday it was saved on, if any. */
  private stored = new Map<LocalDate, string | undefined>();
  /** The clock revision the draft was seeded with; followed only while nothing is edited. */
  private revision = 0;
  /** Replaced whenever a read's or a write's answer would land on a draft it no longer belongs to. */
  private generation = {};
  private stopMonth?: () => void;
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    this.closeMonth();
    this.generation = {};
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>) {
    if (!this.model) return;
    const key = this.specialDayId ?? `new:${this.date ?? ""}`;
    if (this.open && this.seeded !== key) this.reseed(key);
    else if (changes.has("model") && !this.scope?.isDirty())
      this.revision = this.model.clockRevision;
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: {},
        current: () => this.draft,
        snapshot: copyDraft,
        equal: sameDraft,
        restore: (value) => {
          this.draft = copyDraft(value);
          this.attempted = false;
          this.refused = undefined;
        },
      });
      this.scope = scope;
      this.coordinator = coordinator;
      scope.commit(copyDraft(this.baseline));
    }
  }

  private reseed(key: string) {
    this.generation = {};
    this.seeded = key;
    this.saving = false;
    this.attempted = false;
    this.refused = undefined;
    this.deleting = undefined;
    this.adding = false;
    this.closeMonth();
    this.loadFailed = false;
    this.revision = this.model.clockRevision;
    const id = this.specialDayId;
    if (id === null) {
      this.loading = false;
      this.adopt(undefined, this.date && isLocalDate(this.date) ? [this.date] : []);
      return;
    }
    this.loading = true;
    this.adopt(undefined, []);
    const generation = this.generation;
    this.api.specialDays.readSpecialDay(id).then(
      (detail) => {
        if (generation !== this.generation) return;
        this.loading = false;
        this.adopt(detail, []);
      },
      () => {
        if (generation !== this.generation) return;
        this.loading = false;
        this.loadFailed = true;
      },
    );
  }
  private adopt(detail: SpecialDayDetail | undefined, dates: readonly LocalDate[]) {
    this.stored = new Map(detail?.dates.map(({ date, holidayName }) => [date, holidayName]));
    const fresh = detail ? fromDetail(detail) : blank(dates);
    this.draft = copyDraft(fresh);
    this.baseline = fresh;
    this.scope?.commit(copyDraft(fresh));
  }
  private change(next: Draft) {
    this.draft = next;
    this.refused = undefined;
    this.scope?.changed();
  }

  private ownErrors(): { name?: string; dates?: string } {
    const errors: { name?: string; dates?: string } = {};
    if (!this.draft.name.trim()) errors.name = t("prep.name_required");
    if (!this.draft.dates.length) errors.dates = t("special.dates_required");
    return errors;
  }
  private blocked(): boolean {
    return this.attempted && Object.keys(this.ownErrors()).length > 0;
  }

  private async save() {
    if (this.saving || this.loading || saveActionState(this.scope).unchanged) return;
    this.attempted = true;
    if (this.blocked()) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const input: SpecialDayInput = {
      name: this.draft.name.trim(),
      repeatsYearly: this.draft.repeatsYearly,
      dates: this.draft.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
    };
    const generation = this.generation;
    this.saving = true;
    this.refused = undefined;
    let detail: SpecialDayDetail;
    try {
      detail = await this.api.specialDays.writeSpecialDay(this.specialDayId, input, this.revision);
    } catch (error) {
      if (generation === this.generation) this.refuse(error, input);
      return;
    } finally {
      if (generation === this.generation) this.saving = false;
    }
    if (generation !== this.generation) return;
    this.specialDayId = detail.id;
    this.seeded = detail.id;
    this.attempted = false;
    this.adopt(detail, []);
    this.dispatchEvent(
      new CustomEvent("special-day-saved", { detail: { detail }, bubbles: true, composed: true }),
    );
    this.api.rereadWithSpecialDays();
  }
  private refuse(error: unknown, input: SpecialDayInput) {
    const code = codeOf(error);
    const params =
      (error as { params?: { field?: unknown; reason?: unknown; date?: unknown; name?: unknown } })
        .params ?? {};
    const column = (date: LocalDate | undefined) =>
      date !== undefined && this.draft.dates.some((entry) => entry.date === date)
        ? date
        : undefined;
    if (code === "hours.clock_changed" || code === "hours.clock_change_pending") {
      this.refused = { message: t(code) };
    } else if (code === "special_day.date_taken" && isLocalDate(params.date)) {
      this.refused = {
        message: format("special.date_taken", {
          name: String(params.name ?? ""),
          date: formatDate(params.date),
        }),
        field: "dates",
        column: column(params.date),
      };
    } else if (code === "special_day.invalid" && params.field === "name") {
      this.refused = { message: t("special.field_refused"), field: "name" };
    } else if (code === "special_day.invalid" && typeof params.field === "string") {
      const index = /^dates\.(\d+)(?=\.|$)/.exec(params.field)?.[1];
      const date = index === undefined ? undefined : input.dates[Number(index)]?.date;
      this.refused =
        date === undefined
          ? { message: t("menu.save_error") }
          : {
              message:
                params.reason === "overlap"
                  ? format("special.date_meets", { date: formatDate(date) })
                  : t("special.field_refused"),
              field: "dates",
              column: column(date),
            };
    } else {
      this.refused = { message: t("menu.save_error") };
    }
  }

  private async confirmDelete() {
    const id = this.specialDayId;
    if (id === null || !this.deleting || this.deleting.busy) return;
    const generation = this.generation;
    this.deleting = { busy: true, message: "" };
    try {
      await this.api.specialDays.deleteSpecialDay(id, this.revision);
    } catch (error) {
      if (generation !== this.generation) return;
      const code = codeOf(error);
      this.deleting = {
        busy: false,
        message:
          code === "hours.clock_changed" || code === "hours.clock_change_pending"
            ? t(code)
            : t("hours.save_error"),
      };
      return;
    }
    if (generation !== this.generation) return;
    this.deleting = undefined;
    this.scope?.commit(copyDraft(this.draft));
    this.dispatchEvent(
      new CustomEvent("special-day-deleted", { detail: { id }, bubbles: true, composed: true }),
    );
    this.api.rereadWithSpecialDays();
    this.open = false;
  }

  private showMonth(month: string) {
    this.closeMonth();
    this.month = month;
    this.taken = new Map();
    this.stopMonth = this.api.watchMonth(
      month,
      (read) => {
        this.taken = new Map(
          read.days.flatMap(({ date, inMonth, specialDay }) =>
            inMonth && specialDay && specialDay.id !== this.specialDayId
              ? [[date, specialDay.name] as const]
              : [],
          ),
        );
      },
      ignore,
      ignore,
    );
  }
  private closeMonth() {
    this.stopMonth?.();
    this.stopMonth = undefined;
  }
  private toggleAdding() {
    if (this.adding) {
      this.adding = false;
      this.closeMonth();
      return;
    }
    this.adding = true;
    const first = this.draft.dates[0]?.date ?? this.model.currentBusinessDay ?? browserToday();
    this.showMonth(first.slice(0, 7));
  }
  private addDates(event: CustomEvent<AddDates>) {
    event.stopPropagation();
    const held = new Set(this.draft.dates.map(({ date }) => date));
    const fresh = [...new Set(event.detail.dates)].filter((date) => !held.has(date));
    if (!fresh.length) return;
    this.change({
      ...this.draft,
      dates: [...this.draft.dates, ...fresh.map((date) => ({ date, closedAllDay: false }))].sort(
        byDate,
      ),
    });
  }
  private removeDate(date: LocalDate) {
    const paint = copyPaint(this.draft.paint);
    for (const days of paint.values()) days.delete(date);
    this.change({
      ...this.draft,
      dates: this.draft.dates.filter((entry) => entry.date !== date),
      paint,
    });
  }
  private setClosed(date: LocalDate, closedAllDay: boolean) {
    this.change({
      ...this.draft,
      dates: this.draft.dates.map((entry) =>
        entry.date === date ? { ...entry, closedAllDay } : entry,
      ),
    });
  }

  /** Kept while the dates and the language stay, so the grid sees the same columns. */
  private dateColumns?: { key: string; columns: readonly PaintColumn[] };
  private columns(): readonly PaintColumn[] {
    const key = `${currentLocale()} ${this.draft.dates.map(({ date }) => date).join(",")}`;
    if (this.dateColumns?.key !== key)
      this.dateColumns = {
        key,
        columns: this.draft.dates.map(({ date }) => ({ key: date, label: columnLabel(date) })),
      };
    return this.dateColumns.columns;
  }

  private heading(): string {
    const name = this.draft.name.trim();
    if (name) return name;
    return t(this.specialDayId === null ? "special.new" : "special.edit");
  }
  private message(): string {
    if (this.refused) return this.refused.message;
    if (this.blocked()) return t("prep.fix_fields");
    return this.loadFailed ? t("special.load_error") : "";
  }

  private panel(locked: boolean) {
    const errors = this.attempted ? this.ownErrors() : {};
    const holidayDates = new Set(this.holidays.map(({ date }) => date));
    const onHoliday = this.draft.dates.some(({ date }) =>
      this.stored.has(date) ? this.stored.get(date) !== undefined : holidayDates.has(date),
    );
    const leap =
      this.draft.repeatsYearly && this.draft.dates.some(({ date }) => date.endsWith("-02-29"));
    const nameError = errors.name ?? (this.refused?.field === "name" ? this.refused.message : "");
    const repeat = (value: boolean, label: "special.no" | "special.yes") =>
      html`<label
        ><input
          type="radio"
          name="repeatsYearly"
          value=${value ? "yes" : "no"}
          .checked=${this.draft.repeatsYearly === value}
          ?disabled=${locked}
          @change=${() => this.change({ ...this.draft, repeatsYearly: value })}
        /><span>${t(label)}</span></label
      >`;
    return html`<section class="panel" data-test="panel">
      ${this.loading ? html`<p data-test="loading" role="status">${t("special.loading")}</p>` : nothing}
      <wt-input
        name="name"
        label=${t("prep.name")}
        required
        .value=${this.draft.name}
        .error=${nameError}
        ?disabled=${locked}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.change({ ...this.draft, name: event.detail.value });
        }}
      ></wt-input>
      <div>
        <p class="label" id="dates-label">${t("special.dates")}</p>
        <ul aria-labelledby="dates-label">
          ${this.draft.dates.map(
            ({ date }) =>
              html`<li class="chip" data-test="date-chip" data-date=${date}>
                ${formatDate(date)}${
                  locked
                    ? nothing
                    : html`<button
                        type="button"
                        data-test="remove-date"
                        aria-label=${format("special.remove_date", { date: formatLongDate(date) })}
                        @click=${() => this.removeDate(date)}
                      >
                        ×
                      </button>`
                }
              </li>`,
          )}
        </ul>
        ${
          errors.dates
            ? html`<p class="error" role="alert" data-test="dates-error" data-error="dates">
                ${errors.dates}
              </p>`
            : nothing
        }
        ${
          locked
            ? nothing
            : html`<wt-button
                data-test="add-dates"
                variant="secondary"
                aria-expanded=${this.adding ? "true" : "false"}
                @click=${() => this.toggleAdding()}
                >${t("special.add_dates")}</wt-button
              >`
        }
        ${
          this.adding && !locked
            ? html`<add-dates-calendar
                .month=${this.month}
                .selected=${this.draft.dates.map(({ date }) => date)}
                .taken=${this.taken}
                @add-dates=${this.addDates}
                @month-change=${(event: CustomEvent<{ month: string }>) => {
                  event.stopPropagation();
                  this.showMonth(event.detail.month);
                }}
              ></add-dates-calendar>`
            : nothing
        }
      </div>
      <fieldset>
        <legend>${t("special.every_year")}</legend>
        <div class="segmented">${repeat(false, "special.no")}${repeat(true, "special.yes")}</div>
        ${onHoliday ? html`<p class="note" data-test="holiday-note">${t("special.holiday_note")}</p>` : nothing}
        ${leap ? html`<p class="note" data-test="leap-note">${t("special.leap")}</p>` : nothing}
      </fieldset>
      <p class="explain" data-test="explain">${t("special.explain")}</p>
    </section>`;
  }
  private deleteDialog() {
    const deleting = this.deleting;
    if (!deleting) return nothing;
    return html`<wt-dialog
      open
      data-test="delete-special-day"
      heading=${t("hours.delete")}
      .dismissible=${!deleting.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.deleting = undefined;
      }}
    >
      <p>
        ${format(this.baseline.repeatsYearly ? "special.delete_repeat" : "special.delete", { name: this.baseline.name })}
      </p>
      ${deleting.message ? html`<p role="alert" data-test="delete-refusal">${deleting.message}</p>` : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel-delete"
          variant="secondary"
          ?disabled=${deleting.busy}
          @click=${() => {
            this.deleting = undefined;
          }}
          >${t("hours.cancel")}</wt-button
        ><wt-button
          data-test="confirm-delete"
          variant="danger"
          ?disabled=${deleting.busy}
          ?loading=${deleting.busy}
          @click=${() => void this.confirmDelete()}
          >${t("hours.delete")}</wt-button
        ></wt-form-actions
      >
    </wt-dialog>`;
  }

  override render() {
    if (!this.model) return nothing;
    const locked = this.readOnly || this.saving || this.loading || this.loadFailed;
    const stored = this.specialDayId !== null && !this.loading && !this.loadFailed;
    return html`<painter-frame
        .open=${this.open}
        .heading=${this.heading()}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${(this.scope?.isDirty() ?? false) && !this.blocked()}
        .busy=${this.saving}
        .refusal=${this.message()}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => {
          this.open = false;
          this.seeded = undefined;
          this.generation = {};
          this.saving = false;
          this.adding = false;
          this.deleting = undefined;
          this.closeMonth();
        }}
      >
        ${
          stored && !this.readOnly
            ? html`<wt-button
                slot="actions"
                data-test="delete"
                variant="secondary"
                ?disabled=${this.saving}
                @click=${() => {
                  this.deleting = { busy: false, message: "" };
                }}
                >${t("hours.delete")}</wt-button
              >`
            : nothing
        }
        <div class="body">
          ${this.panel(locked)}
          <div class="dates">
            <paint-grid
              .target=${this.seeded ?? ""}
              .columns=${this.columns()}
              .days=${NOTHING_BY_KEY}
              .closedErases=${false}
              .cutover=${this.model.dayCutover}
              .readOnly=${true}
              .columnErrors=${
                this.refused?.column
                  ? new Map([[this.refused.column, this.refused.message]])
                  : NOTHING_BY_KEY
              }
            >
              ${this.draft.dates.map(
                ({ date, closedAllDay }) =>
                  html`<label slot=${`column-head-${date}`} class="tick"
                    ><input
                      type="checkbox"
                      name=${`closed.${date}`}
                      aria-label=${`${t("special.closed")}, ${formatLongDate(date)}`}
                      .checked=${closedAllDay}
                      ?disabled=${locked}
                      @change=${(event: Event) =>
                        this.setClosed(date, (event.target as HTMLInputElement).checked)}
                    />${t("hours.closed")}</label
                  >`,
              )}
            </paint-grid>
          </div>
        </div>
      </painter-frame>
      ${this.deleteDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "special-day-painter": SpecialDayPainter;
  }
}
