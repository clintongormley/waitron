import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  formMessage,
  formMessageStyles,
  visuallyHiddenStyles,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import { formatDuration } from "@waitron/shared";
import {
  attendanceEditDateInRange,
  previewDayMinutes,
} from "@waitron/workforce/attendance-day-edit";
import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { AttendanceChange } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import {
  type ClockKind,
  dayOffsetSuffix,
  managerDayEdits,
  managerDayField,
  managerDayRows,
  recordedDate,
  type ManagerDay,
} from "../screens/till-hours-day-editor.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";

interface TimeDraft {
  target: AttendanceChange["target"];
  date: string;
  time: string;
  offset: string;
  original: AttendanceChange;
  kind?: ClockKind;
  shift?: number;
  inferDate?: boolean;
}
interface Draft {
  rows: TimeDraft[];
  reason: string;
}

function wallTime(change: AttendanceChange): string {
  return change.at === ""
    ? ""
    : new Date(Date.parse(change.at) + change.offsetMinutes * 60_000).toISOString();
}
function timeDraft(change: AttendanceChange, date = ""): TimeDraft {
  const wall = wallTime(change);
  return {
    target: structuredClone(change.target),
    date: wall.slice(0, 10) || date,
    time: wall.slice(11, 16),
    offset: wall ? String(change.offsetMinutes) : "",
    original: structuredClone(change),
  };
}
function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}
function validTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}
const dayMilliseconds = 86_400_000;
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

function nextDate(date: string): string {
  return new Date(midnight(date) + dayMilliseconds).toISOString().slice(0, 10);
}

function offsetLabel(offset: number): string {
  const absolute = Math.abs(offset);
  return `${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

@customElement("till-attendance-correction-dialog")
export class AttendanceCorrectionDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      .fields,
      .time-fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      .fields {
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      .manager-fields {
        --wt-tap-min: var(--wt-dropdown-row-height);
        --wt-field-height: var(--wt-dropdown-row-height);
        box-sizing: border-box;
        padding: var(--wt-space-4);
        gap: calc((var(--wt-space-2) + var(--wt-space-3)) / 2);
      }
      .manager-fields wt-input::part(field),
      .manager-fields wt-textarea::part(field),
      .manager-fields wt-combobox::part(field) {
        background: var(--wt-color-surface);
      }
      .manager-fields :is(wt-textarea, wt-combobox)::part(field) {
        border: var(--wt-field-line-width) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        box-shadow: none;
      }
      .manager-fields :is(wt-textarea, wt-combobox):focus-within::part(field) {
        border-color: var(--wt-color-primary);
      }
      .manager-fields wt-textarea::part(control) {
        box-sizing: border-box;
        color: var(--wt-color-text);
        field-sizing: content;
        block-size: auto;
        inline-size: 100%;
        min-block-size: calc(
          2 * var(--wt-space-6) + var(--wt-space-3) - 2 * var(--wt-field-line-width)
        );
        max-block-size: calc(6 * var(--wt-space-6));
        resize: none;
      }
      .manager-fields p {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .manager-fields .time-note {
        margin-block-start: calc(var(--wt-space-1) / 2);
      }
      .shift {
        display: grid;
        gap: var(--wt-space-2);
        padding-block-end: var(--wt-space-2);
        border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
      }
      .time-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--wt-space-2);
        align-items: start;
      }
      .time-row wt-input {
        min-inline-size: 0;
      }
      .time-field {
        position: relative;
      }
      .day-offset {
        position: absolute;
        inset-inline-start: calc(var(--wt-space-4) + var(--wt-space-1) + 5ch);
        inset-block-start: calc((var(--wt-field-height) - var(--wt-font-size-md)) / 2);
        color: var(--wt-color-text-muted);
        line-height: 1;
        pointer-events: none;
      }
      .shift legend {
        inline-size: 100%;
        padding: 0;
      }
      .shift-heading,
      .shift-remove {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .shift-heading {
        font-size: var(--wt-font-size-md);
        min-block-size: var(--wt-space-5);
      }
      .shift-action {
        --wt-action-padding: var(--wt-space-1) 0;
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-action-text: var(--wt-color-primary-text);
        justify-self: start;
      }
      .shift-action.remove {
        --wt-action-text: var(--wt-color-text-muted);
      }
      .shift-remove {
        justify-content: end;
      }
      .break-pair,
      .manager-reason {
        margin-block-start: var(--wt-space-2);
      }
      .quiet-date {
        visibility: hidden;
      }
      .spoken-total {
        ${visuallyHiddenStyles}
      }
      .manager-actions {
        display: grid;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-4);
        background: var(--wt-color-surface);
        border-block-start: 1px solid var(--wt-color-border);
      }
      .manager-actions > * {
        inline-size: 100%;
        max-inline-size: calc(var(--wt-form-max-width) - 2 * var(--wt-space-4));
      }
      .manager-actions wt-button[data-save] {
        --wt-tap-min: var(--wt-menu-row-height);
        --wt-action-font-size: var(--wt-menu-row-label-size);
      }
      .clock-label {
        display: block;
        margin-block-end: var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: calc((var(--wt-font-size-sm) + var(--wt-font-size-md)) / 2);
      }
      .clock-label strong {
        color: var(--wt-color-danger);
      }
      fieldset {
        min-width: 0;
        border: 0;
        padding: 0;
        margin: 0;
      }
      legend {
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) initialChanges: AttendanceChange[] = [];
  @property({ attribute: false }) managerDay?: ManagerDay;
  @property() timeZone = "UTC";
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) blocked = false;
  @property({ attribute: false }) recovery: "uncertain" | "retry" | null = null;
  @property() reasonRefusal = "";
  @property({ type: Boolean }) reasonOnly = false;
  @property() error = "";
  @state() private draft: Draft = { rows: [], reason: "" };
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #baseline?: Draft;
  #opened = false;
  #zone = "UTC";
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (!this.#leave ||
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (!this.isConnected) return;
    if (changed.has("reasonRefusal")) this.#feedback.newRefusal("reason");
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.#opened = false;
      this.#baseline = undefined;
      this.draft = { rows: [], reason: "" };

      return;
    }
    if (!this.#opened) {
      this.#opened = true;
      this.#zone = this.timeZone;
      this.draft = {
        rows: this.managerDay
          ? managerDayRows(this.managerDay).map(({ change, kind, shift }) => ({
              ...timeDraft(change),
              kind,
              shift,
            }))
          : this.reasonOnly
            ? []
            : this.initialChanges.map((change) => timeDraft(change)),
        reason: "",
      };
      this.#baseline = structuredClone(this.draft);
      this.#feedback.reset();
    }
    if (!this.#scope) {
      const { coordinator, scope } = draftScopeFor<Draft>(this, {
        id: this,
        current: () => this.draft,
        snapshot: (value) => structuredClone(value),
        equal: (a, b) => {
          const values = (draft: Draft) =>
            JSON.stringify(draft, (key, value: unknown) =>
              key === "inferDate" ? undefined : value,
            );
          return values(a) === values(b);
        },
        restore: (value) => {
          this.draft = structuredClone(value);
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit(this.#baseline!);
    }
  }

  override updated(changed: PropertyValues): void {
    if (!changed.has("open") || !this.open || !this.managerDay?.item) return;
    void this.renderRoot.querySelector("wt-dialog")?.updateComplete.then(() => {
      if (this.open)
        this.renderRoot
          .querySelector("[data-requested-time]")
          ?.scrollIntoView({ block: "nearest" });
    });
  }

  #choices(row: TimeDraft): { at: string; offset: number }[] {
    if (!validDate(row.date) || !validTime(row.time)) return [];
    const originalWall = wallTime(row.original);
    const choices = localTimeOccurrences(row.date, row.time, this.#zone).map((at) => ({
      at: at.toISOString(),
      offset: offsetMinutes(at.getTime(), this.#zone),
    }));
    if (
      originalWall &&
      row.date === originalWall.slice(0, 10) &&
      row.time === originalWall.slice(11, 16)
    ) {
      const existing = choices.findIndex((choice) => choice.offset === row.original.offsetMinutes);
      const original = { at: row.original.at, offset: row.original.offsetMinutes };
      if (existing < 0) choices.unshift(original);
      else choices[existing] = original;
    }
    return choices;
  }
  #changes(): AttendanceChange[] | null {
    const result: AttendanceChange[] = [];
    for (const row of this.draft.rows) {
      const choice = this.#choices(row).find((choice) => String(choice.offset) === row.offset);
      if (!choice) return null;
      result.push({
        target: structuredClone(row.target),
        at: choice.at,
        offsetMinutes: choice.offset,
      });
    }
    return result;
  }
  #shifts(): Map<number, number[]> {
    const shifts = new Map<number, number[]>();
    this.draft.rows.forEach(({ shift }, index) => {
      if (shift === undefined) return;
      const indices = shifts.get(shift);
      if (indices) indices.push(index);
      else shifts.set(shift, [index]);
    });
    return shifts;
  }
  #managerErrors(
    day: ManagerDay,
    changes: AttendanceChange[] | null,
    errors: { date: string; time: string }[],
  ): void {
    const { date } = day.view;
    const tomorrow = nextDate(date);
    const { rows } = this.draft;
    rows.forEach((row, index) => {
      const newClockIn = row.kind === "in" && "missingKind" in row.target;
      if (errors[index]!.date || attendanceEditDateInRange(row.date, date, tomorrow, newClockIn))
        return;
      if (newClockIn) {
        errors[index]!.date = t("hours.new_shift_date");
      } else if (row.date !== recordedDate(day, row.target)) {
        errors[index]!.date = t("hours.time_date_range");
      }
    });
    if (!changes) return;
    const instants = changes.map(({ at }) => Date.parse(at));
    const spans: { start: number; end: number; index: number }[] = [];
    for (const indices of this.#shifts().values()) {
      const inIndex = indices.find((index) => rows[index]!.kind === "in");
      const outIndex = indices.find((index) => rows[index]!.kind === "out");
      if (inIndex === undefined || outIndex === undefined) continue;
      const start = instants[inIndex]!;
      const end = instants[outIndex]!;
      if (end <= start) {
        errors[outIndex]!.time = t("attendance.time_order");
        continue;
      }
      spans.push({ start, end, index: inIndex });
      for (const index of indices) {
        const kind = rows[index]!.kind;
        if (kind !== "break_start" && kind !== "break_end") continue;
        const at = instants[index]!;
        if (at < start || at > end) errors[index]!.time = t("hours.break_outside_shift");
        else if (
          kind === "break_end" &&
          rows[index - 1]?.kind === "break_start" &&
          at <= instants[index - 1]!
        )
          errors[index]!.time = t("hours.break_time_order");
      }
    }
    let latestEnd = -Infinity;
    for (const { start, end, index } of spans.sort((a, b) => a.start - b.start)) {
      if (start < latestEnd) errors[index]!.time = t("hours.shift_overlap");
      latestEnd = Math.max(latestEnd, end);
    }
  }
  #errors(): { rows: { date: string; time: string; offset: string }[]; reason: string } {
    const rows = this.draft.rows.map((row) => ({
      date: validDate(row.date) ? "" : t("attendance.date_required"),
      time: !validTime(row.time)
        ? t("attendance.time_required")
        : validDate(row.date) && this.#choices(row).length === 0
          ? t("attendance.time_skipped")
          : "",
      offset:
        this.#choices(row).length > 1 && row.offset === "" ? t("attendance.offset_required") : "",
    }));
    const changes = this.#changes();
    if (this.managerDay) this.#managerErrors(this.managerDay, changes, rows);
    else if (changes?.length === 2 && Date.parse(changes[1]!.at) <= Date.parse(changes[0]!.at)) {
      rows[1]!.time = t("attendance.time_order");
    }
    const reason = this.draft.reason.trim();
    return {
      rows,
      reason:
        reason === ""
          ? t("attendance.reason_required")
          : reason.length > 500
            ? t("attendance.reason_long")
            : "",
    };
  }
  #invalid(): boolean {
    const errors = this.#errors();
    return (
      errors.reason !== "" ||
      errors.rows.some((row) => row.date || row.time || row.offset) ||
      (!this.reasonOnly && (this.draft.rows.length === 0 || this.#changes() === null))
    );
  }
  #edit(
    event: CustomEvent<{ value: string }>,
    index: number | null,
    key: "date" | "time" | "offset" | "reason",
  ): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy || this.blocked) return;
    if (index === null) this.#feedback.dismiss("reason");
    if (index === null) this.draft = { ...this.draft, reason: event.detail.value };
    else {
      const rows = this.draft.rows.map((row) => ({ ...row }));
      const row = rows[index]!;
      if (key === "reason") return;
      row[key] = event.detail.value;
      if (key !== "offset") {
        if (this.managerDay) {
          if (row.kind !== "in") row.inferDate = key === "time" && row.inferDate !== false;
          const start = rows.find(
            (candidate) => candidate.shift === row.shift && candidate.kind === "in",
          );
          if (start && validDate(start.date) && validTime(start.time)) {
            for (const [candidateIndex, candidate] of rows.entries()) {
              if (
                (row !== start && candidate !== row) ||
                candidate.shift !== row.shift ||
                !candidate.inferDate ||
                !validTime(candidate.time)
              )
                continue;
              candidate.date = candidate.time < start.time ? nextDate(start.date) : start.date;
              if (candidate !== row) this.#selectOffset(candidate, this.draft.rows[candidateIndex]);
            }
          }
        }
        this.#selectOffset(row, this.managerDay ? this.draft.rows[index] : undefined);
      }
      this.draft = { ...this.draft, rows };
    }
    this.#scope?.changed();
  }
  #selectOffset(row: TimeDraft, previous?: TimeDraft): void {
    const choices = this.#choices(row);
    const originalWall = wallTime(row.original);
    if (
      originalWall &&
      row.date === originalWall.slice(0, 10) &&
      row.time === originalWall.slice(11, 16)
    ) {
      row.offset = String(row.original.offsetMinutes);
    } else if (choices.length === 1) {
      row.offset = String(choices[0]!.offset);
    } else if (
      !previous ||
      !choices.some((choice) => String(choice.offset) === previous.offset) ||
      this.#choices(previous).length < 2
    ) {
      row.offset = "";
    }
  }
  async #save(event: Event): Promise<void> {
    event.stopPropagation();
    if (
      !this.isConnected ||
      !this.open ||
      this.busy ||
      this.blocked ||
      saveActionState(this.#scope).unchanged
    )
      return;
    this.#feedback.press();
    if (this.#invalid()) {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    const all = this.#changes()!;
    const changes = this.managerDay ? managerDayEdits(this.managerDay, all) : all;
    if (this.managerDay && !changes.length) return;
    this.dispatchEvent(
      new CustomEvent("correction-save", {
        detail: { changes, reason: this.draft.reason.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #retry(event: Event, command: boolean): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    this.dispatchEvent(
      new CustomEvent(command ? "retry-attendance-command" : "retry-attendance", {
        bubbles: true,
        composed: true,
      }),
    );
  }
  #cancel(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    const reason = event.type === "wt-back" ? "navigation" : "cancel";
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose(reason);
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("correction-cancel", { bubbles: true, composed: true }));
  }
  #addPair(shift: number, start: ClockKind, end: ClockKind): void {
    if (!this.managerDay || this.busy || this.blocked) return;
    const rows = [...this.draft.rows];
    const clockIn = rows.find((row) => row.shift === shift && row.kind === "in");
    const out = rows.findIndex((row) => row.shift === shift && row.kind === "out");
    const afterShift = rows.findIndex((row) => row.shift! > shift);
    rows.splice(
      out >= 0 ? out : afterShift >= 0 ? afterShift : rows.length,
      0,
      ...[start, end].map((kind) => ({
        ...timeDraft(
          { target: { missingKind: kind }, at: "", offsetMinutes: 0 },
          clockIn?.date ?? this.managerDay!.view.date,
        ),
        kind,
        shift,
      })),
    );
    this.draft = { ...this.draft, rows };
    this.#scope?.changed();
  }

  #removeRows(indices: number[]): void {
    if (this.busy || this.blocked) return;
    this.draft = {
      ...this.draft,
      rows: this.draft.rows.filter((_, index) => !indices.includes(index)),
    };
    this.#scope?.changed();
  }

  #dateField(row: TimeDraft, index: number, label: string, error: string, showLabel = true) {
    const dateLabel = t("attendance.date");
    return html`${this.managerDay ? html`<span class=${showLabel ? "clock-label" : "clock-label quiet-date"} aria-hidden="true">${dateLabel} <strong>*</strong></span>` : nothing}
      <wt-input
        .variant=${this.managerDay ? "outlined" : "filled"}
        name=${`attendanceDate${index}`}
        type="date"
        required
        .label=${label}
        .value=${live(row.date)}
        .disabled=${this.busy || this.blocked}
        .error=${this.#feedback.attempted ? error : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "date")}
      ></wt-input>`;
  }
  override render() {
    const errors = this.#errors();
    const action = saveActionState(this.#scope);
    const invalid = this.#feedback.attempted && this.#invalid();
    const reasonRefusal = this.#feedback.shows("reason") ? this.reasonRefusal : "";
    const error = this.reasonRefusal ? "" : this.error;
    const manager = this.managerDay;
    const all = manager ? this.#changes() : null;
    const blocked =
      this.busy ||
      this.blocked ||
      action.unchanged ||
      invalid ||
      (!!manager && all !== null && !managerDayEdits(manager, all).length);
    const shiftDate = (row: TimeDraft) =>
      this.draft.rows.find(({ shift, kind }) => shift === row.shift && kind === "in")?.date ||
      manager?.view.date ||
      "";
    const referenceDate = (row: TimeDraft) =>
      row.kind === "in" ? (manager?.view.date ?? "") : shiftDate(row);
    const dayFields =
      manager &&
      this.draft.rows.map((row) =>
        managerDayField(manager, row.original, row.kind, row.date, row.time, referenceDate(row)),
      );
    const lastNote =
      dayFields?.reduce((last, { notes }, index) => (notes ? index : last), -1) ?? -1;
    const timesInvalid = errors.rows.some(({ date, time, offset }) => date || time || offset);
    const minutes =
      manager && all && !timesInvalid ? previewDayMinutes(manager.view, all) : undefined;
    const pendingTotal = all
      ? this.#feedback.attempted
        ? t("hours.worked_total_invalid")
        : ""
      : errors.rows.some(({ offset }) => offset)
        ? ""
        : t("hours.worked_total_pending");
    const worked =
      manager && (minutes !== undefined || pendingTotal)
        ? html` <span aria-hidden="true"
            >${
              minutes === undefined
                ? pendingTotal
                : fill(t("hours.worked_would_be"), {
                    time: `${Math.floor(minutes / 60)}\u00a0h\u00a0${String(minutes % 60).padStart(2, "0")}\u00a0min`,
                  })
            }</span
          >`
        : nothing;
    const timeRows = this.draft.rows.map((row, index) => {
      const field = dayFields?.[index];
      const dateSuffix = manager ? dayOffsetSuffix(row.date, referenceDate(row)) : "";
      const label = field?.label ?? t("attendance.time");
      const time = html`
        ${manager ? html`<span class="clock-label" aria-hidden="true">${label} <strong>*</strong></span>` : nothing}
        <div class="time-field">
          <wt-input
            name=${`attendanceTime${index}`}
            type="time"
            required
            .label=${`${label}${dateSuffix}`}
            .variant=${manager ? "outlined" : "filled"}
            .value=${live(row.time)}
            .disabled=${this.busy || this.blocked}
            .error=${this.#feedback.attempted ? errors.rows[index]!.time : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "time")}
          ></wt-input
          >${dateSuffix ? html`<span class="day-offset" aria-hidden="true">${dateSuffix.trim()}</span>` : nothing}
        </div>
      `;
      const offset = html`
        ${
          this.#choices(row).length > 1
            ? html`<wt-combobox
                ?preserve-order=${true /* Preserve repeated-time offsets. */}
                name=${`attendanceOffset${index}`}
                required
                .label=${t("attendance.offset")}
                .value=${row.offset}
                .disabled=${this.busy || this.blocked}
                .options=${this.#choices(row).map((choice) => ({ value: String(choice.offset), label: `${row.time} ${offsetLabel(choice.offset)}` }))}
                .error=${this.#feedback.attempted ? errors.rows[index]!.offset : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "offset")}
              ></wt-combobox>`
            : nothing
        }
      `;
      if (!manager)
        return html`<fieldset class="time-fields" ?disabled=${this.busy}>
          <legend>
            ${"missingKind" in row.target ? t(`clock.${row.target.missingKind}`) : t("attendance.original")}
          </legend>
          ${this.#dateField(row, index, t("attendance.date"), errors.rows[index]!.date)}${time}${offset}
        </fieldset>`;
      const previous = this.draft.rows[index - 1];
      const first = previous?.shift !== row.shift;
      const pair = !first && previous?.kind === "break_end" && row.kind === "break_start";
      return html`<div
        class=${pair ? "break-pair" : nothing}
        ?data-requested-time=${field?.requested}
      >
        <div class="time-row">
          <div>${time}</div>
          <div>
            ${this.#dateField(row, index, `${t("attendance.date")} · ${field!.label}`, errors.rows[index]!.date, first)}
          </div>
        </div>
        ${offset}
        ${field?.notes ? html`<p class="time-note">${field.notes} ${index === lastNote ? worked : nothing}</p>` : nothing}
        ${row.kind === "break_end" && !row.original.at ? html`<div class="shift-remove"><wt-button class="shift-action remove" variant="ghost" .disabled=${this.busy || this.blocked} @click=${() => this.#removeRows([index - 1, index])}>${t("hours.remove_break")}</wt-button></div>` : nothing}
      </div>`;
    });
    const shifts = this.#shifts();
    const fields = html` ${
        manager
          ? html`
              ${[...shifts].map(
                ([shift, indices], i) =>
                  html`<fieldset class="shift" aria-labelledby=${`shift-title-${shift}`}>
                    <legend>
                      <div class="shift-heading">
                        <span id=${`shift-title-${shift}`}
                          >${fill(t("hours.shift_number"), { number: String(i + 1) })}</span
                        >
                        ${indices.every((index) => !this.draft.rows[index]!.original.at) ? html`<wt-button class="shift-action remove" variant="ghost" .disabled=${this.busy || this.blocked} @click=${() => this.#removeRows(indices)}>${t("hours.remove_shift")}</wt-button>` : nothing}
                      </div>
                    </legend>
                    ${indices.map((index) => timeRows[index])}
                    <wt-button
                      class="shift-action"
                      variant="ghost"
                      .disabled=${this.busy || this.blocked}
                      @click=${() => this.#addPair(shift, "break_start", "break_end")}
                      >${t("hours.add_break")}</wt-button
                    >
                  </fieldset>`,
              )}
              <wt-button
                class="shift-action"
                variant="ghost"
                .disabled=${this.busy || this.blocked}
                @click=${() => this.#addPair(Math.max(-1, ...shifts.keys()) + 1, "in", "out")}
                >${t("hours.add_shift")}</wt-button
              >
            `
          : timeRows
      }
      ${lastNote === -1 && worked !== nothing ? html`<p>${worked}</p>` : nothing}
      ${manager ? html`<span class="spoken-total" aria-live="polite">${minutes === undefined ? pendingTotal : fill(t("hours.worked_would_be"), { time: formatDuration(minutes * 60_000, currentLocale()) })}</span>` : nothing}
      <div class=${manager ? "manager-reason" : nothing}>
        ${manager ? html`<span class="clock-label" aria-hidden="true">${t("hours.why")} <strong>*</strong></span>` : nothing}
        <wt-textarea
          .hideLabel=${!!manager}
          name="attendanceReason"
          required
          .label=${t(manager ? "hours.why" : "attendance.reason")}
          .value=${live(this.draft.reason)}
          .disabled=${this.busy || this.blocked}
          .error=${this.#feedback.attempted && errors.reason ? errors.reason : reasonRefusal}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, null, "reason")}
        ></wt-textarea>
      </div>`;
    const message = [invalid || reasonRefusal ? t("form.fix_fields") : "", error]
      .filter(Boolean)
      .join(" ");
    const retry =
      this.recovery === "retry"
        ? html`<wt-button
            slot="secondary"
            data-retry-command
            variant="primary"
            .disabled=${this.busy}
            @click=${(event: Event) => this.#retry(event, true)}
            >${t("attendance.retry_response")}</wt-button
          >`
        : nothing;
    const save = html`<wt-button
      data-save
      variant=${blocked && !this.busy ? "secondary" : action.variant}
      .disabled=${blocked}
      @click=${(event: Event) => void this.#save(event)}
      >${manager ? fill(t("hours.save_to_worker"), { name: manager.name }) : t("attendance.save")}</wt-button
    >`;
    const actions = manager
      ? html`${formMessage(message)}${retry}${save}`
      : html` <wt-form-actions .error=${message}>
          <wt-button
            slot="cancel"
            data-cancel
            variant="secondary"
            .disabled=${this.busy}
            @click=${this.#cancel}
            >${t("action.cancel")}</wt-button
          >
          ${this.recovery ? html`<wt-button slot="secondary" data-retry-read variant="secondary" .disabled=${this.busy} @click=${(event: Event) => this.#retry(event, false)}>${t("attendance.retry_read")}</wt-button>` : nothing}
          ${retry}${save}
        </wt-form-actions>`;
    const title = manager
      ? `${manager.name} · ${new Intl.DateTimeFormat(currentLocale(), {
          weekday: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(manager.view.date))}`
      : t(this.reasonOnly ? "attendance.disagree_heading" : "attendance.edit_heading");
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.open}
      .fullScreen=${!!manager}
      .beforeClose=${this.#beforeClose}
      .ariaLabel=${manager ? title : ""}
      .heading=${manager ? "" : title}
      @wt-close=${this.#closed}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector<HTMLElement>("[data-save]"))}
      >${
        manager
          ? html`<wt-full-screen-panel .bodyLabel=${title}>
              <section slot="header">
                <wt-top-bar
                  .heading=${title}
                  .backLabel=${t("hours.approval")}
                  .backDisabled=${this.busy}
                  @wt-back=${this.#cancel}
                ></wt-top-bar>
              </section>
              <div class="fields manager-fields">${fields}</div>
              <div slot="footer" class="manager-actions">${actions}</div>
            </wt-full-screen-panel>`
          : html`<div class="fields">${fields}${actions}</div>`
      }</wt-dialog
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-attendance-correction-dialog": AttendanceCorrectionDialog;
  }
}
