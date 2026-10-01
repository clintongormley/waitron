import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { PrintJobPreview, PrintPreviewBlock } from "../api/client.js";
import { t } from "../i18n/t.js";

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;
/** Images drawn as one picture: a QR code alone, or a run of other images of one width. */
type ImageRun = { kind: "images"; blocks: ImageBlock[]; height: number };
type Piece = Exclude<PrintPreviewBlock, ImageBlock> | ImageRun;

/** Well inside approximate browser canvas limits: 32,767 px a side, or 16,777,216 px of area on older iOS Safari. */
const MAX_RUN_HEIGHT = 8_192;

/** Consecutive images of one width and alignment join one run, so a long job is a few pictures. */
function runs(blocks: readonly PrintPreviewBlock[]): Piece[] {
  const out: Piece[] = [];
  for (const block of blocks) {
    if (block.kind !== "image") {
      out.push(block);
      continue;
    }
    const last = out.at(-1);
    const run = last?.kind === "images" ? last : undefined;
    const first = run?.blocks[0];
    if (
      run !== undefined &&
      first !== undefined &&
      first.qrData === undefined &&
      block.qrData === undefined &&
      first.width === block.width &&
      first.align === block.align &&
      run.height + block.height <= MAX_RUN_HEIGHT
    ) {
      run.height += block.height;
      run.blocks.push(block);
    } else {
      out.push({ kind: "images", blocks: [block], height: block.height });
    }
  }
  return out;
}

function altText(run: ImageRun): string {
  const qrData = run.blocks[0]!.qrData;
  if (qrData !== undefined) return `${t("printers.preview_qr_data")}: ${qrData}`;
  const lines = run.blocks.flatMap((block) => (block.text === undefined ? [] : [block.text]));
  return lines.length > 0 ? lines.join("\n").trim() : t("printers.preview_image");
}

@customElement("dashboard-print-job-preview")
export class PrintJobPreviewDialog extends LitElement {
  static override styles = [
    baseStyles,
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
        box-sizing: content-box;
        padding: 4mm;
        /* Paper and ink keep their physical colours in both application themes. */
        color: #000;
        background: #fff;
        font: 2.5mm / 3.75mm monospace;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
      }
      pre[data-align] {
        white-space: break-spaces;
      }
      pre[data-align="center"] {
        text-align: center;
      }
      pre[data-align="right"] {
        text-align: right;
      }
      img[data-align="center"] {
        margin-inline: auto;
      }
      img[data-align="right"] {
        margin-left: auto;
      }
      img {
        display: block;
        max-width: 100%;
        height: auto;
      }
      .cut {
        border: 0;
        border-top: 1px dashed #000;
        margin: 0 -4mm;
      }
      .qr-data {
        overflow-wrap: anywhere;
      }
    `,
  ];

  #runs = new WeakMap<PrintJobPreview, Piece[]>();
  #images = new WeakMap<ImageBlock, string>();

  /** The run's own printed images stacked into one PNG, keyed by the run's first block. */
  #bitmapUrl({ blocks, height }: ImageRun): string {
    const cached = this.#images.get(blocks[0]!);
    if (cached) return cached;
    const width = blocks[0]!.width;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(width, height);
    pixels.data.fill(255);
    const stride = Math.ceil(width / 8);
    let top = 0;
    for (const block of blocks) {
      const bytes = atob(block.data);
      for (let y = 0; y < block.height; y++) {
        for (let byte = 0; byte < stride; byte++) {
          const bits = bytes.charCodeAt(y * stride + byte);
          if (bits === 0) continue;
          for (let bit = 0; bit < 8; bit++) {
            const x = byte * 8 + bit;
            if (x >= width || (bits & (0x80 >> bit)) === 0) continue;
            const offset = ((top + y) * width + x) * 4;
            pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 0;
          }
        }
      }
      top += block.height;
    }
    context.putImageData(pixels, 0, 0);
    const url = canvas.toDataURL("image/png");
    this.#images.set(blocks[0]!, url);
    return url;
  }

  #runsOf(preview: PrintJobPreview): Piece[] {
    let cached = this.#runs.get(preview);
    if (cached === undefined) {
      cached = runs(preview.blocks);
      this.#runs.set(preview, cached);
    }
    return cached;
  }

  #renderBlock(block: Piece, widthDots: number) {
    switch (block.kind) {
      case "text":
        return html`<pre data-kind="text" data-align=${block.align ?? nothing}>${block.text}</pre>`;
      case "feed":
        return html`<div
          data-kind="feed"
          aria-hidden="true"
          style=${`height:${block.lines * 3.75}mm`}
        ></div>`;
      case "cut":
        return html`<hr data-kind="cut" class="cut" aria-label=${t("printers.preview_cut")} />`;
      case "images":
        return html`<img
          data-kind="image"
          data-align=${block.blocks[0]!.align ?? nothing}
          src=${this.#bitmapUrl(block)}
          style=${`width:${(block.blocks[0]!.width / widthDots) * 100}%`}
          alt=${altText(block)}
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
    const widthDots = preview?.widthDots ?? 0;
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
                        <div class="paper" style=${`width:${preview.columns}ch`}>
                          ${this.#runsOf(preview).map((block) => this.#renderBlock(block, widthDots))}
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
