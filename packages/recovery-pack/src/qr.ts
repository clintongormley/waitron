import QRCode from "qrcode";

/** The QR module matrix for `text` at error-correction level M, dark = true, without a border. */
export function qrModules(text: string): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.modules.get(row, col) === 1),
  );
}
