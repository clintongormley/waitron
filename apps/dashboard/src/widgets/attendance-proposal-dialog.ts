import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  pageTitleStyles,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { AttendanceChange, AttendanceDayView } from "@waitron/dashboard-modules";
import { currentLocale, fill, t } from "../i18n/t.js";
import { formatDuration } from "@waitron/shared";
import { hoursTime } from "../hours-format.js";
import {
  attendanceDayEditorStyles,
  previewDayMinutes,
  renderAttendanceDayEditor,
} from "../screens/attendance-day-editor.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { LocaleChangeController } from "../state/locale-controller.js";

interface TimeDraft {
  target: AttendanceChange["target"];
  date: string;
  time: string;
  offset: string;
  original: AttendanceChange;
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
function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}
function validTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}
function offsetLabel(offset: number): string {
  const absolute = Math.abs(offset);
  return `${offset < 0 ? "-" : "+"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

@customElement("dashboard-attendance-proposal-dialog")
export class AttendanceProposalDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    pageTitleStyles,
    attendanceDayEditorStyles,
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
  @property({ attribute: false }) view: AttendanceDayView | null = null;
  @property({ attribute: false }) initialChanges: AttendanceChange[] = [];
  @property() workerName = "";
  @property({ attribute: false }) requestedChanges: AttendanceChange[] = [];
  @property() purpose: "propose" | "request" = "propose";
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
      if (changed.has("open")) this.#feedback.reset();
      return;
    }
    if (!this.#opened) {
      this.#opened = true;
      this.#zone = this.view?.timeZone ?? this.timeZone;
      this.draft = {
        rows: (this.reasonOnly ? [] : this.initialChanges).map((change) => {
          const wall = wallTime(change);
          return {
            target: structuredClone(change.target),
            date: wall.slice(0, 10),
            time: wall.slice(11, 16),
            offset: wall ? String(change.offsetMinutes) : "",
            original: structuredClone(change),
          };
        }),
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
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
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
    if (changed.has("open") && this.open && this.workerName)
      this.shadowRoot?.querySelector<HTMLElement>("h1")?.focus();
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
  #changes(all = false): AttendanceChange[] | null {
    const result: AttendanceChange[] = [];
    for (const row of this.draft.rows) {
      const choice = this.#choices(row).find((choice) => String(choice.offset) === row.offset);
      if (!choice) return null;
      const recorded = this.#recorded(row);
      if (
        this.workerName &&
        !all &&
        !this.#requested(row) &&
        recorded?.eventAt === choice.at &&
        recorded.offsetMinutes === choice.offset
      )
        continue;
      result.push({
        target: structuredClone(row.target),
        at: choice.at,
        offsetMinutes: choice.offset,
      });
    }
    return result;
  }

  #recorded({ target }: TimeDraft) {
    return "entryId" in target
      ? this.view?.record.entries.find(({ entry }) => entry.entryId === target.entryId)?.entry
      : undefined;
  }
  #requested({ target }: TimeDraft) {
    return this.requestedChanges.find(({ target: candidate }) =>
      "entryId" in target
        ? "entryId" in candidate && candidate.entryId === target.entryId
        : "missingKind" in candidate && candidate.missingKind === target.missingKind,
    );
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
    if (
      this.draft.rows.length === 2 &&
      this.draft.rows.every(({ target }) => "missingKind" in target) &&
      changes?.length === 2 &&
      Date.parse(changes[1]!.at) <= Date.parse(changes[0]!.at)
    )
      rows[1]!.time = t("attendance.time_order");
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
    ...field: [null, "reason"] | [number, "date" | "time" | "offset"]
  ): void {
    const [index, key] = field;
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy || this.blocked) return;
    if (index === null) this.#feedback.dismiss("reason");
    if (index === null) this.draft = { ...this.draft, reason: event.detail.value };
    else {
      const rows = this.draft.rows.map((row) => ({ ...row }));
      const row = rows[index]!;
      row[key] = event.detail.value;
      if (key !== "offset") {
        const choices = this.#choices(row);
        const originalWall = wallTime(row.original);
        row.offset =
          originalWall &&
          row.date === originalWall.slice(0, 10) &&
          row.time === originalWall.slice(11, 16)
            ? String(row.original.offsetMinutes)
            : choices.length === 1
              ? String(choices[0]!.offset)
              : "";
      }
      this.draft = { ...this.draft, rows };
    }
    this.#scope?.changed();
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
    const changes = this.#changes();
    if (this.workerName && changes?.length === 0) return;
    this.#feedback.press();
    if (this.#invalid()) {
      await this.#feedback.focus(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("proposal-save", {
        detail: { changes: changes!, reason: this.draft.reason.trim() },
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
    if (this.workerName) void this.#closePage("cancel");
    else void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }
  async #closePage(reason: LeaveReason): Promise<void> {
    if ((await this.#beforeClose(reason)) && this.isConnected && this.open) this.#notifyClose();
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.open) return;
    this.#notifyClose();
  }
  #notifyClose(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent("proposal-cancel", { bubbles: true, composed: true }));
  }
  override render() {
    const errors = this.#errors();
    const action = saveActionState(this.#scope);
    const attempted = this.#feedback.attempted;
    const invalid = attempted && this.#invalid();
    const reasonRefusal = this.#feedback.shows("reason") ? this.reasonRefusal : "";
    const error = this.reasonRefusal ? "" : this.error;
    const all = this.workerName ? this.#changes(true) : null;
    const timeLabel = (at: string, offset: number) =>
      hoursTime(at, offset, this.#zone, this.view?.date);
    const fields = html`<div
      class="fields"
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-save]"))}
    >
      ${this.draft.rows.map((row, index) => {
        const recorded = this.#recorded(row);
        const requested = this.#requested(row);
        const kind =
          "missingKind" in row.target
            ? row.target.missingKind
            : (recorded?.extension?.missingEntryKind ?? recorded?.entryKind);
        return html`<fieldset class="time-fields" ?disabled=${this.busy}>
          <legend>
            ${kind === "in" || kind === "out" || kind === "break_start" || kind === "break_end" ? t(`clock.${kind}`) : t("attendance.original")}
          </legend>
          ${this.workerName && recorded ? html`<p>${fill("attendance.waitron_recorded", { time: timeLabel(recorded.eventAt, recorded.offsetMinutes) })}</p>` : nothing}
          ${this.workerName && requested?.at ? html`<p>${fill("attendance.worker_asked_time", { time: timeLabel(requested.at, requested.offsetMinutes) })}</p>` : nothing}
          <wt-input
            name=${`attendanceDate${index}`}
            type="date"
            required
            .label=${t("attendance.date")}
            .value=${live(row.date)}
            .disabled=${this.busy || this.blocked}
            .error=${attempted ? errors.rows[index]!.date : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "date")}
          ></wt-input>
          <wt-input
            name=${`attendanceTime${index}`}
            type="time"
            required
            .label=${t("attendance.time")}
            .value=${live(row.time)}
            .disabled=${this.busy || this.blocked}
            .error=${attempted ? errors.rows[index]!.time : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "time")}
          ></wt-input>
          ${
            this.#choices(row).length > 1
              ? html`<wt-combobox
                  ?preserve-order=${true /* Preserve repeated-time offsets. */}
                  name=${`attendanceOffset${index}`}
                  required
                  .label=${t("attendance.offset")}
                  .value=${row.offset}
                  .disabled=${this.busy}
                  .options=${this.#choices(row).map((choice) => ({ value: String(choice.offset), label: `${row.time} ${offsetLabel(choice.offset)}` }))}
                  .error=${attempted ? errors.rows[index]!.offset : ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "offset")}
                ></wt-combobox>`
              : nothing
          }
        </fieldset>`;
      })}
      ${all && this.view ? html`<p>${fill("attendance.worked_would_be", { total: formatDuration(previewDayMinutes(this.view, all) * 60_000, currentLocale()) })}</p>` : nothing}
      <wt-textarea
        name="attendanceReason"
        required
        .label=${t(this.workerName ? "attendance.why" : "attendance.reason")}
        .value=${live(this.draft.reason)}
        .disabled=${this.busy || this.blocked}
        .error=${attempted && errors.reason ? errors.reason : reasonRefusal}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, null, "reason")}
      ></wt-textarea>
      <wt-form-actions
        .error=${this.#feedback.message({ error }, new Set(invalid || reasonRefusal ? ["fields"] : []), t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-cancel
          variant="secondary"
          .disabled=${this.busy}
          @click=${this.#cancel}
          >${t("action.cancel")}</wt-button
        >
        ${this.recovery ? html`<wt-button slot="secondary" data-retry-read variant="secondary" .disabled=${this.busy} @click=${(event: Event) => this.#retry(event, false)}>${t("attendance.retry_read")}</wt-button>` : nothing}
        ${this.recovery === "retry" ? html`<wt-button slot="secondary" data-retry-command variant="primary" .disabled=${this.busy} @click=${(event: Event) => this.#retry(event, true)}>${t("attendance.retry_response")}</wt-button>` : nothing}
        <wt-button
          data-save
          variant=${action.variant}
          .disabled=${this.busy || this.blocked || action.unchanged || invalid || (!!this.workerName && this.#changes()?.length === 0)}
          @click=${(event: Event) => void this.#save(event)}
          >${this.workerName ? fill("attendance.save_and_send", { name: this.workerName }) : t("attendance.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
    if (this.workerName)
      return this.open && this.view
        ? renderAttendanceDayEditor(this.workerName, this.view.date, fields, (event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            void this.#closePage("escape");
          })
        : nothing;
    return html`<wt-dialog
      .open=${this.open}
      .beforeClose=${this.#beforeClose}
      .heading=${t(this.reasonOnly ? "attendance.disagree_heading" : this.purpose === "request" ? "attendance.request_heading" : "attendance.edit_heading")}
      @wt-close=${this.#closed}
      >${fields}</wt-dialog
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-attendance-proposal-dialog": AttendanceProposalDialog;
  }
}
