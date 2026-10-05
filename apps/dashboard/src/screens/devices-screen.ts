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
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { PairingHold, type PairingHoldStatus } from "../api/pairing-hold.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { holdNotice, holdNoticeStyles } from "../widgets/hold-notice.js";
import "../widgets/row-actions.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import {
  registerCatalogue,
  tableNoMatches,
  type CardProviderPanel,
  t as tRaw,
} from "@waitron/dashboard-kit";
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
type EditField = PairField | "receipt" | "slip" | "reader";
type IdentityErrors = Record<PairField, string>;

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

/** Refusals of an edit that are about one field, by code alone; others read their params first. */
const EDIT_FIELD_BY_CODE: Record<string, EditField> = {
  "device.name_taken": "name",
  "device.station_required": "binding",
  "watcher.not_found": "binding",
  "device_profile.not_found": "profile",
};

const EDIT_FIELD_BY_PARAM: Record<string, EditField> = {
  ...PAIR_FIELD_BY_PARAM,
  receiptPrinterId: "receipt",
  paymentSlipPrinterId: "slip",
};

interface EditForm {
  name: string;
  profileId: string;
  /** `station:<id>`, `watcher:<id>`, or empty. */
  binding: string;
  /** Empty for none. */
  receiptPrinterId: string;
  paymentSlipPrinterId: string;
  madeHere: string[];
}

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
      .pair-fields,
      .edit-fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .made-here {
        max-width: var(--wt-form-max-width);
        margin: 0;
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
  @state() private armedRemoveId: string | null = null;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  @state() private editing: DeviceRow | null = null;
  @state() private editForm: EditForm = {
    name: "",
    profileId: "",
    binding: "",
    receiptPrinterId: "",
    paymentSlipPrinterId: "",
    madeHere: [],
  };
  @state() private editAttempted = false;
  @state() private editRefusal: { field: EditField; code: string } | null = null;
  @state() private editError: string | null = null;
  @state() private editSaving = false;
  /** "hidden" when the person may not manage card readers. */
  @state() private readerState: "loading" | "ready" | "hidden" | "failed" = "loading";
  @state() private readers: ReaderRow[] = [];
  @state() private readerReadError: string | null = null;
  @state() private chosenReaderId = "";
  #storedReaderId: string | null = null;
  #editEpoch = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    // Merge each panel's strings so its `displayNameKey` resolves; this screen never mounts a panel.
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
    this.armedRemoveId = null;
    try {
      await Promise.all([
        this.#queries.watch("listDevices", [], (value) => {
          this.devices = value;
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
    this.#endEdit();
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

  #bindingShownFor(profileId: string): boolean {
    const profile = this.deviceProfiles.find((p) => p.id === profileId);
    return profile !== undefined && bindsStation(profile.formFactor);
  }

  #bindingShown(): boolean {
    return this.#bindingShownFor(this.chosenProfileId);
  }

  /** The checks Pair and Edit share, which hold the action disabled once a submission was tried. */
  #identityErrors(
    attempted: boolean,
    values: { name: string; profileId: string; binding: string },
  ): IdentityErrors {
    if (!attempted) return { name: "", profile: "", binding: "" };
    return {
      name: values.name.trim() === "" ? t("form.name_required") : "",
      profile: values.profileId === "" ? t("devices.join_pick_profile") : "",
      binding:
        this.#bindingShownFor(values.profileId) && values.binding === ""
          ? codeMessage("device.station_required")
          : "",
    };
  }

  #ownErrors(): IdentityErrors {
    return this.#identityErrors(this.formAttempted, {
      name: this.pairName,
      profileId: this.chosenProfileId,
      binding: this.chosenBinding,
    });
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
    this.armedRemoveId = null;
    this.devices = await this.api.listDevices();
  }

  #onRemove(id: string): void {
    if (this.armedRemoveId === id) {
      this.armedRemoveId = null;
      void this.#remove(id);
      return;
    }
    this.armedRemoveId = id;
  }

  async #remove(id: string): Promise<void> {
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

  #profileName(deviceProfileId: string | null): string {
    return this.deviceProfiles.find((p) => p.id === deviceProfileId)?.name ?? "";
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

  // ── The Edit dialog ──────────────────────────────────────────────────────────────────────────────

  /** The first printer in `ids` that is switched on, as the server's `firstUsablePrinters` picks. */
  #firstSwitchedOn(ids: readonly string[]): string {
    return ids.find((id) => this.printers.find((p) => p.id === id)?.active) ?? "";
  }

  #storedBinding(device: DeviceRow): string {
    if (
      device.stationId !== null &&
      this.stations.some((s) => s.id === device.stationId && s.active)
    )
      return `station:${device.stationId}`;
    if (
      device.watcherId !== null &&
      this.watchers.some((w) => w.id === device.watcherId && w.active)
    )
      return `watcher:${device.watcherId}`;
    return "";
  }

  #openEdit(device: DeviceRow): void {
    const epoch = ++this.#editEpoch;
    this.editing = device;
    this.editForm = {
      name: device.label,
      profileId: device.deviceProfileId ?? "",
      binding: this.#storedBinding(device),
      receiptPrinterId: device.receiptPrinterId ?? "",
      paymentSlipPrinterId: device.paymentSlipPrinterId ?? "",
      madeHere: device.madeHereStationIds,
    };
    this.editAttempted = false;
    this.editRefusal = null;
    this.editError = null;
    this.editSaving = false;
    this.readerState = "loading";
    this.readers = [];
    this.readerReadError = null;
    this.chosenReaderId = "";
    this.#storedReaderId = null;
    void this.#loadReader(device.id, epoch);
  }

  /** The reader is the payments module's, under its own permission: without it the field is gone. */
  async #loadReader(deviceId: string, epoch: number): Promise<void> {
    try {
      const [{ readerId }, readers] = await Promise.all([
        this.api.getDeviceReader(deviceId),
        this.api.listReaders(),
      ]);
      if (epoch !== this.#editEpoch) return;
      this.readers = readers.filter((reader) => reader.active);
      this.#storedReaderId = readerId;
      this.chosenReaderId = readerId ?? "";
      this.readerState = "ready";
    } catch (error) {
      if (epoch !== this.#editEpoch) return;
      const code = codeOf(error);
      if (code === "authorization.not_permitted") this.readerState = "hidden";
      else {
        this.readerState = "failed";
        this.readerReadError = code;
      }
    }
  }

  #endEdit(): void {
    if (this.editing === null) return;
    this.#editEpoch++;
    this.editing = null;
    this.editSaving = false;
  }

  #editBindingShown(): boolean {
    return this.#bindingShownFor(this.editForm.profileId);
  }

  #editOwnErrors(): IdentityErrors {
    return this.#identityErrors(this.editAttempted, this.editForm);
  }

  #editErrors(): Record<EditField, string> {
    const errors: Record<EditField, string> = {
      ...this.#editOwnErrors(),
      receipt: "",
      slip: "",
      reader: "",
    };
    const refused = this.editRefusal;
    if (refused !== null && errors[refused.field] === "")
      errors[refused.field] = codeMessage(refused.code);
    return errors;
  }

  /** The field a refusal of the edit is about, when the dialog shows that field. */
  #editRefusedField(error: unknown): EditField | null {
    const code = codeOf(error);
    const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
    let field: EditField | undefined;
    if (code === "management.request_invalid" || code === "device.binding_invalid")
      field = typeof params.field === "string" ? EDIT_FIELD_BY_PARAM[params.field] : undefined;
    // A made-here station refused the same way names no field the dialog marks.
    else if (code === "station.not_found")
      field =
        this.editForm.binding === `station:${String(params.stationId)}` ? "binding" : undefined;
    else field = EDIT_FIELD_BY_CODE[code];
    if (field === undefined) return null;
    return field !== "binding" || this.#editBindingShown() ? field : null;
  }

  #clearEditRefusal(...fields: EditField[]): void {
    if (this.editRefusal !== null && fields.includes(this.editRefusal.field))
      this.editRefusal = null;
  }

  #setEdit(patch: Partial<EditForm>, ...fields: EditField[]): void {
    this.editForm = { ...this.editForm, ...patch };
    this.#clearEditRefusal(...fields);
  }

  #onEditProfile(profileId: string): void {
    const profile = this.deviceProfiles.find((p) => p.id === profileId);
    this.#setEdit(
      {
        profileId,
        receiptPrinterId: this.#firstSwitchedOn(profile?.receiptPrinterIds ?? []),
        paymentSlipPrinterId: this.#firstSwitchedOn(profile?.paymentSlipPrinterIds ?? []),
      },
      "profile",
      "binding",
      "receipt",
      "slip",
    );
  }

  /** Switched-off printers are left out, except one the device holds on the profile it keeps. */
  #printerOptions(ids: readonly string[], held: string | null): { value: string; label: string }[] {
    const keep = this.editForm.profileId === this.editing?.deviceProfileId ? held : null;
    const listed = ids.flatMap((id) => {
      const printer = this.printers.find((p) => p.id === id);
      return printer !== undefined && (printer.active || printer.id === keep) ? [printer] : [];
    });
    return [
      { value: "", label: t("devices.no_printer") },
      ...listed.map((p) => ({ value: p.id, label: printerLabel(p) })),
    ];
  }

  /** Only switched-on stations can be saved, so a stored one since switched off is dropped. */
  #madeHereToSend(): string[] {
    return this.stations
      .filter((station) => station.active && this.editForm.madeHere.includes(station.id))
      .map((station) => station.id);
  }

  #onMadeHereChange(stationId: string, checked: boolean): void {
    const rest = this.editForm.madeHere.filter((id) => id !== stationId);
    this.#setEdit({ madeHere: checked ? [...rest, stationId] : rest });
  }

  async #submitEdit(): Promise<void> {
    const device = this.editing;
    if (device === null || this.editSaving) return;
    this.editAttempted = true;
    const own = this.#editOwnErrors();
    if (own.name || own.profile || own.binding) {
      void this.updateComplete.then(() => {
        const modal = this.renderRoot.querySelector("[data-test=edit-device-modal]");
        if (modal) void focusFirstInvalid(modal);
      });
      return;
    }
    const form = this.editForm;
    const binding = this.#editBindingShown() ? form.binding : "";
    const epoch = this.#editEpoch;
    this.editSaving = true;
    this.editError = null;
    this.editRefusal = null;
    try {
      await this.api.updateDevice(device.id, {
        name: form.name.trim(),
        profileId: form.profileId,
        ...(binding.startsWith("station:") ? { stationId: binding.slice("station:".length) } : {}),
        ...(binding.startsWith("watcher:") ? { watcherId: binding.slice("watcher:".length) } : {}),
        receiptPrinterId: form.receiptPrinterId === "" ? null : form.receiptPrinterId,
        paymentSlipPrinterId: form.paymentSlipPrinterId === "" ? null : form.paymentSlipPrinterId,
        madeHereStationIds: this.#madeHereToSend(),
      });
    } catch (error) {
      if (epoch !== this.#editEpoch) return;
      this.editSaving = false;
      const field = this.#editRefusedField(error);
      if (field === null) this.editError = codeOf(error);
      else this.editRefusal = { field, code: codeOf(error) };
      return;
    }
    this.#reloadDevices().catch((error: unknown) => this.#showReadError(error));
    if (epoch !== this.#editEpoch) return;
    const readerId = this.chosenReaderId === "" ? null : this.chosenReaderId;
    if (this.readerState === "ready" && readerId !== this.#storedReaderId) {
      // Saved separately: the reader belongs to the payments module and its own permission (spec §5).
      try {
        await this.api.setDeviceReader(device.id, readerId);
      } catch (error) {
        if (epoch !== this.#editEpoch) return;
        this.editSaving = false;
        this.editRefusal = { field: "reader", code: codeOf(error) };
        return;
      }
      if (epoch !== this.#editEpoch) return;
      this.#storedReaderId = readerId;
    }
    this.editSaving = false;
    await this.#closeModal("edit-device-modal");
    this.#endEdit();
  }

  #deviceActions(device: DeviceRow): TemplateResult | typeof nothing {
    if (!device.active) return nothing;
    const armed = this.armedRemoveId === device.id;
    return html`<dashboard-row-actions .label=${`${t("devices.actions")}: ${device.label}`}>
      <wt-button data-test=${`edit-device-${device.id}`} @click=${() => this.#openEdit(device)}
        >${t("devices.edit")}</wt-button
      >
      <wt-button
        variant="danger"
        data-keep-open
        data-test=${`remove-${device.id}`}
        data-armed=${armed ? "true" : nothing}
        @click=${() => this.#onRemove(device.id)}
        >${armed ? t("devices.remove_confirm") : t("devices.remove")}</wt-button
      >
    </dashboard-row-actions>`;
  }

  #renderDevicesTable(): TemplateResult {
    const columns: DataTableColumn<DeviceRow>[] = [
      {
        key: "name",
        label: t("devices.name"),
        sortValue: (d) => d.label,
        cell: (d) =>
          html`<span data-test=${`device-row-${d.id}`}
            ><span data-test=${`device-label-${d.id}`}>${d.label}</span></span
          >`,
      },
      {
        key: "profile",
        choosable: "shown",
        label: t("devices.device_profile"),
        sortValue: (d) => this.#profileName(d.deviceProfileId),
        cell: (d) =>
          html`<span data-test=${`device-profile-${d.id}`}
            >${this.#profileName(d.deviceProfileId)}</span
          >`,
      },
      {
        key: "shows",
        choosable: "shown",
        label: t("devices.column_shows"),
        cell: (d) =>
          html`<span data-test=${`device-station-${d.id}`}
            >${d.kind === "kds_station" ? this.#bindingName(d) : ""}</span
          >`,
      },
      {
        key: "status",
        choosable: "shown",
        label: t("devices.column_status"),
        cell: (d) =>
          html`<span data-test=${`device-status-${d.id}`}
            >${d.active ? t("devices.status_active") : t("devices.status_revoked")}</span
          >`,
      },
      {
        key: "lastSeen",
        choosable: "shown",
        label: t("devices.column_last_seen"),
        sortValue: (d) => d.lastSeenAt,
        cell: (d) =>
          html`<span data-test=${`device-last-seen-${d.id}`}
            >${this.#lastSeen(d.lastSeenAt)}</span
          >`,
      },
      {
        key: "actions",
        label: t("devices.actions"),
        pinned: "end",
        cell: (d) => this.#deviceActions(d),
      },
    ];
    return html`<wt-data-table
      noMatchesMessage=${tableNoMatches()}
      filterSearchPlaceholder=${t("categories.combobox_search")}
      filterNoResultsLabel=${t("categories.combobox_no_results")}
      data-test="devices-table"
      viewKey="devices"
      customiseColumnsLabel=${t("table.customise_columns")}
      customiseLabel=${t("table.customise")}
      restoreColumnsLabel=${t("table.restore_columns")}
      doneLabel=${t("table.done")}
      moveColumnLabel=${t("table.move_column")}
      showColumnLabel=${t("table.show_column")}
      hideColumnLabel=${t("table.hide_column")}
      alwaysShownColumnLabel=${t("table.column_always_shown")}
      lastShownColumnLabel=${t("table.column_last_shown")}
      columnPositionLabel=${t("table.column_position")}
      filtersLabel=${t("table.filters")}
      filteredColumnLabel=${t("table.filtered_column")}
      filtersClearAllLabel=${t("table.filters_clear_all")}
      filtersCloseLabel=${t("table.filters_close")}
      aria-label=${t("devices.title")}
      .rows=${this.devices}
      .columns=${columns}
      .rowKey=${(d: DeviceRow) => d.id}
      .rowClick=${(d: DeviceRow) => this.#openEdit(d)}
      .rowClickable=${(d: DeviceRow) => d.active}
      .rowClickLabel=${(d: DeviceRow) => t("devices.edit_title").replace("{name}", d.label)}
    ></wt-data-table>`;
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
      size="standard"
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

  /** The name, profile and Shows fields that Pair's settings step and the Edit dialog share. */
  #renderIdentityFields(
    prefix: "pair" | "edit",
    values: { name: string; profileId: string; binding: string },
    errors: IdentityErrors,
    on: { name(value: string): void; profile(value: string): void; binding(value: string): void },
  ): TemplateResult {
    return html`<wt-input
        data-test=${`${prefix}-name`}
        name="name"
        required
        label=${t("devices.name")}
        .value=${live(values.name)}
        .error=${errors.name}
        .invalid=${errors.name !== ""}
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(
            e,
            this.renderRoot.querySelector<HTMLElement>(
              `[data-test=${prefix === "pair" ? "pair-submit" : "edit-save"}]`,
            ),
          )}
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          on.name(e.detail.value);
        }}
      ></wt-input>
      <wt-combobox
        data-test=${`${prefix}-profile`}
        name="profileId"
        required
        label=${t("devices.device_profile")}
        search="auto"
        placeholder=${t("devices.join_pick_profile")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${this.deviceProfiles.map((p) => ({ value: p.id, label: p.name }))}
        .value=${values.profileId}
        .error=${errors.profile}
        .invalid=${errors.profile !== ""}
        @wt-change=${(e: CustomEvent<{ value: string }>) => on.profile(e.detail.value)}
      ></wt-combobox>
      ${
        this.#bindingShownFor(values.profileId)
          ? html`<wt-combobox
              data-test=${`${prefix}-binding`}
              name="binding"
              required
              label=${t("devices.shows")}
              search="auto"
              placeholder=${t("devices.join_pick_binding")}
              searchPlaceholder=${t("categories.combobox_search")}
              noResultsLabel=${t("categories.combobox_no_results")}
              .options=${this.#bindingOptions()}
              .value=${values.binding}
              .error=${errors.binding}
              .invalid=${errors.binding !== ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) => on.binding(e.detail.value)}
            ></wt-combobox>`
          : nothing
      }`;
  }

  #bindingOptions(): { value: string; label: string; group: string }[] {
    return [
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
    ];
  }

  #renderSettingsStep(errors: IdentityErrors): TemplateResult {
    return html`<div class="pair-fields">
      ${this.#renderIdentityFields(
        "pair",
        { name: this.pairName, profileId: this.chosenProfileId, binding: this.chosenBinding },
        errors,
        {
          name: (value) => {
            this.pairName = value;
            this.#clearRefusal("name");
          },
          profile: (value) => {
            this.chosenProfileId = value;
            this.chosenBinding = "";
            this.#clearRefusal("profile");
            this.#clearRefusal("binding");
          },
          binding: (value) => {
            this.chosenBinding = value;
            this.#clearRefusal("binding");
          },
        },
      )}
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
      size="standard"
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

  #renderEditDialog(): TemplateResult | typeof nothing {
    const device = this.editing;
    if (device === null) return nothing;
    const form = this.editForm;
    const errors = this.#editErrors();
    const own = this.#editOwnErrors();
    const blocked = own.name !== "" || own.profile !== "" || own.binding !== "";
    const marked = Object.values(errors).some((error) => error !== "");
    const profile = this.deviceProfiles.find((p) => p.id === form.profileId);
    const kitchen = this.#editBindingShown();
    return html`<wt-modal
      size="standard"
      data-test="edit-device-modal"
      heading=${t("devices.edit_title").replace("{name}", device.label)}
      .open=${true}
      .dismissible=${!this.editSaving}
      @wt-close=${() => this.#endEdit()}
    >
      <div class="edit-fields">
        ${this.#renderIdentityFields("edit", form, errors, {
          name: (value) => this.#setEdit({ name: value }, "name"),
          profile: (value) => this.#onEditProfile(value),
          binding: (value) => this.#setEdit({ binding: value }, "binding"),
        })}
        <wt-combobox
          data-test="edit-receipt-printer"
          name="receiptPrinterId"
          label=${t("devices.receipt_printer_now")}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#printerOptions(profile?.receiptPrinterIds ?? [], device.receiptPrinterId)}
          .value=${form.receiptPrinterId}
          .error=${errors.receipt}
          .invalid=${errors.receipt !== ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#setEdit({ receiptPrinterId: e.detail.value }, "receipt")}
        ></wt-combobox>
        <wt-combobox
          data-test="edit-slip-printer"
          name="paymentSlipPrinterId"
          label=${t("devices.slip_printer_now")}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#printerOptions(
            profile?.paymentSlipPrinterIds ?? [],
            device.paymentSlipPrinterId,
          )}
          .value=${form.paymentSlipPrinterId}
          .error=${errors.slip}
          .invalid=${errors.slip !== ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#setEdit({ paymentSlipPrinterId: e.detail.value }, "slip")}
        ></wt-combobox>
        ${kitchen ? nothing : this.#renderMadeHere()}
        ${this.readerState === "hidden" ? nothing : this.#renderReader(errors.reader)}
      </div>
      <wt-form-actions
        slot="footer"
        data-test="edit-actions"
        .error=${bottomMessage(
          refusal(this.editError),
          refusal(this.readerReadError),
          marked ? t("form.fix_fields") : null,
        )}
      >
        <wt-button
          slot="cancel"
          data-test="edit-cancel"
          ?disabled=${this.editSaving}
          @click=${() => void this.#closeModal("edit-device-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="edit-save"
          ?loading=${this.editSaving}
          ?disabled=${blocked}
          @click=${() => void this.#submitEdit()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderMadeHere(): TemplateResult {
    return html`<fieldset class="made-here" data-test="edit-made-here">
      <legend>${t("devices.made_here")}</legend>
      <p class="hint">${t("devices.made_here_hint")}</p>
      ${this.stations
        .filter((station) => station.active)
        .map(
          (station) =>
            html`<label class="check">
              <input
                type="checkbox"
                name="madeHereStationIds"
                value=${station.id}
                .checked=${live(this.editForm.madeHere.includes(station.id))}
                @change=${(e: Event) =>
                  this.#onMadeHereChange(station.id, (e.target as HTMLInputElement).checked)}
              />
              ${station.name}</label
            >`,
        )}
    </fieldset>`;
  }

  #renderReader(error: string): TemplateResult {
    return html`<wt-combobox
      data-test="edit-reader"
      name="defaultReaderId"
      label=${t("devices.default_reader")}
      search="auto"
      placeholder=${t("devices.default_reader_none")}
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      ?disabled=${this.readerState !== "ready"}
      .options=${[
        { value: "", label: t("devices.default_reader_none") },
        ...this.readers.map((r) => ({ value: r.id, label: this.#readerLabel(r) })),
      ]}
      .value=${this.chosenReaderId}
      .error=${error}
      .invalid=${error !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        this.chosenReaderId = e.detail.value;
        this.#clearEditRefusal("reader");
      }}
    ></wt-combobox>`;
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
            : this.#renderDevicesTable()
        }
      </section>

      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="page-error">
              ${codeMessage(this.errorKey)}
            </p>`
          : nothing
      }
      ${this.#renderAddDialog()} ${this.#renderPairDialog()} ${this.#renderEditDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-devices-screen": DevicesScreen;
  }
}
