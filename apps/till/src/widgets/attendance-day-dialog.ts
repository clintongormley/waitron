import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import type {
  AttendanceDayView,
  AttendanceInbox,
  AttendanceChange,
  CorrectionItem,
} from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";
import { attendanceHistory, attendanceStatus, storedAttendanceTime } from "./attendance-history.js";

export type FixEntryDetail =
  { target: AttendanceChange["target"] } | { targets: AttendanceChange["target"][] };

@customElement("till-attendance-day-dialog")
export class AttendanceDayDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      .body,
      .selectors,
      article,
      ul {
        display: grid;
        gap: var(--wt-space-3);
      }
      .body {
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      h2,
      p,
      ul {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      article {
        padding-block: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }
      ul {
        padding-inline-start: var(--wt-space-4);
      }
      li {
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      time {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) view: AttendanceDayView | null = null;
  @property({ attribute: false }) locations: AttendanceInbox["locations"] = [];
  @property() date = "";
  @property() locationId = "";
  @property({ type: Boolean }) reading = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) blocked = false;
  @property({ type: Boolean }) canRetry = false;
  @property() error = "";
  readonly #beforeClose = (): boolean => !this.busy;

  #current(): boolean {
    return (
      this.isConnected &&
      this.open &&
      !this.busy &&
      !this.blocked &&
      !this.reading &&
      this.view !== null &&
      this.view.date === this.date &&
      this.view.locationId === this.locationId
    );
  }
  #emit(event: Event, type: string, detail: unknown): void {
    event.stopPropagation();
    if (!this.#current()) return;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #select(event: CustomEvent<{ value: string }>, field: "date" | "locationId"): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy) return;
    if (
      field === "locationId" &&
      !this.locations.some((location) => location.id === event.detail.value)
    )
      return;
    this[field] = event.detail.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date) || !this.locationId) return;
    this.dispatchEvent(
      new CustomEvent("attendance-day", {
        detail: { date: this.date, locationId: this.locationId },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #retry(event: Event, command: boolean): void {
    event.stopPropagation();
    if (!this.isConnected || !this.open || this.busy || this.reading) return;
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
    this.dispatchEvent(new CustomEvent("attendance-day-close", { bubbles: true, composed: true }));
  }
  #item(item: CorrectionItem) {
    const pending = item.direction === "worker_request" && item.status === "waiting-manager";
    return html`<article data-item=${item.id}>
      <h2>${attendanceStatus(item.status)}</h2>
      ${item.selfApproved ? html`<p>${t("attendance.self_approved")}</p>` : nothing}
      <p>${item.reason}</p>
      <ul>
        ${item.history.map(attendanceHistory)}
      </ul>
      ${
        pending
          ? html`<div class="actions">
              <wt-button
                data-approve
                variant=${this.busy || this.blocked || !item.readyToApply ? "secondary" : "primary"}
                .disabled=${this.busy || this.blocked || !item.readyToApply}
                @click=${(event: Event) => this.#emit(event, "decide-item", { itemId: item.id, action: "approve" })}
                >${t("attendance.approve")}</wt-button
              >
              <wt-button
                data-decline
                variant="secondary"
                .disabled=${this.busy || this.blocked}
                @click=${(event: Event) => this.#emit(event, "decide-item", { itemId: item.id, action: "decline" })}
                >${t("attendance.decline")}</wt-button
              >
            </div>`
          : nothing
      }
    </article>`;
  }
  override render() {
    const matches =
      !this.reading &&
      this.view !== null &&
      this.view.date === this.date &&
      this.view.locationId === this.locationId;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.open}
      .beforeClose=${this.#beforeClose}
      .heading=${t("attendance.fix_hours")}
      @wt-close=${this.#closed}
    >
      <div class="body">
        <div class="selectors">
          <wt-combobox
            name="attendanceLocation"
            required
            .label=${t("attendance.location")}
            .value=${this.locationId}
            .options=${this.locations.map((location) => ({ value: location.id, label: location.name }))}
            .disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#select(event, "locationId")}
          ></wt-combobox>
          <wt-input
            name="attendanceDay"
            type="date"
            required
            .label=${t("attendance.date")}
            .value=${this.date}
            .disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#select(event, "date")}
          ></wt-input>
        </div>
        ${this.error ? html`<p role="status">${this.error}</p>` : this.reading ? html`<p role="status">${t("attendance.reading")}</p>` : nothing}
        ${
          matches
            ? html`
                ${this.view!.record.entries.filter((row) => row.effective).map(
                  (row) =>
                    html`<article data-effective=${row.entry.entryId}>
                      <time datetime=${row.entry.eventAt}
                        >${storedAttendanceTime(row.entry.eventAt, row.entry.offsetMinutes)}</time
                      >
                      ${row.author.kind === "automatic" ? html`<p>${t("attendance.automatic_counted")}</p>` : nothing}
                      ${row.confirmedByWorker ? html`<p>${t("attendance.confirmed_by_worker")}</p>` : nothing}
                      ${row.selfApproved ? html`<p>${t("attendance.self_approved")}</p>` : nothing}
                      ${row.disputed ? html`<p>${t("attendance.disputed")}</p>` : nothing}
                      ${row.corrected ? html`<p>${t("attendance.corrected")}</p>` : nothing}
                      <wt-button
                        data-fix-entry
                        variant="secondary"
                        .disabled=${this.busy || this.blocked}
                        @click=${(event: Event) => this.#emit(event, "fix-entry", { target: { entryId: row.entry.entryId } })}
                        >${t("attendance.fix_time")}</wt-button
                      >
                    </article>`,
                )}
                ${this.view!.record.entries.some((row) => row.effective) ? nothing : html`<p>${t("attendance.no_times")}</p>`}
                <div class="actions">
                  ${(["in", "out", "break_start", "break_end"] as const).map((kind) => html`<wt-button data-add-kind=${kind} variant="secondary" .disabled=${this.busy || this.blocked} @click=${(event: Event) => this.#emit(event, "fix-entry", { target: { missingKind: kind } })}>${t(`clock.${kind}`)}</wt-button>`)}
                  <wt-button
                    data-add-pair="shift"
                    variant="secondary"
                    .disabled=${this.busy || this.blocked}
                    @click=${(event: Event) => this.#emit(event, "fix-entry", { targets: [{ missingKind: "in" }, { missingKind: "out" }] })}
                    >${t("attendance.add_shift")}</wt-button
                  >
                  <wt-button
                    data-add-pair="break"
                    variant="secondary"
                    .disabled=${this.busy || this.blocked}
                    @click=${(event: Event) => this.#emit(event, "fix-entry", { targets: [{ missingKind: "break_start" }, { missingKind: "break_end" }] })}
                    >${t("attendance.add_break")}</wt-button
                  >
                </div>
                ${this.view!.items.map((item) => this.#item(item))}
              `
            : nothing
        }
        <wt-form-actions>
          ${this.error ? html`<wt-button slot="secondary" data-retry variant="secondary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#retry(event, false)}>${t("attendance.retry_read")}</wt-button>` : nothing}
          ${this.canRetry ? html`<wt-button data-retry-command variant="primary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#retry(event, true)}>${t("attendance.retry_response")}</wt-button>` : nothing}
          <wt-button
            slot="cancel"
            data-close
            variant="secondary"
            .disabled=${this.busy}
            @click=${this.#cancel}
            >${t("action.cancel")}</wt-button
          ></wt-form-actions
        >
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-attendance-day-dialog": AttendanceDayDialog;
  }
}
