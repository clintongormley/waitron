import qrcode from "qrcode-generator";

/**
 * Render `text` as a scannable QR-code SVG string.
 *
 * Wraps `qrcode-generator`. Type number `0` = auto-size to the payload. Error-correction level
 * **"M" (medium)** is not a free choice: Orden HAC/1177/2024 art. 21.1 MANDATES level M for the
 * Veri*Factu ticket QR (see `docs/compliance/verifactu-findings.md` §14). The same article fixes the
 * QR *content* (art. 21.2) — the AEAT cotejo URL carrying the issuer NIF, series+number, issue date
 * and total — which the caller passes in as `text`; this function only draws it.
 *
 * `scalable: true` emits a viewBox-only SVG (no fixed pixel width/height) so CSS sizes it, and the
 * default margin (`cellSize × 4`) is the 4-module quiet zone ISO/IEC 18004 requires for a reader to
 * lock on.
 *
 * An empty `text` returns `""`. A sale's verification URL can legitimately be `""` (the fiscal
 * backend has not minted one), and a QR of nothing is not a scannable code — so the caller renders no
 * QR while still printing the VERI*FACTU legend, which the law requires unconditionally in Veri*Factu
 * mode (findings §14).
 */
export function qrSvg(text: string): string {
  if (text === "") return "";
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, scalable: true });
}
