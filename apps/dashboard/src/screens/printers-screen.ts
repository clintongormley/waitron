import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { drawerPolicyName, jobStatusName, printModeName, transportName } from "../i18n/domain.js";
import { formatIsoMinute } from "../date-utils.js";
import type {
  DashboardApi,
  DiscoveredPrinter,
  DrawerOpenPolicy,
  JoinRequestRow,
  LocationSummary,
  PairingModeState,
  PrintAgentRow,
  PrintJobRow,
  PrintTicketScope,
  PrintTransport,
  Printer,
  PrinterInput,
  PrinterPatch,
  ReceiptPrintMode,
  Station,
  Till,
} from "../api/client.js";

/** The three receipt print modes the per-location toggle offers, in render order — the `receipt_print_mode`
 * pgEnum's members. `auto` leads (auto-print on every sale, the column default), then the two quieter modes. */
const PRINT_MODES: readonly ReceiptPrintMode[] = ["auto", "on_request", "never"];

/** The two cash-drawer-open policies the per-location toggle offers, in render order — the
 * `drawer_open_policy` pgEnum's members. `gated` leads (a manager must authorize an out-of-sale drawer
 * open, the SECURE column default), then `open` (any operator may). */
const DRAWER_POLICIES: readonly DrawerOpenPolicy[] = ["gated", "open"];

/** A printer the row editor holds in local, editable state — a defensive copy of the loaded {@link Printer}
 * with the nullable connection columns flattened to STRINGS (`null` → `""`), so a `wt-input` can bind them
 * and `#savePrinter` maps an empty string back to a clearing `null`. `localKey` is the stable device id
 * (USB serial / Bluetooth MAC) for `usb`/`bluetooth`. `transport` is display-only here (the row shows it
 * but does not edit it; the create surface owns the transport choice). There is no serving-agent column —
 * eligibility is derived at run time (central printer provisioning §3). */
interface EditablePrinter {
  id: string;
  name: string;
  transport: PrintTransport;
  host: string;
  port: string;
  localKey: string;
  pollId: string;
  ticketScope: PrintTicketScope;
  active: boolean;
}

/** The transport options the create surface offers, in the order they render. `network_tcp` leads so the
 * default (the first option) is the venue's most common printer.
 *
 * `cloud_poll` is deliberately EXCLUDED: it is provisioned by Waitron Cloud, not added on this screen.
 * The `PrintTransport` enum, the API schema and the row DISPLAY still forward-carry `cloud_poll` (an
 * existing one renders and reads normally — see `#renderPrinter`/`transportName`); only this create
 * surface drops it. `usb`/`bluetooth` are NOT added by hand — a physical device is keyed by a stable id
 * only the box can read, so those transports register from the discovered list (§10). */
const TRANSPORTS: readonly PrintTransport[] = ["network_tcp", "usb", "bluetooth"];

/** The transports registered from the discovered-devices list rather than a manual form — a physical USB
 * or Bluetooth device is keyed by a stable id (USB serial / MAC) that only the box can read. */
const DISCOVERED_TRANSPORTS: readonly PrintTransport[] = ["usb", "bluetooth"];

/**
 * The management dashboard's IMPRESORAS (printers) screen (printing subsystem §6): the venue's central
 * print-management surface, modelled on the devices / service-status config screens (their inline
 * list + "new" form idiom, `@waitron/ui` primitives, `--wt-*` tokens). It manages three things:
 *
 *  - PRINT AGENTS — the always-on local processes that pull queued jobs and push bytes to the hardware.
 *    Lists the enrolled agents (name, active/revoked, last-seen); REVOKES an agent behind a TWO-STEP
 *    confirm (a revoke stops a working agent, so an accidental single click must not fire it — only
 *    ACTIVE agents show the control). A new agent JOINS through the SHARED join-and-accept mechanism
 *    (device-join-and-accept, the twin of the Devices screen): the venue-wide pairing window, a queue of
 *    agents asking to join (`api.joinRequests("print_agent")`, NO number in the row), and a per-request
 *    accept dialog that fetches `api.joinChallenge(id)` — three shuffled two-digit numbers of which the
 *    server does not say which is real — and accepts on the tapped one (`api.acceptPrintAgentJoinRequest`).
 *    An agent binds nothing, so the dialog is JUST the three numbers (no profile / station pickers). A
 *    WRONG tap is terminal for the row (the server denied it) — `device.join_mismatch`, the same
 *    surface-neutral terminal code the device accept uses. Deny sits behind the same two-step confirm as
 *    Revoke.
 *  - PRINTERS — the managed printer configs. CREATES one from the "new printer" form (name + transport +
 *    the transport's connection fields); EDITS a row's name / connection fields / ticket scope / active
 *    and Guardar-s it (`api.updatePrinter`); DEACTIVATES one (`api.deactivatePrinter`, never a hard
 *    delete); and TEST-PRINTS one (`api.testPrint` enqueues a known diagnostic payload — the never-block
 *    outbox path, so the button never hangs on a broken printer). A create short of a transport's required
 *    fields surfaces the server's `printer.invalid_config` in the error banner.
 *  - STATUS — the recent print jobs (`api.listRecentJobs`): each job's resolved printer, status, attempts,
 *    timestamps and last error, so an operator can see the last delivered and any failing printer.
 *
 * Gating is server-side (`printer.manage`, admin + manager): the shell hides this nav from a `staff`
 * session and every route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is
 * fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. The raw code stays in state; `codeMessage`
 * maps it to localised copy at the render edge, so the banner shows a sentence and never the raw wire code.
 */
@customElement("dashboard-printers-screen")
export class PrintersScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
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
      .new {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        margin-top: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .field {
        display: block;
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
      .stations {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }
      .stations-title {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
      .stations-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      .mode-options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The enrolled agents (server order kept), the printers as editable rows, and the recent jobs — all
  // (re)loaded on connect and after every mutation.
  @state() private submitting = false;
  @state() private agents: PrintAgentRow[] = [];
  @state() private printers: EditablePrinter[] = [];
  @state() private jobs: PrintJobRow[] = [];

  // The venue's live kitchen stations (for the per-printer "stations this printer serves" toggles), and
  // a printerId → attached-stationId[] map, both (re)loaded alongside the lists above and after every
  // mutation. A printer with no id key reads as "no stations attached".
  @state() private stations: Station[] = [];
  @state() private printerStations: Record<string, string[]> = {};

  // Counter receipt/drawer (§5): the venue's tills (the per-till receipt-printer picker's source) and its
  // locations (the per-location print-mode toggle's list), both (re)loaded alongside the lists above.
  @state() private tills: Till[] = [];
  @state() private locations: LocationSummary[] = [];
  // The per-location receipt print mode the toggle reflects — a locationId → mode map. FOLLOWS the KDS-1
  // `bump_mode` precedent (kitchen-screen): `receipt_print_mode` has NO read route (only the tills route
  // is server-side in this slice), so the toggle starts on the column default (`auto`) and reflects the
  // OPERATOR's own picks. `#load` seeds an entry per location, preserving any pick already made, so a
  // post-mutation reload does not reset the segmented control.
  @state() private printModes: Record<string, ReceiptPrintMode> = {};
  // The per-location drawer-open policy the toggle reflects — a locationId → policy map. SAME bump_mode
  // precedent as `printModes` above: `drawer_open_policy` has NO read route in this slice, so the toggle
  // starts on the column default (`gated`, the SECURE choice) and reflects the OPERATOR's own picks.
  // `#load` seeds an entry per location, preserving any pick already made, so a post-mutation reload does
  // not reset the segmented control.
  @state() private drawerPolicies: Record<string, DrawerOpenPolicy> = {};

  // The id of the agent whose Revoke control is ARMED (awaiting a confirming second click), or null.
  @state() private armedRevokeId: string | null = null;

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

  // The new-printer form's fields. `newTransport` seeds to the first option; for network_tcp the host +
  // port are optional strings, sent only when non-empty (the server owns the per-transport required
  // check). usb/bluetooth carry no manual connection fields — they register from `discovered`.
  @state() private newPrinterName = "";
  @state() private newTransport: PrintTransport = TRANSPORTS[0];
  @state() private newHost = "";
  @state() private newPort = "";

  // The discovered-devices inventory the usb/bluetooth create surface offers, and the network_tcp Scan
  // pre-fill offers (filtered to the current transport). Loaded on switching to a discovered transport,
  // on Scan, and on Refresh — never at connect (discovery is on-demand). `registerNames` holds the name
  // typed against each unregistered row, keyed by the device's `localKey`.
  @state() private discovered: DiscoveredPrinter[] = [];
  @state() private registerNames: Record<string, string> = {};

  @state() private errorKey: string | null = null;

  // Handle to the create form's transport native <select>, reconciled to its state in `updated()` — a
  // native select's `.value` bound in the template commits before its <option> children exist, so a
  // non-first selection would fall back to the first (the devices/login screens document the same bug).
  #transportSelect = createRef<HTMLSelectElement>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Reconcile the create-form transport select's live value to its state after every render, once its
   * <option> children are in the DOM. The select is rendered unconditionally, so the ref is always
   * populated; setting `.value` imperatively does not trigger a reactive update. */
  override updated(): void {
    const transport = this.#transportSelect.value;
    if (transport) transport.value = this.newTransport;
    // Reconcile each per-till receipt-printer <select> to the till's PERSISTED printer id (loaded from
    // the tills route, or "" for none) — the same native-select-value-before-<option>-children fix the two
    // create-form selects above use, applied to the dynamic per-till selects via a shadow-DOM query (the
    // count varies per venue, so a fixed ref per select is not possible). After a set/clear mutation the
    // reload updates `this.tills`, re-renders, and this pins each select to the new value.
    for (const till of this.tills) {
      const select = this.renderRoot.querySelector<HTMLSelectElement>(
        `select[data-test="till-receipt-printer-${till.id}"]`,
      );
      if (select) select.value = till.receiptPrinterId ?? "";
    }
  }

  /** (Re)load the agents, printers, jobs and kitchen stations, plus each printer's attached-station set.
   * Called on connect and after every mutation. A rejection anywhere becomes the `errorKey` banner rather
   * than an unhandled rejection. Disarms any armed revoke (the armed row may no longer exist) and maps
   * each printer to its editable row. The per-printer station reads run as a second `Promise.all` after
   * the lists (each needs a printer id from the first phase); an empty printer list makes it a no-op. */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    this.armedDenyId = null;
    try {
      const [agents, printers, jobs, stations, tills, locations, pairing, pendingJoins] =
        await Promise.all([
          this.api.listAgents(),
          this.api.listPrinters(),
          this.api.listRecentJobs(),
          // The station↔printer mapping section needs the full station list for its toggles.
          // `listStations()` (GET /management-api/stations) is `till.configure`-gated, whereas the mapping
          // WRITES are `printer.manage`-gated — but that mismatch is unreachable: both permissions map to
          // exactly {manager, admin} (packages/identity/src/permissions.ts), so every user who can reach
          // this screen holds both. If the role→permission map ever grants `printer.manage` WITHOUT
          // `till.configure`, move this read to a `printer.manage`-gated stations endpoint (raised by
          // Copilot on the KDS-4 PR).
          this.api.listStations(),
          // Counter receipt/drawer (§5): the tills (receipt-printer picker) + locations (print-mode toggle).
          // `listTills()` is `printer.manage`-gated (this screen's own permission); `getLocations()` is
          // `schedule.manage`-gated, the same unreachable-mismatch shape as `listStations()` above — both
          // `printer.manage` and `schedule.manage` sit in the MANAGER set (packages/identity/src/permissions.ts;
          // admin holds ALL), so the two map to the identical {manager, admin} and every user who reaches
          // this screen holds both.
          this.api.listTills(),
          this.api.getLocations(),
          // The shared pairing window + this surface's join queue (kind "print_agent"). Both take their
          // permission from the row's KIND, so they serve the printers screen exactly as the devices one.
          this.api.pairingMode(),
          this.api.joinRequests("print_agent"),
        ]);
      // Pair each printer id with its OWN station set at fetch time, so the correlation cannot drift on
      // a later reorder/filter the way a positional array-zip would. (Still one call per printer — the
      // N+1 is a tracked follow-up, out of scope here; only the zip fragility is being removed.)
      const printerStations: Record<string, string[]> = Object.fromEntries(
        await Promise.all(
          printers.map(
            async (p: Printer) =>
              [p.id, (await this.api.listPrinterStations(p.id)).map((sp) => sp.stationId)] as const,
          ),
        ),
      );
      this.agents = agents;
      this.printers = printers.map((p: Printer) => ({
        id: p.id,
        name: p.name,
        transport: p.transport,
        host: p.host ?? "",
        port: p.port === null ? "" : String(p.port),
        localKey: p.localKey ?? "",
        pollId: p.pollId ?? "",
        ticketScope: p.ticketScope,
        active: p.active,
      }));
      this.jobs = jobs;
      this.stations = stations;
      this.printerStations = printerStations;
      this.tills = tills;
      this.locations = locations;
      // Seed one print-mode entry per location, PRESERVING any pick already made (the bump_mode
      // precedent — no read route, so the toggle reflects the operator's picks, not the persisted value).
      // A reload after a mode mutation therefore keeps the segmented control on the chosen mode.
      this.printModes = Object.fromEntries(
        locations.map((l) => [l.id, this.printModes[l.id] ?? "auto"]),
      );
      // Seed one drawer-policy entry per location, PRESERVING any pick already made — the same bump_mode
      // precedent as `printModes` above (no read route, so the toggle reflects the operator's picks).
      this.drawerPolicies = Object.fromEntries(
        locations.map((l) => [l.id, this.drawerPolicies[l.id] ?? "gated"]),
      );
      this.pairing = pairing;
      this.pendingJoins = pendingJoins;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The shared shape of every mutation: clear the error banner, run `action`, reload on success, and
   * turn a rejection into the `errorKey` banner (never an unhandled rejection). Each mutation method
   * supplies only its own `action`; any pre/post state a method owns (a blank-input early return, the
   * shown-once code panel, the create-form reset) stays in that method around this call. */
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
   * enrolled agent. Throws like `listAgents` itself; the one caller wraps it. Disarms any armed revoke. */
  async #reloadAgents(): Promise<void> {
    this.armedRevokeId = null;
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

  // ── Printers ───────────────────────────────────────────────────────────────────────────────────

  /** Capture the picked transport. A native `<select>` `change` is `composed: false`, so `stopPropagation`
   * is defensive consistency with the composed `wt-change` handlers, not a boundary guard. Switching to a
   * usb/bluetooth transport reads the discovered inventory (there is no manual form for those); switching
   * to network_tcp clears the list (its results only appear on an explicit Scan). */
  #onNewTransport(event: Event): void {
    event.stopPropagation();
    this.newTransport = (event.target as HTMLSelectElement).value as PrintTransport;
    this.discovered = [];
    if (DISCOVERED_TRANSPORTS.includes(this.newTransport)) void this.#refreshDiscovered();
  }

  /** A create-form text field's composed `wt-change` → the named `new*` state slot. */
  #onNewField(event: CustomEvent<{ value: string }>, field: (value: string) => void): void {
    event.stopPropagation();
    field(event.detail.value);
  }

  /** Read the current discovered inventory into state; throws like the verb it calls (callers wrap). */
  async #loadDiscovered(): Promise<void> {
    this.discovered = await this.api.listDiscoveredPrinters();
  }

  /** Re-read the discovered inventory (the usb/bluetooth Refresh, and after a switch to one of those
   * transports). A rejection becomes the `errorKey` banner rather than an unhandled rejection. */
  async #refreshDiscovered(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#loadDiscovered();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Open the venue discovery window (the expensive LAN sweep / Bluetooth inquiry the agents run), then
   * read what turned up so the network_tcp form can offer a found IP printer to pre-fill. A rejection
   * becomes the `errorKey` banner. */
  async #scan(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.startPrinterDiscovery();
      await this.#loadDiscovered();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Capture the name typed against one discovered row (keyed by its stable device id). */
  #onRegisterName(localKey: string, value: string): void {
    this.registerNames = { ...this.registerNames, [localKey]: value };
  }

  /** Stamp a scanned network_tcp result's host + port into the manual IP form. */
  #useResult(result: DiscoveredPrinter): void {
    this.newHost = result.host ?? "";
    this.newPort = result.port == null ? "" : String(result.port);
  }

  /** Add a network_tcp printer from the manual IP form, then reload. A blank name is a no-op. Host + port
   * are sent only when non-empty — the server owns the required-field check (`printer.invalid_config`,
   * network_tcp needs a host), so the screen stays a thin sender; no other transport's fields are sent
   * (usb/bluetooth register from the discovered list, cloud_poll is not offered). On success the form
   * resets; on rejection the `errorKey` banner shows and the form is left for a retry. */
  async #createPrinter(): Promise<void> {
    this.errorKey = null; // also dismisses a prior banner on the blank-name early return below
    const name = this.newPrinterName.trim();
    if (name === "") return;
    const input: PrinterInput = { name, transport: "network_tcp" };
    if (this.newHost.trim() !== "") input.host = this.newHost.trim();
    if (this.newPort.trim() !== "") input.port = Number(this.newPort);
    await this.#submit(async () => {
      await this.api.createPrinter(input);
      this.newPrinterName = "";
      this.newHost = "";
      this.newPort = "";
    });
  }

  /** Register a discovered usb/bluetooth device as a printer: create it with the row's transport + its
   * stable `localKey` and the name typed against the row. A blank name is a no-op. On success the row's
   * typed name clears and both the printer list and the discovered inventory reload (so the row flips to
   * "registered"); a rejection (a device already registered → `printer.already_registered`) becomes the
   * `errorKey` banner, and the discovered list is NOT reloaded so the banner survives. Shares the
   * `submitting` gate with the other form submissions. */
  async #registerDiscovered(device: DiscoveredPrinter): Promise<void> {
    if (this.submitting) return;
    const localKey = device.localKey;
    if (localKey === undefined) return;
    const name = (this.registerNames[localKey] ?? "").trim();
    if (name === "") return;
    this.errorKey = null;
    this.submitting = true;
    try {
      await this.api.createPrinter({ name, transport: device.transport, localKey });
      this.registerNames = { ...this.registerNames, [localKey]: "" };
      await this.#load();
      await this.#loadDiscovered();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  /** Apply a partial edit to the printer row `id` holds, replacing it in state with a fresh object (so a
   * row's edits never mutate a shared reference the render still points at). */
  #editPrinter(id: string, patch: Partial<EditablePrinter>): void {
    this.printers = this.printers.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }

  /** A factory for an edit row's text-field `@wt-change` handler — the edit-row counterpart to
   * `#onNewField`. Returns a handler that stops the composed event at this shadow boundary and writes
   * `field` on the row `id` holds. `field` is one of the STRING-valued editable columns (name + the four
   * connection fields); the two switches (ticket scope, active) carry `checked` and keep inline handlers. */
  #editHandler<K extends "name" | "host" | "port" | "localKey" | "pollId">(
    id: string,
    field: K,
  ): (event: CustomEvent<{ value: string }>) => void {
    return (event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.#editPrinter(id, { [field]: event.detail.value } as Pick<EditablePrinter, K>);
    };
  }

  /** Persist the CURRENT values of the printer row `id` holds, then reload. Reads the row from state at
   * click time (not a captured render closure), so an edit made just before the click is what persists.
   * Only the connection fields relevant to the row's own TRANSPORT are sent (the DB CHECK asserts the
   * required fields are present but does not forbid extras, so a stray field from another transport
   * would persist as meaningless config); within that transport an empty field is sent as a clearing
   * `null`, and the port string is parsed to an int. A vanished row is a no-op. A rejection becomes the
   * `errorKey` banner. */
  async #savePrinter(id: string): Promise<void> {
    this.errorKey = null; // also dismisses a prior banner on the vanished-row early return below
    const row = this.printers.find((p) => p.id === id);
    if (row === undefined) return;
    const patch: PrinterPatch = {
      name: row.name,
      ticketScope: row.ticketScope,
      active: row.active,
    };
    if (row.transport === "usb" || row.transport === "bluetooth") {
      patch.localKey = row.localKey === "" ? null : row.localKey;
    } else if (row.transport === "network_tcp") {
      patch.host = row.host === "" ? null : row.host;
      patch.port = row.port.trim() === "" ? null : Number(row.port);
    } else {
      // cloud_poll — the only remaining transport.
      patch.pollId = row.pollId === "" ? null : row.pollId;
    }
    await this.#submit(() => this.api.updatePrinter(id, patch));
  }

  /** Soft-delete (deactivate) the printer `id` holds, then reload. A rejection becomes the `errorKey`
   * banner. */
  async #deactivatePrinter(id: string): Promise<void> {
    await this.#mutate(() => this.api.deactivatePrinter(id));
  }

  /** Enqueue a diagnostic test print for the printer `id` holds, then reload the jobs so the newly
   * queued job appears in the status list. The enqueue never blocks on the printer; a rejection (an
   * unknown/absent printer) becomes the `errorKey` banner. */
  async #testPrint(id: string): Promise<void> {
    await this.#mutate(() => this.api.testPrint(id));
  }

  /** Attach (`checked`) or detach (`!checked`) the station `stationId` on the printer `printerId`, then
   * reload so the toggle set reflects the server. Attach is idempotent server-side and detach is a pure
   * idempotent delete, so a toggle never errors on a stale check; a real rejection (a since-retired
   * station/printer on attach) becomes the `errorKey` banner via `#mutate`. */
  async #toggleStation(printerId: string, stationId: string, checked: boolean): Promise<void> {
    await this.#mutate(() =>
      checked
        ? this.api.attachPrinterToStation(stationId, printerId)
        : this.api.detachPrinterFromStation(stationId, printerId),
    );
  }

  // ── Receipt printer + print mode (counter receipt/drawer §5) ─────────────────────────────────────

  /** Set (or clear, with `null`) the receipt printer on the till `tillId` holds, then reload so the
   * picker reflects the persisted value. A `""` from the "— no printer —" option is sent as a clearing
   * `null`. A rejection (a printer not in the till's location → `printer.not_found`) becomes the
   * `errorKey` banner via `#mutate`. */
  async #setTillPrinter(tillId: string, value: string): Promise<void> {
    await this.#mutate(() => this.api.setTillReceiptPrinter(tillId, value === "" ? null : value));
  }

  /** Set the receipt print mode on the location `locationId` holds, reflecting the pick locally (the
   * bump_mode precedent — no read route, so the segmented control tracks the operator's picks). A no-op
   * reselect of the current mode still writes (idempotent server-side). The local pick is applied ONLY
   * once the write RESOLVES, inside `#mutate`'s action (which then reloads, preserving it via `#load`'s
   * `?? "auto"` seed): a rejection therefore leaves `printModes` untouched, so the segmented control
   * keeps showing the PRIOR mode rather than the value that failed to save, and surfaces the `errorKey`
   * banner — matching the receipt-printer picker, which reverts on failure via `updated()`. */
  async #setPrintMode(locationId: string, mode: ReceiptPrintMode): Promise<void> {
    await this.#mutate(async () => {
      await this.api.setReceiptPrintMode(locationId, mode);
      this.printModes = { ...this.printModes, [locationId]: mode };
    });
  }

  /** Set the cash-drawer-open policy on the location `locationId`, reflecting the pick locally (the same
   * bump_mode precedent as `#setPrintMode` — no read route, so the segmented control tracks the operator's
   * picks). A no-op reselect of the current policy still writes (idempotent server-side). The local pick
   * is applied ONLY once the write RESOLVES, inside `#mutate`'s action (which then reloads, preserving it
   * via `#load`'s `?? "gated"` seed): a rejection therefore leaves `drawerPolicies` untouched, so the
   * segmented control keeps showing the PRIOR policy rather than the value that failed to save, and
   * surfaces the `errorKey` banner. */
  async #setDrawerPolicy(locationId: string, policy: DrawerOpenPolicy): Promise<void> {
    await this.#mutate(async () => {
      await this.api.setDrawerOpenPolicy(locationId, policy);
      this.drawerPolicies = { ...this.drawerPolicies, [locationId]: policy };
    });
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

  #renderAgent(agent: PrintAgentRow): TemplateResult {
    const armed = this.armedRevokeId === agent.id;
    return html`<li data-test="agent-row-${agent.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="agent-name-${agent.id}">${agent.name}</span>
            <span class="meta">
              <span data-test="agent-status-${agent.id}"
                >${agent.active ? t("printers.status_active") : t("printers.status_revoked")}</span
              >
              <span data-test="agent-last-seen-${agent.id}"
                >${this.#timestamp(agent.lastSeenAt)}</span
              >
            </span>
          </div>
          ${
            agent.active
              ? html`<wt-button
                  variant="danger"
                  size="sm"
                  data-test="revoke-agent-${agent.id}"
                  data-armed=${armed ? "true" : nothing}
                  aria-label=${`${armed ? t("printers.revoke_confirm") : t("printers.revoke")} ${agent.name}`}
                  @click=${() => this.#onRevokeAgent(agent.id)}
                  >${armed ? t("printers.revoke_confirm") : t("printers.revoke")}</wt-button
                >`
              : nothing
          }
        </div>
      </wt-card>
    </li>`;
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

  #renderPrinter(p: EditablePrinter): TemplateResult {
    return html`<li data-test="printer-row-${p.id}">
      <wt-card>
        <div class="details" style="margin-bottom: var(--wt-space-3)">
          <span class="meta">
            <span data-test="printer-transport-${p.id}">${transportName(p.transport)}</span>
          </span>
        </div>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-printer-${p.id}"]`))}
            label=${t("printers.name")}
            data-test="printer-name-${p.id}"
            .value=${p.name}
            @wt-change=${this.#editHandler(p.id, "name")}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-printer-${p.id}"]`))}
            label=${t("printers.host")}
            data-test="printer-host-${p.id}"
            .value=${p.host}
            @wt-change=${this.#editHandler(p.id, "host")}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-printer-${p.id}"]`))}
            type="number"
            label=${t("printers.port")}
            data-test="printer-port-${p.id}"
            .value=${p.port}
            @wt-change=${this.#editHandler(p.id, "port")}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-printer-${p.id}"]`))}
            label=${t("printers.local_key")}
            data-test="printer-local-key-${p.id}"
            .value=${p.localKey}
            @wt-change=${this.#editHandler(p.id, "localKey")}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="save-printer-${p.id}"]`))}
            label=${t("printers.poll_id")}
            data-test="printer-poll-id-${p.id}"
            .value=${p.pollId}
            @wt-change=${this.#editHandler(p.id, "pollId")}
          ></wt-input>
          <wt-switch
            label=${t("printers.ticket_scope")}
            data-test="printer-ticket-scope-${p.id}"
            .checked=${p.ticketScope === "order"}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#editPrinter(p.id, { ticketScope: e.detail.checked ? "order" : "station" });
            }}
          ></wt-switch>
          <wt-switch
            label=${t("printers.active")}
            data-test="printer-active-${p.id}"
            .checked=${p.active}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#editPrinter(p.id, { active: e.detail.checked });
            }}
          ></wt-switch>
          <wt-button
            variant="primary"
            size="sm"
            data-test="save-printer-${p.id}"
            ?disabled=${this.submitting}
            @click=${() => void this.#savePrinter(p.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="secondary"
            size="sm"
            data-test="test-print-${p.id}"
            @click=${() => void this.#testPrint(p.id)}
            >${t("printers.test_print")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="deactivate-printer-${p.id}"
            ?disabled=${!p.active}
            @click=${() => void this.#deactivatePrinter(p.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
        <div class="stations" role="group" aria-labelledby=${`stations-title-${p.id}`}>
          <span class="stations-title" id=${`stations-title-${p.id}`}
            >${t("printers.stations_title")}</span
          >
          ${
            this.stations.length === 0
              ? html`<p class="empty" data-test="no-stations-${p.id}">
                  ${t("printers.no_stations")}
                </p>`
              : html`<div class="stations-list">
                  ${this.stations.map((s) => {
                    const attached = (this.printerStations[p.id] ?? []).includes(s.id);
                    return html`<wt-switch
                      label=${s.name}
                      data-test="station-toggle-${p.id}-${s.id}"
                      .checked=${attached}
                      @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                        e.stopPropagation();
                        void this.#toggleStation(p.id, s.id, e.detail.checked);
                      }}
                    ></wt-switch>`;
                  })}
                </div>`
          }
        </div>
      </wt-card>
    </li>`;
  }

  #renderJob(job: PrintJobRow): TemplateResult {
    return html`<li data-test="job-row-${job.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="job-printer-${job.id}"
              >${this.#printerName(job.printerId)}</span
            >
            <span class="meta">
              <span data-test="job-status-${job.id}">${jobStatusName(job.status)}</span>
              <span data-test="job-attempts-${job.id}"
                >${t("printers.job_attempts")}: ${job.attempts}</span
              >
              <span>${this.#timestamp(job.createdAt)}</span>
              ${job.deliveredAt !== null ? html`<span>→ ${this.#timestamp(job.deliveredAt)}</span>` : nothing}
              ${
                job.lastError !== null
                  ? html`<span class="error" data-test="job-error-${job.id}"
                      >${job.lastError}</span
                    >`
                  : nothing
              }
            </span>
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #renderAgentsSection(): TemplateResult {
    return html`
      <section>
        <h2 class="panel-title" style="margin-top:0">${t("printers.agents_title")}</h2>

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
                  ${this.pendingJoins.map((request) => this.#renderJoinRequest(request))}
                </ol>`
          }
        </section>

        <section data-test="enrolled-agents-panel">
          <h3 class="panel-title">${t("printers.join_enrolled_title")}</h3>
          ${
            this.agents.length === 0
              ? html`<p class="empty" data-test="no-agents">${t("printers.no_agents")}</p>`
              : html`<ol>
                  ${this.agents.map((agent) => this.#renderAgent(agent))}
                </ol>`
          }
        </section>
      </section>
    `;
  }

  /** A discovered device's display name: its self-reported name, else make + model, else its stable id. */
  #discoveredLabel(device: DiscoveredPrinter): string {
    if (device.name != null && device.name !== "") return device.name;
    const parts = [device.make, device.model].filter((x): x is string => x != null && x !== "");
    if (parts.length > 0) return parts.join(" ");
    return device.localKey ?? device.host ?? "";
  }

  /** The manual IP (network_tcp) add form: name + host + port + Add, plus a Scan that opens the
   * discovery window and offers any found IP printer to pre-fill host + port. */
  #renderNetworkForm(): TemplateResult {
    const found = this.discovered.filter((d) => d.transport === "network_tcp");
    return html`
      <div class="new">
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-printer]"))}
          label=${t("printers.name")}
          data-test="new-printer-name"
          .value=${this.newPrinterName}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onNewField(e, (v) => (this.newPrinterName = v))}
        ></wt-input>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-printer]"))}
          label=${t("printers.host")}
          data-test="new-host"
          .value=${this.newHost}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onNewField(e, (v) => (this.newHost = v))}
        ></wt-input>
        <wt-input
          @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=add-printer]"))}
          type="number"
          label=${t("printers.port")}
          data-test="new-port"
          .value=${this.newPort}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onNewField(e, (v) => (this.newPort = v))}
        ></wt-input>
        <wt-button
          variant="primary"
          data-test="add-printer"
          ?disabled=${this.submitting}
          @click=${() => void this.#createPrinter()}
          >${t("printers.add_printer")}</wt-button
        >
        <wt-button variant="secondary" data-test="scan-printers" @click=${() => void this.#scan()}
          >${t("printers.scan")}</wt-button
        >
      </div>
      ${
        found.length === 0
          ? nothing
          : html`<ol>
              ${found.map(
                (d, i) =>
                  html`<li data-test="discovered-row-net-${i}">
                    <wt-card>
                      <div class="row">
                        <div class="details">
                          <span class="label">${this.#discoveredLabel(d)}</span>
                          <span class="meta"><span>${d.host}:${d.port}</span></span>
                        </div>
                        <wt-button
                          variant="secondary"
                          size="sm"
                          data-test="use-result-${i}"
                          @click=${() => this.#useResult(d)}
                          >${t("printers.use_result")}</wt-button
                        >
                      </div>
                    </wt-card>
                  </li>`,
              )}
            </ol>`
      }
    `;
  }

  /** One discovered usb/bluetooth device row — its identity + stable id, and either a "registered"
   * marker (an existing printer already keys on it) or a name field + Register action. */
  #renderDiscoveredRow(device: DiscoveredPrinter): TemplateResult {
    const localKey = device.localKey ?? "";
    return html`<li data-test="discovered-row-${localKey}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label">${this.#discoveredLabel(device)}</span>
            <span class="meta">
              <span>${localKey}</span>
              ${
                device.agentName == null
                  ? nothing
                  : html`<span
                      >${t("printers.discovered_seen_on").replace("{agent}", device.agentName)}</span
                    >`
              }
            </span>
          </div>
          ${
            device.alreadyRegistered
              ? html`<span class="label" data-test="discovered-registered-${localKey}"
                  >${t("printers.registered")}</span
                >`
              : html`<wt-input
                    @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="register-${localKey}"]`))}
                    label=${t("printers.name")}
                    data-test="register-name-${localKey}"
                    .value=${this.registerNames[localKey] ?? ""}
                    @wt-change=${(e: CustomEvent<{ value: string }>) =>
                      this.#onNewField(e, (v) => this.#onRegisterName(localKey, v))}
                  ></wt-input>
                  <wt-button
                    variant="primary"
                    size="sm"
                    data-test="register-${localKey}"
                    ?disabled=${this.submitting}
                    @click=${() => void this.#registerDiscovered(device)}
                    >${t("printers.register")}</wt-button
                  >`
          }
        </div>
      </wt-card>
    </li>`;
  }

  /** The usb/bluetooth register surface: the discovered inventory (filtered to the current transport)
   * with a per-row Register, a Refresh, and — for bluetooth — a one-line note to pair on the box first. */
  #renderDiscoveredSection(): TemplateResult {
    const found = this.discovered.filter((d) => d.transport === this.newTransport);
    return html`
      ${
        this.newTransport === "bluetooth"
          ? html`<p class="hint" data-test="bluetooth-pair-note">
              ${t("printers.bluetooth_pair_note")}
            </p>`
          : nothing
      }
      <div class="actions">
        <wt-button
          variant="secondary"
          data-test="refresh-discovered"
          @click=${() => void this.#refreshDiscovered()}
          >${t("printers.refresh")}</wt-button
        >
      </div>
      ${
        found.length === 0
          ? html`<p class="empty" data-test="no-discovered">${t("printers.no_discovered")}</p>`
          : html`<ol>
              ${found.map((d) => this.#renderDiscoveredRow(d))}
            </ol>`
      }
    `;
  }

  #renderPrintersSection(): TemplateResult {
    return html`
      <section>
        <h2 class="panel-title">${t("printers.list_title")}</h2>
        ${
          this.printers.length === 0
            ? html`<p class="empty" data-test="no-printers">${t("printers.no_printers")}</p>`
            : html`<ol>
                ${this.printers.map((p) => this.#renderPrinter(p))}
              </ol>`
        }
        <h3 class="panel-title">${t("printers.new_printer")}</h3>
        <div class="new">
          <label class="field"
            >${t("printers.transport")}
            <select
              ${ref(this.#transportSelect)}
              data-test="new-transport"
              @change=${(e: Event) => this.#onNewTransport(e)}
            >
              ${TRANSPORTS.map((tr) => html`<option value=${tr}>${transportName(tr)}</option>`)}
            </select>
          </label>
        </div>
        ${this.newTransport === "network_tcp" ? this.#renderNetworkForm() : this.#renderDiscoveredSection()}
      </section>
    `;
  }

  #renderJobsSection(): TemplateResult {
    return html`
      <section>
        <h2 class="panel-title">${t("printers.jobs_title")}</h2>
        ${
          this.jobs.length === 0
            ? html`<p class="empty" data-test="no-jobs">${t("printers.no_jobs")}</p>`
            : html`<ol>
                ${this.jobs.map((job) => this.#renderJob(job))}
              </ol>`
        }
      </section>
    `;
  }

  /** One till's receipt-printer picker (counter receipt/drawer §5) — a native <select> of the venue's
   * ACTIVE printers plus a "no printer" clear option. The <select> value is reconciled to the till's
   * PERSISTED `receiptPrinterId` in `updated()` (the native-select-before-options fix). NOTE the options
   * are ALL active printers, DELIBERATELY not filtered to the till's location: the deli is
   * single-location (every printer is in the till's location), so a location filter would exclude
   * nothing here. Client-side filtering is not blocked by any missing data — the `printers.location_id`
   * column already exists in the DB (set at printer-insert time from `cfg.locationId`) and could be
   * projected onto `@waitron/printing`'s `PrinterRow` and the dashboard `Printer` type (a small additive
   * change; neither carries `locationId` today) — it is simply unnecessary for a single-location venue.
   * Either way the server's PATCH route (`/management-api/tills/:id/receipt-printer`) is the authority:
   * it re-validates that the chosen printer is ACTIVE and in the till's OWN location (`printer.not_found`
   * otherwise), so a cross-location pick can never persist. */
  #renderTillPicker(till: Till): TemplateResult {
    const options = this.printers.filter((p) => p.active);
    return html`<li data-test="till-row-${till.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="till-label-${till.id}">${till.label}</span>
          </div>
          <label class="field"
            >${t("printers.receipt_printer")}
            <select
              data-test="till-receipt-printer-${till.id}"
              @change=${(e: Event) => {
                e.stopPropagation();
                void this.#setTillPrinter(till.id, (e.target as HTMLSelectElement).value);
              }}
            >
              <option value="">${t("printers.receipt_no_printer")}</option>
              ${options.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </label>
        </div>
      </wt-card>
    </li>`;
  }

  /** One mode button in a location's segmented print-mode control — the primary/secondary highlight +
   * click-to-set idiom of the kitchen-screen's bump-mode option. */
  #printModeOption(locationId: string, mode: ReceiptPrintMode): TemplateResult {
    return html`<wt-button
      variant=${(this.printModes[locationId] ?? "auto") === mode ? "primary" : "secondary"}
      size="sm"
      data-test="print-mode-${locationId}-${mode}"
      @click=${() => void this.#setPrintMode(locationId, mode)}
      >${printModeName(mode)}</wt-button
    >`;
  }

  /** One location's receipt print-mode toggle (counter receipt/drawer §5) — a segmented auto/on_request/
   * never control. Set-only (no read route this slice, the bump_mode precedent): it reflects the column
   * default then the operator's picks. */
  #renderPrintMode(loc: LocationSummary): TemplateResult {
    return html`<li data-test="location-row-${loc.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="location-name-${loc.id}">${loc.name}</span>
          </div>
          <div
            class="mode-options"
            role="group"
            aria-label=${`${t("printers.print_mode")} ${loc.name}`}
          >
            ${PRINT_MODES.map((mode) => this.#printModeOption(loc.id, mode))}
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  /** One policy button in a location's segmented drawer-policy control — the primary/secondary highlight
   * + click-to-set idiom of the print-mode option above. */
  #drawerPolicyOption(locationId: string, policy: DrawerOpenPolicy): TemplateResult {
    return html`<wt-button
      variant=${(this.drawerPolicies[locationId] ?? "gated") === policy ? "primary" : "secondary"}
      size="sm"
      data-test="drawer-policy-${locationId}-${policy}"
      @click=${() => void this.#setDrawerPolicy(locationId, policy)}
      >${drawerPolicyName(policy)}</wt-button
    >`;
  }

  /** One location's cash-drawer-open policy toggle (counter receipt/drawer §5) — a segmented gated/open
   * control. Set-only (no read route this slice, the bump_mode precedent): it reflects the SECURE column
   * default (`gated`) then the operator's picks. */
  #renderDrawerPolicy(loc: LocationSummary): TemplateResult {
    return html`<li data-test="drawer-policy-row-${loc.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="drawer-location-name-${loc.id}">${loc.name}</span>
          </div>
          <div
            class="mode-options"
            role="group"
            aria-label=${`${t("printers.drawer_policy")} ${loc.name}`}
          >
            ${DRAWER_POLICIES.map((policy) => this.#drawerPolicyOption(loc.id, policy))}
          </div>
        </div>
      </wt-card>
    </li>`;
  }

  #renderReceiptSection(): TemplateResult {
    return html`
      <section>
        <h2 class="panel-title">${t("printers.receipt_title")}</h2>

        <h3 class="panel-title">${t("printers.receipt_printer_title")}</h3>
        ${
          this.tills.length === 0
            ? html`<p class="empty" data-test="no-tills">${t("printers.no_tills")}</p>`
            : html`<ol>
                ${this.tills.map((till) => this.#renderTillPicker(till))}
              </ol>`
        }

        <h3 class="panel-title">${t("printers.print_mode_title")}</h3>
        ${
          this.locations.length === 0
            ? html`<p class="empty" data-test="no-locations">${t("printers.no_locations")}</p>`
            : html`<ol>
                ${this.locations.map((loc) => this.#renderPrintMode(loc))}
              </ol>`
        }

        <h3 class="panel-title">${t("printers.drawer_policy_title")}</h3>
        ${
          this.locations.length === 0
            ? html`<p class="empty" data-test="no-locations-drawer">
                ${t("printers.no_locations")}
              </p>`
            : html`<ol>
                ${this.locations.map((loc) => this.#renderDrawerPolicy(loc))}
              </ol>`
        }
      </section>
    `;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("printers.title")}</h1>
      ${this.#renderAgentsSection()} ${this.#renderPrintersSection()}
      ${this.#renderReceiptSection()} ${this.#renderJobsSection()} ${this.#renderAcceptDialog()}
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-printers-screen": PrintersScreen;
  }
}
