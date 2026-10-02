import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { DeadEndAnswer } from "../api/client.js";
import { t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";
import "./dead-ends-section.js";

export interface DeadEndsDecision {
  choices: Record<string, string>;
  removed: string[];
}

@customElement("till-dead-ends-dialog")
export class TillDeadEndsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) answer: DeadEndAnswer = {
    sends: false,
    deadEnds: [],
    stations: [],
  };
  @property({ type: Boolean }) allowRemove = false;
  @state() private choices = new Map<string, string>();
  @state() private removed = new Set<string>();

  #emit(type: "dead-ends-continue" | "dead-ends-cancel", detail?: DeadEndsDecision): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #choose(event: CustomEvent<{ key: string; stationId: string }>): void {
    const { key, stationId } = event.detail;
    const choices = new Map(this.choices);
    if (stationId) choices.set(key, stationId);
    else choices.delete(key);
    this.choices = choices;
  }

  #remove(event: CustomEvent<{ key: string }>): void {
    if (!this.allowRemove) return;
    this.removed = new Set([...this.removed, event.detail.key]);
  }

  #continue(): void {
    if (
      this.answer.deadEnds.some((row) => !this.removed.has(row.key) && !this.choices.has(row.key))
    )
      return;
    this.#emit("dead-ends-continue", {
      choices: Object.fromEntries(this.choices),
      removed: [...this.removed],
    });
  }

  override render() {
    const remaining = this.answer.deadEnds.filter((row) => !this.removed.has(row.key));
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("dead_end.title")}
      @wt-close=${() => this.#emit("dead-ends-cancel")}
    >
      <till-dead-ends-section
        .answer=${{ ...this.answer, deadEnds: remaining }}
        .choices=${this.choices}
        .allowRemove=${this.allowRemove}
        @make-at=${(event: CustomEvent<{ key: string; stationId: string }>) => this.#choose(event)}
        @remove=${(event: CustomEvent<{ key: string }>) => this.#remove(event)}
      ></till-dead-ends-section>
      <div slot="footer" class="actions">
        <wt-button data-cancel variant="secondary" @click=${() => this.#emit("dead-ends-cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-continue
          variant="primary"
          ?disabled=${remaining.some((row) => !this.choices.has(row.key))}
          @click=${() => this.#continue()}
          >${t("dead_end.continue")}</wt-button
        >
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-dead-ends-dialog": TillDeadEndsDialog;
  }
}
