import { readFileSync } from "node:fs";
import { create, type Font } from "fontkit";

export const invoiceFontBytes = readFileSync(
  new URL("./assets/invoice-noto-sans.ttf", import.meta.url),
);
export const invoiceFont = create(invoiceFontBytes) as Font;

export const invoiceMonoFontBytes = readFileSync(
  new URL("./assets/invoice-noto-sans-mono.ttf", import.meta.url),
);

export async function loadRecoveryPackFonts() {
  return { regular: invoiceFontBytes, mono: invoiceMonoFontBytes };
}
