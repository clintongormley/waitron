import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  submitOnEnter,
  UrlStateController,
  baseStyles,
  selectStyles,
  type DataTableColumn,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "../widgets/row-actions.js";
import "../widgets/print-job-preview.js";
import { currentLocale, t } from "../i18n/t.js";
import {
  characterCalibration,
  characterFinderOptions,
  characterSetOptions,
  testCharsetSamples,
} from "@waitron/printing/src/test-page-samples.js";
import { prepareText } from "@waitron/printing/src/charset.js";
import type { SupportedLocale } from "@waitron/shared";
import { dashboardPath } from "../navigation.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import { formatIsoMinute } from "../date-utils.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  DiscoveredPrinter,
  JoinRequestRow,
  PairingModeState,
  PrintAgentRow,
  PrintCharacterSet,
  PrintJobRow,
  PrintJobPreview,
  PrintPaperWidth,
  PrintResolution,
  PrintTransport,
  Printer,
  PrinterPatch,
  PrinterAddressProbe,
  Till,
} from "../api/client.js";

interface EditablePrinter {
  id: string;
  name: string;
  transport: PrintTransport;
  host: string;
  port: string;
  localKey: string;
  pollId: string;
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  characterSet: PrintCharacterSet;
  characterTable: number;
  /** The settings as saved, so a save sends only the ones that changed. */
  saved: {
    paperWidth: PrintPaperWidth;
    resolution: PrintResolution;
    characterSet: PrintCharacterSet;
    characterTable: number;
  };
  active: boolean;
}

/** Discovery reports arrive on later agent polls, so a scan listens beyond its initial read. */
export const SCAN_LISTEN_MS = 10_000;
export const SCAN_POLL_MS = 2_000;

/** The longest line that fits identifies the paper width; the measured QR identifies resolution. */
const LINE_FITS: Readonly<Record<string, PrintPaperWidth>> = {
  A: "58mm",
  B: "58mm",
  C: "80mm",
  D: "80mm",
};
const QR_FITS: Readonly<Record<string, PrintResolution>> = {
  "40": "203dpi",
  "45": "180dpi",
};
@customElement("dashboard-printers-screen")
export class PrintersScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      wt-data-table::part(printer-meta) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(printer-provenance) {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-2);
        font-size: var(--wt-font-size-xs);
      }
      wt-data-table::part(discovered-details) {
        max-width: min(28vw, 24dvh);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(discovered-page-printer),
      wt-data-table::part(page-printer-hint) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(page-printer-hint) {
        display: block;
        max-width: min(28vw, 24dvh);
        font-size: var(--wt-font-size-sm);
      }

      wt-data-table::part(job-status) {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(job-status)::before {
        content: "";
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: 50%;
        background: var(--wt-color-text-muted);
      }
      wt-data-table::part(job-done)::before {
        background: var(--wt-color-success);
      }
      wt-data-table::part(job-failed)::before {
        background: var(--wt-color-danger);
      }
      wt-data-table::part(job-printing)::before {
        background: var(--wt-color-primary);
      }
      .printer-filter {
        display: grid;
        gap: var(--wt-space-1);
        max-width: calc(var(--wt-space-6) * 10);
        margin-bottom: var(--wt-space-3);
      }
      .form-fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-end;
      }
      .field-row > * {
        flex: 1 1 calc(var(--wt-space-6) * 6);
        min-width: 0;
      }
      .field-row > [name$="port"],
      .field-row > wt-button {
        flex: 0 1 calc(var(--wt-space-6) * 4);
      }
      fieldset {
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .radio-answer {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      input[type="radio"] {
        accent-color: var(--wt-color-primary);
      }
      .setup-steps {
        list-style: decimal;
        padding-left: var(--wt-space-5);
        margin-bottom: var(--wt-space-4);
      }
      .origin {
        overflow-wrap: anywhere;
      }
      .setting-field {
        display: grid;
        gap: var(--wt-space-1);
      }
      .section-action {
        margin-top: var(--wt-space-3);
      }
      .probe-panel {
        margin-bottom: var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .probe-panel summary {
        cursor: pointer;
        font-weight: var(--wt-font-weight-bold);
      }
      .probe-panel[open] summary {
        margin-bottom: var(--wt-space-3);
      }
      .scan-actions {
        justify-content: flex-end;
        margin-bottom: var(--wt-space-3);
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .panel-title {
        margin: var(--wt-space-6) 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        margin-right: auto;
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .hint {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
      .origin {
        font-family: var(--wt-font-family-mono, monospace);
        color: var(--wt-color-text);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .choices {
        display: flex;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.refreshErrorKey = codeOf(error);
    },
  );

  @state() private view = "";
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "printers") return;
      const view = this.#url.read("view");
      this.view =
        view !== null && ["queue", "printers", "agents"].includes(view)
          ? view
          : this.loading
            ? ""
            : this.#defaultView();
      if (this.view) this.#url.write({ view: this.view }, true);
    },
    dashboardPath,
  );

  #defaultView(): string {
    return !this.agents.some((agent) => agent.active)
      ? "agents"
      : !this.printers.some((printer) => printer.active)
        ? "printers"
        : "queue";
  }

  @state() private submitting = false;
  @state() private agents: PrintAgentRow[] = [];
  @state() private printers: Printer[] = [];
  @state() private printerStatus = "active";
  @state() private loading = true;
  @state() private addingAgent = false;
  @state() private addingPrinter = false;
  @state() private namingPrinter: DiscoveredPrinter | null = null;
  @state() private discoveredNames: Record<string, string> = {};
  @state() private testAnswers: { fits: string; qrFits: string; reads: string } | null = null;
  @state() private printingTest = false;
  @state() private testCalibrationLocale: SupportedLocale | null = null;
  @state() private printingSample = false;
  @state() private printingTableTest = false;
  @state() private tableBlockStart = 0;
  @state() private finderCalibrationLocale: SupportedLocale | null = null;
  @state() private finderChosenCode = "";
  #tableTestEpoch = 0;
  #testEpoch = 0;
  @state() private testError: string | null = null;
  @state() private editingPrinter: EditablePrinter | null = null;
  @state() private editingAgent: PrintAgentRow | null = null;
  @state() private formErrors: Record<string, string> = {};
  @state() private preview: PrintJobPreview | null = null;
  @state() private previewOpen = false;
  @state() private jobs: PrintJobRow[] = [];
  @state() private resendingJobId: string | null = null;

  @state() private tills: Till[] = [];

  @state() private armedRevokeId: string | null = null;
  @state() private armedDeletePrinterId: string | null = null;

  // Separate from `armedRevokeId`, so arming one agent's re-allow does not disarm another's revoke.
  @state() private armedAllowId: string | null = null;

  // Pairing is venue-wide; challenges stay cached because each request's numbers are fixed.
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];
  @state() private openRequestId: string | null = null;
  @state() private challenges: Record<string, string[]> = {};
  @state() private armedDenyId: string | null = null;

  @state() private discovered: DiscoveredPrinter[] = [];
  /** Not `submitting`: the listen runs for seconds and must not block Add or Register. */
  @state() private scanning = false;
  @state() private probeHost = "";
  @state() private probePort = "9100";
  @state() private probeErrors: Record<string, string> = {};
  @state() private probeStatus:
    "idle" | "pending" | "found" | "missing" | "registered" | "page_printer" = "idle";
  #probeTarget: PrinterAddressProbe | undefined;
  @state() private scanningAgents = false;
  #agentTimer?: ReturnType<typeof setInterval>;
  #agentScanUntil = 0;
  #agentReadInFlight = false;
  #agentEpoch = 0;
  #pairingOperations: Promise<void> = Promise.resolve();
  #renewPairingAt = 0;
  // `#scanUntil` is wall-clock because a throttled background tab stretches the ticks;
  // `#scanInFlight` stops the next tick overlapping a slow read whose older reply could overwrite
  // `discovered`.
  #scanTimer?: ReturnType<typeof setInterval>;
  #scanUntil = 0;
  #scanInFlight = false;
  #scanEpoch = 0;
  #registeredDevices = new Set<string>();
  #editTrigger?: HTMLButtonElement;

  @state() private errorKey: string | null = null;
  @state() private refreshErrorKey: string | null = null;
  @state() private addedPrinterName: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#endScan();
    this.#stopAgentModal();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.refreshErrorKey = null;
    this.armedRevokeId = null;
    this.armedDeletePrinterId = null;
    this.armedAllowId = null;
    this.armedDenyId = null;
    try {
      await Promise.all([
        this.#queries.watch("listAgents", [], (agents) => {
          this.agents = agents;
        }),
        this.#queries.watch("listPrinters", [], (printers) => {
          this.printers = printers;
        }),
        this.#queries.watch("listRecentJobs", [], (jobs) => {
          this.jobs = jobs;
        }),
        this.#queries.watch("listTills", [], (tills) => {
          this.tills = tills;
        }),
        this.#queries.watch("pairingMode", [], (pairing) => {
          this.pairing = pairing;
        }),
        this.#queries.watch("joinRequests", ["print_agent"], (pendingJoins) => {
          this.pendingJoins = pendingJoins;
        }),
      ]);
      if (!this.view) {
        this.view = this.#defaultView();
        if (this.#url.read("dashboard") === "printers") this.#url.write({ view: this.view }, true);
      }
      await this.#queries.watch("listDiscoveredPrinters", [], (devices) =>
        this.#setDiscovered(devices),
      );
    } catch (error) {
      this.refreshErrorKey = codeOf(error);
    } finally {
      this.loading = false;
    }
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Form submissions share a gate; immediate printer actions keep their own dispatch. */
  async #submit(action: () => Promise<unknown>): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    try {
      await this.#mutate(action);
    } finally {
      this.submitting = false;
    }
  }

  // ── Agents: join-and-accept ──────────────────────────────────────────────────────────────────────

  /** Disarms any armed deny, since that row may no longer exist. */
  async #reloadJoins(): Promise<void> {
    this.armedDenyId = null;
    const [pairing, pendingJoins] = await Promise.all([
      this.api.pairingMode(),
      this.api.joinRequests("print_agent"),
    ]);
    this.pairing = pairing;
    this.pendingJoins = pendingJoins;
  }

  async #reloadAgents(): Promise<void> {
    this.armedRevokeId = null;
    this.armedAllowId = null;
    this.agents = await this.api.listAgents();
  }

  // Serialize opens and closes so a late open cannot leave pairing enabled after closing the modal.
  #setPairing(open: boolean, passive = false): Promise<void> {
    const epoch = this.#agentEpoch;
    this.#pairingOperations = this.#pairingOperations.then(async () => {
      try {
        if (open) {
          if (epoch !== this.#agentEpoch || !this.addingAgent || !this.isConnected) return;
          this.#renewPairingAt = Date.now() + 60_000;
          const api = passive ? (this.api.background ?? this.api) : this.api;
          const result = await (passive ? api.renewPairingMode() : api.openPairingMode());
          if (epoch !== this.#agentEpoch) return;
          this.pairing = {
            open: true,
            openUntil: result.openUntil,
            refusedRecently: this.pairing?.refusedRecently ?? 0,
          };
        } else {
          await this.api.closePairingMode();
        }
      } catch (error) {
        if (epoch !== this.#agentEpoch) return;
        this.errorKey = codeOf(error);
        this.scanningAgents = false;
      }
    });
    return this.#pairingOperations;
  }

  #openAgentModal(): void {
    if (this.addingAgent) return;
    this.#agentEpoch++;
    this.errorKey = null;
    this.addingAgent = true;
    void this.#scanAgents();
    this.#agentTimer = setInterval(() => void this.#agentTick(), SCAN_POLL_MS);
  }

  #stopAgentModal(): void {
    if (!this.addingAgent) return;
    this.addingAgent = false;
    this.#agentEpoch++;
    this.#agentReadInFlight = false;
    this.pairing = {
      open: false,
      openUntil: null,
      refusedRecently: this.pairing?.refusedRecently ?? 0,
    };
    this.openRequestId = null;
    clearInterval(this.#agentTimer);
    this.#agentTimer = undefined;
    this.scanningAgents = false;
    void this.#setPairing(false);
  }

  async #scanAgents(): Promise<void> {
    if (this.scanningAgents) return;
    this.errorKey = null;
    this.scanningAgents = true;
    this.#agentScanUntil = Date.now() + SCAN_LISTEN_MS;
    const epoch = this.#agentEpoch;
    await this.#setPairing(true);
    if (epoch === this.#agentEpoch) await this.#agentTick();
  }

  async #agentTick(): Promise<void> {
    if (!this.addingAgent || this.#agentReadInFlight) return;
    this.#agentReadInFlight = true;
    const epoch = this.#agentEpoch;
    try {
      if (Date.now() >= this.#renewPairingAt) await this.#setPairing(true, true);
      const api = this.api.background ?? this.api;
      const pending = await api.joinRequests("print_agent");
      if (epoch === this.#agentEpoch && this.addingAgent && this.isConnected)
        this.pendingJoins = pending;
    } catch (error) {
      if (epoch !== this.#agentEpoch) return;
      this.refreshErrorKey = codeOf(error);
      this.scanningAgents = false;
    } finally {
      if (epoch === this.#agentEpoch) {
        this.#agentReadInFlight = false;
        if (Date.now() >= this.#agentScanUntil) this.scanningAgents = false;
      }
    }
  }

  /** Fetches the numbers only the first time: the server fixes them at join. */
  async #openRequest(id: string): Promise<void> {
    this.errorKey = null;
    this.openRequestId = id;
    if (this.challenges[id] !== undefined) return;
    try {
      const { choices } = await this.api.joinChallenge(id);
      this.challenges = { ...this.challenges, [id]: choices };
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Denying cannot be undone, so it takes a second, confirming click. */
  #onDeny(id: string): void {
    if (this.armedDenyId === id) {
      this.armedDenyId = null;
      void this.#deny(id);
      return;
    }
    this.armedDenyId = id;
  }

  async #deny(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.denyJoinRequest(id);
      if (this.openRequestId === id) this.openRequestId = null;
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** A wrong number has already deleted the request when `device.join_mismatch` arrives, so that code
   * closes the dialog and re-reads the queue; any other fault leaves the dialog open for a retry. */
  async #accept(request: JoinRequestRow, choice: string): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    this.submitting = true;
    try {
      await this.api.acceptPrintAgentJoinRequest(request.id, { choice });
      this.openRequestId = null;
      await Promise.all([this.#reloadJoins(), this.#reloadAgents()]);
    } catch (error) {
      const code = codeOf(error);
      this.errorKey = code;
      if (code === "device.join_mismatch") {
        this.openRequestId = null;
        try {
          await this.#reloadJoins();
        } catch (reloadError) {
          this.errorKey = codeOf(reloadError);
        }
      }
    } finally {
      this.submitting = false;
    }
  }

  // ── Agents: revoke ───────────────────────────────────────────────────────────────────────────────

  #onRevokeAgent(id: string): void {
    if (this.armedRevokeId === id) {
      this.armedRevokeId = null;
      void this.#revokeAgent(id);
      return;
    }
    this.armedRevokeId = id;
  }

  async #revokeAgent(id: string): Promise<void> {
    await this.#mutate(() => this.api.revokeAgent(id));
  }

  /** Two clicks, so a single accidental one cannot turn a revoked agent back on. */
  #onAllowAgent(id: string): void {
    if (this.armedAllowId === id) {
      this.armedAllowId = null;
      void this.#allowAgent(id);
      return;
    }
    this.armedAllowId = id;
  }

  async #allowAgent(id: string): Promise<void> {
    await this.#mutate(() => this.api.allowAgent(id));
  }

  // ── Printers ───────────────────────────────────────────────────────────────────────────────────

  async #loadDiscovered(epoch = this.#scanEpoch, passive = false): Promise<void> {
    const api = passive ? (this.api.background ?? this.api) : this.api;
    const devices = await api.listDiscoveredPrinters();
    if (epoch !== this.#scanEpoch || !this.addingPrinter || !this.isConnected) return;
    this.#setDiscovered(devices);
  }

  // Keep successful additions hidden even if the subsequent inventory refresh fails.
  #setDiscovered(devices: DiscoveredPrinter[]): void {
    this.discovered = devices.map((device) => ({
      ...device,
      alreadyRegistered:
        device.alreadyRegistered || this.#registeredDevices.has(this.#deviceKey(device)),
    }));
    const target = this.#probeTarget;
    if (target && this.probeStatus === "pending") {
      const match = this.discovered.find(
        (device) =>
          device.transport === "network_tcp" &&
          device.host === target.host &&
          device.port === target.port &&
          Date.parse(device.lastSeenAt) >= target.requestedAt,
      );
      if (match)
        this.probeStatus = !this.#canAdd(match)
          ? "registered"
          : this.#unsupportedPagePrinter(match)
            ? "page_printer"
            : "found";
    }
  }

  async #probe(): Promise<void> {
    if (this.probeStatus === "pending") return;
    const host = this.probeHost.trim();
    const port = Number(this.probePort);
    const errors: Record<string, string> = {};
    if (!host) errors.host = t("printers.probe_host_invalid");
    if (!/^\d+$/.test(this.probePort) || !Number.isInteger(port) || port < 1 || port > 65535)
      errors.port = t("printers.port_invalid");
    this.probeErrors = errors;
    if (Object.keys(errors).length) return;
    await this.#scan({ host, port });
  }

  /** Listen for automatic discovery or the separately expiring address check. */
  async #scan(address?: { host: string; port: number }): Promise<void> {
    if (!address && this.scanning) return;
    this.#endScan();
    this.#probeTarget = undefined;
    this.probeStatus = address ? "pending" : "idle";
    this.errorKey = null;
    this.scanning = true;
    const epoch = ++this.#scanEpoch;
    try {
      const target = address ? await this.api.probePrinterAddress(address) : undefined;
      if (!address) await this.api.startPrinterDiscovery();
      if (epoch !== this.#scanEpoch) return;
      this.#probeTarget = target;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      await this.#loadDiscovered(epoch);
      if (epoch !== this.#scanEpoch) return;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      this.#scanUntil =
        Date.now() + (target ? target.expiresAt - target.requestedAt : SCAN_LISTEN_MS);
      this.#scanTimer = setInterval(() => void this.#scanTick(), SCAN_POLL_MS);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.probeStatus = "idle";
      const field =
        typeof error === "object" &&
        error !== null &&
        "params" in error &&
        typeof error.params === "object" &&
        error.params !== null &&
        "field" in error.params
          ? error.params.field
          : undefined;
      if (
        address &&
        codeOf(error) === "management.request_invalid" &&
        (field === "host" || field === "port")
      ) {
        this.probeErrors = {
          [field]: t(field === "host" ? "printers.probe_host_invalid" : "printers.port_invalid"),
        };
      } else this.errorKey = codeOf(error);
      this.#endScan();
    }
  }

  async #scanTick(): Promise<void> {
    if (this.#scanInFlight) return;
    this.#scanInFlight = true;
    const epoch = this.#scanEpoch;
    try {
      await this.#loadDiscovered(epoch, true);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.refreshErrorKey = codeOf(error);
      this.probeStatus = "idle";
      this.#endScan();
      return;
    } finally {
      if (epoch === this.#scanEpoch) this.#scanInFlight = false;
    }
    if (epoch !== this.#scanEpoch) return;
    if (Date.now() >= this.#scanUntil) this.#endScan();
  }

  #endScan(): void {
    this.#scanEpoch++;
    if (this.#scanTimer !== undefined) clearInterval(this.#scanTimer);
    this.#scanTimer = undefined;
    this.#scanInFlight = false;
    this.scanning = false;
    if (this.probeStatus === "pending") this.probeStatus = "missing";
  }

  #deviceKey(device: DiscoveredPrinter): string {
    return device.localKey ?? `${device.host}:${device.port ?? 9100}`;
  }

  #disabledPrinter(device: DiscoveredPrinter): Printer | undefined {
    return this.printers.find((printer) => printer.id === device.printerId && !printer.active);
  }

  /** An office printer that is not a disabled registration: a retained registration stays re-addable. */
  #unsupportedPagePrinter(device: DiscoveredPrinter): boolean {
    return device.pagePrinter === true && this.#disabledPrinter(device) === undefined;
  }

  #canAdd(device: DiscoveredPrinter): boolean {
    return (
      !this.#registeredDevices.has(this.#deviceKey(device)) &&
      (!device.alreadyRegistered || this.#disabledPrinter(device) !== undefined)
    );
  }

  async #registerDiscovered(device: DiscoveredPrinter): Promise<void> {
    if (this.submitting || !this.#canAdd(device)) return;
    const key = this.#deviceKey(device);
    const name = (
      this.discoveredNames[key] ??
      this.#disabledPrinter(device)?.name ??
      this.#discoveredLabel(device)
    ).trim();
    this.formErrors = name ? {} : { [key]: t("form.name_required") };
    if (!name) return;
    this.submitting = true;
    this.errorKey = null;
    try {
      const disabled = this.#disabledPrinter(device);
      if (disabled) {
        await this.api.updatePrinter(disabled.id, {
          active: true,
          ...(name !== disabled.name ? { name } : {}),
        });
      } else if (device.transport === "network_tcp") {
        await this.api.createPrinter({
          name,
          transport: device.transport,
          host: device.host ?? undefined,
          port: device.port ?? 9100,
        });
      } else {
        await this.api.createPrinter({
          name,
          transport: device.transport,
          localKey: device.localKey,
        });
      }
      this.addedPrinterName = name;
      this.#registeredDevices.add(this.#deviceKey(device));
      if (
        device.transport === "network_tcp" &&
        device.host === this.#probeTarget?.host &&
        device.port === this.#probeTarget?.port
      )
        this.probeStatus = "registered";
      this.discovered = this.discovered.map((candidate) =>
        this.#deviceKey(candidate) === this.#deviceKey(device)
          ? { ...candidate, alreadyRegistered: true }
          : candidate,
      );
      await this.#closeModal("name-printer-modal");
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #editPrinter(id: string, patch: Partial<EditablePrinter>): void {
    if (this.editingPrinter?.id === id) this.editingPrinter = { ...this.editingPrinter, ...patch };
  }

  #editHandler<K extends "name" | "host" | "port">(
    id: string,
    field: K,
  ): (event: CustomEvent<{ value: string }>) => void {
    return (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#editPrinter(id, { [field]: event.detail.value } as Pick<EditablePrinter, K>);
    };
  }

  /** Save only this transport's connection fields; routing policy has its own editor. */
  async #savePrinter(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.editingPrinter;
    if (row?.id !== id) return;
    if (!this.#validatePrinter(row)) return;
    const patch: PrinterPatch = {
      name: row.name.trim(),
      active: row.active,
    };
    if (row.transport === "network_tcp") {
      patch.host = row.host.trim();
      patch.port = row.port.trim() === "" ? null : Number(row.port);
    }
    if (row.paperWidth !== row.saved.paperWidth) patch.paperWidth = row.paperWidth;
    if (row.resolution !== row.saved.resolution) patch.resolution = row.resolution;
    if (row.characterSet !== row.saved.characterSet) patch.characterSet = row.characterSet;
    if (row.characterTable !== row.saved.characterTable) patch.characterTable = row.characterTable;
    await this.#submit(async () => {
      await this.api.updatePrinter(id, patch);
      await this.#closeModal("edit-printer-modal");
    });
  }

  async #deactivatePrinter(id: string): Promise<void> {
    if (this.armedDeletePrinterId !== id) {
      this.armedDeletePrinterId = id;
      return;
    }
    this.armedDeletePrinterId = null;
    await this.#mutate(() => this.api.deactivatePrinter(id));
  }

  async #testPrint(id: string): Promise<void> {
    if (this.printingTest) return;
    const epoch = this.#testEpoch;
    this.printingTest = true;
    this.testError = null;
    try {
      const { calibrationLocale } = await this.api.testPrint(id);
      if (epoch === this.#testEpoch) {
        this.testCalibrationLocale = calibrationLocale;
        await this.#load();
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.testError = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.printingTest = false;
    }
  }

  async #sampleReceipt(p: EditablePrinter): Promise<void> {
    if (this.printingSample) return;
    if (!this.#validatePrinter(p)) return;
    this.printingSample = true;
    this.errorKey = null;
    try {
      await this.api.sampleReceipt(p.id, {
        paperWidth: p.paperWidth,
        resolution: p.resolution,
        characterSet: p.characterSet,
        characterTable: p.characterTable,
      });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.printingSample = false;
    }
  }

  async #testCharacterTables(p: EditablePrinter): Promise<void> {
    if (this.printingTableTest) return;
    this.printingTableTest = true;
    this.errorKey = null;
    const blockStart = this.tableBlockStart;
    const epoch = this.#tableTestEpoch;
    try {
      const { calibrationLocale } = await this.api.testCharacterTables(p.id, blockStart);
      if (epoch === this.#tableTestEpoch && this.tableBlockStart === blockStart) {
        if (this.finderCalibrationLocale !== calibrationLocale) this.finderChosenCode = "";
        this.finderCalibrationLocale = calibrationLocale;
      }
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.printingTableTest = false;
    }
  }

  #closeTest(): void {
    this.#testEpoch++;
    this.testAnswers = null;
    this.testCalibrationLocale = null;
    this.printingTest = false;
  }

  #openTest(p: EditablePrinter): void {
    this.#closeTest();
    this.testAnswers = { fits: "", qrFits: "", reads: "" };
    this.testError = null;
    void this.#testPrint(p.id);
  }

  #renderPrinterTest(): TemplateResult | typeof nothing {
    const p = this.editingPrinter;
    const answers = this.testAnswers;
    if (!p || !answers) return nothing;
    const charsetSamples = testCharsetSamples(this.testCalibrationLocale ?? currentLocale());
    const choices = (name: "fits" | "qrFits" | "reads", values: string[]) =>
      values.map(
        (value) =>
          html` <label class="radio-answer">
            <input
              type="radio"
              name=${name === "qrFits" ? "printer-test-qr-fits" : `printer-test-line-${name}`}
              value=${value}
              .checked=${answers[name] === value}
              @change=${() => {
                this.testAnswers = { ...answers, [name]: value };
              }}
            />
            ${
              name === "reads"
                ? `${value}: ${charsetSamples.find((sample) => sample.value === value)!.text}`
                : name === "qrFits"
                  ? t(value === "40" ? "printers.test_qr_40" : "printers.test_qr_45")
                  : value
            }
          </label>`,
      );
    return html`<wt-modal
      data-test="printer-test-dialog"
      heading=${t("printers.test_dialog_title")}
      .open=${true}
      @wt-close=${() => {
        this.#closeTest();
      }}
    >
      <div class="form-fields">
        ${this.testError ? html`<p role="alert" class="error">${codeMessage(this.testError)}</p>` : this.#renderError()}
        <p class="hint">${t("printers.test_dialog_hint")}</p>
        <fieldset>
          <legend>${t("printers.test_line_fits")}</legend>
          <div class="choices">${choices("fits", ["A", "B", "C", "D"])}</div>
        </fieldset>
        <fieldset data-test="test-qr-help">
          <legend>${t("printers.test_qr_help")}</legend>
          ${choices("qrFits", ["40", "45"])}
        </fieldset>
        <fieldset>
          <legend>${t("printers.test_line_reads")}</legend>
          ${choices(
            "reads",
            charsetSamples.map(({ value }) => value),
          )}
        </fieldset>
        ${charsetSamples.find(({ value }) => value === answers.reads)?.characterSet === "plain" ? html`<p class="hint">${t("printers.test_plain_hint")}</p>` : nothing}
        <wt-button
          data-test="reprint-test-page"
          ?loading=${this.printingTest}
          @click=${() => void this.#testPrint(p.id)}
          >${t("printers.test_page")}</wt-button
        >
      </div>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-printer-test"
          @click=${() => void this.#closeModal("printer-test-dialog")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="apply-printer-test"
          @click=${() => {
            const paperWidth = LINE_FITS[answers.fits];
            const resolution = QR_FITS[answers.qrFits];
            const textProfile = charsetSamples.find(({ value }) => value === answers.reads);
            this.#editPrinter(p.id, {
              ...(paperWidth ? { paperWidth } : {}),
              ...(resolution ? { resolution } : {}),
              ...(textProfile
                ? {
                    characterSet: textProfile.characterSet as PrintCharacterSet,
                    characterTable: textProfile.characterTable,
                  }
                : {}),
            });
            void this.#closeModal("printer-test-dialog");
          }}
          >${t("printers.test_apply")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────────────────────────

  #printerName(printerId: string): string {
    return this.printers.find((p) => p.id === printerId)?.name ?? printerId;
  }

  #timestamp(iso: string | null): string {
    if (iso === null) return t("printers.last_seen_never");
    return formatIsoMinute(iso);
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #agentActions(agent: PrintAgentRow): TemplateResult {
    const revokeArmed = this.armedRevokeId === agent.id;
    const allowArmed = this.armedAllowId === agent.id;
    return html`<dashboard-row-actions
      .label=${t("printers.row_actions").replace("{name}", agent.name)}
    >
      <wt-button
        data-test=${`edit-agent-${agent.id}`}
        @click=${(event: Event) => {
          this.#rememberEditTrigger(event);
          this.formErrors = {};
          this.errorKey = null;
          this.editingAgent = { ...agent };
        }}
        >${t("action.edit")}</wt-button
      >
      ${
        agent.active
          ? html`<wt-button
              variant="danger"
              data-keep-open
              data-test=${`revoke-agent-${agent.id}`}
              data-armed=${revokeArmed ? "true" : nothing}
              @click=${() => this.#onRevokeAgent(agent.id)}
            >
              ${revokeArmed ? t("printers.delete_confirm") : t("printers.disable")}
            </wt-button>`
          : html`<wt-button
              data-keep-open
              data-test=${`allow-agent-${agent.id}`}
              data-armed=${allowArmed ? "true" : nothing}
              @click=${() => this.#onAllowAgent(agent.id)}
            >
              ${allowArmed ? t("printers.allow_confirm") : t("printers.allow")}
            </wt-button>`
      }
    </dashboard-row-actions>`;
  }

  #renderPairing(): TemplateResult {
    return html`<p class="hint" data-test="pairing-panel">${t("printers.pairing_hint")}</p>
      ${(this.pairing?.refusedRecently ?? 0) > 0 ? html`<p class="hint" data-test="pairing-refused">${t("printers.pairing_refused").replace("{count}", String(this.pairing!.refusedRecently))}</p>` : nothing}
      ${this.pairing?.open ? html`<p data-test="pairing-until">${t("printers.pairing_open_until").replace("{time}", this.#timestamp(this.pairing.openUntil))}</p>` : nothing}`;
  }

  /** No join number is shown or fetched for the row (design §1.2 rule 1). */
  #renderJoinRequest(request: JoinRequestRow): TemplateResult {
    const armed = this.armedDenyId === request.id;
    return html`<li data-test="join-row-${request.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="join-label-${request.id}">${request.label}</span>
            <span class="meta">
              <span data-test="join-asked-${request.id}"
                >${formatIsoMinute(request.createdAt)}</span
              >
            </span>
          </div>
          <wt-button
            variant="primary"
            size="sm"
            data-test="join-review-${request.id}"
            aria-label=${`${t("printers.join_review")} ${request.label}`}
            @click=${() => void this.#openRequest(request.id)}
            >${t("printers.join_review")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="join-deny-${request.id}"
            data-armed=${armed ? "true" : nothing}
            aria-label=${`${armed ? t("printers.join_deny_confirm") : t("printers.join_deny")} ${request.label}`}
            @click=${() => this.#onDeny(request.id)}
            >${armed ? t("printers.join_deny_confirm") : t("printers.join_deny")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  /** Tapping a number is the accept, so there is no separate Accept control; a wrong tap denies the
   * request. */
  #renderAcceptDialog(): TemplateResult | typeof nothing {
    const request = this.pendingJoins.find((r) => r.id === this.openRequestId);
    if (request === undefined) return nothing;
    const choices = this.challenges[request.id];
    return html`<wt-dialog
      data-test="join-dialog"
      heading=${t("printers.join_dialog_title")}
      .open=${true}
      @wt-close=${() => (this.openRequestId = null)}
    >
      <p class="label" data-test="join-dialog-label">${request.label}</p>
      ${
        choices === undefined
          ? html`<p class="hint">${t("printers.join_loading")}</p>`
          : html`<p id="join-match-prompt">${t("printers.join_match_prompt")}</p>
              <div class="choices" role="group" aria-labelledby="join-match-prompt">
                ${choices.map(
                  // `size="lg"`: the number has to be legible across the room, against the agent's setup
                  // page — that is the whole job of a two-digit code.
                  (number) =>
                    html`<wt-button
                      variant="secondary"
                      size="lg"
                      data-choice=${number}
                      ?disabled=${this.submitting}
                      aria-label=${t("printers.join_choice_label").replace("{number}", number)}
                      @click=${() => void this.#accept(request, number)}
                      >${number}</wt-button
                    >`,
                )}
              </div>`
      }
      <wt-button
        slot="footer"
        variant="ghost"
        data-test="join-cancel"
        @click=${() => (this.openRequestId = null)}
        >${t("action.cancel")}</wt-button
      >
    </wt-dialog>`;
  }

  #renderAgentsSection(): TemplateResult {
    const columns: DataTableColumn<PrintAgentRow>[] = [
      {
        key: "name",
        label: t("printers.name"),
        sortValue: (a) => a.name,
        cell: (a) =>
          html`<span data-test=${`agent-row-${a.id}`}
            ><span data-test=${`agent-name-${a.id}`}>${a.name}</span></span
          >`,
      },
      {
        key: "host",
        label: t("printers.agent_host"),
        cell: (a) =>
          html`${a.host ?? (a.nodeId === null ? t("printers.not_reported") : nothing)}
          ${a.nodeId !== null ? html` <span part="printer-provenance" data-test=${`agent-provenance-${a.id}`}>${t("printers.provenance_self")}</span>` : nothing}`,
      },
      {
        key: "status",
        label: t("printers.status"),
        cell: (a) =>
          html`<span data-test=${`agent-status-${a.id}`}
            >${a.active ? t("printers.status_active") : t("printers.status_revoked")}</span
          >`,
      },
      {
        key: "lastSeen",
        label: t("printers.last_seen"),
        sortValue: (a) => a.lastSeenAt,
        cell: (a) =>
          html`<span data-test=${`agent-last-seen-${a.id}`}
            >${this.#timestamp(a.lastSeenAt)}</span
          >`,
      },
      { key: "actions", label: t("printers.actions"), cell: (a) => this.#agentActions(a) },
    ];
    return html`<section>
      <wt-data-table
        data-test="agents-table"
        aria-label=${t("printers.agents_title")}
        .rows=${this.agents}
        .columns=${columns}
        .rowKey=${(a: PrintAgentRow) => a.id}
        .loading=${this.loading}
        .loadingMessage=${t("printers.table_loading")}
        .emptyMessage=${t("printers.no_agents")}
      ></wt-data-table>
      <wt-button
        class="section-action"
        variant="primary"
        data-test="open-add-agent"
        @click=${() => this.#openAgentModal()}
        >${t("printers.add_agent")}</wt-button
      >
    </section>`;
  }

  #renderAgentModal(): TemplateResult | typeof nothing {
    if (!this.addingAgent) return nothing;
    return html`<wt-modal
      data-test="new-agent-modal"
      heading=${t("printers.add_agent")}
      .open=${true}
      @wt-close=${() => this.#stopAgentModal()}
    >
      ${this.#renderError()}
      <p class="hint">${t("printers.agent_setup_hint")}</p>
      <ol class="setup-steps">
        <li>${t("printers.agent_step_open")}</li>
        <li>
          ${t("printers.agent_step_address")}<br />
          <code class="origin" data-test="join-origin">${window.location.origin}</code>
        </li>
        <li>${t("printers.agent_step_match").replace("{action}", t("printers.join_review"))}</li>
      </ol>
      ${this.#renderPairing()}
      <section data-test="join-panel">
        <h3 class="panel-title">${t("printers.join_waiting_title")}</h3>
        ${
          this.pendingJoins.length === 0
            ? html`<p class="empty" data-test="no-join-requests">${t("printers.join_none")}</p>`
            : html`<ol>
                ${this.pendingJoins.map((r) => this.#renderJoinRequest(r))}
              </ol>`
        }
        <wt-button
          data-test="scan-agents"
          ?loading=${this.scanningAgents}
          @click=${() => void this.#scanAgents()}
          >${this.scanningAgents ? t("printers.scan_loading") : t("printers.scan_agents")}</wt-button
        >
      </section>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel-new-agent"
          @click=${() => void this.#closeModal("new-agent-modal")}
          >${t("action.close")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #renderEditAgent(): TemplateResult | typeof nothing {
    const agent = this.editingAgent;
    if (!agent) return nothing;
    return html`<wt-modal
      heading=${t("printers.edit_agent")}
      data-test="edit-agent-modal"
      .open=${true}
      @wt-close=${() => {
        this.editingAgent = null;
        this.#restoreEditFocus();
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector("[data-test=save-agent]"))}
    >
      ${this.#renderFeedback()}
      <wt-input
        name="agent-name"
        required
        label=${t("printers.name")}
        .value=${agent.name}
        .invalid=${!!this.formErrors.name}
        .error=${this.formErrors.name ?? ""}
        data-test="edit-agent-name"
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.editingAgent = { ...agent, name: e.detail.value };
        }}
      ></wt-input>
      <p>${t("printers.agent_host")}: ${agent.host ?? t("printers.not_reported")}</p>
      <p>${t("printers.last_seen")}: ${this.#timestamp(agent.lastSeenAt)}</p>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-edit-agent"
          @click=${() => void this.#closeModal("edit-agent-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="save-agent"
          ?loading=${this.submitting}
          @click=${() => void this.#saveAgent()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  async #saveAgent(): Promise<void> {
    const agent = this.editingAgent;
    if (!agent) return;
    this.formErrors = agent.name.trim() ? {} : { name: t("form.name_required") };
    if (Object.keys(this.formErrors).length) return;
    await this.#submit(async () => {
      await this.api.updateAgent(agent.id, { name: agent.name.trim() });
      await this.#closeModal("edit-agent-modal");
    });
  }

  #openPrinter(p: Printer, event: Event): void {
    this.#rememberEditTrigger(event);
    this.formErrors = {};
    this.errorKey = null;
    this.tableBlockStart = 0;
    this.finderCalibrationLocale = null;
    this.finderChosenCode = "";
    this.#tableTestEpoch++;
    this.editingPrinter = {
      id: p.id,
      name: p.name,
      transport: p.transport,
      active: p.active,
      host: p.host ?? "",
      port: p.port === null ? "" : String(p.port),
      localKey: p.localKey ?? "",
      pollId: p.pollId ?? "",
      paperWidth: p.paperWidth,
      resolution: p.resolution,
      characterSet: p.characterSet,
      characterTable: p.characterTable,
      saved: {
        paperWidth: p.paperWidth,
        resolution: p.resolution,
        characterSet: p.characterSet,
        characterTable: p.characterTable,
      },
    };
  }

  #printerActions(p: Printer): TemplateResult {
    return html`<dashboard-row-actions
      .label=${t("printers.row_actions").replace("{name}", p.name)}
    >
      <wt-button
        data-test=${`edit-printer-${p.id}`}
        @click=${(event: Event) => this.#openPrinter(p, event)}
        >${t("action.edit")}</wt-button
      >
      <wt-button
        variant="danger"
        data-test=${`deactivate-printer-${p.id}`}
        data-keep-open
        data-armed=${this.armedDeletePrinterId === p.id ? "true" : nothing}
        ?disabled=${!p.active}
        @click=${() => void this.#deactivatePrinter(p.id)}
        >${this.armedDeletePrinterId === p.id ? t("printers.delete_confirm") : t("printers.disable")}</wt-button
      >
    </dashboard-row-actions>`;
  }

  // This is the most recent inventory read, not a live presence indicator.
  #seenStatus(
    printerId: string,
    device: DiscoveredPrinter | undefined,
  ): TemplateResult | typeof nothing {
    if (device === undefined || device.agentName === null) return nothing;
    return html`<div data-test=${`printer-last-seen-${printerId}`} part="printer-meta">
      ${t("printers.seen_at")
        .replace("{agent}", device.agentName)
        .replace("{time}", formatIsoMinute(device.lastSeenAt))}
    </div>`;
  }

  #renderPrintersSection(): TemplateResult {
    const seen = new Map<string, DiscoveredPrinter>();
    for (const device of this.discovered)
      if (device.printerId !== null) seen.set(device.printerId, device);
    const columns: DataTableColumn<Printer>[] = [
      {
        key: "name",
        label: t("printers.name"),
        sortValue: (p) => p.name,
        cell: (p) =>
          html`<span data-test=${`printer-row-${p.id}`}>${p.name}</span
            >${this.#seenStatus(p.id, seen.get(p.id))}`,
      },
      {
        key: "pending",
        label: t("printers.pending_jobs"),
        sortValue: (p) => p.pendingJobs,
        cell: (p) => p.pendingJobs,
      },
      {
        key: "status",
        label: t("printers.status"),
        cell: (p) => (p.active ? t("printers.status_active") : t("printers.status_inactive")),
      },
      {
        key: "lastPrint",
        label: t("printers.last_print"),
        sortValue: (p) => p.lastPrintAt,
        cell: (p) => this.#timestamp(p.lastPrintAt),
      },
      {
        key: "till",
        label: t("printers.cash_register"),
        cell: (p) =>
          this.tills.some((till) => till.receiptPrinterId === p.id)
            ? t("printers.yes")
            : t("printers.no"),
      },
      {
        key: "type",
        label: t("printers.transport"),
        cell: (p) =>
          html`<span data-test=${`printer-transport-${p.id}`}>${transportName(p.transport)}</span>`,
      },
      {
        key: "address",
        label: t("printers.address"),
        cell: (p) => (p.host ? `${p.host}${p.port === null ? "" : `:${p.port}`}` : "—"),
      },
      { key: "device", label: t("printers.local_key"), cell: (p) => p.localKey ?? "—" },
      { key: "actions", label: t("printers.actions"), cell: (p) => this.#printerActions(p) },
    ];
    const hasActive = this.printers.some((printer) => printer.active);
    const hasDisabled = this.printers.some((printer) => !printer.active);
    const status =
      hasActive && hasDisabled ? this.printerStatus : hasActive ? "active" : "disabled";
    return html`<section>
      ${
        hasActive && hasDisabled
          ? html`<label class="printer-filter"
              >${t("printers.status")}
              <select
                name="printer-status-filter"
                .value=${this.printerStatus}
                @change=${(event: Event) => {
                  this.printerStatus = (event.target as HTMLSelectElement).value;
                }}
              >
                <option value="active">${t("printers.status_active")}</option>
                <option value="disabled">${t("printers.status_inactive")}</option>
                <option value="all">${t("printers.filter_all")}</option>
              </select>
            </label>`
          : nothing
      }
      <wt-data-table
        data-test="printers-table"
        aria-label=${t("printers.list_title")}
        .rows=${this.printers.filter((printer) => status === "all" || printer.active === (status === "active"))}
        .columns=${columns}
        .rowKey=${(p: Printer) => p.id}
        .emptyMessage=${t("printers.no_printers")}
      ></wt-data-table>
      <wt-button
        class="section-action"
        variant="primary"
        data-test="open-add-printer"
        @click=${() => {
          this.formErrors = {};
          this.errorKey = null;
          this.addingPrinter = true;
          this.probeHost = "";
          this.probePort = "9100";
          this.probeErrors = {};
          this.#registeredDevices.clear();
          this.discoveredNames = {};
          this.addedPrinterName = null;
          void this.#scan();
        }}
        >${t("printers.add_printer")}</wt-button
      >
    </section>`;
  }

  #renderJobsSection(): TemplateResult {
    const columns: DataTableColumn<PrintJobRow>[] = [
      {
        key: "printer",
        label: t("printers.job_printer"),
        cell: (j) =>
          html`<span data-test=${`job-row-${j.id}`}
            ><span data-test=${`job-printer-${j.id}`}>${this.#printerName(j.printerId)}</span></span
          >`,
      },
      {
        key: "status",
        label: t("printers.status"),
        cell: (j) =>
          html`<span part=${`job-status job-${j.status}`} data-test=${`job-status-${j.id}`}
              >${jobStatusName(j.status)}</span
            >${j.lastError === null ? nothing : html`<p data-test=${`job-error-${j.id}`}>${j.lastError}</p>`}`,
      },
      {
        key: "attempts",
        label: t("printers.job_attempts"),
        sortValue: (j) => j.attempts,
        cell: (j) => html`<span data-test=${`job-attempts-${j.id}`}>${j.attempts}</span>`,
      },
      {
        key: "queued",
        label: t("printers.queued_at"),
        sortValue: (j) => j.createdAt,
        cell: (j) => this.#timestamp(j.createdAt),
      },
      {
        key: "delivered",
        label: t("printers.delivered_at"),
        sortValue: (j) => j.deliveredAt,
        cell: (j) => this.#timestamp(j.deliveredAt),
      },
      {
        key: "preview",
        label: t("printers.actions"),
        cell: (j) =>
          html`<wt-button data-test=${`view-job-${j.id}`} @click=${() => void this.#viewJob(j.id)}
              >${t("printers.view_job")}</wt-button
            >${
              j.canResend
                ? html`<wt-button
                    data-test=${`resend-job-${j.id}`}
                    ?disabled=${this.resendingJobId !== null}
                    @click=${() => void this.#resendJob(j.id)}
                    >${t("printers.resend_job")}</wt-button
                  >`
                : nothing
            }`,
      },
    ];
    return html`<section>
      <p class="hint">${t("printers.jobs_limit")}</p>
      <wt-data-table
        data-test="jobs-table"
        aria-label=${t("printers.jobs_title")}
        .rows=${this.jobs}
        .columns=${columns}
        .rowKey=${(j: PrintJobRow) => j.id}
        .loading=${this.loading}
        .loadingMessage=${t("printers.table_loading")}
        .emptyMessage=${t("printers.no_jobs")}
      ></wt-data-table>
    </section>`;
  }

  async #resendJob(id: string): Promise<void> {
    if (this.resendingJobId !== null) return;
    this.resendingJobId = id;
    try {
      await this.#mutate(() => this.api.resendPrintJob(id));
    } finally {
      this.resendingJobId = null;
    }
  }

  async #viewJob(id: string): Promise<void> {
    this.errorKey = null;
    try {
      this.preview = await this.api.getPrintJobPreview(id);
      this.previewOpen = true;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #rememberEditTrigger(event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("dashboard-row-actions");
    this.#editTrigger = menu?.shadowRoot
      ?.querySelector<HTMLElement>("[popover]")
      ?.matches(":popover-open")
      ? menu.shadowRoot.querySelector<HTMLButtonElement>("button")!
      : undefined;
  }

  #restoreEditFocus(): void {
    // The action that opened the editor is hidden when its popover closes.
    this.#editTrigger?.focus();
    this.#editTrigger = undefined;
  }

  async #closeModal(id: string): Promise<void> {
    const modal = this.renderRoot.querySelector<WtModal>(`[data-test="${id}"]`);
    if (!modal?.open) return;
    if (id === "new-printer-modal") this.#endScan();
    // Native close restores focus before wt-close removes the draft and modal from the template.
    const closed = new Promise<void>((resolve) =>
      modal.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    modal.open = false;
    await closed;
  }

  #renderError(): TemplateResult {
    return html`${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    ${
      this.refreshErrorKey
        ? html`<div data-test="printer-refresh-error" role="alert">
            <p class="error">
              ${t("printers.refresh_failed")} ${codeMessage(this.refreshErrorKey)}
            </p>
            <wt-button data-test="refresh-printer-lists" @click=${() => void this.#load()}
              >${t("printers.refresh_lists")}</wt-button
            >
          </div>`
        : nothing
    }`;
  }

  #renderFeedback(): TemplateResult {
    return html`<wt-form-error-summary
        .heading=${t("form.error_heading")}
        .errors=${Object.values(this.formErrors)}
      ></wt-form-error-summary
      >${this.#renderError()}`;
  }

  #validatePrinter(row: {
    name: string;
    host: string;
    port: string;
    transport: PrintTransport;
    localKey?: string;
    pollId?: string;
    characterTable: number;
  }): boolean {
    const errors: Record<string, string> = {};
    if (!row.name.trim()) errors.name = t("form.name_required");
    if (row.transport === "network_tcp") {
      if (!row.host.trim()) errors.host = t("printers.host_required");
      if (
        row.port.trim() &&
        (!Number.isInteger(Number(row.port)) || Number(row.port) < 1 || Number(row.port) > 65535)
      )
        errors.port = t("printers.port_invalid");
    }
    if ((row.transport === "usb" || row.transport === "bluetooth") && !row.localKey?.trim())
      errors.localKey = t("printers.device_required");
    if (row.transport === "cloud_poll" && !row.pollId?.trim())
      errors.pollId = t("printers.poll_required");
    if (!Number.isInteger(row.characterTable) || row.characterTable < 0 || row.characterTable > 255)
      errors.characterTable = t("printers.character_table_invalid");
    this.formErrors = errors;
    return Object.keys(errors).length === 0;
  }

  #renderEditPrinter(): TemplateResult | typeof nothing {
    const p = this.editingPrinter;
    if (!p) return nothing;
    const finder = this.finderCalibrationLocale
      ? characterFinderOptions(this.finderCalibrationLocale, this.tableBlockStart)
      : [];
    const calibration = this.finderCalibrationLocale
      ? characterCalibration(this.finderCalibrationLocale)
      : null;
    const selectedCode =
      this.finderChosenCode === "plain"
        ? p.characterSet === "plain" && p.characterTable === 0
          ? "plain"
          : ""
        : (finder.find(
            ({ code, characterSet, characterTable }) =>
              code === this.finderChosenCode &&
              p.characterSet === characterSet &&
              p.characterTable === characterTable,
          )?.code ?? "");
    const field = (key: "name" | "host" | "port", label: string, required = false) =>
      html`<wt-input
        name=${`printer-${key}`}
        label=${label}
        .value=${p[key]}
        ?required=${required}
        type=${key === "port" ? "number" : "text"}
        data-test=${`printer-${key}-${p.id}`}
        .invalid=${!!this.formErrors[key]}
        .error=${this.formErrors[key] ?? ""}
        @wt-change=${this.#editHandler(p.id, key)}
      ></wt-input>`;
    return html`<wt-modal
      data-test="edit-printer-modal"
      heading=${t("printers.edit_printer")}
      .open=${true}
      @wt-close=${() => {
        this.editingPrinter = null;
        this.#closeTest();
        this.#restoreEditFocus();
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector(`[data-test="save-printer-${p.id}"]`))}
    >
      <div class="form-fields">
        ${this.#renderFeedback()}${field("name", t("printers.name"), true)}
        <p>${transportName(p.transport)}</p>
        ${
          p.transport === "network_tcp"
            ? html`<div class="field-row">
                ${field("host", t("printers.host"), true)}${field("port", t("printers.port"))}
              </div>`
            : html`<div class="setting-field">
                <span
                  >${t(p.transport === "cloud_poll" ? "printers.poll_id" : "printers.local_key")}</span
                >
                <span
                  data-test=${`printer-${p.transport === "cloud_poll" ? "poll-id" : "local-key"}-${p.id}`}
                >
                  ${p.transport === "cloud_poll" ? p.pollId : p.localKey}
                </span>
              </div>`
        }
        <wt-switch
          name="printer-active"
          label=${t("printers.active")}
          data-test=${`printer-active-${p.id}`}
          .checked=${p.active}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#editPrinter(p.id, { active: e.detail.checked })}
        ></wt-switch>
        <div class="field-row">
          <label class="setting-field"
            >${t("printers.paper_width")}
            <select
              name="printer-paper-width"
              .value=${p.paperWidth}
              @change=${(e: Event) =>
                this.#editPrinter(p.id, {
                  paperWidth: (e.target as HTMLSelectElement).value as PrintPaperWidth,
                })}
            >
              <option value="80mm">${t("printers.paper_width_80")}</option>
              <option value="58mm">${t("printers.paper_width_58")}</option>
            </select>
          </label>
          <label class="setting-field"
            >${t("printers.resolution")}
            <select
              name="printer-resolution"
              .value=${p.resolution}
              @change=${(e: Event) =>
                this.#editPrinter(p.id, {
                  resolution: (e.target as HTMLSelectElement).value as PrintResolution,
                })}
            >
              <option value="180dpi">${t("printers.resolution_180")}</option>
              <option value="203dpi">${t("printers.resolution_203")}</option>
            </select>
          </label>
        </div>
        <p class="hint">${t("printers.character_table_hint")}</p>
        <div class="field-row">
          <label class="setting-field"
            >${t("printers.table_block")}
            <select
              name="printer-table-block"
              @change=${(e: Event) => {
                this.tableBlockStart = Number((e.target as HTMLSelectElement).value);
                this.finderCalibrationLocale = null;
                this.finderChosenCode = "";
                this.#tableTestEpoch++;
              }}
            >
              ${Array.from({ length: 16 }, (_, index) => index * 16).map(
                (start) =>
                  html`<option value=${start} .selected=${start === this.tableBlockStart}>
                    ${start}–${start + 15}
                  </option>`,
              )}
            </select>
          </label>
          <wt-button
            data-test=${`print-character-tables-${p.id}`}
            ?loading=${this.printingTableTest}
            @click=${() => void this.#testCharacterTables(p)}
            >${t("printers.character_table_test")}</wt-button
          >
        </div>
        ${
          calibration
            ? calibration.finderEncodings.map(
                ({ label, characterSet }) =>
                  html`<div class="hint" data-test=${`finder-expected-${label}`}>
                    <strong>${label}:</strong>
                    ${calibration.finderSampleLines.map(
                      (line, index) =>
                        html`<div>
                          ${String.fromCharCode(65 + index)}: ${prepareText(line, characterSet)}
                        </div>`,
                    )}
                  </div>`,
              )
            : nothing
        }
        <label class="setting-field"
          >${t("printers.matching_code")}
          <select
            name="printer-matching-code"
            @change=${(e: Event) => {
              const code = (e.target as HTMLSelectElement).value;
              this.finderChosenCode = code;
              if (code === "plain")
                this.#editPrinter(p.id, { characterSet: "plain", characterTable: 0 });
              else {
                const match = finder.find((candidate) => candidate.code === code);
                if (match)
                  this.#editPrinter(p.id, {
                    characterSet: match.characterSet,
                    characterTable: match.characterTable,
                  });
              }
            }}
          >
            <option value="" .selected=${selectedCode === ""}>
              ${t("printers.matching_code_choose")}
            </option>
            ${finder.map(
              ({ code }) =>
                html`<option value=${code} .selected=${selectedCode === code}>${code}</option>`,
            )}
            <option value="plain" .selected=${selectedCode === "plain"}>
              ${t("printers.matching_code_plain")}
            </option>
          </select>
        </label>
        <wt-disclosure
          data-test="advanced-character-settings"
          heading=${t("printers.advanced_character_settings")}
          summary=${`${characterSetOptions(currentLocale()).find(({ value }) => value === p.characterSet)?.label ?? p.characterSet} · ${p.characterTable}`}
          .hasError=${!!this.formErrors.characterTable}
        >
          <div class="field-row">
            <label class="setting-field"
              >${t("printers.character_set")}
              <select
                name="printer-character-set"
                @change=${(e: Event) =>
                  this.#editPrinter(p.id, {
                    characterSet: (e.target as HTMLSelectElement).value as PrintCharacterSet,
                  })}
              >
                ${characterSetOptions(currentLocale()).map(
                  ({ value, label }) =>
                    html`<option value=${value} .selected=${p.characterSet === value}>
                      ${label}
                    </option>`,
                )}
              </select>
            </label>
            <wt-input
              name="printer-character-table"
              type="number"
              label=${t("printers.character_table")}
              .value=${Number.isNaN(p.characterTable) ? "" : String(p.characterTable)}
              .invalid=${!!this.formErrors.characterTable}
              .error=${this.formErrors.characterTable ?? ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                e.stopPropagation();
                this.#editPrinter(p.id, {
                  characterTable:
                    e.detail.value.trim() === "" ? Number.NaN : Number(e.detail.value),
                });
              }}
            ></wt-input>
          </div>
        </wt-disclosure>
        <p class="hint" data-test=${`test-page-hint-${p.id}`}>${t("printers.test_page_hint")}</p>
        <wt-button data-test=${`print-test-page-${p.id}`} @click=${() => this.#openTest(p)}
          >${t("printers.test_page")}</wt-button
        >
        <wt-button
          data-test=${`print-sample-receipt-${p.id}`}
          ?loading=${this.printingSample}
          @click=${() => void this.#sampleReceipt(p)}
          >${t("printers.sample_receipt")}</wt-button
        >
      </div>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-edit-printer"
          @click=${() => void this.#closeModal("edit-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test=${`save-printer-${p.id}`}
          ?loading=${this.submitting}
          @click=${() => void this.#savePrinter(p.id)}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #discoveredLabel(device: DiscoveredPrinter): string {
    if (device.name != null && device.name !== "") return device.name;
    const parts = [device.make, device.model].filter((x): x is string => x != null && x !== "");
    if (parts.length > 0) return parts.join(" ");
    return device.localKey ?? device.host ?? "";
  }

  #renderPrinterName(): TemplateResult | typeof nothing {
    const d = this.namingPrinter;
    if (!d) return nothing;
    const key = this.#deviceKey(d);
    return html`<wt-modal
      data-test="name-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      @wt-close=${() => {
        this.namingPrinter = null;
        this.formErrors = {};
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=confirm-add-printer]"))}
    >
      <div class="form-fields">
        ${this.#renderFeedback()}
        <p class="hint">
          ${this.#discoveredLabel(d)} · ${d.host ? `${d.host}:${d.port ?? 9100}` : d.localKey}
        </p>
        <wt-input
          required
          name="new-printer-name"
          label=${t("printers.name")}
          data-test=${`discovered-name-${key}`}
          .value=${this.discoveredNames[key] ?? this.#disabledPrinter(d)?.name ?? this.#discoveredLabel(d)}
          .invalid=${!!this.formErrors[key]}
          .error=${this.formErrors[key] ?? ""}
          ?disabled=${this.submitting}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.discoveredNames = { ...this.discoveredNames, [key]: event.detail.value };
          }}
        ></wt-input>
      </div>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-printer-name"
          @click=${() => void this.#closeModal("name-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="confirm-add-printer"
          ?loading=${this.submitting}
          @click=${() => void this.#registerDiscovered(d)}
          >${this.#disabledPrinter(d) ? t("printers.add_again") : t("action.add")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderNewPrinter(): TemplateResult | typeof nothing {
    if (!this.addingPrinter) return nothing;
    const columns: DataTableColumn<DiscoveredPrinter>[] = [
      {
        key: "name",
        label: t("printers.name"),
        cell: (d) =>
          html`<div
            part=${
              this.#unsupportedPagePrinter(d)
                ? "discovered-details discovered-page-printer"
                : "discovered-details"
            }
            data-test=${`discovered-row-${this.#deviceKey(d)}`}
          >
            <strong>${this.#discoveredLabel(d)}</strong>
            <div part="printer-meta">
              <div>${transportName(d.transport)}</div>
              <div>${d.host ? `${d.host}:${d.port ?? 9100}` : (d.localKey ?? "—")}</div>
              ${d.agentName ? html`<div>${t("printers.discovered_seen_on").replace("{agent}", d.agentName)}</div>` : nothing}
              ${this.#disabledPrinter(d) ? html`<div>${t("printers.add_again_hint")}</div>` : nothing}
            </div>
          </div>`,
      },
      {
        key: "add",
        label: t("printers.actions"),
        cell: (d) =>
          this.#unsupportedPagePrinter(d)
            ? html`<span part="page-printer-hint" data-test=${`page-printer-${this.#deviceKey(d)}`}
                >${t("printers.page_printer_hint")}</span
              >`
            : html`<wt-button
                variant="primary"
                data-test=${`register-${this.#deviceKey(d)}`}
                ?disabled=${this.submitting}
                @click=${() => {
                  if (this.submitting) return;
                  this.formErrors = {};
                  this.errorKey = null;
                  this.namingPrinter = d;
                }}
                >${this.#disabledPrinter(d) ? t("printers.add_again") : t("action.add")}</wt-button
              >`,
      },
    ];
    return html`<wt-modal
      data-test="new-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      @wt-close=${() => {
        this.addingPrinter = false;
        this.namingPrinter = null;
        this.#endScan();
      }}
    >
      ${this.addedPrinterName ? html`<p role="status" data-test="printer-added">${t("printers.added").replace("{name}", this.addedPrinterName)}</p>` : nothing}
      ${this.#renderFeedback()}
      <p class="hint">${t("printers.discovery_hint")}</p>
      <p class="hint">${t("printers.bluetooth_pair_note")}</p>
      <details class="probe-panel" data-test="probe-panel">
        <summary>${t("printers.probe_title")}</summary>
        <p class="hint">${t("printers.probe_hint")}</p>
        <wt-form-error-summary
          data-test="probe-errors"
          .heading=${t("form.error_heading")}
          .errors=${Object.values(this.probeErrors)}
        ></wt-form-error-summary>
        <div
          class="field-row"
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=probe-printer]"))}
        >
          <wt-input
            name="printer-probe-address"
            required
            label=${t("printers.probe_host")}
            data-test="probe-host"
            .value=${this.probeHost}
            .invalid=${!!this.probeErrors.host}
            .error=${this.probeErrors.host ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              this.probeHost = event.detail.value;
            }}
          ></wt-input>
          <wt-input
            name="printer-probe-port"
            required
            label=${t("printers.port")}
            data-test="probe-port"
            .value=${this.probePort}
            .invalid=${!!this.probeErrors.port}
            .error=${this.probeErrors.port ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              this.probePort = event.detail.value;
            }}
          ></wt-input>
          <wt-button
            variant="primary"
            data-test="probe-printer"
            ?loading=${this.probeStatus === "pending"}
            @click=${() => void this.#probe()}
            >${t("printers.probe_action")}</wt-button
          >
        </div>
        <p role="status" data-test="probe-status">
          ${
            this.probeStatus === "idle"
              ? nothing
              : t(
                  (
                    {
                      pending: "printers.probe_waiting",
                      found: "printers.probe_found",
                      missing: "printers.probe_missing",
                      registered: "printers.probe_registered",
                      page_printer: "printers.probe_page_printer",
                    } as const
                  )[this.probeStatus],
                )
          }
        </p>
      </details>
      <div class="actions scan-actions">
        <wt-button
          data-test="scan-printers"
          ?loading=${this.scanning}
          @click=${() => void this.#scan()}
          >${this.scanning ? t("printers.scan_loading") : t("printers.scan")}</wt-button
        >
      </div>
      <wt-data-table
        data-test="discovered-table"
        aria-label=${t("printers.discovered_title")}
        .columns=${columns}
        .rows=${this.discovered
          .filter((d) => this.#canAdd(d))
          .sort(
            (a, b) =>
              Number(this.#unsupportedPagePrinter(a)) - Number(this.#unsupportedPagePrinter(b)),
          )}
        .rowKey=${(d: DiscoveredPrinter) => this.#deviceKey(d)}
        .emptyMessage=${this.scanning ? t("printers.scan_loading") : t("printers.no_discovered")}
      ></wt-data-table>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="cancel-new-printer"
          @click=${() => void this.#closeModal("new-printer-modal")}
          >${t("action.close")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  override render(): TemplateResult {
    return html`<h1 class="title">${t("printers.title")}</h1>
      <wt-tabs
        label=${t("printers.title")}
        .value=${this.view}
        .items=${[
          { key: "queue", label: t("printers.jobs_title") },
          { key: "printers", label: t("printers.list_title") },
          { key: "agents", label: t("printers.agents_title") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (event.target !== event.currentTarget) return;
          this.view = event.detail.value;
          this.#url.write({ dashboard: "printers", view: this.view });
        }}
      >
        <div slot="queue">${this.#renderJobsSection()}</div>
        <div slot="printers">${this.#renderPrintersSection()}</div>
        <div slot="agents">${this.#renderAgentsSection()}</div> </wt-tabs
      >${this.addingAgent || this.addingPrinter || this.editingAgent || this.editingPrinter ? nothing : this.#renderError()}
      ${this.#renderAgentModal()}${this.#renderEditAgent()}${this.#renderNewPrinter()}${this.#renderPrinterName()}${this.#renderEditPrinter()}${this.#renderPrinterTest()}${this.#renderAcceptDialog()}
      <dashboard-print-job-preview
        .preview=${this.preview}
        .open=${this.previewOpen}
        @preview-close=${() => {
          this.previewOpen = false;
        }}
      ></dashboard-print-job-preview>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-printers-screen": PrintersScreen;
  }
}
