import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr.js";

// The four values, and their order, are what `buildQrPayload` in packages/verifactu/src/qr.ts
// emits; percent-encoding included, since that is what reaches the drawing code.
const AEAT_LINK =
  "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F2026%2F000123&fecha=20-09-2026&importe=12.34";

describe("qrSvg", () => {
  it("renders a scannable QR as an <svg> carrying drawn modules for a non-empty payload", () => {
    const svg = qrSvg("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B1&numserie=A/1");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
    // The path must carry actual module runs (a `d="M…"`), not an empty `d=""` — a blank square
    // is not a scannable code. `M` is the moveTo that begins each dark module.
    expect(svg).toMatch(/<path[^>]*\bd="M/);
  });

  it("returns an empty string for an empty payload (the ticket still prints the legend)", () => {
    expect(qrSvg("")).toBe("");
  });

  // The exact bytes the on-screen ticket draws, pinned. The assertions above cannot see a change
  // that keeps the same element shapes: dropping the error-correction level to "L", and scaling
  // every module by moving `cellSize` from 4 to 5, each moves the drawn bytes and each was
  // measured to leave the three assertions in the case above green. Level M is what Orden
  // HAC/1177/2024 art. 21.1 mandates; the four-module quiet zone around it is ISO/IEC 18004's.
  // Both citations are in the docstring on `qrSvg` in ./qr.ts.
  it("draws the AEAT verification URL at the pinned bytes", async () => {
    const svg = qrSvg(AEAT_LINK);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(svg));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe("533d32d86dfc4531ac7a5e0a6a682e9c5d4a29438c3ffe2de50ef8285b4f034e");
  });
});
