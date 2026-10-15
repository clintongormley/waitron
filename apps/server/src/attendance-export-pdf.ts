import { once } from "node:events";
import PDFDocument from "pdfkit";
import type { RecordExportDocument } from "@waitron/shared";
import { invoiceFont, invoiceFontBytes } from "./invoice-font.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = PAGE_HEIGHT - 52;
type Text = { text: string; x: number; y: number; size: number };

export async function renderAttendancePdf(document: RecordExportDocument): Promise<Buffer> {
  const spanish = document.locale === "es";
  let escaped = false;
  const clean = (value: string): string =>
    Array.from(value.replace(/\r\n?/gu, "\n").replace(/\t/gu, "    "))
      .map((c) => {
        if (c !== "\n" && /[\p{Cc}\p{Cf}]/u.test(c)) return " ";
        if (c === "\n" || invoiceFont.hasGlyphForCodePoint(c.codePointAt(0)!)) return c;
        escaped = true;
        return `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`;
      })
      .join("");
  const pdf = new PDFDocument({
    autoFirstPage: false,
    font: invoiceFontBytes as unknown as string,
    info: {
      Title: spanish ? "Registro de jornada" : "Working-time record",
      Author: "Waitron",
      Creator: "Waitron",
    },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(pdf, "end");
  const measure = (text: string, size: number) => pdf.fontSize(size).widthOfString(text);
  const wrap = (value: string, width: number, size: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of clean(value).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/( +)/u)) {
        if (measure(line + word, size) <= width) {
          line += word;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = "";
        for (const character of word.trimStart()) {
          if (line && measure(line + character, size) > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  const pages: Text[][] = [];
  let y = 0;
  let heading = "";
  const draw = (text: string, x: number, size: number) => {
    pages.at(-1)!.push({ text, x, y, size });
    y += size + 4;
  };
  const newPage = () => {
    pages.push([]);
    y = MARGIN;
    draw(spanish ? "Registro de jornada" : "Working-time record", MARGIN, 12);
    draw(
      `${spanish ? "Desde" : "From"} ${document.period.start}  /  ${spanish ? "Antes de (excluido)" : "Before (excluded)"} ${document.period.end}`,
      MARGIN,
      9,
    );
    y += 10;
    if (heading)
      for (const line of wrap(`${heading} (${spanish ? "continuación" : "continued"})`, WIDTH, 11))
        draw(line, MARGIN, 11);
  };
  const room = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };
  const paragraph = (value: string, size = 9, x = MARGIN, width = WIDTH) => {
    for (const line of wrap(value, width, size)) {
      room(size + 4);
      draw(line, x, size);
    }
  };
  newPage();
  paragraph(document.title, 16);
  y += 8;
  for (const note of document.notes) {
    paragraph(note);
    y += 4;
  }
  for (const section of document.sections) {
    heading = "";
    room(45);
    y += 10;
    paragraph(section.title, 12);
    heading = section.title;
    const compact =
      section.layout === "table" && section.columns.length > 0 && section.columns.length <= 4;
    const columnWidth = WIDTH / Math.max(1, section.columns.length);
    if (compact) {
      const labels = section.columns.map((c) => wrap(c.label, columnWidth - 10, 9));
      const tableHeading = () => {
        const start = y;
        for (const [i, lines] of labels.entries()) {
          y = start;
          for (const line of lines) draw(line, MARGIN + i * columnWidth, 9);
        }
        y = start + Math.max(...labels.map((lines) => lines.length)) * 13 + 5;
      };
      tableHeading();
      for (const row of section.rows) {
        const cells = section.columns.map((c) =>
          wrap(String(row.cells[c.key]), columnWidth - 10, 9),
        );
        const count = Math.max(...cells.map((lines) => lines.length));
        for (let index = 0; index < count; index++) {
          if (y + 13 > BOTTOM) {
            newPage();
            tableHeading();
          }
          const start = y;
          for (const [i, lines] of cells.entries()) {
            y = start;
            if (lines[index]) draw(lines[index], MARGIN + i * columnWidth, 9);
          }
          y = start + 13;
        }
        y += 6;
      }
    } else
      for (const row of section.rows) {
        room(28);
        for (const column of section.columns)
          paragraph(`${column.label}: ${String(row.cells[column.key])}`);
        y += 8;
      }
  }
  if (escaped) {
    heading = "";
    y += 6;
    paragraph(
      spanish
        ? "Caracteres no disponibles en la fuente: se muestran como [U+XXXX]."
        : "Characters unavailable in the font are shown as [U+XXXX].",
    );
  }
  for (const [i, page] of pages.entries()) {
    pdf.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
    for (const item of page)
      pdf.fontSize(item.size).text(item.text, item.x, item.y, { lineBreak: false });
    pdf
      .fontSize(8)
      .text(`${spanish ? "Página" : "Page"} ${i + 1} / ${pages.length}`, MARGIN, PAGE_HEIGHT - 38, {
        lineBreak: false,
      });
  }
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}
