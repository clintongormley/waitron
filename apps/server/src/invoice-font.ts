import { readFileSync } from "node:fs";
import { create, type Font } from "fontkit";

export const invoiceFontBytes = readFileSync(
  new URL("./assets/invoice-noto-sans.ttf", import.meta.url),
);
export const invoiceFont = create(invoiceFontBytes) as Font;
