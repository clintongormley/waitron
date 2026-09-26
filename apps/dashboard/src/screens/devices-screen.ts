import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import { registerCatalogue, type CardProviderPanel, t as tRaw } from "@waitron/dashboard-kit";
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
  ReaderRow,
  Station,
  Till,
} from "../api/client.js";

/**
 * A dashboard-local mirror of `kindOfFormFactor` (`@waitron/layouts`, whose barrel would pull
 * `@waitron/db` into the browser bundle). A `till` binds neither picker: the server creates the
 * register it rings against. The server re-derives this, so it only decides which picker to show.
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

interface HardwareEdit {
  receiptPrinterId: string;
}

const DEFAULT_HARDWARE: HardwareEdit = {
  receiptPrinterId: "",
};

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

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  // Whether an accept is in flight — a second tap on a number while the first is unanswered would
  // race a request the server may already have consumed, so the choices disable until it settles.
  @state() private submitting = false;
  @state() private devices: DeviceRow[] = [];
  @state() private stations: Station[] = [];
  @state() private deviceProfiles: DeviceProfile[] = [];
  @state() private printers: Printer[] = [];
  // A row with no entry opens at DEFAULT_HARDWARE: the device list carries no hardware.
  @state() private hardwareEdits: Record<string, HardwareEdit> = {};
  @state() private readers: ReaderRow[] = [];
  @state() private deviceReaders: Record<string, string | null> = {};
  @state() private tills: Till[] = [];
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];
  @state() private openRequestId: string | null = null;
  @state() private challenges: Record<string, string[]> = {};
  @state() private chosenProfileId = "";
  @state() private chosenStationId = "";
  @state() private chosenRegisterId = "";
  // Separate from `armedRevokeId`, so arming a Deny does not disarm a Revoke in the list below it.
  @state() private armedDenyId: string | null = null;
  @state() private armedRevokeId: string | null = null;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Merge each panel's strings so its `displayNameKey` resolves; this screen never mounts a panel.
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
  }

  /** A native select's `.value` set in the template commits before its options exist, so every select
   * is reconciled here after render. This also snaps a control back to the stored value after a failed
   * reassign or reader change re-renders without a reload. */
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
      '[data-test^="hw-reader-"]',
    )) {
      const id = select.dataset.test!.slice("hw-reader-".length);
      select.value = this.deviceReaders[id] ?? "";
    }
    for (const [testId, value] of [
      ["join-profile", this.chosenProfileId],
      ["join-station", this.chosenStationId],
      ["join-register", this.chosenRegisterId],
    ] as const) {
      const select = this.renderRoot.querySelector<HTMLSelectElement>(`[data-test="${testId}"]`);
      if (select !== null) select.value = value;
    }
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    this.armedDenyId = null;
    try {
      await Promise.all([
        this.#queries.watch("listDevices", [], async (value) => {
          this.devices = value;
          // Each active device's default reader is a PER-DEVICE read (there is no list form), so it
          // is one request per active device, re-run whenever the reactive device list changes.
          const entries = await Promise.all(
            value
              .filter((d) => d.active)
              .map(async (d) => [d.id, (await this.api.getDeviceReader(d.id)).readerId] as const),
          );
          this.deviceReaders = Object.fromEntries(entries);
        }),
        this.#queries.watch("listStations", [], (value) => {
          this.stations = value;
        }),
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.deviceProfiles = value;
        }),
        this.#queries.watch("listPrinters", [], (value) => {
          this.printers = value;
        }),
        this.#queries.watch("listReaders", [], (value) => {
          this.readers = value;
        }),
        this.#queries.watch("listTills", [], (value) => {
          this.tills = value;
        }),
        this.#queries.watch("pairingMode", [], (value) => {
          this.pairing = value;
        }),
        this.#queries.watch("joinRequests", ["device"], (value) => {
          this.pendingJoins = value;
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #reloadJoins(): Promise<void> {
    this.armedDenyId = null;
    const [pairing, pendingJoins] = await Promise.all([
      this.api.pairingMode(),
      this.api.joinRequests("device"),
    ]);
    this.pairing = pairing;
    this.pendingJoins = pendingJoins;
  }

  /** Open and Extend are the same call: the route moves an open window's lapse rather than adding one. */
  async #openPairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.openPairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #closePairing(): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.closePairingMode();
      await this.#reloadJoins();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Fetches the three numbers the FIRST time only: the server fixes the set at join. */
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

  #chosenProfile(): DeviceProfile | undefined {
    return this.deviceProfiles.find((p) => p.id === this.chosenProfileId);
  }

  /** Until this holds the numbers stay untappable, so a tap is never an accept with an unchosen
   * binding. */
  #bindingReady(): boolean {
    const profile = this.#chosenProfile();
    if (profile === undefined) return false;
    const binding = bindingOf(profile.formFactor);
    if (binding === "station") return this.chosenStationId !== "";
    if (binding === "register") return this.chosenRegisterId !== "";
    return true;
  }

  /**
   * A WRONG number is terminal: the server deleted the request before answering
   * `device.join_mismatch`, so the dialog closes. Every other fault names something fixable here, so
   * the dialog stays open for a corrected second tap.
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
      await Promise.all([this.#reloadJoins(), this.#reloadDevices()]);
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

  async #reloadDevices(): Promise<void> {
    this.armedRevokeId = null;
    this.devices = await this.api.listDevices();
  }

  #onRevoke(id: string): void {
    if (this.armedRevokeId === id) {
      this.armedRevokeId = null;
      void this.#revoke(id);
      return;
    }
    this.armedRevokeId = id;
  }

  async #revoke(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.revokeDevice(id);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #onReassign(id: string, deviceProfileId: string | null): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.reassignDeviceProfile(id, deviceProfileId);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #hardwareFor(id: string): HardwareEdit {
    return this.hardwareEdits[id] ?? DEFAULT_HARDWARE;
  }

  #setHardware(id: string, patch: Partial<HardwareEdit>): void {
    this.hardwareEdits = {
      ...this.hardwareEdits,
      [id]: { ...this.#hardwareFor(id), ...patch },
    };
  }

  async #saveHardware(id: string): Promise<void> {
    this.errorKey = null;
    const hw = this.#hardwareFor(id);
    try {
      const updated = await this.api.patchDeviceHardware(id, {
        receiptPrinterId: hw.receiptPrinterId === "" ? null : hw.receiptPrinterId,
      });
      this.hardwareEdits = {
        ...this.hardwareEdits,
        [id]: {
          receiptPrinterId: updated.receiptPrinterId ?? "",
        },
      };
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #panelFor(providerId: string): CardProviderPanel | undefined {
    return this.panels.find((p) => p.providerId === providerId);
  }

  #providerName(providerId: string): string {
    const key = this.#panelFor(providerId)?.displayNameKey;
    return key ? tRaw(key) : providerId;
  }

  #readerLabel(reader: ReaderRow): string {
    return `${reader.name} (${this.#providerName(reader.provider)})`;
  }

  /** Written immediately, not staged. A rejection leaves `deviceReaders` untouched, so `updated()`
   * snaps the control back to the stored default. */
  async #onReaderChange(id: string, value: string): Promise<void> {
    this.errorKey = null;
    const readerId = value === "" ? null : value;
    try {
      await this.api.setDeviceReader(id, readerId);
      this.deviceReaders = { ...this.deviceReaders, [id]: readerId };
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #profileName(deviceProfileId: string | null): string {
    if (deviceProfileId === null) return t("devices.device_profile_none");
    return (
      this.deviceProfiles.find((p) => p.id === deviceProfileId)?.name ??
      t("devices.device_profile_none")
    );
  }

  #stationName(stationId: string | null): string {
    if (stationId === null) return t("devices.no_station");
    return this.stations.find((s) => s.id === stationId)?.name ?? t("devices.no_station");
  }

  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return formatIsoMinute(iso);
  }

  /** The printer list is deliberately not filtered to a location; the server's binding check is the
   * authority. */
  #renderHardware(device: DeviceRow): TemplateResult {
    const activePrinters = this.printers.filter((p) => p.active);
    const activeReaders = this.readers.filter((r) => r.active);
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
      <label class="field"
        >${t("devices.default_reader")}
        <select
          data-test="hw-reader-${device.id}"
          @change=${(e: Event) =>
            void this.#onReaderChange(device.id, (e.target as HTMLSelectElement).value)}
        >
          <option value="">${t("devices.default_reader_none")}</option>
          ${activeReaders.map((r) => html`<option value=${r.id}>${this.#readerLabel(r)}</option>`)}
        </select>
      </label>
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
              ? html`<select
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

  /** The refused-knock count covers `REFUSED_WINDOW_MS` (apps/server/src/pairing-mode.ts), which the
   * copy names as ten minutes; the two move together. */
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

  /** A wrong tap denies the request, so the numbers stay disabled until the binding is complete, and
   * there is no separate Accept: the number IS the accept. */
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
