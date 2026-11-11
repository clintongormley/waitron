import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import { loadRecoveryFont } from "../recovery-pdf-node.js";
import { declarationBlocks, type DeclarationProducer, type DeclarationRun } from "./render.js";

const MARGIN = 56;

function plain(line: DeclarationRun[]): string {
  return line.map((run) => run.text).join("");
}

export async function renderDeclarationPdf(
  source: string,
  producer: DeclarationProducer,
  loadFont: () => Promise<Uint8Array> = loadRecoveryFont,
): Promise<Uint8Array> {
  const blocks = declarationBlocks(source, producer);
  const fontBytes = await loadFont();
  const font = create(fontBytes as unknown as Buffer) as Font;
  for (const block of blocks) {
    for (const line of block.lines) {
      for (const character of plain(line)) {
        const point = character.codePointAt(0)!;
        // A declaration is a signed statement: a missing glyph is refused, never substituted.
        if (!font.hasGlyphForCodePoint(point)) {
          throw new Error(
            `The declaration's font has no glyph for U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
          );
        }
      }
    }
  }
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    font: fontBytes as unknown as string,
    info: { Title: plain(blocks[0]!.lines[0]!) },
  });
  const chunks: Uint8Array[] = [];
  const result = new Promise<Uint8Array>((resolve) => {
    pdf.on("data", (data: Uint8Array) => chunks.push(data));
    pdf.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
  const width = pdf.page.width - 2 * MARGIN;
  for (const block of blocks) {
    if (block.kind === "title") {
      pdf.fontSize(14).text(plain(block.lines[0]!), MARGIN, pdf.y, {
        width,
        align: "center",
        paragraphGap: 12,
      });
    } else if (block.kind === "list") {
      for (const line of block.lines) {
        pdf.fontSize(10).text(`•  ${plain(line)}`, MARGIN + 12, pdf.y, {
          width: width - 12,
          paragraphGap: 4,
        });
      }
      pdf.moveDown(0.5);
    } else {
      pdf.fontSize(10).text(plain(block.lines[0]!), MARGIN, pdf.y, { width, paragraphGap: 8 });
    }
  }
  pdf.end();
  return result;
}
