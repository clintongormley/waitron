import { css, html, nothing, type TemplateResult } from "lit";
import type { BlockRange, PrintJobPreview, PrintPreviewBlock } from "../api/client.js";
import { t } from "../i18n/t.js";

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;
/** Images drawn as one picture: a QR code alone, or a run of other images of one width. */
type ImageRun = { kind: "images"; blocks: ImageBlock[]; height: number; url?: string };
type Piece = Exclude<PrintPreviewBlock, ImageBlock> | ImageRun;
/** A piece and the index of its first block in the job. */
type Placed = { piece: Piece; index: number };

/** A range of the job's blocks drawn apart from its neighbours, outlined while `active`. */
export interface PaperMark {
  name: string;
  range: BlockRange;
  active: boolean;
}

/** Well inside approximate browser canvas limits: 32,767 px a side, or 16,777,216 px of area on older iOS Safari. */
const MAX_RUN_HEIGHT = 8_192;

/**
 * Consecutive images of one width and alignment join one run, so a long job is a few pictures. A run
 * never crosses an index in `breaks`, so a marked range is pictures of its own.
 */
function runs(blocks: readonly PrintPreviewBlock[], breaks: ReadonlySet<number>): Placed[] {
  const out: Placed[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "image") {
      out.push({ piece: block, index });
      return;
    }
    const last = out.at(-1)?.piece;
    const run = last?.kind === "images" ? last : undefined;
    const first = run?.blocks[0];
    if (
      run !== undefined &&
      first !== undefined &&
      !breaks.has(index) &&
      first.qrData === undefined &&
      block.qrData === undefined &&
      first.width === block.width &&
      first.align === block.align &&
      run.height + block.height <= MAX_RUN_HEIGHT
    ) {
      run.height += block.height;
      run.blocks.push(block);
    } else {
      out.push({ piece: { kind: "images", blocks: [block], height: block.height }, index });
    }
  });
  return out;
}

function altText(run: ImageRun): string {
  const qrData = run.blocks[0]!.qrData;
  if (qrData !== undefined) return `${t("printers.preview_qr_data")}: ${qrData}`;
  const lines = run.blocks.flatMap((block) => (block.text === undefined ? [] : [block.text]));
  return lines.length > 0 ? lines.join("\n").trim() : t("printers.preview_image");
}

/** What the run's picture is drawn from, so two runs with the same key draw the same picture. */
function pictureKey(run: ImageRun): string {
  return `${run.blocks[0]!.width}:${run.blocks.map((block) => `${block.height}:${block.data}`).join(",")}`;
}

/** The run's own printed images stacked into one PNG. */
function bitmapUrl(run: ImageRun): string {
  const { blocks, height } = run;
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
  return canvas.toDataURL("image/png");
}

function renderPiece(piece: Piece, widthDots: number) {
  switch (piece.kind) {
    case "text":
      return html`<pre data-kind="text" data-align=${piece.align ?? nothing}>${piece.text}</pre>`;
    case "feed":
      return html`<div
        data-kind="feed"
        aria-hidden="true"
        style=${`height:${piece.lines * 3.75}mm`}
      ></div>`;
    case "cut":
      return html`<hr data-kind="cut" class="cut" aria-label=${t("printers.preview_cut")} />`;
    case "images":
      return html`<img
        data-kind="image"
        data-align=${piece.blocks[0]!.align ?? nothing}
        src=${piece.url}
        style=${`width:${(piece.blocks[0]!.width / widthDots) * 100}%`}
        alt=${altText(piece)}
      />`;
  }
}

/** The paper a print job's preview is drawn on; the host adds it to its own styles. */
export const paperStyles = css`
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
  .mark[data-active] {
    outline: var(--wt-selected-ring);
  }
`;

/**
 * Draws a print job's preview as the paper it prints on. One instance per host: it keeps the
 * pictures of the last preview it drew, so a picture the next preview repeats is not drawn again.
 */
export class PrintPaper {
  #last: { preview: PrintJobPreview; breaks: string; placed: Placed[] } | undefined;
  #pictures = new Map<string, string>();

  #placed(preview: PrintJobPreview, breaks: number[]): Placed[] {
    const key = breaks.join(",");
    if (this.#last?.preview === preview && this.#last.breaks === key) return this.#last.placed;
    const placed = runs(preview.blocks, new Set(breaks));
    const pictures = new Map<string, string>();
    for (const { piece } of placed) {
      if (piece.kind !== "images") continue;
      const content = pictureKey(piece);
      piece.url = pictures.get(content) ?? this.#pictures.get(content) ?? bitmapUrl(piece);
      pictures.set(content, piece.url);
    }
    this.#pictures = pictures;
    this.#last = { preview, breaks: key, placed };
    return placed;
  }

  render(preview: PrintJobPreview, marks: readonly PaperMark[] = []): TemplateResult {
    const shown = marks.filter((mark) => mark.range.end > mark.range.start);
    const breaks = shown
      .flatMap((mark) => [mark.range.start, mark.range.end])
      .sort((a, b) => a - b);
    const markAt = (index: number) =>
      shown.find((mark) => index >= mark.range.start && index < mark.range.end);
    const groups: { mark: PaperMark | undefined; pieces: Piece[] }[] = [];
    for (const { piece, index } of this.#placed(preview, breaks)) {
      const mark = markAt(index);
      const last = groups.at(-1);
      if (mark !== undefined && last?.mark === mark) last.pieces.push(piece);
      else groups.push({ mark, pieces: [piece] });
    }
    return html`<div class="paper" style=${`width:${preview.columns}ch`}>
      ${groups.map(({ mark, pieces }) => {
        const drawn = pieces.map((piece) => renderPiece(piece, preview.widthDots));
        return mark === undefined
          ? drawn
          : html`<div class="mark" data-mark=${mark.name} ?data-active=${mark.active}>
              ${drawn}
            </div>`;
      })}
    </div>`;
  }
}
