import qrcode from "qrcode-generator";

/**
 * Error-correction level "M" is mandated for the Veri*Factu ticket QR by Orden HAC/1177/2024
 * art. 21.1 (`docs/compliance/verifactu-findings.md` §14). The default margin (`cellSize × 4`) is the
 * 4-module quiet zone ISO/IEC 18004 requires. An empty `text` (no verification URL yet) returns `""`.
 */
export function qrSvg(text: string): string {
  if (text === "") return "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, scalable: true });
}
