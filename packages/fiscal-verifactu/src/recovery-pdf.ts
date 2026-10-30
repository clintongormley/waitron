import fontUrl from "./assets/register-noto-sans.ttf?url";
import { renderRecoveryPdfWithFont } from "./recovery-pdf-content.js";
import { refuseRecovery, type RecoveryDocument } from "./recovery-document.js";

export async function loadRecoveryFont(): Promise<Uint8Array> {
  const response = await fetch(fontUrl);
  if (!response.ok) refuseRecovery();
  return new Uint8Array(await response.arrayBuffer());
}

export function renderRecoveryPdf(input: RecoveryDocument, locale: "en" | "es", timeZone: string) {
  return renderRecoveryPdfWithFont(input, locale, loadRecoveryFont, timeZone);
}
