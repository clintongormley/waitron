import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LeaveReason } from "@waitron/ui-core/unsaved-changes";
import { baseStyles } from "../base-styles.js";
import { FormFeedback } from "../form-feedback.js";
import type { WtModal } from "./wt-modal.js";
import "./wt-modal.js";
import "./wt-textarea.js";
import "./wt-button.js";
import "./wt-form-actions.js";

type CloudAttachment = { available: true; id: string; attachment: string; admin?: true };

export interface ReportDialogCloud {
  previewProblemReport(signal: AbortSignal): Promise<CloudAttachment | { available: false }>;
  sendProblemReport(
    id: string,
    signal: AbortSignal,
    description?: string,
  ): Promise<{ delivery: "queued" | "sent"; description?: "waiting" | "queued" }>;
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
    descriptionReview: string;
    descriptionDirect: string;
    waiting: string;
    descriptionQueued: string;
    preview: string;
    send: string;
    sent: string;
    queued: string;
    refused: string;
    descriptionRefused: string;
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
        text-wrap: wrap;
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
  @state() private descriptionDelivery?: "waiting" | "queued";
  private readonly feedback = new FormFeedback(this);
  @query("wt-modal") private modal!: WtModal;
  private cloudRequest?: AbortController;

  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("open") && !changed.has("cloud")) return;
    this.cloudRequest?.abort();
    this.cloudPreview = undefined;
    this.delivery = undefined;
    this.descriptionDelivery = undefined;
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
      const text = this.description.trim() ? this.description : undefined;
      const result =
        text === undefined
          ? await cloud.sendProblemReport(preview.id, signal)
          : await cloud.sendProblemReport(preview.id, signal, text);
      if (signal.aborted) return;
      this.delivery =
        result.delivery === "sent" || result.delivery === "queued" ? result.delivery : "refused";
      this.descriptionDelivery = result.description;
      if (text !== undefined && this.delivery !== "refused" && result.description) {
        this.dispatchEvent(
          new CustomEvent("wt-description-saved", {
            detail: { value: text },
            bubbles: true,
            composed: true,
          }),
        );
      }
    } catch {
      if (!signal.aborted) this.delivery = "refused";
    }
  }

  private get canSend(): boolean {
    return !this.validationError && (this.delivery === undefined || this.delivery === "refused");
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
    const feedback =
      this.delivery === "refused"
        ? this.description.trim()
          ? cloudCopy?.descriptionRefused
          : cloudCopy?.refused
        : this.downloadError;
    const fields = new Set(invalid && this.delivery !== "refused" ? ["description"] : []);
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
      ${cloudCopy ? html`<p>${this.cloudPreview?.admin ? cloudCopy.descriptionDirect : cloudCopy.descriptionReview}</p>` : nothing}
      <wt-textarea
        name="problemDescription"
        .label=${c.description}
        .value=${this.description}
        .error=${this.validationError}
        @wt-change=${this.edited}
      ></wt-textarea>
      ${cloudCopy ? html`<p>${c.preview}</p>` : nothing}
      <pre role="region" tabindex="0" aria-label=${c.preview}>${this.preview}</pre>
      <wt-form-actions
        slot="footer"
        .error=${this.feedback.message({ report: fields.size ? undefined : feedback }, fields, c.invalid)}
      >
        <wt-button slot="cancel" variant="secondary" @click=${this.cancel}>${c.cancel}</wt-button>
        ${
          cloudCopy
            ? html`<div class="cloud-status" slot="secondary" role="status">
                  ${
                    this.delivery === "sent" || this.delivery === "queued"
                      ? [
                          cloudCopy[this.delivery],
                          this.descriptionDelivery === "waiting"
                            ? cloudCopy.waiting
                            : this.descriptionDelivery === "queued"
                              ? cloudCopy.descriptionQueued
                              : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
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
