import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  focusFirstInvalid,
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
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "../widgets/row-actions.js";
import "../widgets/print-job-preview.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import {
  characterCalibration,
  characterFinderOptions,
  characterSetOptions,
} from "@waitron/printing/src/test-page-samples.js";
import { prepareText } from "@waitron/printing/src/charset.js";
import type { SupportedLocale } from "@waitron/shared";
import { dashboardPath } from "../navigation.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import { formatIsoMinute } from "../date-utils.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  BluetoothCommandStatus,
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

interface PrinterDraft {
  name: string;
  host: string;
  port: string;
  transport: PrintTransport;
  localKey?: string;
  pollId?: string;
  characterTable: number;
}

/** A dialog's one message beside its action: each non-empty part, in order. */
const bottomMessage = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" ");

const refusal = (code: string | null): string | null => (code === null ? null : codeMessage(code));

/** The `last_error` the server stores for a job it ended because this printer's agent cannot print
 * to it (`BLUETOOTH_PRINTING_UNAVAILABLE`, packages/printing/src/runtime.ts). */
const BLUETOOTH_PRINTING_UNAVAILABLE = "printer.bluetooth_printing_unavailable";

const jobReason = (lastError: string): string =>
  lastError === BLUETOOTH_PRINTING_UNAVAILABLE ? codeMessage(lastError) : lastError;

const refusedField = (error: unknown): unknown =>
  (error as { params?: { field?: unknown } } | null)?.params?.field;

/** The agent's own PIN rule (`isBluetoothPin`, packages/print-agent/src/client.ts), repeated here
 * because the dashboard does not depend on that package. */
const BLUETOOTH_PIN = /^[\x21-\x7e]{1,16}$/;

type CommandState = BluetoothCommandStatus["state"] | "no_answer";

/** The screen's own copy of a command's status: the server's copy leaves with the device's row. */
type TrackedCommand = Omit<BluetoothCommandStatus, "state" | "expiresInMs"> & {
  state: CommandState;
  answerBy: number;
  /** A Pair's device as listed when its Pair dialog was opened, so its status keeps a row once the
   * scan loses it. */
  device?: DiscoveredPrinter;
};

const COMMAND_TEXT: Record<BluetoothCommandStatus["kind"], Record<CommandState, StringKey>> = {
  pair: {
    pending: "printers.bluetooth_pairing",
    succeeded: "printers.bluetooth_paired",
    failed: "printers.bluetooth_pair_failed",
    no_answer: "printers.bluetooth_no_answer",
  },
  forget: {
    pending: "printers.bluetooth_forgetting",
    succeeded: "printers.bluetooth_forgotten",
    failed: "printers.bluetooth_forget_failed",
    no_answer: "printers.bluetooth_no_answer",
  },
};

const commandKey = (agentId: string, address: string): string =>
  `${agentId}:${address.toUpperCase()}`;

/** The printer editor's checks that have a field of their own; the rest name only the bottom message. */
const PRINTER_FIELDS: readonly string[] = ["name", "host", "port", "characterTable"];

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
  hasCashDrawer: boolean;
  /** The settings as saved, so a save sends only the ones that changed. */
  saved: {
    name: string;
    host: string;
    port: string;
    active: boolean;
    paperWidth: PrintPaperWidth;
    resolution: PrintResolution;
    characterSet: PrintCharacterSet;
    characterTable: number;
    hasCashDrawer: boolean;
  };
  active: boolean;
}

/** Discovery reports arrive on later agent polls, so a scan listens beyond its initial read. */
export const SCAN_LISTEN_MS = 30_000;
export const AGENT_SCAN_LISTEN_MS = 10_000;
export const SCAN_POLL_MS = 2_000;
/** Well inside the server's three-minute discovery window, so one failed renewal loses nothing. */
export const DISCOVERY_RENEW_MS = 60_000;

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
      wt-data-table::part(printer-name) {
        text-align: start;
        overflow-wrap: anywhere;
        --wt-color-text: var(--wt-color-primary);
      }
      wt-data-table::part(job-actions) {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      wt-data-table::part(printer-provenance) {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
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

      /* wt-data-table is at least max-content wide, so an agent's reason (up to
         MAX_OUTCOME_ERROR_LENGTH characters) that does not wrap widens the whole list. */
      wt-data-table::part(bluetooth-actions) {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
      }
      wt-data-table::part(bluetooth-status) {
        max-width: 40vw;
        overflow-wrap: anywhere;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(bluetooth-problem) {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(bluetooth-progress) {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
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
      [hidden] {
        display: none;
      }
      .wizard-back {
        display: flex;
        gap: var(--wt-space-2);
      }
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-end;
      }
      .finder-examples {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-6);
      }
      .status-heading {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-4);
      }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-space-6) * 12)), 1fr)
        );
        gap: var(--wt-space-4);
      }
      .status-group {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }
      .status-fields {
        display: grid;
        gap: var(--wt-space-4);
        margin: 0;
      }
      .status-fields dt {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .status-fields dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .field-row > * {
        flex: 1 1 calc(var(--wt-space-6) * 6);
        min-width: 0;
      }
      .field-row > [name$="port"],
      .field-row > wt-button {
        flex: 0 1 calc(var(--wt-space-6) * 4);
      }
      .field-row > wt-form-actions {
        flex: 0 1 auto;
        width: auto;
        margin-inline-start: auto;
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
  @state() private selectedPrinterId: string | null = null;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "printers") return;
      this.selectedPrinterId = this.#url.read("printer");
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
  @state() private loading = true;
  @state() private addingAgent = false;
  @state() private addingPrinter = false;
  @state() private namingPrinter: DiscoveredPrinter | null = null;
  @state() private discoveredNames: Record<string, string> = {};
  @state() private calibrationStep = 0;
  @state() private testingDrawer = false;
  @state() private drawerTestSent = false;
  @state() private drawerOutcome = "";
  @state() private printingTest = false;
  @state() private printingSample = false;
  @state() private printingTableTest = false;
  @state() private tableBlockStart = 0;
  @state() private widthLine = "";
  @state() private finderLocales: Partial<Record<number, SupportedLocale>> = {};
  @state() private finderChosenCode = "";
  #tableTestEpoch = 0;
  #testEpoch = 0;
  #calibrationEpoch = 0;
  #calibrationShownEpoch = 0;
  @state() private testError: string | null = null;
  @state() private editingPrinter: EditablePrinter | null = null;
  @state() private editingAgent: PrintAgentRow | null = null;
  /** Whether the open agent, printer or printer-name form has been submitted since it opened. */
  @state() private formAttempted = false;
  @state() private preview: PrintJobPreview | null = null;
  @state() private previewOpen = false;
  @state() private jobs: PrintJobRow[] = [];
  @state() private resendingJobId: string | null = null;
  /** The last print the edit or calibration dialog sent. */
  @state() private calibrationJobId: string | null = null;

  @state() private tills: Till[] = [];

  @state() private armedRevokeId: string | null = null;

  // Separate from `armedRevokeId`, so arming one agent's re-allow does not disarm another's revoke.
  @state() private armedAllowId: string | null = null;

  // Pairing is venue-wide; challenges stay cached because each request's numbers are fixed.
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];
  @state() private openRequestId: string | null = null;
  @state() private challenges: Record<string, string[]> = {};
  @state() private armedDenyId: string | null = null;

  @state() private discovered: DiscoveredPrinter[] = [];
  @state() private showAllBluetooth = false;
  @state() private pairingDevice: DiscoveredPrinter | null = null;
  /** Held only while the Pair dialog is open. */
  @state() private pairPin = "";
  @state() private pairAttempted = false;
  /** The server refused the PIN; shown under the field until it changes. */
  @state() private pairRefused = false;
  @state() private pairErrorKey: string | null = null;
  @state() private pairSubmitting = false;
  #pairEpoch = 0;
  @state() private commands: Record<string, TrackedCommand> = {};
  /** Command key to answerBy for each pairing that succeeded while Add a printer is open. Kept apart
   * from `commands`, so dismissing the Paired status leaves the device counted as paired. */
  @state() private pairedDevices: Record<string, number> = {};
  @state() private armedForgetId: string | null = null;
  /** Separate from `armedForgetId`, so a listed device's arm never matches a printer id. */
  @state() private armedForgetDevice: string | null = null;
  @state() private forgetting = false;
  #commandTimer?: ReturnType<typeof setInterval>;
  #commandReadInFlight = false;
  /** Rebuilt in `willUpdate`, so a row's cells look these up instead of scanning per row. */
  #printerCommands = new Map<string, [string, TrackedCommand]>();
  #pairedReports = new Map<string, DiscoveredPrinter>();
  #commandEpoch = 0;
  /** The refresh error a failed status read showed, so the next good read can take it back. */
  #commandReadError: string | null = null;
  /** Not `submitting`: the listen runs for seconds and must not block Add or Register. */
  @state() private scanning = false;
  @state() private probeHost = "";
  @state() private probePort = "9100";
  @state() private probeAttempted = false;
  /** Address fields the server refused, each shown until the owner changes it. */
  @state() private probeRefused: Partial<Record<"host" | "port", string>> = {};
  /** A refused address check that names no field, shown beside Check address. */
  @state() private probeErrorKey: string | null = null;
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
  #renewTimer?: ReturnType<typeof setInterval>;
  #registeredDevices = new Set<string>();
  #editTrigger?: HTMLButtonElement;

  @state() private errorKey: string | null = null;
  @state() private refreshErrorKey: string | null = null;
  @state() private addedPrinterName: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("commands") || changed.has("printers")) {
      const forgets = new Map<string, [string, TrackedCommand]>();
      for (const entry of Object.entries(this.commands))
        if (entry[1].kind === "forget" && !forgets.has(entry[1].address))
          forgets.set(entry[1].address, entry);
      this.#printerCommands = new Map();
      for (const p of this.printers) {
        const command =
          p.transport === "bluetooth" ? forgets.get(String(p.localKey).toUpperCase()) : undefined;
        if (command) this.#printerCommands.set(p.id, command);
      }
    }
    if (changed.has("discovered")) {
      this.#pairedReports = new Map();
      for (const d of this.discovered)
        if (
          d.transport === "bluetooth" &&
          d.paired === true &&
          d.printerId !== null &&
          !this.#pairedReports.has(d.printerId)
        )
          this.#pairedReports.set(d.printerId, d);
    }
  }

  override disconnectedCallback(): void {
    this.#endScan();
    this.#stopRenewing();
    this.#stopAgentModal();
    this.#stopCommandPoll();
    this.#resetPair();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.refreshErrorKey = null;
    this.armedRevokeId = null;
    this.armedAllowId = null;
    this.armedDenyId = null;
    this.armedForgetId = null;
    this.armedForgetDevice = null;
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
    this.#agentScanUntil = Date.now() + AGENT_SCAN_LISTEN_MS;
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
    this.#absorbCommands(devices);
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

  #probeValidate(): Partial<Record<"host" | "port", string>> {
    const port = Number(this.probePort);
    const errors: Partial<Record<"host" | "port", string>> = {};
    if (!this.probeHost.trim()) errors.host = t("printers.probe_host_invalid");
    if (!/^\d+$/.test(this.probePort) || !Number.isInteger(port) || port < 1 || port > 65535)
      errors.port = t("printers.port_invalid");
    return errors;
  }

  async #probe(): Promise<void> {
    if (this.probeStatus === "pending") return;
    this.probeAttempted = true;
    this.probeRefused = {};
    if (Object.keys(this.#probeValidate()).length) {
      this.#focusFirstInvalid("[data-test=probe-panel]");
      return;
    }
    await this.#scan({ host: this.probeHost.trim(), port: Number(this.probePort) });
  }

  /** Once the form has rendered its field messages, focuses the first invalid field in it. */
  #focusFirstInvalid(form: string): void {
    void this.updateComplete.then(() => {
      const root = this.renderRoot.querySelector(form);
      if (root) void focusFirstInvalid(root);
    });
  }

  /** Listen for automatic discovery or the separately expiring address check. */
  async #scan(address?: { host: string; port: number }): Promise<void> {
    if (!address && this.scanning) return;
    this.#endScan();
    this.#probeTarget = undefined;
    this.probeStatus = address ? "pending" : "idle";
    this.errorKey = null;
    this.probeErrorKey = null;
    this.scanning = true;
    const epoch = ++this.#scanEpoch;
    try {
      const target = address ? await this.api.probePrinterAddress(address) : undefined;
      if (!address) await this.api.startPrinterDiscovery();
      if (epoch !== this.#scanEpoch) return;
      this.#probeTarget = target;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      if (!address) this.#renewTimer ??= setInterval(() => void this.#renew(), DISCOVERY_RENEW_MS);
      await this.#loadDiscovered(epoch);
      if (epoch !== this.#scanEpoch) return;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      this.#scanUntil =
        Date.now() + (target ? target.expiresAt - target.requestedAt : SCAN_LISTEN_MS);
      this.#scanTimer = setInterval(() => void this.#scanTick(), SCAN_POLL_MS);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.probeStatus = "idle";
      const field = refusedField(error);
      if (
        address &&
        codeOf(error) === "management.request_invalid" &&
        (field === "host" || field === "port")
      ) {
        this.probeRefused = {
          [field]: t(field === "host" ? "printers.probe_host_invalid" : "printers.port_invalid"),
        };
        this.#focusFirstInvalid("[data-test=probe-panel]");
      } else if (address) this.probeErrorKey = codeOf(error);
      else this.errorKey = codeOf(error);
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

  /** A failure is not shown: the next renewal retries well before the window lapses. */
  async #renew(): Promise<void> {
    await (this.api.background ?? this.api).renewPrinterDiscovery().catch(() => undefined);
  }

  #stopRenewing(): void {
    clearInterval(this.#renewTimer);
    this.#renewTimer = undefined;
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

  /** A Bluetooth device registered to a switched-on printer that no agent reports paired, such as
   * one whose pairing was forgotten: it is offered Pair, which adds nothing. */
  #canPairOnly(device: DiscoveredPrinter): boolean {
    const printer =
      device.transport === "bluetooth"
        ? this.printers.find(({ id, active }) => id === device.printerId && active)
        : undefined;
    return printer !== undefined && !this.#pairedReports.has(printer.id);
  }

  async #registerDiscovered(device: DiscoveredPrinter): Promise<void> {
    if (this.submitting || !this.#canAdd(device)) return;
    const key = this.#deviceKey(device);
    const name = (
      this.discoveredNames[key] ??
      this.#disabledPrinter(device)?.name ??
      this.#discoveredLabel(device)
    ).trim();
    this.formAttempted = true;
    if (!name) {
      this.#focusFirstInvalid("[data-test=name-printer-modal]");
      return;
    }
    this.submitting = true;
    this.errorKey = null;
    try {
      const disabled = this.#disabledPrinter(device);
      let createdId: string;
      if (disabled) {
        createdId = disabled.id;
        await this.api.updatePrinter(disabled.id, {
          active: true,
          ...(name !== disabled.name ? { name } : {}),
        });
      } else if (device.transport === "network_tcp") {
        ({ id: createdId } = await this.api.createPrinter({
          name,
          transport: device.transport,
          host: device.host ?? undefined,
          port: device.port ?? 9100,
        }));
      } else {
        ({ id: createdId } = await this.api.createPrinter({
          name,
          transport: device.transport,
          localKey: device.localKey,
        }));
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
      await this.#closeModal("new-printer-modal");
      this.#openPrinter(
        disabled
          ? { ...disabled, name, active: true }
          : {
              id: createdId,
              name,
              transport: device.transport,
              host: device.host ?? null,
              port: device.port ?? (device.transport === "network_tcp" ? 9100 : null),
              localKey: device.localKey ?? null,
              pollId: null,
              ticketScope: "station",
              paperWidth: "80mm",
              resolution: "180dpi",
              characterSet: "wpc1252",
              characterTable: 16,
              hasCashDrawer: false,
              pendingJobs: 0,
              lastPrintAt: null,
              lastPrintAgentId: null,
              active: true,
            },
      );
      this.calibrationStep = 1;
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  // ── Bluetooth pairing ────────────────────────────────────────────────────────────────────────────

  #commandKeyOf(device: DiscoveredPrinter): string {
    return commandKey(device.agentId, device.localKey!);
  }

  #trackCommand(agentId: string, status: BluetoothCommandStatus, device?: DiscoveredPrinter): void {
    const { expiresInMs, ...command } = status;
    const tracked: TrackedCommand = {
      ...command,
      // A pending status naming no deadline is due at once rather than on a guessed one.
      answerBy: Date.now() + (expiresInMs ?? 0),
      ...(device && { device }),
    };
    const key = commandKey(agentId, status.address);
    this.commands = { ...this.commands, [key]: tracked };
    if (key in this.pairedDevices) {
      const rest = { ...this.pairedDevices };
      delete rest[key];
      this.pairedDevices = rest;
    }
    if (status.state === "pending" && this.#commandTimer === undefined && this.isConnected)
      this.#commandTimer = setInterval(() => void this.#commandTick(), SCAN_POLL_MS);
  }

  /** Settles pending commands from outcomes in `devices`, and calls the overdue rest unanswered. */
  #absorbCommands(devices: DiscoveredPrinter[]): void {
    const pending = Object.entries(this.commands).filter(([, { state }]) => state === "pending");
    if (pending.length === 0) return;
    const reports = new Map<string, BluetoothCommandStatus>();
    for (const device of devices) {
      const key = device.transport === "bluetooth" ? this.#commandKeyOf(device) : undefined;
      if (key !== undefined && device.bluetoothCommand && !reports.has(key))
        reports.set(key, device.bluetoothCommand);
    }
    const now = Date.now();
    const next = { ...this.commands };
    let changed = false;
    const paired: [string, TrackedCommand][] = [];
    for (const [key, tracked] of pending) {
      // Matched by id: a read sent before this command existed can still carry an earlier outcome.
      // Within one read an outcome wins over the deadline (answerBy is never before the server's own
      // expiry, and the server records an outcome only while the command still waits); a read still
      // in flight at the first tick past the deadline loses its outcome (#commandTick).
      const reported = reports.get(key);
      if (reported?.id === tracked.id && reported.state !== "pending") {
        next[key] = {
          ...tracked,
          state: reported.state,
          ...(reported.error !== undefined && { error: reported.error }),
        };
        changed = true;
        if (tracked.kind === "pair" && reported.state === "succeeded") paired.push([key, tracked]);
      } else if (now >= tracked.answerBy) {
        next[key] = { ...tracked, state: "no_answer" };
        changed = true;
      }
    }
    if (changed) this.commands = next;
    if (paired.length === 0) return;
    this.pairedDevices = {
      ...this.pairedDevices,
      ...Object.fromEntries(paired.map(([key, { answerBy }]) => [key, answerBy])),
    };
    for (const [key, tracked] of paired) if (this.#addPaired(key, tracked)) break;
  }

  /** Carries a successful pairing straight on into the form to add the device, unless another dialog
   * is in the way (its row then offers Add) or the device can no longer be added — which includes a
   * pair-only device (`#canPairOnly`), so its pairing never opens the form. Returns whether the form
   * opened. */
  #addPaired(key: string, tracked: TrackedCommand): boolean {
    const device = this.#listedDevice(key) ?? tracked.device!;
    if (this.namingPrinter !== null || this.pairingDevice !== null || !this.#canAdd(device))
      return false;
    this.formAttempted = false;
    this.errorKey = null;
    this.namingPrinter = device;
    return true;
  }

  #listedDevice(key: string): DiscoveredPrinter | undefined {
    return this.discovered.find(
      (d) => d.transport === "bluetooth" && this.#commandKeyOf(d) === key,
    );
  }

  async #commandTick(): Promise<void> {
    if (this.#commandReadInFlight) {
      // A read that never answers must not hold a command open past its deadline.
      this.#absorbCommands([]);
      this.#settleCommandPoll();
      return;
    }
    if (!this.#commandPollNeeded()) return this.#stopCommandPoll();
    this.#commandReadInFlight = true;
    const epoch = this.#commandEpoch;
    let devices: DiscoveredPrinter[] | undefined;
    try {
      devices = await (this.api.background ?? this.api).listDiscoveredPrinters();
    } catch (error) {
      if (epoch === this.#commandEpoch) {
        this.#commandReadError = codeOf(error);
        this.refreshErrorKey = this.#commandReadError;
      }
    }
    if (epoch !== this.#commandEpoch) return;
    this.#commandReadInFlight = false;
    if (devices) {
      if (this.#commandReadError !== null && this.refreshErrorKey === this.#commandReadError)
        this.refreshErrorKey = null;
      this.#commandReadError = null;
      this.#setDiscovered(devices);
    } else this.#absorbCommands([]);
    this.#settleCommandPoll();
  }

  /** Reads continue while a command waits, and after a pairing succeeds until the agent reports the
   * device paired, so Forget pairing can appear; no read starts for it past that pairing's own
   * deadline. */
  #commandPollNeeded(): boolean {
    const now = Date.now();
    return (
      Object.values(this.commands).some(({ state }) => state === "pending") ||
      Object.entries(this.pairedDevices).some(
        ([key, answerBy]) => now < answerBy && this.#listedDevice(key)?.paired !== true,
      )
    );
  }

  #settleCommandPoll(): void {
    if (!this.#commandPollNeeded()) this.#stopCommandPoll();
  }

  #stopCommandPoll(): void {
    this.#commandEpoch++;
    clearInterval(this.#commandTimer);
    this.#commandTimer = undefined;
    this.#commandReadInFlight = false;
    this.#commandReadError = null;
  }

  #dismissCommand(key: string): void {
    const next = { ...this.commands };
    delete next[key];
    this.commands = next;
  }

  #resetPair(): void {
    this.#pairEpoch++;
    this.pairingDevice = null;
    this.pairPin = "";
    this.pairAttempted = false;
    this.pairRefused = false;
    this.pairErrorKey = null;
    this.pairSubmitting = false;
  }

  async #pair(device: DiscoveredPrinter): Promise<void> {
    if (this.pairSubmitting) return;
    this.pairAttempted = true;
    this.pairRefused = false;
    this.pairErrorKey = null;
    if (!BLUETOOTH_PIN.test(this.pairPin)) {
      this.#focusFirstInvalid("[data-test=pair-printer-modal]");
      return;
    }
    const epoch = this.#pairEpoch;
    this.pairSubmitting = true;
    try {
      const { command } = await this.api.pairBluetooth(
        device.agentId,
        device.localKey!,
        this.pairPin,
      );
      if (this.addingPrinter) this.#trackCommand(device.agentId, command, device);
      if (epoch === this.#pairEpoch) await this.#closeModal("pair-printer-modal");
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      if (codeOf(error) === "management.request_invalid" && refusedField(error) === "pin") {
        this.pairRefused = true;
        this.#focusFirstInvalid("[data-test=pair-printer-modal]");
      } else this.pairErrorKey = codeOf(error);
    } finally {
      if (epoch === this.#pairEpoch) this.pairSubmitting = false;
    }
  }

  /** The agent's current pairing report for a Bluetooth printer, which Forget needs. */
  #pairedReport(p: Printer): DiscoveredPrinter | undefined {
    return p.transport === "bluetooth" ? this.#pairedReports.get(p.id) : undefined;
  }

  #onForget(p: Printer, device: DiscoveredPrinter): void {
    if (this.armedForgetId !== p.id) {
      this.armedForgetId = p.id;
      return;
    }
    this.armedForgetId = null;
    void this.#forget(device);
  }

  #onForgetDevice(key: string, device: DiscoveredPrinter): void {
    if (this.armedForgetDevice !== key) {
      this.armedForgetDevice = key;
      return;
    }
    this.armedForgetDevice = null;
    void this.#forget(device);
  }

  async #forget(device: DiscoveredPrinter): Promise<void> {
    this.errorKey = null;
    this.forgetting = true;
    try {
      const { command } = await this.api.forgetBluetoothPairing(device.agentId, device.localKey!);
      this.#trackCommand(device.agentId, command);
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.forgetting = false;
    }
  }

  /** A pairing whose device cannot be added opens no form afterwards (`#addPaired`), so its pending
   * text does not promise one. */
  #commandText(key: string, command: TrackedCommand): StringKey {
    return command.kind === "pair" &&
      command.state === "pending" &&
      !this.#canAdd(this.#listedDevice(key) ?? command.device!)
      ? "printers.bluetooth_pairing_only"
      : COMMAND_TEXT[command.kind][command.state];
  }

  #renderCommand(key: string, command: TrackedCommand | undefined, test: string) {
    if (command === undefined) return nothing;
    const problem = command.state === "failed" || command.state === "no_answer";
    const status = html`<span
      part=${problem ? "bluetooth-status bluetooth-problem" : "bluetooth-status"}
      role="status"
      data-test=${test}
      >${t(this.#commandText(key, command))}${command.error === undefined ? "" : `: ${command.error}`}</span
    >`;
    if (command.kind === "pair" && command.state === "pending")
      return html`<span part="bluetooth-progress"
        ><wt-spinner decorative size="sm" data-test=${`progress-${test}`}></wt-spinner
        >${status}</span
      >`;
    return html`${status}${
      command.state === "pending"
        ? nothing
        : html`<wt-button
            size="sm"
            variant="ghost"
            data-test=${`dismiss-${test}`}
            @click=${() => this.#dismissCommand(key)}
            >${t("printers.bluetooth_dismiss")}</wt-button
          >`
    }`;
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
    const patch: PrinterPatch = this.calibrationStep
      ? {}
      : {
          name: row.name.trim(),
          active: row.active,
        };
    if (!this.calibrationStep && row.transport === "network_tcp") {
      patch.host = row.host.trim();
      patch.port = row.port.trim() === "" ? null : Number(row.port);
    }
    if (this.calibrationStep) {
      if (row.name.trim() !== row.saved.name) patch.name = row.name.trim();
      if (row.active !== row.saved.active) patch.active = row.active;
      if (row.transport === "network_tcp") {
        if (row.host.trim() !== row.saved.host) patch.host = row.host.trim();
        if (row.port !== row.saved.port)
          patch.port = row.port.trim() === "" ? null : Number(row.port);
      }
    }
    if (row.paperWidth !== row.saved.paperWidth) patch.paperWidth = row.paperWidth;
    if (row.resolution !== row.saved.resolution) patch.resolution = row.resolution;
    if (row.characterSet !== row.saved.characterSet) patch.characterSet = row.characterSet;
    if (row.characterTable !== row.saved.characterTable) patch.characterTable = row.characterTable;
    if (row.hasCashDrawer !== row.saved.hasCashDrawer) patch.hasCashDrawer = row.hasCashDrawer;
    await this.#submit(async () => {
      if (Object.keys(patch).length) await this.api.updatePrinter(id, patch);
      await this.#closeModal("edit-printer-modal");
    });
  }

  async #deactivatePrinter(id: string): Promise<void> {
    await this.#mutate(() => this.api.deactivatePrinter(id));
  }

  async #testPrint(id: string): Promise<void> {
    if (this.printingTest) return;
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.printingTest = true;
    this.testError = null;
    try {
      const { jobId } = await this.api.testPrint(id);
      if (epoch === this.#testEpoch) {
        this.#showCalibrationJob(calibration, jobId);
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
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.printingSample = true;
    this.errorKey = null;
    try {
      const { jobId } = await this.api.sampleReceipt(p.id, {
        paperWidth: p.paperWidth,
        resolution: p.resolution,
        characterSet: p.characterSet,
        characterTable: p.characterTable,
      });
      if (epoch === this.#testEpoch) {
        this.#showCalibrationJob(calibration, jobId);
        await this.#load();
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.errorKey = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.printingSample = false;
    }
  }

  async #testCharacterTables(p: EditablePrinter): Promise<void> {
    if (this.printingTableTest) return;
    this.printingTableTest = true;
    this.errorKey = null;
    const blockStart = this.tableBlockStart;
    const epoch = this.#tableTestEpoch;
    const calibration = ++this.#calibrationEpoch;
    try {
      const { jobId, calibrationLocale } = await this.api.testCharacterTables(p.id, blockStart);
      if (epoch === this.#tableTestEpoch) {
        this.#showCalibrationJob(calibration, jobId);
        if (
          this.finderLocales[blockStart] !== undefined &&
          this.finderLocales[blockStart] !== calibrationLocale &&
          this.tableBlockStart === blockStart
        )
          this.finderChosenCode = "";
        this.finderLocales = { ...this.finderLocales, [blockStart]: calibrationLocale };
        await this.#load();
      }
    } catch (error) {
      if (epoch === this.#tableTestEpoch) this.errorKey = codeOf(error);
    } finally {
      if (epoch === this.#tableTestEpoch) this.printingTableTest = false;
    }
  }

  #showCalibrationJob(calibration: number, jobId: string): void {
    if (calibration <= this.#calibrationShownEpoch) return;
    this.#calibrationShownEpoch = calibration;
    this.calibrationJobId = jobId;
  }

  #closeTest(): void {
    this.#testEpoch++;
    this.#tableTestEpoch++;
    this.printingTest = false;
    this.printingTableTest = false;
    this.printingSample = false;
    this.testingDrawer = false;
    this.testError = null;
    this.calibrationJobId = null;
  }

  async #testDrawer(p: EditablePrinter): Promise<void> {
    if (this.testingDrawer) return;
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.testingDrawer = true;
    this.drawerTestSent = false;
    this.drawerOutcome = "";
    this.testError = null;
    try {
      const { jobId } = await this.api.testPrinterDrawer(p.id);
      if (epoch === this.#testEpoch) {
        this.drawerTestSent = true;
        this.#showCalibrationJob(calibration, jobId);
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.testError = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.testingDrawer = false;
    }
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
          this.formAttempted = false;
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
        choosable: "shown",
        label: t("printers.agent_host"),
        cell: (a) =>
          html`${
            a.setupUrl && /^https?:\/\//i.test(a.setupUrl)
              ? html`<a href=${a.setupUrl} target="_blank" rel="noopener noreferrer"
                  >${a.host ?? t("printers.agent_setup")}</a
                >`
              : (a.host ?? (a.nodeId === null ? t("printers.not_reported") : nothing))
          }
          ${a.nodeId !== null ? html` <span part="printer-provenance" data-test=${`agent-provenance-${a.id}`}>${t("printers.provenance_self")}</span>` : nothing}`,
      },
      {
        key: "status",
        choosable: "shown",
        label: t("printers.status"),
        cell: (a) =>
          html`<span data-test=${`agent-status-${a.id}`}
            >${a.active ? t("printers.status_active") : t("printers.status_revoked")}</span
          >`,
        filter: {
          label: t("printers.status"),
          allLabel: t("printers.filter_all"),
          initial: "active",
          value: (a) => (a.active ? "active" : "disabled"),
          options: [
            { value: "active", label: t("printers.status_active") },
            { value: "disabled", label: t("printers.status_revoked") },
          ],
        },
      },
      {
        key: "lastSeen",
        choosable: "shown",
        label: t("printers.last_seen"),
        sortValue: (a) => a.lastSeenAt,
        cell: (a) =>
          html`<span data-test=${`agent-last-seen-${a.id}`}
            >${this.#timestamp(a.lastSeenAt)}</span
          >`,
      },
      {
        key: "actions",
        label: t("printers.actions"),
        pinned: "end",
        cell: (a) => this.#agentActions(a),
      },
    ];
    return html`<section>
      <wt-data-table
        data-test="agents-table"
        viewKey="printers:agents"
        columnsLabel=${t("table.columns")}
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
      ${this.#renderRefreshError()}
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
      <wt-form-actions slot="footer" .error=${bottomMessage(refusal(this.errorKey))}
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
    const nameError = this.formAttempted && !agent.name.trim() ? t("form.name_required") : "";
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
      ${this.#renderRefreshError()}
      <wt-input
        name="agent-name"
        required
        label=${t("printers.name")}
        .value=${agent.name}
        .invalid=${nameError !== ""}
        .error=${nameError}
        data-test="edit-agent-name"
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.editingAgent = { ...agent, name: e.detail.value };
        }}
      ></wt-input>
      <p>${t("printers.agent_host")}: ${agent.host ?? t("printers.not_reported")}</p>
      <p>${t("printers.last_seen")}: ${this.#timestamp(agent.lastSeenAt)}</p>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(refusal(this.errorKey), nameError === "" ? null : t("form.fix_fields"))}
      >
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
          ?disabled=${nameError !== ""}
          @click=${() => void this.#saveAgent()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  async #saveAgent(): Promise<void> {
    const agent = this.editingAgent;
    if (!agent) return;
    this.formAttempted = true;
    if (!agent.name.trim()) {
      this.#focusFirstInvalid("[data-test=edit-agent-modal]");
      return;
    }
    await this.#submit(async () => {
      await this.api.updateAgent(agent.id, { name: agent.name.trim() });
      await this.#closeModal("edit-agent-modal");
    });
  }

  #openPrinter(p: Printer, event?: Event): void {
    if (event) this.#rememberEditTrigger(event);
    this.#closeTest();
    this.calibrationStep = 0;
    this.drawerTestSent = false;
    this.drawerOutcome = "";
    this.formAttempted = false;
    this.errorKey = null;
    this.tableBlockStart = 0;
    this.widthLine = "";
    this.finderLocales = {};
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
      hasCashDrawer: p.hasCashDrawer,
      saved: {
        name: p.name,
        host: p.host ?? "",
        port: p.port === null ? "" : String(p.port),
        active: p.active,
        paperWidth: p.paperWidth,
        resolution: p.resolution,
        characterSet: p.characterSet,
        characterTable: p.characterTable,
        hasCashDrawer: p.hasCashDrawer,
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
        ?disabled=${!p.active}
        @click=${() => void this.#deactivatePrinter(p.id)}
        >${t("printers.disable")}</wt-button
      >
      ${this.#forgetAction(p)}
    </dashboard-row-actions>`;
  }

  #forgetAction(p: Printer): TemplateResult | typeof nothing {
    const device = this.#pairedReport(p);
    if (device === undefined) return nothing;
    // The agent's pairing report can outlast a successful forget by up to the discovered list's own
    // expiry (`isListed`, `apps/server/src/print-api.ts`).
    const sent = this.commands[this.#commandKeyOf(device)];
    if (sent?.kind === "forget" && sent.state === "succeeded") return nothing;
    const armed = this.armedForgetId === p.id;
    return html`<wt-button
      variant="danger"
      data-keep-open
      data-test=${`forget-pairing-${p.id}`}
      data-armed=${armed ? "true" : nothing}
      ?disabled=${this.forgetting || this.#printerCommands.get(p.id)?.[1].state === "pending"}
      @click=${() => this.#onForget(p, device)}
      >${armed ? t("printers.bluetooth_forget_confirm") : t("printers.bluetooth_forget")}</wt-button
    >`;
  }

  #printerObservation(p: Printer): Pick<DiscoveredPrinter, "agentName" | "lastSeenAt"> | undefined {
    let latest: Pick<DiscoveredPrinter, "agentName" | "lastSeenAt"> | undefined;
    const agent = this.agents.find(({ id }) => id === p.lastPrintAgentId);
    if (agent && p.lastPrintAt) latest = { agentName: agent.name, lastSeenAt: p.lastPrintAt };
    for (const device of this.discovered) {
      if (device.printerId === p.id && (!latest || device.lastSeenAt > latest.lastSeenAt))
        latest = device;
    }
    return latest;
  }

  #showPrinterStatus(id: string): void {
    this.selectedPrinterId = id;
    this.#url.write({ dashboard: "printers", view: this.view, printer: id });
  }

  #renderPrinterStatus(): TemplateResult {
    const p = this.printers.find(({ id }) => id === this.selectedPrinterId);
    const back = html`<wt-button
      data-test="back-to-printers"
      @click=${() => {
        this.selectedPrinterId = null;
        this.#url.write({ printer: null });
      }}
      >${t("action.back")}</wt-button
    >`;
    if (!p)
      return html`${back}
        <p role="status">
          ${this.loading ? t("printers.table_loading") : codeMessage("printer.not_found")}
        </p>`;
    const seen = this.#printerObservation(p);
    const field = (label: string, value: unknown, test = "") =>
      html`<div>
        <dt>${label}</dt>
        <dd data-test=${test}>${value}</dd>
      </div>`;
    const registers = this.tills
      .filter((till) => till.receiptPrinterId === p.id)
      .map((till) => till.label);
    return html`<section data-test="printer-status">
      ${back}
      <div class="status-heading">
        <h1 class="title">${p.name}</h1>
        <wt-button
          variant="primary"
          data-test="edit-printer-details"
          @click=${(event: Event) => this.#openPrinter(p, event)}
          >${t("action.edit")}</wt-button
        >
      </div>
      <div class="status-grid">
        <section>
          <h2 class="status-group">${t("printers.status")}</h2>
          <wt-card
            ><dl class="status-fields">
              ${field(t("printers.status"), t(p.active ? "printers.status_active" : "printers.status_inactive"))}
              ${field(t("printers.pending_jobs"), p.pendingJobs)}
              ${field(t("printers.last_print"), this.#timestamp(p.lastPrintAt))}
              ${field(t("printers.last_seen_by"), p.transport === "cloud_poll" ? "—" : (seen?.agentName ?? t("printers.agent_unknown")))}
              ${seen ? field(t("printers.last_seen"), this.#timestamp(seen.lastSeenAt)) : nothing}
            </dl></wt-card
          >
        </section>
        <section>
          <h2 class="status-group">${t("printers.connection")}</h2>
          <wt-card
            ><dl class="status-fields">
              ${field(t("printers.transport"), transportName(p.transport), `printer-transport-${p.id}`)}
              ${field(t("printers.connection"), t(p.transport === "cloud_poll" ? "printers.connection_direct" : p.transport === "network_tcp" ? "printers.connection_network" : "printers.connection_roaming"), `printer-connection-${p.id}`)}
              ${p.host ? field(t("printers.address"), `${p.host}${p.port === null ? "" : `:${p.port}`}`) : nothing}
              ${p.localKey ? field(t("printers.local_key"), p.localKey) : nothing}
              ${p.pollId ? field(t("printers.poll_id"), p.pollId) : nothing}
            </dl></wt-card
          >
        </section>
        <section>
          <h2 class="status-group">${t("printers.calibrate")}</h2>
          <wt-card
            ><dl class="status-fields">
              ${field(t("printers.paper_width"), t(p.paperWidth === "58mm" ? "printers.paper_width_58" : "printers.paper_width_80"))}
              ${field(t("printers.resolution"), t(p.resolution === "180dpi" ? "printers.resolution_180" : "printers.resolution_203"))}
              ${field(t("printers.character_set"), characterSetOptions(currentLocale()).find(({ value }) => value === p.characterSet)?.label)}
              ${field(t("printers.character_table"), p.characterTable)}
              ${field(t("printers.drawer_attached"), t(p.hasCashDrawer ? "printers.yes" : "printers.no"), "printer-drawer")}
              ${field(t("printers.cash_register"), registers.join(", ") || t("printers.no"), "printer-registers")}
            </dl></wt-card
          >
        </section>
      </div>
    </section>`;
  }

  #seenStatus(
    printerId: string,
    device: Pick<DiscoveredPrinter, "agentName" | "lastSeenAt"> | undefined,
  ): TemplateResult | typeof nothing {
    if (device === undefined || device.agentName === null) return nothing;
    return html`<div data-test=${`printer-last-seen-${printerId}`} part="printer-meta">
      ${t("printers.seen_at")
        .replace("{agent}", device.agentName)
        .replace("{time}", formatIsoMinute(device.lastSeenAt))}
    </div>`;
  }

  #renderPrintersSection(): TemplateResult {
    const seen = new Map(this.printers.map((p) => [p.id, this.#printerObservation(p)]));
    const columns: DataTableColumn<Printer>[] = [
      {
        key: "name",
        label: t("printers.name"),
        sortValue: (p) => p.name,
        cell: (p) =>
          html`<wt-button
            variant="ghost"
            part="printer-name"
            data-test=${`printer-row-${p.id}`}
            @click=${() => this.#showPrinterStatus(p.id)}
            >${p.name}</wt-button
          >`,
      },
      {
        key: "agent",
        choosable: "shown",
        label: t("printers.last_seen_by"),
        cell: (p) =>
          html`<span data-test=${`printer-agent-${p.id}`}>
              ${p.transport === "cloud_poll" ? "—" : (seen.get(p.id)?.agentName ?? t("printers.agent_unknown"))} </span
            >${this.#seenStatus(p.id, seen.get(p.id))}`,
      },
      {
        key: "pending",
        choosable: "shown",
        label: t("printers.pending_jobs"),
        sortValue: (p) => p.pendingJobs,
        cell: (p) => p.pendingJobs,
      },
      {
        key: "status",
        choosable: "shown",
        label: t("printers.status"),
        cell: (p) => {
          const status = p.active ? t("printers.status_active") : t("printers.status_inactive");
          const command = this.#printerCommands.get(p.id);
          return command === undefined
            ? status
            : html`${status}
                <div part="bluetooth-actions">
                  ${this.#renderCommand(command[0], command[1], `printer-command-${p.id}`)}
                </div>`;
        },
        filter: {
          label: t("printers.status"),
          allLabel: t("printers.filter_all"),
          initial: "active",
          value: (p) => (p.active ? "active" : "disabled"),
          options: [
            { value: "active", label: t("printers.status_active") },
            { value: "disabled", label: t("printers.status_inactive") },
          ],
        },
      },
      {
        key: "lastPrint",
        choosable: "shown",
        label: t("printers.last_print"),
        sortValue: (p) => p.lastPrintAt,
        cell: (p) => this.#timestamp(p.lastPrintAt),
      },
      {
        key: "actions",
        label: t("printers.actions"),
        pinned: "end",
        cell: (p) => this.#printerActions(p),
      },
    ];
    return html`<section>
      <wt-data-table
        data-test="printers-table"
        viewKey="printers:table"
        columnsLabel=${t("table.columns")}
        aria-label=${t("printers.list_title")}
        .rows=${this.printers}
        .columns=${columns}
        .rowKey=${(p: Printer) => p.id}
        .emptyMessage=${t("printers.no_printers")}
      ></wt-data-table>
      <wt-button
        class="section-action"
        variant="primary"
        data-test="open-add-printer"
        @click=${() => {
          this.formAttempted = false;
          this.errorKey = null;
          this.addingPrinter = true;
          this.probeHost = "";
          this.probePort = "9100";
          this.probeAttempted = false;
          this.probeRefused = {};
          this.probeErrorKey = null;
          this.#registeredDevices.clear();
          this.discoveredNames = {};
          this.addedPrinterName = null;
          this.showAllBluetooth = false;
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
        cell: (j) => {
          const printer = this.printers.find((p) => p.id === j.printerId);
          return html`<span data-test=${`job-row-${j.id}`}
            >${
              printer
                ? html`<wt-button
                    variant="ghost"
                    part="printer-name"
                    data-test=${`job-printer-${j.id}`}
                    @click=${() => this.#showPrinterStatus(printer.id)}
                    >${printer.name}</wt-button
                  >`
                : html`<span data-test=${`job-printer-${j.id}`}
                    >${this.#printerName(j.printerId)}</span
                  >`
            }</span
          >`;
        },
      },
      {
        key: "status",
        choosable: "shown",
        label: t("printers.status"),
        cell: (j) =>
          html`<span part=${`job-status job-${j.status}`} data-test=${`job-status-${j.id}`}
              >${jobStatusName(j.status)}</span
            >${j.lastError === null ? nothing : html`<p data-test=${`job-error-${j.id}`}>${jobReason(j.lastError)}</p>`}`,
      },
      {
        key: "attempts",
        choosable: "shown",
        label: t("printers.job_attempts"),
        sortValue: (j) => j.attempts,
        cell: (j) =>
          html`<span data-test=${`job-attempts-${j.id}`}
            >${j.lastError === BLUETOOTH_PRINTING_UNAVAILABLE ? "—" : j.attempts}</span
          >`,
      },
      {
        key: "queued",
        choosable: "shown",
        label: t("printers.queued_at"),
        sortValue: (j) => j.createdAt,
        cell: (j) => this.#timestamp(j.createdAt),
      },
      {
        key: "delivered",
        choosable: "shown",
        label: t("printers.delivered_at"),
        sortValue: (j) => j.deliveredAt,
        cell: (j) => this.#timestamp(j.deliveredAt),
      },
      {
        key: "preview",
        label: t("printers.actions"),
        cell: (j) =>
          html`<div part="job-actions">
            <wt-button data-test=${`view-job-${j.id}`} @click=${() => void this.#viewJob(j.id)}
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
            }
          </div>`,
      },
    ];
    return html`<section>
      <p class="hint">${t("printers.jobs_limit")}</p>
      <wt-data-table
        data-test="jobs-table"
        viewKey="printers:jobs"
        columnsLabel=${t("table.columns")}
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

  /** A failed read, with its own retry, stays at the top of the page or the dialog. */
  #renderRefreshError(): TemplateResult | typeof nothing {
    if (!this.refreshErrorKey) return nothing;
    return html`<div data-test="printer-refresh-error" role="alert">
      <p class="error">${t("printers.refresh_failed")} ${codeMessage(this.refreshErrorKey)}</p>
      <wt-button data-test="refresh-printer-lists" @click=${() => void this.#load()}
        >${t("printers.refresh_lists")}</wt-button
      >
    </div>`;
  }

  /** Checks the draft once the form has been submitted, focusing the first invalid field. */
  #validatePrinter(row: PrinterDraft): boolean {
    this.formAttempted = true;
    const valid = Object.keys(this.#printerErrors(row)).length === 0;
    if (!valid) this.#focusFirstInvalid("[data-test=edit-printer-modal]");
    return valid;
  }

  #printerErrors(row: PrinterDraft): Record<string, string> {
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
    return errors;
  }

  #renderCalibrationFailure(): TemplateResult | typeof nothing {
    const job = this.jobs.find(({ id }) => id === this.calibrationJobId);
    if (job?.status !== "failed") return nothing;
    return html`<p class="error" role="alert" data-test="calibration-job-failed">
      ${t("printers.calibration_job_failed").replace("{reason}", () => jobReason(job.lastError ?? ""))}
    </p>`;
  }

  #renderEditPrinter(): TemplateResult | typeof nothing {
    const p = this.editingPrinter;
    if (!p) return nothing;
    const finderLocale = this.finderLocales[this.tableBlockStart] ?? currentLocale();
    const finder = characterFinderOptions(finderLocale, this.tableBlockStart);
    const calibration = characterCalibration(finderLocale);
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
    const errors = this.formAttempted ? this.#printerErrors(p) : {};
    const fieldInvalid = PRINTER_FIELDS.some((key) => errors[key] !== undefined);
    const bottom = bottomMessage(
      refusal(this.errorKey),
      refusal(this.testError),
      ...Object.entries(errors)
        .filter(([key]) => !PRINTER_FIELDS.includes(key))
        .map(([, message]) => message),
      fieldInvalid ? t("form.fix_fields") : null,
    );
    const field = (key: "name" | "host" | "port", label: string, required = false) =>
      html`<wt-input
        name=${`printer-${key}`}
        label=${label}
        .value=${p[key]}
        ?required=${required}
        type=${key === "port" ? "number" : "text"}
        data-test=${`printer-${key}-${p.id}`}
        .invalid=${!!errors[key]}
        .error=${errors[key] ?? ""}
        @wt-change=${this.#editHandler(p.id, key)}
      ></wt-input>`;
    return html`<wt-modal
      data-test="edit-printer-modal"
      heading=${this.calibrationStep ? `${t("printers.calibrate")}: ${p.name}` : t("printers.edit_printer")}
      .open=${true}
      @wt-close=${() => {
        this.editingPrinter = null;
        this.#closeTest();
        this.#restoreEditFocus();
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector(this.calibrationStep > 0 && this.calibrationStep < 4 ? "[data-test=calibration-next]" : `[data-test="save-printer-${p.id}"]`))}
    >
      <div class="form-fields">
        ${this.#renderRefreshError()}
        ${this.calibrationStep ? html`<p role="status">${t("printers.calibration_progress").replace("{step}", String(this.calibrationStep))}</p>` : nothing}
        ${this.#renderCalibrationFailure()}
        ${
          this.calibrationStep === 0
            ? html`
                ${field("name", t("printers.name"), true)}
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
                <wt-button
                  data-test="calibrate-printer"
                  @click=${() => {
                    if (this.#validatePrinter(p)) this.calibrationStep = 1;
                  }}
                  >${t("printers.calibrate")}</wt-button
                >
              `
            : nothing
        }
        <div
          data-test="calibration-step-2"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 2}
        >
          <h2 class="title">${t("printers.calibration_layout")}</h2>
          <p class="hint">${t("printers.resolution_hint")}</p>
          <wt-button
            variant="primary"
            data-test=${`print-test-page-${p.id}`}
            ?loading=${this.printingTest}
            @click=${() => void this.#testPrint(p.id)}
            >${t("printers.test_page")}</wt-button
          >
          <label class="setting-field">
            ${t("printers.test_line_fits")}
            <select
              name="printer-width-line"
              @change=${(e: Event) => {
                this.widthLine = (e.target as HTMLSelectElement).value;
                if (this.widthLine)
                  this.#editPrinter(p.id, {
                    paperWidth: ["A", "B"].includes(this.widthLine) ? "58mm" : "80mm",
                  });
              }}
            >
              <option value="" .selected=${this.widthLine === ""}>
                ${t("printers.test_answer_choose")}
              </option>
              ${["A", "B", "C", "D"].map((line) => html`<option value=${line} .selected=${this.widthLine === line}>${line}</option>`)}
            </select>
          </label>
          <div class="field-row">
            <label class="setting-field"
              >${t("printers.paper_width")}
              <select
                name="printer-paper-width"
                .value=${p.paperWidth}
                @change=${(e: Event) => {
                  this.widthLine = "";
                  this.#editPrinter(p.id, {
                    paperWidth: (e.target as HTMLSelectElement).value as PrintPaperWidth,
                  });
                }}
              >
                <option value="80mm">${t("printers.paper_width_80")}</option>
                <option value="58mm">${t("printers.paper_width_58")}</option>
              </select>
            </label>
            <label class="setting-field"
              >${t("printers.test_qr_help")}
              <select
                name="printer-resolution"
                .value=${p.resolution}
                @change=${(e: Event) =>
                  this.#editPrinter(p.id, {
                    resolution: (e.target as HTMLSelectElement).value as PrintResolution,
                  })}
              >
                <option value="180dpi">${t("printers.test_qr_45")}</option>
                <option value="203dpi">${t("printers.test_qr_40")}</option>
              </select>
            </label>
          </div>
        </div>
        <div
          data-test="calibration-step-1"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 1}
        >
          <h2 class="title">${t("printers.calibration_characters")}</h2>
          <p class="hint">${t("printers.character_table_hint")}</p>
          <div class="field-row">
            <label class="setting-field"
              >${t("printers.table_block")}
              <select
                name="printer-table-block"
                @change=${(e: Event) => {
                  this.tableBlockStart = Number((e.target as HTMLSelectElement).value);
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
              variant="primary"
              data-test=${`print-character-tables-${p.id}`}
              ?loading=${this.printingTableTest}
              @click=${() => void this.#testCharacterTables(p)}
              >${t("printers.character_table_test")}</wt-button
            >
          </div>
          <div class="finder-examples">
            ${calibration.finderEncodings.map(
              ({ label, characterSet }) =>
                html`<div class="hint" data-test=${`finder-expected-${label}`}>
                  <strong>${label}:</strong>
                  ${calibration.finderSampleLines.map(
                    (line) => html`<div>${prepareText(line, characterSet)}</div>`,
                  )}
                </div>`,
            )}
          </div>
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
            .hasError=${!!errors.characterTable}
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
                .invalid=${!!errors.characterTable}
                .error=${errors.characterTable ?? ""}
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
        </div>
        <div
          data-test="calibration-step-3"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 3}
        >
          <h2 class="title">${t("printers.calibration_receipt")}</h2>
          <p>${t("printers.sample_hint")}</p>
          <wt-button
            variant="primary"
            data-test=${`print-sample-receipt-${p.id}`}
            ?loading=${this.printingSample}
            @click=${() => void this.#sampleReceipt(p)}
            >${t("printers.sample_receipt")}</wt-button
          >
        </div>
        <div
          data-test="calibration-step-4"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 4}
        >
          <h2 class="title">${t("printers.calibration_drawer")}</h2>
          <wt-switch
            name="printer-cash-drawer"
            label=${t("printers.drawer_attached")}
            .checked=${p.hasCashDrawer}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#editPrinter(p.id, { hasCashDrawer: e.detail.checked });
              this.drawerOutcome = "";
              this.drawerTestSent = false;
            }}
          ></wt-switch>
          ${
            p.hasCashDrawer
              ? html`
                  <wt-button
                    data-test="test-printer-drawer"
                    ?loading=${this.testingDrawer}
                    @click=${() => void this.#testDrawer(p)}
                    >${t("printers.drawer_test")}</wt-button
                  >
                  ${
                    this.drawerTestSent
                      ? html`<fieldset>
                          <legend>${t("printers.drawer_result")}</legend>
                          ${["opened", "closed"].map(
                            (result) =>
                              html`<label class="radio-answer">
                                <input
                                  type="radio"
                                  name="printer-drawer-result"
                                  value=${result}
                                  .checked=${this.drawerOutcome === result}
                                  @change=${() => {
                                    this.drawerOutcome = result;
                                  }}
                                />
                                ${t(result === "opened" ? "printers.drawer_opened" : "printers.drawer_closed")}
                              </label>`,
                          )}
                        </fieldset>`
                      : nothing
                  }
                  ${this.drawerOutcome === "closed" ? html`<p role="status">${t("printers.drawer_check")}</p>` : nothing}
                `
              : nothing
          }
        </div>
      </div>
      <wt-form-actions slot="footer" .error=${bottom}>
        <div slot="cancel" class="wizard-back">
          <wt-button
            data-test="cancel-edit-printer"
            @click=${() => void this.#closeModal("edit-printer-modal")}
            >${t("action.cancel")}</wt-button
          >
          ${
            this.calibrationStep > 1
              ? html`<wt-button
                  data-test="calibration-back"
                  @click=${() => {
                    this.calibrationStep--;
                  }}
                  >${t("action.back")}</wt-button
                >`
              : nothing
          }
        </div>
        ${
          this.calibrationStep > 0 && this.calibrationStep < 4
            ? html`<wt-button
                variant="primary"
                data-test="calibration-next"
                ?disabled=${fieldInvalid}
                @click=${() => {
                  if (this.#validatePrinter(p)) this.calibrationStep++;
                }}
                >${t("action.continue")}</wt-button
              >`
            : html`
                <wt-button
                  variant="primary"
                  data-test=${`save-printer-${p.id}`}
                  ?loading=${this.submitting}
                  ?disabled=${fieldInvalid}
                  @click=${() => void this.#savePrinter(p.id)}
                  >${t("action.save")}</wt-button
                >
              `
        }
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
    const name =
      this.discoveredNames[key] ?? this.#disabledPrinter(d)?.name ?? this.#discoveredLabel(d);
    const nameError = this.formAttempted && !name.trim() ? t("form.name_required") : "";
    return html`<wt-modal
      data-test="name-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      @wt-close=${() => {
        this.namingPrinter = null;
        this.formAttempted = false;
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=confirm-add-printer]"))}
    >
      <div class="form-fields">
        ${this.#renderRefreshError()}
        <p class="hint">
          ${this.#discoveredLabel(d)} · ${d.host ? `${d.host}:${d.port ?? 9100}` : d.localKey}
        </p>
        <wt-input
          required
          name="new-printer-name"
          label=${t("printers.name")}
          data-test=${`discovered-name-${key}`}
          .value=${name}
          .invalid=${nameError !== ""}
          .error=${nameError}
          ?disabled=${this.submitting}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.discoveredNames = { ...this.discoveredNames, [key]: event.detail.value };
          }}
        ></wt-input>
      </div>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(refusal(this.errorKey), nameError === "" ? null : t("form.fix_fields"))}
      >
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
          ?disabled=${nameError !== ""}
          @click=${() => void this.#registerDiscovered(d)}
          >${this.#disabledPrinter(d) ? t("printers.add_again") : t("action.add")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderPairDialog(): TemplateResult | typeof nothing {
    const d = this.pairingDevice;
    if (!d) return nothing;
    const pinInvalid = this.pairAttempted && !BLUETOOTH_PIN.test(this.pairPin);
    const pinError = pinInvalid || this.pairRefused ? t("printers.bluetooth_pin_invalid") : "";
    return html`<wt-modal
      data-test="pair-printer-modal"
      heading=${t("printers.bluetooth_pair_title")}
      .open=${true}
      @wt-close=${() => this.#resetPair()}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=confirm-pair]"))}
    >
      <div class="form-fields">
        <p class="hint">${this.#discoveredLabel(d)} · ${d.localKey}</p>
        <wt-input
          required
          name="pin"
          autocomplete="off"
          label=${t("printers.bluetooth_pin")}
          hint=${t("printers.bluetooth_pin_hint")}
          data-test="bluetooth-pin"
          .value=${this.pairPin}
          .invalid=${pinError !== ""}
          .error=${pinError}
          ?disabled=${this.pairSubmitting}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.pairPin = event.detail.value;
            this.pairRefused = false;
          }}
        ></wt-input>
      </div>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(refusal(this.pairErrorKey), pinError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-pair"
          @click=${() => void this.#closeModal("pair-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="confirm-pair"
          ?loading=${this.pairSubmitting}
          ?disabled=${pinInvalid}
          @click=${() => void this.#pair(d)}
          >${this.#canPairOnly(d) ? t("printers.bluetooth_pair_only") : t("printers.bluetooth_pair")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  /** Forget pairing for a paired device with no printer row, such as one whose add was cancelled. */
  #forgetDeviceAction(
    d: DiscoveredPrinter,
    key: string,
    command: TrackedCommand | undefined,
  ): TemplateResult | typeof nothing {
    if (d.paired !== true || d.printerId !== null) return nothing;
    // As on a printer row (#forgetAction): hidden once a forget succeeds, while the report lingers.
    if (command?.kind === "forget" && command.state === "succeeded") return nothing;
    const armed = this.armedForgetDevice === key;
    return html`<wt-button
      variant="danger"
      data-test=${`forget-device-${this.#deviceKey(d)}`}
      data-armed=${armed ? "true" : nothing}
      ?disabled=${this.forgetting || command?.state === "pending"}
      @click=${() => this.#onForgetDevice(key, d)}
      >${armed ? t("printers.bluetooth_forget_confirm") : t("printers.bluetooth_forget")}</wt-button
    >`;
  }

  #renderNewPrinter(): TemplateResult | typeof nothing {
    if (!this.addingPrinter) return nothing;
    const pairOnly = new Set(this.discovered.filter((d) => this.#canPairOnly(d)));
    const addable = this.discovered.filter((d) => pairOnly.has(d) || this.#canAdd(d));
    // A device registered to a switched-on printer is a printer, whatever the scan decoded.
    const shown = (d: DiscoveredPrinter) =>
      d.transport !== "bluetooth" || d.printerLike === true || pairOnly.has(d);
    const rows = addable
      .filter(
        (d) =>
          shown(d) || this.showAllBluetooth || this.commands[this.#commandKeyOf(d)] !== undefined,
      )
      .sort(
        (a, b) => Number(this.#unsupportedPagePrinter(a)) - Number(this.#unsupportedPagePrinter(b)),
      );
    const bluetoothKeys = (devices: DiscoveredPrinter[]) =>
      new Set(devices.filter((d) => d.transport === "bluetooth").map((d) => this.#commandKeyOf(d)));
    const rowKeys = bluetoothKeys(rows);
    // A Pair whose device the list no longer shows keeps a status-only row until it is dismissed.
    const lost = new Set(
      Object.entries(this.commands).flatMap(([key, { device }]) =>
        device !== undefined && !rowKeys.has(key) ? [device] : [],
      ),
    );
    const listed = lost.size > 0 ? bluetoothKeys(this.discovered) : rowKeys;
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
              ${lost.has(d) && !listed.has(this.#commandKeyOf(d)) ? html`<div>${t("printers.bluetooth_not_seen")}</div>` : nothing}
            </div>
          </div>`,
      },
      {
        key: "add",
        label: t("printers.actions"),
        cell: (d) => {
          if (this.#unsupportedPagePrinter(d))
            return html`<span
              part="page-printer-hint"
              data-test=${`page-printer-${this.#deviceKey(d)}`}
              >${t("printers.page_printer_hint")}</span
            >`;
          const add = html`<wt-button
            variant="primary"
            data-test=${`register-${this.#deviceKey(d)}`}
            ?disabled=${this.submitting}
            @click=${() => {
              if (this.submitting) return;
              this.formAttempted = false;
              this.errorKey = null;
              this.namingPrinter = d;
            }}
            >${this.#disabledPrinter(d) ? t("printers.add_again") : t("action.add")}</wt-button
          >`;
          if (d.transport !== "bluetooth") return add;
          const key = this.#commandKeyOf(d);
          const command = this.commands[key];
          const status = this.#renderCommand(
            key,
            command,
            `discovered-command-${this.#deviceKey(d)}`,
          );
          if (lost.has(d)) return html`<div part="bluetooth-actions">${status}</div>`;
          // A succeeded pairing counts as paired before the agent's own paired report arrives, except
          // on a pair-only row, which keeps Pair so a pairing the agent never confirms can be retried.
          const paired = !pairOnly.has(d) && (d.paired === true || key in this.pairedDevices);
          return html`<div part="bluetooth-actions">
            ${
              paired
                ? html`${add}${this.#forgetDeviceAction(d, key, command)}`
                : html`<wt-button
                    variant="primary"
                    data-test=${`pair-${this.#deviceKey(d)}`}
                    ?disabled=${command?.state === "pending"}
                    @click=${() => {
                      this.pairingDevice = d;
                    }}
                    >${pairOnly.has(d) ? t("printers.bluetooth_pair_only") : t("printers.bluetooth_pair")}</wt-button
                  >`
            }
            ${status}
          </div>`;
        },
      },
    ];
    const bluetooth = addable.some((d) => d.transport === "bluetooth");
    const otherDevices = addable.some((d) => !shown(d));
    const probeChecked = this.probeAttempted ? this.#probeValidate() : {};
    const probeErrors = { ...this.probeRefused, ...probeChecked };
    const probeInvalid = Object.keys(probeChecked).length > 0;
    return html`<wt-modal
      data-test="new-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      @wt-close=${() => {
        this.addingPrinter = false;
        this.namingPrinter = null;
        this.armedForgetDevice = null;
        this.#endScan();
        this.#stopRenewing();
        this.commands = Object.fromEntries(
          Object.entries(this.commands).filter(([, command]) => command.kind !== "pair"),
        );
        this.pairedDevices = {};
        this.#settleCommandPoll();
      }}
    >
      ${this.addedPrinterName ? html`<p role="status" data-test="printer-added">${t("printers.added").replace("{name}", this.addedPrinterName)}</p>` : nothing}
      ${this.#renderRefreshError()}
      <p class="hint">${t("printers.discovery_hint")}</p>
      ${bluetooth ? html`<p class="hint" data-test="bluetooth-note">${t("printers.bluetooth_pair_note")}</p>` : nothing}
      <details class="probe-panel" data-test="probe-panel">
        <summary>${t("printers.probe_title")}</summary>
        <p class="hint">${t("printers.probe_hint")}</p>
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
            .invalid=${!!probeErrors.host}
            .error=${probeErrors.host ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              this.probeHost = event.detail.value;
              const refused = { ...this.probeRefused };
              delete refused.host;
              this.probeRefused = refused;
            }}
          ></wt-input>
          <wt-input
            name="printer-probe-port"
            required
            label=${t("printers.port")}
            data-test="probe-port"
            .value=${this.probePort}
            .invalid=${!!probeErrors.port}
            .error=${probeErrors.port ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              this.probePort = event.detail.value;
              const refused = { ...this.probeRefused };
              delete refused.port;
              this.probeRefused = refused;
            }}
          ></wt-input>
          <wt-form-actions
            data-test="probe-actions"
            .error=${bottomMessage(refusal(this.probeErrorKey), Object.keys(probeErrors).length > 0 ? t("form.fix_fields") : null)}
          >
            <wt-button
              variant="primary"
              data-test="probe-printer"
              ?loading=${this.probeStatus === "pending"}
              ?disabled=${probeInvalid}
              @click=${() => void this.#probe()}
              >${t("printers.probe_action")}</wt-button
            >
          </wt-form-actions>
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
        ${
          otherDevices
            ? html`<wt-button
                data-test="show-all-bluetooth"
                @click=${() => {
                  this.showAllBluetooth = !this.showAllBluetooth;
                }}
                >${this.showAllBluetooth ? t("printers.bluetooth_hide_others") : t("printers.bluetooth_show_all")}</wt-button
              >`
            : nothing
        }
      </div>
      <wt-data-table
        data-test="discovered-table"
        aria-label=${t("printers.discovered_title")}
        .columns=${columns}
        .rows=${[...rows, ...lost]}
        .rowKey=${(d: DiscoveredPrinter) => this.#deviceKey(d)}
        .emptyMessage=${this.scanning ? "" : t("printers.no_discovered")}
      ></wt-data-table>
      <wt-form-actions
        slot="footer"
        .error=${this.namingPrinter ? "" : bottomMessage(refusal(this.errorKey))}
      >
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
    // Each of these dialogs shows the refusal beside its own action, and the failed read itself.
    const dialogOpen =
      this.addingAgent || this.addingPrinter || this.editingAgent || this.editingPrinter;
    return html`${
        this.selectedPrinterId
          ? this.#renderPrinterStatus()
          : html`<h1 class="title">${t("printers.title")}</h1>
              <wt-tabs
                label=${t("printers.title")}
                .value=${this.view}
                .items=${[
                  { key: "queue", label: t("printers.jobs_title") },
                  { key: "printers", label: t("printers.list_title") },
                  { key: "agents", label: t("printers.agents_title") },
                ]}
                @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
                  this.view = event.detail.value;
                  this.#url.write({ dashboard: "printers", view: this.view });
                }}
              >
                <div slot="queue">${this.#renderJobsSection()}</div>
                <div slot="printers">${this.#renderPrintersSection()}</div>
                <div slot="agents">${this.#renderAgentsSection()}</div>
              </wt-tabs>`
      }${
        dialogOpen
          ? nothing
          : html`${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
            ${this.#renderRefreshError()}`
      }
      ${this.#renderAgentModal()}${this.#renderEditAgent()}${this.#renderNewPrinter()}${this.#renderPrinterName()}${this.#renderPairDialog()}${this.#renderEditPrinter()}${this.#renderAcceptDialog()}
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
