import QRCode from "qrcode";

/**
 * The QR module matrix for `text` at error-correction level M (Orden HAC/1177/2024 art. 21.1), dark =
 * true, without the blank border. `version` forces a size (the test page's fixed samples); the receipt
 * lets the library pick the smallest version that holds the link.
 */
export function qrModules(text: string, opts: { version?: number } = {}): boolean[][] {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: "M",
    ...(opts.version === undefined ? {} : { version: opts.version }),
  });
  const size = qr.modules.size;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.modules.get(row, col) === 1),
  );
}
