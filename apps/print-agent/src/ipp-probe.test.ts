import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DiscoveredDevice } from "@waitron/print-agent";
import { describe, expect, it, vi } from "vitest";
import {
  buildMediaQuery,
  createPagePrinterMarker,
  isPagePrinterReply,
  queryMediaSupported,
  type MediaQuery,
} from "./ipp-probe.js";

/** The raw reply a real HP Color LaserJet MFP M181fw sent to `buildMediaQuery`'s request. Captured
 * 2026-09-14 from the printer at 192.168.20.56 with
 * `curl -s -m 5 -o resp.bin -H 'Content-Type: application/ipp' --data-binary @req.bin http://192.168.20.56:631/ipp/print`,
 * where req.bin was built by hand and later compared equal, byte for byte, to
 * `buildMediaQuery("192.168.20.56")`. The printer gave the same 691-byte reply at `/`. */
const hpReply = (): Promise<Buffer> =>
  readFile(new URL("./__fixtures__/hp-color-laserjet-m181fw-media-supported.ipp", import.meta.url));

type Attr = { tag: number; name: string; value: string };

/** An IPP reply writer independent of the module under test, for synthesized replies. */
function ippReply(status: number, groups: Array<{ tag: number; attrs: Attr[] }>): Buffer {
  const bytes: number[] = [0x02, 0x00, status >> 8, status & 0xff, 0, 0, 0, 1];
  const str = (s: string): void => {
    bytes.push(s.length >> 8, s.length & 0xff, ...Buffer.from(s, "utf8"));
  };
  for (const group of groups) {
    bytes.push(group.tag);
    for (const a of group.attrs) {
      bytes.push(a.tag);
      str(a.name);
      str(a.value);
    }
  }
  bytes.push(0x03);
  return Buffer.from(bytes);
}

const operation = {
  tag: 0x01,
  attrs: [
    { tag: 0x47, name: "attributes-charset", value: "utf-8" },
    { tag: 0x48, name: "attributes-natural-language", value: "en" },
  ],
};

/** A successful reply whose printer group lists `media-supported` as a 1setOf of these sizes. */
function mediaReply(sizes: string[], status = 0x0000): Buffer {
  return ippReply(status, [
    operation,
    {
      tag: 0x04,
      attrs: sizes.map((value, i) => ({
        tag: 0x44,
        name: i === 0 ? "media-supported" : "",
        value,
      })),
    },
  ]);
}

// Synthesized: the roll sizes an 80 mm receipt printer would list if it answered IPP at all.
const ROLL_SIZES = ["oe_roll-80mm_3.15x1in", "custom_max_80x3276mm", "custom_min_80x10mm"];

describe("buildMediaQuery", () => {
  it("encodes the exact IPP 2.0 Get-Printer-Attributes request for media-supported", () => {
    // Lengths are written out by hand so the test does not share the encoder's arithmetic.
    const expected = Buffer.concat([
      Buffer.from([0x02, 0x00, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x01]), // version 2.0, op 0x000B, request-id 1
      Buffer.from([0x01]), // operation-attributes group
      Buffer.from([0x47, 0x00, 18]),
      Buffer.from("attributes-charset"),
      Buffer.from([0x00, 5]),
      Buffer.from("utf-8"),
      Buffer.from([0x48, 0x00, 27]),
      Buffer.from("attributes-natural-language"),
      Buffer.from([0x00, 2]),
      Buffer.from("en"),
      Buffer.from([0x45, 0x00, 11]),
      Buffer.from("printer-uri"),
      Buffer.from([0x00, 33]),
      Buffer.from("ipp://192.168.20.56:631/ipp/print"),
      Buffer.from([0x44, 0x00, 20]),
      Buffer.from("requested-attributes"),
      Buffer.from([0x00, 15]),
      Buffer.from("media-supported"),
      Buffer.from([0x03]), // end of attributes
    ]);
    expect(buildMediaQuery("192.168.20.56").toString("hex")).toBe(expected.toString("hex"));
  });
});

describe("isPagePrinterReply", () => {
  it("recognises the real HP LaserJet reply, which lists A4 and US letter", async () => {
    expect(isPagePrinterReply(await hpReply())).toBe(true);
  });

  it("reads a reply handed over as a Uint8Array view into a larger buffer", async () => {
    const reply = await hpReply();
    const backing = new Uint8Array(reply.length + 16);
    backing.set(reply, 8);
    expect(isPagePrinterReply(backing.subarray(8, 8 + reply.length))).toBe(true);
  });

  it("is not a page printer when the sizes are only receipt rolls (synthesized reply)", () => {
    expect(isPagePrinterReply(mediaReply(ROLL_SIZES))).toBe(false);
  });

  it("marks a synthesized reply once A4 alone, or US letter alone, joins the roll sizes", () => {
    // The positive control for the roll-only case: the same writer, one size added.
    expect(isPagePrinterReply(mediaReply([...ROLL_SIZES, "iso_a4_210x297mm"]))).toBe(true);
    expect(isPagePrinterReply(mediaReply([...ROLL_SIZES, "na_letter_8.5x11in"]))).toBe(true);
    expect(isPagePrinterReply(mediaReply(["iso_a4_210x297mm", ...ROLL_SIZES]))).toBe(true);
  });

  it("accepts every successful status and refuses the rest", async () => {
    const withStatus = async (status: number): Promise<Buffer> => {
      const reply = Buffer.from(await hpReply());
      reply.writeUInt16BE(status, 2);
      return reply;
    };
    expect(isPagePrinterReply(await withStatus(0x0001))).toBe(true);
    expect(isPagePrinterReply(await withStatus(0x00ff))).toBe(true);
    expect(isPagePrinterReply(await withStatus(0x0100))).toBe(false);
    expect(isPagePrinterReply(await withStatus(0x0400))).toBe(false);
  });

  it("accepts only IPP major versions 1 and 2", async () => {
    const withVersion = async (major: number): Promise<Buffer> => {
      const reply = Buffer.from(await hpReply());
      reply.writeUInt8(major, 0);
      return reply;
    };
    // Each differs from the real reply (major version 2) in byte 0 alone.
    expect(isPagePrinterReply(await withVersion(0x02))).toBe(true);
    expect(isPagePrinterReply(await withVersion(0x01))).toBe(true);
    expect(isPagePrinterReply(await withVersion(0x00))).toBe(false);
    expect(isPagePrinterReply(await withVersion(0x03))).toBe(false);
    expect(isPagePrinterReply(await withVersion(0x3c))).toBe(false);
  });

  it("counts a media-supported value only when it is tagged keyword or name", () => {
    // RFC 8011 §5.2.11: media is `type2 keyword | name(MAX)`. Each reply differs in one tag byte.
    const tagged = (tag: number): Buffer =>
      ippReply(0, [
        operation,
        { tag: 0x04, attrs: [{ tag, name: "media-supported", value: "iso_a4_210x297mm" }] },
      ]);
    expect(isPagePrinterReply(tagged(0x44))).toBe(true); // keyword
    expect(isPagePrinterReply(tagged(0x42))).toBe(true); // nameWithoutLanguage
    expect(isPagePrinterReply(tagged(0x21))).toBe(false); // integer
    expect(isPagePrinterReply(tagged(0x41))).toBe(false); // textWithoutLanguage
    // A 1setOf continuation is judged by its own tag, too.
    const continuation = (tag: number): Buffer =>
      ippReply(0, [
        operation,
        {
          tag: 0x04,
          attrs: [
            { tag: 0x44, name: "media-supported", value: "oe_roll-80mm_3.15x1in" },
            { tag, name: "", value: "na_letter_8.5x11in" },
          ],
        },
      ]);
    expect(isPagePrinterReply(continuation(0x44))).toBe(true);
    expect(isPagePrinterReply(continuation(0x21))).toBe(false);
  });

  it("is not a page printer for any truncation of the real reply, the empty body included", async () => {
    const reply = await hpReply();
    for (let length = 0; length < reply.length; length++) {
      expect(isPagePrinterReply(reply.subarray(0, length)), `length ${length}`).toBe(false);
    }
  });

  it("is not a page printer for garbled bytes", () => {
    expect(isPagePrinterReply(Buffer.from("<html><body>Not found</body></html>"))).toBe(false);
    // A value length pointing past the end of the reply.
    const overrun = mediaReply(["iso_a4_210x297mm"]);
    overrun.writeUInt16BE(0xffff, overrun.length - 1 - 16 - 2);
    expect(isPagePrinterReply(overrun)).toBe(false);
    // A zero-length name with no attribute before it to continue.
    const orphan = ippReply(0, [
      { tag: 0x04, attrs: [{ tag: 0x44, name: "", value: "iso_a4_210x297mm" }] },
    ]);
    expect(isPagePrinterReply(orphan)).toBe(false);
    // Controls: the same replies, well formed, are page printers.
    expect(isPagePrinterReply(mediaReply(["iso_a4_210x297mm"]))).toBe(true);
    const named = ippReply(0, [
      { tag: 0x04, attrs: [{ tag: 0x44, name: "media-supported", value: "iso_a4_210x297mm" }] },
    ]);
    expect(isPagePrinterReply(named)).toBe(true);
  });

  it("counts only media-supported values, following a 1setOf to the attribute that owns it", () => {
    const reply = ippReply(0, [
      operation,
      {
        tag: 0x04,
        attrs: [
          { tag: 0x44, name: "media-supported", value: "oe_roll-80mm_3.15x1in" },
          { tag: 0x44, name: "media-default", value: "iso_a4_210x297mm" },
          { tag: 0x44, name: "", value: "na_letter_8.5x11in" },
        ],
      },
    ]);
    expect(isPagePrinterReply(reply)).toBe(false);
    // Control: the letter continuation, placed under media-supported, is counted.
    const control = ippReply(0, [
      operation,
      {
        tag: 0x04,
        attrs: [
          { tag: 0x44, name: "media-default", value: "iso_a4_210x297mm" },
          { tag: 0x44, name: "media-supported", value: "oe_roll-80mm_3.15x1in" },
          { tag: 0x44, name: "", value: "na_letter_8.5x11in" },
        ],
      },
    ]);
    expect(isPagePrinterReply(control)).toBe(true);
  });

  it("does not carry an attribute name across a group boundary", () => {
    const reply = ippReply(0, [
      {
        tag: 0x01,
        attrs: [{ tag: 0x44, name: "media-supported", value: "oe_roll-80mm_3.15x1in" }],
      },
      { tag: 0x04, attrs: [{ tag: 0x44, name: "", value: "iso_a4_210x297mm" }] },
    ]);
    expect(isPagePrinterReply(reply)).toBe(false);
    // Control: the same two values inside one group.
    const oneGroup = ippReply(0, [
      {
        tag: 0x04,
        attrs: [
          { tag: 0x44, name: "media-supported", value: "oe_roll-80mm_3.15x1in" },
          { tag: 0x44, name: "", value: "iso_a4_210x297mm" },
        ],
      },
    ]);
    expect(isPagePrinterReply(oneGroup)).toBe(true);
  });
});

/** One fresh marker per call, so these cases exercise classification without a warm cache. */
const markOnce = (devices: DiscoveredDevice[], query: MediaQuery) =>
  createPagePrinterMarker({ query, now: () => 0 })(devices);

describe("createPagePrinterMarker", () => {
  const net = (host: string, port = 9100): DiscoveredDevice => ({
    transport: "network_tcp",
    host,
    port,
  });

  it("marks only the hosts whose IPP reply lists a page size, and never writes false", async () => {
    const hp = await hpReply();
    const replies: Record<string, Uint8Array | undefined> = {
      "192.168.20.56": hp,
      "192.168.20.60": mediaReply(ROLL_SIZES),
      "192.168.20.61": mediaReply(["iso_a4_210x297mm"], 0x0400),
      "192.168.20.62": new Uint8Array(),
      "192.168.10.81": undefined, // port 631 closed, like the real Epson TM-T88III at this address
    };
    const query = vi.fn(async (host: string) => {
      if (host === "192.168.20.63") throw new Error("socket hang up");
      return replies[host];
    });
    const usb: DiscoveredDevice = { transport: "usb", localKey: "SN-1", model: "TM-T20" };
    const devices = [
      { ...net("192.168.20.56"), name: "HP LaserJet" },
      usb,
      net("192.168.20.60"),
      net("192.168.20.61"),
      net("192.168.20.62"),
      net("192.168.20.63"),
      net("192.168.10.81"),
    ];
    const marked = await markOnce(devices, query);
    expect(marked).toStrictEqual([
      { ...net("192.168.20.56"), name: "HP LaserJet", pagePrinter: true },
      usb,
      net("192.168.20.60"),
      net("192.168.20.61"),
      net("192.168.20.62"),
      net("192.168.20.63"),
      net("192.168.10.81"),
    ]);
    for (const device of marked) {
      if (device.host !== "192.168.20.56") expect(Object.hasOwn(device, "pagePrinter")).toBe(false);
    }
    expect(query).toHaveBeenCalledWith("192.168.20.56", 1500);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it("asks each host once, marks every port of it, and skips IPv6 and host-less devices", async () => {
    const hp = await hpReply();
    const query = vi.fn<MediaQuery>(async () => hp);
    const marked = await markOnce(
      [
        net("192.168.20.56", 9100),
        net("192.168.20.56", 9101),
        net("fe80::1"),
        { transport: "network_tcp", port: 9100 },
        net("hp-printer.local"),
      ],
      query,
    );
    expect(marked).toStrictEqual([
      { ...net("192.168.20.56", 9100), pagePrinter: true },
      { ...net("192.168.20.56", 9101), pagePrinter: true },
      net("fe80::1"),
      { transport: "network_tcp", port: 9100 },
      { ...net("hp-printer.local"), pagePrinter: true },
    ]);
    expect(query.mock.calls.map(([host]) => host)).toEqual(["192.168.20.56", "hp-printer.local"]);
  });

  it("never queries when there is no network device", async () => {
    const query = vi.fn(async () => undefined);
    const bt: DiscoveredDevice = { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" };
    expect(await markOnce([bt], query)).toStrictEqual([bt]);
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps at most eight queries in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const query = async (): Promise<undefined> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return undefined;
    };
    const devices = Array.from({ length: 20 }, (_, i) => net(`10.0.0.${i + 1}`));
    await markOnce(devices, query);
    expect(peak).toBe(8);
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

describe("queryMediaSupported", () => {
  it("POSTs the query to /ipp/print as application/ipp and returns the reply bytes", async () => {
    const hp = await hpReply();
    const seen: { method?: string; url?: string; type?: string; body?: Buffer } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        Object.assign(seen, {
          method: req.method,
          url: req.url,
          type: req.headers["content-type"],
          body: Buffer.concat(chunks),
        });
        res.writeHead(200, { "content-type": "application/ipp" }).end(hp);
      });
    });
    const port = await listen(server);
    try {
      const reply = await queryMediaSupported("127.0.0.1", 1500, port);
      expect(Buffer.from(reply!).equals(hp)).toBe(true);
      expect(seen).toEqual({
        method: "POST",
        url: "/ipp/print",
        type: "application/ipp",
        body: buildMediaQuery("127.0.0.1"),
      });
    } finally {
      await close(server);
    }
  });

  it("returns nothing for a non-200 reply, even one carrying a page-printer body", async () => {
    const hp = await hpReply();
    const server = createServer((_req, res) => res.writeHead(404).end(hp));
    const port = await listen(server);
    try {
      expect(await queryMediaSupported("127.0.0.1", 1500, port)).toBeUndefined();
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
      expect(await queryMediaSupported("127.0.0.1", 1500, port)).toBeUndefined();
    } finally {
      await close(server);
    }
  });

  it("returns nothing, rather than throwing, for a host name the HTTP client refuses", async () => {
    await expect(queryMediaSupported("bad\nhost", 1500, 631)).resolves.toBeUndefined();
  });

  it("returns nothing, rather than rejecting, for a host too long to encode in the query", async () => {
    await expect(queryMediaSupported("a".repeat(70_000), 1500, 631)).resolves.toBeUndefined();
  });

  it("returns nothing when the connection is refused", async () => {
    const server = createServer();
    const port = await listen(server);
    await close(server);
    expect(await queryMediaSupported("127.0.0.1", 1500, port)).toBeUndefined();
  });

  it("returns nothing when the device accepts but never answers within the deadline", async () => {
    const server = createServer(() => {
      /* never responds */
    });
    const port = await listen(server);
    try {
      const started = Date.now();
      expect(await queryMediaSupported("127.0.0.1", 100, port)).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await close(server);
    }
  });

  it("returns nothing, without waiting out the deadline, when the connection drops mid-reply", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write(Buffer.from([0x02, 0x00]), () => res.socket?.destroy());
    });
    const port = await listen(server);
    try {
      const started = Date.now();
      expect(await queryMediaSupported("127.0.0.1", 3000, port)).toBeUndefined();
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
      expect(await queryMediaSupported("127.0.0.1", 100, port)).toBeUndefined();
    } finally {
      await close(server);
    }
  });
});
