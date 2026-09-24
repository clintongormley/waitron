import { request, type ClientRequest } from "node:http";
import { isIP } from "node:net";
import type { DiscoveredDevice } from "@waitron/print-agent";
import { forEachBounded } from "./pool.js";

/**
 * Tells an office page printer apart from an ESC/POS receipt printer. Both answer on port 9100, so the
 * agent asks the device's IPP service (port 631) which paper sizes it takes. The only request sent is
 * Get-Printer-Attributes — RFC 8011 §4.2.5: "This REQUIRED operation allows a Client to request the
 * values of the attributes of a Printer." This code opens no print job, sends no
 * document, and sends nothing to port 9100, where arbitrary bytes can print.
 *
 * "Lists A4 or US letter, so it is an office printer" is a heuristic. It has been checked against one
 * real office printer's reply (the HP Color LaserJet fixture in `__fixtures__/`); no receipt printer's
 * IPP reply has been captured, so the receipt-roll case is tested only with synthesized replies.
 */

export const IPP_PORT = 631;
const IPP_PATH = "/ipp/print";

const TAG_OPERATION_ATTRIBUTES = 0x01;
const TAG_END_OF_ATTRIBUTES = 0x03;
const TAG_URI = 0x45;
const TAG_NAME_WITHOUT_LANGUAGE = 0x42;
const TAG_KEYWORD = 0x44;
const TAG_CHARSET = 0x47;
const TAG_NATURAL_LANGUAGE = 0x48;

function attribute(tag: number, name: string, value: string): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const valueBytes = Buffer.from(value, "utf8");
  const header = Buffer.alloc(3);
  header.writeUInt8(tag, 0);
  header.writeUInt16BE(nameBytes.length, 1);
  const valueLength = Buffer.alloc(2);
  valueLength.writeUInt16BE(valueBytes.length, 0);
  return Buffer.concat([header, nameBytes, valueLength, valueBytes]);
}

/** An IPP 2.0 Get-Printer-Attributes request (operation 0x000B) asking only for `media-supported`. */
export function buildMediaQuery(host: string): Buffer {
  const header = Buffer.from([0x02, 0x00, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x01]);
  return Buffer.concat([
    header,
    Buffer.from([TAG_OPERATION_ATTRIBUTES]),
    attribute(TAG_CHARSET, "attributes-charset", "utf-8"),
    attribute(TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en"),
    attribute(TAG_URI, "printer-uri", `ipp://${host}:${IPP_PORT}${IPP_PATH}`),
    attribute(TAG_KEYWORD, "requested-attributes", "media-supported"),
    Buffer.from([TAG_END_OF_ATTRIBUTES]),
  ]);
}

const PAGE_SIZE_PREFIXES = ["iso_a4_", "na_letter_"];
const MAX_SUCCESSFUL_STATUS = 0x00ff;
/** Tags below this delimit attribute groups; tags at or above it carry a value. */
const FIRST_VALUE_TAG = 0x10;

/**
 * True when the reply carries IPP major version 1 or 2 and a successful status, parses cleanly to its
 * end-of-attributes tag, and lists an A4 or US letter size under `media-supported`. Anything malformed
 * is false, so a check that could not be read never hides a receipt printer.
 */
export function isPagePrinterReply(reply: Uint8Array): boolean {
  const buf = Buffer.from(reply.buffer, reply.byteOffset, reply.byteLength);
  if (buf.length < 8 || (buf[0] !== 1 && buf[0] !== 2)) return false;
  if (buf.readUInt16BE(2) > MAX_SUCCESSFUL_STATUS) return false;
  let offset = 8;
  // A value with a zero-length name is a further value of the attribute named before it (a 1setOf).
  let currentName: string | undefined;
  let pageSize = false;
  while (offset < buf.length) {
    const tag = buf[offset]!;
    offset += 1;
    if (tag === TAG_END_OF_ATTRIBUTES) return pageSize;
    if (tag < FIRST_VALUE_TAG) {
      currentName = undefined;
      continue;
    }
    if (offset + 2 > buf.length) return false;
    const nameLength = buf.readUInt16BE(offset);
    offset += 2;
    if (offset + nameLength + 2 > buf.length) return false;
    if (nameLength > 0) currentName = buf.toString("utf8", offset, offset + nameLength);
    else if (currentName === undefined) return false;
    offset += nameLength;
    const valueLength = buf.readUInt16BE(offset);
    offset += 2;
    if (offset + valueLength > buf.length) return false;
    // RFC 8011 §5.2.11 gives media the syntax `type2 keyword | name(MAX)`. Only keyword and
    // nameWithoutLanguage values are read; a nameWithLanguage size is skipped, which leaves it unmarked.
    if (
      currentName === "media-supported" &&
      (tag === TAG_KEYWORD || tag === TAG_NAME_WITHOUT_LANGUAGE)
    ) {
      const value = buf.toString("utf8", offset, offset + valueLength);
      if (PAGE_SIZE_PREFIXES.some((prefix) => value.startsWith(prefix))) pageSize = true;
    }
    offset += valueLength;
  }
  return false;
}

/** Resolves the raw IPP reply from `host`, or `undefined` for any failure; never throws. */
export type MediaQuery = (host: string, timeoutMs: number) => Promise<Uint8Array | undefined>;

const QUERY_TIMEOUT_MS = 1500;
const QUERY_CONCURRENCY = 8;
const MAX_REPLY_BYTES = 64 * 1024;

const CACHE_LIFETIME_MS = 30_000;

export interface PagePrinterMarkerOptions {
  query: MediaQuery;
  /** The clock the cache lifetime is measured on. */
  now: () => number;
}

/**
 * Returns a function that adds `pagePrinter: true` to each network device whose host answered as an
 * office printer. Every other device is returned unchanged, never marked `false`, so a failed or
 * unanswered check leaves a receipt printer selectable. Each host is asked at most once per call, at
 * most {@link QUERY_CONCURRENCY} at a time. An answer — including a failure — is reused for
 * {@link CACHE_LIFETIME_MS}, or until the clock moves back past it. IPv6 literals are skipped: the
 * request URI would need brackets and zone ids. A host may also be a name, and a name lookup slower
 * than the query deadline leaves that device unmarked.
 */
export function createPagePrinterMarker(
  opts: PagePrinterMarkerOptions,
): (devices: DiscoveredDevice[]) => Promise<DiscoveredDevice[]> {
  const answers = new Map<string, { pagePrinter: boolean; checkedAt: number }>();
  return async (devices) => {
    const now = opts.now();
    for (const [host, answer] of answers) {
      if (now < answer.checkedAt || now - answer.checkedAt >= CACHE_LIFETIME_MS)
        answers.delete(host);
    }
    const hosts = [
      ...new Set(
        devices
          .filter(
            (d) => d.transport === "network_tcp" && d.host !== undefined && isIP(d.host) !== 6,
          )
          .map((d) => d.host!)
          .filter((host) => !answers.has(host)),
      ),
    ];
    await forEachBounded(hosts, QUERY_CONCURRENCY, async (host) => {
      let pagePrinter = false;
      try {
        const reply = await opts.query(host, QUERY_TIMEOUT_MS);
        pagePrinter = reply !== undefined && isPagePrinterReply(reply);
      } catch {
        // Unmarked: the check failed, which says nothing about the device.
      }
      answers.set(host, { pagePrinter, checkedAt: now });
    });
    return devices.map((d) =>
      d.transport === "network_tcp" && d.host !== undefined && answers.get(d.host)?.pagePrinter
        ? { ...d, pagePrinter: true }
        : d,
    );
  };
}

/**
 * The live {@link MediaQuery}: one HTTP POST to the device's IPP service. One deadline covers connect,
 * headers and body; a non-200 status or a body over {@link MAX_REPLY_BYTES} resolves `undefined`.
 */
export function queryMediaSupported(
  host: string,
  timeoutMs: number,
  port = IPP_PORT,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    let req: ClientRequest | undefined;
    let finished = false;
    const finish = (reply: Uint8Array | undefined): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(reply);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    try {
      // Both throw synchronously: the encoder for a host over 65 535 bytes, `request` for a host that
      // cannot form a valid Host header.
      const body = buildMediaQuery(host);
      req = request(
        {
          host,
          port,
          path: IPP_PATH,
          method: "POST",
          headers: { "content-type": "application/ipp", "content-length": body.length },
        },
        (res) => {
          if (res.statusCode !== 200) {
            finish(undefined);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_REPLY_BYTES) finish(undefined);
            else chunks.push(chunk);
          });
          res.on("end", () => finish(Buffer.concat(chunks)));
          res.on("error", () => finish(undefined));
        },
      );
      req.on("error", () => finish(undefined));
      req.end(body);
    } catch {
      finish(undefined);
    }
  });
}
