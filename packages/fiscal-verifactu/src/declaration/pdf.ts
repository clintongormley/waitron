import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import { loadRecoveryFont } from "../recovery-pdf-node.js";
import { declarationBlocks, type DeclarationProducer, type DeclarationRun } from "./render.js";

const MARGIN = 56;

function plain(line: DeclarationRun[]): string {
  return line.map((run) => run.text).join("");
}

interface Drawn {
  text: string;
  size: number;
  indent: number;
  align: "left" | "center";
  gap: number;
  /** Lines of space after this line. */
  after: number;
}

function drawnLines(source: string, producer: DeclarationProducer): Drawn[] {
  return declarationBlocks(source, producer).flatMap((block): Drawn[] => {
    if (block.kind === "title") {
      const text = plain(block.lines[0]!);
      return [{ text, size: 14, indent: 0, align: "center", gap: 12, after: 0 }];
    }
    if (block.kind === "list") {
      return block.lines.map((line, index) => ({
        text: `•  ${plain(line)}`,
        size: 10,
        indent: 12,
        align: "left",
        gap: 4,
        after: index === block.lines.length - 1 ? 0.5 : 0,
      }));
    }
    return [{ text: plain(block.lines[0]!), size: 10, indent: 0, align: "left", gap: 8, after: 0 }];
  });
}

export async function renderDeclarationPdf(
  source: string,
  producer: DeclarationProducer,
  loadFont: () => Promise<Uint8Array> = loadRecoveryFont,
): Promise<Uint8Array> {
  const lines = drawnLines(source, producer);
  const fontBytes = await loadFont();
  const font = create(fontBytes as unknown as Buffer) as Font;
  for (const line of lines) {
    for (const character of line.text) {
      const point = character.codePointAt(0)!;
      // A declaration is a signed statement: a missing glyph is refused, never substituted.
      if (!font.hasGlyphForCodePoint(point)) {
        throw new Error(
          `The declaration's font has no glyph for U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
        );
      }
    }
  }
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    font: fontBytes as unknown as string,
    info: { Title: lines[0]!.text },
  });
  const chunks: Uint8Array[] = [];
  const result = new Promise<Uint8Array>((resolve, reject) => {
    pdf.on("data", (data: Uint8Array) => chunks.push(data));
    pdf.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    pdf.on("error", reject);
  });
  const width = pdf.page.width - 2 * MARGIN;
  for (const line of lines) {
    pdf.fontSize(line.size).text(line.text, MARGIN + line.indent, pdf.y, {
      width: width - line.indent,
      align: line.align,
      paragraphGap: line.gap,
    });
    if (line.after > 0) pdf.moveDown(line.after);
  }
  pdf.end();
  return result;
}
