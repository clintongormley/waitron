import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  type DataTableColumn,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { PairingHold, type PairingHoldStatus } from "../api/pairing-hold.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { holdNotice, holdNoticeStyles } from "../widgets/hold-notice.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import { registerCatalogue, type CardProviderPanel, t as tRaw } from "@waitron/dashboard-kit";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { formatIsoMinute } from "../date-utils.js";
import { printerLabel } from "../i18n/domain.js";
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
  Watcher,
} from "../api/client.js";

type PairField = "name" | "profile" | "binding";

/** Refusals of a pairing that are about one settings field (CLAUDE.md §3: by what the error carries). */
const PAIR_FIELD_BY_CODE: Record<string, PairField> = {
  "device.name_taken": "name",
  "device.station_required": "binding",
  "station.not_found": "binding",
  "watcher.not_found": "binding",
  "device_profile.not_found": "profile",
};

const PAIR_FIELD_BY_PARAM: Record<string, PairField> = {
  name: "name",
  profileId: "profile",
  stationId: "binding",
  watcherId: "binding",
};

/**
 * Whether a joining device of this form factor binds a station or watcher: only a `kds` screen does.
 * The server re-derives this, so it only decides whether to show the picker.
 */
function bindsStation(formFactor: FormFactor): boolean {
  return formFactor === "kds";
}

@customElement("dashboard-devices-screen")
export class DevicesScreen extends LitElement {
  static override styles = [
    baseStyles,
    holdNoticeStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin: 0 0 var(--wt-space-4);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .qr {
        display: block;
        width: calc(var(--wt-space-6) * 6);
        max-width: 100%;
        height: auto;
        margin: 0 0 var(--wt-space-3);
      }
      .hint code {
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
      }
      .waiting {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
      }
      .added {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(being-paired) {
        color: var(--wt-color-text-muted);
      }
      .pair-fields {
        display: grid;
        gap: var(--wt-space-3);
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
      .hardware wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }
      .printers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin: 0;
      }
      .printers dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .printers dd {
        margin: 0;
        color: var(--wt-color-text);
      }
      .made-here {
        margin: var(--wt-space-3) 0 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .made-here legend {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .made-here .check {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-2);
      }
      .hint {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
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
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  @state() private devices: DeviceRow[] = [];
  @state() private stations: Station[] = [];
  @state() private watchers: Watcher[] = [];
  @state() private deviceProfiles: DeviceProfile[] = [];
  @state() private printers: Printer[] = [];
  @state() private readers: ReaderRow[] = [];
  @state() private deviceReaders: Record<string, string | null> = {};
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];

  /** Seen by a test, so it can check what the code encodes. */
  @property({ attribute: false }) qrFor = (text: string): Promise<string> =>
    toDataURL(text, { margin: 1, width: 192 });

  @state() private addingDevice = false;
  @state() private deviceAddress = "";
  @state() private qr = "";
  @state() private addedName: string | null = null;
  /** The Add dialog's own refusal: a wrong number, a failed discard, or its read of the address. */
  @state() private addError: string | null = null;
  @state() private holdStatus: PairingHoldStatus = "idle";
  /** The taken hold's lapse, shown before the live read of the window next answers. */
  @state() private takenUntil: string | null = null;
  /** Apart from `addError`, so nothing else the dialog does clears why the hold ended. */
  @state() private holdErrorKey: string | null = null;
  readonly #hold = new PairingHold(
    () => this.api,
    (status, code, openUntil) => {
      this.holdStatus = status;
      this.takenUntil = status === "held" ? openUntil : null;
      this.holdErrorKey = status === "failed" ? code : null;
    },
  );
  #addEpoch = 0;

  @state() private pairRequest: JoinRequestRow | null = null;
  @state() private pairStep: "number" | "settings" = "number";
  @state() private choices: string[] | null = null;
  @state() private checking = false;
  @state() private submitting = false;
  @state() private pairError: string | null = null;
  @state() private pairName = "";
  @state() private chosenProfileId = "";
  @state() private chosenBinding = "";
  @state() private formAttempted = false;
  @state() private fieldRefusal: { field: PairField; code: string } | null = null;
  /** Set once the server has approved or deleted the request, so closing Pair has nothing to discard. */
  #pairSettled = false;
  #pairEpoch = 0;
  @state() private armedRevokeId: string | null = null;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  @state() private madeHereRefusals: Record<string, string> = {};
  @state() private madeHerePending: Record<string, string[]> = {};
  readonly #madeHereSaving = new Set<string>();

  override connectedCallback(): void {
    super.connectedCallback();
    // Merge each panel's strings so its `displayNameKey` resolves; this screen never mounts a panel.
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
    this.armedRevokeId = null;
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
        this.#queries.watch("listWatchers", [], (value) => {
          this.watchers = value;
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
        this.#queries.watch("pairingMode", [], (value) => {
          this.pairing = value;
        }),
        this.#queries.watch("joinRequests", ["device"], (value) => {
          this.pendingJoins = value;
        }),
      ]);
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  override disconnectedCallback(): void {
    this.#endAdding();
    super.disconnectedCallback();
  }

  async #openAddDevice(): Promise<void> {
    if (this.addingDevice) return;
    const epoch = ++this.#addEpoch;
    this.addingDevice = true;
    this.addedName = null;
    this.addError = null;
    this.qr = "";
    this.deviceAddress = "";
    void this.#hold.start();
    try {
      const { deviceAddress } = await this.api.pairingMode();
      if (epoch !== this.#addEpoch) return;
      this.deviceAddress = deviceAddress;
      const qr = await this.qrFor(deviceAddress);
      if (epoch === this.#addEpoch) this.qr = qr;
    } catch (error) {
      // A read's failure never replaces an action's message.
      if (epoch === this.#addEpoch && this.addError === null) this.addError = codeOf(error);
    }
  }

  /** Every way the Add dialog ends: Close, Escape, or the screen going away. */
  #endAdding(): void {
    if (!this.addingDevice) return;
    this.#addEpoch++;
    this.addingDevice = false;
    this.#closePair();
    this.#hold.stop();
    this.addedName = null;
    this.addError = null;
  }

  async #closeModal(id: string): Promise<void> {
    const modal = this.renderRoot.querySelector<WtModal>(`[data-test="${id}"]`);
    if (!modal?.open) return;
    // Native close restores focus before wt-close takes the modal out of the template.
    const closed = new Promise<void>((resolve) =>
      modal.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    modal.open = false;
    await closed;
  }

  /**
   * Closing Pair before the server settled the request discards it, so the device can ask again. A
   * discard that fails leaves the request pending, and claimed by this login if its number was
   * checked, so the Add dialog that is still open says so; one closing with Add needs no message:
   * the dialog that would show it is gone.
   */
  #closePair(): void {
    const request = this.pairRequest;
    if (request === null) return;
    this.#pairEpoch++;
    this.pairRequest = null;
    this.checking = false;
    this.submitting = false;
    if (this.#pairSettled) return;
    const addEpoch = this.#addEpoch;
    void this.api.denyJoinRequest(request.id).catch((error: unknown) => {
      const code = codeOf(error);
      if (code !== "join_request.not_found" && this.addingDevice && addEpoch === this.#addEpoch)
        this.addError = code;
    });
  }

  async #openPair(request: JoinRequestRow): Promise<void> {
    this.#closePair();
    const epoch = ++this.#pairEpoch;
    this.#pairSettled = false;
    this.pairRequest = request;
    this.addError = null;
    this.addedName = null;
    this.pairError = null;
    this.choices = null;
    if (request.pairingBy?.mine) {
      this.#toSettings(request);
      return;
    }
    this.pairStep = "number";
    try {
      const { choices } = await this.api.joinChallenge(request.id);
      if (epoch === this.#pairEpoch) this.choices = choices;
    } catch (error) {
      if (epoch === this.#pairEpoch) this.pairError = codeOf(error);
    }
  }

  #toSettings(request: JoinRequestRow): void {
    this.pairStep = "settings";
    this.pairName = request.label;
    this.chosenProfileId = "";
    this.chosenBinding = "";
    this.formAttempted = false;
    this.fieldRefusal = null;
    this.pairError = null;
  }

  /** A wrong number is terminal: the server deleted the request before answering. */
  async #checkNumber(choice: string): Promise<void> {
    const request = this.pairRequest;
    if (request === null || this.checking) return;
    const holdId = this.#hold.holdId;
    if (holdId === null) {
      this.pairError = "device.pairing_hold_lapsed";
      return;
    }
    const epoch = this.#pairEpoch;
    this.checking = true;
    this.pairError = null;
    try {
      await this.api.checkDeviceJoinNumber(request.id, { choice, holdId });
      if (epoch !== this.#pairEpoch) return;
      this.checking = false;
      this.#toSettings(request);
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      this.checking = false;
      const code = codeOf(error);
      if (code !== "device.join_mismatch") {
        this.pairError = code;
        return;
      }
      this.#pairSettled = true;
      this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
      await this.#closeModal("pair-modal");
      this.#closePair();
      this.addError = code;
    }
  }

  #chosenProfile(): DeviceProfile | undefined {
    return this.deviceProfiles.find((p) => p.id === this.chosenProfileId);
  }

  #bindingShown(): boolean {
    const profile = this.#chosenProfile();
    return profile !== undefined && bindsStation(profile.formFactor);
  }

  /** The form's own checks, which hold Pair disabled once a submission has been tried. */
  #ownErrors(): Record<PairField, string> {
    if (!this.formAttempted) return { name: "", profile: "", binding: "" };
    return {
      name: this.pairName.trim() === "" ? t("form.name_required") : "",
      profile: this.chosenProfileId === "" ? t("devices.join_pick_profile") : "",
      binding:
        this.#bindingShown() && this.chosenBinding === ""
          ? codeMessage("device.station_required")
          : "",
    };
  }

  #pairErrors(): Record<PairField, string> {
    const errors = this.#ownErrors();
    const refused = this.fieldRefusal;
    if (refused !== null && errors[refused.field] === "")
      errors[refused.field] = codeMessage(refused.code);
    return errors;
  }

  /** The field a refusal is about, when the form shows that field. */
  #refusedField(error: unknown): PairField | null {
    const code = codeOf(error);
    const param = (error as { params?: { field?: unknown } } | null)?.params?.field;
    const field =
      code === "management.request_invalid" && typeof param === "string"
        ? PAIR_FIELD_BY_PARAM[param]
        : PAIR_FIELD_BY_CODE[code];
    if (field === undefined) return null;
    return field !== "binding" || this.#bindingShown() ? field : null;
  }

  #clearRefusal(field: PairField): void {
    if (this.fieldRefusal?.field === field) this.fieldRefusal = null;
  }

  async #submitPair(): Promise<void> {
    const request = this.pairRequest;
    if (request === null || this.submitting) return;
    this.formAttempted = true;
    const own = this.#ownErrors();
    if (own.name || own.profile || own.binding) {
      void this.updateComplete.then(() => {
        const modal = this.renderRoot.querySelector("[data-test=pair-modal]");
        if (modal) void focusFirstInvalid(modal);
      });
      return;
    }
    const binding = this.#bindingShown() ? this.chosenBinding : "";
    const epoch = this.#pairEpoch;
    this.submitting = true;
    this.pairError = null;
    this.fieldRefusal = null;
    let result: { name: string };
    try {
      result = await this.api.acceptDeviceJoinRequest(request.id, {
        name: this.pairName.trim(),
        profileId: this.chosenProfileId,
        ...(binding.startsWith("station:") ? { stationId: binding.slice("station:".length) } : {}),
        ...(binding.startsWith("watcher:") ? { watcherId: binding.slice("watcher:".length) } : {}),
      });
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      this.submitting = false;
      const field = this.#refusedField(error);
      if (field === null) this.pairError = codeOf(error);
      else this.fieldRefusal = { field, code: codeOf(error) };
      return;
    }
    if (epoch !== this.#pairEpoch) return;
    this.#pairSettled = true;
    this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
    await this.#closeModal("pair-modal");
    this.#closePair();
    this.addedName = result.name;
    try {
      await this.#reloadDevices();
    } catch (error) {
      this.#showReadError(error);
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
    this.#showError(null);
    let written = false;
    try {
      await this.api.revokeDevice(id);
      written = true;
      await this.#reloadDevices();
    } catch (error) {
      if (written) this.#showReadError(error);
      else this.#showError(codeOf(error));
    }
  }

  async #onReassign(id: string, deviceProfileId: string | null): Promise<void> {
    this.#showError(null);
    let written = false;
    try {
      await this.api.reassignDeviceProfile(id, deviceProfileId);
      written = true;
      await this.#reloadDevices();
    } catch (error) {
      if (written) this.#showReadError(error);
      else this.#showError(codeOf(error));
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

  /** Written immediately, not staged. A rejection leaves `deviceReaders` untouched, so the control
   * shows the stored default again. */
  async #onReaderChange(id: string, value: string): Promise<void> {
    this.#showError(null);
    const readerId = value === "" ? null : value;
    try {
      await this.api.setDeviceReader(id, readerId);
      this.deviceReaders = { ...this.deviceReaders, [id]: readerId };
    } catch (error) {
      this.#showError(codeOf(error));
    }
  }

  #onMadeHereChange(device: DeviceRow): void {
    const group = this.shadowRoot?.querySelector(`[data-test="made-here-${device.id}"]`);
    const stationIds = [
      ...(group?.querySelectorAll<HTMLInputElement>('input[name="stationIds"]') ?? []),
    ]
      .filter((box) => box.checked)
      .map((box) => box.value);
    this.madeHerePending = { ...this.madeHerePending, [device.id]: stationIds };
    this.madeHereRefusals = Object.fromEntries(
      Object.entries(this.madeHereRefusals).filter(([id]) => id !== device.id),
    );
    void this.#saveMadeHere(device.id);
  }

  async #saveMadeHere(deviceId: string): Promise<void> {
    // One writer per device keeps responses in tap order while the latest choice survives renders.
    if (this.#madeHereSaving.has(deviceId)) return;
    this.#madeHereSaving.add(deviceId);
    try {
      while (this.madeHerePending[deviceId] !== undefined) {
        const stationIds = this.madeHerePending[deviceId];
        try {
          await this.api.setDeviceMadeHere(deviceId, stationIds);
        } catch (error) {
          this.madeHerePending = Object.fromEntries(
            Object.entries(this.madeHerePending).filter(([id]) => id !== deviceId),
          );
          this.madeHereRefusals = { ...this.madeHereRefusals, [deviceId]: codeOf(error) };
          return;
        }
        this.devices = this.devices.map((row) =>
          row.id === deviceId ? { ...row, madeHereStationIds: stationIds } : row,
        );
        const latest = this.madeHerePending[deviceId];
        if (latest.length === stationIds.length && latest.every((id, i) => id === stationIds[i])) {
          this.madeHerePending = Object.fromEntries(
            Object.entries(this.madeHerePending).filter(([id]) => id !== deviceId),
          );
        }
      }
    } finally {
      this.#madeHereSaving.delete(deviceId);
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

  #bindingName(device: DeviceRow): string {
    if (device.watcherId !== null) {
      const name = this.watchers.find((watcher) => watcher.id === device.watcherId)?.name;
      return name === undefined
        ? t("devices.watcher_removed")
        : `${t("devices.watcher_prefix")}${name}`;
    }
    return this.#stationName(device.stationId);
  }

  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return formatIsoMinute(iso);
  }

  /** A device may stay on a printer switched off since it chose it, so that one is shown too. */
  #printerName(printerId: string | null): string {
    const printer = this.printers.find((p) => p.id === printerId);
    if (printer === undefined) return t("devices.no_printer");
    return printerLabel(printer);
  }

  /** Read-only: a device picks its own printers from its profile's lists. */
  #renderHardware(device: DeviceRow): TemplateResult {
    const activeReaders = this.readers.filter((r) => r.active);
    return html`<div class="hardware" data-test="hardware-${device.id}">
      <dl class="printers">
        <div>
          <dt>${t("devices.receipt_printer_now")}</dt>
          <dd data-test="device-receipt-printer-${device.id}">
            ${this.#printerName(device.receiptPrinterId)}
          </dd>
        </div>
        <div>
          <dt>${t("devices.slip_printer_now")}</dt>
          <dd data-test="device-slip-printer-${device.id}">
            ${this.#printerName(device.paymentSlipPrinterId)}
          </dd>
        </div>
      </dl>
      <wt-combobox
        data-test="hw-reader-${device.id}"
        name="defaultReaderId"
        label=${t("devices.default_reader")}
        search="auto"
        placeholder=${t("devices.default_reader_none")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${[
          { value: "", label: t("devices.default_reader_none") },
          ...activeReaders.map((r) => ({ value: r.id, label: this.#readerLabel(r) })),
        ]}
        .value=${live(this.deviceReaders[device.id] ?? "")}
        @wt-change=${(e: CustomEvent<{ value: string }>) =>
          void this.#onReaderChange(device.id, e.detail.value)}
      ></wt-combobox>
    </div>`;
  }

  #renderDevice(device: DeviceRow): TemplateResult {
    const armed = this.armedRevokeId === device.id;
    const madeHereStationIds = this.madeHerePending[device.id] ?? device.madeHereStationIds;
    return html`<li data-test="device-row-${device.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="device-label-${device.id}">${device.label}</span>
            <span class="meta">
              <span data-test="device-profile-${device.id}"
                >${this.#profileName(device.deviceProfileId)}</span
              >
              <span data-test="device-station-${device.id}">${this.#bindingName(device)}</span>
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
              ? html`<wt-combobox
                  data-test="reassign-${device.id}"
                  name="deviceProfileId"
                  label=${`${t("devices.reassign")} ${device.label}`}
                  hide-label
                  search="auto"
                  placeholder=${t("devices.device_profile_none")}
                  searchPlaceholder=${t("categories.combobox_search")}
                  noResultsLabel=${t("categories.combobox_no_results")}
                  .options=${[
                    { value: "", label: t("devices.device_profile_none") },
                    ...this.deviceProfiles.map((profile) => ({
                      value: profile.id,
                      label: profile.name,
                    })),
                  ]}
                  .value=${live(device.deviceProfileId ?? "")}
                  @wt-change=${(e: CustomEvent<{ value: string }>) =>
                    void this.#onReassign(device.id, e.detail.value === "" ? null : e.detail.value)}
                ></wt-combobox>`
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
        ${
          device.active && device.kind !== "kds_station"
            ? html`<fieldset class="made-here" data-test="made-here-${device.id}">
                <legend>${t("devices.made_here")}</legend>
                <p class="hint">${t("devices.made_here_hint")}</p>
                ${this.stations.map(
                  (station) =>
                    html`<label class="check">
                      <input
                        type="checkbox"
                        name="stationIds"
                        value=${station.id}
                        .checked=${live(madeHereStationIds.includes(station.id))}
                        @change=${() => this.#onMadeHereChange(device)}
                      />
                      ${station.name}</label
                    >`,
                )}
                ${this.madeHereRefusals[device.id] === undefined ? nothing : html`<p class="error" role="alert">${codeMessage(this.madeHereRefusals[device.id]!)}</p>`}
              </fieldset>`
            : nothing
        }
      </wt-card>
    </li>`;
  }

  #renderAddButton(): TemplateResult {
    return html`<wt-button
      variant="primary"
      data-test="open-add-device"
      @click=${() => void this.#openAddDevice()}
      >${t("devices.add")}</wt-button
    >`;
  }

  /** Only while this dialog holds the window: the later of its own hold's lapse and the window's. */
  #openUntil(): string | null {
    if (this.holdStatus !== "held") return null;
    const read = this.pairing?.open ? this.pairing.openUntil : null;
    return read !== null && (this.takenUntil === null || read > this.takenUntil)
      ? read
      : this.takenUntil;
  }

  #renderWaiting(): TemplateResult | typeof nothing {
    if (this.pendingJoins.length === 0)
      return this.holdStatus === "lapsed" || this.holdStatus === "failed"
        ? nothing
        : html`<p class="waiting" data-test="waiting-empty">
            <wt-spinner></wt-spinner>${t("devices.waiting")}
          </p>`;
    const held = this.#hold.holdId !== null;
    const columns: DataTableColumn<JoinRequestRow>[] = [
      {
        key: "name",
        label: t("devices.name"),
        cell: (request) =>
          html`<span data-test=${`waiting-row-${request.id}`}>${request.label}</span>`,
      },
      {
        key: "actions",
        label: t("devices.actions"),
        pinned: "end",
        cell: (request) =>
          request.pairingBy && !request.pairingBy.mine
            ? html`<span part="being-paired" data-test=${`being-paired-${request.id}`}
                >${t("devices.being_paired_by").replace("{name}", request.pairingBy.name)}</span
              >`
            : html`<wt-button
                size="sm"
                data-test=${`pair-${request.id}`}
                aria-label=${`${t("devices.pair")} ${request.label}`}
                ?disabled=${!held}
                @click=${() => void this.#openPair(request)}
                >${t("devices.pair")}</wt-button
              >`,
      },
    ];
    return html`<wt-data-table
      data-test="waiting-table"
      aria-label=${t("devices.waiting_title")}
      .rows=${this.pendingJoins}
      .columns=${columns}
      .rowKey=${(request: JoinRequestRow) => request.id}
    ></wt-data-table>`;
  }

  #renderAddDialog(): TemplateResult | typeof nothing {
    if (!this.addingDevice) return nothing;
    const until = this.#openUntil();
    const [before, after] = t("devices.add_hint").split("{address}");
    return html`<wt-modal
      data-test="add-device-modal"
      heading=${t("devices.add_title")}
      .open=${true}
      .dismissible=${!this.submitting}
      @wt-close=${() => this.#endAdding()}
    >
      ${this.qr === "" ? nothing : html`<img class="qr" data-test="device-qr" src=${this.qr} alt=${t("devices.qr_alt")} />`}
      <p class="hint">
        ${before}<code data-test="device-address">${this.deviceAddress}</code>${after}
      </p>
      ${until === null ? nothing : html`<p class="hint" data-test="pairing-until">${t("devices.open_until").replace("{time}", formatIsoMinute(until))}</p>`}
      ${holdNotice(this.holdStatus, () => void this.#hold.start())}
      ${
        this.addedName === null
          ? nothing
          : html`<p class="added" role="status" data-test="added-device">
              ${t("devices.added").replace("{name}", this.addedName)}
            </p>`
      }
      ${this.#renderWaiting()}
      <wt-form-actions
        slot="footer"
        data-test="add-device-actions"
        .error=${bottomMessage(refusal(this.holdErrorKey), refusal(this.addError))}
        ><wt-button
          slot="cancel"
          data-test="add-device-close"
          @click=${() => void this.#closeModal("add-device-modal")}
          >${t("action.close")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #renderNumberStep(): TemplateResult {
    if (this.choices === null)
      return this.pairError === null
        ? html`<p class="hint">${t("devices.join_loading")}</p>`
        : html``;
    return html`<p id="pair-prompt">${t("devices.join_match_prompt")}</p>
      <div class="choices" role="group" aria-labelledby="pair-prompt">
        ${this.choices.map(
          // Large, so the number can be matched against a device across the room.
          (number) =>
            html`<wt-button
              variant="secondary"
              size="lg"
              data-choice=${number}
              ?disabled=${this.checking}
              aria-label=${t("devices.join_choice_label").replace("{number}", number)}
              @click=${() => void this.#checkNumber(number)}
              >${number}</wt-button
            >`,
        )}
      </div>`;
  }

  #renderBindingPicker(error: string): TemplateResult | typeof nothing {
    if (!this.#bindingShown()) return nothing;
    return html`<wt-combobox
      data-test="pair-binding"
      name="binding"
      required
      label=${t("devices.shows")}
      search="auto"
      placeholder=${t("devices.join_pick_binding")}
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      .options=${[
        ...this.stations
          .filter((station) => station.active)
          .map((station) => ({
            value: `station:${station.id}`,
            label: station.name,
            group: t("devices.stations_group"),
          })),
        ...this.watchers
          .filter((watcher) => watcher.active)
          .map((watcher) => ({
            value: `watcher:${watcher.id}`,
            label: watcher.name,
            group: t("devices.watchers_group"),
          })),
      ]}
      .value=${this.chosenBinding}
      .error=${error}
      .invalid=${error !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        this.chosenBinding = e.detail.value;
        this.#clearRefusal("binding");
      }}
    ></wt-combobox>`;
  }

  #renderSettingsStep(errors: Record<PairField, string>): TemplateResult {
    return html`<div class="pair-fields">
      <wt-input
        data-test="pair-name"
        name="name"
        required
        label=${t("devices.name")}
        .value=${live(this.pairName)}
        .error=${errors.name}
        .invalid=${errors.name !== ""}
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(e, this.renderRoot.querySelector<HTMLElement>("[data-test=pair-submit]"))}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.pairName = e.detail.value;
          this.#clearRefusal("name");
        }}
      ></wt-input>
      <wt-combobox
        data-test="pair-profile"
        name="profileId"
        required
        label=${t("devices.device_profile")}
        search="auto"
        placeholder=${t("devices.join_pick_profile")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.deviceProfiles.map((p) => ({ value: p.id, label: p.name }))}
        .value=${this.chosenProfileId}
        .error=${errors.profile}
        .invalid=${errors.profile !== ""}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          this.chosenProfileId = e.detail.value;
          this.chosenBinding = "";
          this.#clearRefusal("profile");
          this.#clearRefusal("binding");
        }}
      ></wt-combobox>
      ${this.#renderBindingPicker(errors.binding)}
    </div>`;
  }

  #renderPairDialog(): TemplateResult | typeof nothing {
    const request = this.pairRequest;
    if (request === null) return nothing;
    const settings = this.pairStep === "settings";
    const errors = settings ? this.#pairErrors() : { name: "", profile: "", binding: "" };
    const marked = errors.name !== "" || errors.profile !== "" || errors.binding !== "";
    const own = this.#ownErrors();
    const blocked = own.name !== "" || own.profile !== "" || own.binding !== "";
    return html`<wt-modal
      data-test="pair-modal"
      heading=${t("devices.pair_title").replace("{name}", request.label)}
      .open=${true}
      .dismissible=${!this.submitting}
      @wt-close=${() => this.#closePair()}
    >
      ${settings ? this.#renderSettingsStep(errors) : this.#renderNumberStep()}
      <wt-form-actions
        slot="footer"
        data-test="pair-actions"
        .error=${bottomMessage(refusal(this.pairError), marked ? t("form.fix_fields") : null)}
      >
        <wt-button
          slot="cancel"
          data-test="pair-cancel"
          ?disabled=${this.submitting}
          @click=${() => void this.#closeModal("pair-modal")}
          >${t("action.cancel")}</wt-button
        >
        ${
          settings
            ? html`<wt-button
                variant="primary"
                data-test="pair-submit"
                ?loading=${this.submitting}
                ?disabled=${blocked}
                @click=${() => void this.#submitPair()}
                >${t("devices.pair")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-modal>`;
  }

  override render(): TemplateResult {
    return html`
      <div class="heading">
        <h1 class="title">${t("devices.title")}</h1>
        ${this.#renderAddButton()}
      </div>

      <section data-test="devices-panel">
        ${
          this.devices.length === 0
            ? html`<p class="empty" data-test="no-devices">${t("devices.no_devices")}</p>
                ${this.#renderAddButton()}`
            : html`<ol>
                ${this.devices.map((device) => this.#renderDevice(device))}
              </ol>`
        }
      </section>

      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="page-error">
              ${codeMessage(this.errorKey)}
            </p>`
          : nothing
      }
      ${this.#renderAddDialog()} ${this.#renderPairDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-devices-screen": DevicesScreen;
  }
}
