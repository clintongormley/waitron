import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  visuallyHiddenStyles,
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
import { relativeTime } from "../widgets/relative-time.js";
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
type EditField = PairField | "receipt" | "slip" | "reader" | "approved";
type IdentityErrors = Record<PairField, string>;
type FieldRefusal = { field: EditField; code: string } | null;

/** Refusals of a Pair or Edit save about one field, by code alone; others read their params first. */
const FIELD_BY_CODE: Record<string, EditField> = {
  "device.name_taken": "name",
  "device.station_required": "binding",
  "watcher.not_found": "binding",
  "device_profile.not_found": "profile",
  "device_profile.incompatible": "approved",
};

const FIELD_BY_PARAM: Record<string, EditField> = {
  name: "name",
  profileId: "profile",
  stationId: "binding",
  watcherId: "binding",
  receiptPrinterId: "receipt",
  paymentSlipPrinterId: "slip",
};

/** The field a refusal is about, when it is one of `shown` (CLAUDE.md §3: by what the error carries). */
function refusedField(
  error: unknown,
  binding: string,
  shown: readonly EditField[],
): EditField | null {
  const code = codeOf(error);
  const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
  let field: EditField | undefined;
  if (code === "management.request_invalid" || code === "device.binding_invalid")
    field = typeof params.field === "string" ? FIELD_BY_PARAM[params.field] : undefined;
  // A made-here station refused the same way names no field the form marks.
  else if (code === "station.not_found")
    field = binding === `station:${String(params.stationId)}` ? "binding" : undefined;
  else field = FIELD_BY_CODE[code];
  return field !== undefined && shown.includes(field) ? field : null;
}

/** A refusal's sentence goes under its field unless the form's own check already marks it. */
function withRefusal<F extends EditField>(
  errors: Record<F, string>,
  refused: FieldRefusal,
): Record<F, string> {
  const byField: Partial<Record<EditField, string>> = errors;
  if (refused !== null && byField[refused.field] === "")
    byField[refused.field] = codeMessage(refused.code);
  return errors;
}

/** Changing a field clears a refusal about it. */
function clearedRefusal(refused: FieldRefusal, ...fields: EditField[]): FieldRefusal {
  return refused !== null && fields.includes(refused.field) ? null : refused;
}

interface EditForm {
  name: string;
  profileId: string;
  /** `station:<id>`, `watcher:<id>`, or empty. */
  binding: string;
  /** Empty for none. */
  receiptPrinterId: string;
  paymentSlipPrinterId: string;
  madeHere: string[];
  /** Ticked profiles staff may switch to; only those {@link DevicesScreen} offers are sent. */
  approved: string[];
}

/** A Shows choice as the ids a request carries. */
function bindingIds(binding: string): { stationId: string | null; watcherId: string | null } {
  return {
    stationId: binding.startsWith("station:") ? binding.slice("station:".length) : null,
    watcherId: binding.startsWith("watcher:") ? binding.slice("watcher:".length) : null,
  };
}

/** The Shows choice a device holds, by the name the server reports for it. */
interface HeldBinding {
  value: string;
  name: string;
}

/** The device's stored station or watcher as a Shows choice, whether or not it is switched on. */
function heldBinding(device: DeviceRow): HeldBinding | null {
  if (device.binding === null) return null;
  const value =
    device.stationId !== null ? `station:${device.stationId}` : `watcher:${device.watcherId}`;
  return { value, name: device.binding.name };
}

/**
 * Whether a joining device of this form factor binds a station or watcher: only a `kds` screen does.
 * The server re-derives this, so it only decides whether to show the picker.
 */
function bindsStation(formFactor: FormFactor): boolean {
  return formFactor === "kds";
}

/** A returning device goes by the name it had, which Enable keeps, not the one its browser asked with. */
function waitingName(request: JoinRequestRow): string {
  return request.returning?.name ?? request.label;
}

/** Bringing back a disabled device says Enable, as re-adding a disabled printer does. */
function pairAction(request: JoinRequestRow): string {
  return request.returning ? t("devices.enable") : t("devices.pair");
}

function pairTitle(request: JoinRequestRow): string {
  return (request.returning ? t("devices.enable_title") : t("devices.pair_title")).replace(
    "{name}",
    waitingName(request),
  );
}

/** A battery report older than this is greyed and says when it was taken (spec §6). */
const BATTERY_STALE_MS = 10 * 60_000;

/** A lightning bolt; U+FE0E asks for the text form, which takes the cell's colour, not an emoji. */
const CHARGING_MARK = "\u26A1\uFE0E";

/** A longer `setTimeout` delay overflows and fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** A report taken at `reportedAt` is stale once the time is strictly past this. */
function batteryStaleAfter(reportedAt: string): number {
  return Date.parse(reportedAt) + BATTERY_STALE_MS;
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
      wt-data-table::part(being-paired),
      wt-data-table::part(battery-stale),
      wt-data-table::part(profile-retired) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(battery-updated),
      wt-data-table::part(returning-hint) {
        display: block;
      }
      /* The table is as wide as its content, so the hint wraps only under a width of its own. */
      wt-data-table::part(returning-hint) {
        max-width: 50vw;
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(visually-hidden) {
        ${visuallyHiddenStyles}
      }
      .pair-fields,
      .edit-fields {
        display: grid;
        gap: var(--wt-space-3);
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
      .field-error {
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-danger);
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
  /**
   * Whether the session holds `payments.manage`. While false Edit draws no card reader and sends
   * none; turned back on, the reader shows from the next Edit. A reader read refused with
   * `authorization.not_permitted` also hides it, because the server may know of a change before
   * this flag does; any other failure of that read is shown at the bottom of Edit.
   */
  @property({ attribute: false }) canManageReaders = true;

  @state() private devices: DeviceRow[] = [];
  @state() private stations: Station[] = [];
  @state() private watchers: Watcher[] = [];
  @state() private deviceProfiles: DeviceProfile[] = [];
  @state() private printers: Printer[] = [];
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];

  /** Replaced by a test, so a report's age is fixed. */
  @property({ attribute: false }) now = (): Date => new Date();
  /** Redraws when the next fresh battery report turns stale: the list is not re-read for that. */
  #staleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Seen by a test, so it can check what the code encodes. */
  @property({ attribute: false }) qrFor = (text: string): Promise<string> =>
    toDataURL(text, { margin: 1, width: 192 });

  @state() private addingDevice = false;
  @state() private deviceAddress = "";
  @state() private qr = "";
  /** The last device this dialog paired, and whether it was enabled rather than added. */
  @state() private added: { name: string; enabled: boolean } | null = null;
  /** The device whose open Pair dialog its own new ask replaced. */
  @state() private askedAgain: string | null = null;
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
  @state() private fieldRefusal: FieldRefusal = null;
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
    approved: [],
  };
  /** Edit's Shows offers it even when switched off; a save replaces it with what was saved. */
  @state() private editHeld: HeldBinding | null = null;
  @state() private editAttempted = false;
  @state() private editRefusal: FieldRefusal = null;
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
          this.#closeReplacedPair(value);
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

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("canManageReaders") && !this.canManageReaders) {
      this.readerState = "hidden";
      this.readerReadError = null;
      this.editRefusal = clearedRefusal(this.editRefusal, "reader");
    }
  }

  override updated(): void {
    clearTimeout(this.#staleTimer);
    this.#staleTimer = undefined;
    if (!this.isConnected) return;
    const now = this.now().getTime();
    const next = Math.min(
      ...this.devices
        .map(({ batteryLevel: level, batteryReportedAt: at }) =>
          level === null || at === null ? Infinity : batteryStaleAfter(at),
        )
        .filter((at) => at >= now),
    );
    // Stale is strictly older than the limit, so the first stale moment is a millisecond past it.
    if (next !== Infinity)
      this.#staleTimer = setTimeout(
        () => this.requestUpdate(),
        Math.min(next - now + 1, LONGEST_TIMER_MS),
      );
  }

  override disconnectedCallback(): void {
    clearTimeout(this.#staleTimer);
    this.#staleTimer = undefined;
    this.#endAdding();
    this.#endEdit();
    super.disconnectedCallback();
  }

  async #openAddDevice(): Promise<void> {
    if (this.addingDevice) return;
    const epoch = ++this.#addEpoch;
    this.addingDevice = true;
    this.added = null;
    this.askedAgain = null;
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
    this.added = null;
    this.askedAgain = null;
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
    void this.api
      .denyJoinRequest(request.id, { createdAt: request.createdAt })
      .catch((error: unknown) => {
        const code = codeOf(error);
        if (code !== "join_request.not_found" && this.addingDevice && addEpoch === this.#addEpoch)
          this.addError = code;
      });
  }

  /**
   * A returning device's new ask keeps its id and replaces the request the open dialog was made for,
   * numbers and claim included, so the dialog closes and sends no discard: the server would answer
   * one naming the replaced ask as already gone. A request that only left the list keeps the dialog
   * open: its next step is refused.
   */
  #closeReplacedPair(rows: readonly JoinRequestRow[]): void {
    const open = this.pairRequest;
    if (open === null || this.#pairSettled) return;
    const now = rows.find((row) => row.id === open.id);
    if (now === undefined || now.createdAt === open.createdAt) return;
    this.#pairSettled = true;
    void this.#closeModal("pair-modal").then(() => {
      this.#closePair();
      if (this.addingDevice) this.askedAgain = waitingName(now);
    });
  }

  async #openPair(request: JoinRequestRow): Promise<void> {
    this.#closePair();
    const epoch = ++this.#pairEpoch;
    this.#pairSettled = false;
    this.pairRequest = request;
    this.addError = null;
    this.added = null;
    this.askedAgain = null;
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

  /** A returning device starts from its own row; a profile, station or watcher since gone starts empty. */
  #toSettings(request: JoinRequestRow): void {
    const back = request.returning ?? null;
    const profileId =
      back !== null &&
      !back.profileRetired &&
      this.deviceProfiles.some((p) => p.id === back.profileId)
        ? back.profileId
        : "";
    this.pairStep = "settings";
    this.pairName = waitingName(request);
    this.chosenProfileId = profileId;
    this.chosenBinding = back === null ? "" : this.#activeBinding(back);
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
      await this.api.checkDeviceJoinNumber(request.id, {
        choice,
        holdId,
        createdAt: request.createdAt,
      });
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

  #pairErrors(): IdentityErrors {
    return withRefusal(this.#ownErrors(), this.fieldRefusal);
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
    const { stationId, watcherId } = bindingIds(this.#bindingShown() ? this.chosenBinding : "");
    const epoch = this.#pairEpoch;
    this.submitting = true;
    this.pairError = null;
    this.fieldRefusal = null;
    let result: { name: string };
    try {
      result = await this.api.acceptDeviceJoinRequest(request.id, {
        name: this.pairName.trim(),
        profileId: this.chosenProfileId,
        ...(stationId === null ? {} : { stationId }),
        ...(watcherId === null ? {} : { watcherId }),
      });
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      this.submitting = false;
      const field = refusedField(error, this.chosenBinding, [
        "name",
        "profile",
        ...(this.#bindingShown() ? (["binding"] as const) : []),
      ]);
      if (field === null) this.pairError = codeOf(error);
      else this.fieldRefusal = { field, code: codeOf(error) };
      return;
    }
    if (epoch !== this.#pairEpoch) return;
    this.#pairSettled = true;
    this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
    await this.#closeModal("pair-modal");
    this.#closePair();
    this.added = { name: result.name, enabled: Boolean(request.returning) };
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
        ? t("devices.watcher_disabled")
        : `${t("devices.watcher_prefix")}${name}`;
    }
    return this.#stationName(device.stationId);
  }

  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return formatIsoMinute(iso);
  }

  #battery(device: DeviceRow): TemplateResult {
    const id = device.id;
    if (device.batteryLevel === null)
      return html`<span data-test=${`device-battery-${id}`}
        >${t("devices.battery_not_reported")}</span
      >`;
    const at = device.batteryReportedAt;
    const stale = at !== null && this.now().getTime() > batteryStaleAfter(at);
    return html`<span data-test=${`device-battery-${id}`} part=${stale ? "battery-stale" : nothing}
      ><span data-test=${`device-battery-level-${id}`}>${device.batteryLevel}%</span>${
        device.batteryCharging
          ? html` <span aria-hidden="true" data-test=${`device-battery-mark-${id}`}
                >${CHARGING_MARK}</span
              ><span part="visually-hidden" data-test=${`device-battery-charging-${id}`}>
                ${t("devices.battery_charging")}</span
              >`
          : nothing
      }${
        stale
          ? html` <span part="battery-updated"
              >${relativeTime(t("devices.battery_updated"), at, { now: this.now })}</span
            >`
          : nothing
      }</span
    >`;
  }

  // ── The Edit dialog ──────────────────────────────────────────────────────────────────────────────

  /** The first printer in `ids` that is switched on, as the server's `firstUsablePrinters` picks. */
  #firstSwitchedOn(ids: readonly string[]): string {
    return ids.find((id) => this.printers.find((p) => p.id === id)?.active) ?? "";
  }

  /** The stored station or watcher as a Shows choice, or empty when it is gone or switched off. */
  #activeBinding(stored: { stationId: string | null; watcherId: string | null }): string {
    if (
      stored.stationId !== null &&
      this.stations.some((s) => s.id === stored.stationId && s.active)
    )
      return `station:${stored.stationId}`;
    if (
      stored.watcherId !== null &&
      this.watchers.some((w) => w.id === stored.watcherId && w.active)
    )
      return `watcher:${stored.watcherId}`;
    return "";
  }

  #openEdit(device: DeviceRow): void {
    const epoch = ++this.#editEpoch;
    this.editing = device;
    this.editHeld = heldBinding(device);
    this.editForm = {
      name: device.label,
      profileId: device.deviceProfileId ?? "",
      binding: this.editHeld?.value ?? this.#activeBinding(device),
      receiptPrinterId: device.receiptPrinterId ?? "",
      paymentSlipPrinterId: device.paymentSlipPrinterId ?? "",
      madeHere: device.madeHereStationIds,
      approved: device.approvedProfileIds,
    };
    this.editAttempted = false;
    this.editRefusal = null;
    this.editError = null;
    this.editSaving = false;
    this.readerState = this.canManageReaders ? "loading" : "hidden";
    this.readers = [];
    this.readerReadError = null;
    this.chosenReaderId = "";
    this.#storedReaderId = null;
    if (this.canManageReaders) void this.#loadReader(device.id, epoch);
  }

  /** The reader is the payments module's, under its own permission: without it the field is gone. */
  async #loadReader(deviceId: string, epoch: number): Promise<void> {
    try {
      const [{ readerId }, readers] = await Promise.all([
        this.api.getDeviceReader(deviceId),
        this.api.listReaders(),
      ]);
      if (epoch !== this.#editEpoch || this.readerState !== "loading") return;
      this.readers = readers.filter((reader) => reader.active);
      this.#storedReaderId = readerId;
      this.chosenReaderId = readerId ?? "";
      this.readerState = "ready";
    } catch (error) {
      if (epoch !== this.#editEpoch || this.readerState !== "loading") return;
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
    return withRefusal(
      { ...this.#editOwnErrors(), receipt: "", slip: "", reader: "", approved: "" },
      this.editRefusal,
    );
  }

  #setEdit(patch: Partial<EditForm>, ...fields: EditField[]): void {
    this.editForm = { ...this.editForm, ...patch };
    this.editRefusal = clearedRefusal(this.editRefusal, ...fields);
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
      "approved",
    );
  }

  /** The other live profiles of the chosen profile's form factor: the only ones the server approves. */
  #approvalChoices(): DeviceProfile[] {
    const chosen = this.deviceProfiles.find((p) => p.id === this.editForm.profileId);
    if (chosen === undefined) return [];
    return this.deviceProfiles.filter(
      (p) => p.formFactor === chosen.formFactor && p.id !== chosen.id,
    );
  }

  #approvedOf(ids: readonly string[]): string[] {
    return this.#approvalChoices()
      .filter((p) => ids.includes(p.id))
      .map((p) => p.id);
  }

  /**
   * Sent only when the ticked profiles differ from what the server keeps without them: the stored
   * approvals, the device's current profile among them, so an edit that leaves them alone says
   * nothing.
   */
  #approvalsToSend(device: DeviceRow): { approvedProfileIds?: string[] } {
    const ticked = this.#approvedOf(this.editForm.approved);
    const kept = this.#approvedOf(device.approvedProfileIds);
    const same = ticked.length === kept.length && ticked.every((id) => kept.includes(id));
    return same ? {} : { approvedProfileIds: ticked };
  }

  #onApprovedChange(profileId: string, checked: boolean): void {
    const rest = this.editForm.approved.filter((id) => id !== profileId);
    this.#setEdit({ approved: checked ? [...rest, profileId] : rest }, "approved");
  }

  /**
   * Switched-off printers are left out. While the profile is unchanged the device keeps the printer
   * it holds, so that one is offered even when switched off, and marked when the profile no longer
   * lists it.
   */
  #printerOptions(ids: readonly string[], held: string | null): { value: string; label: string }[] {
    const keep = this.editForm.profileId === this.editing?.deviceProfileId ? held : null;
    const listed = ids.flatMap((id) => {
      const printer = this.printers.find((p) => p.id === id);
      return printer !== undefined && (printer.active || printer.id === keep) ? [printer] : [];
    });
    const unlisted =
      keep === null || ids.includes(keep) ? undefined : this.printers.find((p) => p.id === keep);
    return [
      { value: "", label: t("devices.no_printer") },
      ...listed.map((p) => ({ value: p.id, label: printerLabel(p) })),
      ...(unlisted === undefined
        ? []
        : [
            {
              value: unlisted.id,
              label: `${printerLabel(unlisted)} (${t("devices.printer_not_on_profile_mark")})`,
            },
          ]),
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
    const epoch = this.#editEpoch;
    this.editSaving = true;
    this.editError = null;
    this.editRefusal = null;
    const savedBinding = this.#editBindingShown() ? form.binding : "";
    const picked = this.#bindingOptions().find((option) => option.value === savedBinding);
    const sent = {
      name: form.name.trim(),
      profileId: form.profileId,
      ...bindingIds(savedBinding),
      receiptPrinterId: form.receiptPrinterId === "" ? null : form.receiptPrinterId,
      paymentSlipPrinterId: form.paymentSlipPrinterId === "" ? null : form.paymentSlipPrinterId,
      ...(this.#editBindingShown() ? {} : { madeHereStationIds: this.#madeHereToSend() }),
      ...this.#approvalsToSend(device),
    };
    try {
      await this.api.updateDevice(device.id, sent);
    } catch (error) {
      if (epoch !== this.#editEpoch) return;
      this.editSaving = false;
      const field = refusedField(error, form.binding, [
        "name",
        "profile",
        ...(this.#editBindingShown() ? (["binding"] as const) : []),
        "receipt",
        "slip",
        ...(this.#approvalChoices().length > 0 ? (["approved"] as const) : []),
      ]);
      if (field === null) this.editError = codeOf(error);
      else this.editRefusal = { field, code: codeOf(error) };
      return;
    }
    this.#reloadDevices().catch((error: unknown) => this.#showReadError(error));
    if (epoch !== this.#editEpoch) return;
    if (savedBinding !== this.editHeld?.value)
      this.editHeld = picked === undefined ? null : { value: savedBinding, name: picked.label };
    // The reader save below can fail and keep the dialog open, which then edits what was just saved.
    const { name: label, profileId: deviceProfileId, approvedProfileIds, ...rest } = sent;
    this.editing = {
      ...device,
      ...rest,
      label,
      deviceProfileId,
      approvedProfileIds:
        approvedProfileIds === undefined
          ? device.approvedProfileIds
          : [deviceProfileId, ...approvedProfileIds],
    };
    const readerId = this.chosenReaderId === "" ? null : this.chosenReaderId;
    if (this.readerState === "ready" && readerId !== this.#storedReaderId) {
      // Saved separately: the reader belongs to the payments module and its own permission (spec §5).
      try {
        await this.api.setDeviceReader(device.id, readerId);
        if (epoch !== this.#editEpoch) return;
        this.#storedReaderId = readerId;
      } catch (error) {
        if (epoch !== this.#editEpoch) return;
        // Hidden since Save was pressed: the reader is no longer this session's to set, so the saved
        // device closes the dialog as any saved edit does.
        if (this.readerState === "ready") {
          this.editSaving = false;
          this.editRefusal = { field: "reader", code: codeOf(error) };
          return;
        }
      }
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
        >${t("action.edit")}</wt-button
      >
      <wt-button
        variant="danger"
        data-keep-open
        data-test=${`remove-${device.id}`}
        data-armed=${armed ? "true" : nothing}
        @click=${() => this.#onRemove(device.id)}
        >${armed ? t("devices.disable_confirm") : t("devices.disable")}</wt-button
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
        sortValue: (d) =>
          d.profileRetired ? t("devices.profile_deleted") : this.#profileName(d.deviceProfileId),
        cell: (d) =>
          html`<span data-test=${`device-profile-${d.id}`}
            >${
              d.profileRetired
                ? html`<span part="profile-retired">${t("devices.profile_deleted")}</span>`
                : this.#profileName(d.deviceProfileId)
            }</span
          >`,
      },
      {
        key: "shows",
        choosable: "shown",
        label: t("devices.shows"),
        cell: (d) =>
          html`<span data-test=${`device-station-${d.id}`}
            >${d.kind === "kds_station" ? this.#bindingName(d) : ""}</span
          >`,
      },
      {
        key: "battery",
        choosable: "shown",
        label: t("devices.column_battery"),
        sortValue: (d) => d.batteryLevel,
        cell: (d) => this.#battery(d),
      },
      {
        key: "status",
        choosable: "shown",
        label: t("devices.column_status"),
        cell: (d) =>
          html`<span data-test=${`device-status-${d.id}`}
            >${d.active ? t("devices.status_active") : t("devices.status_disabled")}</span
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
      .emptyMessage=${t("devices.no_devices")}
      >${this.devices.length === 0 ? this.#renderAddButton("empty-action") : nothing}</wt-data-table
    >`;
  }

  #renderAddButton(slot?: "empty-action"): TemplateResult {
    return html`<wt-button
      slot=${ifDefined(slot)}
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
          html`<span data-test=${`waiting-row-${request.id}`}>${waitingName(request)}</span>${
              request.returning
                ? html`<span part="returning-hint" data-test=${`returning-hint-${request.id}`}
                    >${t(
                      request.returning.profileRetired
                        ? "devices.enable_hint_profile_deleted"
                        : "devices.enable_hint",
                    )}</span
                  >`
                : nothing
            }`,
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
                aria-label=${`${pairAction(request)} ${waitingName(request)}`}
                ?disabled=${!held}
                @click=${() => void this.#openPair(request)}
                >${pairAction(request)}</wt-button
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
      .opener=${this.renderRoot.querySelector<HTMLElement>(".heading [data-test=open-add-device]")}
      .dismissible=${!this.submitting}
      @wt-close=${() => this.#endAdding()}
    >
      ${this.qr === "" ? nothing : html`<img class="qr" data-test="device-qr" src=${this.qr} alt=${t("devices.qr_alt")} />`}
      <p class="hint">
        ${before}<code data-test="device-address">${this.deviceAddress}</code>${after}
      </p>
      ${until === null ? nothing : html`<p class="hint" data-test="pairing-until">${relativeTime(t("devices.window_closes"), until, { deadline: true, now: this.now })}</p>`}
      ${holdNotice(this.holdStatus, () => void this.#hold.start())}
      ${
        this.added === null
          ? nothing
          : html`<p class="added" role="status" data-test="added-device">
              ${t(this.added.enabled ? "devices.enabled" : "devices.added").replace(
                "{name}",
                this.added.name,
              )}
            </p>`
      }
      ${
        this.askedAgain === null
          ? nothing
          : html`<p class="hint" role="status" data-test="asked-again">
              ${t("devices.asked_again").replace("{name}", this.askedAgain)}
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
    disabled = false,
    held: HeldBinding | null = null,
  ): TemplateResult {
    return html`<wt-input
        data-test=${`${prefix}-name`}
        name="name"
        required
        label=${t("devices.name")}
        .value=${live(values.name)}
        ?disabled=${disabled}
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
        ?disabled=${disabled}
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
              .options=${this.#bindingOptions(held)}
              .value=${values.binding}
              ?disabled=${disabled}
              .error=${errors.binding}
              .invalid=${errors.binding !== ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) => on.binding(e.detail.value)}
            ></wt-combobox>`
          : nothing
      }`;
  }

  /** The switched-on stations and watchers, plus `held` in its group, marked, when it is not one. */
  #bindingOptions(
    held: HeldBinding | null = null,
  ): { value: string; label: string; group: string }[] {
    const stationOptions = this.stations
      .filter((station) => station.active)
      .map((station) => ({
        value: `station:${station.id}`,
        label: station.name,
        group: t("devices.stations_group"),
      }));
    const watcherOptions = this.watchers
      .filter((watcher) => watcher.active)
      .map((watcher) => ({
        value: `watcher:${watcher.id}`,
        label: watcher.name,
        group: t("devices.watchers_group"),
      }));
    if (
      held !== null &&
      ![...stationOptions, ...watcherOptions].some((o) => o.value === held.value)
    ) {
      if (held.value.startsWith("station:"))
        stationOptions.push({
          value: held.value,
          label: `${held.name} (${t("devices.station_disabled_mark")})`,
          group: t("devices.stations_group"),
        });
      else
        watcherOptions.push({
          value: held.value,
          label: `${held.name} (${t("devices.watcher_disabled_mark")})`,
          group: t("devices.watchers_group"),
        });
    }
    return [...stationOptions, ...watcherOptions];
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
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, "name");
          },
          profile: (value) => {
            this.chosenProfileId = value;
            this.chosenBinding = "";
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, "profile", "binding");
          },
          binding: (value) => {
            this.chosenBinding = value;
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, "binding");
          },
        },
        this.submitting,
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
      heading=${pairTitle(request)}
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
                >${pairAction(request)}</wt-button
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
        ${this.#renderIdentityFields(
          "edit",
          form,
          errors,
          {
            name: (value) => this.#setEdit({ name: value }, "name"),
            profile: (value) => this.#onEditProfile(value),
            binding: (value) => this.#setEdit({ binding: value }, "binding"),
          },
          this.editSaving,
          this.editHeld,
        )}
        <wt-combobox
          data-test="edit-receipt-printer"
          name="receiptPrinterId"
          show-empty-option
          label=${t("devices.receipt_printer_now")}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#printerOptions(profile?.receiptPrinterIds ?? [], device.receiptPrinterId)}
          .value=${form.receiptPrinterId}
          ?disabled=${this.editSaving}
          .error=${errors.receipt}
          .invalid=${errors.receipt !== ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#setEdit({ receiptPrinterId: e.detail.value }, "receipt")}
        ></wt-combobox>
        <wt-combobox
          data-test="edit-slip-printer"
          name="paymentSlipPrinterId"
          show-empty-option
          label=${t("devices.slip_printer_now")}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#printerOptions(
            profile?.paymentSlipPrinterIds ?? [],
            device.paymentSlipPrinterId,
          )}
          .value=${form.paymentSlipPrinterId}
          ?disabled=${this.editSaving}
          .error=${errors.slip}
          .invalid=${errors.slip !== ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#setEdit({ paymentSlipPrinterId: e.detail.value }, "slip")}
        ></wt-combobox>
        ${this.#renderApproved(errors.approved)} ${kitchen ? nothing : this.#renderMadeHere()}
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
                ?disabled=${this.editSaving}
                @change=${(e: Event) =>
                  this.#onMadeHereChange(station.id, (e.target as HTMLInputElement).checked)}
              />
              ${station.name}</label
            >`,
        )}
    </fieldset>`;
  }

  #renderApproved(error: string): TemplateResult | typeof nothing {
    const choices = this.#approvalChoices();
    if (choices.length === 0) return nothing;
    return html`<fieldset class="made-here" data-test="edit-approved-profiles">
      <legend>${t("devices.approved_profiles")}</legend>
      <p class="hint">${t("devices.approved_profiles_hint")}</p>
      ${choices.map(
        (profile) =>
          html`<label class="check">
            <input
              type="checkbox"
              name="approvedProfileIds"
              value=${profile.id}
              .checked=${live(this.editForm.approved.includes(profile.id))}
              ?disabled=${this.editSaving}
              @change=${(e: Event) =>
                this.#onApprovedChange(profile.id, (e.target as HTMLInputElement).checked)}
            />
            ${profile.name}</label
          >`,
      )}
      ${
        error === ""
          ? nothing
          : html`<p class="field-error" data-test="edit-approved-error">${error}</p>`
      }
    </fieldset>`;
  }

  #renderReader(error: string): TemplateResult {
    return html`<wt-combobox
      data-test="edit-reader"
      name="defaultReaderId"
      show-empty-option
      label=${t("devices.default_reader")}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      ?disabled=${this.readerState !== "ready" || this.editSaving}
      .options=${[
        { value: "", label: t("devices.default_reader_none") },
        ...this.readers.map((r) => ({ value: r.id, label: this.#readerLabel(r) })),
      ]}
      .value=${this.chosenReaderId}
      .error=${error}
      .invalid=${error !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        this.chosenReaderId = e.detail.value;
        this.editRefusal = clearedRefusal(this.editRefusal, "reader");
      }}
    ></wt-combobox>`;
  }

  override render(): TemplateResult {
    return html`
      <div class="heading">
        <h1 class="title">${t("devices.title")}</h1>
        ${this.#renderAddButton()}
      </div>

      <section data-test="devices-panel">${this.#renderDevicesTable()}</section>

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
