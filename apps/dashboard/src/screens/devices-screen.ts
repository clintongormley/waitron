import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import {
  baseStyles,
  UrlStateController,
  pageTitleStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  FormFeedback,
  submitOnEnter,
  visuallyHiddenStyles,
  type DataTableColumn,
  type DeleteDialogCopy,
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
import "@waitron/ui/src/components/wt-delete-dialog.js";
import type { DeleteImpact } from "@waitron/shared";
import { PairingHold, type PairingHoldStatus } from "../api/pairing-hold.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { holdNotice, holdNoticeStyles } from "../widgets/hold-notice.js";
import { deviceDeleteCopy } from "../widgets/device-delete-copy.js";
import { relativeTime } from "../widgets/relative-time.js";
import "../widgets/row-actions.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import {
  registerCatalogue,
  tableNoMatches,
  type CardProviderPanel,
  t as tRaw,
} from "@waitron/dashboard-kit";
import { currentLocale, fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { formatIsoMinute } from "../date-utils.js";
import { a4Choices, a4PrinterName, printerLabel } from "../i18n/domain.js";
import type { StringKey } from "../i18n/strings.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  EquipmentRole,
  FormFactor,
  JoinRequestRow,
  PairingModeState,
  PagePrinterRow,
  Printer,
  ProfileReaderList,
  ReaderHolderRow,
  ReaderRow,
  Station,
} from "../api/client.js";
type PairField = "name" | "profile";
type EditField = PairField | "receipt" | "slip" | "drawer" | "invoice" | "reader" | "approved";
type IdentityErrors = Record<PairField, string>;
const SHARED_DISPLAY: FormFactor = "kds";
/** A printer an equipment choice may offer. */
type RolePrinter = Pick<Printer, "id" | "name" | "active" | "portable" | "holder">;

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
  {
    field: "invoice",
    form: "invoicePrinterId",
    list: "invoicePrinterIds",
    defaultKey: "invoicePrinterDefaultId",
    test: "edit-invoice-printer",
    label: "devices.invoice_printer_now",
  },
] as const;

interface DeviceSettingData {
  deviceProfiles: DeviceProfile[];
}
export const deviceSettingFields = [
  { name: "name", labelKey: "devices.name" },
  { name: "profileId", labelKey: "devices.device_profile" },
  ...PRINTER_ROLES.map((role) => ({ name: role.form, labelKey: role.label })),
  {
    name: "defaultReaderId",
    labelKey: "devices.default_reader",
  },
  { name: "approvedProfileIds", labelKey: "devices.approved_profiles" },
  { name: "madeHereStationIds", labelKey: "devices.made_here" },
] as const satisfies readonly { name: string; labelKey: StringKey }[];
export function deviceSettingIsOffered(
  name: string,
  device: DeviceRow,
  data: DeviceSettingData,
): boolean {
  const profileId = device.deviceProfileId ?? "";
  const profile = data.deviceProfiles.find((p) => p.id === profileId);
  switch (name) {
    case "approvedProfileIds":
      return (
        profile !== undefined &&
        data.deviceProfiles.some((p) => p.id !== profile.id && p.formFactor === profile.formFactor)
      );
    case "receiptPrinterId":
    case "paymentSlipPrinterId":
    case "cashDrawerPrinterId":
    case "invoicePrinterId":
      return profile?.formFactor !== SHARED_DISPLAY;
    case "madeHereStationIds":
      return profile?.formFactor === "till";
    default:
      return true;
  }
}

/** What a refusal about equipment says under its field, when the code's own message is too vague. */
function equipmentSentence(error: unknown, field: EditField): string | undefined {
  const code = codeOf(error);
  const params = (error as { params?: Record<string, unknown> } | null)?.params ?? {};
  if (code === "device.equipment_held" && typeof params.holderDeviceName === "string")
    return fill("devices.err_equipment_held", { device: params.holderDeviceName });
  if (code === "reader.payment_in_progress") return t("devices.err_reader_busy");
  if (code === "device.binding_invalid" && field === "reader")
    return t("devices.err_reader_not_allowed");
  return undefined;
}

/** Refusals of a Pair or Edit save about one field, by code alone; others read their params first. */
const FIELD_BY_CODE: Record<string, EditField> = {
  "device.name_taken": "name",
  "device_profile.not_found": "profile",
  "device_profile.incompatible": "approved",
};

const FIELD_BY_PARAM: Record<string, EditField> = {
  name: "name",
  profileId: "profile",
  receiptPrinterId: "receipt",
  paymentSlipPrinterId: "slip",
  cashDrawerPrinterId: "drawer",
  invoicePrinterId: "invoice",
  cardReaderId: "reader",
  approvedProfileIds: "approved",
};

/**
 * The field a refusal is about, when it is one of `shown` (CLAUDE.md §3: by what the error carries).
 * A till's choice may hold two station lists; a refusal about stations names its screen.
 */
function refusedField(error: unknown, shown: readonly EditField[]): EditField | null {
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
  /** Empty for Use default. */
  receiptPrinterId: string;
  paymentSlipPrinterId: string;
  cashDrawerPrinterId: string;
  invoicePrinterId: string;
  madeHere: string[];
  /** Ticked profiles staff may switch to; only those {@link DevicesScreen} offers are sent. */
  approved: string[];
  /** Whether each pass kind shows other stations' dishes; null is the profile's setting. */
}

function waitingName(request: JoinRequestRow): string {
  return request.returning?.name ?? request.label;
}

function pairAction(request: JoinRequestRow): string {
  return request.returning ? t("action.add") : t("devices.pair");
}

function pairTitle(request: JoinRequestRow): string {
  return fill(request.returning ? "devices.readd_title" : "devices.pair_title", {
    name: waitingName(request),
  });
}

/** The table's equipment columns, one per role. */
const EQUIPMENT_COLUMNS = [
  { key: "receipt", role: "receipt", label: "devices.receipt_printer_now" },
  { key: "slip", role: "payment_slip", label: "devices.slip_printer_now" },
  { key: "drawer", role: "cash_drawer", label: "devices.cash_drawer_now" },
  { key: "invoice", role: "invoice", label: "devices.invoice_printer_now" },
  { key: "reader", role: "card_terminal", label: "devices.default_reader" },
] as const satisfies readonly { key: string; role: EquipmentRole; label: StringKey }[];

function equipmentName(
  device: DeviceRow,
  role: EquipmentRole,
  pagePrinters: readonly PagePrinterRow[],
): string {
  if (device.kind === "kds_station" && role !== "card_terminal") return "";
  const equipment = device.equipment.find((entry) => entry.role === role);
  let name = equipment?.resolved?.name ?? t("equipment.none");
  if (role === "invoice" && pagePrinters.some((p) => p.id === equipment?.resolved?.id))
    name = a4PrinterName(name);
  return name;
}

/** A battery report older than this is greyed and says when it was taken (add a device design
 * §6). */
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
    pageTitleStyles,
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
      wt-data-table::part(profile-retired),
      wt-data-table::part(returning-hint) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(battery-updated),
      wt-data-table::part(returning-hint) {
        display: block;
      }
      wt-data-table::part(waiting-name) {
        overflow-wrap: anywhere;
      }
      wt-data-table::part(visually-hidden) {
        ${visuallyHiddenStyles}
      }
      .pair-fields,
      .edit-fields,
      .edit-section {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-3);
      }
      .edit-section h3 {
        margin: var(--wt-space-3) 0 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(inherited) {
        color: var(--wt-color-text-muted);
        font-style: italic;
      }
      .made-here {
        min-inline-size: 0;
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
      if (this.#initialRead) this.#openLinkedDevice();
    },
  );

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;
  /**
   * Whether the session holds `hardware.manage`. While false Edit draws no card reader and sends
   * none; turned back on, the reader shows from the next Edit. A reader read refused with
   * `authorization.not_permitted` also hides it, because the server may know of a change before
   * this flag does; any other failure of that read is shown at the bottom of Edit.
   */
  @property({ attribute: false }) canManageReaders = true;

  @state() private devices: DeviceRow[] = [];
  @state() private stations: Station[] = [];
  @state() private deviceProfiles: DeviceProfile[] = [];
  @state() private printers: Printer[] = [];
  @state() private pagePrinters: PagePrinterRow[] = [];
  /** The printer choices are drawn once both printer lists have answered. */
  @state() private printerListsRead: ReadonlySet<"printers" | "pages"> = new Set();
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
  @state() private added: { name: string } | null = null;
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
  readonly #pairFeedback = new FormFeedback(this);
  @state() private fieldRefusal: FieldRefusal = null;
  /** Set once the server has approved or deleted the request, so closing Pair has nothing to discard. */
  #pairSettled = false;
  /** A Pair save not yet answered; its claim stands only while the hold it was checked under does. */
  #pairSave: Promise<unknown> | undefined;
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
    return this.#identityPayload({ name: this.pairName, profileId: this.chosenProfileId });
  }

  #registerPairDraft(): void {
    this.#pairScope?.dispose();
    this.#pairLeave = leaveCoordinatorFor(this);
    this.#pairScope = this.#pairLeave?.register({
      id: {},
      current: () => this.#pairPayload(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => a.name === b.name && a.profileId === b.profileId,
      restore: () => {},
    });
  }
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;

  @state() private editing: DeviceRow | null = null;

  #initialRead = false;
  #linkedDevice: string | null = null;
  #addressDevice: string | null = null;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "devices") return;
      const id = this.#url.read("device");
      if (id === this.#addressDevice) return;
      const previous = this.#addressDevice;
      this.#linkedDevice = this.#addressDevice = id;
      if (id === null) {
        if (previous !== null) this.#endEdit(false);
      } else if (this.#initialRead && !this.#readErrorShown) this.#openLinkedDevice();
    },
    dashboardPath,
  );

  #clearDeviceAddress(): void {
    this.#linkedDevice = this.#addressDevice = null;
    if (this.#url.read("dashboard") === "devices") void this.#url.write({ device: null }, true);
  }

  #openLinkedDevice(): void {
    const id = this.#linkedDevice;
    this.#linkedDevice = null;
    if (id === null) return;
    const device = this.devices.find((device) => device.id === id);
    if (device) this.#openEdit(device);
    else this.#clearDeviceAddress();
  }

  /** The id of the device the delete dialog is open on. Each opening and close is a new generation,
   * so a delete's answer for an earlier one is never applied; an impact read for an earlier one is
   * dropped by its query slot, which the next `watch` or `release` replaces. */
  @state() private deleteTarget: string | null = null;
  @state() private deleteImpact: DeleteImpact | null = null;
  @state() private deleteLoading = false;
  @state() private deleteSubmitting = false;
  @state() private deleteReadError = "";
  @state() private deleteActionError = "";
  #deleteGeneration = 0;
  #deleteOpener: HTMLElement | null = null;
  #deleteCopy: { locale: string; copy: DeleteDialogCopy } | null = null;
  readonly #impactQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#impactFailed(error),
  );
  @state() private editForm: EditForm = {
    name: "",
    profileId: "",
    receiptPrinterId: "",
    paymentSlipPrinterId: "",
    cashDrawerPrinterId: "",
    invoicePrinterId: "",
    madeHere: [],
    approved: [],
  };
  /** The open device's stored invoice choice, which its row carries only in `equipment`. */
  #editInvoiceId: string | null = null;
  readonly #editFeedback = new FormFeedback(this);
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
  /** Counts Saves, so a deleted reader's re-read answering after a later Save does not replace
   * what that Save stored. */
  #saveTurn = 0;
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
      ...this.#identityPayload(form),
      ...(this.#sharedDisplay(form.profileId)
        ? {}
        : {
            receiptPrinterId: form.receiptPrinterId === "" ? null : form.receiptPrinterId,
            paymentSlipPrinterId:
              form.paymentSlipPrinterId === "" ? null : form.paymentSlipPrinterId,
            // Absent leaves the stored drawer and invoice choices alone, so only a changed one is sent.
            ...(form.cashDrawerPrinterId === (this.editing!.cashDrawerPrinterId ?? "")
              ? {}
              : {
                  cashDrawerPrinterId:
                    form.cashDrawerPrinterId === "" ? null : form.cashDrawerPrinterId,
                }),
            ...(form.invoicePrinterId === (this.#editInvoiceId ?? "")
              ? {}
              : { invoicePrinterId: form.invoicePrinterId === "" ? null : form.invoicePrinterId }),
          }),
      ...(this.deviceProfiles.find((profile) => profile.id === form.profileId)?.formFactor ===
      "till"
        ? { madeHereStationIds: this.#madeHereToSend() }
        : {}),
      ...this.#approvalsToSend(this.editing!),
    };
  }

  /** Carries the drawer, invoice printer and approvals whether or not the request does: once they
   * are saved, the request omits them. */
  #editSnapshot() {
    const drawer = this.editForm.cashDrawerPrinterId;
    const invoice = this.editForm.invoicePrinterId;
    return {
      ...this.#editPayload(),
      cashDrawerPrinterId: drawer === "" ? null : drawer,
      invoicePrinterId: invoice === "" ? null : invoice,
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
        a.receiptPrinterId === b.receiptPrinterId &&
        a.paymentSlipPrinterId === b.paymentSlipPrinterId &&
        a.cashDrawerPrinterId === b.cashDrawerPrinterId &&
        a.invoicePrinterId === b.invoicePrinterId &&
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
    await Promise.allSettled([
      this.#watchDevices(),
      this.#queries.watch("listStations", [], (value) => {
        this.stations = value;
      }),
      this.#queries.watch("listDeviceProfiles", [], (value) => {
        this.deviceProfiles = value;
      }),
      this.#queries.watch("listPrinters", [], (value) => {
        this.printers = value;
        this.printerListsRead = new Set([...this.printerListsRead, "printers"]);
      }),
      this.#queries.watch("listPagePrinters", [], (value) => {
        this.pagePrinters = value;
        this.printerListsRead = new Set([...this.printerListsRead, "pages"]);
      }),
      this.#queries.watch("pairingMode", [], (value) => {
        this.pairing = value;
      }),
      this.#queries.watch("joinRequests", ["device"], (value) => {
        this.#applyJoins(value);
      }),
    ]);
    this.#initialRead = true;
    if (!this.#readErrorShown) this.#openLinkedDevice();
  }

  #watchDevices(): Promise<void> {
    return this.#queries.watch("listDevices", [], (value) => {
      const listed = new Set(value.map(({ id }) => id));
      const gone = this.devices.filter(({ id }) => !listed.has(id));
      this.devices = value;
      for (const { id } of gone) this.#deviceGone(id, true);
    });
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
    this.#closeDelete();
    this.#endAdding();
    this.#endEdit(false);
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
    const save = this.#pairSave;
    this.#pairSave = undefined;
    this.#closePair();
    this.#hold.stop(save);
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
   * the dialog that would show it is gone. While a save is unanswered, closing sends no discard.
   */
  #closePair(): void {
    const request = this.pairRequest;
    if (request === null) return;
    const saving = this.submitting;
    this.#pairEpoch++;
    this.#pairScope?.dispose();
    this.#pairScope = undefined;
    this.#pairLeave = undefined;
    this.pairRequest = null;
    this.checking = false;
    this.submitting = false;
    if (this.#pairSettled || saving) return;
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
    this.#pairFeedback.reset();
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
  #identityErrors(attempted: boolean, values: { name: string; profileId: string }): IdentityErrors {
    return {
      name: attempted && values.name.trim() === "" ? t("form.name_required") : "",
      profile: attempted && values.profileId === "" ? t("devices.join_pick_profile") : "",
    };
  }

  /** The name and profile Pair and Edit both send. */
  #identityPayload(values: { name: string; profileId: string }): {
    name: string;
    profileId: string;
  } {
    return { name: values.name.trim(), profileId: values.profileId };
  }

  #ownErrors(): IdentityErrors {
    return this.#identityErrors(this.#pairFeedback.attempted, {
      name: this.pairName,
      profileId: this.chosenProfileId,
    });
  }

  #pairErrors(): IdentityErrors {
    return withRefusal(this.#ownErrors(), this.fieldRefusal);
  }

  async #submitPair(): Promise<void> {
    const request = this.pairRequest;
    if (request === null || this.submitting || this.#pairSettled) return;
    this.#pairFeedback.press();
    if (Object.values(this.#ownErrors()).some((error) => error !== "")) {
      const modal = this.renderRoot.querySelector("[data-test=pair-modal]");
      if (modal) void this.#pairFeedback.focus(modal);
      return;
    }
    const submitted = this.#pairPayload();
    const scope = this.#pairScope;
    const epoch = this.#pairEpoch;
    this.submitting = true;
    this.pairError = null;
    this.fieldRefusal = null;
    let result: { name: string };
    const save = (async () => this.api.acceptDeviceJoinRequest(request.id, submitted))();
    this.#pairSave = save;
    try {
      result = await save;
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      this.submitting = false;
      const field = refusedField(error, ["name", "profile"]);
      if (field === null) this.pairError = codeOf(error);
      else this.fieldRefusal = { field, code: codeOf(error) };
      return;
    } finally {
      if (this.#pairSave === save) this.#pairSave = undefined;
    }
    this.api.liveData?.invalidate([{ type: "devices" }]);
    if (epoch !== this.#pairEpoch) return;
    scope?.commit(submitted);
    this.submitting = false;
    this.#pairSettled = true;
    this.pendingJoins = this.pendingJoins.filter((row) => row.id !== request.id);
    this.hasJoined = true;
    this.#addEpoch++;
    this.#hold.stop();
    this.added = { name: result.name };
    if (!scope?.isDirty()) await this.#finishPair(epoch, "saved");
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
              >${relativeTime(t("devices.battery_updated"), at, {
                now: this.now,
                timeZone: this.pairing?.timeZone ?? "",
              })}</span
            >`
          : nothing
      }</span
    >`;
  }

  // ── The Edit dialog ──────────────────────────────────────────────────────────────────────────────

  #openEdit(device: DeviceRow): void {
    this.#endEdit(false);
    const epoch = ++this.#editEpoch;
    this.editing = device;
    const profileId = device.deviceProfileId ?? "";
    this.#editInvoiceId =
      device.equipment.find((entry) => entry.role === "invoice")?.chosenId ?? null;
    this.editForm = {
      name: device.label,
      profileId,
      receiptPrinterId: device.receiptPrinterId ?? "",
      paymentSlipPrinterId: device.paymentSlipPrinterId ?? "",
      cashDrawerPrinterId: device.cashDrawerPrinterId ?? "",
      invoicePrinterId: this.#editInvoiceId ?? "",
      madeHere: device.madeHereStationIds,
      approved: device.approvedProfileIds,
    };
    this.#editFeedback.reset();
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

  /** After a reader deleted elsewhere is refused, so it drops out of the list; a choice no longer
   * offered goes back to what the device holds. */
  async #rereadReaders(deviceId: string, epoch: number, turn: number): Promise<void> {
    const profileId = this.editForm.profileId;
    try {
      const [{ readerId }, readers, holders, list] = await Promise.all([
        this.api.getDeviceReader(deviceId),
        this.api.listReaders(),
        this.api.listReaderHolders(),
        this.api.getProfileReaders(profileId),
      ]);
      if (epoch !== this.#editEpoch || turn !== this.#saveTurn) return;
      this.readers = readers.filter((reader) => reader.active);
      this.readerHolders = new Map(holders.map((row) => [row.readerId, row]));
      this.profileReaders = new Map([...this.profileReaders, [profileId, list]]);
      this.#storedReaderId = readerId;
      this.#readerScope?.commit(readerId ?? "");
      if (!this.#readerOptions().some((option) => option.value === this.chosenReaderId)) {
        this.chosenReaderId = readerId ?? "";
        this.#readerScope?.changed();
      }
    } catch (error) {
      if (epoch !== this.#editEpoch || turn !== this.#saveTurn) return;
      this.readerReadError = codeOf(error);
    }
  }

  #endEdit(clearAddress = true): void {
    if (this.editing === null) return;
    this.#editEpoch++;
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.#disposeReaderDraft();
    this.#editLeave = undefined;
    this.editing = null;
    this.editSaving = false;
    if (clearAddress) this.#clearDeviceAddress();
  }

  #editOwnErrors(): IdentityErrors {
    return this.#identityErrors(this.#editFeedback.attempted, this.editForm);
  }

  #editErrors(): Record<EditField, string> {
    return withRefusal(
      {
        ...this.#editOwnErrors(),
        receipt: "",
        slip: "",
        drawer: "",
        invoice: "",
        reader: "",
        approved: "",
      },
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
        receiptPrinterId: "",
        paymentSlipPrinterId: "",
        cashDrawerPrinterId: "",
        invoicePrinterId: "",
      },
      "profile",
      "receipt",
      "slip",
      "drawer",
      "invoice",
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

  /** Another device holding a portable printer; a cash drawer or an invoice printer is never held. */
  #printerHolder(printer: RolePrinter, drawer: boolean): string | null {
    const holder = printer.holder;
    if (drawer || !printer.portable || holder === null || holder.deviceId === this.editing?.id)
      return null;
    return holder.deviceName;
  }

  /** The printers a role may name: an invoice may name an A4 printer too, marked. */
  #rolePrinters(role: (typeof PRINTER_ROLES)[number]): RolePrinter[] {
    if (role.field !== "invoice") return this.printers;
    return [
      ...this.printers,
      ...a4Choices(this.pagePrinters).map((choice) => ({
        ...choice,
        portable: false,
        holder: null,
      })),
    ];
  }

  /** The choice the open device has stored for the role. */
  #storedChoice(device: DeviceRow, role: (typeof PRINTER_ROLES)[number]): string | null {
    return role.field === "invoice" ? this.#editInvoiceId : device[role.form];
  }

  #printerChoiceLabel(printer: RolePrinter, drawer: boolean): string {
    const holder = this.#printerHolder(printer, drawer);
    return holder === null
      ? printerLabel(printer)
      : `${printerLabel(printer)} (${fill("equipment.carried_by", { device: holder })})`;
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
  ): { value: string; label: string; fixed?: boolean; muted?: true }[] {
    const ids = profile?.[role.list] ?? [];
    const drawer = role.field === "drawer" || role.field === "invoice";
    const keep = this.editForm.profileId === this.editing?.deviceProfileId ? held : null;
    const pool = this.#rolePrinters(role);
    const listed = ids.flatMap((id) => {
      const printer = pool.find((p) => p.id === id);
      return printer !== undefined && (printer.active || printer.id === keep) ? [printer] : [];
    });
    const unlisted =
      keep === null || ids.includes(keep) ? undefined : pool.find((p) => p.id === keep);
    const fallback = pool.find((p) => p.id === profile?.[role.defaultKey]);
    const resolved =
      fallback === undefined || this.#printerHolder(fallback, drawer) !== null
        ? null
        : printerLabel(fallback);
    return [
      {
        value: "",
        label: resolved ?? t("equipment.none"),
        muted: true,
      },
      ...listed.map((p) => ({ value: p.id, label: this.#printerChoiceLabel(p, drawer) })),
      ...(unlisted === undefined
        ? []
        : [
            {
              value: unlisted.id,
              fixed: true,
              label: `${printerLabel(unlisted)} (${t("devices.printer_not_on_profile_mark")})`,
            },
          ]),
    ];
  }

  #madeHereToSend(): string[] {
    return this.stations
      .filter((station) => station.active && this.editForm.madeHere.includes(station.id))
      .map((station) => station.id);
  }

  /** Another device's hold on a reader, or its payment in progress there, as a mark on its name. */
  #readerChoiceLabel(reader: ReaderRow): string {
    const row = this.readerHolders.get(reader.id);
    const own = this.editing?.id;
    if (row?.paymentInProgressDeviceIds.some((id) => id !== own))
      return `${this.#readerLabel(reader)} (${t("equipment.busy")})`;
    if (row?.holder && row.holder.deviceId !== own)
      return `${this.#readerLabel(reader)} (${fill("equipment.carried_by", { device: row.holder.deviceName })})`;
    return this.#readerLabel(reader);
  }

  #readerOptions(): { value: string; label: string; muted?: true }[] {
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
      {
        value: "",
        label: resolved ?? t("equipment.none"),
        muted: true,
      },
      ...listed.map((reader) => ({ value: reader.id, label: this.#readerChoiceLabel(reader) })),
    ];
  }

  async #submitEdit(): Promise<void> {
    const device = this.editing;
    if (device === null || this.editSaving || this.#editSaveState().unchanged) return;
    this.#editFeedback.press();
    if (Object.values(this.#editOwnErrors()).some((error) => error !== "")) {
      const modal = this.renderRoot.querySelector("[data-test=edit-device-modal]");
      if (modal) void this.#editFeedback.focus(modal);
      return;
    }
    const epoch = this.#editEpoch;
    const turn = ++this.#saveTurn;
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
      const field = refusedField(error, [
        "name",
        "profile",
        "receipt",
        "slip",
        "drawer",
        "invoice",
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
    if (epoch === this.#editEpoch && sent.invoicePrinterId !== undefined)
      this.#editInvoiceId = sent.invoicePrinterId;
    this.api.liveData?.invalidate([{ type: "devices" }]);
    if (epoch !== this.#editEpoch) return;
    // The reader save below can fail and keep the dialog open, which then edits what was just saved.
    const { name: label, profileId: deviceProfileId, approvedProfileIds } = sent;
    this.editing = {
      ...device,
      receiptPrinterId: sent.receiptPrinterId ?? null,
      paymentSlipPrinterId: sent.paymentSlipPrinterId ?? null,
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
      // Saved separately: the reader belongs to the payments module.
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
          if (codeOf(error) === "reader.not_found")
            void this.#rereadReaders(device.id, epoch, turn);
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

  #deviceActions(device: DeviceRow): TemplateResult {
    return html`<dashboard-row-actions .label=${`${t("devices.actions")}: ${device.label}`}>
      <wt-button data-test=${`edit-device-${device.id}`} @click=${() => this.#openEdit(device)}
        >${t("action.edit")}</wt-button
      >
      <wt-button
        variant="danger"
        data-test=${`delete-device-${device.id}`}
        @click=${(event: Event) => {
          const button = event.currentTarget as HTMLElement;
          this.#openDelete(device, this.#rowMenuButton(button) ?? button);
        }}
        >${t("action.delete")}</wt-button
      >
    </dashboard-row-actions>`;
  }

  /** The button that opens the row menu `action` sits in. */
  #rowMenuButton(action: HTMLElement): HTMLButtonElement | undefined {
    return (
      action
        .closest("dashboard-row-actions")
        ?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? undefined
    );
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(device: DeviceRow, opener: HTMLElement): void {
    this.#deleteGeneration++;
    this.#deleteOpener = opener;
    this.deleteTarget = device.id;
    this.deleteImpact = null;
    this.deleteLoading = true;
    this.deleteSubmitting = false;
    this.deleteReadError = "";
    this.deleteActionError = "";
    this.#readImpact(device.id);
  }

  #readImpact(id: string): void {
    this.#impactQueries
      .watch("getDeviceDeleteImpact", [id], (impact) => {
        this.deleteImpact = impact;
        this.deleteLoading = false;
        this.deleteReadError = "";
      })
      // A failure has already reached `#impactFailed`.
      .catch(() => undefined);
  }

  #impactFailed(error: unknown): void {
    const target = this.deleteTarget;
    if (target === null) return;
    const code = codeOf(error);
    if (code === "device.not_found") {
      // The delete in flight may be what removed it; its own answer decides what is shown.
      if (!this.deleteSubmitting) this.#deviceGone(target, true);
      return;
    }
    this.deleteLoading = false;
    this.deleteReadError = codeMessage(code);
  }

  #retryImpact(): void {
    const target = this.deleteTarget;
    if (target === null || this.deleteSubmitting) return;
    this.deleteLoading = true;
    this.deleteReadError = "";
    this.#readImpact(target);
  }

  #closeDelete(): void {
    this.#deleteGeneration++;
    this.#impactQueries.release("getDeviceDeleteImpact");
    this.deleteTarget = null;
    this.deleteImpact = null;
    this.deleteLoading = false;
    this.deleteSubmitting = false;
    this.deleteReadError = "";
    this.deleteActionError = "";
  }

  async #confirmDelete(id: string): Promise<void> {
    const target = this.deleteTarget;
    if (target === null || id !== target || this.deleteSubmitting) return;
    const generation = this.#deleteGeneration;
    this.deleteSubmitting = true;
    this.deleteActionError = "";
    try {
      await this.api.deleteDevice(id);
    } catch (error) {
      if (generation !== this.#deleteGeneration) return;
      this.deleteSubmitting = false;
      const code = codeOf(error);
      if (code !== "device.not_found") {
        this.deleteActionError = codeMessage(code);
        return;
      }
      this.#deviceGone(id, true);
      await this.#rewatchDevices();
      return;
    }
    if (generation !== this.#deleteGeneration) return;
    // What opened the dialog goes with the row, and the dialog hands focus to its opener as it closes.
    this.#deleteOpener =
      this.renderRoot.querySelector<HTMLElement>(".heading [data-test=open-add-device]") ??
      this.#deleteOpener;
    this.#deviceGone(id, false);
    await this.#rewatchDevices();
  }

  /** Not `#load`, which would clear a message this screen has just shown. A failure is a read's. */
  async #rewatchDevices(): Promise<void> {
    if (!this.isConnected) return;
    // A failure has already reached `#showReadError`.
    await this.#watchDevices().catch(() => undefined);
  }

  /**
   * Ends everything still open on a device that no longer exists — its delete dialog and its Edit,
   * without asking to keep Edit's drafts — and drops its row. `refuse` says so where something was
   * open on it.
   */
  #deviceGone(id: string, refuse: boolean): void {
    const ours = this.deleteSubmitting && this.deleteTarget === id;
    let open = false;
    if (this.deleteTarget === id) {
      open = true;
      this.#closeDelete();
    }
    if (this.editing?.id === id) {
      open = true;
      this.#endEdit();
    }
    this.devices = this.devices.filter((d) => d.id !== id);
    if (refuse && open && !ours) this.#showError("device.not_found");
  }

  /** A new object on every render would redraw the dialog on every live list update. */
  #deleteDialogCopy(): DeleteDialogCopy {
    const locale = currentLocale();
    if (this.#deleteCopy?.locale !== locale)
      this.#deleteCopy = { locale, copy: deviceDeleteCopy() };
    return this.#deleteCopy.copy;
  }

  #renderDeleteDialog(): TemplateResult {
    return html`<wt-delete-dialog
      data-test="delete-device-dialog"
      .open=${this.deleteTarget !== null}
      .impact=${this.deleteImpact}
      .loading=${this.deleteLoading}
      .submitting=${this.deleteSubmitting}
      .readError=${this.deleteReadError}
      .actionError=${this.deleteActionError}
      .copy=${this.#deleteDialogCopy()}
      .opener=${this.#deleteOpener}
      @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) =>
        void this.#confirmDelete(event.detail.id)}
      @wt-delete-retry=${() => this.#retryImpact()}
      @wt-close=${() => this.#closeDelete()}
    ></wt-delete-dialog>`;
  }

  #renderDevicesTable(): TemplateResult {
    const columns: DataTableColumn<DeviceRow>[] = [
      {
        key: "name",
        label: t("devices.name"),
        sortValue: (d) => d.label,
        searchValue: (d) => d.label,
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
            { value: "none", fixed: true, label: t("equipment.none") },
            { value: "retired", fixed: true, label: t("devices.profile_deleted") },
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
      ...EQUIPMENT_COLUMNS.filter(
        (column) => column.role !== "card_terminal" || this.canManageReaders,
      ).map((column): DataTableColumn<DeviceRow> => ({
        key: column.key,
        choosable: "shown",
        label: t(column.label),
        sortValue: (d) => equipmentName(d, column.role, this.pagePrinters),
        cell: (d) => {
          const inherited =
            d.equipment.find((entry) => entry.role === column.role)?.selection !== "item";
          const name = equipmentName(d, column.role, this.pagePrinters);
          return html`<span
              part=${inherited ? "inherited" : nothing}
              data-test=${`device-${column.key}-${d.id}`}
              >${name}</span
            >${
              inherited && name !== ""
                ? html`<span part="visually-hidden"> ${t("devices.from_profile")}</span>`
                : nothing
            }`;
        },
      })),
      {
        key: "battery",
        choosable: "shown",
        label: t("devices.column_battery"),
        sortValue: (d) => d.batteryLevel,
        cell: (d) => this.#battery(d),
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
      viewKey="waitron.devices.table"
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
      .rowClickLabel=${(d: DeviceRow) => fill("devices.edit_title", { name: d.label })}
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
          html`<span part="waiting-name" data-test=${`waiting-row-${request.id}`}
              >${waitingName(request)}</span
            >${
              request.returning
                ? html`<span part="returning-hint" data-test=${`returning-hint-${request.id}`}
                    >${t(
                      request.returning.profileRetired
                        ? "devices.returning_hint_profile_deleted"
                        : "devices.returning_hint",
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
                >${fill("devices.being_paired_by", { name: request.pairingBy.name })}</span
              >`
            : html`<wt-button
                size="sm"
                variant=${held ? "primary" : "secondary"}
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
      wrap-to-fit
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
      heading=${fill("devices.added", { name: this.added.name })}
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
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=joined-modal]")?.requestClose("navigation")}
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
      ${until === null ? nothing : html`<p class="hint" data-test="pairing-until">${relativeTime(t("devices.window_closes"), until, { deadline: true, now: this.now, timeZone: this.pairing?.timeZone ?? "" })}</p>`}
      ${holdNotice(this.holdStatus, () => void this.#hold.start())}
      ${
        this.askedAgain === null
          ? nothing
          : html`<p class="hint" role="status" data-test="asked-again">
              ${fill("devices.asked_again", { name: this.askedAgain })}
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
          @click=${() => void this.renderRoot.querySelector<WtModal>("[data-test=add-device-modal]")?.requestClose("navigation")}
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
    values: { name: string; profileId: string },
    errors: IdentityErrors,
    on: {
      name(value: string): void;
      profile(value: string): void;
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
      ></wt-combobox>`;
  }

  // ── Kitchen screens ──────────────────────────────────────────────────────────────────────────────

  #sharedDisplay(profileId: string): boolean {
    return (
      this.deviceProfiles.find((profile) => profile.id === profileId)?.formFactor === SHARED_DISPLAY
    );
  }

  #renderSettingsStep(errors: IdentityErrors): TemplateResult {
    const epoch = this.#pairEpoch;
    return html`<div class="pair-fields">
      ${this.#renderIdentityFields(
        "pair",
        { name: this.pairName, profileId: this.chosenProfileId },
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
            this.fieldRefusal = clearedRefusal(this.fieldRefusal, "profile");
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
    const errors = settings ? this.#pairErrors() : { name: "", profile: "" };
    const marked = Object.values(errors).some((error) => error !== "");
    const own = this.#ownErrors();
    const blocked = Object.values(own).some((error) => error !== "");
    return html`<wt-modal
      size="standard"
      height="medium"
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
      heading=${fill("devices.edit_title", { name: device.label })}
      .open=${true}
      .dismissible=${!this.editSaving}
      .beforeClose=${this.#editLeave ? this.#beforeEditClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#editEpoch) this.#endEdit();
      }}
    >
      <div class="edit-fields">
        <section
          class="edit-section"
          data-edit-section="identity"
          aria-labelledby="edit-identity-heading"
        >
          <h3 id="edit-identity-heading">${t("devices.section.identity")}</h3>
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
            },
            this.editSaving,
          )}
          ${this.#renderApproved(errors.approved)}
        </section>
        ${
          kitchen
            ? nothing
            : html`<section
                class="edit-section"
                data-edit-section="printers"
                aria-labelledby="edit-printers-heading"
              >
                <h3 id="edit-printers-heading">${t("printers.list_title")}</h3>
                ${PRINTER_ROLES.map((role) => {
                  const loading = this.printerListsRead.size < 2;
                  const options = loading
                    ? []
                    : this.#printerOptions(role, profile, this.#storedChoice(device, role));
                  return html`<wt-combobox
                    data-test=${role.test}
                    name=${role.form}
                    label=${t(role.label)}
                    search="auto"
                    searchPlaceholder=${t("categories.combobox_search")}
                    noResultsLabel=${t("categories.combobox_no_results")}
                    .placeholder=${
                      !loading
                        ? options[0]!.label
                        : this.#queries.failing("listPrinters") ||
                            this.#queries.failing("listPagePrinters")
                          ? t("printers.refresh_failed")
                          : t("device_profiles.printers_loading")
                    }
                    .options=${options}
                    .value=${form[role.form]}
                    ?disabled=${loading || this.editSaving}
                    .error=${errors[role.field]}
                    .invalid=${errors[role.field] !== ""}
                    @wt-change=${(e: CustomEvent<{ value: string }>) =>
                      this.isConnected &&
                      epoch === this.#editEpoch &&
                      this.#setEdit({ [role.form]: e.detail.value }, role.field)}
                  ></wt-combobox>`;
                })}
              </section>`
        }
        ${
          this.readerState === "hidden"
            ? nothing
            : html`<section
                class="edit-section"
                data-edit-section="reader"
                aria-labelledby="edit-reader-heading"
              >
                <h3 id="edit-reader-heading">${t("devices.default_reader")}</h3>
                ${this.#renderReader(errors.reader)}
              </section>`
        }
        ${
          profile?.formFactor !== "till"
            ? nothing
            : html`<section
                class="edit-section"
                data-edit-section="station"
                aria-labelledby="edit-station-heading"
              >
                <h3 id="edit-station-heading">${t("devices.section.station")}</h3>
                ${this.#renderMadeHere()}
              </section>`
        }
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
    return html`<wt-combobox
      data-test="edit-made-here"
      show-empty-option
      name="madeHereStationIds"
      .label=${t("devices.made_here")}
      .hint=${t("devices.made_here_hint")}
      .value=${this.#madeHereToSend()[0] ?? ""}
      .options=${[
        { value: "", label: t("devices.nowhere") },
        ...this.stations
          .filter((station) => station.active)
          .map((station) => ({ value: station.id, label: station.name })),
      ]}
      ?disabled=${this.editSaving}
      @wt-change=${(e: CustomEvent<{ value: string }>) =>
        this.isConnected &&
        epoch === this.#editEpoch &&
        this.#setEdit({ madeHere: e.detail.value === "" ? [] : [e.detail.value] })}
    ></wt-combobox>`;
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
      .placeholder=${this.#readerOptions()[0]!.label}
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
      ${this.#renderEditDialog()} ${this.#renderDeleteDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-devices-screen": DevicesScreen;
  }
}
