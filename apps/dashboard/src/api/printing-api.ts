import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { PrinterDeleteImpact, DeleteImpact } from "@waitron/shared";
import { BackupApi } from "./backup-api.js";
import type { EquipmentHolder, EquipmentRole } from "./devices-api.js";

// ── Printing types (print agents + printers + jobs) ───────────────────────────────────────────────

export type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll";

export type PrintPaperWidth = "58mm" | "80mm";

export type PrintResolution = "180dpi" | "203dpi";

export type PrintJobStatus = "queued" | "printing" | "done" | "failed" | "unknown";

export interface PrintAgentRow {
  id: string;
  name: string;
  host: string | null;
  setupUrl: string | null;
  active: boolean;
  nodeId: string | null;
  onThisBox: boolean;
  /** Null when the agent has reported nothing recently. */
  bluetooth: "available" | BluetoothUnavailableReason | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}
/** The agent's reason codes (`BLUETOOTH_UNAVAILABLE_REASONS`, packages/print-agent/src/client.ts),
 * repeated here because the dashboard does not import that package. */
export type BluetoothUnavailableReason =
  "dbus_unreachable" | "bluez_not_answering" | "no_controller" | "failed";

export interface Printer {
  lastPrintAgentId: string | null;
  pendingJobs: number;
  lastPrintAt: string | null;
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
  pollId: string | null;
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  hasCashDrawer: boolean;
  /** Carried by one device at a time, which `holder` names. */
  portable: boolean;
  pickupRoles: ("receipt" | "payment_slip")[];
  holder: EquipmentHolder | null;
  active: boolean;
}
/** One live profile listing one receipt or page printer, with the lists it is on. */
export interface PrinterProfileOffer {
  printerId: string | null;
  pagePrinterId: string | null;
  profileId: string;
  profileName: string;
  roles: Exclude<EquipmentRole, "card_terminal">[];
  departmentId: string | null;
  departmentName: string | null;
}
/** One prep station printing to one printer. */
export interface PrinterStationName {
  printerId: string;
  stationId: string;
  stationName: string;
}

export interface PrinterInput {
  name: string;
  transport: PrintTransport;
  host?: string;
  port?: number;
  localKey?: string;
  pollId?: string;
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  hasCashDrawer?: boolean;
  portable?: boolean;
}

export interface PrinterAddressProbe {
  host: string;
  port: number;
  requestedAt: number;
  expiresAt: number;
}
/** The agent's reason codes (`BLUETOOTH_FAILURE_REASONS`, packages/print-agent/src/client.ts), repeated
 * here because the dashboard does not import that package. */
export type BluetoothFailureReason =
  | "wrong_pin"
  | "pairing_refused"
  | "pin_needed"
  | "pin_too_slow"
  | "unsupported_method"
  | "not_found"
  | "out_of_range"
  | "timed_out"
  | "bluetooth_unavailable";
/** The latest Pair or Forget command for one agent and address; it never carries the PIN. */
export interface BluetoothCommandStatus {
  id: string;
  kind: "pair" | "forget";
  address: string;
  state: "pending" | "succeeded" | "failed";
  error?: string;
  /** Failed only: the agent's code for why, when it could name one. */
  reason?: BluetoothFailureReason;
  /** Pending only: how long until the server drops the command unanswered. */
  expiresInMs?: number;
}

export interface PrinterDeleteResult extends PrinterDeleteImpact {
  bluetoothUnpair?: {
    commands: { agentId: string; agentName: string; command: BluetoothCommandStatus }[];
    warnings: { agentName: string | null }[];
  };
}

export type OfficePrinterReport = { port: number; resourcePath: string } & (
  | {
      printable: true;
      documentFormat: "application/pdf" | "image/pwg-raster" | "image/urf";
      media: "iso_a4_210x297mm" | "na_letter_8.5x11in";
      resolutionDpi: 300 | 600;
      supportedFormats: string[];
    }
  | {
      printable: false;
      reason:
        | "invalid_reply"
        | "unsupported_media"
        | "unsupported_document_format"
        | "unsupported_raster";
      supportedFormats: string[];
    }
);

export interface DiscoveredPrinter {
  agentId: string;
  agentName: string | null;
  transport: PrintTransport;
  localKey?: string;
  host?: string | null;
  port?: number | null;
  make?: string | null;
  model?: string | null;
  name?: string | null;
  serverName?: string;
  pagePrinter?: true;
  /** The IPP queue the host announced over mDNS. */
  ipp?: { port: number; resourcePath: string };
  /** This queue has no unambiguous raw counterpart; `port` is its IPP port. Never a receipt printer. */
  ippOnly?: true;
  /** What the office printer's IPP queue answered: the format an A4 invoice would use, or why none. */
  office?: OfficePrinterReport;
  /** `office` is another agent's report for the same queue, not this agent's: it cannot be registered
   * through this agent. */
  officeLent?: true;
  /** Bluetooth only: true when the agent's scan decoded the device as a printer, or the agent's
   * fresh paired report says so; false only when that report says a paired device is not one. */
  printerLike?: boolean;
  /** Bluetooth only: the agent reported the device paired within the list's freshness window. */
  paired?: true;
  bluetoothCommand?: BluetoothCommandStatus;
  retainedName?: string;
  alreadyRegistered: boolean;
  printerId: string | null;
  lastSeenAt: string;
}
/** An office printer, as `GET /management-api/page-printers` lists it. */
export interface PagePrinterRow {
  id: string;
  name: string;
  host: string;
  port: number;
  resourcePath: string;
  documentFormat: "application/pdf" | "image/pwg-raster" | "image/urf";
  supportedFormats: string[];
  media: "iso_a4_210x297mm" | "na_letter_8.5x11in";
  resolutionDpi: number;
  active: boolean;
  /** The agent that prints to it, or null once that agent's record is gone. */
  agentId: string | null;
  agentName: string | null;
}
/** An office printer's test page, held by the server for a few minutes only. */
export interface PageTestPage {
  id: string;
  status: "waiting" | "printing" | "sent" | "failed" | "unknown";
  failureCode?:
    | "printer_refused"
    | "printer_unreachable"
    | "document_unavailable"
    | "printer_disabled"
    | "not_claimed"
    | "printer_aborted"
    | "timeout";
  /** What the printer is holding the page for, while it is printing. */
  hold?:
    | "paper_jam"
    | "cover_open"
    | "paper_out"
    | "tray_missing"
    | "ink_or_toner_out"
    | "output_full"
    | "paused"
    | "stopped";
}
/** One agent's discovered IPP queue, as `POST /management-api/page-printers` names it. */
export interface PagePrinterEntry {
  agentId: string;
  host: string;
  port: number;
  path: string;
}

export interface PrinterPatch {
  name?: string;
  transport?: PrintTransport;
  host?: string | null;
  port?: number | null;
  localKey?: string | null;
  pollId?: string | null;
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  hasCashDrawer?: boolean;
  portable?: boolean;
  pickupRoles?: ("receipt" | "payment_slip")[];
}

export type PrintPreviewBlock =
  | { kind: "text"; text: string; align?: "center" | "right" }
  | { kind: "feed"; lines: number }
  | { kind: "cut" }
  | {
      kind: "image";
      width: number;
      height: number;
      data: string;
      /** What a band drawn from a line of text reads as; absent for any other image. */
      text?: string;
      qrData?: string;
      align?: "center" | "right";
    };

export interface PrintJobPreview {
  /** The dots across the job's line, which the paper stands for. */
  widthDots: number;
  columns: number;
  text: string;
  blocks: PrintPreviewBlock[];
  qrData: string[];
  omittedGraphics: boolean;
  truncated: boolean;
  unsupported: boolean;
}

export interface DemoPrinterJob {
  id: string;
  kind: "document" | "drawer";
  createdAt: string;
  preview: PrintJobPreview | null;
}

export interface PrintJobRow {
  canResend: boolean;
  id: string;
  printerId: string;
  /** The job's printer's name, kept after the printer is deleted. */
  printerName: string;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  waitReason?: "printer.not_visible";
  kind?: "a4";
  pageDocument?: "invoice" | "receipt" | null;
  printerHold?: string | null;
  createdAt: string;
  deliveredAt: string | null;
  /** `any` receipt printer, one `wide_enough` for the printout, or only its `own`. */
  reprintRule: "any" | "wide_enough" | "own";
  /** The other active printers the server would take this printout on. */
  reprintPrinterIds: string[];
  /** Waiting on a disabled or unseen printer; a reprint elsewhere ends it there. */
  stuck: boolean;
}

export interface StationPrinter {
  stationId: string;
  printerId: string;
}

export class PrintingApi extends BackupApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  // ── Printing (print agents + printers + jobs) ────────────────────────────────────────────────────

  listAgents(): Promise<PrintAgentRow[]> {
    return this.#request<PrintAgentRow[]>("/management-api/print-agents", "GET");
  }
  updateAgent(id: string, patch: { name: string }): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}`, "PATCH", patch);
  }
  revokeAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/revoke`, "POST");
  }
  allowAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/allow`, "POST");
  }
  listPrinters(): Promise<Printer[]> {
    return this.#request<Printer[]>("/management-api/printers", "GET");
  }
  listPrinterProfiles(): Promise<PrinterProfileOffer[]> {
    return this.#request<PrinterProfileOffer[]>("/management-api/printer-profiles", "GET");
  }
  listPrinterStationNames(): Promise<PrinterStationName[]> {
    return this.#request<PrinterStationName[]>("/management-api/printer-stations", "GET");
  }
  createPrinter(input: PrinterInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/printers", "POST", input);
  }
  startPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/start",
      "POST",
    );
  }
  /** The route leaves the session's idle clock alone; call it through `background` so the
   * dashboard's own sign-out timer stays put too. */
  renewPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/renew",
      "POST",
    );
  }
  probePrinterAddress(input: { host: string; port: number }): Promise<PrinterAddressProbe> {
    return this.#request<PrinterAddressProbe>(
      "/management-api/printer-discovery/probe",
      "POST",
      input,
    );
  }
  listDiscoveredPrinters(): Promise<DiscoveredPrinter[]> {
    return this.#request<DiscoveredPrinter[]>("/management-api/discovered-printers", "GET");
  }
  listPagePrinters(): Promise<PagePrinterRow[]> {
    return this.#request<PagePrinterRow[]>("/management-api/page-printers", "GET");
  }
  /** Adds the printer, enables the disabled one at that queue, or moves the active one to this agent. */
  registerPagePrinter(
    input: PagePrinterEntry & { name?: string },
  ): Promise<{ id: string; outcome: "created" | "enabled" | "repointed" }> {
    return this.#request("/management-api/page-printers", "POST", input);
  }
  updatePagePrinter(id: string, patch: { name: string }): Promise<void> {
    return this.#request<void>(`/management-api/page-printers/${id}`, "PATCH", patch);
  }
  getPagePrinterDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/page-printers/${id}/delete-impact`, "GET");
  }
  deletePagePrinter(id: string): Promise<DeleteImpact> {
    return this.#request(`/management-api/page-printers/${id}`, "DELETE");
  }
  /** Answers the printer's page already out, if there is one. */
  printPagePrinterTestPage(id: string): Promise<PageTestPage> {
    return this.#request<PageTestPage>(`/management-api/page-printers/${id}/test-page`, "POST");
  }
  /** Null once the server no longer holds a page for the printer; call it through `background`. */
  readPagePrinterTestPage(id: string): Promise<PageTestPage | null> {
    return this.#request<PageTestPage | null>(
      `/management-api/page-printers/${id}/test-page`,
      "GET",
    );
  }
  pairBluetooth(
    agentId: string,
    address: string,
    pin: string,
  ): Promise<{ command: BluetoothCommandStatus }> {
    return this.#request<{ command: BluetoothCommandStatus }>(
      `/management-api/print-agents/${agentId}/bluetooth/pair`,
      "POST",
      { address, pin },
    );
  }
  updatePrinter(id: string, patch: PrinterPatch): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}`, "PATCH", patch);
  }
  getPrinterDeleteImpact(id: string): Promise<PrinterDeleteImpact> {
    return this.#request(`/management-api/printers/${id}/delete-impact`, "GET");
  }
  deletePrinter(id: string): Promise<PrinterDeleteResult> {
    return this.#request(`/management-api/printers/${id}`, "DELETE");
  }
  /** With no `printerId` the job is resent on its own printer. */
  resendPrintJob(id: string, printerId?: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/print-jobs/${id}/resend`,
      "POST",
      printerId === undefined ? undefined : { printerId },
    );
  }
  getPrintJobPreview(id: string): Promise<PrintJobPreview> {
    return this.#request<PrintJobPreview>(`/management-api/print-jobs/${id}/preview`, "GET");
  }
  listDemoPrinterJobs(): Promise<DemoPrinterJob[]> {
    return this.#request<DemoPrinterJob[]>("/management-api/demo-printer/jobs", "GET");
  }
  listRecentJobs(completedPage = 0): Promise<PrintJobRow[]> {
    const query = completedPage === 0 ? "" : `?completedPage=${completedPage}`;
    return this.#request<PrintJobRow[]>(`/management-api/print-jobs${query}`, "GET");
  }
  printEquipmentLabel(
    printerId: string,
    label: { kind: "printer" | "reader"; id: string },
  ): Promise<{ jobId: string }> {
    return this.#request(`/management-api/printers/${printerId}/equipment-label`, "POST", label);
  }
  testPrint(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/test-print`,
      "POST",
    );
  }
  printTestPage(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/print-test-page`,
      "POST",
    );
  }
  testPrinterDrawer(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/test-drawer`,
      "POST",
    );
  }
  sampleReceipt(
    printerId: string,
    settings: {
      paperWidth: PrintPaperWidth;
      resolution: PrintResolution;
    },
  ): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/sample-receipt`,
      "POST",
      settings,
    );
  }
  // ── Station↔printer mapping ────────────────────────────────────────────────────────────────────
  // Attach and detach are both idempotent on the server.

  listPrinterStations(printerId: string): Promise<StationPrinter[]> {
    return this.#request<StationPrinter[]>(`/management-api/printers/${printerId}/stations`, "GET");
  }
  attachPrinterToStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "POST",
    );
  }
  detachPrinterFromStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "DELETE",
    );
  }
  putPrinterOnEveryStation(printerId: string): Promise<void> {
    return this.#request<void>(`/management-api/printers/${printerId}/stations`, "POST");
  }
}
