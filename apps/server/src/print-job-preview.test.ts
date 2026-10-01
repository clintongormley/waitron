import { describe, expect, it } from "vitest";
import { TEXT_BAND_HEIGHT, esc, type EscSetting } from "@waitron/printing";
import { previewPrintJob } from "./print-job-preview.js";

const WIDE: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };
const band = (text: string, width = 512) => ({
  kind: "image",
  width,
  height: TEXT_BAND_HEIGHT,
  data: expect.any(String),
  text,
});

describe("print job preview", () => {
  it("preserves justification on text and images and resets it at initialization", () => {
    const result = previewPrintJob(
      Uint8Array.from([
        0x1b, 0x61, 1, 65, 10, 0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 128, 0x1b, 0x61, 2, 66, 10, 0x1b,
        0x61, 0, 67, 10, 0x1b, 0x61, 1, 68, 10, 0x1b, 0x40, 69, 10,
      ]),
    );
    expect(result.unsupported).toBe(false);
    expect(result.text).toBe("A\nB\nC\nD\nE\n");
    expect(result.blocks).toEqual([
      { kind: "text", text: "A\n", align: "center" },
      { kind: "image", width: 8, height: 1, data: "gA==", align: "center" },
      { kind: "text", text: "B\n", align: "right" },
      { kind: "text", text: "C\n" },
      { kind: "text", text: "D\n", align: "center" },
      { kind: "text", text: "E\n" },
    ]);
  });
  it("shows receipt text without the printer commands or drawer pulse", () => {
    expect(
      previewPrintJob(
        esc(WIDE).init().line("Café <table>").line("Total 12.50").kick().feedAndCut().bytes(),
      ),
    ).toEqual({
      columns: 42,
      dpi: 180,
      text: "Café <table>\nTotal 12.50\n",
      blocks: [
        band("Café <table>"),
        band("Total 12.50"),
        { kind: "feed", lines: 5 },
        { kind: "cut" },
      ],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    });
  });

  it("skips print-area commands without stopping the receipt preview", () => {
    expect(previewPrintJob(esc(WIDE).printArea(512).line("Receipt").bytes())).toMatchObject({
      text: "Receipt\n",
      unsupported: false,
      truncated: false,
    });
  });

  it("extracts QR content when the stored symbol is printed", () => {
    const data = "https://example.test/receipt?id=1&total=12.50";
    expect(
      previewPrintJob(esc(WIDE).init().line("Receipt").qr(data).line("Thank you").bytes()),
    ).toEqual({
      columns: 42,
      dpi: 180,
      text: "Receipt\nThank you\n",
      blocks: [
        band("Receipt"),
        expect.objectContaining({ kind: "image", qrData: data }),
        band("Thank you"),
      ],
      qrData: [data],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    });
  });

  it("skips complete raster data rather than treating its bytes as text", () => {
    const result = previewPrintJob(
      esc(WIDE)
        .line("Before")
        .qrRaster([[true]], { moduleSize: 8 })
        .line("After")
        .bytes(),
    );
    expect(result.text).toBe("Before\nAfter\n");
    expect(result.omittedGraphics).toBe(false);
    expect(result.blocks).toEqual([
      band("Before"),
      { kind: "image", width: 8, height: 8, data: Buffer.alloc(8, 255).toString("base64") },
      band("After"),
    ]);
    expect(result.unsupported).toBe(false);
  });

  it.each([
    [0x1b],
    [0x1b, 0x61],
    [0x1b, 0x70, 0],
    [0x1d, 0x4c, 0],
    [0x1d, 0x28, 0x6b, 255, 255, 0x31, 0x50, 0x30, 65],
    [0x1d, 0x76, 0x30, 0, 255, 255, 255, 255, 65],
  ])("stops at incomplete commands and reports a partial preview: %j", (...bytes) => {
    const result = previewPrintJob(Uint8Array.from([65, ...bytes]));
    expect(result.text).toBe("A");
    expect(result.truncated).toBe(true);
  });

  it.each([
    [0x1b, 0x21, 65],
    [0x1b, 0x61, 3],
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
  const result = previewPrintJob(esc(WIDE).text("Left  Right").feed(2).cut().line("Next").bytes());
  expect(result.blocks).toEqual([
    band("Left  Right"),
    { kind: "feed", lines: 2 },
    { kind: "cut" },
    band("Next"),
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
  const textThenCut = [0x78, 0x0a, 0x1d, 0x56, 0x00];
  const result = previewPrintJob(
    Uint8Array.from(Array.from({ length: 2050 }, () => textThenCut).flat()),
  );
  expect(result.blocks.length).toBeLessThanOrEqual(2048);
  expect(result.truncated).toBe(true);
});

it("omits oversized QR graphics while retaining their content and following text", () => {
  const data = "A".repeat(2000);
  const result = previewPrintJob(esc(WIDE).qr(data, { moduleSize: 16 }).line("After").bytes());
  expect(result.omittedGraphics).toBe(true);
  expect(result.qrData).toEqual([data]);
  expect(result.blocks).toEqual([band("After")]);
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
  expect(bytes).toBeLessThanOrEqual(1_048_576);
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

describe("text", () => {
  it("gives each drawn line's image the text read back from it, and the job its lines", () => {
    const result = previewPrintJob(esc(WIDE).line("Café 5 €").line().line("Fin").bytes());
    expect(result.blocks).toEqual([band("Café 5 €"), band(""), band("Fin")]);
    expect(result.text).toBe("Café 5 €\n\nFin\n");
  });

  it("keeps the spaces a centred line starts with, on the grid of the image's width", () => {
    const result = previewPrintJob(
      esc({ paperWidth: "58mm", resolution: "203dpi" }).align("center").line("Hola").bytes(),
    );
    expect(result.blocks).toEqual([{ ...band(`${" ".repeat(13)}Hola`, 384), align: "center" }]);
  });

  it("gives an image that is not drawn text no text: a QR code, a ruler", () => {
    const result = previewPrintJob(
      esc(WIDE)
        .raster(576, TEXT_BAND_HEIGHT, (x) => x % 8 === 0)
        .qrRaster([[true]])
        .bytes(),
    );
    expect(result.text).toBe("");
    expect(result.blocks).toHaveLength(2);
    for (const block of result.blocks) expect(block).not.toHaveProperty("text");
  });

  it("previews every line of a long job: about 500 lines at 576 dots fit the 1 MiB caps", () => {
    const builder = esc({ paperWidth: "80mm", resolution: "203dpi" });
    for (let i = 0; i < 500; i++) builder.line(`Line ${i}`);
    const payload = builder.bytes();
    expect(payload.length).toBeGreaterThan(262_144);
    const result = previewPrintJob(payload);
    expect(result).toMatchObject({ omittedGraphics: false, truncated: false, unsupported: false });
    expect(result.text.split("\n").slice(-3)).toEqual(["Line 498", "Line 499", ""]);
  });

  it("stops at a drawn line whose text would pass the output cap", () => {
    const filler = new Uint8Array(65_530).fill(0x41);
    const line = esc(WIDE).line("Hello world").bytes();
    const result = previewPrintJob(Uint8Array.from([...filler, ...line]));
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("A".repeat(65_530));
    expect(result.blocks.filter((block) => block.kind === "image")).toEqual([]);
  });

  it("reads past 1 MiB of payload no further", () => {
    const builder = esc({ paperWidth: "80mm", resolution: "203dpi" });
    for (let i = 0; i < 600; i++) builder.line(`Line ${i}`);
    const payload = builder.bytes();
    expect(payload.length).toBeGreaterThan(1_048_576);
    expect(previewPrintJob(payload).truncated).toBe(true);
  });

  it("stops at a byte outside printable ASCII sent as text", () => {
    expect(previewPrintJob(Uint8Array.of(0x41, 0x80, 0x0a)).unsupported).toBe(true);
    expect(previewPrintJob(Uint8Array.of(0x41, 0xe9, 0x0a)).unsupported).toBe(true);
  });

  it.each([
    ["ESC t", [0x1b, 0x74, 16]],
    ["FS .", [0x1c, 0x2e]],
  ])("stops at %s, which selected a character table and which no job sends", (_name, bytes) => {
    const result = previewPrintJob(Uint8Array.from([0x41, ...bytes, 0x42]));
    expect(result.unsupported).toBe(true);
    expect(result.text).toBe("A");
  });

  it("reports the printer's column count and resolution", () => {
    expect(previewPrintJob(Uint8Array.of(0x41), { columns: 30, dpi: 203 })).toMatchObject({
      columns: 30,
      dpi: 203,
    });
  });
});

it.each([
  ["a cut", [0x1d, 0x56]],
  ["a QR command header", [0x1d, 0x28, 0x6b]],
  ["a raster image header", [0x1d, 0x76, 0x30]],
])("stops at %s cut off by the end of the payload", (_command, bytes) => {
  const result = previewPrintJob(Uint8Array.from([65, ...bytes]));
  expect(result.text).toBe("A");
  expect(result.truncated).toBe(true);
  expect(result.unsupported).toBe(false);
});

describe("once the block limit is reached", () => {
  const fullOfCuts = () => {
    const builder = esc();
    for (let i = 0; i < 2048; i++) builder.cut();
    return builder;
  };
  const tinyRaster = [0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0xff];

  it.each([
    ["a feed", (builder: ReturnType<typeof esc>) => builder.feed(1).bytes()],
    ["a cut", (builder: ReturnType<typeof esc>) => builder.cut().bytes()],
    [
      "a raster image",
      (builder: ReturnType<typeof esc>) => Uint8Array.from([...builder.bytes(), ...tinyRaster]),
    ],
  ])("stops at %s, reading nothing after it", (_command, finish) => {
    const payload = finish(fullOfCuts());
    const qrAfter = esc().qr("after the limit").bytes();
    const result = previewPrintJob(Uint8Array.from([...payload, ...qrAfter]));
    expect(result.blocks).toHaveLength(2048);
    expect(result.truncated).toBe(true);
    expect(result.qrData).toEqual([]);
  });
});
