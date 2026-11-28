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
import { previewDayMinutes } from "@waitron/workforce/attendance-day-edit";
import { localTimeOccurrences, offsetMinutes } from "@waitron/venue-service/hours-occurrences";
import type { AttendanceChange } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import {
  clockKinds,
  managerDayEdits,
  managerDayField,
  managerDayRows,
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
      .dates summary {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        min-block-size: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
        cursor: pointer;
        font-weight: var(--wt-font-weight-bold);
        list-style: none;
      }
      .dates summary::-webkit-details-marker {
        display: none;
      }
      .dates[open] summary wt-icon {
        rotate: 180deg;
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
        rows: (this.managerDay
          ? managerDayRows(this.managerDay)
          : this.reasonOnly
            ? []
            : this.initialChanges
        ).map((change) => timeDraft(change)),
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
    if (changes?.length === 2 && Date.parse(changes[1]!.at) <= Date.parse(changes[0]!.at)) {
      const day = this.managerDay;
      if (
        !day ||
        this.draft.rows.every(
          (row, i) =>
            managerDayField(day, row.target, row.date, row.time).kind === (i === 0 ? "in" : "out"),
        )
      )
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
    this.#feedback.press();
    if (this.#invalid()) {
      if (this.managerDay && this.#errors().rows.some(({ date }) => date))
        this.renderRoot.querySelector<HTMLDetailsElement>(".dates")!.open = true;
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
  #addTime(event: CustomEvent<{ value: (typeof clockKinds)[number] }>, date: string): void {
    if (!clockKinds.includes(event.detail.value) || this.busy || this.blocked) return;
    this.draft = {
      ...this.draft,
      rows: [
        ...this.draft.rows,
        timeDraft({ target: { missingKind: event.detail.value }, at: "", offsetMinutes: 0 }, date),
      ],
    };
    this.#scope?.changed();
  }

  #dateField(row: TimeDraft, index: number, label: string, error: string) {
    return html`${this.managerDay ? html`<span class="clock-label" aria-hidden="true">${label} <strong>*</strong></span>` : nothing}
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
    const dayFields =
      manager?.view &&
      this.draft.rows.map((row) => managerDayField(manager, row.target, row.date, row.time));
    const lastNote =
      dayFields?.reduce((last, { notes }, index) => (notes ? index : last), -1) ?? -1;
    const minutes = manager && all ? previewDayMinutes(manager.view, all) : undefined;
    const worked =
      minutes === undefined
        ? nothing
        : html` <span aria-hidden="true"
            >${fill(t("hours.worked_would_be"), {
              time: `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`,
            })}</span
          >`;
    const fields = html` ${this.draft.rows.map((row, index) => {
        const field = dayFields?.[index];
        const label = field
          ? row.date && row.date !== manager?.view.date
            ? `${field.label} · ${row.date}`
            : field.label
          : t("attendance.time");
        const times = html`
          ${manager ? html`<span class="clock-label" aria-hidden="true">${label} <strong>*</strong></span>` : nothing}
          <wt-input
            name=${`attendanceTime${index}`}
            type="time"
            required
            .label=${label}
            .variant=${manager ? "outlined" : "filled"}
            .value=${live(row.time)}
            .disabled=${this.busy || this.blocked}
            .error=${this.#feedback.attempted ? errors.rows[index]!.time : ""}
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
                  .disabled=${this.busy || this.blocked}
                  .options=${this.#choices(row).map((choice) => ({ value: String(choice.offset), label: `${row.time} ${offsetLabel(choice.offset)}` }))}
                  .error=${this.#feedback.attempted ? errors.rows[index]!.offset : ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit(event, index, "offset")}
                ></wt-combobox>`
              : nothing
          }
          ${field?.notes ? html`<p class="time-note">${field.notes} ${index === lastNote ? worked : nothing}</p>` : nothing}
          ${
            manager && "missingKind" in row.target && !field?.requiredTarget
              ? html`<wt-button
                  variant="ghost"
                  .disabled=${this.busy || this.blocked}
                  @click=${() => {
                    this.draft = {
                      ...this.draft,
                      rows: this.draft.rows.filter((_, i) => i !== index),
                    };
                    this.#scope?.changed();
                  }}
                  >${t("hours.remove_time")}</wt-button
                >`
              : nothing
          }
        `;
        return manager
          ? html`<div>${times}</div>`
          : html`<fieldset class="time-fields" ?disabled=${this.busy}>
              <legend>
                ${"missingKind" in row.target ? t(`clock.${row.target.missingKind}`) : t("attendance.original")}
              </legend>
              ${this.#dateField(row, index, t("attendance.date"), errors.rows[index]!.date)}${times}
            </fieldset>`;
      })}
      ${lastNote === -1 && worked !== nothing ? html`<p>${worked}</p>` : nothing}
      ${manager ? html`<span class="spoken-total" aria-live="polite">${minutes === undefined ? "" : fill(t("hours.worked_would_be"), { time: formatDuration(minutes * 60_000, currentLocale()) })}</span>` : nothing}
      <div>
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
      </div>
      ${
        manager
          ? html`<details class="dates">
                <summary>
                  ${t("hours.edit_dates")}
                  <wt-icon name="chevron-down" aria-hidden="true"></wt-icon>
                </summary>
                ${this.draft.rows.map((row, index) => {
                  const label = dayFields![index]!.label;
                  return this.#dateField(
                    row,
                    index,
                    `${t("attendance.date")} · ${label}`,
                    errors.rows[index]!.date,
                  );
                })}
              </details>
              <wt-combobox
                name="missingTime"
                .placeholder=${t("hours.add_time")}
                .value=${live("")}
                .disabled=${this.busy || this.blocked}
                .options=${clockKinds.filter((kind) => !this.draft.rows.some(({ target }) => "missingKind" in target && target.missingKind === kind)).map((kind) => ({ value: kind, label: t(`hours.entry_${kind}`) }))}
                @wt-change=${(event: CustomEvent<{ value: (typeof clockKinds)[number] }>) => this.#addTime(event, manager.view.date)}
              ></wt-combobox>`
          : nothing
      }`;
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
