import { describe, expect, it } from "vitest";
import { esc } from "../../../packages/printing/src/escpos.js";
import { previewPrintJob } from "./print-job-preview.js";

describe("print job text preview", () => {
  it("shows receipt text without the printer commands or drawer pulse", () => {
    expect(
      previewPrintJob(
        esc().init().line("Café <table>").line("Total 12.50").kick().feedAndCut().bytes(),
      ),
    ).toEqual({
      text: "Café <table>\nTotal 12.50\n",
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    });
  });

  it("extracts QR content when the stored symbol is printed", () => {
    const data = "https://example.test/receipt?id=1&total=12.50";
    expect(
      previewPrintJob(esc().init().line("Receipt").qr(data).line("Thank you").bytes()),
    ).toEqual({
      text: "Receipt\nThank you\n",
      qrData: [data],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    });
  });

  it("skips complete raster data rather than treating its bytes as text", () => {
    const result = previewPrintJob(
      esc()
        .line("Before")
        .qrRaster([[true]], { moduleSize: 8 })
        .line("After")
        .bytes(),
    );
    expect(result.text).toBe("Before\nAfter\n");
    expect(result.omittedGraphics).toBe(true);
    expect(result.unsupported).toBe(false);
  });

  it.each([
    [0x1b],
    [0x1b, 0x70, 0],
    [0x1d, 0x28, 0x6b, 255, 255, 0x31, 0x50, 0x30, 65],
    [0x1d, 0x76, 0x30, 0, 255, 255, 255, 255, 65],
  ])("stops at incomplete commands and reports a partial preview: %j", (...bytes) => {
    const result = previewPrintJob(Uint8Array.from([65, ...bytes]));
    expect(result.text).toBe("A");
    expect(result.truncated).toBe(true);
  });

  it.each([
    [0x1b, 0x21, 65],
    [0x1d, 0x21, 65],
    [0, 65],
  ])("stops at unsupported control sequences: %j", (...bytes) => {
    const result = previewPrintJob(Uint8Array.from([66, ...bytes]));
    expect(result.text).toBe("B");
    expect(result.unsupported).toBe(true);
  });

  it("bounds preview output for very large jobs", () => {
    const result = previewPrintJob(new Uint8Array(300_000).fill(65));
    expect(result.text.length).toBe(65_536);
    expect(result.truncated).toBe(true);
  });

  it("bounds QR output as well as ordinary text", () => {
    const result = previewPrintJob(esc().qr("a".repeat(40_000)).qr("b".repeat(40_000)).bytes());
    expect(result.qrData).toEqual(["a".repeat(40_000)]);
    expect(result.truncated).toBe(true);
  });

  it("handles a drawer-only job without inventing printable content", () => {
    expect(previewPrintJob(esc().init().kick().bytes()).text).toBe("");
  });

  it("does not show QR data that was stored but never printed", () => {
    const payload = esc().qr("not printed").bytes();
    expect(previewPrintJob(payload.subarray(0, payload.length - 8)).qrData).toEqual([]);
  });

  it.each([
    [0x1d, 0x56, 65],
    [0x1d, 0x76, 0x31, 0, 0, 0, 0, 0],
    [0x1d, 0x76, 0x30, 1, 0, 0, 0, 0],
    [0x1d, 0x28, 0x6a, 3, 0, 0x31, 0x43, 6],
    [0x1d, 0x28, 0x6b, 3, 0, 0x32, 0x43, 6],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x46, 6],
    [0x1d, 0x28, 0x6b, 2, 0, 0x31, 0x43],
    [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x51, 0x30, 65],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x50, 0x31],
  ])("rejects unsupported command variants: %j", (...bytes) => {
    const result = previewPrintJob(Uint8Array.from(bytes));
    expect(result.unsupported).toBe(true);
    expect(result.text).toBe("");
    expect(result.qrData).toEqual([]);
  });

  it("caps the number of QR symbols even when their data is empty", () => {
    const builder = esc();
    for (let i = 0; i < 130; i++) builder.qr("");
    const result = previewPrintJob(builder.bytes());
    expect(result.qrData).toHaveLength(128);
    expect(result.truncated).toBe(true);
  });
});
