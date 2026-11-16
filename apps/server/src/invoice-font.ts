import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { create, type Font } from "fontkit";

export const invoiceFontBytes = readFileSync(
  new URL("./assets/invoice-noto-sans.ttf", import.meta.url),
);
export const invoiceFont = create(invoiceFontBytes) as Font;

export async function loadRecoveryPackFonts() {
  const mono = await readFile(new URL("./assets/invoice-noto-sans-mono.ttf", import.meta.url));
  return { regular: invoiceFontBytes, mono };
}
