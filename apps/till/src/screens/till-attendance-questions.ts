import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { AttendanceInbox, AttendancePrompt } from "../api/client.js";
import { t } from "../i18n/t.js";
import { attendanceHistory } from "../widgets/attendance-history.js";
import { LocaleChangeController } from "../state/locale-controller.js";

@customElement("till-attendance-questions")
export class TillAttendanceQuestions extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding: var(--wt-space-4);
      }
      .content {
        max-width: var(--wt-form-max-width);
        display: grid;
        gap: var(--wt-space-4);
      }
      h1,
      h2,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h1 {
        font-size: var(--wt-font-size-xl);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
      article {
        display: grid;
        gap: var(--wt-space-3);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding-inline-start: var(--wt-space-4);
      }
      li {
        overflow-wrap: anywhere;
      }
      time {
        font-variant-numeric: tabular-nums;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) inbox: AttendanceInbox | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) blocked = false;
  @property({ type: Boolean }) canRetry = false;
  @property({ type: Boolean }) reading = false;
  @property() error = "";

  #emit(event: Event, type: string, detail: unknown = null): void {
    event.stopPropagation();
    if (
      !this.isConnected ||
      this.busy ||
      (this.reading && type !== "cancel-attendance") ||
      (this.blocked &&
        type !== "cancel-attendance" &&
        type !== "retry-attendance" &&
        type !== "retry-attendance-command")
    )
      return;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #prompt(prompt: AttendancePrompt) {
    const disabled = this.busy || this.reading || this.blocked;
    const item = this.inbox?.items.find((candidate) => candidate.id === prompt.itemId);
    const proposal = prompt.kind === "proposal";
    const pending = item?.direction === "manager_proposal" && item.status === "waiting-worker";
    return html`<article data-prompt=${prompt.id}>
      <h2>${prompt.locationName}</h2>
      ${prompt.businessDay ? html`<p>${t("attendance.work_day")}: ${prompt.businessDay}</p>` : nothing}
      ${prompt.kind === "automatic-out" ? html`<p>${t("attendance.automatic_counted")}</p>` : nothing}
      ${proposal ? html`<p>${t("attendance.proposal")}</p>` : nothing}
      ${prompt.kind === "missing-times" ? html`<p>${t("attendance.supply")}</p>` : nothing}
      ${
        prompt.history.length > 0
          ? html`<ul>
              ${prompt.history.map((entry) => attendanceHistory(entry))}
            </ul>`
          : nothing
      }
      ${proposal && item?.reason ? html`<p>${item.reason}</p>` : nothing}
      ${proposal && !pending ? html`<p>${t("attendance.overtaken")}</p>` : nothing}
      ${proposal && pending && !item.readyToApply ? html`<p>${t("attendance.sequence_blocked")}</p>` : nothing}
      <div class="actions">
        ${prompt.kind === "automatic-out" ? html`<wt-button data-confirm variant=${disabled ? "secondary" : "primary"} .disabled=${disabled} @click=${(event: Event) => this.#emit(event, "attendance-confirm", { questionId: prompt.questionId })}>${t("attendance.confirm")}</wt-button>` : nothing}
        ${!proposal ? html`<wt-button data-edit variant="secondary" .disabled=${disabled} @click=${(event: Event) => this.#emit(event, "attendance-edit", { prompt })}>${t(prompt.kind === "automatic-out" ? "attendance.different" : "attendance.supply")}</wt-button>` : nothing}
        ${
          pending
            ? html`
                <wt-button
                  data-accept
                  variant=${disabled || !item.readyToApply ? "secondary" : "primary"}
                  .disabled=${disabled || !item.readyToApply}
                  @click=${(event: Event) => this.#emit(event, "attendance-decide", { itemId: item.id, action: "accept" })}
                  >${t("attendance.accept")}</wt-button
                >
                <wt-button
                  data-disagree
                  variant="secondary"
                  .disabled=${disabled}
                  @click=${(event: Event) => this.#emit(event, "attendance-decide", { itemId: item.id, action: "disagree" })}
                  >${t("attendance.disagree")}</wt-button
                >
              `
            : nothing
        }
      </div>
    </article>`;
  }

  override render() {
    return html`<div class="content">
      <h1>${t("attendance.questions")}</h1>
      ${this.error ? html`<p role="status">${this.error}</p>` : this.reading ? html`<p role="status">${t("attendance.reading")}</p>` : nothing}
      ${this.inbox?.prompts.map((prompt) => this.#prompt(prompt))}
      <div class="actions">
        <wt-button
          data-cancel
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "cancel-attendance")}
          >${t("clock.cancel")}</wt-button
        >
        ${this.canRetry ? html`<wt-button data-retry-command variant="primary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#emit(event, "retry-attendance-command")}>${t("attendance.retry_response")}</wt-button>` : nothing}
        ${this.error ? html`<wt-button data-retry variant="secondary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#emit(event, "retry-attendance")}>${t("attendance.retry_read")}</wt-button>` : nothing}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-attendance-questions": TillAttendanceQuestions;
  }
}
