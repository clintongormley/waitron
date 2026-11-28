import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import type { AttendanceInbox, AttendancePrompt } from "../api/client.js";
import { t } from "../i18n/t.js";
import {
  attendanceDateInWords,
  questionAttendanceHistory,
  questionAttendanceProposal,
} from "../widgets/attendance-history.js";
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
        display: flex;
        flex: 1;
        flex-direction: column;
        min-block-size: 0;
      }
      main {
        flex: 1;
        overflow: auto;
        padding: calc(var(--wt-space-4) + var(--wt-space-1) / 2) var(--wt-space-4) var(--wt-space-5);
      }
      .content {
        max-inline-size: var(--wt-form-max-width);
        margin-inline: auto;
        display: grid;
        gap: var(--wt-space-3);
      }
      header {
        display: grid;
        gap: var(--wt-space-1);
      }
      h1,
      h2,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h1 {
        font-size: calc(var(--wt-font-size-xl) + var(--wt-space-1) / 2);
      }
      h2 {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        letter-spacing: var(--wt-letter-spacing-caps);
        text-transform: uppercase;
      }
      article {
        display: grid;
        gap: var(--wt-space-3);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: calc(var(--wt-radius-md) + var(--wt-space-1));
        background: var(--wt-color-surface);
      }
      ul {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .short-time {
        font-weight: var(--wt-font-weight-bold);
      }
      li {
        font-size: var(--wt-menu-row-label-size);
        overflow-wrap: anywhere;
      }
      time {
        font-variant-numeric: tabular-nums;
      }
      .actions {
        display: grid;
        gap: var(--wt-space-2);
        --wt-tap-min: calc(var(--wt-field-height) - var(--wt-space-1));
        --wt-action-font-size: var(--wt-menu-row-label-size);
      }
      wt-foot-button-bar {
        inline-size: min(100%, var(--wt-form-max-width));
        margin-inline: auto;
      }
      [slot="link"] {
        --wt-action-font-size: calc(var(--wt-font-size-md) + var(--wt-space-1) / 4);
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

  #prompt(prompt: AttendancePrompt, pendingProposalEntries: ReadonlySet<string>) {
    const disabled = this.busy || this.reading || this.blocked;
    const item = this.inbox?.items.find((candidate) => candidate.id === prompt.itemId);
    const proposal = prompt.kind === "proposal";
    const pending = item?.direction === "manager_proposal" && item.status === "waiting-worker";
    const history = prompt.history.filter((entry) => !pendingProposalEntries.has(entry.entryId));
    const lines =
      proposal && item
        ? questionAttendanceProposal(item, prompt.timeZone)
        : questionAttendanceHistory({ ...prompt, history }, this.inbox?.items ?? []);
    return html`<article data-prompt=${prompt.id}>
      ${prompt.businessDay ? html`<h2>${attendanceDateInWords(prompt.businessDay)}</h2>` : nothing}
      ${proposal && !item ? html`<p>${t("attendance.proposal")}</p>` : nothing}
      ${prompt.kind === "missing-times" ? html`<p class="muted">${t(history.length ? "attendance.some_times_missing" : "attendance.no_times_recorded")}</p>` : nothing}
      ${
        lines.length
          ? html`<ul role="list">
              ${lines}
            </ul>`
          : nothing
      }
      ${proposal && !pending ? html`<p>${t("attendance.overtaken")}</p>` : nothing}
      ${proposal && pending && !item.readyToApply ? html`<p>${t("attendance.sequence_blocked")}</p>` : nothing}
      <div class="actions">
        ${prompt.kind === "automatic-out" ? html`<wt-button data-confirm variant=${disabled ? "secondary" : "primary"} .disabled=${disabled} @click=${(event: Event) => this.#emit(event, "attendance-confirm", { questionId: prompt.questionId })}>${t("attendance.confirm")}</wt-button>` : nothing}
        ${!proposal ? html`<wt-button data-edit variant="secondary" .disabled=${disabled} @click=${(event: Event) => this.#emit(event, "attendance-edit", { prompt })}>${t(prompt.kind === "automatic-out" ? "attendance.different" : "attendance.add_missing_times")}</wt-button>` : nothing}
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
    const pendingProposalEntries = new Set(
      this.inbox?.items.flatMap((item) =>
        item.status === "waiting-worker" ? item.requestEntryIds : [],
      ),
    );
    return html`
      <main>
        <div class="content">
          <header>
            <h1>${t("attendance.questions")}</h1>
            ${this.inbox?.prompts.length ? html`<p class="muted">${t("attendance.questions_intro")}</p>` : nothing}
          </header>
          ${this.error ? html`<p role="status">${this.error}</p>` : this.reading ? html`<p role="status">${t("attendance.reading")}</p>` : nothing}
          ${this.inbox?.prompts.map((prompt) => this.#prompt(prompt, pendingProposalEntries))}
        </div>
      </main>
      <wt-foot-button-bar>
        ${this.canRetry ? html`<wt-button data-retry-command variant="primary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#emit(event, "retry-attendance-command")}>${t("attendance.retry_response")}</wt-button>` : nothing}
        ${this.error ? html`<wt-button data-retry variant="secondary" .disabled=${this.busy || this.reading} @click=${(event: Event) => this.#emit(event, "retry-attendance")}>${t("attendance.retry_read")}</wt-button>` : nothing}
        <wt-button
          data-cancel
          slot="link"
          variant="ghost"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#emit(event, "cancel-attendance")}
          >${t("attendance.answer_later")}</wt-button
        >
      </wt-foot-button-bar>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-attendance-questions": TillAttendanceQuestions;
  }
}
