import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DiscoveredDevice, OfficePrinterReport } from "@waitron/print-agent";
import { describe, expect, it, vi } from "vitest";
import { queryPrinterCapabilities } from "./ipp-capabilities.js";
import { createOfficePrinterClassifier, type CapabilitiesQuery } from "./ipp-probe.js";

/** The HP Color LaserJet MFP M181fw's raw reply to the capability query; see its `.md` beside it. */
const hpReply = (): Promise<Buffer> =>
  readFile(new URL("./__fixtures__/hp-color-laserjet-m181fw-capabilities.ipp", import.meta.url));

/** The same printer's raw reply to the earlier paper-size-only query (captured 2026-09-14): A4 and
 * letter, and no `document-format-supported`. */
const hpMediaOnlyReply = (): Promise<Buffer> =>
  readFile(new URL("./__fixtures__/hp-color-laserjet-m181fw-media-supported.ipp", import.meta.url));

const HP_FORMATS = [
  "image/urf",
  "application/PCLm",
  "application/octet-stream",
  "application/pdf",
  "application/postscript",
  "application/vnd.hp-PCL",
  "application/vnd.hp-PCLXL",
  "image/jpeg",
];
const hpOffice = (port = 631, resourcePath = "/ipp/print"): OfficePrinterReport => ({
  port,
  resourcePath,
  printable: true,
  documentFormat: "application/pdf",
  media: "iso_a4_210x297mm",
  resolutionDpi: 300,
  supportedFormats: HP_FORMATS,
});
const unanswered = (port: number, resourcePath: string): OfficePrinterReport => ({
  port,
  resourcePath,
  printable: false,
  reason: "invalid_reply",
  supportedFormats: [],
});

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

/** One fresh classifier per call, so these cases exercise classification without a warm cache. */
const classifyOnce = (devices: DiscoveredDevice[], query: CapabilitiesQuery) =>
  createOfficePrinterClassifier({ query, now: () => 0 })(devices);

const net = (host: string, port = 9100): DiscoveredDevice => ({
  transport: "network_tcp",
  host,
  port,
});
/** A raw device whose host also announced an IPP queue (A1's merge). */
const merged = (host: string, ippPort = 631, resourcePath = "/ipp/print"): DiscoveredDevice => ({
  ...net(host),
  ipp: { port: ippPort, resourcePath },
});
/** A host announced only by IPP: its `port` is the IPP port. */
const ippOnly = (
  host: string,
  ippPort = 8631,
  resourcePath = "/ipp/printer",
): DiscoveredDevice => ({
  transport: "network_tcp",
  host,
  port: ippPort,
  ipp: { port: ippPort, resourcePath },
  ippOnly: true,
});

describe("createOfficePrinterClassifier — a raw device with no IPP announcement", () => {
  it("marks only the hosts whose answer lists a page size, reports what they can print, and never writes false", async () => {
    const hp = await hpReply();
    const replies: Record<string, Uint8Array | undefined> = {
      "192.168.20.56": hp,
      "192.168.20.60": mediaReply(ROLL_SIZES),
      "192.168.20.61": mediaReply(["iso_a4_210x297mm"], 0x0400),
      "192.168.20.62": new Uint8Array(),
      "192.168.10.81": undefined, // port 631 closed, like the real Epson TM-T88III at this address
    };
    const query = vi.fn<CapabilitiesQuery>(async ({ host }) => {
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
    const marked = await classifyOnce(devices, query);
    expect(marked).toStrictEqual([
      { ...net("192.168.20.56"), name: "HP LaserJet", pagePrinter: true, office: hpOffice() },
      usb,
      net("192.168.20.60"),
      net("192.168.20.61"),
      net("192.168.20.62"),
      net("192.168.20.63"),
      net("192.168.10.81"),
    ]);
    for (const device of marked) {
      if (device.host !== "192.168.20.56") {
        expect(Object.hasOwn(device, "pagePrinter")).toBe(false);
        expect(Object.hasOwn(device, "office")).toBe(false);
      }
    }
    expect(query).toHaveBeenCalledWith(
      { host: "192.168.20.56", port: 631, resourcePath: "/ipp/print" },
      1500,
    );
    expect(query).toHaveBeenCalledTimes(6);
  });

  it("marks a reply listing A4 or letter among roll sizes, and not one listing roll sizes alone", async () => {
    const answer = async (sizes: string[]) =>
      (await classifyOnce([net("10.0.0.5")], async () => mediaReply(sizes)))[0];
    expect(await answer(ROLL_SIZES)).toStrictEqual(net("10.0.0.5"));
    for (const size of ["iso_a4_210x297mm", "na_letter_8.5x11in"]) {
      expect(await answer([...ROLL_SIZES, size])).toMatchObject({
        pagePrinter: true,
        office: { printable: false },
      });
    }
  });

  it("marks the HP's paper-size-only reply as an office printer that offers no format", async () => {
    const reply = await hpMediaOnlyReply();
    expect(await classifyOnce([net("192.168.20.56")], async () => reply)).toStrictEqual([
      {
        ...net("192.168.20.56"),
        pagePrinter: true,
        office: {
          port: 631,
          resourcePath: "/ipp/print",
          printable: false,
          reason: "unsupported_document_format",
          supportedFormats: [],
        },
      },
    ]);
  });

  it("asks each endpoint once, marks every port of the host, and skips IPv6 and host-less devices", async () => {
    const hp = await hpReply();
    const query = vi.fn<CapabilitiesQuery>(async () => hp);
    const marked = await classifyOnce(
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
      { ...net("192.168.20.56", 9100), pagePrinter: true, office: hpOffice() },
      { ...net("192.168.20.56", 9101), pagePrinter: true, office: hpOffice() },
      net("fe80::1"),
      { transport: "network_tcp", port: 9100 },
      { ...net("hp-printer.local"), pagePrinter: true, office: hpOffice() },
    ]);
    expect(query.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      { host: "192.168.20.56", port: 631, resourcePath: "/ipp/print" },
      { host: "hp-printer.local", port: 631, resourcePath: "/ipp/print" },
    ]);
  });

  it("never queries when there is no network device", async () => {
    const query = vi.fn<CapabilitiesQuery>(async () => undefined);
    const bt: DiscoveredDevice = { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF" };
    expect(await classifyOnce([bt], query)).toStrictEqual([bt]);
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
    await classifyOnce(devices, query);
    expect(peak).toBe(8);
  });
});

describe("createOfficePrinterClassifier — a raw device whose host also announced IPP", () => {
  it("asks the announced port and path, and follows the answer", async () => {
    const hp = await hpReply();
    const query = vi.fn<CapabilitiesQuery>(async () => hp);
    expect(await classifyOnce([merged("10.0.0.7", 8631, "/ipp/printer")], query)).toStrictEqual([
      {
        ...merged("10.0.0.7", 8631, "/ipp/printer"),
        pagePrinter: true,
        office: hpOffice(8631, "/ipp/printer"),
      },
    ]);
    expect(query.mock.calls).toEqual([
      [{ host: "10.0.0.7", port: 8631, resourcePath: "/ipp/printer" }, 1500],
    ]);
  });

  it.each([
    ["lists only receipt rolls", async () => mediaReply(ROLL_SIZES)],
    ["gives no reply", async () => undefined],
    ["sends bytes that are not IPP", async () => Buffer.from("<html></html>")],
    [
      "throws",
      async () => {
        throw new Error("socket hang up");
      },
    ],
  ] as Array<[string, CapabilitiesQuery]>)(
    "leaves the device unmarked, as a receipt printer, when the query %s",
    async (_label, query) => {
      expect(await classifyOnce([merged("10.0.0.7", 8631)], query)).toStrictEqual([
        merged("10.0.0.7", 8631),
      ]);
    },
  );
});

describe("createOfficePrinterClassifier — a host announced only by IPP", () => {
  it("reports an office printer at its announced queue", async () => {
    const hp = await hpReply();
    const query = vi.fn<CapabilitiesQuery>(async () => hp);
    expect(await classifyOnce([ippOnly("10.0.0.8")], query)).toStrictEqual([
      { ...ippOnly("10.0.0.8"), pagePrinter: true, office: hpOffice(8631, "/ipp/printer") },
    ]);
    expect(query).toHaveBeenCalledWith(
      { host: "10.0.0.8", port: 8631, resourcePath: "/ipp/printer" },
      1500,
    );
  });

  it("reports why there is no paper size when it lists only receipt rolls, and stays unmarked", async () => {
    expect(
      await classifyOnce([ippOnly("10.0.0.8")], async () => mediaReply(ROLL_SIZES)),
    ).toStrictEqual([
      {
        ...ippOnly("10.0.0.8"),
        office: {
          port: 8631,
          resourcePath: "/ipp/printer",
          printable: false,
          reason: "unsupported_media",
          supportedFormats: [],
        },
      },
    ]);
  });

  it.each([
    ["gives no reply", async () => undefined],
    ["sends bytes that are not IPP", async () => Buffer.from("<html></html>")],
    [
      "throws",
      async () => {
        throw new Error("socket hang up");
      },
    ],
  ] as Array<[string, CapabilitiesQuery]>)(
    "reports an unreadable answer when the query %s",
    async (_label, query) => {
      expect(await classifyOnce([ippOnly("10.0.0.8")], query)).toStrictEqual([
        { ...ippOnly("10.0.0.8"), office: unanswered(8631, "/ipp/printer") },
      ]);
    },
  );

  it("reports an unreadable answer for an IPv6 host it does not ask", async () => {
    const query = vi.fn<CapabilitiesQuery>(async () => undefined);
    expect(await classifyOnce([ippOnly("fe80::8")], query)).toStrictEqual([
      { ...ippOnly("fe80::8"), office: unanswered(8631, "/ipp/printer") },
    ]);
    expect(query).not.toHaveBeenCalled();
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

/** An in-process IPP server that records every request and answers each with `reply`. */
async function fakeIppServer(reply: Buffer): Promise<{
  port: number;
  requests: Array<{ url?: string; body: Buffer }>;
  server: Server;
}> {
  const requests: Array<{ url?: string; body: Buffer }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ url: req.url, body: Buffer.concat(chunks) });
      res.writeHead(200, { "content-type": "application/ipp" }).end(reply);
    });
  });
  return { port: await listen(server), requests, server };
}

describe("createOfficePrinterClassifier against in-process IPP servers", () => {
  it("sends one Get-Printer-Attributes per announced queue and nothing else, then reuses the answers", async () => {
    const office = await fakeIppServer(await hpReply());
    const receipt = await fakeIppServer(mediaReply(ROLL_SIZES));
    try {
      let clock = 0;
      const classify = createOfficePrinterClassifier({
        query: queryPrinterCapabilities,
        now: () => clock,
      });
      const devices = [
        ippOnly("127.0.0.1", office.port, "/ipp/printer"),
        merged("127.0.0.1", receipt.port, "/ipp/receipt"),
      ];
      const expected = [
        { ...devices[0], pagePrinter: true, office: hpOffice(office.port, "/ipp/printer") },
        devices[1],
      ];
      expect(await classify(devices)).toStrictEqual(expected);
      clock += 29_999;
      expect(await classify(devices)).toStrictEqual(expected);
      expect(office.requests.map((r) => r.url)).toEqual(["/ipp/printer"]);
      expect(receipt.requests.map((r) => r.url)).toEqual(["/ipp/receipt"]);
      for (const { body } of [...office.requests, ...receipt.requests]) {
        expect(body.readUInt16BE(2)).toBe(0x000b); // Get-Printer-Attributes
      }
    } finally {
      await close(office.server);
      await close(receipt.server);
    }
  });
});
