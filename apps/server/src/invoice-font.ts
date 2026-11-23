import { readFileSync } from "node:fs";
import { create, type Font } from "fontkit";

function onFirstUse<T>(load: () => T): () => T {
  let loaded: { value: T } | undefined;
  return () => (loaded ??= { value: load() }).value;
}

export const invoiceFontBytes = onFirstUse(() =>
  readFileSync(new URL("./assets/invoice-noto-sans.ttf", import.meta.url)),
);
export const invoiceFont = onFirstUse(() => create(invoiceFontBytes()) as Font);

export const invoiceBoldFontBytes = onFirstUse(() =>
  readFileSync(new URL("./assets/invoice-noto-sans-bold.ttf", import.meta.url)),
);
export const invoiceBoldFont = onFirstUse(() => create(invoiceBoldFontBytes()) as Font);

export const invoiceMonoFontBytes = onFirstUse(() =>
  readFileSync(new URL("./assets/invoice-noto-sans-mono.ttf", import.meta.url)),
);

export async function loadRecoveryPackFonts() {
  return { regular: invoiceFontBytes(), mono: invoiceMonoFontBytes() };
}
