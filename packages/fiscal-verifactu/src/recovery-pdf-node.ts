import "./recovery-font.js";
import { readFile } from "node:fs/promises";
import { renderRecoveryPdfWithFont } from "./recovery-pdf-content.js";
import type { RecoveryDocument } from "./recovery-document.js";

export function renderRecoveryPdf(input: RecoveryDocument, locale: "en" | "es") {
  return renderRecoveryPdfWithFont(input, locale, async () => {
    const { default: fontAsset } = await import("./assets/register-noto-sans.ttf?inline", {
      with: { type: "bytes" },
    }).catch(async () => ({
      default: await readFile(new URL("./assets/register-noto-sans.ttf", import.meta.url)),
    }));
    return typeof fontAsset === "string"
      ? new Uint8Array(Buffer.from(fontAsset.slice(fontAsset.indexOf(",") + 1), "base64"))
      : new Uint8Array(fontAsset);
  });
}
