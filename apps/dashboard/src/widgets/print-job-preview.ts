import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { PrintJobPreview } from "../api/client.js";
import { t } from "../i18n/t.js";
import { PrintPaper, paperStyles } from "./print-paper.js";

@customElement("dashboard-print-job-preview")
export class PrintJobPreviewDialog extends LitElement {
  static override styles = [
    baseStyles,
    paperStyles,
    css`
      :host {
        display: block;
      }
      .paper-viewport {
        overflow-x: auto;
        margin-top: var(--wt-space-4);
      }
      .paper-viewport:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .qr-data {
        overflow-wrap: anywhere;
      }
    `,
  ];

  readonly #paper = new PrintPaper();

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
                ${
                  preview.blocks.length
                    ? html`<div
                        class="paper-viewport"
                        tabindex="0"
                        role="region"
                        aria-label=${t("printers.preview_paper")}
                      >
                        ${this.#paper.render(preview)}
                      </div>`
                    : nothing
                }
                ${preview.qrData.map(
                  (data) =>
                    html`<section>
                      <h3>${t("printers.preview_qr_data")}</h3>
                      <p class="qr-data">${data}</p>
                    </section>`,
                )}
                ${preview.blocks.length === 0 && preview.qrData.length === 0 ? html`<p>${t("printers.preview_empty")}</p>` : nothing}
              `
            : nothing
        }
        <wt-form-actions slot="footer"
          ><wt-button slot="cancel" data-test="preview-close" @click=${this.#close}
            >${t("action.close")}</wt-button
          ></wt-form-actions
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
