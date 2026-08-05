import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr.js";

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
});
