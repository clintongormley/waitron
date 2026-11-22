import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LeaveReason } from "@waitron/ui-core/unsaved-changes";
import { baseStyles } from "../base-styles.js";
import type { WtModal } from "./wt-modal.js";
import "./wt-modal.js";
import "./wt-textarea.js";
import "./wt-button.js";
import "./wt-form-actions.js";

type CloudAttachment = { available: true; id: string; attachment: string };

export interface ReportDialogCloud {
  previewProblemReport(signal: AbortSignal): Promise<CloudAttachment | { available: false }>;
  sendProblemReport(id: string, signal: AbortSignal): Promise<{ delivery: "queued" | "sent" }>;
}

export interface ReportDialogCopy {
  heading: string;
  scope: string;
  warning: string;
  description: string;
  preview: string;
  invalid: string;
  cancel: string;
  download: string;
  cloud?: {
    scope: string;
    localDescription: string;
    preview: string;
    send: string;
    sent: string;
    queued: string;
    refused: string;
  };
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
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        padding: var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-sunken);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
      }
      .cloud-status {
        flex-basis: 100%;
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
  @property({ attribute: false }) cloud?: ReportDialogCloud;
  @state() private cloudPreview?: CloudAttachment;
  @state() private delivery?: "sending" | "sent" | "queued" | "refused";
  @query("wt-modal") private modal!: WtModal;
  private cloudRequest?: AbortController;

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("open") && !changed.has("cloud")) return;
    this.cloudRequest?.abort();
    this.cloudPreview = undefined;
    this.delivery = undefined;
    if (this.open && this.cloud) {
      this.cloudRequest = new AbortController();
      void this.loadCloudPreview(this.cloud, this.cloudRequest.signal);
    }
  }

  override disconnectedCallback(): void {
    this.cloudRequest?.abort();
    super.disconnectedCallback();
  }

  private async loadCloudPreview(cloud: ReportDialogCloud, signal: AbortSignal): Promise<void> {
    try {
      const preview = await cloud.previewProblemReport(signal);
      if (!signal.aborted && preview.available) this.cloudPreview = preview;
    } catch {
      // The download works when the box cannot supply a Cloud preview.
    }
  }

  private async send(event: Event): Promise<void> {
    event.stopPropagation();
    const cloud = this.cloud;
    const preview = this.cloudPreview;
    const signal = this.cloudRequest?.signal;
    if (!cloud || !preview || !signal || signal.aborted || !this.canSend) return;
    this.delivery = "sending";
    try {
      const { delivery } = await cloud.sendProblemReport(preview.id, signal);
      if (!signal.aborted)
        this.delivery = delivery === "sent" || delivery === "queued" ? delivery : "refused";
    } catch {
      if (!signal.aborted) this.delivery = "refused";
    }
  }

  private get canSend(): boolean {
    return this.delivery === undefined || this.delivery === "refused";
  }

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
    const cloudCopy = this.cloudPreview && c.cloud;
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      .heading=${c.heading}
      .opener=${this.opener}
      .beforeClose=${this.beforeClose}
      @wt-close=${this.closed}
    >
      <p>${cloudCopy ? cloudCopy.scope : c.scope}</p>
      ${
        cloudCopy && this.cloudPreview
          ? html`<p>${cloudCopy.preview}</p>
              <pre data-cloud-preview role="region" tabindex="0" aria-label=${cloudCopy.preview}>
${this.cloudPreview.attachment}</pre>`
          : nothing
      }
      <p>${c.warning}</p>
      <wt-textarea
        name="problemDescription"
        .label=${cloudCopy ? cloudCopy.localDescription : c.description}
        .value=${this.description}
        .error=${this.validationError}
        @wt-change=${this.edited}
      ></wt-textarea>
      ${cloudCopy ? html`<p>${c.preview}</p>` : nothing}
      <pre role="region" tabindex="0" aria-label=${c.preview}>${this.preview}</pre>
      <wt-form-actions
        slot="footer"
        .error=${
          this.delivery === "refused" && cloudCopy
            ? cloudCopy.refused
            : invalid
              ? c.invalid
              : this.downloadError
        }
      >
        <wt-button slot="cancel" variant="secondary" @click=${this.cancel}>${c.cancel}</wt-button>
        ${
          cloudCopy
            ? html`<div class="cloud-status" slot="secondary" role="status">
                  ${
                    this.delivery === "sent" || this.delivery === "queued"
                      ? cloudCopy[this.delivery]
                      : ""
                  }
                </div>
                <wt-button
                  data-send
                  variant=${this.canSend || this.delivery === "sending" ? "primary" : "secondary"}
                  ?disabled=${!this.canSend}
                  @click=${this.send}
                  >${cloudCopy.send}</wt-button
                >`
            : nothing
        }
        <wt-button
          slot=${cloudCopy ? "secondary" : ""}
          data-download
          variant=${ready && !cloudCopy ? "primary" : "secondary"}
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
