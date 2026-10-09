import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  focusFirstInvalid,
  submitOnEnter,
  visuallyHiddenStyles,
  type DataTableColumn,
  type WtModal,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "@waitron/ui/src/components/wt-switch.js";
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
import type { StringKey } from "../i18n/strings.js";
import type {
  DashboardApi,
  DeviceKitchenScreen,
  DeviceProfile,
  DeviceRow,
  EquipmentRole,
  FloorZone,
  FormFactor,
  JoinRequestRow,
  KitchenScreenKind,
  KitchenScreenScope,
  PairingModeState,
  Printer,
  ProfileKitchenScreens,
  ProfileReaderList,
  ReaderHolderRow,
  ReaderRow,
  ResolvedKitchenScreen,
  ScreenSlot,
  Station,
} from "../api/client.js";

/** `screen` is a kitchen display's Screen, or a till's Pass choice; `stations` and `zones` are that
 * screen's lists; `kitchenStations` is a till's Kitchen screen list. */
type KitchenField = "screen" | "stations" | "zones" | "kitchenStations";
type PairField = "name" | "profile" | KitchenField;
type EditField = PairField | "receipt" | "slip" | "drawer" | "reader" | "approved";
type IdentityErrors = Record<PairField, string>;
const NO_KITCHEN_ERRORS: Record<KitchenField, string> = {
  screen: "",
  stations: "",
  zones: "",
  kitchenStations: "",
};

/** A device's kitchen screen choice by kind: a kitchen display holds one; a till or handheld may
 * hold a station screen and one of the pass screen and the pass monitor. */
type KitchenDraft = Partial<Record<KitchenScreenKind, KitchenScreenScope>>;
const KITCHEN_KINDS = ["station", "pass", "pass_monitor"] as const;
const PASS_KINDS = ["pass", "pass_monitor"] as const;
const SHARED_DISPLAY: FormFactor = "kds";
const EVERY: KitchenScreenScope = { stationIds: null, zoneIds: null };

/** A gone entry the Edit dialog lists: a station or zone, or with no name the whole kind. */
interface GoneEntry {
  kind: KitchenScreenKind;
  name: string | null;
}

/** What a narrowing took, as the read marks it, each kind's after it, a kind taken whole alone.
 * A station or zone switched off on its own page is not among them: it stays in the choice. */
function goneFromRead(read: readonly ResolvedKitchenScreen[]): GoneEntry[] {
  return read.flatMap((screen): GoneEntry[] =>
    screen.available
      ? [...screen.stations, ...(screen.zones ?? [])]
          .filter((slot) => !slot.available && !slot.switchedOff)
          .map((slot) => ({ kind: screen.kind, name: slot.name }))
      : [{ kind: screen.kind, name: null }],
  );
}

/** `ids` in the venue's order, so two drafts holding the same entries compare equal. */
function ordered(
  ids: readonly string[] | null,
  places: readonly { id: string }[],
): string[] | null {
  return ids === null ? null : places.filter((place) => ids.includes(place.id)).map((p) => p.id);
}
/** `sentence`, when set, is what the field says in place of the code's own message. */
type FieldRefusal = { field: EditField; code: string; sentence?: string } | null;

/** A printer role the Edit dialog offers, with the device column and profile default it reads. */
const PRINTER_ROLES = [
  {
    field: "receipt",
    form: "receiptPrinterId",
    list: "receiptPrinterIds",
    defaultKey: "receiptPrinterDefaultId",
    test: "edit-receipt-printer",
    label: "devices.receipt_printer_now",
  },
  {
    field: "slip",
    form: "paymentSlipPrinterId",
    list: "paymentSlipPrinterIds",
    defaultKey: "paymentSlipPrinterDefaultId",
    test: "edit-slip-printer",
    label: "devices.slip_printer_now",
  },
  {
    field: "drawer",
    form: "cashDrawerPrinterId",
    list: "cashDrawerPrinterIds",
    defaultKey: "cashDrawerPrinterDefaultId",
    test: "edit-cash-drawer",
    label: "devices.cash_drawer_now",
  },
] as const;

/** What a refusal about equipment says under its field, when the code's own message is too vague. */
function equipmentSentence(error: unknown, field: EditField): string | undefined {
  const code = codeOf(error);
  const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
  if (code === "device.equipment_held" && typeof params.holderDeviceName === "string")
    return t("devices.err_equipment_held").replace("{device}", params.holderDeviceName);
  if (code === "reader.payment_in_progress") return t("devices.err_reader_busy");
  if (code === "device.binding_invalid" && field === "reader")
    return t("devices.err_reader_not_allowed");
  return undefined;
}

/** Refusals of a Pair or Edit save about one field, by code alone; others read their params first. */
const FIELD_BY_CODE: Record<string, EditField> = {
  "device.name_taken": "name",
  "kitchen_screen.required": "screen",
  "kitchen_screen.zone_not_allowed": "zones",
  "device_profile.not_found": "profile",
  "device_profile.incompatible": "approved",
};

const FIELD_BY_PARAM: Record<string, EditField> = {
  name: "name",
  profileId: "profile",
  receiptPrinterId: "receipt",
  paymentSlipPrinterId: "slip",
  cashDrawerPrinterId: "drawer",
  cardReaderId: "reader",
  approvedProfileIds: "approved",
};

const CHOICE_FIELD: Record<string, KitchenField> = {
  screens: "screen",
  stationIds: "stations",
  zoneIds: "zones",
};

/**
 * The field a refusal is about, when it is one of `shown` (CLAUDE.md §3: by what the error carries).
 * A till's choice may hold two station lists; a refusal about stations names its screen.
 */
function refusedField(
  error: unknown,
  sharedDisplay: boolean,
  shown: readonly EditField[],
): EditField | null {
  const code = codeOf(error);
  const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
  let field: EditField | undefined;
  // An unknown approved profile names its field; an unknown active profile names none.
  const named = code === "device_profile.not_found" && typeof params.field === "string";
  if (
    code === "management.request_invalid" ||
    code === "device.binding_invalid" ||
    code === "device.equipment_held" ||
    named
  )
    field = typeof params.field === "string" ? FIELD_BY_PARAM[params.field] : undefined;
  else if (code === "kitchen_screen.not_allowed")
    field = !sharedDisplay && params.screen === "station" ? "kitchenStations" : "screen";
  else if (code === "kitchen_screen.invalid") {
    field = typeof params.field === "string" ? CHOICE_FIELD[params.field] : undefined;
    if (field === "stations" && !sharedDisplay && params.screen === "station")
      field = "kitchenStations";
  } else if (code === "station.not_allowed")
    field = !sharedDisplay && params.screen === "station" ? "kitchenStations" : "stations";
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
    byField[refused.field] = refused.sentence ?? codeMessage(refused.code);
  return errors;
}

/** Changing a field clears a refusal about it. */
function clearedRefusal(refused: FieldRefusal, ...fields: EditField[]): FieldRefusal {
  return refused !== null && fields.includes(refused.field) ? null : refused;
}

interface EditForm {
  name: string;
  profileId: string;
  screens: KitchenDraft;
  /** Empty for Use default. */
  receiptPrinterId: string;
  paymentSlipPrinterId: string;
  cashDrawerPrinterId: string;
  madeHere: string[];
  /** Ticked profiles staff may switch to; only those {@link DevicesScreen} offers are sent. */
  approved: string[];
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

/** The table's equipment columns, one per role, drawn after Shows. */
const EQUIPMENT_COLUMNS = [
  { key: "receipt", role: "receipt", label: "devices.receipt_printer_now" },
  { key: "slip", role: "payment_slip", label: "devices.slip_printer_now" },
  { key: "drawer", role: "cash_drawer", label: "devices.cash_drawer_now" },
  { key: "reader", role: "card_terminal", label: "devices.default_reader" },
] as const satisfies readonly { key: string; role: EquipmentRole; label: StringKey }[];

/** What the role uses now, or None, marked when it comes from the profile's default. */
function equipmentName(device: DeviceRow, role: EquipmentRole): string {
  const equipment = device.equipment.find((entry) => entry.role === role);
  const name = equipment?.resolved?.name ?? t("equipment.none");
  return equipment === undefined || equipment.selection === "default"
    ? `${name} (${t("devices.default_mark")})`
    : name;
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
      .group-heading {
        display: block;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        margin-bottom: var(--wt-space-2);
      }
      .toggles {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
      }
      .nested {
        display: grid;
        gap: var(--wt-space-3);
        margin-inline-start: var(--wt-space-5);
        padding-inline-start: var(--wt-space-3);
        border-inline-start: 1px solid var(--wt-color-border);
      }
      .gone {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
        color: var(--wt-color-text-muted);
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
  @state() private zones: FloorZone[] = [];
  @state() private kitchenScreens: { profileId: string; screens: ProfileKitchenScreens }[] = [];
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
  @state() private hasJoined = false;
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
  @state() private chosenScreens: KitchenDraft = {};
  @state() private formAttempted = false;
  @state() private fieldRefusal: FieldRefusal = null;
  /** Set once the server has approved or deleted the request, so closing Pair has nothing to discard. */
  #pairSettled = false;
  #pairEpoch = 0;
  #joinVersion = 0;
  #pairLeave?: LeaveCoordinator;
  #pairScope?: DraftScope<Parameters<DashboardApi["acceptDeviceJoinRequest"]>[1]>;
  readonly #beforePairClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#pairLeave ||
    (await this.#pairLeave.request({
      scopes: this.#pairScope ? [this.#pairScope.id] : [],
      reason,
      proceed() {},
    })) === "proceeded";

  #pairPayload(): Parameters<DashboardApi["acceptDeviceJoinRequest"]>[1] {
    return {
      name: this.pairName.trim(),
      profileId: this.chosenProfileId,
      kitchenScreens: this.#screensPayload(this.chosenScreens),
    };
  }

  #registerPairDraft(): void {
    this.#pairScope?.dispose();
    this.#pairLeave = leaveCoordinatorFor(this);
    this.#pairScope = this.#pairLeave?.register({
      id: {},
      current: () => this.#pairPayload(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) =>
        a.name === b.name &&
        a.profileId === b.profileId &&
        JSON.stringify(a.kitchenScreens) === JSON.stringify(b.kitchenScreens),
      restore: () => {},
    });
  }
  @state() private armedRemoveId: string | null = null;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  @state() private editing: DeviceRow | null = null;
  @state() private editForm: EditForm = {
    name: "",
    profileId: "",
    screens: {},
    receiptPrinterId: "",
    paymentSlipPrinterId: "",
    cashDrawerPrinterId: "",
    madeHere: [],
    approved: [],
  };
  /** What the read marks no longer available, listed outside the draft until a save clears it. */
  @state() private editGone: GoneEntry[] = [];
  /** The kitchen screens the dialog opened with or last saved, as a request carries them. */
  #editSavedScreens = "[]";
  #editOpenProfileId = "";
  @state() private editAttempted = false;
  @state() private editRefusal: FieldRefusal = null;
  @state() private editError: string | null = null;
  @state() private editSaving = false;
  /** "hidden" when the person may not manage card readers. */
  @state() private readerState: "loading" | "ready" | "hidden" | "failed" = "loading";
  @state() private readers: ReaderRow[] = [];
  @state() private readerReadError: string | null = null;
  @state() private chosenReaderId = "";
  /** Who holds each reader and where a payment is in progress, read with the Edit dialog's readers. */
  @state() private readerHolders = new Map<string, ReaderHolderRow>();
  /** Each profile's card readers, read as the Edit dialog needs them. */
  @state() private profileReaders = new Map<string, ProfileReaderList>();
  #storedReaderId: string | null = null;
  /** Set when the profile changes before the reader has loaded, so the late load keeps Use default. */
  #profileChangedWhileReaderLoads = false;
  #editEpoch = 0;
  #editLeave?: LeaveCoordinator;
  #editScope?: DraftScope<Parameters<DashboardApi["updateDevice"]>[1]>;
  #readerScope?: DraftScope<string>;
  readonly #beforeEditClose = async (reason: LeaveReason): Promise<boolean> => {
    const scopes = [this.#editScope, this.#readerScope].flatMap((scope) =>
      scope ? [scope.id] : [],
    );
    return (
      !this.#editLeave ||
      (await this.#editLeave.request({ scopes, reason, proceed() {} })) === "proceeded"
    );
  };

  #editPayload() {
    const form = this.editForm;
    return {
      name: form.name.trim(),
      profileId: form.profileId,
      ...(this.#sendScreens() ? { kitchenScreens: this.#screensPayload(form.screens) } : {}),
      receiptPrinterId: form.receiptPrinterId === "" ? null : form.receiptPrinterId,
      paymentSlipPrinterId: form.paymentSlipPrinterId === "" ? null : form.paymentSlipPrinterId,
      // Absent leaves the stored drawer choice alone, so only a changed one is sent.
      ...(form.cashDrawerPrinterId === (this.editing!.cashDrawerPrinterId ?? "")
        ? {}
        : {
            cashDrawerPrinterId: form.cashDrawerPrinterId === "" ? null : form.cashDrawerPrinterId,
          }),
      ...(this.#sharedDisplay(form.profileId)
        ? {}
        : { madeHereStationIds: this.#madeHereToSend() }),
      ...this.#approvalsToSend(this.editing!),
    };
  }

  /** Carries the drawer and approvals whether or not the request does: once they are saved, the
   * request omits them. */
  #editSnapshot() {
    const drawer = this.editForm.cashDrawerPrinterId;
    return {
      ...this.#editPayload(),
      kitchenScreens: this.#screensPayload(this.editForm.screens),
      cashDrawerPrinterId: drawer === "" ? null : drawer,
      approvedProfileIds: this.#approvedOf(this.editForm.approved),
    };
  }

  #registerEditDraft(): void {
    const { coordinator, scope } = draftScopeFor(this, {
      id: {},
      current: () => this.#editSnapshot(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) =>
        a.name === b.name &&
        a.profileId === b.profileId &&
        JSON.stringify(a.kitchenScreens) === JSON.stringify(b.kitchenScreens) &&
        a.receiptPrinterId === b.receiptPrinterId &&
        a.paymentSlipPrinterId === b.paymentSlipPrinterId &&
        a.cashDrawerPrinterId === b.cashDrawerPrinterId &&
        (a.approvedProfileIds ?? []).length === (b.approvedProfileIds ?? []).length &&
        (a.approvedProfileIds ?? []).every((id) => b.approvedProfileIds?.includes(id)) &&
        (a.madeHereStationIds === undefined
          ? b.madeHereStationIds === undefined
          : b.madeHereStationIds !== undefined &&
            a.madeHereStationIds.length === b.madeHereStationIds.length &&
            a.madeHereStationIds.every((id) => b.madeHereStationIds!.includes(id))),
      restore: () => {},
    });
    this.#editLeave = coordinator;
    this.#editScope = scope;
  }

  /** One Save covers the device and, once it has loaded, its card reader. */
  #editSaveState() {
    return saveActionState({
      isDirty: () => Boolean(this.#editScope?.isDirty() || this.#readerScope?.isDirty()),
    });
  }

  #disposeReaderDraft(): void {
    this.#readerScope?.dispose();
    this.#readerScope = undefined;
  }

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
        this.#queries.watch("listZones", [], (value) => {
          this.zones = value;
        }),
        this.#queries.watch("listDeviceProfiles", [], (value) => {
          this.deviceProfiles = value;
        }),
        this.#queries.watch("listProfileKitchenScreens", [], (value) => {
          this.kitchenScreens = value;
        }),
        this.#queries.watch("listPrinters", [], (value) => {
          this.printers = value;
        }),
        this.#queries.watch("pairingMode", [], (value) => {
          this.pairing = value;
        }),
        this.#queries.watch("joinRequests", ["device"], (value) => {
          this.#applyJoins(value);
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
      this.#disposeReaderDraft();
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

  async #openAddDevice(more = false): Promise<void> {
    if (this.addingDevice && !more) return;
    const epoch = ++this.#addEpoch;
    this.addingDevice = true;
    this.hasJoined = more;
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
      if (more) {
        const version = this.#joinVersion;
        const requests = await this.api.joinRequests("device");
        // A live snapshot or successful pairing supersedes this reopening read.
        if (epoch === this.#addEpoch && version === this.#joinVersion) this.#applyJoins(requests);
      }
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

  async #finishPair(epoch: number, reason: "saved" | "security"): Promise<void> {
    if (epoch !== this.#pairEpoch) return;
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=pair-modal]");
    modal?.closeAfter(reason);
    if (modal) await modal.updateComplete;
    if (epoch === this.#pairEpoch) this.#closePair();
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
    this.#pairScope?.dispose();
    this.#pairScope = undefined;
    this.#pairLeave = undefined;
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

  #applyJoins(rows: JoinRequestRow[]): void {
    this.#joinVersion++;
    this.pendingJoins = rows;
    this.#closeReplacedPair(rows);
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
    const epoch = this.#pairEpoch;
    const addEpoch = this.#addEpoch;
    void this.#finishPair(epoch, "security").then(() => {
      if (this.addingDevice && addEpoch === this.#addEpoch) this.askedAgain = waitingName(now);
    });
  }

  async #openPair(request: JoinRequestRow): Promise<void> {
    this.#closePair();
    const epoch = ++this.#pairEpoch;
    const addEpoch = this.#addEpoch;
    await this.updateComplete;
    if (
      !this.isConnected ||
      !this.addingDevice ||
      addEpoch !== this.#addEpoch ||
      epoch !== this.#pairEpoch
    )
      return;
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

  /** A returning device starts from its own row; a profile since gone starts empty, and so does a
   * kitchen screen entry its profile no longer offers. */
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
    this.chosenScreens =
      back === null || profileId === "" ? {} : this.#draftFromRead(back.kitchenScreens, profileId);
    this.formAttempted = false;
    this.fieldRefusal = null;
    this.pairError = null;
    this.#registerPairDraft();
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
      this.#joinVersion++;
      this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
      await this.#finishPair(epoch, "security");
      this.addError = code;
    }
  }

  /** The checks Pair and Edit share, which hold the action disabled once a submission was tried. */
  #identityErrors(
    attempted: boolean,
    values: { name: string; profileId: string; screens: KitchenDraft },
  ): IdentityErrors {
    if (!attempted) return { name: "", profile: "", ...NO_KITCHEN_ERRORS };
    const { profileId, screens } = values;
    const shared = this.#sharedDisplay(profileId);
    const main = this.#mainKind(screens, profileId);
    const scope = main === "" ? undefined : screens[main];
    const empty = t("device_profiles.err_list_empty");
    return {
      name: values.name.trim() === "" ? t("form.name_required") : "",
      profile: profileId === "" ? t("devices.join_pick_profile") : "",
      screen: shared && main === "" ? codeMessage("kitchen_screen.required") : "",
      stations: scope?.stationIds?.length === 0 ? empty : "",
      zones: scope?.zoneIds?.length === 0 ? empty : "",
      kitchenStations: !shared && screens.station?.stationIds?.length === 0 ? empty : "",
    };
  }

  #ownErrors(): IdentityErrors {
    return this.#identityErrors(this.formAttempted, {
      name: this.pairName,
      profileId: this.chosenProfileId,
      screens: this.chosenScreens,
    });
  }

  #pairErrors(): IdentityErrors {
    return withRefusal(this.#ownErrors(), this.fieldRefusal);
  }

  async #submitPair(): Promise<void> {
    const request = this.pairRequest;
    if (request === null || this.submitting || this.#pairSettled) return;
    this.formAttempted = true;
    if (Object.values(this.#ownErrors()).some((error) => error !== "")) {
      void this.updateComplete.then(() => {
        const modal = this.renderRoot.querySelector("[data-test=pair-modal]");
        if (modal) void focusFirstInvalid(modal);
      });
      return;
    }
    const submitted = this.#pairPayload();
    const scope = this.#pairScope;
    const epoch = this.#pairEpoch;
    this.submitting = true;
    this.pairError = null;
    this.fieldRefusal = null;
    let result: { name: string };
    try {
      result = await this.api.acceptDeviceJoinRequest(request.id, submitted);
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      this.submitting = false;
      const profileId = this.chosenProfileId;
      const field = refusedField(error, this.#sharedDisplay(profileId), [
        "name",
        "profile",
        ...this.#kitchenShown(profileId, this.chosenScreens),
      ]);
      if (field === null) this.pairError = codeOf(error);
      else this.fieldRefusal = { field, code: codeOf(error) };
      return;
    }
    if (epoch !== this.#pairEpoch) return;
    scope?.commit(submitted);
    this.submitting = false;
    this.#pairSettled = true;
    this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
    this.hasJoined = true;
    this.#addEpoch++;
    this.#hold.stop();
    this.added = { name: result.name, enabled: Boolean(request.returning) };
    if (!scope?.isDirty()) await this.#finishPair(epoch, "saved");
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

  /** "Station screen: Cocina, Barra (Deli no longer available)", one per screen the read holds. */
  #screenLine(screen: ResolvedKitchenScreen): string {
    const kind = t(`device_profiles.kitchen_screen.${screen.kind}`);
    const gone = (names: string[]) =>
      t(names.length === 1 ? "devices.readout_gone_one" : "devices.readout_gone_many").replace(
        "{names}",
        names.join(", "),
      );
    if (!screen.available) return `${kind} ${gone([kind])}`;
    const named = (slots: readonly ScreenSlot[], every: boolean, label: string) =>
      every
        ? label
        : slots
            .filter((slot) => slot.available)
            .map((slot) => slot.name)
            .join(", ");
    const lost = [...screen.stations, ...(screen.zones ?? [])]
      .filter((slot) => !slot.available)
      .map((slot) => slot.name);
    const tail = lost.length === 0 ? "" : ` ${gone(lost)}`;
    if (!screen.stations.some((slot) => slot.available)) return `${kind}${tail}`;
    const stations = named(
      screen.stations,
      screen.everyStation,
      t("devices.readout_every_station"),
    );
    if (screen.kind === "station") return `${kind}: ${stations}${tail}`;
    const zones =
      screen.zones === null
        ? t("devices.readout_every_zone")
        : named(screen.zones, screen.everyZone, t("devices.readout_every_zone"));
    return `${kind}: ${stations} · ${zones}${tail}`;
  }

  #renderScreens(device: DeviceRow): TemplateResult {
    const lines = device.kitchenScreens;
    return html`<span data-test=${`device-screens-${device.id}`}
      >${
        lines.length === 0 && device.kind === "kds_station"
          ? t("devices.no_kitchen_screen")
          : lines.map(
              (screen, index) =>
                html`${index === 0 ? nothing : html`<br />`}<span
                    data-test=${`device-screen-${device.id}-${screen.kind}`}
                    >${this.#screenLine(screen)}</span
                  >`,
            )
      }</span
    >`;
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

  #openEdit(device: DeviceRow): void {
    this.#endEdit();
    const epoch = ++this.#editEpoch;
    this.editing = device;
    const profileId = device.deviceProfileId ?? "";
    const screens = this.#draftFromRead(device.kitchenScreens, profileId, true);
    this.editGone = goneFromRead(device.kitchenScreens);
    this.#editSavedScreens = JSON.stringify(this.#screensPayload(screens));
    this.#editOpenProfileId = profileId;
    this.editForm = {
      name: device.label,
      profileId,
      screens,
      receiptPrinterId: device.receiptPrinterId ?? "",
      paymentSlipPrinterId: device.paymentSlipPrinterId ?? "",
      cashDrawerPrinterId: device.cashDrawerPrinterId ?? "",
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
    this.#profileChangedWhileReaderLoads = false;
    this.readerHolders = new Map();
    this.profileReaders = new Map();
    this.#registerEditDraft();
    if (this.canManageReaders) void this.#loadReader(device, epoch);
  }

  /** The reader is the payments module's, under its own permission: without it the field is gone. */
  async #loadReader(device: DeviceRow, epoch: number): Promise<void> {
    const profileId = device.deviceProfileId;
    try {
      const [{ readerId }, readers, holders, list] = await Promise.all([
        this.api.getDeviceReader(device.id),
        this.api.listReaders(),
        this.api.listReaderHolders(),
        profileId === null ? null : this.api.getProfileReaders(profileId),
      ]);
      if (epoch !== this.#editEpoch || this.readerState !== "loading") return;
      this.readers = readers.filter((reader) => reader.active);
      this.readerHolders = new Map(holders.map((row) => [row.readerId, row]));
      if (profileId !== null && list !== null) this.profileReaders = new Map([[profileId, list]]);
      this.#storedReaderId = readerId;
      this.chosenReaderId = readerId ?? "";
      this.readerState = "ready";
      this.#readerScope = draftScopeFor(this, {
        id: {},
        current: () => this.chosenReaderId,
        snapshot: (value: string) => value,
        equal: (a, b) => a === b,
        restore: () => {},
      }).scope;
      if (this.#profileChangedWhileReaderLoads) {
        this.chosenReaderId = "";
        this.#readerScope?.changed();
        const chosen = this.editForm.profileId;
        if (!this.profileReaders.has(chosen)) void this.#loadProfileReaders(chosen, epoch);
      }
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
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.#disposeReaderDraft();
    this.#editLeave = undefined;
    this.editing = null;
    this.editSaving = false;
  }

  /** Sent only when the choice or the profile changed: the server replaces the whole stored choice
   * and forgets the device's removals, which only a pick may do (decision 21). */
  #sendScreens(): boolean {
    return (
      this.editForm.profileId !== this.#editOpenProfileId ||
      JSON.stringify(this.#screensPayload(this.editForm.screens)) !== this.#editSavedScreens
    );
  }

  #editOwnErrors(): IdentityErrors {
    return this.#identityErrors(this.editAttempted, this.editForm);
  }

  #editErrors(): Record<EditField, string> {
    return withRefusal(
      { ...this.#editOwnErrors(), receipt: "", slip: "", drawer: "", reader: "", approved: "" },
      this.editRefusal,
    );
  }

  #setEdit(patch: Partial<EditForm>, ...fields: EditField[]): void {
    this.editForm = { ...this.editForm, ...patch };
    this.editRefusal = clearedRefusal(this.editRefusal, ...fields);
    this.#editScope?.changed();
  }

  /** A new profile's lists decide what the device may use, so every choice goes to Use default. */
  #onEditProfile(profileId: string): void {
    this.#setEdit(
      {
        profileId,
        screens: this.#fitted(this.editForm.screens, profileId),
        receiptPrinterId: "",
        paymentSlipPrinterId: "",
        cashDrawerPrinterId: "",
      },
      "profile",
      "screen",
      "stations",
      "zones",
      "kitchenStations",
      "receipt",
      "slip",
      "drawer",
      "reader",
      "approved",
    );
    this.chosenReaderId = "";
    this.#readerScope?.changed();
    if (this.readerState === "loading") this.#profileChangedWhileReaderLoads = true;
    if (this.readerState === "ready" && !this.profileReaders.has(profileId))
      void this.#loadProfileReaders(profileId, this.#editEpoch);
  }

  async #loadProfileReaders(profileId: string, epoch: number): Promise<void> {
    try {
      const list = await this.api.getProfileReaders(profileId);
      if (epoch !== this.#editEpoch) return;
      this.profileReaders = new Map([...this.profileReaders, [profileId, list]]);
    } catch (error) {
      if (epoch !== this.#editEpoch) return;
      this.readerReadError = codeOf(error);
    }
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

  /** Another device holding a portable printer; a cash drawer is never held. */
  #printerHolder(printer: Printer, drawer: boolean): string | null {
    const holder = printer.holder;
    if (drawer || !printer.portable || holder === null || holder.deviceId === this.editing?.id)
      return null;
    return holder.deviceName;
  }

  #printerChoiceLabel(printer: Printer, drawer: boolean): string {
    const holder = this.#printerHolder(printer, drawer);
    return holder === null
      ? printerLabel(printer)
      : `${printerLabel(printer)} (${t("equipment.carried_by").replace("{device}", holder)})`;
  }

  /** What Use default gives this device: the profile's default, unless another device carries it. */
  #useDefaultLabel(name: string | null): string {
    return t("devices.use_default").replace("{name}", name ?? t("equipment.none"));
  }

  /**
   * Use default first, naming what it resolves to; then the profile's switched-on printers, each
   * another device carries marked. While the profile is unchanged the device keeps the printer it
   * chose, so that one is offered even when switched off, and marked when the profile no longer
   * lists it.
   */
  #printerOptions(
    role: (typeof PRINTER_ROLES)[number],
    profile: DeviceProfile | undefined,
    held: string | null,
  ): { value: string; label: string }[] {
    const ids = profile?.[role.list] ?? [];
    const drawer = role.field === "drawer";
    const keep = this.editForm.profileId === this.editing?.deviceProfileId ? held : null;
    const listed = ids.flatMap((id) => {
      const printer = this.printers.find((p) => p.id === id);
      return printer !== undefined && (printer.active || printer.id === keep) ? [printer] : [];
    });
    const unlisted =
      keep === null || ids.includes(keep) ? undefined : this.printers.find((p) => p.id === keep);
    const fallback = this.printers.find((p) => p.id === profile?.[role.defaultKey]);
    const resolved =
      fallback === undefined || this.#printerHolder(fallback, drawer) !== null
        ? null
        : printerLabel(fallback);
    return [
      { value: "", label: this.#useDefaultLabel(resolved) },
      ...listed.map((p) => ({ value: p.id, label: this.#printerChoiceLabel(p, drawer) })),
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

  /** Another device's hold on a reader, or its payment in progress there, as a mark on its name. */
  #readerChoiceLabel(reader: ReaderRow): string {
    const row = this.readerHolders.get(reader.id);
    const own = this.editing?.id;
    if (row?.paymentInProgressDeviceIds.some((id) => id !== own))
      return `${this.#readerLabel(reader)} (${t("equipment.busy")})`;
    if (row?.holder && row.holder.deviceId !== own)
      return `${this.#readerLabel(reader)} (${t("equipment.carried_by").replace("{device}", row.holder.deviceName)})`;
    return this.#readerLabel(reader);
  }

  /** Use default first, then the chosen profile's switched-on readers in its order. */
  #readerOptions(): { value: string; label: string }[] {
    const list = this.profileReaders.get(this.editForm.profileId);
    const listed = (list?.readerIds ?? []).flatMap((id) => {
      const reader = this.readers.find((r) => r.id === id);
      return reader === undefined ? [] : [reader];
    });
    const fallback = this.readers.find((r) => r.id === list?.defaultReaderId);
    const holder = fallback && this.readerHolders.get(fallback.id)?.holder;
    const resolved =
      fallback === undefined || (holder && holder.deviceId !== this.editing?.id)
        ? null
        : this.#readerLabel(fallback);
    return [
      { value: "", label: this.#useDefaultLabel(resolved) },
      ...listed.map((reader) => ({ value: reader.id, label: this.#readerChoiceLabel(reader) })),
    ];
  }

  async #submitEdit(): Promise<void> {
    const device = this.editing;
    if (device === null || this.editSaving || this.#editSaveState().unchanged) return;
    this.editAttempted = true;
    if (Object.values(this.#editOwnErrors()).some((error) => error !== "")) {
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
    const sent = this.#editPayload();
    const submittedDevice = this.#editSnapshot();
    const editScope = this.#editScope;
    const readerScope = this.#readerScope;
    const submittedReader = this.chosenReaderId;
    try {
      await this.api.updateDevice(device.id, sent);
    } catch (error) {
      if (epoch !== this.#editEpoch) return;
      this.editSaving = false;
      const field = refusedField(error, this.#sharedDisplay(form.profileId), [
        "name",
        "profile",
        ...this.#kitchenShown(form.profileId, form.screens),
        "receipt",
        "slip",
        "drawer",
        ...(this.#approvalChoices().length > 0 ? (["approved"] as const) : []),
      ]);
      if (field === null) this.editError = codeOf(error);
      else
        this.editRefusal = {
          field,
          code: codeOf(error),
          sentence: equipmentSentence(error, field),
        };
      return;
    }
    if (epoch === this.#editEpoch) editScope?.commit(submittedDevice);
    this.#reloadDevices().catch((error: unknown) => this.#showReadError(error));
    if (epoch !== this.#editEpoch) return;
    if (sent.kitchenScreens !== undefined) {
      this.editGone = [];
      this.#editSavedScreens = JSON.stringify(sent.kitchenScreens);
    }
    // The reader save below can fail and keep the dialog open, which then edits what was just saved.
    const { name: label, profileId: deviceProfileId, approvedProfileIds } = sent;
    this.editing = {
      ...device,
      receiptPrinterId: sent.receiptPrinterId,
      paymentSlipPrinterId: sent.paymentSlipPrinterId,
      ...(sent.cashDrawerPrinterId === undefined
        ? {}
        : { cashDrawerPrinterId: sent.cashDrawerPrinterId }),
      ...(sent.madeHereStationIds === undefined
        ? {}
        : { madeHereStationIds: sent.madeHereStationIds }),
      label,
      deviceProfileId,
      approvedProfileIds:
        approvedProfileIds === undefined
          ? device.approvedProfileIds
          : [deviceProfileId, ...approvedProfileIds],
    };
    const readerId = submittedReader === "" ? null : submittedReader;
    if (this.readerState === "ready" && readerId !== this.#storedReaderId) {
      // Saved separately: the reader belongs to the payments module and its own permission (spec §5).
      try {
        await this.api.setDeviceReader(device.id, readerId);
        if (epoch !== this.#editEpoch) return;
        this.#storedReaderId = readerId;
        readerScope?.commit(submittedReader);
      } catch (error) {
        if (epoch !== this.#editEpoch) return;
        // Hidden since Save was pressed: the reader is no longer this session's to set, so the saved
        // device closes the dialog as any saved edit does.
        if (this.readerState === "ready") {
          this.editSaving = false;
          this.editRefusal = {
            field: "reader",
            code: codeOf(error),
            sentence: equipmentSentence(error, "reader"),
          };
          return;
        }
      }
    }
    this.editSaving = false;
    if (editScope?.isDirty() || this.#readerScope?.isDirty()) return;
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=edit-device-modal]");
    modal?.closeAfter("saved");
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
        filter: {
          label: t("devices.device_profile"),
          allLabel: t("devices.filter_profile_all"),
          value: (d) => (d.profileRetired ? "retired" : (d.deviceProfileId ?? "none")),
          options: [
            ...this.deviceProfiles.map((profile) => ({ value: profile.id, label: profile.name })),
            { value: "none", label: t("equipment.none") },
            { value: "retired", label: t("devices.profile_deleted") },
          ],
        },
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
        cell: (d) => this.#renderScreens(d),
      },
      ...EQUIPMENT_COLUMNS.filter(
        (column) => column.role !== "card_terminal" || this.canManageReaders,
      ).map((column): DataTableColumn<DeviceRow> => ({
        key: column.key,
        choosable: "shown",
        label: t(column.label),
        sortValue: (d) => equipmentName(d, column.role),
        cell: (d) =>
          html`<span data-test=${`device-${column.key}-${d.id}`}
            >${equipmentName(d, column.role)}</span
          >`,
      })),
      {
        key: "battery",
        choosable: "shown",
        label: t("devices.column_battery"),
        sortValue: (d) => d.batteryLevel,
        cell: (d) => this.#battery(d),
      },
      {
        key: "status",
        sortValue: (d) => (d.active ? t("devices.status_active") : t("devices.status_disabled")),
        filter: {
          label: t("devices.column_status"),
          allLabel: t("devices.filter_status_all"),
          value: (d) => (d.active ? "active" : "disabled"),
          options: [
            { value: "active", label: t("devices.status_active") },
            { value: "disabled", label: t("devices.status_disabled") },
          ],
        },
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
      searchable
      searchLabel=${t("devices.search")}
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
    if (this.added !== null) return nothing;
    if (this.pendingJoins.length === 0)
      return this.holdStatus === "lapsed" || this.holdStatus === "failed"
        ? nothing
        : html`<p class="waiting" data-test="waiting-empty">
            <wt-spinner></wt-spinner
            >${t(this.hasJoined ? "devices.waiting_more" : "devices.waiting")}
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

  #renderJoinedDialog(): TemplateResult | typeof nothing {
    if (!this.addingDevice || this.added === null || this.pairRequest !== null) return nothing;
    const epoch = this.#addEpoch;
    return html`<wt-modal
      size="compact"
      data-test="joined-modal"
      heading=${t(this.added.enabled ? "devices.enabled" : "devices.added").replace("{name}", this.added.name)}
      description=${t("devices.add_another_question")}
      .open=${true}
      .opener=${this.renderRoot.querySelector<HTMLElement>(".heading [data-test=open-add-device]")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#addEpoch && this.added !== null) this.#endAdding();
      }}
    >
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="joined-close"
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=joined-modal]")?.requestClose("cancel")}
          >${t("action.close")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="add-another-device"
          @click=${() => {
            if (epoch !== this.#addEpoch || this.added === null) return;
            void this.#openAddDevice(true);
          }}
          >${t("devices.add_another")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderAddDialog(): TemplateResult | typeof nothing {
    if (!this.addingDevice || (this.added !== null && this.pairRequest === null)) return nothing;
    const epoch = this.#addEpoch;
    const until = this.#openUntil();
    const [before, after] = t("devices.add_hint").split("{address}");
    return html`<wt-modal
      size="standard"
      data-test="add-device-modal"
      heading=${t("devices.add_title")}
      .open=${true}
      .opener=${this.renderRoot.querySelector<HTMLElement>(".heading [data-test=open-add-device]")}
      .dismissible=${!this.submitting}
      .beforeClose=${this.#pairScope ? this.#beforePairClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#addEpoch && this.added === null) this.#endAdding();
      }}
    >
      ${this.qr === "" ? nothing : html`<img class="qr" data-test="device-qr" src=${this.qr} alt=${t("devices.qr_alt")} />`}
      <p class="hint">
        ${before}<code data-test="device-address">${this.deviceAddress}</code>${after}
      </p>
      ${until === null ? nothing : html`<p class="hint" data-test="pairing-until">${relativeTime(t("devices.window_closes"), until, { deadline: true, now: this.now })}</p>`}
      ${holdNotice(this.holdStatus, () => void this.#hold.start())}
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
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=add-device-modal]")?.requestClose("cancel")}
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

  /** The name, profile and kitchen screen fields that Pair's settings step and the Edit dialog share. */
  #renderIdentityFields(
    prefix: "pair" | "edit",
    values: { name: string; profileId: string; screens: KitchenDraft },
    errors: IdentityErrors,
    on: {
      name(value: string): void;
      profile(value: string): void;
      screens(next: KitchenDraft, ...fields: KitchenField[]): void;
    },
    disabled = false,
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
      ${this.#renderKitchenFields(prefix, values, errors, on.screens, disabled)}`;
  }

  // ── Kitchen screens ──────────────────────────────────────────────────────────────────────────────

  #sharedDisplay(profileId: string): boolean {
    return this.deviceProfiles.find((p) => p.id === profileId)?.formFactor === SHARED_DISPLAY;
  }

  /**
   * The lists a profile lets its devices choose within for `kind`, as the server bounds them;
   * undefined when it does not offer the kind. On a till or handheld a station or pass screen with
   * no row bounds nothing, while a pass monitor needs a row.
   */
  #bound(profileId: string, kind: KitchenScreenKind): KitchenScreenScope | undefined {
    const row = this.kitchenScreens.find((entry) => entry.profileId === profileId)?.screens[kind];
    if (row !== undefined) return row;
    return this.#sharedDisplay(profileId) || kind === "pass_monitor" ? undefined : EVERY;
  }

  /** A kitchen display's profile rows; on a till or handheld, the kinds of screen its profile shows. */
  #offeredKinds(profileId: string): KitchenScreenKind[] {
    const profile = this.deviceProfiles.find((p) => p.id === profileId);
    if (profile === undefined) return [];
    return KITCHEN_KINDS.filter(
      (kind) =>
        this.#bound(profileId, kind) !== undefined &&
        (profile.formFactor === SHARED_DISPLAY ||
          profile.capabilities.includes(kind === "station" ? "show-station" : "show-expo")),
    );
  }

  #allowedStations(profileId: string, kind: KitchenScreenKind): Station[] {
    const ids = this.#bound(profileId, kind)?.stationIds ?? null;
    return this.stations.filter((s) => s.active && (ids === null || ids.includes(s.id)));
  }

  #allowedZones(profileId: string, kind: KitchenScreenKind): FloorZone[] {
    const ids = this.#bound(profileId, kind)?.zoneIds ?? null;
    return this.zones.filter((z) => z.active && (ids === null || ids.includes(z.id)));
  }

  /** The kind the `screen` field holds: a kitchen display's one, or a till's pass kind. */
  #mainKind(screens: KitchenDraft, profileId: string): KitchenScreenKind | "" {
    const kinds = this.#sharedDisplay(profileId) ? KITCHEN_KINDS : PASS_KINDS;
    return kinds.find((kind) => screens[kind] !== undefined) ?? "";
  }

  /**
   * The draft a device's read gives, "every" exactly where the read says so, never what a narrowing
   * took. Edit keeps a station or zone switched off on its own page, which the server lets the
   * device keep; Pair, re-enabling a device, starts without them.
   */
  #draftFromRead(
    read: readonly ResolvedKitchenScreen[],
    profileId: string,
    keepSwitchedOff = false,
  ): KitchenDraft {
    const draft: KitchenDraft = {};
    const kept = (slots: readonly ScreenSlot[]) =>
      slots
        .filter((slot) => slot.available || (keepSwitchedOff && slot.switchedOff))
        .map((slot) => slot.id);
    for (const screen of read) {
      if (!screen.available) continue;
      const stationIds = screen.everyStation ? null : kept(screen.stations);
      const zoneIds =
        screen.kind === "station" || screen.everyZone ? null : kept(screen.zones ?? []);
      if (stationIds?.length === 0 || zoneIds?.length === 0) continue;
      draft[screen.kind] = { stationIds, zoneIds };
    }
    return this.#fitted(draft, profileId);
  }

  /**
   * The draft within what `profileId` offers: a kind it does not offer goes, lists lose what it does
   * not allow, and a list left empty takes its kind with it. A kitchen display keeps one kind, a till
   * one pass kind. A switched-off entry stays while the profile's list allows it.
   */
  #fitted(screens: KitchenDraft, profileId: string): KitchenDraft {
    const shared = this.#sharedDisplay(profileId);
    const out: KitchenDraft = {};
    for (const kind of this.#offeredKinds(profileId)) {
      const scope = screens[kind];
      if (scope === undefined) continue;
      if (shared ? Object.keys(out).length > 0 : kind === "pass_monitor" && out.pass) continue;
      const bound = this.#bound(profileId, kind)!;
      const within = (
        ids: readonly string[] | null,
        places: readonly { id: string }[],
        allowed: readonly string[] | null,
      ) =>
        ids === null
          ? null
          : ids.filter(
              (id) =>
                places.some((place) => place.id === id) &&
                (allowed === null || allowed.includes(id)),
            );
      const stationIds = within(scope.stationIds, this.stations, bound.stationIds);
      const zoneIds = within(scope.zoneIds, this.zones, bound.zoneIds);
      if (stationIds?.length === 0 || zoneIds?.length === 0) continue;
      out[kind] = { stationIds, zoneIds };
    }
    return out;
  }

  #screensPayload(screens: KitchenDraft): DeviceKitchenScreen[] {
    return KITCHEN_KINDS.flatMap((kind) => {
      const scope = screens[kind];
      return scope === undefined
        ? []
        : [
            {
              kind,
              stationIds: ordered(scope.stationIds, this.stations),
              zoneIds: ordered(scope.zoneIds, this.zones),
            },
          ];
    });
  }

  /** The kitchen screen fields drawn for this profile and choice, which a refusal may mark. */
  #kitchenShown(profileId: string, screens: KitchenDraft): KitchenField[] {
    const offered = this.#offeredKinds(profileId);
    const shared = this.#sharedDisplay(profileId);
    const main = this.#mainKind(screens, profileId);
    const fields: KitchenField[] = [];
    if (shared || offered.some((kind) => kind !== "station")) fields.push("screen");
    if (main !== "") fields.push("stations");
    if (main !== "" && main !== "station") fields.push("zones");
    if (!shared && offered.includes("station")) fields.push("kitchenStations");
    return fields;
  }

  /**
   * "Every …", then, once it is off, a switch for each entry the profile allows, and each entry
   * the list keeps that is switched off on its own page, marked and fixed.
   */
  #choiceList(list: {
    test: string;
    heading: string;
    error: string;
    name: string;
    everyTest: string;
    everyLabel: string;
    itemTest: string;
    ids: readonly string[] | null;
    allowed: readonly { id: string; name: string }[];
    all: readonly { id: string; name: string; active: boolean }[];
    /** What a switched-off entry's label adds, as the profile editor marks it. */
    mark: string;
    disabled: boolean;
    set(ids: string[] | null): void;
  }): TemplateResult {
    const { ids } = list;
    const switchedOff =
      ids === null ? [] : list.all.filter((place) => !place.active && ids.includes(place.id));
    return this.#switchGroup(list.test, list.heading, list.error, [
      html`<wt-switch
        data-test=${list.everyTest}
        name=${list.name}
        label=${list.everyLabel}
        .checked=${ids === null}
        ?disabled=${list.disabled}
        @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
          e.stopPropagation();
          list.set(e.detail.checked ? null : list.allowed.map((place) => place.id));
        }}
      ></wt-switch>`,
      ...(ids === null
        ? []
        : list.allowed.map(
            (place) =>
              html`<wt-switch
                data-test=${`${list.itemTest}-${place.id}`}
                name=${list.name}
                label=${place.name}
                .checked=${ids.includes(place.id)}
                ?disabled=${list.disabled}
                @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                  e.stopPropagation();
                  const rest = ids.filter((id) => id !== place.id);
                  list.set(e.detail.checked ? [...rest, place.id] : rest);
                }}
              ></wt-switch>`,
          )),
      ...switchedOff.map(
        (place) =>
          html`<wt-switch
            data-test=${`${list.itemTest}-${place.id}`}
            name=${list.name}
            label=${`${place.name} (${list.mark})`}
            .checked=${true}
            disabled
          ></wt-switch>`,
      ),
    ]);
  }

  /** A titled group of switches, described by its error once marked. */
  #switchGroup(test: string, heading: string, error: string, switches: TemplateResult[]) {
    return html`<div
      class="choice-group"
      role="group"
      aria-labelledby="${test}-heading"
      aria-describedby=${error === "" ? nothing : `${test}-error`}
      data-test=${test}
    >
      <span class="group-heading" id="${test}-heading">${heading}</span>
      <div class="toggles">${switches}</div>
      ${
        error === ""
          ? nothing
          : html`<p class="field-error" id="${test}-error" data-test="${test}-error">${error}</p>`
      }
    </div>`;
  }

  /**
   * A kitchen display's Screen and its lists; a till's or handheld's Kitchen screen list and Pass
   * choice, each shown when its profile shows that screen.
   */
  #renderKitchenFields(
    prefix: "pair" | "edit",
    values: { profileId: string; screens: KitchenDraft },
    errors: IdentityErrors,
    set: (next: KitchenDraft, ...fields: KitchenField[]) => void,
    disabled: boolean,
  ): TemplateResult {
    const { profileId, screens } = values;
    const shared = this.#sharedDisplay(profileId);
    const offered = this.#offeredKinds(profileId);
    const main = this.#mainKind(screens, profileId);
    const kindLabel = (kind: KitchenScreenKind) => t(`device_profiles.kitchen_screen.${kind}`);
    const choose = (kind: string, keep: KitchenDraft) =>
      set(kind === "" ? keep : { ...keep, [kind]: EVERY }, "screen", "stations", "zones");
    const passKinds = offered.filter((kind) => kind !== "station");
    const common = {
      search: "auto",
      searchPlaceholder: t("categories.combobox_search"),
      noResultsLabel: t("categories.combobox_no_results"),
    };
    const choice = shared
      ? html`<wt-combobox
          data-test=${`${prefix}-screen`}
          name="kitchenScreen"
          required
          label=${t("devices.kitchen_screen")}
          search=${common.search}
          placeholder=${
            offered.length === 0
              ? t("devices.kitchen_screen_none_offered")
              : t("devices.kitchen_screen_pick")
          }
          searchPlaceholder=${common.searchPlaceholder}
          noResultsLabel=${common.noResultsLabel}
          .options=${offered.map((kind) => ({ value: kind, label: kindLabel(kind) }))}
          .value=${main}
          ?disabled=${disabled}
          .error=${errors.screen}
          .invalid=${errors.screen !== ""}
          @wt-change=${(e: CustomEvent<{ value: string }>) => choose(e.detail.value, {})}
        ></wt-combobox>`
      : passKinds.length === 0
        ? nothing
        : html`<wt-combobox
            data-test=${`${prefix}-pass`}
            name="passScreen"
            show-empty-option
            label=${t("devices.pass_screen_shows")}
            search=${common.search}
            searchPlaceholder=${common.searchPlaceholder}
            noResultsLabel=${common.noResultsLabel}
            .options=${[
              { value: "", label: t("device_profiles.every_station") },
              ...passKinds.map((kind) => ({ value: kind, label: kindLabel(kind) })),
            ]}
            .value=${main}
            ?disabled=${disabled}
            .error=${errors.screen}
            .invalid=${errors.screen !== ""}
            @wt-change=${(e: CustomEvent<{ value: string }>) =>
              choose(e.detail.value, { ...(screens.station ? { station: screens.station } : {}) })}
          ></wt-combobox>`;
    const tillStations =
      shared || !offered.includes("station")
        ? nothing
        : this.#choiceList({
            test: `${prefix}-station-shows`,
            heading: t("devices.station_screen_shows"),
            error: errors.kitchenStations,
            name: "kitchenStations",
            everyTest: `${prefix}-station-every`,
            // With no choice a till's Station screen lists all `/api/stations` returns, which reads
            // no profile.
            everyLabel:
              screens.station?.stationIds === null
                ? t("devices.every_station_profile")
                : t("device_profiles.every_station"),
            itemTest: `${prefix}-station-station`,
            ids: screens.station?.stationIds ?? null,
            allowed: this.#allowedStations(profileId, "station"),
            all: this.stations,
            mark: t("devices.station_disabled_mark"),
            disabled,
            set: (stationIds) =>
              set(
                {
                  ...(stationIds === null ? {} : { station: { stationIds, zoneIds: null } }),
                  ...(screens.pass ? { pass: screens.pass } : {}),
                  ...(screens.pass_monitor ? { pass_monitor: screens.pass_monitor } : {}),
                },
                "kitchenStations",
              ),
          });
    const scope = main === "" ? undefined : screens[main];
    const lists =
      main === "" || scope === undefined
        ? nothing
        : html`<div class="nested">
            ${this.#choiceList({
              test: `${prefix}-screen-stations`,
              heading: t("device_profiles.kitchen_stations"),
              error: errors.stations,
              name: "screenStations",
              everyTest: `${prefix}-screen-every-station`,
              everyLabel: t("device_profiles.every_station"),
              itemTest: `${prefix}-screen-station`,
              ids: scope.stationIds,
              allowed: this.#allowedStations(profileId, main),
              all: this.stations,
              mark: t("devices.station_disabled_mark"),
              disabled,
              set: (stationIds) =>
                set({ ...screens, [main]: { ...scope, stationIds } }, "stations"),
            })}
            ${
              main === "station"
                ? nothing
                : this.#choiceList({
                    test: `${prefix}-screen-zones`,
                    heading: t("device_profiles.kitchen_zones"),
                    error: errors.zones,
                    name: "screenZones",
                    everyTest: `${prefix}-screen-every-zone`,
                    everyLabel: t("device_profiles.every_zone_venue"),
                    itemTest: `${prefix}-screen-zone`,
                    ids: scope.zoneIds,
                    allowed: this.#allowedZones(profileId, main),
                    all: this.zones,
                    mark: t("device_profiles.zone_disabled_mark"),
                    disabled,
                    set: (zoneIds) => set({ ...screens, [main]: { ...scope, zoneIds } }, "zones"),
                  })
            }
          </div>`;
    return html`${tillStations}${choice}${lists}`;
  }

  /** Each entry the read marks no longer available, outside the draft. */
  #renderGone(): TemplateResult | typeof nothing {
    if (this.editGone.length === 0) return nothing;
    const mark = t("devices.no_longer_available");
    return html`<ul class="gone" data-test="edit-gone" aria-label=${mark}>
      ${this.editGone.map(({ kind, name }) => {
        const label = t(`device_profiles.kitchen_screen.${kind}`);
        return html`<li data-test="edit-gone-item">
          ${name === null ? `${label} (${mark})` : `${label}: ${name} (${mark})`}
        </li>`;
      })}
    </ul>`;
  }

  #renderSettingsStep(errors: IdentityErrors): TemplateResult {
    const epoch = this.#pairEpoch;
    return html`<div class="pair-fields">
      ${this.#renderIdentityFields(
        "pair",
        { name: this.pairName, profileId: this.chosenProfileId, screens: this.chosenScreens },
        errors,
        {
          name: (value) => {
            if (!this.isConnected || epoch !== this.#pairEpoch) return;
            this.pairName = value;
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, "name");
            this.#pairScope?.changed();
          },
          profile: (value) => {
            if (!this.isConnected || epoch !== this.#pairEpoch) return;
            this.chosenProfileId = value;
            this.chosenScreens = this.#fitted(this.chosenScreens, value);
            this.fieldRefusal = clearedRefusal(
              this.fieldRefusal,
              "profile",
              "screen",
              "stations",
              "zones",
              "kitchenStations",
            );
            this.#pairScope?.changed();
          },
          screens: (next, ...fields) => {
            if (!this.isConnected || epoch !== this.#pairEpoch) return;
            this.chosenScreens = next;
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, ...fields);
            this.#pairScope?.changed();
          },
        },
        this.submitting,
      )}
    </div>`;
  }

  #renderPairDialog(): TemplateResult | typeof nothing {
    const request = this.pairRequest;
    if (request === null) return nothing;
    const epoch = this.#pairEpoch;
    const settings = this.pairStep === "settings";
    const errors = settings ? this.#pairErrors() : { name: "", profile: "", ...NO_KITCHEN_ERRORS };
    const marked = Object.values(errors).some((error) => error !== "");
    const own = this.#ownErrors();
    const blocked = Object.values(own).some((error) => error !== "");
    return html`<wt-modal
      size="standard"
      data-test="pair-modal"
      heading=${pairTitle(request)}
      .open=${true}
      .dismissible=${!this.submitting}
      .beforeClose=${this.#pairScope ? this.#beforePairClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#pairEpoch) this.#closePair();
      }}
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
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=pair-modal]")?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        ${
          settings
            ? html`<wt-button
                variant=${saveActionState(this.#pairScope, { savableAtOpen: true }).variant}
                data-test="pair-submit"
                ?loading=${this.submitting}
                ?disabled=${blocked || this.#pairSettled}
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
    const epoch = this.#editEpoch;
    const errors = this.#editErrors();
    const own = this.#editOwnErrors();
    const blocked = Object.values(own).some((error) => error !== "");
    const save = this.#editSaveState();
    const marked = Object.values(errors).some((error) => error !== "");
    const profile = this.deviceProfiles.find((p) => p.id === form.profileId);
    const kitchen = this.#sharedDisplay(form.profileId);
    return html`<wt-modal
      size="standard"
      data-test="edit-device-modal"
      heading=${t("devices.edit_title").replace("{name}", device.label)}
      .open=${true}
      .dismissible=${!this.editSaving}
      .beforeClose=${this.#editLeave ? this.#beforeEditClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#editEpoch) this.#endEdit();
      }}
    >
      <div class="edit-fields">
        ${this.#renderIdentityFields(
          "edit",
          form,
          errors,
          {
            name: (value) => {
              if (this.isConnected && epoch === this.#editEpoch)
                this.#setEdit({ name: value }, "name");
            },
            profile: (value) => {
              if (this.isConnected && epoch === this.#editEpoch) this.#onEditProfile(value);
            },
            screens: (next, ...fields) => {
              if (this.isConnected && epoch === this.#editEpoch)
                this.#setEdit({ screens: next }, ...fields);
            },
          },
          this.editSaving,
        )}
        ${this.#renderGone()}
        ${PRINTER_ROLES.map(
          (role) =>
            html`<wt-combobox
              data-test=${role.test}
              name=${role.form}
              show-empty-option
              label=${t(role.label)}
              search="auto"
              searchPlaceholder=${t("categories.combobox_search")}
              noResultsLabel=${t("categories.combobox_no_results")}
              .options=${this.#printerOptions(role, profile, device[role.form])}
              .value=${form[role.form]}
              ?disabled=${this.editSaving}
              .error=${errors[role.field]}
              .invalid=${errors[role.field] !== ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) =>
                this.isConnected &&
                epoch === this.#editEpoch &&
                this.#setEdit({ [role.form]: e.detail.value }, role.field)}
            ></wt-combobox>`,
        )}
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
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=edit-device-modal]")?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${save.variant}
          data-test="edit-save"
          ?loading=${this.editSaving}
          ?disabled=${save.unchanged || blocked}
          @click=${() => void this.#submitEdit()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderMadeHere(): TemplateResult {
    const epoch = this.#editEpoch;
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
                  this.isConnected &&
                  epoch === this.#editEpoch &&
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
    const epoch = this.#editEpoch;
    return html`<wt-combobox
      data-test="edit-reader"
      name="defaultReaderId"
      show-empty-option
      label=${t("devices.default_reader")}
      search="auto"
      searchPlaceholder=${t("categories.combobox_search")}
      noResultsLabel=${t("categories.combobox_no_results")}
      ?disabled=${this.readerState !== "ready" || this.editSaving}
      .options=${this.#readerOptions()}
      .value=${this.chosenReaderId}
      .error=${error}
      .invalid=${error !== ""}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        if (!this.isConnected || epoch !== this.#editEpoch) return;
        this.chosenReaderId = e.detail.value;
        this.#readerScope?.changed();
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
      ${this.#renderAddDialog()} ${this.#renderJoinedDialog()} ${this.#renderPairDialog()}
      ${this.#renderEditDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-devices-screen": DevicesScreen;
  }
}
