import { describe, expect, it } from "vitest";
import { esc } from "@waitron/printing";
import { previewPrintJob } from "./print-job-preview.js";

describe("print job preview", () => {
  it("shows receipt text without the printer commands or drawer pulse", () => {
    expect(
      previewPrintJob(
        esc().init().line("Café <table>").line("Total 12.50").kick().feedAndCut().bytes(),
      ),
    ).toEqual({
      columns: 42,
      dpi: 180,
      text: "Café <table>\nTotal 12.50\n",
      blocks: [
        { kind: "text", text: "Café <table>\nTotal 12.50\n" },
        { kind: "feed", lines: 5 },
        { kind: "cut" },
      ],
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
      columns: 42,
      dpi: 180,
      text: "Receipt\nThank you\n",
      blocks: [
        { kind: "text", text: "Receipt\n" },
        expect.objectContaining({ kind: "image", qrData: data }),
        { kind: "text", text: "Thank you\n" },
      ],
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
    expect(result.omittedGraphics).toBe(false);
    expect(result.blocks).toEqual([
      { kind: "text", text: "Before\n" },
      { kind: "image", width: 8, height: 8, data: Buffer.alloc(8, 255).toString("base64") },
      { kind: "text", text: "After\n" },
    ]);
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
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x41, 0x32, 0],
    [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x31, 0],
    [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 1],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 0],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 17],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x2f],
    [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x34],
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

it("keeps feed and cut positions between text and graphic blocks", () => {
  const result = previewPrintJob(esc().text("Left  Right").feed(2).cut().line("Next").bytes());
  expect(result.blocks).toEqual([
    { kind: "text", text: "Left  Right" },
    { kind: "feed", lines: 2 },
    { kind: "cut" },
    { kind: "text", text: "Next\n" },
  ]);
});

it("renders native QR finder pixels with the requested dot size and quiet zone", () => {
  const result = previewPrintJob(esc().qr("A", { moduleSize: 2, ecLevel: "H" }).bytes());
  const block = result.blocks[0];
  expect(block?.kind).toBe("image");
  if (block?.kind !== "image") throw new Error("Missing QR bitmap");
  expect([block.width, block.height]).toEqual([58, 58]);
  const bytes = Buffer.from(block.data, "base64");
  const pixel = (x: number, y: number) => (bytes[y * 8 + (x >> 3)]! & (0x80 >> (x % 8))) !== 0;
  expect(pixel(0, 0)).toBe(false);
  expect(pixel(8, 8)).toBe(true);
  expect(pixel(9, 9)).toBe(true);
  expect(pixel(10, 10)).toBe(false);
  expect(pixel(12, 12)).toBe(true);
});

it("bounds bitmap dimensions and block count", () => {
  const wide = Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 1, 1, 0, ...new Uint8Array(257)]);
  const raster = previewPrintJob(wide);
  expect(raster.omittedGraphics).toBe(true);
  expect(raster.blocks).toEqual([]);
  const builder = esc();
  for (let i = 0; i < 2050; i++) builder.line("x").cut();
  const result = previewPrintJob(builder.bytes());
  expect(result.blocks.length).toBeLessThanOrEqual(2048);
  expect(result.truncated).toBe(true);
});

it("omits oversized QR graphics while retaining their content and following text", () => {
  const data = "A".repeat(2000);
  const result = previewPrintJob(esc().qr(data, { moduleSize: 16 }).line("After").bytes());
  expect(result.omittedGraphics).toBe(true);
  expect(result.qrData).toEqual([data]);
  expect(result.blocks).toEqual([{ kind: "text", text: "After\n" }]);
});

it("bounds cumulative decoded QR bitmap memory", () => {
  const builder = esc();
  for (let i = 0; i < 40; i++) builder.qr("A", { moduleSize: 16 });
  const result = previewPrintJob(builder.bytes());
  const images = result.blocks.filter((block) => block.kind === "image");
  const bytes = images.reduce(
    (total, block) => total + Buffer.from(block.data, "base64").length,
    0,
  );
  expect(bytes).toBeLessThanOrEqual(262_144);
  expect(images.length).toBeGreaterThan(0);
  expect(result.omittedGraphics).toBe(true);
});

it("bounds feed space and ignores a zero-line feed", () => {
  const builder = esc().feed(0);
  expect(previewPrintJob(builder.bytes()).blocks).toEqual([]);
  for (let i = 0; i < 20; i++) builder.feed(255);
  const result = previewPrintJob(builder.bytes());
  expect(result.truncated).toBe(true);
  expect(result.blocks).toHaveLength(16);
});

it("omits zero-sized and excessively tall raster images", () => {
  for (const [width, height] of [
    [0, 1],
    [1, 0],
    [1, 2049],
  ]) {
    const header = [0x1d, 0x76, 0x30, 0, width! & 255, width! >> 8, height! & 255, height! >> 8];
    const result = previewPrintJob(
      Uint8Array.from([...header, ...new Uint8Array(width! * height!)]),
    );
    expect(result.omittedGraphics).toBe(true);
    expect(result.blocks).toEqual([]);
  }
});

describe("character sets", () => {
  it("decodes text through the table the payload selects, including bytes 0x80-0x9F", () => {
    const wpc = previewPrintJob(esc("wpc1252").init().line("12,50 €").bytes());
    expect(wpc).toMatchObject({ text: "12,50 €\n", unsupported: false, truncated: false });
    const pc = previewPrintJob(esc("pc858").init().line("Café ü ç Ç €").bytes());
    expect(pc).toMatchObject({ text: "Café ü ç Ç €\n", unsupported: false, truncated: false });
  });

  it("returns to the starting table on ESC @", () => {
    const result = previewPrintJob(
      Uint8Array.of(0x1b, 0x74, 19, 0x82, 0x0a, 0x1b, 0x40, 0xe9, 0x0a),
    );
    expect(result).toMatchObject({ text: "é\né\n", unsupported: false, truncated: false });
  });

  it("uses the printer charset only as the starting table, then follows payload table changes", () => {
    const payload = esc("wpc1252", 6)
      .init()
      .line("Café 5 €")
      .charset("pc858", 19)
      .line("Café 5 €")
      .bytes();
    const result = previewPrintJob(payload, {
      columns: 42,
      dpi: 203,
      characterSet: "wpc1252",
      characterTable: 6,
    });
    expect(result).toMatchObject({
      text: "Café 5 €\nCafé 5 €\n",
      unsupported: false,
      truncated: false,
    });

    expect(
      previewPrintJob(Uint8Array.of(0x1b, 0x40, 0x1b, 0x74, 99, 0x41), {
        columns: 42,
        dpi: 203,
        characterSet: "wpc1252",
        characterTable: 6,
      }).unsupported,
    ).toBe(true);
  });

  it("uses the printer profile to decode its model-specific table number", () => {
    const result = previewPrintJob(esc("wpc1252", 7).init().line("Café 5 €").bytes(), {
      columns: 42,
      dpi: 203,
      characterSet: "wpc1252",
      characterTable: 7,
    });
    expect(result).toMatchObject({ text: "Café 5 €\n", unsupported: false, truncated: false });
  });

  it("stops at a byte 0x80-0x9F when no table was selected", () => {
    expect(previewPrintJob(Uint8Array.of(0x41, 0x80, 0x0a)).unsupported).toBe(true);
  });

  it.each([0, 1, 17, 99])("stops the preview on character table %i", (table) => {
    const result = previewPrintJob(Uint8Array.of(0x1b, 0x40, 0x1b, 0x74, table, 0x41));
    expect(result.unsupported).toBe(true);
    expect(result.text).toBe("");
  });

  it("reports the printer's column count and resolution", () => {
    expect(previewPrintJob(Uint8Array.of(0x41), { columns: 30, dpi: 203 })).toMatchObject({
      columns: 30,
      dpi: 203,
    });
  });
});

it("consumes single-byte mode selection without hiding the following accented text", () => {
  const result = previewPrintJob(Uint8Array.of(0x1b, 0x74, 16, 0x1c, 0x2e, 0xe9));
  expect(result.text).toBe("é");
  expect(result.unsupported).toBe(false);
});
