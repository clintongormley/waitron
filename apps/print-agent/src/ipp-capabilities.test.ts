import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildCapabilitiesQuery,
  queryPrinterCapabilities,
  readPrinterCapabilities,
} from "./ipp-capabilities.js";

const hpReply = () =>
  readFile(new URL("./__fixtures__/hp-color-laserjet-m181fw-capabilities.ipp", import.meta.url));
type Value = { tag: number; name: string; value: string | Buffer };
function attribute({ tag, name, value }: Value): Buffer {
  const n = Buffer.from(name);
  const v = Buffer.from(value);
  const prefix = Buffer.alloc(3);
  prefix[0] = tag;
  prefix.writeUInt16BE(n.length, 1);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(v.length);
  return Buffer.concat([prefix, n, length, v]);
}
function reply(values: Value[], group = 4): Buffer {
  return Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, group]),
    ...values.map(attribute),
    Buffer.from([3]),
  ]);
}
const text = (name: string, value: string, tag = 0x44): Value => ({ name, value, tag });
function resolution(x: number, y = x, units = 3): Buffer {
  const b = Buffer.alloc(9);
  b.writeInt32BE(x);
  b.writeInt32BE(y, 4);
  b[8] = units;
  return b;
}
const rasterReply = (format: string, values: Value[]) =>
  reply([
    text("media-supported", "iso_a4_210x297mm"),
    text("document-format-supported", format, 0x49),
    ...values,
  ]);
const pwg = (res = resolution(300), type = "sgray_8") =>
  rasterReply("image/pwg-raster", [
    text("pwg-raster-document-type-supported", type),
    { tag: 0x32, name: "pwg-raster-document-resolution-supported", value: res },
  ]);

describe("office-printer capabilities", () => {
  it("chooses PDF and A4 from the captured HP reply, keeping its complete format list", async () => {
    expect(readPrinterCapabilities(await hpReply())).toEqual({
      printable: true,
      documentFormat: "application/pdf",
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      supportedFormats: [
        "image/urf",
        "application/PCLm",
        "application/octet-stream",
        "application/pdf",
        "application/postscript",
        "application/vnd.hp-PCL",
        "application/vnd.hp-PCLXL",
        "image/jpeg",
      ],
    });
  });
  it("chooses the HP's advertised Apple Raster at 600 dpi when PDF is removed", async () => {
    const hp = await hpReply();
    const entry = attribute(text("", "application/pdf", 0x49));
    const index = hp.indexOf(entry);
    expect(index).toBeGreaterThan(0);
    const without = Buffer.concat([hp.subarray(0, index), hp.subarray(index + entry.length)]);
    expect(readPrinterCapabilities(without)).toMatchObject({
      printable: true,
      documentFormat: "image/urf",
      resolutionDpi: 600,
    });
  });
  it("chooses PWG rather than JPEG and a listed square resolution", () => {
    expect(
      readPrinterCapabilities(
        reply([
          text("document-format-supported", "image/jpeg", 0x49),
          text("", "image/pwg-raster", 0x49),
          text("media-supported", "iso_a4_210x297mm"),
          text("pwg-raster-document-type-supported", "black_1"),
          text("", "sgray_8"),
          { tag: 0x32, name: "pwg-raster-document-resolution-supported", value: resolution(600) },
          { tag: 0x32, name: "", value: resolution(300) },
        ]),
      ),
    ).toEqual({
      printable: true,
      documentFormat: "image/pwg-raster",
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      supportedFormats: ["image/jpeg", "image/pwg-raster"],
    });
  });
  it("prefers supported PWG over supported Apple Raster when PDF is absent", () => {
    expect(
      readPrinterCapabilities(
        reply([
          text("media-supported", "iso_a4_210x297mm"),
          text("document-format-supported", "image/urf", 0x49),
          text("", "image/pwg-raster", 0x49),
          text("urf-supported", "W8"),
          text("", "RS600"),
          text("pwg-raster-document-type-supported", "sgray_8"),
          { tag: 0x32, name: "pwg-raster-document-resolution-supported", value: resolution(600) },
        ]),
      ),
    ).toMatchObject({ printable: true, documentFormat: "image/pwg-raster", resolutionDpi: 600 });
  });
  it("does not infer PWG support from a device id", () => {
    expect(
      readPrinterCapabilities(
        reply([
          text("media-supported", "iso_a4_210x297mm"),
          text("document-format-supported", "image/jpeg", 0x49),
          text("", "application/postscript", 0x49),
          text("printer-device-id", "CMD:PWG_RASTER,PDF;", 0x41),
        ]),
      ),
    ).toEqual({
      printable: false,
      reason: "unsupported_document_format",
      supportedFormats: ["image/jpeg", "application/postscript"],
    });
  });
  it("requires A4 or letter, and accepts letter alone for PDF", () => {
    for (const [media, printable] of [
      ["iso_a5_148x210mm", false],
      ["na_letter_8.5x11in", true],
    ] as const) {
      expect(
        readPrinterCapabilities(
          reply([
            text("media-supported", media),
            text("document-format-supported", "application/pdf", 0x49),
          ]),
        ),
      ).toMatchObject(
        printable ? { printable: true, media } : { printable: false, reason: "unsupported_media" },
      );
    }
  });
  it.each([
    resolution(300, 600),
    resolution(300, 300, 4),
    resolution(1200),
    resolution(0),
    Buffer.alloc(8),
  ])("refuses a raster resolution the encoder cannot produce (%j)", (value) => {
    expect(readPrinterCapabilities(pwg(value))).toMatchObject({
      printable: false,
      reason: "unsupported_raster",
    });
  });
  it.each([
    {
      format: "image/pwg-raster",
      attributes: [
        text("pwg-raster-document-type-supported", "sgray_8"),
        { tag: 0x32, name: "pwg-raster-document-resolution-supported", value: resolution(300) },
      ],
    },
    { format: "image/urf", attributes: [text("urf-supported", "W8"), text("", "RS600")] },
  ])(
    "refuses letter-only $format while the invoice encoder emits only A4",
    ({ format, attributes }) => {
      expect(
        readPrinterCapabilities(
          reply([
            text("media-supported", "na_letter_8.5x11in"),
            text("document-format-supported", format, 0x49),
            ...attributes,
          ]),
        ),
      ).toMatchObject({ printable: false, reason: "unsupported_raster" });
    },
  );

  it("requires the grey pixel type the PWG encoder emits", () => {
    expect(readPrinterCapabilities(pwg(resolution(300), "srgb_8"))).toMatchObject({
      printable: false,
      reason: "unsupported_raster",
    });
    expect(readPrinterCapabilities(pwg())).toMatchObject({
      printable: true,
      documentFormat: "image/pwg-raster",
      resolutionDpi: 300,
    });
  });
  it.each([
    { values: [] },
    { values: [text("urf-supported", "RS600")] },
    { values: [text("urf-supported", "W8"), text("", "RS1200")] },
  ])("refuses Apple Raster without grey and a supported resolution", ({ values }) => {
    expect(readPrinterCapabilities(rasterReply("image/urf", values))).toMatchObject({
      printable: false,
      reason: "unsupported_raster",
    });
  });
  it("reads multiple Apple Raster resolutions without inventing an unlisted one", () => {
    expect(
      readPrinterCapabilities(
        rasterReply("image/urf", [text("urf-supported", "W8"), text("", "RS300-600")]),
      ),
    ).toMatchObject({ printable: true, resolutionDpi: 300 });
    expect(
      readPrinterCapabilities(
        rasterReply("image/urf", [text("urf-supported", "W8"), text("", "RS600")]),
      ),
    ).toMatchObject({ printable: true, resolutionDpi: 600 });
  });
  it("does not use attributes from operation or unsupported groups, or wrongly typed values", () => {
    const valid = [
      text("media-supported", "iso_a4_210x297mm"),
      text("document-format-supported", "application/pdf", 0x49),
    ];
    expect(readPrinterCapabilities(reply(valid, 1))).toMatchObject({ printable: false });
    expect(readPrinterCapabilities(reply(valid, 5))).toMatchObject({ printable: false });
    expect(
      readPrinterCapabilities(
        reply([valid[0]!, text("document-format-supported", "application/pdf", 0x41)]),
      ),
    ).toMatchObject({ printable: false });
    expect(
      readPrinterCapabilities(
        reply([text("media-supported", "iso_a4_210x297mm", 0x21), valid[1]!]),
      ),
    ).toMatchObject({ printable: false });
  });
  it("refuses every truncation of the real reply and invalid IPP status/version", async () => {
    const hp = await hpReply();
    for (let n = 0; n < hp.length; n++)
      expect(readPrinterCapabilities(hp.subarray(0, n)), `length ${n}`).toEqual({
        printable: false,
        reason: "invalid_reply",
        supportedFormats: [],
      });
    for (const [offset, value] of [
      [0, 3],
      [2, 4],
    ] as const) {
      const bad = Buffer.from(hp);
      bad[offset] = value;
      expect(readPrinterCapabilities(bad)).toEqual({
        printable: false,
        reason: "invalid_reply",
        supportedFormats: [],
      });
    }
    const padded = Buffer.concat([Buffer.alloc(8), hp, Buffer.alloc(8)]);
    expect(
      readPrinterCapabilities(new Uint8Array(padded.buffer, padded.byteOffset + 8, hp.length)),
    ).toMatchObject({ printable: true });
  });
  it("rejects orphan continuations, length overruns, and group-crossing continuations", () => {
    const orphan = reply([text("", "iso_a4_210x297mm")]);
    const overrun = reply([text("media-supported", "iso_a4_210x297mm")]);
    overrun.writeUInt16BE(65535, 10);
    const crossing = Buffer.concat([
      reply([text("media-supported", "iso_a4_210x297mm")], 1).subarray(0, -1),
      Buffer.from([4]),
      attribute(text("", "application/pdf", 0x49)),
      Buffer.from([3]),
    ]);
    for (const bad of [orphan, overrun, crossing])
      expect(readPrinterCapabilities(bad)).toEqual({
        printable: false,
        reason: "invalid_reply",
        supportedFormats: [],
      });
  });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
describe("capability query", () => {
  it("sends only Get-Printer-Attributes to the announced port and resource path", async () => {
    const hp = await hpReply();
    let seen: {
      method?: string;
      url?: string;
      type?: string;
      encoding?: string;
      length?: string;
      body?: Buffer;
    } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen = {
          method: req.method,
          url: req.url,
          type: req.headers["content-type"],
          encoding: req.headers["transfer-encoding"],
          length: req.headers["content-length"],
          body: Buffer.concat(chunks),
        };
        res.end(hp);
      });
    });
    const port = await listen(server);
    try {
      const received = await queryPrinterCapabilities(
        { host: "127.0.0.1", port, resourcePath: "/ipp/printer" },
        1500,
      );
      expect(received).toBeDefined();
      expect(Buffer.from(received!)).toEqual(hp);
      expect(seen).toMatchObject({
        method: "POST",
        url: "/ipp/printer",
        type: "application/ipp",
        encoding: "chunked",
        length: undefined,
      });
      const expected = Buffer.concat([
        Buffer.from([2, 0, 0, 11, 0, 0, 0, 1, 1]),
        attribute(text("attributes-charset", "utf-8", 0x47)),
        attribute(text("attributes-natural-language", "en", 0x48)),
        attribute(text("printer-uri", `ipp://127.0.0.1:${port}/ipp/printer`, 0x45)),
        attribute(text("requested-attributes", "document-format-supported")),
        attribute(text("", "media-supported")),
        attribute(text("", "urf-supported")),
        attribute(text("", "pwg-raster-document-resolution-supported")),
        attribute(text("", "pwg-raster-document-type-supported")),
        Buffer.from([3]),
      ]);
      expect(seen.body).toEqual(expected);
      expect(
        buildCapabilitiesQuery({ host: "127.0.0.1", port, resourcePath: "/ipp/printer" }),
      ).toEqual(expected);
    } finally {
      await close(server);
    }
  });
  it("returns nothing for a silent printer within the deadline", async () => {
    const server = createServer(() => {});
    const port = await listen(server);
    try {
      const started = Date.now();
      expect(
        await queryPrinterCapabilities(
          { host: "127.0.0.1", port, resourcePath: "/ipp/print" },
          100,
        ),
      ).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await close(server);
    }
  });
});

// Carried over from the paper-size-only query this one replaced, whose reader and HTTP client
// these rules described.
describe("reading rules kept from the paper-size-only query", () => {
  const pdf = text("document-format-supported", "application/pdf", 0x49);
  it("accepts every successful status and IPP major versions 1 and 2, and refuses the rest", async () => {
    const hp = await hpReply();
    const altered = (offset: number, value: number, wide = false): Buffer => {
      const b = Buffer.from(hp);
      if (wide) b.writeUInt16BE(value, offset);
      else b[offset] = value;
      return b;
    };
    for (const status of [0x0001, 0x00ff])
      expect(readPrinterCapabilities(altered(2, status, true))).toMatchObject({ printable: true });
    for (const status of [0x0100, 0x0400])
      expect(readPrinterCapabilities(altered(2, status, true))).toMatchObject({
        reason: "invalid_reply",
      });
    expect(readPrinterCapabilities(altered(0, 1))).toMatchObject({ printable: true });
    for (const major of [0x00, 0x3c])
      expect(readPrinterCapabilities(altered(0, major))).toMatchObject({
        reason: "invalid_reply",
      });
  });
  it("counts a paper size only when it is tagged keyword or name, a continuation by its own tag", () => {
    // RFC 8011 §5.2.11: media is `type2 keyword | name(MAX)`.
    for (const [tag, printable] of [
      [0x44, true],
      [0x42, true],
      [0x21, false],
      [0x41, false],
    ] as const)
      expect(
        readPrinterCapabilities(reply([text("media-supported", "iso_a4_210x297mm", tag), pdf])),
      ).toMatchObject({ printable });
    for (const [tag, printable] of [
      [0x44, true],
      [0x21, false],
    ] as const)
      expect(
        readPrinterCapabilities(
          reply([
            text("media-supported", "oe_roll-80mm_3.15x1in"),
            text("", "na_letter_8.5x11in", tag),
            pdf,
          ]),
        ),
      ).toMatchObject({ printable });
  });
  it("follows a 1setOf continuation to the attribute that owns it", () => {
    expect(
      readPrinterCapabilities(
        reply([
          text("media-supported", "oe_roll-80mm_3.15x1in"),
          text("media-default", "iso_a4_210x297mm"),
          text("", "na_letter_8.5x11in"),
          pdf,
        ]),
      ),
    ).toMatchObject({ printable: false, reason: "unsupported_media" });
    expect(
      readPrinterCapabilities(
        reply([
          text("media-default", "iso_a4_210x297mm"),
          text("media-supported", "oe_roll-80mm_3.15x1in"),
          text("", "na_letter_8.5x11in"),
          pdf,
        ]),
      ),
    ).toMatchObject({ printable: true, media: "na_letter_8.5x11in" });
  });
});

describe("capability query failures", () => {
  const endpoint = (port: number) => ({ host: "127.0.0.1", port, resourcePath: "/ipp/print" });
  it("returns nothing for a non-200 reply, even one carrying a printable body", async () => {
    const hp = await hpReply();
    const server = createServer((_req, res) => res.writeHead(404).end(hp));
    const port = await listen(server);
    try {
      expect(await queryPrinterCapabilities(endpoint(port), 1500)).toBeUndefined();
    } finally {
      await close(server);
    }
  });
  it("returns nothing once the reply passes 64 KiB", async () => {
    const hp = await hpReply();
    const oversized = Buffer.concat([hp, Buffer.alloc(64 * 1024)]);
    const server = createServer((_req, res) => res.writeHead(200).end(oversized));
    const port = await listen(server);
    try {
      expect(await queryPrinterCapabilities(endpoint(port), 1500)).toBeUndefined();
    } finally {
      await close(server);
    }
  });
  it("returns nothing, rather than throwing, for a host name the HTTP client refuses", async () => {
    await expect(
      queryPrinterCapabilities({ host: "bad\nhost", port: 631, resourcePath: "/ipp/print" }, 1500),
    ).resolves.toBeUndefined();
  });
  it("returns nothing, rather than rejecting, for a host too long to encode in the query", async () => {
    await expect(
      queryPrinterCapabilities(
        { host: "a".repeat(70_000), port: 631, resourcePath: "/ipp/print" },
        1500,
      ),
    ).resolves.toBeUndefined();
  });
  it("returns nothing when the connection is refused", async () => {
    const server = createServer();
    const port = await listen(server);
    await close(server);
    expect(await queryPrinterCapabilities(endpoint(port), 1500)).toBeUndefined();
  });
  it("returns nothing, without waiting out the deadline, when the connection drops mid-reply", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write(Buffer.from([0x02, 0x00]), () => res.socket?.destroy());
    });
    const port = await listen(server);
    try {
      const started = Date.now();
      expect(await queryPrinterCapabilities(endpoint(port), 3000)).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      await close(server);
    }
  });
  it("returns nothing when the reply stalls after its headers", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.write(Buffer.from([0x02, 0x00]));
    });
    const port = await listen(server);
    try {
      const started = Date.now();
      expect(await queryPrinterCapabilities(endpoint(port), 100)).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await close(server);
    }
  });
});
