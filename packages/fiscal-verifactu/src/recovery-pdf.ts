import fontUrl from "./assets/register-noto-sans.ttf?url";
import { renderRecoveryPdfWithFont } from "./recovery-pdf-content.js";
import { refuseRecovery, type RecoveryDocument } from "./recovery-document.js";

export function renderRecoveryPdf(input: RecoveryDocument, locale: "en" | "es") {
  return renderRecoveryPdfWithFont(input, locale, async () => {
    const response = await fetch(fontUrl);
    if (!response.ok) refuseRecovery();
    return new Uint8Array(await response.arrayBuffer());
  });
}
