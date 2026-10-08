// CUPS-derived headers and PackBits encoding: /app/third-party/cups-raster/NOTICES.txt.
import type { InvoiceRasterPage } from "./invoice-raster.js";

export type InvoiceRasterFormat = "pwg" | "apple";

export function encodeInvoiceRaster(
  pages: readonly InvoiceRasterPage[],
  format: InvoiceRasterFormat,
): Buffer {
  if (pages.length === 0) throw new RangeError("An invoice raster needs at least one page");
  for (const page of pages) {
    if (
      (page.resolution !== 300 && page.resolution !== 600) ||
      page.width !== 2480 * (page.resolution / 300) ||
      page.height !== 3508 * (page.resolution / 300) ||
      page.pixels.length !== page.width * page.height
    ) {
      throw new RangeError("Invoice raster needs a complete grey A4 page at 300 or 600 dpi");
    }
  }
  const chunks: Buffer[] = [];
  if (format === "pwg") chunks.push(Buffer.from("RaS2"));
  else {
    const header = Buffer.from([85, 78, 73, 82, 65, 83, 84, 0, 0, 0, 0, 0]);
    header.writeUInt32BE(pages.length, 8);
    chunks.push(header);
  }
  for (const page of pages) {
    chunks.push(pageHeader(page, pages.length, format));
    for (let y = 0; y < page.height;) {
      const row = page.pixels.subarray(y * page.width, (y + 1) * page.width);
      let repeats = 1;
      while (
        repeats < 256 &&
        y + repeats < page.height &&
        row.equals(page.pixels.subarray((y + repeats) * page.width, (y + repeats + 1) * page.width))
      )
        repeats++;
      chunks.push(compressRow(row, repeats));
      y += repeats;
    }
  }
  return Buffer.concat(chunks);
}

function pageHeader(page: InvoiceRasterPage, count: number, format: InvoiceRasterFormat): Buffer {
  if (format === "apple") {
    const header = Buffer.alloc(32);
    header[0] = 8;
    header[2] = 1;
    header.writeUInt32BE(page.width, 12);
    header.writeUInt32BE(page.height, 16);
    header.writeUInt32BE(page.resolution, 20);
    return header;
  }
  const header = Buffer.alloc(1796);
  header.write("PwgRaster", 0, "ascii");
  header.write("iso_a4_210x297mm", 1732, "ascii");
  for (const [offset, value] of [
    [276, page.resolution],
    [280, page.resolution],
    [292, 595],
    [296, 841],
    [340, 1],
    [352, 595],
    [356, 841],
    [372, page.width],
    [376, page.height],
    [384, 8],
    [388, 8],
    [392, page.width],
    [400, 18],
    [420, 1],
    [452, count],
    [456, 1],
    [460, 1],
    [472, page.width],
    [476, page.height],
    [480, 0xffffff],
  ] as const)
    header.writeUInt32BE(value, offset);
  return header;
}

function compressRow(row: Buffer, repeats: number): Buffer {
  const output = Buffer.alloc(row.length * 2 + 1);
  let written = 0;
  output[written++] = repeats - 1;
  for (let pointer = 0; pointer < row.length;) {
    const start = pointer++;
    if (pointer === row.length) {
      output[written++] = 0;
      output[written++] = row[start]!;
    } else if (row[start] === row[pointer]) {
      let count = 2;
      while (count < 128 && pointer < row.length - 1 && row[pointer] === row[pointer + 1]) {
        count++;
        pointer++;
      }
      output[written++] = count - 1;
      output[written++] = row[pointer++]!;
    } else {
      let count = 1;
      while (count < 128 && pointer < row.length - 1 && row[pointer] !== row[pointer + 1]) {
        count++;
        pointer++;
      }
      if (pointer >= row.length - 1 && count < 128) {
        count++;
        pointer++;
      }
      output[written++] = 257 - count;
      row.copy(output, written, start, start + count);
      written += count;
    }
  }
  return output.subarray(0, written);
}
