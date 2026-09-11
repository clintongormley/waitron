import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { PrintJobPreview, PrintPreviewBlock } from "../api/client.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-print-job-preview")
export class PrintJobPreviewDialog extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
      .paper {
        box-sizing: border-box;
        width: 80mm;
        padding: 4mm;
        /* Paper and ink keep their physical colours in both application themes. */
        color: #000;
        background: #fff;
        font: 2.5mm / 3.75mm monospace;
      }
      .paper[data-width="58"] {
        width: 58mm;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
      }
      img {
        display: block;
        max-width: 100%;
        height: auto;
        image-rendering: pixelated;
      }
      .cut {
        border: 0;
        border-top: 1px dashed #000;
        margin: 0 -4mm;
      }
      .paper-field {
        display: grid;
        gap: var(--wt-space-1);
      }
      .qr-data {
        overflow-wrap: anywhere;
      }
    `,
  ];

  @state() private paperWidth = "80";
  #images = new WeakMap<object, string>();

  #bitmapUrl(block: Extract<PrintPreviewBlock, { kind: "image" }>): string {
    const cached = this.#images.get(block);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = block.width;
    canvas.height = block.height;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(block.width, block.height);
    const bytes = atob(block.data);
    const stride = Math.ceil(block.width / 8);
    for (let y = 0; y < block.height; y++) {
      for (let x = 0; x < block.width; x++) {
        const dark = bytes.charCodeAt(y * stride + (x >> 3)) & (0x80 >> (x % 8));
        const offset = (y * block.width + x) * 4;
        pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = dark ? 0 : 255;
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL("image/png");
    this.#images.set(block, url);
    return url;
  }

  #renderBlock(block: PrintPreviewBlock) {
    switch (block.kind) {
      case "text":
        return html`<pre data-kind="text">${block.text}</pre>`;
      case "feed":
        return html`<div
          data-kind="feed"
          aria-hidden="true"
          style=${`height:${block.lines * 3.75}mm`}
        ></div>`;
      case "cut":
        return html`<hr data-kind="cut" class="cut" aria-label=${t("printers.preview_cut")} />`;
      case "image":
        return html`<img
          data-kind="image"
          src=${this.#bitmapUrl(block)}
          style=${`width:${block.width / 8}mm`}
          alt=${block.qrData === undefined ? t("printers.preview_image") : `${t("printers.preview_qr_data")}: ${block.qrData}`}
        />`;
    }
  }

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
                <label class="paper-field"
                  >${t("printers.preview_paper_width")}
                  <select
                    name="preview-paper-width"
                    .value=${this.paperWidth}
                    @change=${(event: Event) => {
                      this.paperWidth = (event.target as HTMLSelectElement).value;
                    }}
                  >
                    <option value="80">80 mm</option>
                    <option value="58">58 mm</option>
                  </select>
                </label>
                ${
                  preview.blocks.length
                    ? html`<div
                        class="paper-viewport"
                        tabindex="0"
                        role="region"
                        aria-label=${t("printers.preview_paper")}
                      >
                        <div class="paper" data-width=${this.paperWidth}>
                          ${preview.blocks.map((block) => this.#renderBlock(block))}
                        </div>
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
