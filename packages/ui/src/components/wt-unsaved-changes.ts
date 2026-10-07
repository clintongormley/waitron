import { LitElement, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { LeaveDecision } from "@waitron/ui-core/unsaved-changes";
import { WtModal } from "./wt-modal.js";
import { WtButton } from "./wt-button.js";
import "./wt-form-actions.js";

@customElement("wt-unsaved-changes")
export class WtUnsavedChanges extends LitElement {
  @property({ type: Boolean }) open = false;
  @property() heading = "";
  @property() message = "";
  @property() keepLabel = "";
  @property() discardLabel = "";

  @query("wt-modal") private modal!: WtModal;
  @query('[data-choice="keep"]') private keep!: WtButton;
  private answered = false;

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) {
      this.answered = false;
      void this.focusKeep();
    }
  }

  private async focusKeep(): Promise<void> {
    await this.modal.updateComplete;
    await this.keep.updateComplete;
    if (this.open && this.isConnected) this.keep.focus();
  }

  private choose(event: Event, decision: LeaveDecision): void {
    event.stopPropagation();
    if (!this.open || this.answered) return;
    this.answered = true;
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("wt-unsaved-choice", {
        detail: { decision },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <wt-modal
        size="compact"
        .open=${this.open}
        .heading=${this.heading}
        .description=${this.message}
        @wt-close=${(event: Event) => this.choose(event, "keep")}
      >
        <wt-form-actions slot="footer">
          <wt-button
            data-choice="keep"
            slot="cancel"
            variant="secondary"
            @click=${(event: Event) => this.choose(event, "keep")}
            >${this.keepLabel}</wt-button
          >
          <wt-button
            data-choice="discard"
            variant="danger"
            @click=${(event: Event) => this.choose(event, "discard")}
            >${this.discardLabel}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-unsaved-changes": WtUnsavedChanges;
  }
}
