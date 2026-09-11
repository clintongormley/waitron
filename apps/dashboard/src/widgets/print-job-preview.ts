import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import type { PrintJobPreview } from "../api/client.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-print-job-preview")
export class PrintJobPreviewDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        font-size: var(--wt-font-size-sm);
      }
      .qr-data {
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) preview: PrintJobPreview | null = null;

  #close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("preview-close", { bubbles: true, composed: true }));
  }

  override render() {
    const preview = this.preview;
    return html`
      <wt-modal .open=${this.open} heading=${t("printers.preview_title")} @wt-close=${this.#close}>
        <p>${t("printers.preview_notice")}</p>
        ${
          preview
            ? html`
                ${preview.omittedGraphics ? html`<p>${t("printers.preview_graphics_omitted")}</p>` : nothing}
                ${preview.truncated || preview.unsupported ? html`<p>${t("printers.preview_incomplete")}</p>` : nothing}
                ${preview.text ? html`<pre>${preview.text}</pre>` : nothing}
                ${preview.qrData.map(
                  (data) =>
                    html`<section>
                      <h3>${t("printers.preview_qr_data")}</h3>
                      <p class="qr-data">${data}</p>
                    </section>`,
                )}
                ${!preview.text && preview.qrData.length === 0 ? html`<p>${t("printers.preview_empty")}</p>` : nothing}
              `
            : nothing
        }
        <wt-button slot="footer" data-test="preview-close" @click=${this.#close}
          >${t("action.close")}</wt-button
        >
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-print-job-preview": PrintJobPreviewDialog;
  }
}
