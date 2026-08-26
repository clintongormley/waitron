import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import { selectStyles } from "../select-styles.js";
import type {
  DashboardApi,
  PrintAgentRow,
  PrintJobRow,
  PrintTicketScope,
  PrintTransport,
  Printer,
  PrinterInput,
} from "../api/client.js";

/** A printer the row editor holds in local, editable state — a defensive copy of the loaded {@link Printer}
 * with the nullable connection columns flattened to STRINGS (`null` → `""`), so a `wt-input` can bind them
 * and `#savePrinter` maps an empty string back to a clearing `null`. `transport`/`agentId` are display-only
 * here (the row shows them but does not edit them; the create form owns the transport/agent choice). */
interface EditablePrinter {
  id: string;
  name: string;
  transport: PrintTransport;
  agentId: string | null;
  host: string;
  port: string;
  usbPath: string;
  pollId: string;
  ticketScope: PrintTicketScope;
  active: boolean;
}

/** The transport options the create form offers, in the order they render. `network_tcp` leads so the
 * form's default (the first option) is the venue's most common printer; the reconcile in {@link
 * PrintersScreen.updated} keeps the native select's live value pinned to `newTransport`.
 *
 * `cloud_poll` is deliberately EXCLUDED here: it has no delivery path in this slice (the agent router
 * rejects it — a documented fast-follow), so offering it would let an operator create a printer that
 * accepts undeliverable jobs. The `PrintTransport` enum, the API schema and the row DISPLAY still
 * forward-carry `cloud_poll` (an existing one, e.g. created via the API, renders and reads normally —
 * see `#renderPrinter`/`transportName`); only this CREATE dropdown drops it. */
const TRANSPORTS: readonly PrintTransport[] = ["network_tcp", "usb"];

/**
 * The management dashboard's IMPRESORAS (printers) screen (printing subsystem §6): the venue's central
 * print-management surface, modelled on the devices / service-status config screens (their inline
 * list + "new" form idiom, `@waitron/ui` primitives, `--wt-*` tokens). It manages three things:
 *
 *  - PRINT AGENTS — the always-on local processes that pull queued jobs and push bytes to the hardware.
 *    Lists the enrolled agents (name, active/revoked, last-seen); GENERATES a pairing code (type a label
 *    → `api.createAgentCode(label)`), shown ONCE in a copyable panel that lives only in component state
 *    (never re-fetchable, like a device pairing code); REVOKES an agent behind a TWO-STEP confirm (a
 *    revoke stops a working agent, so an accidental single click must not fire it). Only ACTIVE agents
 *    show the revoke control.
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
      .code-panel {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
        margin-top: var(--wt-space-4);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .code-hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .code-value {
        font-family: var(--wt-font-family-mono, monospace);
        font-size: var(--wt-font-size-lg);
        letter-spacing: 0.15em;
        color: var(--wt-color-text);
      }
      .code-actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .copied {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The enrolled agents (server order kept), the printers as editable rows, and the recent jobs — all
  // (re)loaded on connect and after every mutation.
  @state() private agents: PrintAgentRow[] = [];
  @state() private printers: EditablePrinter[] = [];
  @state() private jobs: PrintJobRow[] = [];

  // The generate-agent-code form's label, and the one-time code held ONLY here (never re-fetchable).
  @state() private newAgentLabel = "";
  @state() private generatedCode: string | null = null;
  @state() private copied = false;
  // The id of the agent whose Revoke control is ARMED (awaiting a confirming second click), or null.
  @state() private armedRevokeId: string | null = null;

  // The new-printer form's fields. `newTransport` seeds to the first option; the connection fields are
  // all optional strings, sent only when non-empty (the server owns the per-transport required check).
  @state() private newPrinterName = "";
  @state() private newTransport: PrintTransport = TRANSPORTS[0];
  @state() private newAgentId = "";
  @state() private newHost = "";
  @state() private newPort = "";
  @state() private newUsbPath = "";
  @state() private newPollId = "";

  @state() private errorKey: string | null = null;

  // Handles to the create form's two native <select>s, reconciled to their state in `updated()` — a
  // native select's `.value` bound in the template commits before its <option> children exist, so a
  // non-first selection would fall back to the first (the devices/login screens document the same bug).
  #transportSelect = createRef<HTMLSelectElement>();
  #agentSelect = createRef<HTMLSelectElement>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Reconcile both create-form selects' live values to their state after every render, once their
   * <option> children are in the DOM. Both selects are rendered unconditionally, so the refs are always
   * populated; setting `.value` imperatively does not trigger a reactive update. */
  override updated(): void {
    const transport = this.#transportSelect.value;
    if (transport) transport.value = this.newTransport;
    const agent = this.#agentSelect.value;
    if (agent) agent.value = this.newAgentId;
  }

  /** (Re)load the agents, printers and jobs. Called on connect and after every mutation. A rejection
   * anywhere becomes the `errorKey` banner rather than an unhandled rejection. Disarms any armed revoke
   * (the armed row may no longer exist) and maps each printer to its editable row. */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    try {
      const [agents, printers, jobs] = await Promise.all([
        this.api.listAgents(),
        this.api.listPrinters(),
        this.api.listRecentJobs(),
      ]);
      this.agents = agents;
      this.printers = printers.map((p: Printer) => ({
        id: p.id,
        name: p.name,
        transport: p.transport,
        agentId: p.agentId,
        host: p.host ?? "",
        port: p.port === null ? "" : String(p.port),
        usbPath: p.usbPath ?? "",
        pollId: p.pollId ?? "",
        ticketScope: p.ticketScope,
        active: p.active,
      }));
      this.jobs = jobs;
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

  // ── Agents ─────────────────────────────────────────────────────────────────────────────────────

  /** The generate-code label field's composed `wt-change`. `stopPropagation` keeps it inside this shadow. */
  #onAgentLabel(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newAgentLabel = event.detail.value;
  }

  /** Mint an agent pairing code for the typed label, then show it ONCE and reload. A blank label is a
   * no-op (the server requires one). On success the code goes into state (never re-fetched) and the
   * label resets; on rejection the `errorKey` banner shows and the form is left intact for a retry. */
  async #generateCode(): Promise<void> {
    this.errorKey = null; // also dismisses a prior banner on the blank-label early return below
    const label = this.newAgentLabel.trim();
    if (label === "") return;
    await this.#mutate(async () => {
      const { code } = await this.api.createAgentCode(label);
      this.generatedCode = code;
      this.copied = false;
      this.newAgentLabel = "";
    });
  }

  /** Copy the shown code to the clipboard, confirming with a transient "Copied" status. Never throws: if
   * the clipboard is unavailable or denied the code stays on screen to copy by hand (the catch arm). */
  async #copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  }

  /** Dismiss the shown-once code — it lived only in state, so this is final (it cannot be re-fetched). */
  #dismissCode(): void {
    this.generatedCode = null;
    this.copied = false;
  }

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
   * is defensive consistency with the composed `wt-change` handlers, not a boundary guard. */
  #onNewTransport(event: Event): void {
    event.stopPropagation();
    this.newTransport = (event.target as HTMLSelectElement).value as PrintTransport;
  }

  /** Capture the picked serving agent (`""` = none, for a self-polling cloud printer). */
  #onNewAgent(event: Event): void {
    event.stopPropagation();
    this.newAgentId = (event.target as HTMLSelectElement).value;
  }

  /** A create-form text field's composed `wt-change` → the named `new*` state slot. */
  #onNewField(event: CustomEvent<{ value: string }>, field: (value: string) => void): void {
    event.stopPropagation();
    field(event.detail.value);
  }

  /** Create a printer from the new-printer form, then reload. A blank name is a no-op. Only non-empty
   * connection fields are sent — the server owns the per-transport required-field check
   * (`printer.invalid_config`), so the screen stays a thin sender. On success the form's name +
   * connection fields reset; on rejection the `errorKey` banner shows and the form is left for a retry. */
  async #createPrinter(): Promise<void> {
    this.errorKey = null; // also dismisses a prior banner on the blank-name early return below
    const name = this.newPrinterName.trim();
    if (name === "") return;
    const input: PrinterInput = { name, transport: this.newTransport };
    if (this.newAgentId !== "") input.agentId = this.newAgentId;
    if (this.newHost.trim() !== "") input.host = this.newHost.trim();
    if (this.newPort.trim() !== "") input.port = Number(this.newPort);
    if (this.newUsbPath.trim() !== "") input.usbPath = this.newUsbPath.trim();
    if (this.newPollId.trim() !== "") input.pollId = this.newPollId.trim();
    await this.#mutate(async () => {
      await this.api.createPrinter(input);
      this.newPrinterName = "";
      this.newHost = "";
      this.newPort = "";
      this.newUsbPath = "";
      this.newPollId = "";
    });
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
  #editHandler<K extends "name" | "host" | "port" | "usbPath" | "pollId">(
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
   * An empty connection field is sent as a clearing `null`; the port string is parsed to an int. A
   * vanished row is a no-op. A rejection becomes the `errorKey` banner. */
  async #savePrinter(id: string): Promise<void> {
    this.errorKey = null; // also dismisses a prior banner on the vanished-row early return below
    const row = this.printers.find((p) => p.id === id);
    if (row === undefined) return;
    await this.#mutate(() =>
      this.api.updatePrinter(id, {
        name: row.name,
        host: row.host === "" ? null : row.host,
        port: row.port.trim() === "" ? null : Number(row.port),
        usbPath: row.usbPath === "" ? null : row.usbPath,
        pollId: row.pollId === "" ? null : row.pollId,
        ticketScope: row.ticketScope,
        active: row.active,
      }),
    );
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

  // ── Formatting helpers ───────────────────────────────────────────────────────────────────────────

  /** Resolve a printer id to its display name; an id no longer in the list falls back to the raw id. */
  #printerName(printerId: string): string {
    return this.printers.find((p) => p.id === printerId)?.name ?? printerId;
  }

  /** Resolve an agent id to its display name; a null id (a cloud printer with no agent) or an id no
   * longer in the active list falls back to the neutral placeholder. */
  #agentName(agentId: string | null): string {
    if (agentId === null) return t("printers.no_agent");
    return this.agents.find((a) => a.id === agentId)?.name ?? t("printers.no_agent");
  }

  /** Format an ISO instant to the minute (UTC — no per-venue timezone yet, matching the devices screen);
   * a null instant (never seen / not yet delivered) shows the "Never" placeholder. */
  #timestamp(iso: string | null): string {
    if (iso === null) return t("printers.last_seen_never");
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
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

  #renderCodePanel(code: string): TemplateResult {
    return html`<section
      class="code-panel"
      data-test="code-panel"
      aria-label=${t("printers.code_title")}
    >
      <h3 class="panel-title" style="margin-top:0">${t("printers.code_title")}</h3>
      <p class="code-hint">${t("printers.code_hint")}</p>
      <code class="code-value" data-test="code-value">${code}</code>
      <div class="code-actions">
        <wt-button
          variant="secondary"
          data-test="copy-code"
          @click=${() => void this.#copyCode(code)}
          >${t("printers.copy")}</wt-button
        >
        <wt-button variant="ghost" data-test="dismiss-code" @click=${() => this.#dismissCode()}
          >${t("printers.done")}</wt-button
        >
        ${
          this.copied
            ? html`<span class="copied" role="status" data-test="copied"
                >${t("printers.copied")}</span
              >`
            : nothing
        }
      </div>
    </section>`;
  }

  #renderPrinter(p: EditablePrinter): TemplateResult {
    return html`<li data-test="printer-row-${p.id}">
      <wt-card>
        <div class="details" style="margin-bottom: var(--wt-space-3)">
          <span class="meta">
            <span data-test="printer-transport-${p.id}">${transportName(p.transport)}</span>
            <span data-test="printer-agent-${p.id}">${this.#agentName(p.agentId)}</span>
          </span>
        </div>
        <div class="row">
          <wt-input
            label=${t("printers.name")}
            data-test="printer-name-${p.id}"
            .value=${p.name}
            @wt-change=${this.#editHandler(p.id, "name")}
          ></wt-input>
          <wt-input
            label=${t("printers.host")}
            data-test="printer-host-${p.id}"
            .value=${p.host}
            @wt-change=${this.#editHandler(p.id, "host")}
          ></wt-input>
          <wt-input
            type="number"
            label=${t("printers.port")}
            data-test="printer-port-${p.id}"
            .value=${p.port}
            @wt-change=${this.#editHandler(p.id, "port")}
          ></wt-input>
          <wt-input
            label=${t("printers.usb_path")}
            data-test="printer-usb-path-${p.id}"
            .value=${p.usbPath}
            @wt-change=${this.#editHandler(p.id, "usbPath")}
          ></wt-input>
          <wt-input
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
        ${
          this.agents.length === 0
            ? html`<p class="empty" data-test="no-agents">${t("printers.no_agents")}</p>`
            : html`<ol>
                ${this.agents.map((agent) => this.#renderAgent(agent))}
              </ol>`
        }
        <h3 class="panel-title">${t("printers.generate_title")}</h3>
        <div class="new">
          <wt-input
            label=${t("printers.agent_label")}
            data-test="agent-label"
            .value=${this.newAgentLabel}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onAgentLabel(e)}
          ></wt-input>
          <wt-button
            variant="primary"
            data-test="generate-code"
            @click=${() => void this.#generateCode()}
            >${t("printers.generate")}</wt-button
          >
        </div>
        ${this.generatedCode !== null ? this.#renderCodePanel(this.generatedCode) : nothing}
      </section>
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
          <wt-input
            label=${t("printers.name")}
            data-test="new-printer-name"
            .value=${this.newPrinterName}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onNewField(e, (v) => (this.newPrinterName = v))}
          ></wt-input>
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
          <label class="field"
            >${t("printers.agent")}
            <select
              ${ref(this.#agentSelect)}
              data-test="new-agent"
              @change=${(e: Event) => this.#onNewAgent(e)}
            >
              <option value="">${t("printers.no_agent")}</option>
              ${this.agents.map((a) => html`<option value=${a.id}>${a.name}</option>`)}
            </select>
          </label>
          <wt-input
            label=${t("printers.host")}
            data-test="new-host"
            .value=${this.newHost}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onNewField(e, (v) => (this.newHost = v))}
          ></wt-input>
          <wt-input
            type="number"
            label=${t("printers.port")}
            data-test="new-port"
            .value=${this.newPort}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onNewField(e, (v) => (this.newPort = v))}
          ></wt-input>
          <wt-input
            label=${t("printers.usb_path")}
            data-test="new-usb-path"
            .value=${this.newUsbPath}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onNewField(e, (v) => (this.newUsbPath = v))}
          ></wt-input>
          <wt-input
            label=${t("printers.poll_id")}
            data-test="new-poll-id"
            .value=${this.newPollId}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              this.#onNewField(e, (v) => (this.newPollId = v))}
          ></wt-input>
          <wt-button
            variant="primary"
            data-test="add-printer"
            @click=${() => void this.#createPrinter()}
            >${t("printers.add_printer")}</wt-button
          >
        </div>
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

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("printers.title")}</h1>
      ${this.#renderAgentsSection()} ${this.#renderPrintersSection()} ${this.#renderJobsSection()}
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
