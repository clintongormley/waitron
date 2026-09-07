import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { formatIsoMinute } from "../date-utils.js";
import type { DashboardApi, DeviceProfile, DeviceRow, Printer, Station } from "../api/client.js";

/** The card-payment providers the per-device hardware editor offers, in render order — mirrors the
 * `devices.card_provider` text column's accepted values and the server's `CARD_PROVIDERS` screen. `none`
 * leads (a device with no integrated card terminal, the column default), then the two Stripe
 * integrations: `stripe_terminal` (a separate Stripe Terminal reader, which carries its own reader id)
 * and `stripe_on_device` (Tap to Pay on the device itself, no separate reader id). The server stores
 * the string as-is and re-validates it; the picker constrains the choice to these three. */
const CARD_PROVIDERS: readonly string[] = ["none", "stripe_terminal", "stripe_on_device"];

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
 * The management dashboard's DEVICES screen (device-identity-1 §5b): manages the venue's enrolled
 * devices. It does four things, modelled on the kitchen / service-status config screens (their inline
 * list idiom, `@waitron/ui` primitives, `--wt-*` tokens):
 *
 *  - LISTS the enrolled devices (`api.listDevices()`), one `wt-card` row each: the label, the assigned
 *    device profile's NAME (resolved from `api.listDeviceProfiles()` — the list carries only a
 *    `deviceProfileId`), the bound station's display NAME (resolved from `api.listStations()`; a
 *    register-bound device carries no station and shows the neutral placeholder — the list shape carries
 *    no register name), the status (active / revoked) and the last-seen time. Newest-enrolled first is
 *    the server's order, rendered as-is.
 *  - GENERATES an enrolment key: one button → `api.createDeviceCode()` (NO body — the code is a bare
 *    bearer token now; the device describes itself at enrolment). The returned code is shown ONCE in a
 *    prominent, copyable panel and lives ONLY in component state — it is NOT re-fetchable (like a passkey
 *    challenge handle), so dismissing the panel is final. Generating reloads the device list.
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
      .generate {
        margin-top: var(--wt-space-2);
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

  // Whether an enrolment-key mint is in flight (disables the generate button).
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
  // The one-time enrolment key, held ONLY here — never re-fetchable. null when no code is being shown.
  @state() private generatedCode: string | null = null;
  // Whether the shown code has just been copied (a transient confirmation next to the Copy button).
  @state() private copied = false;
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
  }

  /** (Re)load the devices + option feeds. Called on connect and after every mutation. A rejection
   * anywhere becomes the `errorKey` banner rather than an unhandled rejection. Disarms any armed revoke
   * (the armed row may no longer exist). */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    try {
      const [devices, stations, deviceProfiles, printers] = await Promise.all([
        this.api.listDevices(),
        this.api.listStations(),
        // `listDeviceProfiles` is `till.configure`-gated and `listPrinters` is `printer.manage`-gated,
        // whereas this screen is `device.manage`-gated — but that mismatch is unreachable: all three
        // permissions sit in the {manager, admin} set (packages/identity/src/permissions.ts; admin holds
        // ALL), so every user who reaches this screen holds them (the printers-screen documents the same
        // reuse). A custom-role split is a documented follow-on — no device.manage-gated list variants.
        this.api.listDeviceProfiles(),
        this.api.listPrinters(),
      ]);
      this.devices = devices;
      this.stations = stations;
      this.deviceProfiles = deviceProfiles;
      this.printers = printers;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload the DEVICES only (not the option feeds) after a mutation. `#generate` and `#revoke` change
   * the device set but never the stations/profiles/printers, so re-fetching those — which {@link #load}
   * does — would be pure waste. Throws on failure like `listDevices` itself: both callers run it inside
   * their own `try/catch` that maps the rejection to the `errorKey` banner. Disarms any armed revoke
   * (mirroring {@link #load}). */
  async #reloadDevices(): Promise<void> {
    this.armedRevokeId = null;
    this.devices = await this.api.listDevices();
  }

  /** Mint an enrolment key (a bare token — no body) then show it ONCE and reload the list. On success
   * the code goes into state (never re-fetched); on rejection the `errorKey` banner shows. */
  async #generate(): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    this.submitting = true;
    try {
      const { code } = await this.api.createDeviceCode();
      this.generatedCode = code;
      this.copied = false;
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
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
        <div class="generate">
          <wt-button
            variant="primary"
            data-test="generate"
            ?disabled=${this.submitting}
            @click=${() => void this.#generate()}
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
