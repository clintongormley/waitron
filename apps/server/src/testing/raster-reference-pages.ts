import type { InvoiceRasterPage } from "../invoice-raster.js";

export function rasterReferencePages(resolution: 300 | 600): InvoiceRasterPage[] {
  const width = resolution === 300 ? 2480 : 4960;
  const height = resolution === 300 ? 3508 : 7016;
  return [0, 1].map((page) => {
    const pixels = Buffer.alloc(width * height, 255);
    // Distinct pages and rows exercise single bytes, 128-byte runs/literals and 256-row repeats.
    for (let x = 0; x < width; x++) pixels[x] = (x + page * 31) % 256;
    pixels.fill(0, width, width * 258);
    const tail = width * 258;
    pixels.fill(17, tail, tail + 129);
    for (let x = 129; x < width - 1; x++) pixels[tail + x] = x % 251;
    pixels[tail + width - 1] = 254;
    pixels.fill(page === 0 ? 73 : 201, width * 259, width * 260);
    pixels[width * height - 1] = page;
    return { width, height, resolution, pixels };
  });
}
