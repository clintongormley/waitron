import type { OfficePrinterCapabilities } from "@waitron/print-agent";
import { queryIppAttributes } from "./ipp-http.js";

export interface IppEndpoint {
  host: string;
  port: number;
  resourcePath: string;
}
export type PrinterCapabilities = OfficePrinterCapabilities;

export interface IppValue {
  tag: number;
  group: number;
  name: string;
  value: Buffer;
}
/** Reads a successful IPP reply's attributes; `undefined` for an unreadable or unsuccessful one. */
export function readAttributes(reply: Uint8Array): IppValue[] | undefined {
  const b = Buffer.from(reply.buffer, reply.byteOffset, reply.byteLength);
  if (b.length < 8 || (b[0] !== 1 && b[0] !== 2) || b.readUInt16BE(2) > 0xff) return undefined;
  const values: IppValue[] = [];
  let offset = 8;
  let group = 0;
  let name: string | undefined;
  while (offset < b.length) {
    const tag = b[offset++]!;
    if (tag === 3) return values;
    if (tag < 0x10) {
      group = tag;
      name = undefined;
      continue;
    }
    if (offset + 2 > b.length) return undefined;
    const n = b.readUInt16BE(offset);
    offset += 2;
    if (offset + n + 2 > b.length) return undefined;
    if (n > 0) name = b.toString("utf8", offset, offset + n);
    else if (name === undefined) return undefined;
    offset += n;
    const length = b.readUInt16BE(offset);
    offset += 2;
    if (offset + length > b.length) return undefined;
    values.push({ tag, group, name: name!, value: b.subarray(offset, offset + length) });
    offset += length;
  }
  return undefined;
}

export function readPrinterCapabilities(reply: Uint8Array): PrinterCapabilities {
  const values = readAttributes(reply);
  if (values === undefined)
    return { printable: false, reason: "invalid_reply", supportedFormats: [] };
  const strings = (name: string, tags: number[]): string[] =>
    values
      .filter((v) => v.group === 4 && v.name === name && tags.includes(v.tag))
      .map((v) => v.value.toString("utf8"));
  const supportedFormats = [...new Set(strings("document-format-supported", [0x49]))];
  const refused = (
    reason: "unsupported_media" | "unsupported_document_format" | "unsupported_raster",
  ): PrinterCapabilities => ({ printable: false, reason, supportedFormats });
  const sizes = strings("media-supported", [0x44, 0x42]);
  const media = sizes.includes("iso_a4_210x297mm")
    ? "iso_a4_210x297mm"
    : sizes.includes("na_letter_8.5x11in")
      ? "na_letter_8.5x11in"
      : undefined;
  if (media === undefined) return refused("unsupported_media");
  const chosen = (
    documentFormat: "application/pdf" | "image/pwg-raster" | "image/urf",
    resolutionDpi: 300 | 600,
  ): PrinterCapabilities => ({
    printable: true,
    documentFormat,
    media,
    resolutionDpi,
    supportedFormats,
  });
  if (supportedFormats.includes("application/pdf")) return chosen("application/pdf", 300);

  // Invoice raster bytes currently describe A4 pages; letter-only media cannot take that selection.
  if (media !== "iso_a4_210x297mm") return refused("unsupported_raster");

  // The current invoice raster encoders emit square 300/600 dpi, eight-bit grey pages.
  if (
    supportedFormats.includes("image/pwg-raster") &&
    strings("pwg-raster-document-type-supported", [0x44]).includes("sgray_8")
  ) {
    const resolutions = values
      .filter(
        (v) =>
          v.group === 4 &&
          v.name === "pwg-raster-document-resolution-supported" &&
          v.tag === 0x32 &&
          v.value.length === 9,
      )
      .filter((v) => v.value[8] === 3 && v.value.readInt32BE(0) === v.value.readInt32BE(4))
      .map((v) => v.value.readInt32BE(0));
    for (const dpi of [300, 600] as const)
      if (resolutions.includes(dpi)) return chosen("image/pwg-raster", dpi);
  }
  const urf = strings("urf-supported", [0x44]);
  if (supportedFormats.includes("image/urf") && urf.includes("W8")) {
    const resolutions = urf
      .filter((v) => /^RS[0-9]+(?:-[0-9]+)*$/.test(v))
      .flatMap((v) => v.slice(2).split("-").map(Number));
    for (const dpi of [300, 600] as const)
      if (resolutions.includes(dpi)) return chosen("image/urf", dpi);
  }
  return refused(
    supportedFormats.some((f) => f === "image/urf" || f === "image/pwg-raster")
      ? "unsupported_raster"
      : "unsupported_document_format",
  );
}

export function attribute(tag: number, name: string, value: string | Buffer): Buffer {
  const n = Buffer.from(name);
  const v = Buffer.from(value);
  const prefix = Buffer.alloc(3);
  prefix[0] = tag;
  prefix.writeUInt16BE(n.length, 1);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(v.length);
  return Buffer.concat([prefix, n, length, v]);
}
export function printerUri(endpoint: IppEndpoint): string {
  const host = endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host;
  return `ipp://${host}:${endpoint.port}${endpoint.resourcePath}`;
}
export function buildCapabilitiesQuery(endpoint: IppEndpoint): Buffer {
  const attributes = [
    "document-format-supported",
    "media-supported",
    "urf-supported",
    "pwg-raster-document-resolution-supported",
    "pwg-raster-document-type-supported",
  ];
  return Buffer.concat([
    Buffer.from([2, 0, 0, 11, 0, 0, 0, 1, 1]),
    attribute(0x47, "attributes-charset", "utf-8"),
    attribute(0x48, "attributes-natural-language", "en"),
    attribute(0x45, "printer-uri", printerUri(endpoint)),
    ...attributes.map((value, index) =>
      attribute(0x44, index === 0 ? "requested-attributes" : "", value),
    ),
    Buffer.from([3]),
  ]);
}
export function queryPrinterCapabilities(
  endpoint: IppEndpoint,
  timeoutMs: number,
): Promise<Uint8Array | undefined> {
  return queryIppAttributes(endpoint.host, endpoint.port, endpoint.resourcePath, timeoutMs, () =>
    buildCapabilitiesQuery(endpoint),
  );
}
