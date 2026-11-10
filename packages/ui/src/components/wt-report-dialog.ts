import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { LeaveReason } from "@waitron/ui-core/unsaved-changes";
import { baseStyles } from "../base-styles.js";
import type { WtModal } from "./wt-modal.js";
import "./wt-modal.js";
import "./wt-textarea.js";
import "./wt-button.js";
import "./wt-form-actions.js";

export interface ReportDialogCopy {
  heading: string;
  scope: string;
  warning: string;
  description: string;
  preview: string;
  invalid: string;
  cancel: string;
  download: string;
}

@customElement("wt-report-dialog")
export class WtReportDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin: 0 0 var(--wt-space-3);
      }
      pre {
        text-wrap: wrap;
        overflow-wrap: anywhere;
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-sunken);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) copy?: ReportDialogCopy;
  @property() description = "";
  @property() preview = "";
  @property() validationError = "";
  @property() downloadError = "";
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property({ attribute: false }) beforeClose?: (reason: LeaveReason) => Promise<boolean>;
  @query("wt-modal") private modal!: WtModal;

  private edited(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-description-change", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private download(event: Event): void {
    event.stopPropagation();
    if (this.validationError || !this.preview) return;
    this.dispatchEvent(
      new CustomEvent("wt-report-download", {
        detail: { description: this.description, preview: this.preview },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private cancel(event: Event): void {
    event.stopPropagation();
    void this.modal.requestClose("cancel");
  }
  private closed(event: Event): void {
    event.stopPropagation();
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { detail: {}, bubbles: true, composed: true }));
  }
  override render() {
    const c = this.copy;
    if (!c) return nothing;
    const invalid = this.validationError !== "",
      ready = !invalid && this.preview !== "";
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      .heading=${c.heading}
      .opener=${this.opener}
      .beforeClose=${this.beforeClose}
      @wt-close=${this.closed}
    >
      <p>${c.scope}</p>
      <p>${c.warning}</p>
      <wt-textarea
        name="problemDescription"
        .label=${c.description}
        .value=${this.description}
        .error=${this.validationError}
        @wt-change=${this.edited}
      ></wt-textarea>
      <pre role="region" tabindex="0" aria-label=${c.preview}>${this.preview}</pre>
      <wt-form-actions slot="footer" .error=${invalid ? c.invalid : this.downloadError}>
        <wt-button slot="cancel" variant="secondary" @click=${this.cancel}>${c.cancel}</wt-button>
        <wt-button
          data-download
          variant=${ready ? "primary" : "secondary"}
          ?disabled=${!ready}
          @click=${this.download}
          >${c.download}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "wt-report-dialog": WtReportDialog;
  }
}
