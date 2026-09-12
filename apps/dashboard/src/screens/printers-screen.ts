import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  submitOnEnter,
  baseStyles,
  selectStyles,
  type DataTableColumn,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "../widgets/row-actions.js";
import "../widgets/print-job-preview.js";
import { t } from "../i18n/t.js";
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
  PrintJobRow,
  PrintJobPreview,
  PrintTransport,
  Printer,
  PrinterPatch,
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
  active: boolean;
}

/** How long Scan keeps re-reading the discovered list, and how often. The agents learn the window is
 * open on their next poll (`POLL_INTERVAL_MS` in `packages/print-agent/src/agent.ts` — the idle
 * interval, at most 2 s; a busy agent re-polls sooner) and post what they found on the pull after
 * that, so the first results land several seconds after the press; a single read right after opening
 * the window sees nothing (owner, 2026-09-11: several presses before a result). The server's window
 * stays open far longer (`DISCOVERY_WINDOW_MS`, 3 min, `apps/server/src/print-api.ts`); this is only
 * how long the screen listens for a press. Exported for the fake-timer test. */
export const SCAN_LISTEN_MS = 10_000;
export const SCAN_POLL_MS = 2_000;

/** Hardware registration and print-job history; routing policy lives on Printing rules.
 * The server enforces printer.manage for configuration and print.resend for document resends. */
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
      .printer-filter {
        display: grid;
        gap: var(--wt-space-1);
        max-width: 16rem;
        margin-bottom: var(--wt-space-3);
      }
      .form-fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .section-action {
        margin-top: var(--wt-space-3);
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  // The enrolled agents (server order kept), the registered printers, and the recent jobs — all
  // (re)loaded on connect and after every mutation.
  @state() private submitting = false;
  @state() private agents: PrintAgentRow[] = [];
  @state() private printers: Printer[] = [];
  @state() private printerStatus = "active";
  @state() private loading = true;
  @state() private addingAgent = false;
  @state() private addingPrinter = false;
  @state() private editingPrinter: EditablePrinter | null = null;
  @state() private editingAgent: PrintAgentRow | null = null;
  @state() private formErrors: Record<string, string> = {};
  @state() private preview: PrintJobPreview | null = null;
  @state() private previewOpen = false;
  @state() private jobs: PrintJobRow[] = [];
  @state() private resendingJobId: string | null = null;

  @state() private tills: Till[] = [];

  // The id of the agent whose Revoke control is ARMED (awaiting a confirming second click), or null.
  @state() private armedRevokeId: string | null = null;
  @state() private armedDeletePrinterId: string | null = null;

  // The id of the agent whose "Allow again" control is ARMED, or null. Its own state (like Deny's) so
  // arming one agent's re-allow does not disarm another agent's revoke.
  @state() private armedAllowId: string | null = null;

  // The shared join-and-accept half (device-join-and-accept, reused for print agents; the Devices
  // screen documents each field). The pairing window as last read (undefined until the first read
  // settles); the print agents waiting to join, in server order, each carrying NO number; the request
  // whose accept dialog is open (single-valued: one dialog at a time); the three numbers the server
  // offered per request, CACHED because the set is fixed at join; and the id of the request whose Deny
  // is ARMED (its own state, so arming a Deny does not disarm a Revoke above).
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];
  @state() private openRequestId: string | null = null;
  @state() private challenges: Record<string, string[]> = {};
  @state() private armedDenyId: string | null = null;

  @state() private discovered: DiscoveredPrinter[] = [];
  /** A Scan press is listening for results — the button is busy and a second press is ignored. Its
   * own gate, not `submitting`: the listen runs for seconds and must not block Add/Register. */
  @state() private scanning = false;
  // The listen's re-read timer, cleared in `disconnectedCallback` and never started on a detached
  // screen (the diagnostics screen's `#timer` shape); `#scanUntil` is the wall-clock end of the listen
  // (five ticks are not ten seconds in a throttled background tab); `#scanInFlight` keeps a slow read
  // from being overlapped by the next tick, whose older reply could overwrite `discovered`.
  #scanTimer?: ReturnType<typeof setInterval>;
  #scanUntil = 0;
  #scanInFlight = false;
  #scanEpoch = 0;
  #registeredDevices = new Set<string>();
  #editTrigger?: HTMLButtonElement;

  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#endScan();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
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
      await this.#queries.watch("listDiscoveredPrinters", [], (devices) =>
        this.#setDiscovered(devices),
      );
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.loading = false;
    }
  }

  /** Reload after a mutation; expose failures through the localized error banner. */
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

  // ── Agents: join-and-accept (the shared mechanism, twin of the Devices screen) ───────────────────

  /** Re-read the pairing window and this surface's pending queue after a join-side mutation, WITHOUT the
   * option/list feeds (which none of those mutations change). Throws like the verbs it calls; every
   * caller wraps it in its own `try/catch`. Disarms any armed deny (the armed row may no longer exist). */
  async #reloadJoins(): Promise<void> {
    this.armedDenyId = null;
    const [pairing, pendingJoins] = await Promise.all([
      this.api.pairingMode(),
      this.api.joinRequests("print_agent"),
    ]);
    this.pairing = pairing;
    this.pendingJoins = pendingJoins;
  }

  /** Reload the AGENTS only (not the option feeds) after an accept — the accepted request becomes an
   * enrolled agent. Throws like `listAgents` itself; the one caller wraps it. Disarms any armed revoke
   * or allow. */
  async #reloadAgents(): Promise<void> {
    this.armedRevokeId = null;
    this.armedAllowId = null;
    this.agents = await this.api.listAgents();
  }

  /** Open the pairing window, or extend an already-open one — the SAME call (the route moves an open
   * window's lapse to a fresh window from now rather than adding one). */
  async #openPairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.openPairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Shut the window. Requests already pending stay pending and are still acceptable — the window admits
   * an ask, it does not hold one open. */
  async #closePairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.closePairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Open a pending request's accept dialog, fetching its three numbers the FIRST time only: the server
   * fixes the set at join, so a second fetch would show the same three and teach nobody anything. */
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

  /** The two-step deny: the first click ARMS `id`, a second on the armed row confirms. Denying is not
   * undoable, so the confirm gate is deliberate (Revoke's idiom). */
  #onDeny(id: string): void {
    if (this.armedDenyId === id) {
      this.armedDenyId = null;
      void this.#deny(id);
      return;
    }
    this.armedDenyId = id;
  }

  /** Refuse a pending request, then re-read the queue. `#onDeny` already cleared the armed state. */
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

  /**
   * Accept the open request with the number the admin tapped. An agent binds nothing, so the body is
   * just `{ choice }`.
   *
   * A WRONG number is not a rejected submission: the server DELETED the request before answering
   * `device.join_mismatch` (the surface-neutral terminal code), so that code closes the dialog and
   * re-reads the queue without the row. Every other fault leaves the dialog open on the same request for
   * a retry (there is nothing to correct here, but a transient server fault is worth a second tap).
   */
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

  /** The two-step revoke: the first click ARMS `id`, a second click on the armed row confirms and
   * revokes. Arming another row disarms the first (single-valued state). */
  #onRevokeAgent(id: string): void {
    if (this.armedRevokeId === id) {
      this.armedRevokeId = null;
      void this.#revokeAgent(id);
      return;
    }
    this.armedRevokeId = id;
  }

  /** Revoke the agent `id` holds, then reload. A rejection becomes the `errorKey` banner. */
  async #revokeAgent(id: string): Promise<void> {
    await this.#mutate(() => this.api.revokeAgent(id));
  }

  /** The two-step allow-again: the first click ARMS `id`, a second on the armed row confirms and
   * re-allows. Mirrors the revoke idiom so an accidental single click cannot flip a revoked agent back
   * on. Arming another row disarms the first (single-valued state). */
  #onAllowAgent(id: string): void {
    if (this.armedAllowId === id) {
      this.armedAllowId = null;
      void this.#allowAgent(id);
      return;
    }
    this.armedAllowId = id;
  }

  /** Re-allow the revoked agent `id` holds, then reload. A rejection becomes the `errorKey` banner. */
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
  }

  /** Refresh the shared inventory without opening another discovery window. */
  async #refreshDiscovered(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#loadDiscovered();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Listen for agent reports while the discovery window is open. */
  async #scan(): Promise<void> {
    if (this.scanning) return;
    this.errorKey = null;
    this.scanning = true;
    const epoch = ++this.#scanEpoch;
    try {
      await this.api.startPrinterDiscovery();
      if (epoch !== this.#scanEpoch) return;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      await this.#loadDiscovered(epoch);
      if (epoch !== this.#scanEpoch) return;
      if (!this.isConnected || !this.addingPrinter) return this.#endScan();
      this.#scanUntil = Date.now() + SCAN_LISTEN_MS;
      this.#scanTimer = setInterval(() => void this.#scanTick(), SCAN_POLL_MS);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.errorKey = codeOf(error);
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
      this.errorKey = codeOf(error);
      this.#endScan();
      return;
    } finally {
      this.#scanInFlight = false;
    }
    if (epoch !== this.#scanEpoch) return;
    if (Date.now() >= this.#scanUntil) this.#endScan();
  }

  #endScan(): void {
    this.#scanEpoch++;
    if (this.#scanTimer !== undefined) clearInterval(this.#scanTimer);
    this.#scanTimer = undefined;
    this.scanning = false;
  }

  #deviceKey(device: DiscoveredPrinter): string {
    return device.localKey ?? `${device.host}:${device.port ?? 9100}`;
  }

  #disabledPrinter(device: DiscoveredPrinter): Printer | undefined {
    return this.printers.find((printer) => printer.id === device.printerId && !printer.active);
  }

  #canAdd(device: DiscoveredPrinter): boolean {
    return (
      !this.#registeredDevices.has(this.#deviceKey(device)) &&
      (!device.alreadyRegistered || this.#disabledPrinter(device) !== undefined)
    );
  }

  async #registerDiscovered(device: DiscoveredPrinter): Promise<void> {
    if (this.submitting || !this.#canAdd(device)) return;
    const name = this.#discoveredLabel(device);
    this.submitting = true;
    this.errorKey = null;
    try {
      const disabled = this.#disabledPrinter(device);
      if (disabled) {
        await this.api.updatePrinter(disabled.id, { active: true });
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
      this.#registeredDevices.add(this.#deviceKey(device));
      this.discovered = this.discovered.map((candidate) =>
        this.#deviceKey(candidate) === this.#deviceKey(device)
          ? { ...candidate, alreadyRegistered: true }
          : candidate,
      );
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

  #editHandler<K extends "name" | "host" | "port" | "localKey" | "pollId">(
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
    this.errorKey = null; // also dismisses a prior banner on the vanished-row early return below
    const row = this.editingPrinter;
    if (row?.id !== id) return;
    if (!this.#validatePrinter(row)) return;
    const patch: PrinterPatch = {
      name: row.name.trim(),
      active: row.active,
    };
    if (row.transport === "usb" || row.transport === "bluetooth") {
      patch.localKey = row.localKey.trim();
    } else if (row.transport === "network_tcp") {
      patch.host = row.host.trim();
      patch.port = row.port.trim() === "" ? null : Number(row.port);
    } else {
      // cloud_poll — the only remaining transport.
      patch.pollId = row.pollId.trim();
    }
    await this.#submit(async () => {
      await this.api.updatePrinter(id, patch);
      await this.#closeModal("edit-printer-modal");
    });
  }

  /** Soft-delete (deactivate) the printer `id` holds, then reload. A rejection becomes the `errorKey`
   * banner. */
  async #deactivatePrinter(id: string): Promise<void> {
    if (this.armedDeletePrinterId !== id) {
      this.armedDeletePrinterId = id;
      return;
    }
    this.armedDeletePrinterId = null;
    await this.#mutate(() => this.api.deactivatePrinter(id));
  }

  /** Enqueue a diagnostic test print for the printer `id` holds, then reload the jobs so the newly
   * queued job appears in the status list. The enqueue never blocks on the printer; a rejection (an
   * unknown/absent printer) becomes the `errorKey` banner. */
  async #testPrint(id: string): Promise<void> {
    await this.#mutate(() => this.api.testPrint(id));
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────────────────────────

  /** Resolve a printer id to its display name; an id no longer in the list falls back to the raw id. */
  #printerName(printerId: string): string {
    return this.printers.find((p) => p.id === printerId)?.name ?? printerId;
  }

  /** Format an ISO instant to the minute (UTC — no per-venue timezone yet, matching the devices screen);
   * a null instant (never seen / not yet delivered) shows the "Never" placeholder. */
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
              ${revokeArmed ? t("printers.delete_confirm") : t("action.delete")}
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

  /** The venue-wide pairing window (device-join-and-accept §1.1, shared with the Devices screen). While
   * OPEN: when it lapses, plus Extend and Close. While SHUT: Open, and — only when there were any — how
   * many knocks were turned away in the last ten minutes. Counts are composed with `.replace` (this
   * catalogue has no interpolation). */
  #renderPairing(): TemplateResult {
    const mode = this.pairing;
    if (mode === undefined) return html`<p class="hint">${t("printers.pairing_loading")}</p>`;
    return html`<wt-card data-test="pairing-mode">
      <h3 class="panel-title" style="margin-top:0">${t("printers.pairing_title")}</h3>
      <p class="hint">${t("printers.pairing_hint")}</p>
      ${
        mode.open
          ? html`<p data-test="pairing-until">
                ${t("printers.pairing_open_until").replace(
                  "{time}",
                  mode.openUntil === null ? "" : formatIsoMinute(mode.openUntil),
                )}
              </p>
              <div class="actions">
                <wt-button
                  variant="primary"
                  data-test="pairing-extend"
                  @click=${() => void this.#openPairing()}
                  >${t("printers.pairing_extend")}</wt-button
                >
                <wt-button
                  variant="secondary"
                  data-test="pairing-close"
                  @click=${() => void this.#closePairing()}
                  >${t("printers.pairing_close")}</wt-button
                >
              </div>`
          : html`<div class="actions">
                <wt-button
                  variant="primary"
                  data-test="pairing-open"
                  @click=${() => void this.#openPairing()}
                  >${t("printers.pairing_open")}</wt-button
                >
              </div>
              ${
                mode.refusedRecently > 0
                  ? html`<p class="hint" data-test="pairing-refused">
                      ${t("printers.pairing_refused").replace(
                        "{count}",
                        String(mode.refusedRecently),
                      )}
                    </p>`
                  : nothing
              }`
      }
    </wt-card>`;
  }

  /** One waiting agent: the name it asked for and when, plus Let in and the two-step Deny. NO number is
   * rendered here and none is fetched to render it — the row shape has none (design §1.2 rule 1). */
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

  /**
   * The accept dialog: the three numbers as three real buttons, each accessibly named ("Number 47", not
   * a bare "47") so the comparison against what the agent is showing is a deliberate act. An agent binds
   * nothing, so — unlike the Devices dialog — there are no profile/station pickers and the numbers are
   * tappable at once. The server does not say which is real, and a wrong tap denies the request, so the
   * number IS the accept: there is no separate Accept control.
   */
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
        cell: (a) => a.host ?? t("printers.not_reported"),
      },
      {
        key: "status",
        label: t("printers.status"),
        cell: (a) =>
          html`<span data-test=${`agent-status-${a.id}`}
              >${a.active ? t("printers.status_active") : t("printers.status_revoked")}</span
            >${a.nodeId !== null ? html` <span part="printer-provenance" data-test=${`agent-provenance-${a.id}`}>${t("printers.provenance_self")}</span>` : nothing}`,
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
      <h2 class="panel-title">${t("printers.agents_title")}</h2>
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
        @click=${() => {
          this.errorKey = null;
          this.addingAgent = true;
        }}
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
      @wt-close=${() => (this.addingAgent = false)}
    >
      ${this.#renderError()}
      <section data-test="pairing-panel">${this.#renderPairing()}</section>
      <section data-test="join-panel">
        <h3 class="panel-title">${t("printers.join_waiting_title")}</h3>
        <p class="hint">
          ${t("printers.join_hint")}
          <code class="origin" data-test="join-origin">${window.location.origin}</code>
        </p>
        ${
          this.pendingJoins.length === 0
            ? html`<p class="empty" data-test="no-join-requests">${t("printers.join_none")}</p>`
            : html`<ol>
                ${this.pendingJoins.map((r) => this.#renderJoinRequest(r))}
              </ol>`
        }
        <wt-button
          data-test="refresh-joins"
          @click=${() => void this.#mutate(() => this.#reloadJoins())}
          >${t("printers.refresh")}</wt-button
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
    this.editingPrinter = {
      id: p.id,
      name: p.name,
      transport: p.transport,
      active: p.active,
      host: p.host ?? "",
      port: p.port === null ? "" : String(p.port),
      localKey: p.localKey ?? "",
      pollId: p.pollId ?? "",
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
      <wt-button data-test=${`test-print-${p.id}`} @click=${() => void this.#testPrint(p.id)}
        >${t("printers.test_print")}</wt-button
      >
      <wt-button
        variant="danger"
        data-test=${`deactivate-printer-${p.id}`}
        data-keep-open
        data-armed=${this.armedDeletePrinterId === p.id ? "true" : nothing}
        ?disabled=${!p.active}
        @click=${() => void this.#deactivatePrinter(p.id)}
        >${this.armedDeletePrinterId === p.id ? t("printers.delete_confirm") : t("action.delete")}</wt-button
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
    return html`<section>
      <h2 class="panel-title">${t("printers.list_title")}</h2>
      <label class="printer-filter"
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
      </label>
      <wt-data-table
        data-test="printers-table"
        aria-label=${t("printers.list_title")}
        .rows=${this.printers.filter((printer) => this.printerStatus === "all" || printer.active === (this.printerStatus === "active"))}
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
          this.#registeredDevices.clear();
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
          html`<span data-test=${`job-status-${j.id}`}>${jobStatusName(j.status)}</span
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
      <h2 class="panel-title">${t("printers.jobs_title")}</h2>
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

  #renderError(): TemplateResult | typeof nothing {
    return this.errorKey
      ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
      : nothing;
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
    this.formErrors = errors;
    return Object.keys(errors).length === 0;
  }

  #renderEditPrinter(): TemplateResult | typeof nothing {
    const p = this.editingPrinter;
    if (!p) return nothing;
    const field = (
      key: "name" | "host" | "port" | "localKey" | "pollId",
      label: string,
      required = false,
    ) =>
      html`<wt-input
        name=${`printer-${key}`}
        label=${label}
        .value=${p[key]}
        ?required=${required}
        type=${key === "port" ? "number" : "text"}
        data-test=${`printer-${key === "localKey" ? "local-key" : key === "pollId" ? "poll-id" : key}-${p.id}`}
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
        this.#restoreEditFocus();
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector(`[data-test="save-printer-${p.id}"]`))}
    >
      <div class="form-fields">
        ${this.#renderFeedback()}${field("name", t("printers.name"), true)}
        <p>${transportName(p.transport)}</p>
        ${
          p.transport === "network_tcp"
            ? html`${field("host", t("printers.host"), true)}${field("port", t("printers.port"))}`
            : p.transport === "cloud_poll"
              ? html`${field("pollId", t("printers.poll_id"), true)}
                  <wt-help-tooltip aria-label=${t("printers.poll_id")}
                    >${t("printers.poll_hint")}</wt-help-tooltip
                  >`
              : field("localKey", t("printers.local_key"), true)
        }
        <wt-switch
          name="printer-active"
          label=${t("printers.active")}
          data-test=${`printer-active-${p.id}`}
          .checked=${p.active}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#editPrinter(p.id, { active: e.detail.checked })}
        ></wt-switch>
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

  /** A discovered device's display name: its self-reported name, else make + model, else its stable id. */
  #discoveredLabel(device: DiscoveredPrinter): string {
    if (device.name != null && device.name !== "") return device.name;
    const parts = [device.make, device.model].filter((x): x is string => x != null && x !== "");
    if (parts.length > 0) return parts.join(" ");
    return device.localKey ?? device.host ?? "";
  }

  #renderNewPrinter(): TemplateResult | typeof nothing {
    if (!this.addingPrinter) return nothing;
    const columns: DataTableColumn<DiscoveredPrinter>[] = [
      {
        key: "name",
        label: t("printers.name"),
        cell: (d) =>
          html`<div part="discovered-details" data-test=${`discovered-row-${this.#deviceKey(d)}`}>
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
          html`<wt-button
            variant="primary"
            data-test=${`register-${this.#deviceKey(d)}`}
            ?disabled=${this.submitting}
            @click=${() => void this.#registerDiscovered(d)}
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
        this.#endScan();
      }}
    >
      ${this.#renderError()}
      <p class="hint">${t("printers.discovery_hint")}</p>
      <p class="hint">${t("printers.bluetooth_pair_note")}</p>
      <div class="actions">
        <wt-button
          data-test="scan-printers"
          ?loading=${this.scanning}
          @click=${() => void this.#scan()}
          >${this.scanning ? t("printers.scan_loading") : t("printers.scan")}</wt-button
        >
        <wt-button data-test="refresh-discovered" @click=${() => void this.#refreshDiscovered()}
          >${t("printers.refresh")}</wt-button
        >
      </div>
      <wt-data-table
        data-test="discovered-table"
        aria-label=${t("printers.discovered_title")}
        .columns=${columns}
        .rows=${this.discovered.filter((d) => this.#canAdd(d))}
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
      ${this.#renderAgentsSection()}
      ${this.agents.length > 0 ? this.#renderPrintersSection() : nothing}
      ${this.#renderJobsSection()}${this.addingAgent || this.addingPrinter || this.editingAgent || this.editingPrinter ? nothing : this.#renderError()}
      ${this.#renderAgentModal()}${this.#renderEditAgent()}${this.#renderNewPrinter()}${this.#renderEditPrinter()}${this.#renderAcceptDialog()}
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
