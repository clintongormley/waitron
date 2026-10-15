import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { AttendanceChange, AttendanceDayView } from "@waitron/dashboard-modules";
import { t } from "../i18n/t.js";
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
  @property() purpose: "propose" | "request" = "propose";
  @property() timeZone = "UTC";
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) blocked = false;
  @property({ attribute: false }) recovery: "uncertain" | "retry" | null = null;
  @property() reasonRefusal = "";
  @state() private reasonEdited = false;
  @property({ type: Boolean }) reasonOnly = false;
  @property() error = "";
  @state() private draft: Draft = { rows: [], reason: "" };
  @state() private attempted = false;
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
    if (changed.has("reasonRefusal")) this.reasonEdited = false;
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.#opened = false;
      this.#baseline = undefined;
      this.draft = { rows: [], reason: "" };
      this.attempted = false;
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
      this.attempted = false;
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
    if (changes?.length === 2 && Date.parse(changes[1]!.at) <= Date.parse(changes[0]!.at))
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
    if (index === null) this.reasonEdited = true;
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
    this.attempted = true;
    if (this.#invalid()) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("proposal-save", {
        detail: { changes: this.#changes()!, reason: this.draft.reason.trim() },
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
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("proposal-cancel", { bubbles: true, composed: true }));
  }
  override render() {
    const errors = this.#errors();
    const action = saveActionState(this.#scope);
    const invalid = this.attempted && this.#invalid();
    const reasonRefusal = this.reasonEdited ? "" : this.reasonRefusal;
    const error = this.reasonRefusal ? "" : this.error;
    return html`<wt-dialog
      .open=${this.open}
      .beforeClose=${this.#beforeClose}
      .heading=${t(this.reasonOnly ? "attendance.disagree_heading" : this.purpose === "request" ? "attendance.request_heading" : "attendance.edit_heading")}
      @wt-close=${this.#closed}
    >
      <div
        class="fields"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-save]"))}
      >
        ${this.draft.rows.map(
          (row, index) =>
            html`<fieldset class="time-fields" ?disabled=${this.busy}>
              <legend>
                ${"missingKind" in row.target ? t(`clock.${row.target.missingKind}`) : t("attendance.original")}
              </legend>
              <wt-input
                name=${`attendanceDate${index}`}
                type="date"
                required
                .label=${t("attendance.date")}
                .value=${live(row.date)}
                .disabled=${this.busy || this.blocked}
                .error=${this.attempted ? errors.rows[index]!.date : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "date")}
              ></wt-input>
              <wt-input
                name=${`attendanceTime${index}`}
                type="time"
                required
                .label=${t("attendance.time")}
                .value=${live(row.time)}
                .disabled=${this.busy || this.blocked}
                .error=${this.attempted ? errors.rows[index]!.time : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "time")}
              ></wt-input>
              ${this.#choices(row).length > 1 ? html`<wt-combobox name=${`attendanceOffset${index}`} required .label=${t("attendance.offset")} .value=${row.offset} .disabled=${this.busy} .options=${this.#choices(row).map((choice) => ({ value: String(choice.offset), label: `${row.time} ${offsetLabel(choice.offset)}` }))} .error=${this.attempted ? errors.rows[index]!.offset : ""} @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "offset")}></wt-combobox>` : nothing}
            </fieldset>`,
        )}
        <wt-textarea
          name="attendanceReason"
          required
          .label=${t("attendance.reason")}
          .value=${live(this.draft.reason)}
          .disabled=${this.busy || this.blocked}
          .error=${this.attempted && errors.reason ? errors.reason : reasonRefusal}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, null, "reason")}
        ></wt-textarea>
        <wt-form-actions
          .error=${[invalid || reasonRefusal ? t("form.fix_fields") : "", error].filter(Boolean).join(" ")}
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
            .disabled=${this.busy || this.blocked || action.unchanged || invalid}
            @click=${(event: Event) => void this.#save(event)}
            >${t("attendance.save")}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-attendance-proposal-dialog": AttendanceProposalDialog;
  }
}
