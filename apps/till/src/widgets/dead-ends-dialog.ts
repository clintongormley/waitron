import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
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

  @state() private active = true;
  #scope?: DraftScope<DeadEndsDecision>;
  #leave?: LeaveCoordinator;
  #baseline?: DeadEndsDecision;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #draft(): DeadEndsDecision {
    return { choices: Object.fromEntries(this.choices), removed: [...this.removed] };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.active || this.#scope) return;
    this.#baseline ??= this.#draft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<DeadEndsDecision>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ choices: { ...value.choices }, removed: [...value.removed] }),
      equal: (a, b) =>
        Object.keys(a.choices).length === Object.keys(b.choices).length &&
        Object.entries(a.choices).every(([key, station]) => b.choices[key] === station) &&
        a.removed.length === b.removed.length &&
        a.removed.every((key) => b.removed.includes(key)),
      restore: (value) => {
        this.choices = new Map(Object.entries(value.choices));
        this.removed = new Set(value.removed);
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#emit("dead-ends-cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("dead-ends-cancel");
  }

  #emit(type: "dead-ends-continue" | "dead-ends-cancel", detail?: DeadEndsDecision): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #choose(event: CustomEvent<{ key: string; stationId: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    const { key, stationId } = event.detail;
    const choices = new Map(this.choices);
    if (stationId) choices.set(key, stationId);
    else choices.delete(key);
    this.choices = choices;
    this.#scope?.changed();
  }

  #remove(event: CustomEvent<{ key: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || !this.allowRemove) return;
    this.removed = new Set([...this.removed, event.detail.key]);
    this.#scope?.changed();
  }

  #continue(): void {
    if (!this.isConnected || !this.active) return;
    if (
      this.answer.deadEnds.some((row) => !this.removed.has(row.key) && !this.choices.has(row.key))
    )
      return;
    const submitted = this.#draft();
    this.#baseline = submitted;
    this.#scope?.commit(submitted);
    this.#emit("dead-ends-continue", submitted);
  }

  override render() {
    const remaining = this.answer.deadEnds.filter((row) => !this.removed.has(row.key));
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t("dead_end.title")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <till-dead-ends-section
        .answer=${{ ...this.answer, deadEnds: remaining }}
        .choices=${this.choices}
        .allowRemove=${this.allowRemove}
        @make-at=${(event: CustomEvent<{ key: string; stationId: string }>) => this.#choose(event)}
        @remove=${(event: CustomEvent<{ key: string }>) => this.#remove(event)}
      ></till-dead-ends-section>
      <div slot="footer" class="actions">
        <wt-button data-cancel variant="secondary" @click=${() => this.#cancel()}
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
