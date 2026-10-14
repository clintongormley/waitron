import { isIP } from "node:net";
import type { DiscoveredDevice, OfficePrinterCapabilities } from "@waitron/print-agent";
import { type IppEndpoint, readPrinterCapabilities } from "./ipp-capabilities.js";
import { forEachBounded } from "./pool.js";

/**
 * Tells an office page printer apart from an ESC/POS receipt printer. Both can answer on port 9100,
 * so the agent asks the host's IPP service what it can print. The only request sent is
 * Get-Printer-Attributes — RFC 8011 §4.2.5: "This REQUIRED operation allows a Client to request the
 * values of the attributes of a Printer." This code opens no print job, sends no document, and sends
 * nothing to a device's raw port, where arbitrary bytes can print.
 *
 * "Lists A4 or US letter, so it is an office printer" is a heuristic. It has been checked against one
 * real office printer's reply (the HP Color LaserJet fixtures in `__fixtures__/`); no receipt
 * printer's IPP reply has been captured, so the receipt-roll case is tested only with synthesized
 * replies.
 */

const DEFAULT_IPP_PORT = 631;
const DEFAULT_IPP_PATH = "/ipp/print";

/** Resolves the raw IPP reply from the endpoint, or `undefined` for any failure. */
export type CapabilitiesQuery = (
  endpoint: IppEndpoint,
  timeoutMs: number,
) => Promise<Uint8Array | undefined>;

const QUERY_TIMEOUT_MS = 1500;
const QUERY_CONCURRENCY = 8;

const CACHE_LIFETIME_MS = 30_000;

const UNANSWERED: OfficePrinterCapabilities = {
  printable: false,
  reason: "invalid_reply",
  supportedFormats: [],
};

export interface OfficePrinterClassifierOptions {
  query: CapabilitiesQuery;
  /** The clock the cache lifetime is measured on. */
  now: () => number;
}

function endpointOf(device: DiscoveredDevice): IppEndpoint | undefined {
  if (device.transport !== "network_tcp" || device.host === undefined) return undefined;
  return {
    host: device.host,
    port: device.ipp?.port ?? DEFAULT_IPP_PORT,
    resourcePath: device.ipp?.resourcePath ?? DEFAULT_IPP_PATH,
  };
}

const keyOf = (e: IppEndpoint): string => `${e.host}\n${e.port}\n${e.resourcePath}`;

const listsPageSize = (c: OfficePrinterCapabilities): boolean =>
  c.printable || (c.reason !== "invalid_reply" && c.reason !== "unsupported_media");

/**
 * Returns a function that asks each network device's IPP queue what it can print: the queue its host
 * announced, else port 631 at `/ipp/print`. A device whose answer lists A4 or US letter gains
 * `pagePrinter: true` and an `office` report. A queue without an unambiguous raw counterpart (`ippOnly`) always gains
 * an `office` report, an unanswered query reading `invalid_reply`, because it has no raw port to be a
 * receipt printer on. Any other device the answer does not mark is returned unchanged, so a failed
 * check leaves a receipt printer selectable.
 *
 * Each endpoint is asked at most once per call, at most {@link QUERY_CONCURRENCY} at a time. An
 * answer — including a failure — is reused for {@link CACHE_LIFETIME_MS}, or until the clock moves
 * back past it. IPv6 literals are not asked: the request URI would need zone ids encoded. A host may
 * also be a name, and a name lookup slower than the query deadline leaves that device unanswered.
 */
export function createOfficePrinterClassifier(
  opts: OfficePrinterClassifierOptions,
): (devices: DiscoveredDevice[]) => Promise<DiscoveredDevice[]> {
  const answers = new Map<string, { capabilities: OfficePrinterCapabilities; checkedAt: number }>();
  return async (devices) => {
    const now = opts.now();
    for (const [key, answer] of answers) {
      if (now < answer.checkedAt || now - answer.checkedAt >= CACHE_LIFETIME_MS)
        answers.delete(key);
    }
    const toAsk = new Map<string, IppEndpoint>();
    for (const device of devices) {
      const endpoint = endpointOf(device);
      if (endpoint === undefined || isIP(endpoint.host) === 6) continue;
      const key = keyOf(endpoint);
      if (!answers.has(key)) toAsk.set(key, endpoint);
    }
    await forEachBounded([...toAsk], QUERY_CONCURRENCY, async ([key, endpoint]) => {
      let capabilities = UNANSWERED;
      try {
        const reply = await opts.query(endpoint, QUERY_TIMEOUT_MS);
        if (reply !== undefined) capabilities = readPrinterCapabilities(reply);
      } catch {
        // Unanswered: the check failed, which says nothing about the device.
      }
      answers.set(key, { capabilities, checkedAt: now });
    });
    return devices.map((device) => {
      const endpoint = endpointOf(device);
      if (endpoint === undefined) return device;
      const capabilities = answers.get(keyOf(endpoint))?.capabilities ?? UNANSWERED;
      const pagePrinter = listsPageSize(capabilities);
      if (!pagePrinter && device.ippOnly !== true) return device;
      return {
        ...device,
        ...(pagePrinter ? { pagePrinter: true as const } : {}),
        office: { port: endpoint.port, resourcePath: endpoint.resourcePath, ...capabilities },
      };
    });
  };
}
