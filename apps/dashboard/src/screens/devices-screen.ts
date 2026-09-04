import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { Canvas, DashboardApi, DeviceRow, Printer, Station, Till } from "../api/client.js";

/** The card-payment providers the till-hardware picker offers, in render order — mirrors the
 * `devices.card_provider` text column's accepted values. `none` leads (a till with no integrated card
 * terminal, the column default), then the two Stripe integrations: `stripe_terminal` (a separate
 * Stripe Terminal reader, which carries its own reader id) and `stripe_on_device` (Tap to Pay on the
 * device itself, no separate reader id). The server stores the string as-is; the picker constrains the
 * choice to these three. */
const CARD_PROVIDERS: readonly string[] = ["none", "stripe_terminal", "stripe_on_device"];

/**
 * The management dashboard's DEVICES screen (device-identity-1 §5b): manages the venue's always-on
 * enrolled devices — today the KDS station displays. It does three things, modelled on the kitchen /
 * service-status config screens (their inline list + "new" form idiom, `@waitron/ui` primitives, `--wt-*`
 * tokens):
 *
 *  - LISTS the enrolled devices (`api.listDevices()`), one `wt-card` row each: the label, the bound
 *    station's display NAME (resolved from `api.listStations()` — the list carries only a `stationId`),
 *    the status (active / revoked) and the last-seen time. Newest-enrolled first is the server's order,
 *    rendered as-is. A null `stationId` (a future non-station kind) and a station no longer in the active
 *    list (retired) both show a neutral placeholder; a never-authenticated device shows a "Never"
 *    last-seen.
 *  - GENERATES a pairing code: pick a kind + the kind's bindings + type a label → `api.createDeviceCode(…)`
 *    (SP-A.2 unified the counter till into the device model). The kind gates the REQUIRED binding: a
 *    `kds_station` binds to a picked station (`stationId` sent); a sale-capable `till`/`handheld` binds to
 *    a picked till (`tillId` sent — the server rejects a missing one `device.till_required`), so a station
 *    picker shows only for `kds_station` and a till picker for `till`/`handheld`. The OPTIONAL bindings are
 *    an assigned canvas (`canvasId`, offered for every kind from `api.listCanvases()`) and,
 *    for a `till`, the static hardware — a receipt printer (`api.listPrinters()`), a has-cash-drawer flag,
 *    a card provider (`none`/`stripe_terminal`/`stripe_on_device`) and, for `stripe_terminal`, a
 *    card-reader id — each sent only when set, else the server applies its column default. The returned
 *    code is shown ONCE in a prominent, copyable panel and lives ONLY in component state — it is NOT
 *    re-fetchable (like a passkey challenge handle), so dismissing the panel is final. Generating reloads
 *    the device list.
 *  - REVOKES a device (`api.revokeDevice(id)`) behind a TWO-STEP confirm (the purchase-list idiom): the
 *    first click on a row's Revoke ARMS it (label → confirm prompt), a second click confirms — a revoke
 *    stops a working kitchen screen, so an accidental single click must not fire it. Only ACTIVE devices
 *    show the control; an already-revoked one does not.
 *
 * Gating is server-side (`device.manage`, admin + manager): the shell hides this nav from a `staff`
 * session and every route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is
 * fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. The raw code stays in state; `codeMessage`
 * maps it to localised copy at the render edge, so the banner shows a sentence and never the raw wire code
 * (`station.not_found`, `device.not_found`).
 */
@customElement("dashboard-devices-screen")
export class DevicesScreen extends LitElement {
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
        margin: 0 0 var(--wt-space-3);
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
        align-items: center;
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
        margin-top: var(--wt-space-6);
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

  // The enrolled devices, loaded on connect and re-synced after every mutation (server order kept).
  @state() private devices: DeviceRow[] = [];
  // The venue's ACTIVE kitchen stations — both the generate-code picker's options and the source that
  // resolves a device row's stationId to a display name.
  @state() private stations: Station[] = [];
  // The venue's tills (the sale-capable till picker's options), canvases (the assigned-canvas
  // picker's options, any kind) and printers (the till's receipt-printer picker's options), all
  // (re)loaded alongside the stations. Feeds for the generate-code form's bindings (SP-A.2 §16).
  @state() private tills: Till[] = [];
  @state() private canvases: Canvas[] = [];
  @state() private printers: Printer[] = [];
  // The generate-code form's fields. `kind` gates which bindings show: a "kds_station" binds to a
  // station; a sale-capable "till"/"handheld" binds to a till (REQUIRED); a "till" also carries the
  // static hardware bindings. The picked station/till seed to the first on load; the optional bindings
  // default to "unset" ("" / false / "none") and are sent only when set.
  @state() private kind = "kds_station";
  @state() private selectedStation = "";
  @state() private selectedTill = "";
  @state() private selectedCanvas = "";
  @state() private selectedPrinter = "";
  @state() private hasCashDrawer = false;
  @state() private cardProvider = "none";
  @state() private cardReaderId = "";
  @state() private label = "";
  // The one-time pairing code, held ONLY here — never re-fetchable. null when no code is being shown.
  @state() private generatedCode: string | null = null;
  // Whether the shown code has just been copied (a transient confirmation next to the Copy button).
  @state() private copied = false;
  // The id of the device whose Revoke control is ARMED (awaiting a confirming second click), or null.
  // Single-valued, so arming one row disarms any other by construction.
  @state() private armedRevokeId: string | null = null;
  @state() private errorKey: string | null = null;

  // Handles to the native <select>s, reconciled to their state in `updated()` — a native select's
  // `.value` bound in the template commits before its <option> children exist, so a non-first selection
  // would fall back to the first (the login screen documents the same picker bug). Each is rendered only
  // for the kind that shows it, so `updated()` GUARDS every ref access (a ref is undefined when its
  // select is not in the DOM).
  #stationSelect = createRef<HTMLSelectElement>();
  #tillSelect = createRef<HTMLSelectElement>();
  #canvasSelect = createRef<HTMLSelectElement>();
  #printerSelect = createRef<HTMLSelectElement>();
  #cardProviderSelect = createRef<HTMLSelectElement>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Reconcile the native station <select>'s live value to `selectedStation` after every render, once its
   * <option> children are in the DOM (mirrors login-screen). The select renders unconditionally, so the
   * ref is normally live — but GUARD the access anyway: when the shell re-keys this screen to repaint it
   * in a new language (`dashboard-app`'s `keyed(currentLocale(), …)`), a pending update can flush on the outgoing
   * element after Lit has cleared its refs on disconnect, and an unguarded assert would then throw an
   * unhandled `Cannot set properties of undefined`. Setting `.value` imperatively does not loop. */
  override updated(): void {
    if (this.#stationSelect.value) this.#stationSelect.value.value = this.selectedStation;
    if (this.#tillSelect.value) this.#tillSelect.value.value = this.selectedTill;
    if (this.#canvasSelect.value) this.#canvasSelect.value.value = this.selectedCanvas;
    if (this.#printerSelect.value) this.#printerSelect.value.value = this.selectedPrinter;
    if (this.#cardProviderSelect.value) this.#cardProviderSelect.value.value = this.cardProvider;
    // Reconcile every per-row reassign <select> to its device's ACTUAL binding (server truth). These are
    // dynamic (one per device), so they carry no ref — query them and map each back by its `data-test` id.
    // This both preselects (options now exist) and, after a FAILED reassign that re-renders without a
    // reload, snaps the control off the operator's rejected pick back to `device.canvasId`.
    for (const select of this.renderRoot.querySelectorAll<HTMLSelectElement>(
      '[data-test^="reassign-"]',
    )) {
      const device = this.devices.find((d) => `reassign-${d.id}` === select.dataset.test);
      if (device !== undefined) select.value = device.canvasId ?? "";
    }
  }

  /** (Re)load the devices + stations. Called on connect and after every mutation. A rejection anywhere
   * becomes the `errorKey` banner rather than an unhandled rejection. Disarms any armed revoke (the armed
   * row may no longer exist) and seeds the station picker to the first station when it is still unset (so
   * an operator's own pick survives a reload). */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    try {
      const [devices, stations, tills, canvases, printers] = await Promise.all([
        this.api.listDevices(),
        this.api.listStations(),
        // The generate form's binding feeds. `listTills`/`listPrinters` are `printer.manage`-gated and
        // `listCanvases` is `till.configure`-gated, whereas this screen is `device.manage`-gated — but
        // that mismatch is unreachable: all three permissions sit in the {manager, admin} set
        // (packages/identity/src/permissions.ts; admin holds ALL), so every user who reaches this screen
        // holds them (the printers-screen documents the same reuse). A custom-role split is a documented
        // follow-on — no device.manage-gated list variants (YAGNI).
        this.api.listTills(),
        this.api.listCanvases(),
        this.api.listPrinters(),
      ]);
      this.devices = devices;
      this.stations = stations;
      this.tills = tills;
      this.canvases = canvases;
      this.printers = printers;
      // Seed the station + till pickers to their first option when still unset, so an operator's own
      // pick survives a reload (mirrors the station seed; the till is REQUIRED for sale-capable kinds).
      if (stations[0] !== undefined && this.selectedStation === "") {
        this.selectedStation = stations[0].id;
      }
      if (tills[0] !== undefined && this.selectedTill === "") {
        this.selectedTill = tills[0].id;
      }
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload the DEVICES only (not the stations) after a mutation. `#generate` and `#revoke` change the
   * device set but never the station set, so re-fetching `listStations` — which the initial {@link #load}
   * does — would be pure waste; this fetches `listDevices` alone. It throws on failure like `listDevices`
   * itself: both callers already run it inside their own `try/catch` that maps the rejection to the
   * `errorKey` banner via `codeOf` (the error-envelope pattern), so there is no separate handling here.
   * Disarms any armed revoke (mirroring {@link #load}): the armed row may no longer exist after the
   * mutation, and a `#generate` while a revoke is armed on another row must not leave it armed — a no-op
   * for the `#revoke` path, which {@link #onRevoke} already cleared before calling. */
  async #reloadDevices(): Promise<void> {
    this.armedRevokeId = null;
    this.devices = await this.api.listDevices();
  }

  /** Capture the picked device kind — the value the whole add-device form surfaces its per-kind fields
   * off. A `kds_station` shows the station field; `till`/`handheld` show the till field (:617); `till`
   * additionally surfaces the hardware fields (:641, via {@link #renderTillHardware}). #generate gates
   * the station requirement on this value. Same defensive `stopPropagation` as the station picker. */
  #onKindChange(event: Event): void {
    event.stopPropagation();
    this.kind = (event.target as HTMLSelectElement).value;
  }

  /** Capture the picked station. A native `<select>` `change` is `composed: false`, so `stopPropagation`
   * here is defensive consistency with the composed `wt-change` handler below, not a boundary guard. */
  #onStationChange(event: Event): void {
    event.stopPropagation();
    this.selectedStation = (event.target as HTMLSelectElement).value;
  }

  /** Capture the picked till (sale-capable kinds). Same defensive `stopPropagation` as the station picker. */
  #onTillChange(event: Event): void {
    event.stopPropagation();
    this.selectedTill = (event.target as HTMLSelectElement).value;
  }

  /** Capture the picked assigned canvas (`""` = none). */
  #onCanvasChange(event: Event): void {
    event.stopPropagation();
    this.selectedCanvas = (event.target as HTMLSelectElement).value;
  }

  /** Capture the picked receipt printer for a till (`""` = none). */
  #onPrinterChange(event: Event): void {
    event.stopPropagation();
    this.selectedPrinter = (event.target as HTMLSelectElement).value;
  }

  /** Capture the picked card provider (`none`/`stripe_terminal`/`stripe_on_device`). The card-reader-id
   * field shows only for `stripe_terminal`; switching away hides it (and `#generate` then sends no id). */
  #onCardProviderChange(event: Event): void {
    event.stopPropagation();
    this.cardProvider = (event.target as HTMLSelectElement).value;
  }

  /** Capture the has-cash-drawer switch's composed `wt-change` (`{ checked }`). */
  #onCashDrawerChange(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.hasCashDrawer = event.detail.checked;
  }

  /** The card-reader-id field's composed `wt-change`. `stopPropagation` keeps it inside this shadow. */
  #onCardReaderChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.cardReaderId = event.detail.value;
  }

  /** The label field's composed `wt-change`. `stopPropagation` keeps it inside this screen's shadow. */
  #onLabelChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.label = event.detail.value;
  }

  /** Mint a pairing code for the chosen kind + bindings + label, then show it ONCE and reload the list.
   * A blank label is a no-op (the kitchen screen's blank-name guard). The kind gates the required
   * binding: a `kds_station` needs a picked station (no-op when none configured); a sale-capable
   * `till`/`handheld` needs a picked till (no-op when none configured — the server rejects a missing one
   * `device.till_required`). The optional bindings are sent ONLY when set — an assigned canvas
   * (any kind), and for a `till` the static hardware (receipt printer, cash-drawer flag, card provider,
   * and the card-reader id when the provider is `stripe_terminal`); an unset binding is omitted, which
   * `JSON.stringify` drops, so the server applies its column default. On success the code goes into
   * state (never re-fetched) and the label resets; on rejection the `errorKey` banner shows and the form
   * is left intact for a retry. */
  async #generate(): Promise<void> {
    this.errorKey = null;
    const label = this.label.trim();
    if (label === "") return;
    const needsStation = this.kind === "kds_station";
    const needsTill = this.kind === "till" || this.kind === "handheld";
    if (needsStation && this.selectedStation === "") return;
    if (needsTill && this.selectedTill === "") return;
    // Build the payload additively so an unset optional binding is absent (dropped by `JSON.stringify`),
    // not sent as an empty string the server would treat as a real value.
    const input: {
      kind: string;
      stationId?: string;
      tillId?: string;
      canvasId?: string;
      receiptPrinterId?: string;
      hasCashDrawer?: boolean;
      cardProvider?: string;
      cardReaderId?: string;
      label: string;
    } = { kind: this.kind, label };
    if (needsStation) input.stationId = this.selectedStation;
    if (needsTill) input.tillId = this.selectedTill;
    // The assigned canvas is a device-wide binding, offered for every kind; sent only when picked.
    if (this.selectedCanvas !== "") input.canvasId = this.selectedCanvas;
    // The static hardware bindings belong to a `till`; each is sent only when set (else the server
    // default applies: no printer, `has_cash_drawer` false, `card_provider` 'none').
    if (this.kind === "till") {
      if (this.selectedPrinter !== "") input.receiptPrinterId = this.selectedPrinter;
      if (this.hasCashDrawer) input.hasCashDrawer = true;
      if (this.cardProvider !== "none") input.cardProvider = this.cardProvider;
      // The card-reader id is a `stripe_terminal`-only field; a non-empty value is sent only while that
      // provider is picked (switching away hides the field, so a stale id is never sent).
      if (this.cardProvider === "stripe_terminal" && this.cardReaderId.trim() !== "") {
        input.cardReaderId = this.cardReaderId.trim();
      }
    }
    try {
      const { code } = await this.api.createDeviceCode(input);
      this.generatedCode = code;
      this.copied = false;
      this.label = "";
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
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

  /** The two-step revoke: the first click ARMS `id`, a second click on the armed row confirms and revokes.
   * Arming another row disarms the first (single-valued state). A revoke stops a working device, so the
   * confirm gate is deliberate. */
  #onRevoke(id: string): void {
    if (this.armedRevokeId === id) {
      this.armedRevokeId = null;
      void this.#revoke(id);
      return;
    }
    this.armedRevokeId = id;
  }

  /** Revoke the device `id` holds, then reload the device list (the station set is unchanged). A
   * rejection becomes the `errorKey` banner. `#onRevoke` already cleared the armed state before calling
   * this, so the devices-only reload needs no disarm. */
  async #revoke(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.revokeDevice(id);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reassign device `id`'s canvas to `canvasId` (null = the form-factor default), then
   * reload the device list (the station set is unchanged) so the row reflects the new binding. A rejection
   * becomes the `errorKey` banner (the `#revoke` idiom); the caller void-invokes this off the select's
   * `change`, so a rejection surfaces as the banner rather than an unhandled rejection. Unlike revoke this
   * is a single-click action — reassigning a canvas is reversible (pick another), so no confirm gate. */
  async #onReassign(id: string, canvasId: string | null): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.reassignDevice(id, canvasId);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Resolve a device's `stationId` to the loaded station's display name; a null id (a future non-station
   * kind) or a station no longer in the active list (retired) both fall back to the neutral placeholder. */
  #stationName(stationId: string | null): string {
    if (stationId === null) return t("devices.no_station");
    return this.stations.find((s) => s.id === stationId)?.name ?? t("devices.no_station");
  }

  /** Format a device's last-seen ISO timestamp to the minute (UTC — no per-venue timezone yet, matching
   * date-utils' UTC slicing); a null last-seen (never authenticated) shows the "Never" placeholder. */
  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }

  /** The localised label for a card provider (`none`/`stripe_terminal`/`stripe_on_device`). */
  #cardProviderName(provider: string): string {
    if (provider === "stripe_terminal") return t("devices.card_provider_stripe_terminal");
    if (provider === "stripe_on_device") return t("devices.card_provider_stripe_on_device");
    return t("devices.card_provider_none");
  }

  /** The `till` kind's static hardware bindings (SP-A.2 §16): a receipt-printer picker (the venue's
   * ACTIVE printers plus a "none" clear option), a has-cash-drawer switch, a card-provider picker, and —
   * only when the provider is a Stripe Terminal reader — a card-reader-id field. All optional: an unset
   * one is not sent and the server applies its column default. The printer list is DELIBERATELY not
   * filtered to the till's location (the deli is single-location, so every printer is in it); the
   * server's own binding check is the authority regardless. */
  #renderTillHardware(): TemplateResult {
    const activePrinters = this.printers.filter((p) => p.active);
    return html`<label class="field"
        >${t("devices.receipt_printer")}
        <select
          ${ref(this.#printerSelect)}
          data-test="receipt-printer-select"
          @change=${(e: Event) => this.#onPrinterChange(e)}
        >
          <option value="">${t("devices.receipt_printer_none")}</option>
          ${activePrinters.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
      </label>
      <wt-switch
        label=${t("devices.has_cash_drawer")}
        data-test="cash-drawer-switch"
        .checked=${this.hasCashDrawer}
        @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onCashDrawerChange(e)}
      ></wt-switch>
      <label class="field"
        >${t("devices.card_provider")}
        <select
          ${ref(this.#cardProviderSelect)}
          data-test="card-provider-select"
          @change=${(e: Event) => this.#onCardProviderChange(e)}
        >
          ${CARD_PROVIDERS.map(
            (provider) =>
              html`<option value=${provider}>${this.#cardProviderName(provider)}</option>`,
          )}
        </select>
      </label>
      ${
        this.cardProvider === "stripe_terminal"
          ? html`<wt-input
              label=${t("devices.card_reader")}
              data-test="card-reader-id"
              .value=${this.cardReaderId}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onCardReaderChange(e)}
            ></wt-input>`
          : nothing
      }`;
  }

  #renderDevice(device: DeviceRow): TemplateResult {
    const armed = this.armedRevokeId === device.id;
    return html`<li data-test="device-row-${device.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="device-label-${device.id}">${device.label}</span>
            <span class="meta">
              <span data-test="device-station-${device.id}"
                >${this.#stationName(device.stationId)}</span
              >
              <span data-test="device-status-${device.id}"
                >${device.active ? t("devices.status_active") : t("devices.status_revoked")}</span
              >
              <span data-test="device-last-seen-${device.id}"
                >${this.#lastSeen(device.lastSeenAt)}</span
              >
            </span>
          </div>
          ${
            device.active
              ? // The select's live value is reconciled to `device.canvasId` in `updated()` (after
                // its <option> children exist), NOT by a per-option `?selected` attribute — the same
                // post-render pattern the enrol-form selects use. This is what makes a FAILED reassign snap
                // the control back to the device's actual canvas (the re-render runs `updated()` again)
                // rather than stranding on the operator's rejected pick; `?selected` never resets the live
                // `.selected` property once the operator has interacted.
                html`<select
                  data-test="reassign-${device.id}"
                  aria-label=${`${t("devices.reassign")} ${device.label}`}
                  @change=${(e: Event) =>
                    void this.#onReassign(
                      device.id,
                      (e.target as HTMLSelectElement).value === ""
                        ? null
                        : (e.target as HTMLSelectElement).value,
                    )}
                >
                  <option value="">${t("devices.canvas_none")}</option>
                  ${this.canvases.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
                </select>`
              : nothing
          }
          ${
            device.active
              ? html`<wt-button
                  variant="danger"
                  size="sm"
                  data-test="revoke-${device.id}"
                  data-armed=${armed ? "true" : nothing}
                  aria-label=${`${armed ? t("devices.revoke_confirm") : t("devices.revoke")} ${device.label}`}
                  @click=${() => this.#onRevoke(device.id)}
                  >${armed ? t("devices.revoke_confirm") : t("devices.revoke")}</wt-button
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
      aria-label=${t("devices.code_title")}
    >
      <h2 class="panel-title">${t("devices.code_title")}</h2>
      <p class="code-hint">${t("devices.code_hint")}</p>
      <code class="code-value" data-test="code-value">${code}</code>
      <div class="code-actions">
        <wt-button
          variant="secondary"
          data-test="copy-code"
          @click=${() => void this.#copyCode(code)}
          >${t("devices.copy")}</wt-button
        >
        <wt-button variant="ghost" data-test="dismiss-code" @click=${() => this.#dismissCode()}
          >${t("devices.done")}</wt-button
        >
        ${
          this.copied
            ? html`<span class="copied" role="status" data-test="copied"
                >${t("devices.copied")}</span
              >`
            : nothing
        }
      </div>
    </section>`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("devices.title")}</h1>
      <section data-test="devices-panel">
        ${
          this.devices.length === 0
            ? html`<p class="empty" data-test="no-devices">${t("devices.no_devices")}</p>`
            : html`<ol>
                ${this.devices.map((device) => this.#renderDevice(device))}
              </ol>`
        }
      </section>

      <section>
        <h2 class="panel-title">${t("devices.generate_title")}</h2>
        <div class="new">
          <label class="field"
            >${t("devices.kind")}
            <select data-test="kind-select" @change=${(e: Event) => this.#onKindChange(e)}>
              <option value="kds_station">${t("devices.kind_kds_station")}</option>
              <option value="till">${t("devices.kind_till")}</option>
              <option value="handheld">${t("devices.kind_handheld")}</option>
            </select>
          </label>
          ${
            this.kind === "kds_station"
              ? html`<label class="field"
                  >${t("devices.station")}
                  <select
                    ${ref(this.#stationSelect)}
                    data-test="station-select"
                    @change=${(e: Event) => this.#onStationChange(e)}
                  >
                    ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                  </select>
                </label>`
              : nothing
          }
          ${
            this.kind === "till" || this.kind === "handheld"
              ? html`<label class="field"
                  >${t("devices.till")}
                  <select
                    ${ref(this.#tillSelect)}
                    data-test="till-select"
                    @change=${(e: Event) => this.#onTillChange(e)}
                  >
                    ${this.tills.map((till) => html`<option value=${till.id}>${till.label}</option>`)}
                  </select>
                </label>`
              : nothing
          }
          <label class="field"
            >${t("devices.canvas")}
            <select
              ${ref(this.#canvasSelect)}
              data-test="canvas-select"
              @change=${(e: Event) => this.#onCanvasChange(e)}
            >
              <option value="">${t("devices.canvas_none")}</option>
              ${this.canvases.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </label>
          ${this.kind === "till" ? this.#renderTillHardware() : nothing}
          <wt-input
            label=${t("devices.label")}
            data-test="code-label"
            .value=${this.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLabelChange(e)}
          ></wt-input>
          <wt-button variant="primary" data-test="generate" @click=${() => void this.#generate()}
            >${t("devices.generate")}</wt-button
          >
        </div>
        ${this.generatedCode !== null ? this.#renderCodePanel(this.generatedCode) : nothing}
      </section>

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
    "dashboard-devices-screen": DevicesScreen;
  }
}
