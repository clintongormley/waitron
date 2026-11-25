import "./errors.js";
import { receiptPrintTransport } from "@waitron/db";
import {
  type OfficePrinterReport,
  isBluetoothAddress,
  type BluetoothCommandOutcome,
  BLUETOOTH_COMMAND_LIMIT,
  BLUETOOTH_FAILURE_REASONS,
  type BluetoothUnavailableReason,
  BLUETOOTH_UNAVAILABLE_REASONS,
} from "@waitron/print-agent";
import { requireString } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { IppQueue } from "./print-discovery-types.js";

export function optionalAgentSetupUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  const raw = requireString(value, "setupUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("management.request_invalid", { field: "setupUrl" });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    ["localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname) ||
    url.hostname.startsWith("127.")
  ) {
    throw new AppError("management.request_invalid", { field: "setupUrl" });
  }
  return url.origin;
}
export function optionalAgentSetupPort(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppError("management.request_invalid", { field: "setupPort" });
  }
  return value;
}
/**
 * The inventory the agent posts on every pull. `visible` is what the box can already reach, each with
 * a `localKey`; `scanned` is a discovery result of any transport. Only `visible` keys feed the claim's
 * eligibility.
 */
interface VisibleDeviceWire {
  transport: "usb" | "bluetooth";
  localKey: string;
  make?: string;
  model?: string;
  name?: string;
}
export interface DiscoveredDeviceWire {
  transport: string;
  localKey?: string;
  host?: string;
  port?: number;
  make?: string;
  model?: string;
  name?: string;
  serverName?: string;
  /** True when the agent saw A4/letter media over IPP: an office printer, not a receipt printer. */
  pagePrinter?: true;
  /** The IPP queue the host announced over mDNS. */
  ipp?: IppQueue;
  /** This queue has no unambiguous raw counterpart; `port` is its IPP port. */
  ippOnly?: true;
  office?: OfficePrinterReport;
  printerLike?: true;
}
interface PairedBluetoothWire {
  localKey: string;
  name?: string;
  printerLike?: boolean;
}
/** A malformed wire field is dropped, not refused, so a bad report cannot poison the in-memory store. */
function wireString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
export function screenVisible(raw: unknown): VisibleDeviceWire[] {
  if (!Array.isArray(raw)) return [];
  const out: VisibleDeviceWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const d = entry as Record<string, unknown>;
    if ((d.transport !== "usb" && d.transport !== "bluetooth") || typeof d.localKey !== "string") {
      continue;
    }
    out.push({
      transport: d.transport,
      localKey:
        d.transport === "bluetooth" && isBluetoothAddress(d.localKey)
          ? d.localKey.toUpperCase()
          : d.localKey,
      make: wireString(d.make),
      model: wireString(d.model),
      name: wireString(d.name),
    });
  }
  return out;
}
const OFFICE_FORMATS = ["application/pdf", "image/pwg-raster", "image/urf"] as const;
const OFFICE_MEDIA = ["iso_a4_210x297mm", "na_letter_8.5x11in"] as const;
const OFFICE_REFUSALS = [
  "invalid_reply",
  "unsupported_media",
  "unsupported_document_format",
  "unsupported_raster",
] as const;
const MAX_ADVERTISED_FORMATS = 32;
const MAX_FORMAT_LENGTH = 100;
const MAX_RESOURCE_PATH_LENGTH = 255;
/** Printable ASCII only: these strings come from a printer's own answer and reach the dashboard. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const oneOf = <T extends string>(members: readonly T[], v: unknown): T | undefined =>
  members.find((m) => m === v);
function screenIppQueue(raw: unknown): IppQueue | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { port, resourcePath } = raw as Record<string, unknown>;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  if (
    typeof resourcePath !== "string" ||
    !resourcePath.startsWith("/") ||
    resourcePath.length > MAX_RESOURCE_PATH_LENGTH ||
    !PRINTABLE_ASCII.test(resourcePath)
  ) {
    return undefined;
  }
  return { port, resourcePath };
}
/**
 * Rebuilt from its named fields, so nothing else the agent sent is kept. Formats past the 32nd are
 * dropped; any other bad field drops the report.
 */
function screenOfficeReport(raw: unknown): OfficePrinterReport | undefined {
  const queue = screenIppQueue(raw);
  if (queue === undefined) return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.supportedFormats)) return undefined;
  const supportedFormats: unknown[] = r.supportedFormats.slice(0, MAX_ADVERTISED_FORMATS);
  if (
    !supportedFormats.every(
      (f): f is string =>
        typeof f === "string" && f.length <= MAX_FORMAT_LENGTH && PRINTABLE_ASCII.test(f),
    )
  ) {
    return undefined;
  }
  if (r.printable === true) {
    const documentFormat = oneOf(OFFICE_FORMATS, r.documentFormat);
    const media = oneOf(OFFICE_MEDIA, r.media);
    const resolutionDpi = r.resolutionDpi === 300 || r.resolutionDpi === 600 ? r.resolutionDpi : 0;
    if (documentFormat === undefined || media === undefined || resolutionDpi === 0) {
      return undefined;
    }
    return { ...queue, printable: true, documentFormat, media, resolutionDpi, supportedFormats };
  }
  if (r.printable === false) {
    const reason = oneOf(OFFICE_REFUSALS, r.reason);
    if (reason === undefined) return undefined;
    return { ...queue, printable: false, reason, supportedFormats };
  }
  return undefined;
}
export function screenScanned(raw: unknown): DiscoveredDeviceWire[] {
  if (!Array.isArray(raw)) return [];
  const members = receiptPrintTransport.enumValues as readonly string[];
  const out: DiscoveredDeviceWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const d = entry as Record<string, unknown>;
    if (typeof d.transport !== "string" || !members.includes(d.transport)) continue;
    const localKey = wireString(d.localKey);
    const network = d.transport === "network_tcp";
    out.push({
      transport: d.transport,
      // Upper case, as paired reports and commands are, so one device keeps one entry and a Pair
      // naming it finds its scan.
      localKey: d.transport === "bluetooth" ? localKey?.toUpperCase() : localKey,
      host: wireString(d.host),
      port: typeof d.port === "number" && Number.isInteger(d.port) ? d.port : undefined,
      make: wireString(d.make),
      model: wireString(d.model),
      name: wireString(d.name),
      serverName: network ? wireString(d.serverName) : undefined,
      pagePrinter: d.pagePrinter === true ? true : undefined,
      ipp: network ? screenIppQueue(d.ipp) : undefined,
      ippOnly: network && d.ippOnly === true ? true : undefined,
      office: network ? screenOfficeReport(d.office) : undefined,
      printerLike: d.printerLike === true ? true : undefined,
    });
  }
  return out;
}
/** Kept apart from `visible`, which feeds the claim: a paired device has no delivery path yet. */
export function screenPairedBluetooth(raw: unknown): PairedBluetoothWire[] {
  if (!Array.isArray(raw)) return [];
  const out: PairedBluetoothWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const d = entry as Record<string, unknown>;
    if (typeof d.localKey !== "string" || !isBluetoothAddress(d.localKey)) continue;
    out.push({
      localKey: d.localKey.toUpperCase(),
      name: wireString(d.name),
      printerLike: typeof d.printerLike === "boolean" ? d.printerLike : undefined,
    });
  }
  return out;
}
export function screenBluetoothOutcomes(raw: unknown): BluetoothCommandOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: BluetoothCommandOutcome[] = [];
  for (const entry of raw.slice(0, BLUETOOTH_COMMAND_LIMIT)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, ok, error, reason } = entry as Record<string, unknown>;
    if (typeof id !== "string" || typeof ok !== "boolean") continue;
    if (error !== undefined && typeof error !== "string") continue;
    // Unbounded here: the store withholds an error that carries the PIN before bounding it.
    const outcome: BluetoothCommandOutcome = error === undefined ? { id, ok } : { id, ok, error };
    // A code a newer agent sends that this server does not know is dropped; the outcome stands.
    const known = oneOf(BLUETOOTH_FAILURE_REASONS, reason);
    if (known !== undefined) outcome.reason = known;
    out.push(outcome);
  }
  return out;
}
export type AgentBluetooth = "available" | BluetoothUnavailableReason;
/** Anything unrecognised reads as no report: a refused pull would stop the agent printing. */
export function screenBluetooth(raw: unknown): AgentBluetooth | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { available, reason } = raw as Record<string, unknown>;
  if (available === true) return "available";
  return available === false ? oneOf(BLUETOOTH_UNAVAILABLE_REASONS, reason) : undefined;
}
