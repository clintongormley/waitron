import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { formatIsoMinute } from "../date-utils.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  FormFactor,
  JoinRequestRow,
  PairingModeState,
  Printer,
  Station,
  Till,
} from "../api/client.js";

/** The card-payment providers the per-device hardware editor offers, in render order — mirrors the
 * `devices.card_provider` text column's accepted values and the server's `CARD_PROVIDERS` screen. `none`
 * leads (a device with no integrated card terminal, the column default), then the two Stripe
 * integrations: `stripe_terminal` (a separate Stripe Terminal reader, which carries its own reader id)
 * and `stripe_on_device` (Tap to Pay on the device itself, no separate reader id). The server stores
 * the string as-is and re-validates it; the picker constrains the choice to these three. */
const CARD_PROVIDERS: readonly string[] = ["none", "stripe_terminal", "stripe_on_device"];

/**
 * Which binding the accept dialog must ask for, given the chosen profile's form factor. A
 * dashboard-LOCAL mirror of `kindOfFormFactor` (`@waitron/layouts`), which the #70 bundle rule forbids
 * importing here; the switch is exhaustive over `FormFactor`, so a new form factor fails to compile
 * until it gets an answer. A `till` binds NEITHER picker — the server creates the register that device
 * rings against, named after it (`resolveDeviceBinding`, `apps/server/src/device.ts`). The server
 * re-derives all of this from the profile and refuses a missing binding
 * (`device.station_required` / `device.register_required`), so this only decides which picker to show.
 */
function bindingOf(formFactor: FormFactor): "station" | "register" | "none" {
  switch (formFactor) {
    case "kds":
      return "station";
    case "till":
      return "none";
    case "phone-portrait":
    case "tablet-landscape":
      return "register";
  }
}

/** A device's editable hardware, held per row while the operator edits it (before Save). */
interface HardwareEdit {
  receiptPrinterId: string;
  hasCashDrawer: boolean;
  cardProvider: string;
  cardReaderId: string;
}

const DEFAULT_HARDWARE: HardwareEdit = {
  receiptPrinterId: "",
  hasCashDrawer: false,
  cardProvider: "none",
  cardReaderId: "",
};

/**
 * The management dashboard's DEVICES screen: it lets a device in and then manages it, modelled on the
 * kitchen / service-status config screens (their inline list idiom, `@waitron/ui` primitives, `--wt-*`
 * tokens):
 *
 *  - LISTS the enrolled devices (`api.listDevices()`), one `wt-card` row each: the label, the assigned
 *    device profile's NAME (resolved from `api.listDeviceProfiles()` — the list carries only a
 *    `deviceProfileId`), the bound station's display NAME (resolved from `api.listStations()`; a
 *    register-bound device carries no station and shows the neutral placeholder — the list shape carries
 *    no register name), the status (active / revoked) and the last-seen time. Newest-enrolled first is
 *    the server's order, rendered as-is.
 *  - CONTROLS THE VENUE-WIDE PAIRING WINDOW (device-join-and-accept §1.1): nothing may ask to join while
 *    it is shut. Open / Extend are the same idempotent `api.openPairingMode()` call (the route moves an
 *    open window's lapse rather than adding one); `api.closePairingMode()` shuts it. While it is shut the
 *    card shows how many knocks were turned away in the last ten minutes, so an admin looking at a device
 *    that appears broken can see it is waiting to be let in.
 *  - LETS DEVICES IN. `api.joinRequests("device")` is the queue of devices waiting: a name and when they
 *    asked, and NO verification number — the row shape has no such field (design §1.2 rule 1), so the
 *    list cannot show the answer beside the question. Opening a row fetches `api.joinChallenge(id)`,
 *    three shuffled two-digit numbers of which the server does not say which is real, and renders them
 *    as three buttons; the admin taps the one the device is showing, having first chosen the profile and
 *    the binding its form factor calls for. A WRONG tap is terminal for that row — the server has
 *    already denied it — so the dialog closes and the copy says the device must ask again. Deny sits
 *    behind the same two-step confirm as Revoke.
 *  - EDITS a device's static hardware (SP-A.2 §16.3): each ACTIVE row carries a receipt-printer picker
 *    (`api.listPrinters()`), a has-cash-drawer switch, a card-provider picker and — only for a Stripe
 *    Terminal reader — a card-reader-id field, saved through `api.patchDeviceHardware(id, …)`. The edit
 *    is held in component state per row until Save; on success the controls reflect the server's stored
 *    values. (The device list carries no hardware, so an unsaved editor opens at the neutral defaults.)
 *  - REVOKES a device (`api.revokeDevice(id)`) behind a TWO-STEP confirm (the purchase-list idiom), and
 *    REASSIGNS a device's profile (`api.reassignDeviceProfile(id, …)`) via a per-row select. Both controls
 *    show only for ACTIVE devices.
 *
 * Gating is server-side (`device.manage`, admin + manager): the shell hides this nav from a `staff`
 * session and every route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is
 * fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. The raw code stays in state; `codeMessage`
 * maps it to localised copy at the render edge, so the banner shows a sentence and never the raw wire code.
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
      .hardware {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
        margin-top: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
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
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
      }
      .pickers {
        display: flex;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
        margin-bottom: var(--wt-space-4);
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

  // Whether an accept is in flight — a second tap on a number while the first is unanswered would
  // race a request the server may already have consumed, so the choices disable until it settles.
  @state() private submitting = false;
  // The enrolled devices, loaded on connect and re-synced after every mutation (server order kept).
  @state() private devices: DeviceRow[] = [];
  // The venue's ACTIVE kitchen stations — the source that resolves a device row's stationId to a name.
  @state() private stations: Station[] = [];
  // The venue's device profiles (the row's profile name + the reassign picker's options) and printers
  // (the hardware editor's receipt-printer options), (re)loaded alongside the stations.
  @state() private deviceProfiles: DeviceProfile[] = [];
  @state() private printers: Printer[] = [];
  // The per-device hardware being edited, keyed by device id. A row with no entry opens at
  // DEFAULT_HARDWARE (the device list carries no hardware); a Save writes it and refreshes the entry
  // from the server's stored values.
  @state() private hardwareEdits: Record<string, HardwareEdit> = {};
  // The venue's tills — the accept dialog's register picker for a handheld profile.
  @state() private tills: Till[] = [];
  // The pairing window as the server last reported it; undefined until the first read settles.
  @state() private pairing: PairingModeState | undefined;
  // The devices waiting to join, in the server's order. These rows carry NO verification number.
  @state() private pendingJoins: JoinRequestRow[] = [];
  // The request whose accept dialog is open, or null. Single-valued: one dialog at a time, so the
  // dialog's three picks below are single-valued too rather than maps keyed by a row that cannot vary.
  @state() private openRequestId: string | null = null;
  // The three numbers the server offered, per request. CACHED: the set is fixed at join, so reopening
  // a row must show the same three rather than re-asking (design §1.2 rule 2).
  @state() private challenges: Record<string, string[]> = {};
  // The open dialog's picks, reset each time a row is opened.
  @state() private chosenProfileId = "";
  @state() private chosenStationId = "";
  @state() private chosenRegisterId = "";
  // The id of the pending request whose Deny is ARMED, or null — Revoke's two-step confirm, on its own
  // state so arming a Deny does not disarm a Revoke in the list below it.
  @state() private armedDenyId: string | null = null;
  // The id of the device whose Revoke control is ARMED (awaiting a confirming second click), or null.
  // Single-valued, so arming one row disarms any other by construction.
  @state() private armedRevokeId: string | null = null;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Reconcile the per-row native <select>s to their state after every render, once their <option>
   * children are in the DOM — a native select's `.value` set in the template commits before its options
   * exist, so a non-first selection would fall back to the first (the login screen documents the same
   * picker bug). These controls are DYNAMIC (one per device), so they carry no ref — query them and map
   * each back by its `data-test` id. This both preselects and, after a FAILED reassign/save that
   * re-renders without a reload, snaps a control off the operator's rejected pick back to the truth. */
  override updated(): void {
    for (const select of this.renderRoot.querySelectorAll<HTMLSelectElement>(
      '[data-test^="reassign-"]',
    )) {
      const device = this.devices.find((d) => `reassign-${d.id}` === select.dataset.test);
      if (device !== undefined) select.value = device.deviceProfileId ?? "";
    }
    for (const select of this.renderRoot.querySelectorAll<HTMLSelectElement>(
      '[data-test^="hw-printer-"]',
    )) {
      const id = select.dataset.test!.slice("hw-printer-".length);
      select.value = this.#hardwareFor(id).receiptPrinterId;
    }
    for (const select of this.renderRoot.querySelectorAll<HTMLSelectElement>(
      '[data-test^="hw-card-provider-"]',
    )) {
      const id = select.dataset.test!.slice("hw-card-provider-".length);
      select.value = this.#hardwareFor(id).cardProvider;
    }
    // The accept dialog's three pickers, same post-render reconciliation as the selects above: their
    // <option> children are rendered in the same pass, and the binding picker is a DIFFERENT element
    // per form factor, so each control is snapped to what state holds after every render.
    for (const [testId, value] of [
      ["join-profile", this.chosenProfileId],
      ["join-station", this.chosenStationId],
      ["join-register", this.chosenRegisterId],
    ] as const) {
      const select = this.renderRoot.querySelector<HTMLSelectElement>(`[data-test="${testId}"]`);
      if (select !== null) select.value = value;
    }
  }

  /** (Re)load the devices + option feeds. Called on connect and after every mutation. A rejection
   * anywhere becomes the `errorKey` banner rather than an unhandled rejection. Disarms any armed revoke
   * (the armed row may no longer exist). */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    this.armedDenyId = null;
    try {
      const [devices, stations, deviceProfiles, printers, tills, pairing, pendingJoins] =
        await Promise.all([
          this.api.listDevices(),
          this.api.listStations(),
          // This screen is `device.manage`-gated, but four of these feeds are not: `listStations` and
          // `listDeviceProfiles` are `till.configure`-gated (apps/server/src/management-api.ts, the
          // `withVenueAuth` helper and the device-profiles list route), and `listPrinters` /
          // `listTills` are `printer.manage`-gated (apps/server/src/print-api.ts's `gated` helper).
          // The mismatch is unreachable today: all four permissions sit in the {manager, admin} set
          // (`MANAGER` in packages/identity/src/permissions.ts carries `till.configure`,
          // `device.manage` and `printer.manage`; admin holds ALL), so every user who reaches this
          // screen holds them. That is a claim about the ROLE MAP, not about the permissions — if a
          // custom role ever holds `device.manage` alone, these four reject and this screen needs
          // `device.manage`-gated variants of them.
          this.api.listDeviceProfiles(),
          this.api.listPrinters(),
          this.api.listTills(),
          this.api.pairingMode(),
          this.api.joinRequests("device"),
        ]);
      this.devices = devices;
      this.stations = stations;
      this.deviceProfiles = deviceProfiles;
      this.printers = printers;
      this.tills = tills;
      this.pairing = pairing;
      this.pendingJoins = pendingJoins;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Re-read the window and the pending queue after a join-side mutation, WITHOUT the option feeds
   * (which none of those mutations change). Throws like the verbs it calls: every caller runs it
   * inside its own `try/catch` that maps the rejection to the `errorKey` banner. Disarms any armed
   * deny (the armed row may no longer exist). */
  async #reloadJoins(): Promise<void> {
    this.armedDenyId = null;
    const [pairing, pendingJoins] = await Promise.all([
      this.api.pairingMode(),
      this.api.joinRequests("device"),
    ]);
    this.pairing = pairing;
    this.pendingJoins = pendingJoins;
  }

  /** Open the pairing window, or extend an already-open one — the SAME call, because the route moves
   * an open window's lapse to a fresh window from now rather than adding another. */
  async #openPairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.openPairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Shut the window. Requests already pending stay pending and are still acceptable — the window
   * admits an ask, it does not hold one open. */
  async #closePairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.closePairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Open a pending request's accept dialog on a clean set of picks, fetching its three numbers the
   * FIRST time only: the server fixes the set at join, so a second fetch would show the same three and
   * teach nobody anything (design §1.2 rule 2). */
  async #openRequest(id: string): Promise<void> {
    this.errorKey = null;
    this.openRequestId = id;
    this.chosenProfileId = "";
    this.chosenStationId = "";
    this.chosenRegisterId = "";
    if (this.challenges[id] !== undefined) return;
    try {
      const { choices } = await this.api.joinChallenge(id);
      this.challenges = { ...this.challenges, [id]: choices };
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The two-step deny: the first click ARMS `id`, a second on the armed row confirms. Revoke's idiom
   * — denying is not undoable, so the confirm gate is deliberate. */
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

  /** The profile the dialog currently has chosen, or undefined while none is. */
  #chosenProfile(): DeviceProfile | undefined {
    return this.deviceProfiles.find((p) => p.id === this.chosenProfileId);
  }

  /** Whether the dialog holds enough to accept: a profile, plus the binding its form factor calls for.
   * Until it does, the numbers stay untappable — so tapping one is always a decision about the NUMBER
   * and never an accidental accept with an unchosen binding. */
  #bindingReady(): boolean {
    const profile = this.#chosenProfile();
    if (profile === undefined) return false;
    const binding = bindingOf(profile.formFactor);
    if (binding === "station") return this.chosenStationId !== "";
    if (binding === "register") return this.chosenRegisterId !== "";
    return true;
  }

  /**
   * Accept the open request with the number the admin tapped, and the profile and binding they chose.
   *
   * A WRONG number is not a rejected submission: the server DELETED the request before answering
   * `device.join_mismatch` (design §1.2), so that code is terminal for this row — the dialog closes,
   * the queue is re-read without it, and the banner tells the operator the device has to ask again.
   * Every other fault names something fixable here (a station the profile needs, a register that has
   * gone), so the dialog stays open on the same request for a corrected second tap.
   */
  async #accept(request: JoinRequestRow, choice: string): Promise<void> {
    const profile = this.#chosenProfile();
    if (this.submitting || profile === undefined || !this.#bindingReady()) return;
    const binding = bindingOf(profile.formFactor);
    this.errorKey = null;
    this.submitting = true;
    try {
      await this.api.acceptDeviceJoinRequest(request.id, {
        choice,
        profileId: profile.id,
        ...(binding === "station" ? { stationId: this.chosenStationId } : {}),
        ...(binding === "register" ? { registerId: this.chosenRegisterId } : {}),
      });
      this.openRequestId = null;
      await this.#reloadJoins();
      await this.#reloadDevices();
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

  /** Reload the DEVICES only (not the option feeds) after a mutation. `#accept` and `#revoke` change
   * the device set but never the stations/profiles/printers/tills, so re-fetching those — which
   * {@link #load} does — would be pure waste. Throws on failure like `listDevices` itself: every caller
   * runs it inside its own `try/catch` that maps the rejection to the `errorKey` banner. Disarms any
   * armed revoke (mirroring {@link #load}). */
  async #reloadDevices(): Promise<void> {
    this.armedRevokeId = null;
    this.devices = await this.api.listDevices();
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

  /** Revoke the device `id` holds, then reload the device list. A rejection becomes the `errorKey`
   * banner. `#onRevoke` already cleared the armed state before calling this. */
  async #revoke(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.revokeDevice(id);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reassign device `id`'s device profile to `deviceProfileId` (null = the form-factor default), then
   * reload the device list so the row reflects the new binding. A rejection becomes the `errorKey`
   * banner (the `#revoke` idiom). Unlike revoke this is a single-click action — reassigning a profile is
   * reversible (pick another), so no confirm gate. */
  async #onReassign(id: string, deviceProfileId: string | null): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.reassignDeviceProfile(id, deviceProfileId);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The device's hardware being edited (the stored entry, else the neutral defaults). */
  #hardwareFor(id: string): HardwareEdit {
    return this.hardwareEdits[id] ?? DEFAULT_HARDWARE;
  }

  /** Merge a hardware-field change into device `id`'s edit entry (immutably, so Lit re-renders). */
  #setHardware(id: string, patch: Partial<HardwareEdit>): void {
    this.hardwareEdits = {
      ...this.hardwareEdits,
      [id]: { ...this.#hardwareFor(id), ...patch },
    };
  }

  /** Save device `id`'s edited hardware through the PATCH, then reflect the server's stored values in the
   * edit entry so the controls show what actually took. An empty printer / reader clears to `null`; the
   * reader is sent only while the provider is a Stripe Terminal reader (else the field is hidden). A
   * rejection becomes the `errorKey` banner (the `#revoke` idiom). */
  async #saveHardware(id: string): Promise<void> {
    this.errorKey = null;
    const hw = this.#hardwareFor(id);
    try {
      const updated = await this.api.patchDeviceHardware(id, {
        receiptPrinterId: hw.receiptPrinterId === "" ? null : hw.receiptPrinterId,
        hasCashDrawer: hw.hasCashDrawer,
        cardProvider: hw.cardProvider,
        cardReaderId:
          hw.cardProvider === "stripe_terminal" && hw.cardReaderId.trim() !== ""
            ? hw.cardReaderId.trim()
            : null,
      });
      this.hardwareEdits = {
        ...this.hardwareEdits,
        [id]: {
          receiptPrinterId: updated.receiptPrinterId ?? "",
          hasCashDrawer: updated.hasCashDrawer,
          cardProvider: updated.cardProvider,
          cardReaderId: updated.cardReaderId ?? "",
        },
      };
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Resolve a device's `deviceProfileId` to the loaded profile's name; a null id or an unknown profile
   * both fall back to the neutral placeholder. */
  #profileName(deviceProfileId: string | null): string {
    if (deviceProfileId === null) return t("devices.device_profile_none");
    return (
      this.deviceProfiles.find((p) => p.id === deviceProfileId)?.name ??
      t("devices.device_profile_none")
    );
  }

  /** Resolve a device's `stationId` to the loaded station's display name; a null id (a register-bound
   * device) or a station no longer in the active list (retired) both fall back to the placeholder. */
  #stationName(stationId: string | null): string {
    if (stationId === null) return t("devices.no_station");
    return this.stations.find((s) => s.id === stationId)?.name ?? t("devices.no_station");
  }

  /** A device's last-seen ISO timestamp to the minute (`formatIsoMinute`, UTC); a null last-seen (never
   * authenticated) shows the "Never" placeholder. */
  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return formatIsoMinute(iso);
  }

  /** The localised label for a card provider (`none`/`stripe_terminal`/`stripe_on_device`). */
  #cardProviderName(provider: string): string {
    if (provider === "stripe_terminal") return t("devices.card_provider_stripe_terminal");
    if (provider === "stripe_on_device") return t("devices.card_provider_stripe_on_device");
    return t("devices.card_provider_none");
  }

  /** The per-device hardware editor (SP-A.2 §16.3): a receipt-printer picker (the venue's ACTIVE
   * printers plus a "none" clear option), a has-cash-drawer switch, a card-provider picker, a
   * card-reader-id field only when the provider is a Stripe Terminal reader, and a Save that PATCHes.
   * The printer list is DELIBERATELY not filtered to a location (the deli is single-location); the
   * server's own binding check is the authority regardless. */
  #renderHardware(device: DeviceRow): TemplateResult {
    const hw = this.#hardwareFor(device.id);
    const activePrinters = this.printers.filter((p) => p.active);
    return html`<div class="hardware" data-test="hardware-${device.id}">
      <label class="field"
        >${t("devices.receipt_printer")}
        <select
          data-test="hw-printer-${device.id}"
          @change=${(e: Event) =>
            this.#setHardware(device.id, {
              receiptPrinterId: (e.target as HTMLSelectElement).value,
            })}
        >
          <option value="">${t("devices.receipt_printer_none")}</option>
          ${activePrinters.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
      </label>
      <wt-switch
        label=${t("devices.has_cash_drawer")}
        data-test="hw-cash-drawer-${device.id}"
        .checked=${hw.hasCashDrawer}
        @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
          e.stopPropagation();
          this.#setHardware(device.id, { hasCashDrawer: e.detail.checked });
        }}
      ></wt-switch>
      <label class="field"
        >${t("devices.card_provider")}
        <select
          data-test="hw-card-provider-${device.id}"
          @change=${(e: Event) => {
            e.stopPropagation();
            this.#setHardware(device.id, { cardProvider: (e.target as HTMLSelectElement).value });
          }}
        >
          ${CARD_PROVIDERS.map(
            (provider) =>
              html`<option value=${provider}>${this.#cardProviderName(provider)}</option>`,
          )}
        </select>
      </label>
      ${
        hw.cardProvider === "stripe_terminal"
          ? html`<wt-input
              @keydown=${(e: KeyboardEvent) =>
                submitOnEnter(
                  e,
                  this.shadowRoot!.querySelector<HTMLElement>(`[data-test=hw-save-${device.id}]`),
                )}
              label=${t("devices.card_reader")}
              data-test="hw-card-reader-${device.id}"
              .value=${hw.cardReaderId}
              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                e.stopPropagation();
                this.#setHardware(device.id, { cardReaderId: e.detail.value });
              }}
            ></wt-input>`
          : nothing
      }
      <wt-button
        variant="secondary"
        size="sm"
        data-test="hw-save-${device.id}"
        @click=${() => void this.#saveHardware(device.id)}
        >${t("devices.save_hardware")}</wt-button
      >
    </div>`;
  }

  #renderDevice(device: DeviceRow): TemplateResult {
    const armed = this.armedRevokeId === device.id;
    return html`<li data-test="device-row-${device.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="device-label-${device.id}">${device.label}</span>
            <span class="meta">
              <span data-test="device-profile-${device.id}"
                >${this.#profileName(device.deviceProfileId)}</span
              >
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
              ? // The select's live value is reconciled to `device.deviceProfileId` in `updated()` (after
                // its <option> children exist), NOT by a per-option `?selected` attribute — the same
                // post-render pattern the hardware selects use. This is what makes a FAILED reassign snap
                // the control back to the device's actual profile rather than stranding on the rejected pick.
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
                  <option value="">${t("devices.device_profile_none")}</option>
                  ${this.deviceProfiles.map(
                    (profile) => html`<option value=${profile.id}>${profile.name}</option>`,
                  )}
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
        ${device.active ? this.#renderHardware(device) : nothing}
      </wt-card>
    </li>`;
  }

  /** The venue-wide pairing window. While it is OPEN: when it lapses, plus Extend and Close. While it
   * is SHUT: Open, and — only when there were any — how many knocks were turned away in the last ten
   * minutes (`REFUSED_WINDOW_MS`, apps/server/src/pairing-mode.ts, which the copy names; the two move
   * together). The count is composed with `.replace`, as this catalogue has no interpolation. */
  #renderPairing(): TemplateResult {
    const mode = this.pairing;
    if (mode === undefined) return html`<p class="hint">${t("devices.pairing_loading")}</p>`;
    return html`<wt-card data-test="pairing-mode">
      <h2 class="panel-title">${t("devices.pairing_title")}</h2>
      <p class="hint">${t("devices.pairing_hint")}</p>
      ${
        mode.open
          ? html`<p data-test="pairing-until">
                ${t("devices.pairing_open_until").replace(
                  "{time}",
                  mode.openUntil === null ? "" : formatIsoMinute(mode.openUntil),
                )}
              </p>
              <div class="actions">
                <wt-button
                  variant="primary"
                  data-test="pairing-extend"
                  @click=${() => void this.#openPairing()}
                  >${t("devices.pairing_extend")}</wt-button
                >
                <wt-button
                  variant="secondary"
                  data-test="pairing-close"
                  @click=${() => void this.#closePairing()}
                  >${t("devices.pairing_close")}</wt-button
                >
              </div>`
          : html`<div class="actions">
                <wt-button
                  variant="primary"
                  data-test="pairing-open"
                  @click=${() => void this.#openPairing()}
                  >${t("devices.pairing_open")}</wt-button
                >
              </div>
              ${
                mode.refusedRecently > 0
                  ? html`<p class="hint" data-test="pairing-refused">
                      ${t("devices.pairing_refused").replace(
                        "{count}",
                        String(mode.refusedRecently),
                      )}
                    </p>`
                  : nothing
              }`
      }
    </wt-card>`;
  }

  /** One waiting device: the name it asked for and when, plus Let in and the two-step Deny. NO number
   * is rendered here and none is fetched to render it — the row shape has none (design §1.2 rule 1). */
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
            aria-label=${`${t("devices.join_review")} ${request.label}`}
            @click=${() => void this.#openRequest(request.id)}
            >${t("devices.join_review")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="join-deny-${request.id}"
            data-armed=${armed ? "true" : nothing}
            aria-label=${`${armed ? t("devices.join_deny_confirm") : t("devices.join_deny")} ${request.label}`}
            @click=${() => this.#onDeny(request.id)}
            >${armed ? t("devices.join_deny_confirm") : t("devices.join_deny")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  /** The accept dialog's binding picker — a station for a `kds` profile, a register for a handheld,
   * and nothing at all for a till (the server creates the register it rings against). */
  #renderBindingPicker(profile: DeviceProfile): TemplateResult | typeof nothing {
    const binding = bindingOf(profile.formFactor);
    if (binding === "none") return nothing;
    if (binding === "station") {
      return html`<label class="field"
        >${t("devices.station")}
        <select
          data-test="join-station"
          @change=${(e: Event) => (this.chosenStationId = (e.target as HTMLSelectElement).value)}
        >
          <option value="">${t("devices.join_pick_station")}</option>
          ${this.stations.map((station) => html`<option value=${station.id}>${station.name}</option>`)}
        </select>
      </label>`;
    }
    return html`<label class="field"
      >${t("devices.till")}
      <select
        data-test="join-register"
        @change=${(e: Event) => (this.chosenRegisterId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">${t("devices.join_pick_register")}</option>
        ${this.tills.map((till) => html`<option value=${till.id}>${till.label}</option>`)}
      </select>
    </label>`;
  }

  /**
   * The accept dialog: the profile and binding pickers, then the three numbers as three real buttons,
   * each accessibly named ("Number 47", not a bare "47") so the comparison against what the device is
   * showing is a deliberate act. The server does not say which is real, and a wrong tap denies the
   * request — so the buttons stay disabled until the binding is complete, and there is no separate
   * Accept control to press afterwards: the number IS the accept.
   */
  #renderAcceptDialog(): TemplateResult | typeof nothing {
    const request = this.pendingJoins.find((r) => r.id === this.openRequestId);
    if (request === undefined) return nothing;
    const choices = this.challenges[request.id];
    const profile = this.#chosenProfile();
    const ready = this.#bindingReady();
    return html`<wt-dialog
      data-test="join-dialog"
      heading=${t("devices.join_dialog_title")}
      .open=${true}
      @wt-close=${() => (this.openRequestId = null)}
    >
      <p class="label" data-test="join-dialog-label">${request.label}</p>
      <div class="pickers">
        <label class="field"
          >${t("devices.device_profile")}
          <select
            data-test="join-profile"
            @change=${(e: Event) => {
              this.chosenProfileId = (e.target as HTMLSelectElement).value;
              this.chosenStationId = "";
              this.chosenRegisterId = "";
            }}
          >
            <option value="">${t("devices.join_pick_profile")}</option>
            ${this.deviceProfiles.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
          </select>
        </label>
        ${profile === undefined ? nothing : this.#renderBindingPicker(profile)}
      </div>
      ${
        choices === undefined
          ? html`<p class="hint">${t("devices.join_loading")}</p>`
          : html`<p id="join-match-prompt">${t("devices.join_match_prompt")}</p>
              ${ready ? nothing : html`<p class="hint">${t("devices.join_pick_first")}</p>`}
              <div class="choices" role="group" aria-labelledby="join-match-prompt">
                ${choices.map(
                  // `size="lg"`: the number has to be legible from where the admin is standing,
                  // against a device across the room — that is the whole job of a two-digit code.
                  (number) =>
                    html`<wt-button
                      variant="secondary"
                      size="lg"
                      data-choice=${number}
                      ?disabled=${!ready || this.submitting}
                      aria-label=${t("devices.join_choice_label").replace("{number}", number)}
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

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("devices.title")}</h1>
      <section data-test="pairing-panel">${this.#renderPairing()}</section>

      <section data-test="join-panel">
        <h2 class="panel-title">${t("devices.join_waiting_title")}</h2>
        ${
          this.pendingJoins.length === 0
            ? html`<p class="empty" data-test="no-join-requests">${t("devices.join_none")}</p>`
            : html`<ol>
                ${this.pendingJoins.map((request) => this.#renderJoinRequest(request))}
              </ol>`
        }
      </section>

      <section data-test="devices-panel">
        ${
          this.devices.length === 0
            ? html`<p class="empty" data-test="no-devices">${t("devices.no_devices")}</p>`
            : html`<ol>
                ${this.devices.map((device) => this.#renderDevice(device))}
              </ol>`
        }
      </section>

      ${this.#renderAcceptDialog()}
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
