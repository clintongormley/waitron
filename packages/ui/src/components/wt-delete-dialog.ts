import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { DeleteImpact, DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
import type { WtModal } from "./wt-modal.js";
import type { WtButton } from "./wt-button.js";
import "./wt-modal.js";
import "./wt-button.js";
import "./wt-form-actions.js";
import "./wt-spinner.js";

/** Every fixed word the dialog shows, in the screen's language; the record's own name comes from the
 * impact's `target.name`. `item` and `refusal` write one whole line each, names included; the dialog
 * adds no words of its own. */
export type DeleteDialogCopy = {
  heading: string;
  refusals: string;
  ends: string;
  removes: string;
  irreversible: string;
  cancel: string;
  confirm: string;
  retry: string;
  loading: string;
  item: (item: DeleteImpactItem) => string;
  refusal: (item: DeleteImpactRefusal) => string;
};

/** Asks before deleting a record, naming it and showing what refuses the delete, the work it ends
 * and the settings it removes. The parent reads the impact, sends the delete and closes the dialog;
 * it sets `submitting` inside its `wt-delete-confirm` listener, which is what stops a second press
 * sending a second delete. */
@customElement("wt-delete-dialog")
export class WtDeleteDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .target {
        margin: 0 0 var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .group {
        margin: 0 0 var(--wt-space-3);
      }

      h3 {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .group[data-group="refusals"] h3 {
        color: var(--wt-color-danger);
      }

      ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }

      li {
        overflow-wrap: anywhere;
      }

      li + li {
        margin-top: var(--wt-space-1);
      }

      .status {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .irreversible {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) impact: DeleteImpact | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) submitting = false;
  @property() readError = "";
  @property() actionError = "";
  /** Until it is set nothing is drawn, so no unnamed dialog can open. */
  @property({ attribute: false }) copy?: DeleteDialogCopy;
  @property({ attribute: false }) opener: HTMLElement | null = null;

  @query("wt-modal") private modal!: WtModal;
  @query('[data-test="delete-cancel"]') private cancelButton!: WtButton;

  private get ready(): boolean {
    return (
      this.impact !== null &&
      !this.loading &&
      this.readError === "" &&
      this.impact.refusals.length === 0
    );
  }

  private shown = false;

  override updated(): void {
    const shown = this.open && this.copy !== undefined;
    if (shown && !this.shown) void this.focusCancel();
    this.shown = shown;
  }

  private async focusCancel(): Promise<void> {
    await this.modal.updateComplete;
    await this.cancelButton.updateComplete;
    if (this.open && this.isConnected) this.cancelButton.focus();
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private onConfirm(event: Event): void {
    event.stopPropagation();
    if (this.submitting || !this.ready) return;
    this.emit("wt-delete-confirm", { id: this.impact!.target.id });
  }

  private onRetry(event: Event): void {
    event.stopPropagation();
    if (this.loading) return;
    this.emit("wt-delete-retry", {});
  }

  private onCancel(event: Event): void {
    event.stopPropagation();
    if (this.submitting) return;
    this.close();
  }

  /** The modal also reports a close the parent asked for, which is not passed on. */
  private onModalClose(event: Event): void {
    event.stopPropagation();
    this.close();
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit("wt-close", {});
  }

  private group(name: string, heading: string, lines: string[]) {
    if (lines.length === 0) return nothing;
    return html`<section class="group" data-group=${name}>
      <h3>${heading}</h3>
      <ul>
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </section>`;
  }

  override render() {
    const { copy, impact } = this;
    if (!copy) return nothing;
    const ready = this.ready;
    const message = [this.readError, this.actionError].filter((each) => each !== "").join(" ");
    return html`
      <wt-modal
        size="compact"
        .open=${this.open}
        .heading=${copy.heading}
        .opener=${this.opener}
        .dismissible=${!this.submitting}
        @wt-close=${this.onModalClose}
      >
        ${impact ? html`<p class="target" data-target>${impact.target.name}</p>` : nothing}
        ${
          this.loading
            ? html`<p class="status" role="status">
                <wt-spinner size="sm" decorative></wt-spinner>${copy.loading}
              </p>`
            : nothing
        }
        ${
          impact
            ? html`
                ${this.group(
                  "refusals",
                  copy.refusals,
                  impact.refusals.map((each) => copy.refusal(each)),
                )}
                ${this.group(
                  "ends",
                  copy.ends,
                  impact.ends.map((each) => copy.item(each)),
                )}
                ${this.group(
                  "removes",
                  copy.removes,
                  impact.removes.map((each) => copy.item(each)),
                )}
                <p class="irreversible" data-irreversible>${copy.irreversible}</p>
              `
            : nothing
        }
        <wt-form-actions slot="footer" .error=${message}>
          <wt-button
            slot="cancel"
            data-test="delete-cancel"
            variant="secondary"
            ?disabled=${this.submitting}
            @click=${this.onCancel}
            >${copy.cancel}</wt-button
          >
          ${
            this.readError === ""
              ? nothing
              : html`<wt-button
                  slot="secondary"
                  data-test="delete-retry"
                  variant="secondary"
                  ?loading=${this.loading}
                  @click=${this.onRetry}
                  >${copy.retry}</wt-button
                >`
          }
          <wt-button
            data-test="delete-confirm"
            variant=${this.submitting || ready ? "danger" : "secondary"}
            ?disabled=${this.submitting || !ready}
            ?loading=${this.submitting}
            @click=${this.onConfirm}
            >${copy.confirm}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-delete-dialog": WtDeleteDialog;
  }
}
