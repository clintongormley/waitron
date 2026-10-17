import "./recovery-font.js";
import fontAsset from "./assets/register-noto-sans.ttf?inline" with { type: "bytes" };
import { renderRecoveryPdfWithFont } from "./recovery-pdf-content.js";
import type { RecoveryDocument } from "./recovery-document.js";

export function renderRecoveryPdf(input: RecoveryDocument, locale: "en" | "es") {
  return renderRecoveryPdfWithFont(input, locale, async () => {
    // Vite's source runner inlines a data URL; the Node bundle embeds the bytes.
    return typeof fontAsset === "string"
      ? new Uint8Array(Buffer.from(fontAsset.slice(fontAsset.indexOf(",") + 1), "base64"))
      : new Uint8Array(fontAsset);
  });
}
