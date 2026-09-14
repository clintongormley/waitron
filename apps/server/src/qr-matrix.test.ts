import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-matrix.js";

/**
 * Read the error-correction level from a matrix's format information (ISO/IEC 18004 §7.9): 15 bits
 * stored twice — once as an L-shape beside the top-left finder pattern, and again split between the
 * top-right and bottom-left finder patterns — masked with 101010000010010, whose top two bits are the
 * level (01 = L, 00 = M, 11 = Q, 10 = H) and whose last ten are a BCH check. Independent of the
 * encoder: it only reads the dark and light modules.
 */
function formatInfoLevel(m: readonly (readonly boolean[])[]): "L" | "M" | "Q" | "H" {
  const size = m.length;
  let vertical = 0;
  let horizontal = 0;
  for (let i = 0; i < 15; i++) {
    const row = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    const col = i < 8 ? size - 1 - i : i < 9 ? 7 : 14 - i;
    if (m[row]![8]) vertical |= 1 << i;
    if (m[8]![col]) horizontal |= 1 << i;
  }
  expect(horizontal, "the two copies of the format information agree").toBe(vertical);
  const bits = vertical ^ 0b101010000010010;
  let remainder = bits;
  for (let b = 14; b >= 10; b--) if (remainder & (1 << b)) remainder ^= 0b10100110111 << (b - 10);
  expect(remainder, "the format information's BCH check holds").toBe(0);
  return (["M", "L", "H", "Q"] as const)[bits >> 13]!;
}

const LINK =
  "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=17-08-2026&importe=20.90";

/** The same matrix read straight from the library, at a chosen level — the negative control. */
function libraryMatrix(text: string, level: "L" | "M" | "Q" | "H"): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  return Array.from({ length: qr.modules.size }, (_, r) =>
    Array.from({ length: qr.modules.size }, (_, c) => qr.modules.get(r, c) === 1),
  );
}

describe("qrModules", () => {
  it("returns a square matrix of the link's grid size", () => {
    const m = qrModules(LINK);
    expect(m).toHaveLength(41);
    expect(m.every((row) => row.length === 41)).toBe(true);
  });

  it("encodes at error-correction level M, read back from the format information", () => {
    expect(formatInfoLevel(qrModules(LINK))).toBe("M");
    expect(formatInfoLevel(qrModules("Waitron 30-40 mm", { version: 9 }))).toBe("M");
  });

  it("reads back levels L, Q and H from library-encoded codes (negative controls for the reader)", () => {
    expect(formatInfoLevel(libraryMatrix(LINK, "L"))).toBe("L");
    expect(formatInfoLevel(libraryMatrix(LINK, "Q"))).toBe("Q");
    expect(formatInfoLevel(libraryMatrix(LINK, "H"))).toBe("H");
  });

  it("keeps rows as rows (a transposed matrix fails the format check)", () => {
    const m = qrModules(LINK);
    const transposed = m.map((row, r) => row.map((_, c) => m[c]![r]!));
    expect(() => formatInfoLevel(transposed)).toThrow();
  });

  it("forces the QR version when asked", () => {
    expect(qrModules("Waitron 30-40 mm", { version: 7 })).toHaveLength(45);
    expect(qrModules("Waitron 30-40 mm", { version: 9 })).toHaveLength(53);
  });
});
