import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  rowActionTail,
  focusFirstInvalid,
  FormFeedback,
  submitOnEnter,
  UrlStateController,
  navigationGuardFor,
  baseStyles,
  pageTitleStyles,
  type DataTableColumn,
  type WtModal,
  leaveCoordinatorFor,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "@waitron/ui/src/components/wt-notice.js";
import "../widgets/row-actions.js";
import "../widgets/print-job-preview.js";
import "../widgets/page-printer-add.js";
import { PageTestPages, pageFailureReason } from "../widgets/page-test-pages.js";
import { holdNotice, holdNoticeStyles } from "../widgets/hold-notice.js";
import "../widgets/equipment-label.js";
import "../widgets/print-job-reprint-dialog.js";
import { holderText } from "../i18n/equipment.js";
import { HardwareDeleteDialog } from "../widgets/hardware-delete-dialog.js";
import { printerDeleteCopy } from "../widgets/printer-delete-copy.js";
import { relativeTime } from "../widgets/relative-time.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { guideHref } from "../help-guide.js";
import type { StringKey } from "../i18n/strings.js";
import { dashboardPath } from "../navigation.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { jobStatusName, transportName } from "../i18n/domain.js";
import { holdReason } from "../i18n/a4-holds.js";
import { formatIsoMinute, formatRecentMinute } from "../date-utils.js";
import { settingsCardStyles, settingsRows, type SettingsRow } from "../widgets/settings-card.js";
import { DashboardQueries } from "../api/query-controller.js";
import { PairingHold, type PairingHoldStatus } from "../api/pairing-hold.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { SETTING_WIDTHS, textGrid } from "@waitron/printing/src/layout.js";
import type {
  BluetoothCommandStatus,
  BluetoothFailureReason,
  BluetoothUnavailableReason,
  DashboardApi,
  DiscoveredPrinter,
  JoinRequestRow,
  OfficePrinterReport,
  PagePrinterEntry,
  PagePrinterRow,
  PairingModeState,
  PrintAgentRow,
  PrintJobRow,
  PrintJobStatus,
  PrintJobPreview,
  PrintPaperWidth,
  PrintResolution,
  PrintTransport,
  Printer,
  PrinterPatch,
  PrinterAddressProbe,
  PrinterProfileOffer,
  PrinterStationName,
} from "../api/client.js";

function isProbeIpAddress(host: string): boolean {
  try {
    if (/^\d+(?:\.\d+){3}$/.test(host)) return new URL(`http://${host}`).hostname === host;
    return /^[\da-f:.]+$/i.test(host) && URL.canParse(`http://[${host}]`);
  } catch {
    return false;
  }
}

export const printerSettingFields = [
  {
    id: "printer-detail-name",
    name: "printer-detail-name",
    labelKey: "printers.name",
    editor: "edit",
    rows: "all",
  },
  {
    id: "printer-detail-host",
    name: "printer-detail-host",
    labelKey: "printers.host",
    editor: "edit",
    rows: "network",
  },
  {
    id: "printer-detail-port",
    name: "printer-detail-port",
    labelKey: "printers.port",
    editor: "edit",
    rows: "network",
  },
  {
    id: "printer-ruler-number",
    name: "printer-ruler-number",
    labelKey: "printers.ruler_last_number",
    editor: "calibrate",
    step: 1,
    rows: "receipt",
  },
  {
    id: "paper-width",
    name: "printer-ruler-number",
    labelKey: "printers.paper_width",
    editor: "calibrate",
    step: 1,
    rows: "receipt",
  },
  {
    id: "printer-qr-square",
    name: "printer-qr-square",
    labelKey: "printers.qr_square",
    editor: "calibrate",
    step: 1,
    rows: "receipt",
  },
  {
    id: "resolution",
    name: "printer-qr-square",
    labelKey: "printers.resolution",
    editor: "calibrate",
    step: 1,
    rows: "receipt",
  },
  {
    id: "printer-cash-drawer",
    name: "printer-cash-drawer",
    labelKey: "printers.drawer_attached",
    editor: "calibrate",
    step: 3,
    rows: "receipt",
  },
  {
    id: "printer-portable",
    name: "printer-portable",
    labelKey: "printers.portable",
    editor: "calibrate",
    step: 3,
    rows: "receipt",
  },
  {
    id: "printer-pickup-roles",
    name: "printer-pickup-roles",
    labelKey: "printers.pickup_roles",
    editor: "calibrate",
    step: 3,
    rows: "receipt",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  labelKey: StringKey;
  editor: "edit" | "calibrate";
  step?: 1 | 3;
  rows: "all" | "network" | "receipt";
}[];

/** The printer details form, as it would be saved. */
interface DetailEditValues {
  name: string;
  host: string;
  port: string;
}

type DetailEditErrors = Record<keyof DetailEditValues, string>;

/** One row of the printers table: a receipt printer or an A4 printer, stored apart. */
type PrinterTableRow = { kind: "receipt"; printer: Printer } | { kind: "a4"; row: PagePrinterRow };

type PrinterFilterOptions = NonNullable<DataTableColumn<PrinterTableRow>["filter"]>["options"];

function printerRowId(r: PrinterTableRow): string {
  return r.kind === "receipt" ? r.printer.id : r.row.id;
}

function agentProvenance(agent: PrintAgentRow): { text: string; self: boolean } | null {
  if (agent.nodeId === null) return null;
  return agent.onThisBox
    ? { text: t("printers.provenance_self"), self: true }
    : { text: t("printers.provenance_other_box"), self: false };
}

function hasErrors(errors: DetailEditErrors): boolean {
  return Object.values(errors).some((error) => error !== "");
}

const JOB_STATUSES: readonly PrintJobStatus[] = ["queued", "printing", "done", "failed", "unknown"];

function pageSize(media: PagePrinterRow["media"]): string {
  return t(
    media === "iso_a4_210x297mm"
      ? "printers.invoice_printer_a4"
      : "printers.invoice_printer_letter",
  );
}

function detailsSection(section: {
  id: string;
  heading: string;
  dataTest: string;
  className?: string;
  rows: SettingsRow[];
  before?: TemplateResult;
  after?: TemplateResult | typeof nothing;
}): TemplateResult {
  return html`<section
    class=${section.className ?? nothing}
    data-test=${section.dataTest}
    aria-labelledby=${section.id}
  >
    <h3 id=${section.id}>${section.heading}</h3>
    ${section.before ?? nothing} ${settingsRows(section.rows)} ${section.after ?? nothing}
  </section>`;
}

const USE_WORDS = {
  receipt: "printers.use_receipt",
  payment_slip: "printers.use_payment_slip",
  cash_drawer: "printers.use_cash_drawer",
  invoice: "printers.use_invoice",
} as const satisfies Record<PrinterProfileOffer["roles"][number], StringKey>;

/** `printers.used_by_profile` with the profile's name, or its link, in place of `{profile}`. */
function usedByProfileLine(
  profile: TemplateResult | string,
  uses: string,
): (TemplateResult | string)[] {
  return t("printers.used_by_profile")
    .split(/(\{profile\}|\{uses\})/)
    .map((part) => (part === "{profile}" ? profile : part === "{uses}" ? uses : part));
}

function commaList(items: (TemplateResult | string)[]): TemplateResult {
  return html`${items.flatMap((item, index) => (index === 0 ? [item] : [", ", item]))}`;
}

interface PrinterDraft {
  name: string;
  host: string;
  port: string;
  transport: PrintTransport;
  localKey?: string;
  pollId?: string;
}

/** The `last_error` codes of a job the server ended itself, setting its attempts to the cap. */
const ENDED_BY_SERVER = new Set(["printer.deleted", "print_job.moved", "receipt.out_of_date"]);

const LOCALIZED_JOB_REASONS = new Set([
  ...ENDED_BY_SERVER,
  "print_job.drawer_expired",
  "print_job.drawer_outcome_unknown",
]);

const jobReason = (lastError: string): string =>
  LOCALIZED_JOB_REASONS.has(lastError) ? codeMessage(lastError) : lastError;

function jobWaitMessage(job: PrintJobRow): string | undefined {
  if (job.waitReason !== undefined) return codeMessage(job.waitReason);
  if (job.printerHold == null) return undefined;
  if (job.printerHold === "paper_out")
    return fill("printers.job_paper_out", { printer: job.printerName });
  const reason = holdReason(job.printerHold);
  return reason === undefined
    ? undefined
    : fill("printers.job_held", { printer: job.printerName, reason });
}

function jobErrorMessage(job: PrintJobRow): string | undefined {
  if (job.lastError === null) return undefined;
  if (job.kind === "a4" && job.lastError === "switched")
    return t("printers.job_switched_to_receipt");
  return job.kind === "a4" ? pageFailureReason(job.lastError) : jobReason(job.lastError);
}

const refusalParams = (error: unknown) =>
  (error as { params?: { field?: unknown; kind?: unknown; seconds?: unknown } } | null)?.params;

const refusedField = (error: unknown): unknown => refusalParams(error)?.field;

/** The agent's own PIN rule (`isBluetoothPin`, packages/print-agent/src/client.ts), repeated here
 * because the dashboard does not depend on that package. */
const BLUETOOTH_PIN = /^[\x21-\x7e]{1,16}$/;

type CommandState = BluetoothCommandStatus["state"] | "no_answer";

/** The screen's own copy of a command's status: the server's copy leaves with the device's row. */
type TrackedCommand = Omit<BluetoothCommandStatus, "state" | "expiresInMs" | "error"> & {
  state: CommandState;
  answerBy: number;
  deletedPrinter?: { name: string; agentName: string };
  /** A Pair's device as listed when its Pair dialog was opened, so its status keeps a row once the
   * scan loses it. */
  device?: DiscoveredPrinter;
  /** A success notice that has faded. */
  noticeGone?: true;
};

/** What an office printer's discovery row offers, judged against the venue's page printers. */
type OfficeRow =
  | { kind: "add"; entry: PagePrinterEntry }
  | { kind: "repoint"; entry: PagePrinterEntry; agentGone: boolean }
  | { kind: "added" }
  | { kind: "refused"; reason: StringKey };
type ListedOfficeRow = Exclude<OfficeRow, { kind: "added" }>;

const OFFICE_REFUSAL: Record<
  Extract<OfficePrinterReport, { printable: false }>["reason"],
  StringKey
> = {
  invalid_reply: "printers.page_printer_no_answer",
  unsupported_media: "printers.page_printer_unsupported_media",
  unsupported_document_format: "printers.page_printer_unsupported_document_format",
  unsupported_raster: "printers.page_printer_unsupported_raster",
};

/** How long a command's success notice stays before it fades. */
const NOTICE_MS = 4000;

const isProblem = ({ state }: TrackedCommand): boolean =>
  state === "failed" || state === "no_answer";

const COMMAND_TEXT: Record<BluetoothCommandStatus["kind"], Record<CommandState, StringKey>> = {
  pair: {
    pending: "printers.bluetooth_pairing",
    succeeded: "printers.bluetooth_paired",
    failed: "printers.bluetooth_pair_failed",
    no_answer: "printers.bluetooth_no_answer",
  },
  forget: {
    pending: "printers.bluetooth_forgetting",
    succeeded: "printers.bluetooth_forgotten",
    failed: "printers.bluetooth_forget_failed",
    no_answer: "printers.bluetooth_no_answer",
  },
};

const FAILURE_REASON_TEXT: Readonly<
  Record<Exclude<BluetoothFailureReason, "pairing_refused">, StringKey>
> = {
  wrong_pin: "printers.bluetooth_reason.wrong_pin",
  pin_needed: "printers.bluetooth_reason.pin_needed",
  pin_too_slow: "printers.bluetooth_reason.pin_too_slow",
  unsupported_method: "printers.bluetooth_reason.unsupported_method",
  not_found: "printers.bluetooth_reason.not_found",
  out_of_range: "printers.bluetooth_reason.out_of_range",
  timed_out: "printers.bluetooth_reason.timed_out",
  bluetooth_unavailable: "printers.bluetooth_reason.bluetooth_unavailable",
};

const BLUETOOTH_UNAVAILABLE_TEXT: Readonly<Record<BluetoothUnavailableReason, StringKey>> = {
  no_controller: "printers.bluetooth_unavailable.no_controller",
  bluez_not_answering: "printers.bluetooth_unavailable.not_enabled",
  failed: "printers.bluetooth_unavailable.not_enabled",
  dbus_unreachable: "printers.bluetooth_unavailable.not_enabled",
};

const FAILURE_GENERAL_TEXT: Record<BluetoothCommandStatus["kind"], StringKey> = {
  pair: "printers.bluetooth_pair_failed_general",
  forget: "printers.bluetooth_forget_failed_general",
};

/** The agent's own error text is English for its log, so a failure is worded from its code alone. */
function commandText({ kind, state, reason }: TrackedCommand): string {
  const text = t(COMMAND_TEXT[kind][state]);
  if (state !== "failed") return text;
  if (reason === "pairing_refused") return t("printers.bluetooth_reason.pairing_refused");
  const words =
    reason !== undefined && Object.hasOwn(FAILURE_REASON_TEXT, reason)
      ? FAILURE_REASON_TEXT[reason]
      : FAILURE_GENERAL_TEXT[kind];
  return `${text}: ${t(words)}`;
}

const commandKey = (agentId: string, address: string): string =>
  `${agentId}:${address.toUpperCase()}`;

interface EditablePrinter {
  id: string;
  name: string;
  transport: PrintTransport;
  host: string;
  port: string;
  localKey: string;
  pollId: string;
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  hasCashDrawer: boolean;
  portable: boolean;
  pickupRoles: Printer["pickupRoles"];
  /** The settings as saved, so a save sends only the ones that changed. */
  saved: {
    paperWidth: PrintPaperWidth;
    resolution: PrintResolution;
    hasCashDrawer: boolean;
    portable: boolean;
    pickupRoles: Printer["pickupRoles"];
  };
  active: boolean;
}

type CalibrationSettings = Pick<
  EditablePrinter,
  "paperWidth" | "resolution" | "hasCashDrawer" | "portable" | "pickupRoles"
>;

/** Discovery reports arrive on later agent polls, so a scan listens beyond its initial read. */
export const SCAN_LISTEN_MS = 30_000;
export const AGENT_SCAN_LISTEN_MS = 10_000;
export const SCAN_POLL_MS = 2_000;
/** Well inside the server's three-minute discovery window, so one failed renewal loses nothing. */
export const DISCOVERY_RENEW_MS = 60_000;

@customElement("dashboard-printers-screen")
export class PrintersScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    holdNoticeStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
      }
      wt-data-table::part(printer-meta) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(printer-name) {
        text-align: start;
        overflow-wrap: anywhere;
        --wt-color-text: var(--wt-color-primary-text);
      }
      wt-data-table::part(page-printer-hint) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(page-printer-test-page) {
        display: block;
        padding-inline-start: var(--wt-space-4);
        font-size: var(--wt-font-size-sm);
        max-width: calc(2 * var(--wt-cell-name-max-width));
        white-space: normal;
      }
      /* The table is never narrower than its content (min-width: max-content, wt-data-table.ts),
         so a long reason gets a width cap to make it wrap. */
      wt-data-table::part(job-reason) {
        max-width: calc(var(--wt-space-6) * 8);
        overflow-wrap: anywhere;
      }
      .status-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      wt-data-table::part(job-actions) {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      wt-data-table::part(printer-provenance) {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(discovered-details) {
        max-width: 28vw;
        overflow-wrap: anywhere;
      }
      wt-data-table::part(bluetooth-address) {
        overflow-wrap: normal;
      }
      wt-data-table::part(discovered-page-printer),
      wt-data-table::part(page-printer-hint) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(page-printer-error) {
        display: block;
        max-width: 28vw;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(page-printer-hint) {
        display: block;
        max-width: 28vw;
        font-size: var(--wt-font-size-sm);
      }
      /* Capped like the name beside it, so a button's label wraps instead of widening a phone's
         list past its screen in a wider font. */
      wt-data-table::part(page-printer-action) {
        display: block;
        max-width: 40vw;
      }

      /* wt-data-table is at least max-content wide, so without a cap these would never wrap, and a
         failure's worded reason would widen the whole list. */
      wt-data-table::part(bluetooth-actions) {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        align-items: center;
        max-width: 40vw;
        /* A button's label stays on one line: the cap gives way to the widest one instead. */
        min-width: min-content;
        white-space: nowrap;
      }
      wt-data-table::part(bluetooth-status) {
        white-space: normal;
        overflow-wrap: anywhere;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(bluetooth-problem) {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(bluetooth-progress) {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }

      /* An inline dot, not a flex row: the table lines a row up by its cells' first baselines, and a
         flex row would take its baseline from the dot's box rather than the status text. */
      wt-data-table::part(job-status)::before {
        content: "";
        display: inline-block;
        vertical-align: middle;
        margin-inline-end: var(--wt-space-2);
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: 50%;
        background: var(--wt-color-text-muted);
      }
      wt-data-table::part(job-done)::before {
        background: var(--wt-color-success);
      }
      wt-data-table::part(job-failed)::before {
        background: var(--wt-color-danger);
      }
      wt-data-table::part(job-unknown)::before {
        background: var(--wt-color-warning);
      }
      wt-data-table::part(job-printing)::before {
        background: var(--wt-color-primary);
      }
      .printer-filter {
        display: grid;
        gap: var(--wt-space-1);
        max-width: calc(var(--wt-space-6) * 10);
        margin-bottom: var(--wt-space-3);
      }
      .form-fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      [hidden] {
        display: none;
      }
      /* The test page's note sits under the buttons, across the footer's width. */
      .a4-footer {
        flex: 1;
        display: grid;
        gap: var(--wt-space-2);
      }
      .test-page-note {
        font-size: var(--wt-font-size-sm);
      }
      .test-page-note p {
        margin: 0;
      }
      /* A row of fields is one line of the form: in a modal it takes a field's width, so the button
         beside a field stays beside it instead of at the modal's far edge. */
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-end;
        max-width: var(--wt-field-max-width);
        --wt-form-actions-in-place: true;
      }
      .status-grid {
        display: grid;
        gap: var(--wt-space-4);
        width: 100%;
        max-width: var(--wt-form-max-width);
      }
      /* Tap-height as a box of its own, so a link's line grows to hold it and no link's target
         overlaps the line above or below. */
      .used-by a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      .used-by a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .status-fields {
        display: grid;
        gap: var(--wt-space-4);
        margin: 0;
      }
      .status-fields dt {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .status-fields dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .field-row > * {
        flex: 1 1 calc(var(--wt-space-6) * 6);
        min-width: 0;
      }
      .field-row > [name$="port"] {
        flex: 0 1 calc(var(--wt-space-6) * 4);
      }
      .print-row {
        display: flex;
        justify-content: flex-end;
        max-width: var(--wt-field-max-width);
      }
      .calibration-results {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        max-width: var(--wt-field-max-width);
      }
      .ruler-disagrees {
        max-width: var(--wt-field-max-width);
      }
      .calibration-results > div {
        flex: 1 1 calc(var(--wt-space-6) * 6);
        min-width: 0;
      }
      .field-row > wt-form-actions {
        flex: 0 1 auto;
        width: auto;
        margin-inline-start: auto;
      }
      .field-row > wt-form-actions.with-message {
        flex-basis: 100%;
      }
      fieldset {
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .radio-answer {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      input[type="radio"] {
        accent-color: var(--wt-color-primary);
      }
      .setup-steps {
        list-style: decimal;
        padding-left: var(--wt-space-5);
        margin-bottom: var(--wt-space-4);
      }
      .origin {
        overflow-wrap: anywhere;
      }
      .setting-field {
        display: grid;
        gap: var(--wt-space-1);
      }
      .probe-panel {
        margin-bottom: var(--wt-space-4);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .probe-panel summary {
        cursor: pointer;
        font-weight: var(--wt-font-weight-bold);
      }
      .probe-panel[open] summary {
        margin-bottom: var(--wt-space-3);
      }
      .scan-actions {
        justify-content: flex-end;
        margin-bottom: var(--wt-space-3);
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      h2.title {
        font-size: var(--wt-font-size-lg);
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
      .hint {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
      .switch-field .hint {
        margin: var(--wt-space-2) 0 0;
      }
      .origin {
        font-family: var(--wt-font-family-mono, monospace);
        color: var(--wt-color-text);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
        flex-wrap: wrap;
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
      .sent {
        display: block;
        color: var(--wt-color-text-muted);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  /** The session holds `hardware.manage`: A4 printers offer their actions. */
  @property({ type: Boolean }) canManage = false;
  /** The session holds `hardware.manage` and `venue.configure`, as the Prep stations editor
   *  requires: Put on every station is offered. */
  @property({ type: Boolean }) canManageStationPrinters = false;
  /** Whether the person may open a dashboard screen; a Used by name links only to one they may. */
  @property({ attribute: false }) canOpen: (screen: string) => boolean = () => false;
  /** How long to wait between reads of an A4 test page that is still out. */
  @property({ attribute: false }) testPagePollMs = 2_000;
  readonly #testPages = new PageTestPages(this, {
    api: () => this.api,
    pollMs: () => this.testPagePollMs,
  });
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.refreshErrorKey = codeOf(error);
    },
    (error) => {
      if (this.refreshErrorKey === codeOf(error)) this.refreshErrorKey = null;
      if (this.#loadFailed) void this.#watchLists();
    },
  );
  #loadFailed = false;
  @state() private discoveredUnread = false;

  @state() private view = "";
  @state() private selectedPrinterId: string | null = null;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "printers") return;
      const printerId = this.#url.read("printer");
      if (printerId !== this.selectedPrinterId) {
        const editing = this.editingPrinter;
        if (editing && editing.id !== printerId) {
          this.#disposeCalibrationDraft();
          this.editingPrinter = null;
          this.#closeTest();
        }
        this.#resetPrinterSections();
      }
      this.selectedPrinterId = printerId;
      const view = this.#url.read("view");
      this.view =
        view !== null && ["queue", "printers", "agents"].includes(view)
          ? view
          : this.loading
            ? ""
            : this.#defaultView();
      if (this.view) this.#url.write({ view: this.view }, true);
      this.#restorePrinterTarget();
    },
    dashboardPath,
  );

  #printersReady = false;
  #pagePrintersReady = false;
  #restoredPrinterTarget: string | null = null;
  @state() private settingUnavailable = false;

  #restorePrinterTarget(): void {
    const id = this.selectedPrinterId;
    const editor = this.#url.read("editor");
    const step = this.#url.read("step");
    const target =
      id !== null && (editor !== null || step !== null) ? JSON.stringify([id, editor, step]) : null;
    if (target === this.#restoredPrinterTarget) return;
    if (this.#restoredPrinterTarget !== null) {
      this.#disposeDetailDrafts();
      this.#disposeCalibrationDraft();
      this.editingPrinter = null;
      this.#closeTest();
    }
    this.#restoredPrinterTarget = null;
    this.settingUnavailable = false;
    if (target === null) return;
    const printer = this.printers.find((row) => row.id === id);
    const page = this.pagePrinters.find((row) => row.id === id);
    if (!printer && !page && (!this.#printersReady || !this.#pagePrintersReady)) return;
    this.#restoredPrinterTarget = target;
    if (!printer && !page) return;
    if (editor === "edit" && step === null && (printer || this.canManage)) {
      this.#openDetailEdit(
        id!,
        printer ? this.#savedEditValues(printer) : { name: page!.name, host: "", port: "" },
      );
    } else if (
      editor === "calibrate" &&
      printer &&
      (step === "1" || step === "2" || step === "3")
    ) {
      this.#disposeDetailDrafts();
      this.#openPrinter(printer);
      this.calibrationStep = Number(step);
    } else this.settingUnavailable = true;
  }

  #clearPrinterEditor(): void {
    if (this.#url.read("editor") !== null || this.#url.read("step") !== null)
      void this.#url.write({ editor: null, step: null }, true);
  }

  #calibrationStepAddress(): void {
    if (this.#url.read("editor") !== "calibrate") return;
    const step = String(this.calibrationStep);
    this.#restoredPrinterTarget = JSON.stringify([this.selectedPrinterId, "calibrate", step]);
    const guard = navigationGuardFor(window);
    if (!guard) {
      this.#url.write({ step }, true);
      return;
    }
    const url = new URL(guard.href);
    url.pathname = url.pathname.replace(/\/step\/[^/]+$/, `/step/${step}`);
    guard.rewrite(url);
  }

  #defaultView(): string {
    return !this.agents.some((agent) => agent.active)
      ? "agents"
      : !this.printers.some((printer) => printer.active)
        ? "printers"
        : "queue";
  }

  @state() private submitting = false;
  @state() private acceptingChoice: string | null = null;
  @state() private allowingAgentId: string | null = null;
  @state() private agents: PrintAgentRow[] = [];
  @state() private printers: Printer[] = [];
  @state() private pagePrinters: PagePrinterRow[] = [];
  /** `#pagePrinterReads` when the live query last delivered, so a one-off read begun earlier is dropped. */
  #pagePrinterLiveAt = 0;
  #pagePrinterReads = 0;
  @state() private addingPagePrinter: {
    entry: PagePrinterEntry;
    description: string;
    suggestedName: string;
  } | null = null;
  /** The office rows (`agentId:deviceKey`) whose Enable or Use this agent is being sent. */
  @state() private pagePrinterSending = new Set<string>();
  @state() private pagePrinterRefusals: Record<string, string> = {};
  @state() private loading = true;
  @state() private addingAgent = false;
  @state() private addingPrinter = false;
  #addPrinterOpening = 0;
  #addressScope?: DraftScope<{ host: string; port: string }>;
  #addressLeave?: LeaveCoordinator;
  readonly #beforeAddPrinterClose = async (reason: LeaveReason): Promise<boolean> =>
    this.submitting ||
    (this.pairSubmitting && !this.#addressScope?.isDirty() && !this.#printerNameScope?.isDirty()) ||
    !this.#addressScope ||
    (await this.#addressLeave!.request({
      scopes: [this.#addressScope.id],
      reason,
      proceed() {},
    })) === "proceeded";

  #addressValues(): { host: string; port: string } {
    const port = Number(this.probePort);
    return {
      host: this.probeHost.trim(),
      port:
        /^\d+$/.test(this.probePort) && Number.isInteger(port) && port >= 1 && port <= 65535
          ? String(port)
          : this.probePort,
    };
  }

  #disposeAddressDraft(): void {
    this.#addressScope?.dispose();
    this.#addressScope = undefined;
    this.#addressLeave = undefined;
  }
  @state() private namingPrinter: DiscoveredPrinter | null = null;
  #printerNameScope?: DraftScope<string>;
  #printerNameLeave?: LeaveCoordinator;
  #printerNameOpening = 0;
  readonly #beforePrinterNameClose = async (reason: LeaveReason): Promise<boolean> =>
    this.submitting ||
    !this.#printerNameScope ||
    (await this.#printerNameLeave!.request({
      scopes: [this.#printerNameScope.id],
      reason,
      proceed() {},
    })) === "proceeded";

  #namePrinter(device: DiscoveredPrinter): void {
    if (device.retainedName !== undefined || this.#disabledPrinter(device)) {
      void this.#registerDiscovered(device);
      return;
    }
    this.#disposePrinterNameDraft();
    this.namingPrinter = device;
    this.formAttempted = false;
    this.errorKey = null;
    const key = this.#deviceKey(device);
    const name =
      this.discoveredNames[key] ??
      device.retainedName ??
      this.#disabledPrinter(device)?.name ??
      this.#discoveredLabel(device);
    this.discoveredNames = { ...this.discoveredNames, [key]: name };
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=name-printer-modal]");
    if (modal) modal.open = true;
    this.#printerNameLeave = leaveCoordinatorFor(this);
    this.#printerNameScope = this.#printerNameLeave?.register<string>({
      id: {},
      parent: this.#addressScope?.id,
      current: () => this.discoveredNames[key]!.trim(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.discoveredNames = { ...this.discoveredNames, [key]: value };
      },
    });
    void this.#selectPrinterName(this.#printerNameOpening);
  }

  /** Once the dialog has opened and focused its field, so typing replaces the filled-in name. */
  async #selectPrinterName(opening: number): Promise<void> {
    await this.updateComplete;
    await this.renderRoot.querySelector<WtModal>("[data-test=name-printer-modal]")?.updateComplete;
    if (opening !== this.#printerNameOpening) return;
    const field = this.renderRoot.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[data-test=name-printer-modal] wt-input[name=new-printer-name]",
    );
    await field?.updateComplete;
    field?.select();
  }

  #finishPrinterName(opening: number): void {
    if (opening !== this.#printerNameOpening) return;
    this.#disposePrinterNameDraft();
    this.namingPrinter = null;
    this.formAttempted = false;
  }

  #disposePrinterNameDraft(): void {
    this.#printerNameOpening++;
    this.#printerNameScope?.dispose();
    this.#printerNameScope = undefined;
    this.#printerNameLeave = undefined;
  }
  @state() private discoveredNames: Record<string, string> = {};
  @state() private calibrationStep = 1;
  @state() private detailEdit: {
    id: string;
    name: string;
    host: string;
    port: string;
    saving: boolean;
    error: string | null;
    /** A refusal the server tied to the name field, shown under it until the name changes. */
    nameRefusal: string | null;
  } | null = null;
  #detailEditScope?: DraftScope<DetailEditValues>;
  /** What the form opened with, or last saved. */
  #detailEditBaseline?: DetailEditValues;
  @state() private testingDrawer = false;
  @state() private drawerTestSent = false;
  @state() private drawerOutcome = "";
  @state() private printingTest = false;
  @state() private printingSample = false;
  @state() private rulerNumber = "";
  #testEpoch = 0;
  #calibrationEpoch = 0;
  #calibrationShownEpoch = 0;
  @state() private testError: string | null = null;
  @state() private editingPrinter: EditablePrinter | null = null;
  #calibrationScope?: DraftScope<CalibrationSettings>;
  #calibrationLeave?: LeaveCoordinator;
  #calibrationOpening = 0;
  #calibrationOpenedByAdd = false;
  readonly #beforeCalibrationClose = async (reason: LeaveReason): Promise<boolean> =>
    this.submitting ||
    this.printingTest ||
    this.printingSample ||
    this.testingDrawer ||
    !this.#calibrationLeave ||
    (await this.#calibrationLeave.request({
      scopes: [this.#calibrationScope!.id],
      reason,
      proceed() {},
    })) === "proceeded";

  #calibrationValues(): CalibrationSettings {
    const { paperWidth, resolution, hasCashDrawer, portable, pickupRoles } = this.editingPrinter!;
    return { paperWidth, resolution, hasCashDrawer, portable, pickupRoles };
  }

  #disposeCalibrationDraft(): void {
    this.#calibrationOpening++;
    this.#calibrationOpenedByAdd = false;
    this.#calibrationScope?.dispose();
    this.#calibrationScope = undefined;
    this.#calibrationLeave = undefined;
  }

  #finishCalibration(opening: number): void {
    if (opening !== this.#calibrationOpening) return;
    this.#disposeCalibrationDraft();
    this.editingPrinter = null;
    this.#closeTest();
    this.#clearPrinterEditor();
    this.#restoreEditFocus();
  }
  @state() private editingAgent: PrintAgentRow | null = null;
  #agentScope?: DraftScope<string>;
  #agentLeave?: LeaveCoordinator;
  #agentOpening = 0;
  readonly #beforeAgentClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.submitting &&
    (await this.#agentLeave!.request({ scopes: [this.#agentScope!.id], reason, proceed() {} })) ===
      "proceeded";

  #editAgent(agent: PrintAgentRow): void {
    this.#disposeAgentDraft();
    this.editingAgent = { ...agent };
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=edit-agent-modal]");
    if (modal) modal.open = true;
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: {},
      current: () => this.editingAgent!.name.trim(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (name) => {
        this.editingAgent = { ...this.editingAgent!, name };
      },
    });
    this.#agentLeave = coordinator;
    this.#agentScope = scope;
  }

  #finishAgentEdit(opening: number): void {
    if (opening !== this.#agentOpening) return;
    this.#disposeAgentDraft();
    this.editingAgent = null;
    this.#restoreEditFocus();
  }

  #disposeAgentDraft(): void {
    this.#agentOpening++;
    this.#agentScope?.dispose();
    this.#agentScope = undefined;
    this.#agentLeave = undefined;
  }
  /** Whether the open agent, printer or printer-name form has been submitted since it opened. */
  @state() private formAttempted = false;
  @state() private preview: PrintJobPreview | null = null;
  @state() private previewOpen = false;
  @state() private jobs: PrintJobRow[] = [];
  @state() private completedJobsPage = 0;
  @state() private readingCompletedJobs = false;
  /** The job the Reprint dialog is open on: its row in `jobs`, or the last one it had there. */
  @state() private reprintJob: PrintJobRow | null = null;
  /** Jobs whose reprint has been sent and not answered, even after the dialog closed. */
  @state() private reprintsSending: ReadonlySet<string> = new Set();
  readonly #reprintApi: Pick<DashboardApi, "resendPrintJob"> = {
    resendPrintJob: async (id, printerId) => {
      this.reprintsSending = new Set([...this.reprintsSending, id]);
      try {
        return await this.api.resendPrintJob(id, printerId);
      } catch (error) {
        if (this.reprintJob?.id !== id) this.errorKey = codeOf(error);
        throw error;
      } finally {
        this.reprintsSending = new Set([...this.reprintsSending].filter((job) => job !== id));
      }
    },
  };
  /** The printer a reprint was last sent to, while its notice shows. */
  @state() private reprintSentTo: string | null = null;
  /** The last print the edit or calibration dialog sent. */
  @state() private calibrationJobId: string | null = null;

  @state() private printerProfiles: PrinterProfileOffer[] = [];
  @state() private printerStations: PrinterStationName[] = [];
  /** Which of the Used by reads have answered: until both have, no usage does not mean none. */
  @state() private usageRead: ReadonlySet<"profiles" | "stations"> = new Set();

  @state() private deletingAgent: PrintAgentRow | null = null;
  #agentDeleteOpener: HTMLElement | null = null;

  // Pairing is venue-wide; challenges stay cached because each request's numbers are fixed.
  @state() private pairing: PairingModeState | undefined;
  @state() private pendingJoins: JoinRequestRow[] = [];
  @state() private openRequestId: string | null = null;
  @state() private challenges: Record<string, string[]> = {};
  @state() private armedDenyId: string | null = null;

  @state() private discovered: DiscoveredPrinter[] = [];
  @state() private showAllBluetooth = false;
  @state() private pairingDevice: DiscoveredPrinter | null = null;
  /** Held only while the Pair dialog is open. */
  @state() private pairPin = "";
  @state() private pairAttempted = false;
  /** The server refused the PIN; shown under the field until it changes. */
  @state() private pairRefused = false;
  @state() private pairErrorKey: string | null = null;
  #bluetoothBusyParams?: { kind?: unknown; seconds?: unknown };
  @state() private pairSubmitting = false;
  #pairEpoch = 0;
  #pairScope?: DraftScope<string>;
  /** The switched-off Bluetooth printer Pair again looks for, and the scan's entry for it once
   * found. */
  @state() private pairAgain: { printer: Printer; found: DiscoveredPrinter | null } | null = null;
  @state() private pairedAgainName: string | null = null;
  @state() private pairAgainSwitching = false;
  #pairAgainOpening = 0;
  /** Holds no value: the parent of the Pair dialog's PIN, so closing Pair again asks about it. */
  #pairAgainScope?: DraftScope<null>;
  #pairAgainLeave?: LeaveCoordinator;
  readonly #beforePairAgainClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#pairAgainLeave ||
    (await this.#pairAgainLeave.request({
      scopes: [this.#pairAgainScope!.id],
      reason,
      proceed() {},
    })) === "proceeded";
  #pairLeave?: LeaveCoordinator;
  readonly #beforePairClose = async (reason: LeaveReason): Promise<boolean> =>
    this.pairSubmitting ||
    !this.#pairLeave ||
    (await this.#pairLeave.request({
      scopes: [this.#pairScope!.id],
      reason,
      proceed() {},
    })) === "proceeded";
  @state() private commands: Record<string, TrackedCommand> = {};
  /** Command key to answerBy for each pairing that succeeded while Add a printer or Pair again is open. */
  @state() private pairedDevices: Record<string, number> = {};
  @state() private bluetoothDeleteWarnings: Record<
    string,
    { name: string; agentName: string | null }[]
  > = {};
  #commandTimer?: ReturnType<typeof setInterval>;
  #commandReadInFlight = false;
  /** Rebuilt in `willUpdate`, so a row's cells look these up instead of scanning per row. */
  #pairedReports = new Map<string, DiscoveredPrinter>();
  #commandEpoch = 0;
  /** Orders a scan read against live answers received while it was in flight. */
  #readCount = 0;
  /** `#readCount` at the live query's last answer. The query starts its next read only after that
   * answer (`#schedule`, `packages/dashboard-kit/src/live-data.ts`), so the read began later. */
  #liveReadFloor = 0;
  /** The refresh error a failed status read showed, so the next good read can take it back. */
  #commandReadError: string | null = null;
  /** Not `submitting`: the listen runs for seconds and must not block Add or Register. */
  @state() private scanning = false;
  @state() private probeHost = "";
  @state() private probePort = "9100";
  readonly #probeFeedback = new FormFeedback(this);
  /** Address fields the server refused, each shown until the owner changes it. */
  @state() private probeRefused: Partial<Record<"host" | "port", string>> = {};
  /** A refused address check that names no field, shown above Check address. */
  @state() private probeErrorKey: string | null = null;
  @state() private probeStatus:
    "idle" | "pending" | "found" | "missing" | "registered" | "page_printer" = "idle";
  #probeTarget: PrinterAddressProbe | undefined;
  @state() private scanningAgents = false;
  #agentTimer?: ReturnType<typeof setInterval>;
  #agentScanUntil = 0;
  #agentReadInFlight = false;
  #agentEpoch = 0;
  @state() private holdStatus: PairingHoldStatus = "idle";
  /** The taken hold's lapse, shown before the live read of the window next answers. */
  @state() private takenUntil: string | null = null;
  /** The refusal that failed the hold, kept while the hold's status is `failed`. It becomes the
   *  dialog's message when the hold fails and again whenever an agent scan starts; other actions
   *  replace that message. */
  #holdErrorKey: string | null = null;
  readonly #hold = new PairingHold(
    () => this.api,
    (status, code, openUntil) => {
      const previous = this.#holdErrorKey;
      this.holdStatus = status;
      this.takenUntil = status === "held" ? openUntil : null;
      this.#holdErrorKey = status === "failed" ? code : null;
      if (this.#holdErrorKey !== null) this.errorKey = this.#holdErrorKey;
      else if (previous !== null && this.errorKey === previous) this.errorKey = null;
    },
  );
  // `#scanUntil` is wall-clock because a throttled background tab stretches the ticks;
  // `#scanInFlight` stops the next tick overlapping a slow read whose older reply could overwrite
  // `discovered`.
  #scanTimer?: ReturnType<typeof setInterval>;
  #scanUntil = 0;
  #scanInFlight = false;
  #scanEpoch = 0;
  #renewTimer?: ReturnType<typeof setInterval>;
  #registeredDevices = new Set<string>();
  #editTrigger?: HTMLButtonElement;
  @state() private errorKey: string | null = null;
  /** Printers whose test page request has not answered yet. */
  @state() private testPagesPrinting: ReadonlySet<string> = new Set();
  /** The printer a test page was last sent to, while its notice shows. */
  @state() private testPageSent: string | null = null;
  @state() private refreshErrorKey: string | null = null;
  @state() private addedPrinterName: string | null = null;
  /** The portable printer whose equipment label is open. */
  @state() private labelPrinterId: string | null = null;
  #labelOpener: HTMLElement | null = null;

  #deleteIsPage = false;
  #deleteIsBluetooth = false;
  @state() private everyStationId: string | null = null;
  @state() private everyStationSending = false;
  @state() private everyStationRefusal: string | null = null;
  /** The printer last put on every station, while its notice shows. */
  @state() private everyStationDone: string | null = null;
  #everyStationOpener: HTMLElement | null = null;
  #everyStationOpening = 0;
  readonly #deleteDialog = new HardwareDeleteDialog(this, () => this.api, {
    notFound: ["printer.not_found", "page_printer.not_found"],
    send: (id) =>
      this.#deleteIsPage ? this.api.deletePagePrinter(id) : this.#deleteReceiptPrinter(id),
    onGone: (id, source) => {
      this.#printerGone(id, true);
      if (source === "send" && this.isConnected) return this.#load();
    },
    beforeDeleted: (id) => {
      if (this.selectedPrinterId !== id) return;
      this.#resetPrinterSections();
      this.selectedPrinterId = null;
      void this.#url.write({ printer: null, editor: null, step: null }, true);
      return this.updateComplete;
    },
    onDeleted: (id) => {
      this.#printerGone(id, false, this.#tabAction("open-add-printer"));
      if (this.isConnected) return this.#load();
    },
  });

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  protected override willUpdate(changed: PropertyValues): void {
    // A new A4 list supersedes a failed test-page read's message, as a fresh read of the rows.
    if (changed.has("pagePrinters")) this.#testPages.readError = null;
    if (changed.has("jobs") && this.reprintJob !== null) {
      const id = this.reprintJob.id;
      const fresh = this.jobs.find((job) => job.id === id);
      // A job that left the list (newer printouts push older ones out) keeps its last row.
      if (fresh !== undefined && !fresh.canResend && !fresh.stuck && !this.reprintsSending.has(id))
        this.reprintJob = null;
      else this.reprintJob = fresh ?? this.reprintJob;
    }
    if (
      changed.has("canManage") &&
      !this.canManage &&
      this.pagePrinters.some(({ id }) => id === this.detailEdit?.id)
    )
      this.#disposeDetailDrafts();
    if (changed.has("discovered")) {
      this.#pairedReports = new Map();
      for (const d of this.discovered)
        if (
          d.transport === "bluetooth" &&
          d.paired === true &&
          d.printerId !== null &&
          !this.#pairedReports.has(d.printerId)
        )
          this.#pairedReports.set(d.printerId, d);
    }
    // The dialog's own close report comes a task later, or never if it was not yet drawn, and a
    // printer active again by then would bring the dialog back.
    if (
      changed.has("printers") &&
      this.everyStationId !== null &&
      this.#everyStationPrinter === undefined
    )
      this.#closeEveryStation();
  }

  override disconnectedCallback(): void {
    this.#deleteDialog.close();
    this.#closeEveryStation();
    this.#disposeDetailDrafts();
    this.#disposeCalibrationDraft();
    this.editingPrinter = null;
    this.#disposeAgentDraft();
    this.#disposePrinterNameDraft();
    this.#disposeAddressDraft();
    this.#disposePairAgainDraft();
    this.editingAgent = null;
    this.#endScan();
    this.#stopRenewing();
    this.#stopAgentModal();
    this.#stopCommandPoll();
    this.#resetPair();
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.refreshErrorKey = null;
    this.armedDenyId = null;
    await this.#watchLists();
  }

  async #watchLists(): Promise<void> {
    this.#loadFailed = false;
    const discovery = this.#queries
      .watch("listDiscoveredPrinters", [], (devices) => {
        this.#setDiscovered(devices);
        this.#liveReadFloor = ++this.#readCount;
      })
      .catch((error) => {
        this.refreshErrorKey = codeOf(error);
      });
    try {
      await Promise.all([
        this.#queries.watch("listAgents", [], (agents) => {
          this.agents = agents;
        }),
        this.#queries.watch("listPrinters", [], (printers) => {
          const listed = new Set(printers.map(({ id }) => id));
          const gone = this.printers.filter(({ id }) => !listed.has(id));
          this.printers = printers;
          this.#printersReady = true;
          for (const { id } of gone) this.#printerGone(id, true);
          this.#restorePrinterTarget();
        }),
        this.#watchJobs(this.completedJobsPage),
        this.#queries.watch("listPrinterProfiles", [], (printerProfiles) => {
          this.printerProfiles = printerProfiles;
          this.usageRead = new Set([...this.usageRead, "profiles"]);
        }),
        this.#queries.watch("listPrinterStationNames", [], (printerStations) => {
          this.printerStations = printerStations;
          this.usageRead = new Set([...this.usageRead, "stations"]);
        }),
        this.#queries.watch("listPagePrinters", [], (pagePrinters) => {
          this.pagePrinters = pagePrinters;
          this.#pagePrintersReady = true;
          this.#restorePrinterTarget();
          this.#pagePrinterLiveAt = ++this.#pagePrinterReads;
        }),
        this.#queries.watch("pairingMode", [], (pairing) => {
          this.pairing = pairing;
        }),
        this.#queries.watch("joinRequests", ["print_agent"], (pendingJoins) => {
          this.pendingJoins = pendingJoins;
        }),
      ]);
      if (!this.view) {
        this.view = this.#defaultView();
        if (this.#url.read("dashboard") === "printers") this.#url.write({ view: this.view }, true);
      }
      await discovery;
    } catch (error) {
      this.#loadFailed = true;
      this.refreshErrorKey = codeOf(error);
    } finally {
      this.loading = false;
    }
  }

  #watchJobs(page: number): Promise<void> {
    return this.#queries.watch("listRecentJobs", page === 0 ? [] : [page], (jobs) => {
      this.completedJobsPage = page;
      this.jobs = jobs;
    });
  }

  async #showCompletedJobs(page: number): Promise<void> {
    if (this.readingCompletedJobs) return;
    const focused = this.shadowRoot?.activeElement as HTMLElement | null | undefined;
    this.readingCompletedJobs = true;
    try {
      await this.#watchJobs(page);
    } catch (error) {
      this.refreshErrorKey = codeOf(error);
    } finally {
      this.readingCompletedJobs = false;
      await this.updateComplete;
      if (
        focused?.hasAttribute("disabled") &&
        this.ownerDocument.activeElement === this.ownerDocument.body
      )
        this.renderRoot.querySelector<HTMLElement>("[data-history-page]:not([disabled])")?.focus();
    }
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Agents: join-and-accept ──────────────────────────────────────────────────────────────────────

  /** Disarms any armed deny, since that row may no longer exist. */
  async #reloadJoins(): Promise<void> {
    this.armedDenyId = null;
    const [pairing, pendingJoins] = await Promise.all([
      this.api.pairingMode(),
      this.api.joinRequests("print_agent"),
    ]);
    this.pairing = pairing;
    this.pendingJoins = pendingJoins;
  }

  async #reloadAgents(): Promise<void> {
    this.agents = await this.api.listAgents();
  }

  #openAgentModal(): void {
    if (this.addingAgent) return;
    this.#agentEpoch++;
    this.errorKey = null;
    this.addingAgent = true;
    void this.#hold.start();
    void this.#scanAgents();
    this.#agentTimer = setInterval(() => void this.#agentTick(), SCAN_POLL_MS);
  }

  #stopAgentModal(): void {
    if (!this.addingAgent) return;
    this.errorKey = null;
    this.addingAgent = false;
    this.#agentEpoch++;
    this.#agentReadInFlight = false;
    this.openRequestId = null;
    clearInterval(this.#agentTimer);
    this.#agentTimer = undefined;
    this.scanningAgents = false;
    this.#hold.stop();
  }

  async #scanAgents(): Promise<void> {
    if (this.scanningAgents) return;
    this.errorKey = this.#holdErrorKey;
    this.scanningAgents = true;
    this.#agentScanUntil = Date.now() + AGENT_SCAN_LISTEN_MS;
    await this.#agentTick();
  }

  async #agentTick(): Promise<void> {
    if (!this.addingAgent || this.#agentReadInFlight) return;
    this.#agentReadInFlight = true;
    const epoch = this.#agentEpoch;
    try {
      const api = this.api.background ?? this.api;
      const pending = await api.joinRequests("print_agent");
      if (epoch === this.#agentEpoch && this.addingAgent && this.isConnected)
        this.pendingJoins = pending;
    } catch (error) {
      if (epoch !== this.#agentEpoch) return;
      this.refreshErrorKey = codeOf(error);
      this.scanningAgents = false;
    } finally {
      if (epoch === this.#agentEpoch) {
        this.#agentReadInFlight = false;
        if (Date.now() >= this.#agentScanUntil) this.scanningAgents = false;
      }
    }
  }

  /** Fetches the numbers only the first time: the server fixes them at join. */
  async #openRequest(id: string): Promise<void> {
    this.errorKey = null;
    this.openRequestId = id;
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

  /** A wrong number has already deleted the request when `device.join_mismatch` arrives, so that code
   * closes the dialog and re-reads the queue; any other fault leaves the dialog open for a retry. */
  async #accept(request: JoinRequestRow, choice: string): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    this.submitting = true;
    this.acceptingChoice = choice;
    try {
      await this.api.acceptPrintAgentJoinRequest(request.id, { choice });
      this.openRequestId = null;
      await Promise.all([this.#reloadJoins(), this.#reloadAgents()]);
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
      this.acceptingChoice = null;
    }
  }

  async #revokeAgent(id: string): Promise<void> {
    this.submitting = true;
    await this.#mutate(async () => {
      await this.api.revokeAgent(id);
      this.deletingAgent = null;
      await this.updateComplete;
      this.#tabAction("open-add-agent")?.focus();
    });
    this.submitting = false;
    if (this.deletingAgent === null) {
      await this.updateComplete;
      this.#tabAction("open-add-agent")?.focus();
    }
  }

  async #allowAgent(id: string): Promise<void> {
    this.submitting = true;
    this.allowingAgentId = id;
    await this.#mutate(async () => {
      await this.api.allowAgent(id);
      await this.#closeModal("new-agent-modal");
    });
    this.submitting = false;
    this.allowingAgentId = null;
  }

  // ── Printers ───────────────────────────────────────────────────────────────────────────────────

  #scanWanted(): boolean {
    return this.addingPrinter || this.pairAgain !== null;
  }

  async #loadDiscovered(epoch = this.#scanEpoch, passive = false): Promise<void> {
    const api = passive ? (this.api.background ?? this.api) : this.api;
    const started = ++this.#readCount;
    const devices = await api.listDiscoveredPrinters();
    if (epoch !== this.#scanEpoch || !this.#scanWanted() || !this.isConnected) return;
    // A live answer that arrived after this read started is kept: it may be the newer one.
    if (this.#liveReadFloor > started) return;
    this.#setDiscovered(devices);
  }

  // Keep successful additions hidden even if the subsequent inventory refresh fails.
  #setDiscovered(devices: DiscoveredPrinter[]): void {
    this.discoveredUnread = false;
    this.discovered = devices.map((device) => ({
      ...device,
      alreadyRegistered:
        device.alreadyRegistered || this.#registeredDevices.has(this.#deviceKey(device)),
    }));
    this.#absorbCommands(devices);
    this.#findPairAgain();
    if (this.probeStatus === "pending") this.probeStatus = this.#probeOutcome() ?? "pending";
  }

  /** What the address check found, judged against the current scan and registrations. */
  #probeOutcome(): "found" | "registered" | "page_printer" | undefined {
    const target = this.#probeTarget;
    if (!target) return undefined;
    const matches = this.discovered.filter(
      (device) =>
        device.transport === "network_tcp" &&
        device.host === target.host &&
        device.port === target.port &&
        Date.parse(device.lastSeenAt) >= target.requestedAt,
    );
    // Another agent's report at the address may still show a row to point at.
    const match = matches.find((d) => this.#officeRow(d)?.kind !== "added") ?? matches[0];
    if (!match) return undefined;
    const office = this.#officeRow(match);
    if (office?.kind === "added" || (!office && !this.#canAdd(match))) return "registered";
    return office ? "page_printer" : "found";
  }

  /** A found printer can be added after the check answered, which hides the row it pointed at. */
  #probeShown(): typeof this.probeStatus {
    const status = this.probeStatus;
    return status === "found" || status === "page_printer"
      ? (this.#probeOutcome() ?? status)
      : status;
  }

  #probeValidate(): Partial<Record<"host" | "port", string>> {
    const port = Number(this.probePort);
    const errors: Partial<Record<"host" | "port", string>> = {};
    if (!isProbeIpAddress(this.probeHost.trim())) errors.host = t("printers.probe_host_invalid");
    if (!/^\d+$/.test(this.probePort) || !Number.isInteger(port) || port < 1 || port > 65535)
      errors.port = t("printers.port_invalid");
    return errors;
  }

  async #probe(): Promise<void> {
    if (this.probeStatus === "pending") return;
    this.#probeFeedback.press();
    this.probeRefused = {};
    if (Object.keys(this.#probeValidate()).length) {
      this.#focusFirstInvalid("[data-test=probe-panel]");
      return;
    }
    await this.#scan({ host: this.probeHost.trim(), port: Number(this.probePort) });
  }

  /** Once the form has rendered its field messages, focuses the first invalid field in it. */
  #focusFirstInvalid(form: string): void {
    void this.updateComplete.then(() => {
      const root = this.renderRoot.querySelector(form);
      if (root) void focusFirstInvalid(root);
    });
  }

  /** Listen for automatic discovery or the separately expiring address check. */
  async #scan(address?: { host: string; port: number }): Promise<void> {
    if (!address && this.scanning) return;
    this.#endScan();
    this.#probeTarget = undefined;
    this.probeStatus = address ? "pending" : "idle";
    this.errorKey = null;
    this.probeErrorKey = null;
    this.scanning = true;
    const epoch = ++this.#scanEpoch;
    try {
      const target = address ? await this.api.probePrinterAddress(address) : undefined;
      if (!address) await this.api.startPrinterDiscovery();
      if (epoch !== this.#scanEpoch) return;
      this.#probeTarget = target;
      if (!this.isConnected || !this.#scanWanted()) return this.#endScan();
      if (!address) this.#renewTimer ??= setInterval(() => void this.#renew(), DISCOVERY_RENEW_MS);
      await this.#loadDiscovered(epoch);
      if (epoch !== this.#scanEpoch) return;
      if (!this.isConnected || !this.#scanWanted()) return this.#endScan();
      this.#scanUntil =
        Date.now() + (target ? target.expiresAt - target.requestedAt : SCAN_LISTEN_MS);
      this.#scanTimer = setInterval(() => void this.#scanTick(), SCAN_POLL_MS);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.probeStatus = "idle";
      const field = refusedField(error);
      if (
        address &&
        codeOf(error) === "management.request_invalid" &&
        (field === "host" || field === "port")
      ) {
        this.probeRefused = {
          [field]: t(field === "host" ? "printers.probe_host_invalid" : "printers.port_invalid"),
        };
        this.#focusFirstInvalid("[data-test=probe-panel]");
      } else if (address) this.probeErrorKey = codeOf(error);
      else this.errorKey = codeOf(error);
      this.#endScan();
    }
  }

  async #scanTick(): Promise<void> {
    if (this.#scanInFlight) return;
    this.#scanInFlight = true;
    const epoch = this.#scanEpoch;
    try {
      await this.#loadDiscovered(epoch, true);
    } catch (error) {
      if (epoch !== this.#scanEpoch) return;
      this.refreshErrorKey = codeOf(error);
      this.discoveredUnread = true;
      this.probeStatus = "idle";
      this.#endScan();
      return;
    } finally {
      if (epoch === this.#scanEpoch) this.#scanInFlight = false;
    }
    if (epoch !== this.#scanEpoch) return;
    if (Date.now() >= this.#scanUntil) this.#endScan();
  }

  /** A failure is not shown: the next renewal retries well before the window lapses. */
  async #renew(): Promise<void> {
    await (this.api.background ?? this.api).renewPrinterDiscovery().catch(() => undefined);
  }

  #stopRenewing(): void {
    clearInterval(this.#renewTimer);
    this.#renewTimer = undefined;
  }

  #endScan(): void {
    this.#scanEpoch++;
    if (this.#scanTimer !== undefined) clearInterval(this.#scanTimer);
    this.#scanTimer = undefined;
    this.#scanInFlight = false;
    this.scanning = false;
    if (this.probeStatus === "pending") this.probeStatus = "missing";
  }

  #deviceKey(device: DiscoveredPrinter): string {
    const queue = device.ipp ?? device.office;
    if (device.ippOnly && queue)
      return `ipp:${encodeURIComponent(JSON.stringify([device.host?.toLowerCase(), queue.port, queue.resourcePath]))}`;
    return device.localKey ?? `${device.host}:${device.port ?? 9100}`;
  }

  #disabledPrinter(device: DiscoveredPrinter): Printer | undefined {
    return device.ippOnly
      ? undefined
      : this.printers.find((printer) => printer.id === device.printerId && !printer.active);
  }

  /**
   * An office printer's row, matched against the venue's page printers by its IPP queue and the
   * agent reporting it — never by the receipt printers' marks. Undefined for any other device, and
   * for a disabled receipt registration, which stays re-addable as one.
   */
  #officeRow(device: DiscoveredPrinter): OfficeRow | undefined {
    if (device.office === undefined && device.pagePrinter !== true && device.ippOnly !== true)
      return undefined;
    if (this.#disabledPrinter(device) !== undefined) return undefined;
    const report = device.office;
    if (report === undefined || !device.host)
      return { kind: "refused", reason: "printers.page_printer_no_answer" };
    const host = device.host.toLowerCase();
    // A switched-off registration is added again through Add, which switches it back on.
    const match = this.pagePrinters.find(
      (p) =>
        p.active &&
        p.host.toLowerCase() === host &&
        p.port === report.port &&
        p.resourcePath === report.resourcePath,
    );
    if (match?.agentId === device.agentId) return { kind: "added" };
    if (!report.printable) return { kind: "refused", reason: OFFICE_REFUSAL[report.reason] };
    // The server registers only from the named agent's own report.
    if (device.officeLent) return { kind: "refused", reason: "printers.page_printer_lent" };
    const entry = {
      agentId: device.agentId,
      host: device.host,
      port: report.port,
      path: report.resourcePath,
    };
    if (match === undefined) return { kind: "add", entry };
    return { kind: "repoint", entry, agentGone: match.agentId === null };
  }

  #rowKey(device: DiscoveredPrinter): string {
    return `${device.agentId}:${this.#deviceKey(device)}`;
  }

  #openPagePrinterAdd(device: DiscoveredPrinter, entry: PagePrinterEntry): void {
    const parts = [this.#discoveredLabel(device), `${entry.host}:${entry.port}${entry.path}`];
    if (device.agentName)
      parts.push(fill("printers.discovered_seen_on", { agent: device.agentName }));
    this.addingPagePrinter = {
      entry,
      description: parts.join(" · "),
      suggestedName: this.#discoveredLabel(device),
    };
  }

  async #registerPagePrinter(key: string, entry: PagePrinterEntry): Promise<void> {
    if (this.pagePrinterSending.has(key)) return;
    this.pagePrinterSending = new Set([...this.pagePrinterSending, key]);
    this.pagePrinterRefusals = Object.fromEntries(
      Object.entries(this.pagePrinterRefusals).filter(([refused]) => refused !== key),
    );
    try {
      await this.api.registerPagePrinter(entry);
    } catch (error) {
      this.pagePrinterRefusals = { ...this.pagePrinterRefusals, [key]: codeOf(error) };
      return;
    } finally {
      this.pagePrinterSending = new Set(
        [...this.pagePrinterSending].filter((sending) => sending !== key),
      );
    }
    await this.#refreshPagePrinters();
  }

  async #refreshPagePrinters(): Promise<void> {
    try {
      await this.#readPagePrinters();
    } catch (error) {
      this.refreshErrorKey = codeOf(error);
    }
  }

  async #readPagePrinters(): Promise<void> {
    const started = ++this.#pagePrinterReads;
    const rows = await this.api.listPagePrinters();
    if (this.#pagePrinterLiveAt > started) return;
    this.pagePrinters = rows;
  }

  #canAdd(device: DiscoveredPrinter): boolean {
    return (
      !this.#registeredDevices.has(this.#deviceKey(device)) &&
      (!device.alreadyRegistered || this.#disabledPrinter(device) !== undefined)
    );
  }

  /** A Bluetooth device registered to a switched-on printer that no agent reports paired, such as
   * one unpaired on the box outside Waitron: it is offered Pair, which adds nothing. */
  #canPairOnly(device: DiscoveredPrinter): boolean {
    const printer =
      device.transport === "bluetooth"
        ? this.printers.find(({ id, active }) => id === device.printerId && active)
        : undefined;
    return printer !== undefined && !this.#pairedReports.has(printer.id);
  }

  async #registerDiscovered(device: DiscoveredPrinter): Promise<void> {
    if (this.submitting || !this.#canAdd(device)) return;
    const key = this.#deviceKey(device);
    const name = (
      this.discoveredNames[key] ??
      device.retainedName ??
      this.#disabledPrinter(device)?.name ??
      this.#discoveredLabel(device)
    ).trim();
    this.formAttempted = true;
    if (!name) {
      this.#focusFirstInvalid("[data-test=name-printer-modal]");
      return;
    }
    const opening = this.#printerNameOpening;
    const addOpening = this.#addPrinterOpening;
    const scope = this.#printerNameScope;
    const addressScope = this.#addressScope;
    const address = this.#addressValues();
    const registersAddress =
      device.transport === "network_tcp" &&
      device.host === address.host &&
      String(device.port ?? 9100) === address.port;
    const active = () => this.isConnected && opening === this.#printerNameOpening;
    this.submitting = true;
    this.errorKey = null;
    try {
      const disabled = this.#disabledPrinter(device);
      let createdId: string;
      if (device.transport === "network_tcp") {
        ({ id: createdId } = await this.api.createPrinter({
          name,
          transport: device.transport,
          host: device.host ?? undefined,
          port: device.port ?? 9100,
        }));
      } else {
        ({ id: createdId } = await this.api.createPrinter({
          name,
          transport: device.transport,
          localKey: device.localKey,
        }));
      }
      if (!this.isConnected) return;
      if (addOpening === this.#addPrinterOpening && registersAddress) addressScope?.commit(address);
      if (active()) scope?.commit(name);
      else if (
        scope &&
        (this.namingPrinter !== null ||
          addOpening !== this.#addPrinterOpening ||
          !this.addingPrinter)
      ) {
        await this.#load();
        return;
      }
      this.addedPrinterName = name;
      this.#registeredDevices.add(this.#deviceKey(device));
      if (
        device.transport === "network_tcp" &&
        device.host === this.#probeTarget?.host &&
        device.port === this.#probeTarget?.port
      )
        this.probeStatus = "registered";
      this.discovered = this.discovered.map((candidate) =>
        this.#deviceKey(candidate) === this.#deviceKey(device)
          ? { ...candidate, alreadyRegistered: true }
          : candidate,
      );
      if (scope?.isDirty()) {
        await this.#load();
        return;
      }
      if (scope) {
        const nameModal = this.renderRoot.querySelector<WtModal>("[data-test=name-printer-modal]");
        nameModal?.closeAfter("saved");
        if (nameModal) await nameModal.updateComplete;
        this.#finishPrinterName(opening);
        if (!addressScope?.isDirty()) {
          const addModal = this.renderRoot.querySelector<WtModal>("[data-test=new-printer-modal]");
          addModal?.closeAfter("saved");
          if (addModal) await addModal.updateComplete;
          this.#finishAddPrinter(addOpening);
        }
      } else {
        await this.#closeModal("name-printer-modal");
        await this.#closeModal("new-printer-modal");
      }
      if (disabled || device.retainedName !== undefined) {
        await this.#load();
        return;
      }
      this.#openPrinter({
        id: createdId,
        name,
        transport: device.transport,
        host: device.host ?? null,
        port: device.port ?? (device.transport === "network_tcp" ? 9100 : null),
        localKey: device.localKey ?? null,
        pollId: null,
        paperWidth: "80mm",
        resolution: "180dpi",
        hasCashDrawer: false,
        portable: false,
        pickupRoles: ["receipt", "payment_slip"],
        holder: null,
        pendingJobs: 0,
        lastPrintAt: null,
        lastPrintAgentId: null,
        active: true,
      });
      this.#calibrationOpenedByAdd = true;
      await this.#load();
    } catch (error) {
      if (active()) {
        this.#bluetoothBusyParams = refusalParams(error);
        this.errorKey = codeOf(error);
      }
    } finally {
      this.submitting = false;
    }
  }

  // ── Bluetooth pairing ────────────────────────────────────────────────────────────────────────────

  #commandKeyOf(device: DiscoveredPrinter): string {
    return commandKey(device.agentId, device.localKey!);
  }

  #trackCommand(
    agentId: string,
    status: BluetoothCommandStatus,
    details: Pick<TrackedCommand, "device" | "deletedPrinter"> = {},
  ): void {
    const { expiresInMs, ...command } = status;
    const tracked: TrackedCommand = {
      ...command,
      // A pending status naming no deadline is due at once rather than on a guessed one.
      answerBy: Date.now() + (expiresInMs ?? 0),
      ...details,
    };
    const key = commandKey(agentId, status.address);
    this.commands = { ...this.commands, [key]: tracked };
    if (key in this.pairedDevices) {
      const rest = { ...this.pairedDevices };
      delete rest[key];
      this.pairedDevices = rest;
    }
    if (status.state === "pending" && this.#commandTimer === undefined && this.isConnected)
      this.#commandTimer = setInterval(() => void this.#commandTick(), SCAN_POLL_MS);
  }

  /** Settles pending commands from outcomes in `devices`, and calls the overdue rest unanswered. */
  #absorbCommands(devices: DiscoveredPrinter[]): void {
    const pending = Object.entries(this.commands).filter(([, { state }]) => state === "pending");
    if (pending.length === 0) return;
    const reports = new Map<string, BluetoothCommandStatus>();
    for (const device of devices) {
      const key = device.transport === "bluetooth" ? this.#commandKeyOf(device) : undefined;
      if (key !== undefined && device.bluetoothCommand && !reports.has(key))
        reports.set(key, device.bluetoothCommand);
    }
    const now = Date.now();
    const next = { ...this.commands };
    let changed = false;
    const paired: [string, TrackedCommand][] = [];
    for (const [key, tracked] of pending) {
      // Matched by id: a read sent before this command existed can still carry an earlier outcome.
      // Within one read an outcome wins over the deadline (answerBy is never before the server's own
      // expiry, and the server records an outcome only while the command still waits); a read still
      // in flight at the first tick past the deadline loses its outcome (#commandTick).
      const reported = reports.get(key);
      if (reported?.id === tracked.id && reported.state !== "pending") {
        next[key] = {
          ...tracked,
          state: reported.state,
          ...(reported.reason !== undefined && { reason: reported.reason }),
        };
        changed = true;
        if (tracked.kind === "pair" && reported.state === "succeeded") paired.push([key, tracked]);
      } else if (now >= tracked.answerBy) {
        next[key] = { ...tracked, state: "no_answer" };
        changed = true;
      }
    }
    if (changed) this.commands = next;
    if (paired.length === 0) return;
    this.pairedDevices = {
      ...this.pairedDevices,
      ...Object.fromEntries(paired.map(([key, { answerBy }]) => [key, answerBy])),
    };
    for (const [key, tracked] of paired) if (this.#addPaired(key, tracked)) break;
  }

  /** Carries a successful pairing straight on into the form to add the device, unless another dialog
   * is in the way (its row then offers Add) or the device can no longer be added — which includes a
   * pair-only device (`#canPairOnly`), so its pairing never opens the form. Returns whether the
   * pairing was taken: the form opened, or Pair again brought its printer back. */
  #addPaired(key: string, tracked: TrackedCommand): boolean {
    const device = this.#listedDevice(key) ?? tracked.device!;
    if (this.pairAgain !== null && device.printerId === this.pairAgain.printer.id) {
      void this.#pairedAgain(this.pairAgain.printer, device);
      return true;
    }
    if (this.namingPrinter !== null || this.pairingDevice !== null || !this.#canAdd(device))
      return false;
    this.formAttempted = false;
    this.errorKey = null;
    this.#namePrinter(device);
    return true;
  }

  #listedDevice(key: string): DiscoveredPrinter | undefined {
    return this.discovered.find(
      (d) => d.transport === "bluetooth" && this.#commandKeyOf(d) === key,
    );
  }

  async #commandTick(): Promise<void> {
    if (this.#commandReadInFlight) {
      // A read that never answers must not hold a command open past its deadline.
      this.#absorbCommands([]);
      this.#settleCommandPoll();
      return;
    }
    if (!this.#commandPollNeeded()) return this.#stopCommandPoll();
    this.#commandReadInFlight = true;
    const epoch = this.#commandEpoch;
    let devices: DiscoveredPrinter[] | undefined;
    try {
      devices = await (this.api.background ?? this.api).listDiscoveredPrinters();
    } catch (error) {
      if (epoch === this.#commandEpoch) {
        this.#commandReadError = codeOf(error);
        this.refreshErrorKey = this.#commandReadError;
        this.discoveredUnread = true;
      }
    }
    if (epoch !== this.#commandEpoch) return;
    this.#commandReadInFlight = false;
    if (devices) {
      if (this.#commandReadError !== null && this.refreshErrorKey === this.#commandReadError)
        this.refreshErrorKey = null;
      this.#commandReadError = null;
      this.#setDiscovered(devices);
    } else this.#absorbCommands([]);
    this.#settleCommandPoll();
  }

  /** Reads continue until a pending command answers or reaches its deadline. */
  #commandPollNeeded(): boolean {
    const now = Date.now();
    return (
      Object.values(this.commands).some(({ state }) => state === "pending") ||
      Object.entries(this.pairedDevices).some(
        ([key, answerBy]) => now < answerBy && this.#listedDevice(key)?.paired !== true,
      )
    );
  }

  #settleCommandPoll(): void {
    if (!this.#commandPollNeeded()) this.#stopCommandPoll();
  }

  #stopCommandPoll(): void {
    this.#commandEpoch++;
    clearInterval(this.#commandTimer);
    this.#commandTimer = undefined;
    this.#commandReadInFlight = false;
    this.#commandReadError = null;
  }

  #noticeGone(key: string, id: string): void {
    const command = this.commands[key];
    if (command?.id === id)
      this.commands = { ...this.commands, [key]: { ...command, noticeGone: true } };
  }

  #resetPair(): void {
    this.#pairEpoch++;
    this.#pairScope?.dispose();
    this.#pairScope = undefined;
    this.#pairLeave = undefined;
    this.pairingDevice = null;
    this.pairPin = "";
    this.pairAttempted = false;
    this.pairRefused = false;
    this.pairErrorKey = null;
    this.pairSubmitting = false;
  }

  #openPair(device: DiscoveredPrinter, parent: object | undefined): void {
    this.#resetPair();
    this.pairingDevice = device;
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=pair-printer-modal]");
    if (modal) modal.open = true;
    ({ coordinator: this.#pairLeave, scope: this.#pairScope } = draftScopeFor<string>(this, {
      id: {},
      parent,
      current: () => this.pairPin,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.pairPin = value;
      },
    }));
  }

  async #pair(device: DiscoveredPrinter): Promise<void> {
    if (this.pairSubmitting || saveActionState(this.#pairScope).unchanged) return;
    this.pairAttempted = true;
    this.pairRefused = false;
    this.pairErrorKey = null;
    if (!BLUETOOTH_PIN.test(this.pairPin)) {
      this.#focusFirstInvalid("[data-test=pair-printer-modal]");
      return;
    }
    const epoch = this.#pairEpoch;
    const addOpening = this.#addPrinterOpening;
    const againOpening = this.#pairAgainOpening;
    const scope = this.#pairScope;
    const pin = this.pairPin;
    this.pairSubmitting = true;
    try {
      const { command } = await this.api.pairBluetooth(device.agentId, device.localKey!, pin);
      // Tracked for the dialog that asked, even after its Pair dialog closed; never for a later one.
      if (
        this.#scanWanted() &&
        addOpening === this.#addPrinterOpening &&
        againOpening === this.#pairAgainOpening
      )
        this.#trackCommand(device.agentId, command, { device });
      if (epoch === this.#pairEpoch && this.isConnected) {
        scope!.commit(pin);
        if (scope!.isDirty()) return;
        const modal = this.renderRoot.querySelector<WtModal>("[data-test=pair-printer-modal]");
        if (modal) {
          modal.closeAfter("saved");
          await modal.updateComplete;
          if (epoch === this.#pairEpoch) this.#resetPair();
        }
      }
    } catch (error) {
      if (epoch !== this.#pairEpoch) return;
      if (codeOf(error) === "management.request_invalid" && refusedField(error) === "pin") {
        this.pairRefused = true;
        this.#focusFirstInvalid("[data-test=pair-printer-modal]");
      } else {
        this.#bluetoothBusyParams = refusalParams(error);
        this.pairErrorKey = codeOf(error);
      }
    } finally {
      if (epoch === this.#pairEpoch) this.pairSubmitting = false;
    }
  }

  #pairAgainAction(p: Printer, inMenu = false): TemplateResult | typeof nothing {
    if (p.transport !== "bluetooth" || p.active || this.#pairedReport(p) !== undefined)
      return nothing;
    return html`<wt-button
      icon=${inMenu ? "menu-pair" : nothing}
      data-test=${`pair-again-${p.id}`}
      @click=${() => this.#openPairAgain(p)}
      >${t(inMenu ? "printers.pair_again_dialog" : "printers.pair_again")}</wt-button
    >`;
  }

  #openPairAgain(printer: Printer): void {
    this.#pairAgainOpening++;
    this.#resetPair();
    this.errorKey = null;
    this.pairedAgainName = null;
    this.pairAgainSwitching = false;
    this.pairAgain = { printer, found: null };
    ({ coordinator: this.#pairAgainLeave, scope: this.#pairAgainScope } = draftScopeFor<null>(
      this,
      { id: {}, current: () => null, snapshot: (value) => value, equal: () => true, restore() {} },
    ));
    void this.#scan();
  }

  #lookAgain(): void {
    if (this.pairAgainSwitching) return;
    this.pairAgain = { ...this.pairAgain!, found: null };
    this.#endScan();
    void this.#scan();
  }

  /** Once a scan lists the printer Pair again looks for, opens the Pair dialog, or brings the
   * printer back if an agent already reports it paired. */
  #findPairAgain(): void {
    const pairAgain = this.pairAgain;
    if (pairAgain === null || pairAgain.found !== null) return;
    const found = this.discovered.find(
      (d) => d.transport === "bluetooth" && d.printerId === pairAgain.printer.id,
    );
    if (found === undefined) return;
    this.pairAgain = { ...pairAgain, found };
    if (found.paired === true) void this.#pairedAgain(pairAgain.printer, found);
    else this.#openPair(found, this.#pairAgainScope?.id);
  }

  /** Never the name form or calibration: adding the same Bluetooth key brings the disabled record
   * back under its id, with its name and settings. */
  async #pairedAgain(printer: Printer, device: DiscoveredPrinter): Promise<void> {
    const opening = this.#pairAgainOpening;
    this.pairAgainSwitching = true;
    try {
      if (this.printers.find(({ id }) => id === printer.id)?.active === false)
        await this.api.createPrinter({
          name: printer.name,
          transport: "bluetooth",
          localKey: device.localKey,
        });
    } catch (error) {
      if (opening === this.#pairAgainOpening) this.errorKey = codeOf(error);
      return;
    } finally {
      if (opening === this.#pairAgainOpening) this.pairAgainSwitching = false;
    }
    if (opening !== this.#pairAgainOpening || !this.isConnected) return;
    this.pairedAgainName = printer.name;
    this.renderRoot.querySelector<WtModal>("[data-test=pair-again-modal]")?.closeAfter("saved");
    void this.#load();
  }

  #finishPairAgain(opening: number): void {
    if (opening !== this.#pairAgainOpening) return;
    this.#disposePairAgainDraft();
    if (!this.pairSubmitting) this.#resetPair();
    this.#endScan();
    this.#stopRenewing();
    this.#dropDialogCommands();
  }

  /** Also invalidates the opening, so a late answer for it does nothing. */
  #disposePairAgainDraft(): void {
    this.#pairAgainOpening++;
    this.pairAgain = null;
    this.#pairAgainScope?.dispose();
    this.#pairAgainScope = undefined;
    this.#pairAgainLeave = undefined;
  }

  #renderPairAgain(): TemplateResult | typeof nothing {
    const pairAgain = this.pairAgain;
    if (pairAgain === null) return nothing;
    const opening = this.#pairAgainOpening;
    const { printer, found } = pairAgain;
    const key = found === null ? undefined : this.#commandKeyOf(found);
    const command = key === undefined ? undefined : this.commands[key];
    let status: TemplateResult | typeof nothing = nothing;
    if (this.pairAgainSwitching)
      status = html`<p data-test="pair-again-status">
        <wt-spinner decorative size="sm"></wt-spinner>
        ${fill("printers.pair_again_switching_on", { printer: printer.name })}
      </p>`;
    else if (key !== undefined) status = this.#renderCommand(key, command, "pair-again-command");
    else if (this.scanning)
      status = html`<p data-test="pair-again-status">
        <wt-spinner decorative size="sm"></wt-spinner>
        ${fill("printers.pair_again_looking", { printer: printer.name })}
      </p>`;
    else if (this.errorKey === null)
      status = html`<p data-test="pair-again-status">
        ${fill("printers.pair_again_missing", { printer: printer.name })}
      </p>`;
    return html`<wt-modal
      size="compact"
      data-test="pair-again-modal"
      heading=${t("printers.pair_again")}
      .open=${true}
      .beforeClose=${this.#pairAgainLeave ? this.#beforePairAgainClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#finishPairAgain(opening);
      }}
    >
      ${this.#renderRefreshError()}${status}
      <wt-form-actions slot="footer" .error=${bottomMessage(this.#bluetoothRefusal(this.errorKey))}>
        <wt-button
          slot="cancel"
          data-test="cancel-pair-again"
          @click=${() => void this.#closeModal("pair-again-modal")}
          >${t("action.cancel")}</wt-button
        >
        ${
          found === null && this.scanning
            ? nothing
            : html`<wt-button
                variant="primary"
                data-test="pair-again-look"
                ?disabled=${command?.state === "pending"}
                ?loading=${this.pairAgainSwitching}
                @click=${() => this.#lookAgain()}
                >${t("printers.pair_again_look")}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderPairedAgain(): TemplateResult | typeof nothing {
    if (this.pairedAgainName === null) return nothing;
    return html`<wt-notice
      class="sent"
      data-test="pair-again-done"
      .duration=${NOTICE_MS}
      @wt-notice-gone=${() => {
        this.pairedAgainName = null;
      }}
      >${fill("printers.pair_again_done", { printer: this.pairedAgainName })}</wt-notice
    >`;
  }

  #pairedReport(p: Printer): DiscoveredPrinter | undefined {
    return p.transport === "bluetooth" ? this.#pairedReports.get(p.id) : undefined;
  }

  #bluetoothRefusal(code: string | null): string | null {
    return code === "printer.bluetooth_command_busy"
      ? codeMessage(code, undefined, this.#bluetoothBusyParams)
      : refusal(code);
  }

  #renderCommand(key: string, command: TrackedCommand | undefined, test: string) {
    if (command === undefined || command.noticeGone) return nothing;
    const problem = isProblem(command);
    return html`<span part="bluetooth-progress"
      >${
        command.kind === "pair" && command.state === "pending"
          ? html`<wt-spinner decorative size="sm" data-test=${`progress-${test}`}></wt-spinner>`
          : nothing
      }<wt-notice
        part=${problem ? "bluetooth-status bluetooth-problem" : "bluetooth-status"}
        data-test=${test}
        .duration=${command.state === "succeeded" ? NOTICE_MS : 0}
        @wt-notice-gone=${() => this.#noticeGone(key, command.id)}
        >${commandText(command)}</wt-notice
      ></span
    >`;
  }

  #editPrinter(id: string, patch: Partial<EditablePrinter>): void {
    if (this.editingPrinter?.id === id) {
      this.editingPrinter = { ...this.editingPrinter, ...patch };
      this.#calibrationScope?.changed();
    }
  }

  /** Calibration only writes settings changed during this wizard. */
  async #savePrinter(id: string): Promise<void> {
    if (this.submitting) return;
    if (this.#calibrationSave().unchanged) return;
    this.errorKey = null;
    const row = this.editingPrinter;
    if (row?.id !== id || !this.#validatePrinter(row)) return;
    const opening = this.#calibrationOpening;
    const scope = this.#calibrationScope!;
    const submitted = this.#calibrationValues();
    const active = () => opening === this.#calibrationOpening && this.isConnected;
    const patch: PrinterPatch = {};
    if (row.paperWidth !== row.saved.paperWidth) patch.paperWidth = row.paperWidth;
    if (row.resolution !== row.saved.resolution) patch.resolution = row.resolution;
    if (row.hasCashDrawer !== row.saved.hasCashDrawer) patch.hasCashDrawer = row.hasCashDrawer;
    if (row.portable !== row.saved.portable) patch.portable = row.portable;
    if (!samePickupRoles(row.pickupRoles, row.saved.pickupRoles))
      patch.pickupRoles = row.pickupRoles;
    this.submitting = true;
    try {
      try {
        if (Object.keys(patch).length) await this.api.updatePrinter(id, patch);
      } catch (error) {
        if (active()) {
          this.errorKey = codeOf(error);
        }
        return;
      }
      if (active()) {
        this.#calibrationOpenedByAdd = false;
        scope.commit(submitted);
        this.editingPrinter = { ...this.editingPrinter!, saved: submitted };
        if (!scope.isDirty()) {
          const modal = this.renderRoot.querySelector<WtModal>("[data-test=edit-printer-modal]");
          if (modal) {
            modal.closeAfter("saved");
            await modal.updateComplete;
          }
          this.#finishCalibration(opening);
        }
      }
      if (this.isConnected) await this.#load();
    } finally {
      this.submitting = false;
    }
  }

  async #printTestPage(p: Printer): Promise<void> {
    if (!p.active || this.testPagesPrinting.has(p.id)) return;
    this.errorKey = null;
    this.testPageSent = null;
    this.testPagesPrinting = new Set([...this.testPagesPrinting, p.id]);
    try {
      await this.api.printTestPage(p.id);
    } catch (error) {
      this.errorKey = codeOf(error);
      return;
    } finally {
      this.testPagesPrinting = new Set([...this.testPagesPrinting].filter((id) => id !== p.id));
    }
    this.testPageSent = p.name;
    await this.#load();
  }

  async #testPrint(id: string): Promise<void> {
    if (this.printingTest) return;
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.printingTest = true;
    this.testError = null;
    try {
      const { jobId } = await this.api.testPrint(id);
      if (epoch === this.#testEpoch) {
        this.#showCalibrationJob(calibration, jobId);
        await this.#load();
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.testError = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.printingTest = false;
    }
  }

  async #sampleReceipt(p: EditablePrinter): Promise<void> {
    if (this.printingSample) return;
    if (!this.#validatePrinter(p)) return;
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.printingSample = true;
    this.errorKey = null;
    try {
      const { jobId } = await this.api.sampleReceipt(p.id, {
        paperWidth: p.paperWidth,
        resolution: p.resolution,
      });
      if (epoch === this.#testEpoch) {
        this.#showCalibrationJob(calibration, jobId);
        await this.#load();
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.errorKey = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.printingSample = false;
    }
  }

  #showCalibrationJob(calibration: number, jobId: string): void {
    if (calibration <= this.#calibrationShownEpoch) return;
    this.#calibrationShownEpoch = calibration;
    this.calibrationJobId = jobId;
  }

  #closeTest(): void {
    this.#testEpoch++;
    this.printingTest = false;
    this.printingSample = false;
    this.testingDrawer = false;
    this.testError = null;
    this.calibrationJobId = null;
  }

  async #testDrawer(p: EditablePrinter): Promise<void> {
    if (this.testingDrawer) return;
    const epoch = this.#testEpoch;
    const calibration = ++this.#calibrationEpoch;
    this.testingDrawer = true;
    this.drawerTestSent = false;
    this.drawerOutcome = "";
    this.testError = null;
    try {
      const { jobId } = await this.api.testPrinterDrawer(p.id);
      if (epoch === this.#testEpoch) {
        this.drawerTestSent = true;
        this.#showCalibrationJob(calibration, jobId);
      }
    } catch (error) {
      if (epoch === this.#testEpoch) this.testError = codeOf(error);
    } finally {
      if (epoch === this.#testEpoch) this.testingDrawer = false;
    }
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────────────────────────

  #timestamp(iso: string | null): string {
    if (iso === null) return t("printers.last_seen_never");
    return formatIsoMinute(iso);
  }

  // ── Renderers ────────────────────────────────────────────────────────────────────────────────────

  #agentActions(agent: PrintAgentRow): TemplateResult {
    return html`<dashboard-row-actions .label=${fill("printers.row_actions", { name: agent.name })}>
      <wt-button
        icon="menu-edit"
        data-test=${`edit-agent-${agent.id}`}
        @click=${(event: Event) => {
          this.#rememberEditTrigger(event);
          this.formAttempted = false;
          this.errorKey = null;
          this.#editAgent(agent);
        }}
        >${t("action.edit_dialog")}</wt-button
      >
      ${rowActionTail(true, [
        html`<wt-button
          icon="menu-delete"
          variant="danger"
          data-test=${`revoke-agent-${agent.id}`}
          @click=${(event: Event) => {
            this.#agentDeleteOpener =
              this.#rowMenuButton(event.currentTarget as HTMLElement) ?? null;
            this.errorKey = null;
            this.deletingAgent = agent;
          }}
          >${t("action.delete_dialog")}</wt-button
        >`,
      ])}
    </dashboard-row-actions>`;
  }

  /** Only while this dialog holds the window: the later of its own hold's lapse and the window's. */
  #renderPairing(): TemplateResult {
    const read = this.pairing?.open ? this.pairing.openUntil : null;
    const until =
      this.holdStatus !== "held"
        ? null
        : read !== null && (this.takenUntil === null || read > this.takenUntil)
          ? read
          : this.takenUntil;
    return html`<p class="hint" data-test="pairing-panel">${t("printers.pairing_hint")}</p>
      ${until !== null ? html`<p data-test="pairing-until">${relativeTime(t("printers.pairing_closes"), until, { deadline: true, timeZone: this.pairing?.timeZone ?? "" })}</p>` : nothing}
      ${holdNotice(this.holdStatus, () => void this.#hold.start())}`;
  }

  /** No join number is shown or fetched for the row. */
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
              ${
                request.previouslyDenied
                  ? html`<span> · ${t("printers.join_previously_denied")}</span>`
                  : nothing
              }
            </span>
          </div>
          <wt-button
            variant="primary"
            size="sm"
            data-test="join-review-${request.id}"
            aria-label=${`${t("printers.join_review")} ${request.label}`}
            @click=${() => void this.#openRequest(request.id)}
            >${t("printers.join_review")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="join-deny-${request.id}"
            data-armed=${armed ? "true" : nothing}
            aria-label=${`${armed ? t("printers.join_deny_confirm") : t("printers.join_deny")} ${request.label}`}
            @click=${() => this.#onDeny(request.id)}
            >${armed ? t("printers.join_deny_confirm") : t("printers.join_deny")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  /** Tapping a number is the accept, so there is no separate Accept control; a wrong tap denies the
   * request. */
  #renderAcceptDialog(): TemplateResult | typeof nothing {
    const request = this.pendingJoins.find((r) => r.id === this.openRequestId);
    if (request === undefined) return nothing;
    const choices = this.challenges[request.id];
    return html`<wt-dialog
      data-test="join-dialog"
      heading=${t("printers.join_dialog_title")}
      .open=${true}
      @wt-close=${() => (this.openRequestId = null)}
    >
      <p class="label" data-test="join-dialog-label">${request.label}</p>
      ${
        choices === undefined
          ? html`<p class="hint">${t("printers.join_loading")}</p>`
          : html`<p id="join-match-prompt">${t("printers.join_match_prompt")}</p>
              <div class="choices" role="group" aria-labelledby="join-match-prompt">
                ${choices.map(
                  // `size="lg"`: the number has to be legible across the room, against the agent's setup
                  // page — that is the whole job of a two-digit code.
                  (number) =>
                    html`<wt-button
                      variant="secondary"
                      size="lg"
                      data-choice=${number}
                      ?disabled=${this.submitting}
                      ?loading=${this.acceptingChoice === number}
                      aria-label=${fill("printers.join_choice_label", { number })}
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

  #agentColumnLocale = "";
  #agentColumnList: DataTableColumn<PrintAgentRow>[] = [];

  #agentColumns(): DataTableColumn<PrintAgentRow>[] {
    const locale = currentLocale();
    if (locale !== this.#agentColumnLocale) {
      this.#agentColumnLocale = locale;
      this.#agentColumnList = this.#buildAgentColumns();
    }
    return this.#agentColumnList;
  }

  #buildAgentColumns(): DataTableColumn<PrintAgentRow>[] {
    return [
      {
        key: "name",
        label: t("printers.name"),
        sortValue: (a) => a.name,
        searchValue: (a) => a.name,
        cell: (a) =>
          html`<span data-test=${`agent-row-${a.id}`}
            ><span data-test=${`agent-name-${a.id}`}>${a.name}</span></span
          >`,
      },
      {
        key: "host",
        choosable: "shown",
        label: t("printers.agent_host"),
        searchValue: (a) => [a.host ?? "", agentProvenance(a)?.text ?? ""].join(" "),
        cell: (a) => {
          const provenance = agentProvenance(a);
          return html`${
            a.setupUrl && /^https?:\/\//i.test(a.setupUrl)
              ? html`<a href=${a.setupUrl} target="_blank" rel="noopener noreferrer"
                  >${a.host ?? t("printers.agent_setup")}</a
                >`
              : (a.host ?? (a.nodeId === null ? t("printers.not_reported") : nothing))
          }
          ${
            provenance === null
              ? nothing
              : html` <span
                  part="printer-provenance"
                  data-test=${provenance.self ? `agent-provenance-${a.id}` : `agent-provenance-other-${a.id}`}
                  >${provenance.text}</span
                >`
          }`;
        },
      },
      {
        key: "lastSeen",
        choosable: "shown",
        label: t("printers.last_seen"),
        sortValue: (a) => a.lastSeenAt,
        cell: (a) =>
          html`<span data-test=${`agent-last-seen-${a.id}`}
            >${this.#timestamp(a.lastSeenAt)}</span
          >`,
      },
      {
        key: "actions",
        label: t("printers.actions"),
        pinned: "end",
        cell: (a) => this.#agentActions(a),
      },
    ];
  }

  #renderAgentsSection(): TemplateResult {
    return html`<section>
      ${this.#unreadTable(
        this.agents.every((agent) => !agent.active) && this.#queries.failing("listAgents"),
        (errorMessage) =>
          html`<wt-data-table
            noMatchesMessage=${tableNoMatches()}
            filterSearchPlaceholder=${t("categories.combobox_search")}
            filterNoResultsLabel=${t("categories.combobox_no_results")}
            data-test="agents-table"
            searchable
            searchLabel=${t("printers.agents_search")}
            viewKey="waitron.printers.agents.table"
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
            aria-label=${t("printers.agents_title")}
            .rows=${this.agents.filter((agent) => agent.active)}
            .columns=${this.#agentColumns()}
            .rowKey=${(a: PrintAgentRow) => a.id}
            .loading=${this.loading}
            .loadingMessage=${t("printers.table_loading")}
            .emptyMessage=${t("printers.no_agents")}
            .errorMessage=${errorMessage}
            >${this.agents.every((agent) => !agent.active) ? this.#renderAddAgent("empty-action") : nothing}</wt-data-table
          >`,
      )}
    </section>`;
  }

  #renderAgentModal(): TemplateResult | typeof nothing {
    if (!this.addingAgent) return nothing;
    return html`<wt-modal
      size="standard"
      height="medium"
      data-test="new-agent-modal"
      heading=${t("printers.add_agent")}
      .open=${true}
      .opener=${this.#tabAction("open-add-agent")}
      @wt-close=${() => this.#stopAgentModal()}
    >
      ${this.#renderRefreshError()}
      ${
        this.agents.some((agent) => !agent.active)
          ? html`<section data-test="retained-agents">
              <h3>${t("printers.saved_agents")}</h3>
              <p>${t("printers.add_agent_retained_hint")}</p>
              ${this.agents
                .filter((agent) => !agent.active)
                .map(
                  (agent) =>
                    html`<p data-test=${`retained-agent-${agent.id}`}>
                      ${agent.name}${agent.nodeId !== null ? html` · ${agentProvenance(agent)?.text}` : nothing}
                      <wt-button
                        variant="primary"
                        data-test=${`allow-agent-${agent.id}`}
                        ?disabled=${this.submitting}
                        ?loading=${this.allowingAgentId === agent.id}
                        @click=${() => void this.#allowAgent(agent.id)}
                        >${t("action.add")}</wt-button
                      >
                    </p>`,
                )}
            </section>`
          : nothing
      }
      <p class="hint">${t("printers.agent_setup_hint")}</p>
      <ol class="setup-steps">
        <li>${t("printers.agent_step_open")}</li>
        <li>
          ${t("printers.agent_step_address")}<br />
          <code class="origin" data-test="join-origin">${window.location.origin}</code>
        </li>
        <li>${fill("printers.agent_step_match", { action: t("printers.join_review") })}</li>
      </ol>
      ${this.#renderPairing()}
      <section data-test="join-panel">
        <h3 class="panel-title">${t("printers.join_waiting_title")}</h3>
        ${
          this.pendingJoins.length === 0
            ? html`<p class="empty" data-test="no-join-requests">${t("printers.join_none")}</p>`
            : html`<ol>
                ${this.pendingJoins.map((r) => this.#renderJoinRequest(r))}
              </ol>`
        }
        <wt-button
          data-test="scan-agents"
          ?loading=${this.scanningAgents}
          @click=${() => void this.#scanAgents()}
          >${this.scanningAgents ? t("printers.scan_loading") : t("printers.scan_agents")}</wt-button
        >
      </section>
      <wt-form-actions slot="footer" .error=${bottomMessage(this.#bluetoothRefusal(this.errorKey))}
        ><wt-button
          slot="cancel"
          data-test="cancel-new-agent"
          @click=${() => void this.#closeModal("new-agent-modal")}
          >${t("action.close")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #renderDeleteAgent(): TemplateResult | typeof nothing {
    if (this.deletingAgent === null) return nothing;
    const agent = this.deletingAgent;
    return html`<wt-delete-dialog
      data-test="delete-agent-modal"
      .open=${true}
      .impact=${{ target: { id: agent.id, name: agent.name }, refusals: [], ends: [], removes: [] }}
      .submitting=${this.submitting}
      .actionError=${this.errorKey ? this.#bluetoothRefusal(this.errorKey) : ""}
      .copy=${{ ...printerDeleteCopy(), heading: t("printers.delete_agent_heading"), irreversible: t("printers.delete_agent_hint") }}
      .opener=${this.#agentDeleteOpener}
      @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) => {
        event.stopPropagation();
        void this.#revokeAgent(event.detail.id);
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.deletingAgent = null;
        this.errorKey = null;
      }}
    ></wt-delete-dialog>`;
  }

  #renderEditAgent(): TemplateResult | typeof nothing {
    const agent = this.editingAgent;
    if (!agent) return nothing;
    const opening = this.#agentOpening;
    const nameError = this.formAttempted && !agent.name.trim() ? t("form.name_required") : "";
    const s = saveActionState(this.#agentScope);
    return html`<wt-modal
      size="compact"
      heading=${t("printers.edit_agent")}
      data-test="edit-agent-modal"
      .open=${true}
      .dismissible=${!this.submitting}
      .beforeClose=${this.#agentLeave ? this.#beforeAgentClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#finishAgentEdit(opening);
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector("[data-test=save-agent]"))}
    >
      ${this.#renderRefreshError()}
      <wt-input
        name="agent-name"
        required
        label=${t("printers.name")}
        .value=${agent.name}
        .invalid=${nameError !== ""}
        .error=${nameError}
        .disabled=${this.submitting}
        data-test="edit-agent-name"
        @wt-change=${(e: CustomEvent<{ value: string }>) => {
          e.stopPropagation();
          this.editingAgent = { ...agent, name: e.detail.value };
          this.#agentScope?.changed();
        }}
      ></wt-input>
      <p>${t("printers.agent_host")}: ${agent.host ?? t("printers.not_reported")}</p>
      <p>${t("printers.last_seen")}: ${this.#timestamp(agent.lastSeenAt)}</p>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(this.#bluetoothRefusal(this.errorKey), nameError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          .disabled=${this.submitting}
          data-test="cancel-edit-agent"
          @click=${() => void this.#closeModal("edit-agent-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${s.variant}
          data-test="save-agent"
          ?loading=${this.submitting}
          ?disabled=${s.unchanged || this.submitting || nameError !== ""}
          @click=${() => void this.#saveAgent()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  async #saveAgent(): Promise<void> {
    const agent = this.editingAgent;
    if (!agent || saveActionState(this.#agentScope).unchanged) return;
    this.formAttempted = true;
    if (!agent.name.trim()) {
      this.#focusFirstInvalid("[data-test=edit-agent-modal]");
      return;
    }
    if (this.submitting) return;
    const opening = this.#agentOpening;
    const scope = this.#agentScope;
    const submitted = agent.name.trim();
    const active = () => this.isConnected && opening === this.#agentOpening;
    this.submitting = true;
    this.errorKey = null;
    try {
      await this.api.updateAgent(agent.id, { name: submitted });
      if (active()) {
        scope?.commit(submitted);
        if (!scope?.isDirty()) {
          const modal = this.renderRoot.querySelector<WtModal>("[data-test=edit-agent-modal]");
          if (modal?.open) {
            modal.closeAfter("saved");
            await modal.updateComplete;
            this.#finishAgentEdit(opening);
          }
        }
      }
      if (this.isConnected) await this.#load();
    } catch (error) {
      if (active()) this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #openPrinter(p: Printer, event?: Event): void {
    this.#disposeCalibrationDraft();
    if (event) this.#rememberEditTrigger(event);
    this.#closeTest();
    this.calibrationStep = 1;
    this.drawerTestSent = false;
    this.drawerOutcome = "";
    this.formAttempted = false;
    this.errorKey = null;
    this.rulerNumber = "";
    this.editingPrinter = {
      id: p.id,
      name: p.name,
      transport: p.transport,
      active: p.active,
      host: p.host ?? "",
      port: p.port === null ? "" : String(p.port),
      localKey: p.localKey ?? "",
      pollId: p.pollId ?? "",
      paperWidth: p.paperWidth,
      resolution: p.resolution,
      hasCashDrawer: p.hasCashDrawer,
      portable: p.portable,
      pickupRoles: [...p.pickupRoles],
      saved: {
        paperWidth: p.paperWidth,
        resolution: p.resolution,
        hasCashDrawer: p.hasCashDrawer,
        portable: p.portable,
        pickupRoles: [...p.pickupRoles],
      },
    };
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=edit-printer-modal]");
    if (modal) modal.open = true;
    ({ coordinator: this.#calibrationLeave, scope: this.#calibrationScope } =
      draftScopeFor<CalibrationSettings>(this, {
        id: {},
        current: () => this.#calibrationValues(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          a.paperWidth === b.paperWidth &&
          a.resolution === b.resolution &&
          a.hasCashDrawer === b.hasCashDrawer &&
          a.portable === b.portable &&
          samePickupRoles(a.pickupRoles, b.pickupRoles),
        restore: (value) => {
          this.editingPrinter = { ...this.editingPrinter!, ...value };
        },
      }));
  }

  #calibrationSave(): ReturnType<typeof saveActionState> {
    return saveActionState(this.#calibrationScope, { savableAtOpen: this.#calibrationOpenedByAdd });
  }

  #renderTestPageSent(): TemplateResult | typeof nothing {
    if (this.testPageSent === null) return nothing;
    return html`<wt-notice
      class="sent"
      data-test="print-test-page-notice"
      .duration=${NOTICE_MS}
      @wt-notice-gone=${() => {
        this.testPageSent = null;
      }}
      >${fill("printers.test_page_sent", { name: this.testPageSent })}</wt-notice
    >`;
  }

  #renderEveryStationNotice(): TemplateResult | typeof nothing {
    if (this.everyStationDone === null) return nothing;
    return html`<wt-notice
      class="sent"
      data-test="every-station-notice"
      .duration=${NOTICE_MS}
      @wt-notice-gone=${() => {
        this.everyStationDone = null;
      }}
      >${fill("printers.every_station_done", { name: this.everyStationDone })}</wt-notice
    >`;
  }

  get #everyStationPrinter(): Printer | undefined {
    return this.printers.find((p) => p.id === this.everyStationId && p.active);
  }

  #openEveryStation(p: Printer, opener: HTMLElement): void {
    if (!p.active) return;
    this.#closeEveryStation();
    this.#everyStationOpener = opener;
    this.errorKey = null;
    this.everyStationDone = null;
    this.everyStationId = p.id;
  }

  #closeEveryStation(): void {
    this.#everyStationOpening++;
    this.everyStationId = null;
    this.everyStationSending = false;
    this.everyStationRefusal = null;
  }

  async #confirmEveryStation(): Promise<void> {
    const printer = this.#everyStationPrinter;
    if (printer === undefined || this.everyStationSending) return;
    const opening = this.#everyStationOpening;
    this.everyStationSending = true;
    this.everyStationRefusal = null;
    try {
      await this.api.putPrinterOnEveryStation(printer.id);
    } catch (error) {
      if (opening !== this.#everyStationOpening) return;
      const code = codeOf(error);
      if (code === "printer.not_found") {
        this.#closeEveryStation();
        await this.#load();
        // A switched-off printer is refused this way too, and its row already explains itself.
        if (this.everyStationId === null && !this.printers.some(({ id }) => id === printer.id))
          this.errorKey = code;
        return;
      }
      this.everyStationSending = false;
      this.everyStationRefusal = code;
      return;
    }
    if (opening !== this.#everyStationOpening) return;
    this.#closeEveryStation();
    this.everyStationDone = this.printers.find(({ id }) => id === printer.id)?.name ?? printer.name;
    await this.#load();
  }

  #renderEveryStationDialog(): TemplateResult {
    const printer = this.#everyStationPrinter;
    return html`<wt-dialog
      data-test="every-station-dialog"
      .open=${printer !== undefined}
      .dismissible=${!this.everyStationSending}
      .opener=${this.#everyStationOpener}
      heading=${printer ? fill("printers.every_station_heading", { name: printer.name }) : ""}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeEveryStation();
      }}
    >
      <p>${t("printers.every_station_body")}</p>
      <wt-form-actions slot="footer" .error=${bottomMessage(refusal(this.everyStationRefusal))}>
        <wt-button
          slot="cancel"
          data-test="every-station-cancel"
          ?disabled=${this.everyStationSending}
          @click=${(event: Event) =>
            void (event.currentTarget as HTMLElement).closest("wt-dialog")?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="every-station-confirm"
          ?loading=${this.everyStationSending}
          @click=${() => void this.#confirmEveryStation()}
          >${t("printers.every_station")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #printerActions(p: Printer): TemplateResult {
    return html`<dashboard-row-actions .label=${fill("printers.row_actions", { name: p.name })}>
      <wt-button
        icon="menu-edit"
        data-test=${`edit-printer-${p.id}`}
        @click=${(event: Event) => {
          const button = event.currentTarget as HTMLElement;
          this.#showPrinterStatus(p.id, this.#rowMenuButton(button) ?? button);
          this.#openDetailEdit(p.id, this.#savedEditValues(p));
        }}
        >${t("action.edit_dialog")}</wt-button
      >
      <wt-button
        icon="menu-print"
        data-test=${`print-test-page-${p.id}`}
        ?disabled=${!p.active}
        ?loading=${this.testPagesPrinting.has(p.id)}
        @click=${() => void this.#printTestPage(p)}
        >${t("printers.print_test_page")}</wt-button
      >
      ${
        this.canManageStationPrinters
          ? html`<wt-button
              icon="menu-default"
              data-test=${`every-station-${p.id}`}
              ?disabled=${!p.active}
              @click=${(event: Event) => {
                const button = event.currentTarget as HTMLElement;
                this.#openEveryStation(p, this.#rowMenuButton(button) ?? button);
              }}
              >${t("printers.every_station_dialog")}</wt-button
            >`
          : nothing
      }
      ${this.#pairAgainAction(p, true)}
      ${rowActionTail(true, [
        html`<wt-button
          icon="menu-delete"
          variant="danger"
          data-test=${`delete-printer-${p.id}`}
          @click=${(event: Event) => {
            const button = event.currentTarget as HTMLElement;
            this.#openDelete(p, this.#rowMenuButton(button) ?? button);
          }}
          >${t("action.delete_dialog")}</wt-button
        >`,
      ])}
    </dashboard-row-actions>`;
  }

  #printerObservation(
    p: Printer,
  ): Pick<DiscoveredPrinter, "agentId" | "agentName" | "lastSeenAt"> | undefined {
    let latest: Pick<DiscoveredPrinter, "agentId" | "agentName" | "lastSeenAt"> | undefined;
    const agent = this.agents.find(({ id }) => id === p.lastPrintAgentId);
    if (agent && p.lastPrintAt)
      latest = { agentId: agent.id, agentName: agent.name, lastSeenAt: p.lastPrintAt };
    for (const device of this.discovered) {
      if (device.printerId === p.id && (!latest || device.lastSeenAt > latest.lastSeenAt))
        latest = device;
    }
    return latest;
  }

  /** What opened the details window, so closing it hands focus back there. */
  #detailsOpener: HTMLElement | null = null;

  #showPrinterStatus(id: string, opener: HTMLElement | null): void {
    if (id !== this.selectedPrinterId) this.#resetPrinterSections();
    this.#detailsOpener = opener;
    this.selectedPrinterId = id;
    this.#url.write({ dashboard: "printers", view: this.view, printer: id });
  }

  #resetPrinterSections(): void {
    this.#disposeDetailDrafts();
  }

  #disposeDetailDrafts(): void {
    this.#detailEditScope?.dispose();
    this.#detailEditScope = undefined;
    this.#detailEditBaseline = undefined;
    this.detailEdit = null;
  }

  /** The draft as it would be saved: trimmed, and a port of digits read as a number. */
  #detailEditValues(): DetailEditValues {
    const draft = this.detailEdit!;
    const port = draft.port.trim();
    return {
      name: draft.name.trim(),
      host: draft.host.trim(),
      port: /^\d+$/.test(port) ? String(Number(port)) : port,
    };
  }

  #savedEditValues(printer: Printer): DetailEditValues {
    return {
      name: printer.name,
      host: printer.host ?? "",
      port: printer.port === null ? "" : String(printer.port),
    };
  }

  #openDetailEdit(id: string, saved: DetailEditValues): void {
    this.#detailEditScope?.dispose();
    this.detailEdit = { id, ...saved, saving: false, error: null, nameRefusal: null };
    this.#detailEditBaseline = this.#detailEditValues();
    this.#detailEditScope = draftScopeFor<DetailEditValues>(this, {
      id: {},
      current: () => this.#detailEditValues(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.name === b.name && a.host === b.host && a.port === b.port,
      restore: (value) => {
        this.detailEdit = { ...this.detailEdit!, ...value, error: null, nameRefusal: null };
      },
    }).scope;
    void this.updateComplete.then(() => {
      if (this.detailEdit?.id === id)
        this.renderRoot.querySelector<HTMLElement>('[name="printer-detail-name"]')?.focus();
    });
  }

  async #cancelDetailEdit(): Promise<void> {
    const scope = this.#detailEditScope;
    const proceed = () => {
      if (scope !== this.#detailEditScope) return;
      this.#disposeDetailDrafts();
      this.#clearPrinterEditor();
      void this.updateComplete.then(() => {
        this.renderRoot
          .querySelector<HTMLElement>(
            "[data-test=edit-printer-details], [data-test=edit-page-printer-details]",
          )
          ?.focus();
      });
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator && scope)
      await coordinator.request({ scopes: [scope.id], reason: "cancel", proceed });
    else proceed();
  }

  /** Only a network receipt printer has an address and port to check. */
  #detailEditErrors(id: string, network: boolean): DetailEditErrors {
    const draft = this.detailEdit;
    if (draft?.id !== id) return { name: "", host: "", port: "" };
    const port = draft.port.trim();
    return {
      name: draft.name.trim() ? (draft.nameRefusal ?? "") : t("form.name_required"),
      host: network && !draft.host.trim() ? t("printers.host_required") : "",
      port:
        network && port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
          ? t("printers.port_invalid")
          : "",
    };
  }

  async #saveDetailEdit(printer: Printer): Promise<void> {
    const scope = this.#detailEditScope;
    if (!scope || saveActionState(scope).unchanged) return;
    const draft = this.detailEdit;
    if (draft?.id !== printer.id || draft.saving) return;
    if (hasErrors(this.#detailEditErrors(printer.id, printer.transport === "network_tcp"))) return;
    const values = this.#detailEditValues();
    const baseline = this.#detailEditBaseline!;
    const saved = this.#savedEditValues(printer);
    // The name, or the address and port as a pair, is sent only when this person changed it, so
    // something they left alone cannot undo another session's change to it.
    const sends = (fields: (keyof DetailEditValues)[]) =>
      fields.some((field) => values[field] !== baseline[field]) &&
      fields.some((field) => values[field] !== saved[field]);
    const patch: { name?: string; host?: string; port?: number | null } = {};
    if (sends(["name"])) patch.name = values.name;
    if (printer.transport === "network_tcp" && sends(["host", "port"])) {
      patch.host = values.host;
      patch.port = values.port ? Number(values.port) : null;
    }
    this.detailEdit = { ...draft, saving: true, error: null };
    try {
      if (Object.keys(patch).length > 0) await this.api.updatePrinter(printer.id, patch);
    } catch (error) {
      if (!this.isConnected || scope !== this.#detailEditScope) return;
      this.detailEdit = { ...this.detailEdit!, saving: false, error: codeMessage(codeOf(error)) };
      return;
    }
    await this.#afterDetailSave(scope, values, () => this.#load());
  }

  /** The form stays open while this person typed more during the save. */
  async #afterDetailSave(
    scope: DraftScope<DetailEditValues>,
    values: DetailEditValues,
    reload: () => Promise<void>,
  ): Promise<void> {
    if (!this.isConnected || scope !== this.#detailEditScope) return;
    scope.commit(values);
    this.#detailEditBaseline = values;
    if (scope.isDirty()) this.detailEdit = { ...this.detailEdit!, saving: false, error: null };
    else {
      this.#disposeDetailDrafts();
      this.#clearPrinterEditor();
    }
    await reload();
  }

  async #savePagePrinterEdit(row: PagePrinterRow): Promise<void> {
    const scope = this.#detailEditScope;
    if (!scope || saveActionState(scope).unchanged) return;
    const draft = this.detailEdit;
    if (draft?.id !== row.id || draft.saving || !this.canManage) return;
    if (hasErrors(this.#detailEditErrors(row.id, false))) return;
    const values = this.#detailEditValues();
    this.detailEdit = { ...draft, saving: true, error: null, nameRefusal: null };
    try {
      await this.api.updatePagePrinter(row.id, { name: values.name });
    } catch (error) {
      if (!this.isConnected || scope !== this.#detailEditScope) return;
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } }).params?.field;
      const onName = code === "management.request_invalid" && field === "name";
      this.detailEdit = {
        ...this.detailEdit!,
        saving: false,
        error: onName ? null : codeMessage(code),
        nameRefusal: onName ? codeMessage(code) : null,
      };
      return;
    }
    await this.#afterDetailSave(scope, values, () => this.#refreshPagePrinters());
  }

  /** Closing the details asks first when a detail draft is dirty, through the address change. */
  readonly #beforeDetailsClose = async (): Promise<boolean> => {
    if (this.detailEdit?.saving) return false;
    const leaving = this.#url.write({ printer: null, editor: null, step: null });
    if (!leaving) {
      this.#resetPrinterSections();
      this.selectedPrinterId = null;
      return true;
    }
    return (await leaving) === "proceeded";
  };

  #renderPrinterDetails(): TemplateResult {
    const p = this.printers.find(({ id }) => id === this.selectedPrinterId);
    const a4 = p ? undefined : this.pagePrinters.find(({ id }) => id === this.selectedPrinterId);
    const editing = p !== undefined && this.detailEdit?.id === p.id;
    const errors = editing
      ? this.#detailEditErrors(p.id, p.transport === "network_tcp")
      : undefined;
    const a4Errors =
      a4 && this.canManage && this.detailEdit?.id === a4.id
        ? this.#detailEditErrors(a4.id, false)
        : undefined;
    return html`<wt-modal
      size="standard"
      data-test="printer-details-modal"
      heading=${p?.name ?? a4?.name ?? nothing}
      aria-label=${p || a4 ? nothing : t("printers.list_title")}
      .open=${this.selectedPrinterId !== null}
      .opener=${this.#detailsOpener}
      .beforeClose=${this.#beforeDetailsClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
      }}
    >
      ${
        p && !editing
          ? html`<wt-help-tooltip
              slot="help"
              mode="help-mode"
              aria-label=${fill("help.badge_label", { part: p.name })}
              guide-href=${guideHref("printers.printer-details")}
              guide-label=${t("help.guide_link")}
              >${t("printers.details_help")}</wt-help-tooltip
            >`
          : nothing
      }
      <div data-test="printer-details-body">
        ${this.selectedPrinterId === null || this.#dialogShowsRefreshError ? nothing : this.#renderRefreshError()}
        ${
          this.selectedPrinterId === null
            ? nothing
            : this.settingUnavailable
              ? html`<p role="alert" data-test="printer-setting-unavailable">
                  ${t("printers.setting_unavailable")}
                </p>`
              : p
                ? errors
                  ? this.#renderDetailEditForm(p.id, p.transport === "network_tcp", errors)
                  : this.#renderPrinterStatus(p)
                : a4
                  ? a4Errors
                    ? this.#renderDetailEditForm(a4.id, false, a4Errors)
                    : this.#renderPagePrinterDetails(a4)
                  : html`<p role="status">
                      ${this.loading ? t("printers.table_loading") : codeMessage("printer.not_found")}
                    </p>`
        }
      </div>
      ${
        this.settingUnavailable
          ? html`<wt-form-actions slot="footer">${this.#closeDetailsButton()}</wt-form-actions>`
          : p && errors
            ? this.#renderDetailEditActions(errors, () => void this.#saveDetailEdit(p))
            : a4 && a4Errors
              ? this.#renderDetailEditActions(a4Errors, () => void this.#savePagePrinterEdit(a4))
              : a4
                ? this.#renderPagePrinterActions(a4)
                : this.#renderDetailViewActions(p)
      }
    </wt-modal>`;
  }

  #closeDetailsButton(): TemplateResult {
    return html`<wt-button
      slot="cancel"
      data-test="printer-details-close"
      @click=${(event: Event) =>
        void (event.currentTarget as HTMLElement).closest("wt-modal")?.requestClose("navigation")}
      >${t("action.close")}</wt-button
    >`;
  }

  #renderPagePrinterActions(row: PagePrinterRow): TemplateResult {
    const pages = this.#testPages;
    const refused = pages.actionErrorFrom === row.id ? pages.actionError : null;
    const note = pages.noteFor(row);
    const readError = pages.readError;
    return html`<div slot="footer" class="a4-footer">
      <wt-form-actions>
        ${this.#closeDetailsButton()}
        ${
          this.canManage
            ? html`<wt-button
                  slot="secondary"
                  data-test=${`print-page-test-${row.id}`}
                  ?disabled=${pages.unavailable(row)}
                  ?loading=${pages.sending.has(row.id)}
                  @click=${() => void pages.print(row)}
                  >${t("printers.print_test_page")}</wt-button
                ><wt-button
                  data-test="edit-page-printer-details"
                  @click=${() => {
                    this.#openDetailEdit(row.id, { name: row.name, host: "", port: "" });
                  }}
                  >${t("action.edit")}</wt-button
                >`
            : nothing
        }
      </wt-form-actions>
      ${
        note === nothing && refused === null && readError === null
          ? nothing
          : html`<div class="test-page-note">
              ${
                refused === null
                  ? nothing
                  : html`<p role="alert" data-test="page-printer-test-page-error">
                      ${codeMessage(refused)}
                    </p>`
              }
              ${
                readError === null
                  ? nothing
                  : html`<p role="alert" data-test="page-printer-test-page-read-error">
                      ${t("printers.refresh_failed")} ${codeMessage(readError)}
                    </p>`
              }
              ${note}
            </div>`
      }
    </div>`;
  }

  #renderPagePrinterDetails(row: PagePrinterRow): TemplateResult {
    return html`<section data-test="page-printer-status">
      <div class="status-grid">
        ${detailsSection({
          id: "printer-details-connection",
          heading: t("printers.connection"),
          dataTest: "printer-section-connection",
          rows: [
            {
              label: t("printers.invoice_printer_agent"),
              value: row.agentName ?? t("printers.invoice_printer_agent_gone"),
              dataTest: "page-printer-detail-agent",
            },
            {
              label: t("printers.address"),
              value: `${row.host}:${row.port}${row.resourcePath}`,
              dataTest: "page-printer-detail-address",
            },
          ],
        })}
        ${detailsSection({
          id: "printer-details-paper",
          heading: t("printers.invoice_printer_paper"),
          dataTest: "printer-section-paper",
          rows: [
            {
              label: t("printers.invoice_printer_paper"),
              value: pageSize(row.media),
              dataTest: "page-printer-detail-paper",
            },
          ],
        })}
        ${this.#renderUsedBy(
          this.printerProfiles
            .filter((offer) => offer.pagePrinterId === row.id && offer.roles.includes("invoice"))
            .map((offer) => ({ ...offer, roles: ["invoice"] })),
          [],
        )}
      </div>
    </section>`;
  }

  #renderDetailViewActions(p: Printer | undefined): TemplateResult {
    return html`<wt-form-actions slot="footer">
      ${this.#closeDetailsButton()}
      ${
        p
          ? html`<wt-button
              slot="cancel"
              variant="danger"
              data-test="delete-printer-detail"
              @click=${(event: Event) =>
                this.#requestDetailDelete(p, event.currentTarget as HTMLElement)}
              >${t("action.delete")}</wt-button
            >`
          : nothing
      }
      ${
        p
          ? html`<wt-button
                slot="secondary"
                data-test="calibrate-printer-details"
                @click=${(event: Event) => {
                  this.#openPrinter(p, event);
                }}
                >${t("printers.calibrate")}</wt-button
              ><wt-button
                data-test="edit-printer-details"
                @click=${() => {
                  this.#openDetailEdit(p.id, this.#savedEditValues(p));
                }}
                >${t("action.edit")}</wt-button
              >`
          : nothing
      }
    </wt-form-actions>`;
  }

  #renderDetailEditForm(id: string, network: boolean, errors: DetailEditErrors): TemplateResult {
    const draft = this.detailEdit!;
    const change = (field: keyof DetailEditValues) => (event: CustomEvent<{ value: string }>) => {
      if (!(event.currentTarget as HTMLElement).isConnected) return;
      event.stopPropagation();
      if (this.detailEdit?.id !== id) return;
      this.detailEdit = {
        ...this.detailEdit,
        [field]: event.detail.value,
        error: null,
        ...(field === "name" ? { nameRefusal: null } : {}),
      };
      this.#detailEditScope?.changed();
    };
    return html`<div
      class="form-fields"
      data-test="printer-details-form"
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(event, this.renderRoot.querySelector("[data-test=save-printer-details]"))}
    >
      <wt-input
        name="printer-detail-name"
        label=${t("printers.name")}
        required
        ?disabled=${draft.saving}
        .value=${draft.name}
        .invalid=${errors.name !== ""}
        .error=${errors.name}
        @wt-change=${change("name")}
      ></wt-input>
      ${
        network
          ? html`<wt-input
                name="printer-detail-host"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                label=${t("printers.host")}
                required
                ?disabled=${draft.saving}
                .value=${draft.host}
                .invalid=${errors.host !== ""}
                .error=${errors.host}
                @wt-change=${change("host")}
              ></wt-input>
              <wt-input
                name="printer-detail-port"
                label=${t("printers.port")}
                type="number"
                ?disabled=${draft.saving}
                .value=${draft.port}
                .invalid=${errors.port !== ""}
                .error=${errors.port}
                @wt-change=${change("port")}
              ></wt-input>`
          : nothing
      }
    </div>`;
  }

  #renderDetailEditActions(errors: DetailEditErrors, save: () => void): TemplateResult {
    const draft = this.detailEdit!;
    const invalid = hasErrors(errors);
    const action = saveActionState(this.#detailEditScope);
    return html`<wt-form-actions
      slot="footer"
      .error=${bottomMessage(draft.error, invalid ? t("form.fix_fields") : null)}
    >
      <wt-button
        slot="cancel"
        data-test="cancel-printer-details"
        ?disabled=${draft.saving}
        @click=${() => void this.#cancelDetailEdit()}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        variant=${action.variant}
        data-test="save-printer-details"
        ?disabled=${action.unchanged || draft.saving || invalid}
        ?loading=${draft.saving}
        @click=${save}
        >${t("action.save")}</wt-button
      >
    </wt-form-actions>`;
  }

  #renderPrinterStatus(p: Printer): TemplateResult {
    const seen = this.#printerObservation(p);
    const address = p.host ? `${p.host}${p.port === null ? "" : `:${p.port}`}` : null;
    const yesNo = (value: boolean) => t(value ? "printers.yes" : "printers.no");
    const connection: SettingsRow[] = [
      {
        label: t("printers.transport"),
        value: transportName(p.transport),
        dataTest: `printer-transport-${p.id}`,
      },
    ];
    if (p.transport === "network_tcp") {
      connection.push({
        label: t("printers.connection"),
        value: t("printers.connection_network"),
        dataTest: `printer-connection-${p.id}`,
      });
      if (address)
        connection.push({
          label: t("printers.address"),
          value: address,
          dataTest: "printer-detail-address",
        });
      connection.push({
        label: t("printers.last_seen_by"),
        value: seen?.agentName ?? t("printers.agent_unknown"),
        dataTest: "printer-detail-last-seen-by",
      });
    } else if (p.transport === "cloud_poll") {
      connection.push({
        label: t("printers.connection"),
        value: t("printers.connection_direct"),
        dataTest: `printer-connection-${p.id}`,
      });
      if (p.pollId)
        connection.push({
          label: t("printers.poll_id"),
          value: p.pollId,
          dataTest: "printer-detail-poll-id",
        });
    } else {
      connection.push({
        label: t("printers.connected_through"),
        value: seen?.agentName ?? t("printers.agent_unknown"),
        dataTest: "printer-detail-connected-through",
      });
    }
    if (p.localKey)
      connection.push({
        label: t("printers.local_key"),
        value: p.localKey,
        dataTest: "printer-detail-local-key",
      });
    if (seen)
      connection.push({
        label: t("printers.last_seen"),
        value: formatRecentMinute(seen.lastSeenAt),
        dataTest: "printer-detail-last-seen",
      });
    const paper: SettingsRow[] = [
      {
        label: t("printers.paper_width"),
        value: t(p.paperWidth === "58mm" ? "printers.paper_width_58" : "printers.paper_width_80"),
        dataTest: "printer-detail-paper-width",
      },
      {
        label: t("printers.resolution"),
        value: t(p.resolution === "180dpi" ? "printers.resolution_180" : "printers.resolution_203"),
        dataTest: "printer-detail-resolution",
      },
      {
        label: t("printers.drawer_attached"),
        value: yesNo(p.hasCashDrawer),
        dataTest: "printer-drawer",
      },
      { label: t("printers.portable"), value: yesNo(p.portable), dataTest: "printer-portable" },
      ...(p.portable
        ? [{ label: t("printers.holder"), value: holderText(p.holder), dataTest: "printer-holder" }]
        : []),
    ];
    return html`<section data-test="printer-status">
      <div class="status-grid">
        ${detailsSection({
          id: "printer-details-status",
          heading: t("printers.status"),
          dataTest: "printer-section-status",
          rows: [
            {
              label: t("printers.pending_jobs"),
              value: String(p.pendingJobs),
              dataTest: "printer-detail-pending",
            },
            {
              label: t("printers.last_print"),
              value: p.lastPrintAt
                ? formatRecentMinute(p.lastPrintAt)
                : t("printers.last_seen_never"),
              dataTest: "printer-detail-last-print",
            },
          ],
        })}
        ${detailsSection({
          id: "printer-details-connection",
          heading: t("printers.connection"),
          dataTest: "printer-section-connection",
          rows: connection,
          after: html`${this.#pairAgainAction(p)}${this.#renderPairedAgain()}`,
        })}
        ${detailsSection({
          id: "printer-details-paper",
          heading: t("printers.details_paper"),
          dataTest: "printer-section-calibration",
          rows: paper,
          after: p.portable
            ? html`<div class="status-actions">
                <wt-button
                  data-test="open-equipment-label"
                  @click=${(event: Event) => {
                    this.#labelOpener = event.currentTarget as HTMLElement;
                    this.labelPrinterId = p.id;
                  }}
                  >${t("equipment.label")}</wt-button
                >
              </div>`
            : nothing,
        })}
        ${this.#renderUsedBy(
          this.printerProfiles.filter((offer) => offer.printerId === p.id),
          this.printerStations.filter((station) => station.printerId === p.id),
        )}
      </div>
    </section>`;
  }

  /** The profiles, their departments and the prep stations that use one printer. */
  #renderUsedBy(profiles: PrinterProfileOffer[], stations: PrinterStationName[]): TemplateResult {
    const link = (screen: string, href: string, name: string) =>
      this.canOpen(screen) ? html`<a href=${href}>${name}</a>` : name;
    const departments = new Map<string, string>();
    for (const { departmentId, departmentName } of profiles)
      if (departmentId !== null && departmentName !== null)
        departments.set(departmentId, departmentName);
    const rows: SettingsRow[] = [];
    if (profiles.length > 0)
      rows.push({
        label: t("nav.device_profiles"),
        value: profiles.map(
          (offer) =>
            html`<div data-test=${`printer-used-by-profile-${offer.profileId}`}>
              ${usedByProfileLine(
                link(
                  "device-profiles",
                  `/device-profiles/profile/${encodeURIComponent(offer.profileId)}`,
                  offer.profileName,
                ),
                offer.roles.map((role) => t(USE_WORDS[role])).join(", "),
              )}
            </div>`,
        ),
        dataTest: "printer-used-by-profiles",
      });
    if (departments.size > 0)
      rows.push({
        label: t("printers.used_by_departments"),
        value: commaList(
          [...departments]
            .sort(([, a], [, b]) => a.localeCompare(b))
            .map(([id, name]) =>
              link(
                "venue-operations",
                `/venue-operations/department/${encodeURIComponent(id)}`,
                name,
              ),
            ),
        ),
        dataTest: "printer-used-by-departments",
      });
    if (stations.length > 0)
      rows.push({
        label: t("printers.used_by_stations"),
        value: commaList(
          stations.map(({ stationId, stationName }) =>
            link(
              "prep-stations",
              `/prep-stations/view/stations/station/${encodeURIComponent(stationId)}`,
              stationName,
            ),
          ),
        ),
        dataTest: "printer-used-by-stations",
      });
    return detailsSection({
      id: "printer-details-used-by",
      heading: t("printers.used_by"),
      dataTest: "printer-section-used-by",
      className: "used-by",
      rows,
      after:
        rows.length === 0 && this.usageRead.size === 2
          ? html`<p data-test="printer-used-by-nothing">${t("printers.used_by_nothing")}</p>`
          : nothing,
    });
  }

  #seenStatus(
    printerId: string,
    device: Pick<DiscoveredPrinter, "agentName" | "lastSeenAt"> | undefined,
  ): TemplateResult | typeof nothing {
    if (device === undefined || device.agentName === null) return nothing;
    return html`<div data-test=${`printer-last-seen-${printerId}`} part="printer-meta">
      ${fill("printers.seen_at", { agent: device.agentName, time: formatIsoMinute(device.lastSeenAt) })}
    </div>`;
  }

  /** Who last saw each receipt printer, as of the latest draw; the kept columns' cells read it. */
  #seenPrinters = new Map<
    string,
    Pick<DiscoveredPrinter, "agentId" | "agentName" | "lastSeenAt"> | undefined
  >();
  #printerColumnKey = "";
  #printerColumnList: DataTableColumn<PrinterTableRow>[] = [];

  // The agent filter chooses by agent id, or by one of these codes where no agent is named, so a
  // saved choice survives a language change and two agents sharing a name stay two choices.
  #printerAgentOf(r: PrinterTableRow): { id: string; name: string } {
    if (r.kind === "a4")
      return r.row.agentId !== null && r.row.agentName !== null
        ? { id: r.row.agentId, name: r.row.agentName }
        : { id: "gone", name: t("printers.invoice_printer_agent_gone") };
    if (r.printer.transport === "cloud_poll") return { id: "cloud", name: "—" };
    const observed = this.#seenPrinters.get(r.printer.id);
    return observed !== undefined && observed.agentName !== null
      ? { id: observed.agentId, name: observed.agentName }
      : { id: "unknown", name: t("printers.agent_unknown") };
  }

  #printerAgentOptions(rows: PrinterTableRow[]): PrinterFilterOptions {
    // Until the printers agents have seen are read, those printers count as "unknown"; no
    // options keeps a saved agent choice waiting rather than letting the table drop it.
    if (this.loading) return [];
    const agentChoices = new Map<string, string>();
    for (const row of rows) {
      const agent = this.#printerAgentOf(row);
      if (!agentChoices.has(agent.id)) agentChoices.set(agent.id, agent.name);
    }
    const agentFallbacks = ["gone", "unknown", "cloud"];
    const agentLabels = [...agentChoices].filter(([id]) => !agentFallbacks.includes(id));
    const agentLabel = (id: string, name: string) => {
      const host = this.agents.find((agent) => agent.id === id)?.host;
      return host && agentLabels.some(([other, label]) => other !== id && label === name)
        ? `${name} (${host})`
        : name;
    };
    return [
      ...agentLabels.map(([value, name]) => ({ value, label: agentLabel(value, name) })),
      ...agentFallbacks
        .filter((id) => agentChoices.has(id))
        .map((value) => ({ value, fixed: true, label: agentChoices.get(value)! })),
    ];
  }

  #printerColumns(rows: PrinterTableRow[]): DataTableColumn<PrinterTableRow>[] {
    const agentOptions = this.#printerAgentOptions(rows);
    const key = JSON.stringify([currentLocale(), agentOptions]);
    if (key !== this.#printerColumnKey) {
      this.#printerColumnKey = key;
      this.#printerColumnList = this.#buildPrinterColumns(agentOptions);
    }
    return this.#printerColumnList;
  }

  #buildPrinterColumns(agentOptions: PrinterFilterOptions): DataTableColumn<PrinterTableRow>[] {
    const idOf = printerRowId;
    const nameOf = (r: PrinterTableRow) => (r.kind === "receipt" ? r.printer.name : r.row.name);
    const paperOf = (r: PrinterTableRow) =>
      r.kind === "receipt" ? r.printer.paperWidth : r.row.media;
    const agentNameOf = (r: PrinterTableRow) => this.#printerAgentOf(r).name;
    return [
      {
        key: "name",
        label: t("printers.name"),
        sortValue: nameOf,
        searchValue: nameOf,
        cell: (r) =>
          html`<wt-button
              variant="ghost"
              part="printer-name"
              data-test=${`printer-row-${idOf(r)}`}
              @click=${(event: Event) =>
                this.#showPrinterStatus(idOf(r), event.currentTarget as HTMLElement)}
              >${nameOf(r)}</wt-button
            >${r.kind === "a4" ? this.#testPages.noteFor(r.row) : r.printer.active ? nothing : html`<div part="printer-meta" data-test=${`printer-add-again-${r.printer.id}`}>${t("printers.add_again_hint")}</div>`}`,
      },
      {
        key: "paper",
        choosable: "shown",
        label: t("printers.invoice_printer_paper"),
        filter: {
          preserveOrder: true,
          label: t("printers.invoice_printer_paper"),
          allLabel: t("printers.filter_paper_all"),
          multiple: {
            countLabel: (count) => fill("printers.filter_paper_count", { count: String(count) }),
          },
          value: paperOf,
          options: [
            { value: "58mm", label: t("printers.paper_roll_58") },
            { value: "80mm", label: t("printers.paper_roll_80") },
            { value: "iso_a4_210x297mm", label: pageSize("iso_a4_210x297mm") },
            { value: "na_letter_8.5x11in", label: pageSize("na_letter_8.5x11in") },
          ],
        },
        cell: (r) =>
          r.kind === "receipt"
            ? html`<span data-test=${`printer-paper-${r.printer.id}`}
                >${t(
                  r.printer.paperWidth === "58mm"
                    ? "printers.paper_roll_58"
                    : "printers.paper_roll_80",
                )}</span
              >`
            : html`<span data-test=${`page-printer-paper-${r.row.id}`}
                >${pageSize(r.row.media)}</span
              >`,
      },
      {
        key: "agent",
        choosable: "shown",
        label: t("printers.last_seen_by"),
        searchValue: agentNameOf,
        filter: {
          label: t("printers.last_seen_by"),
          allLabel: t("printers.filter_agent_all"),
          multiple: {
            countLabel: (count) => fill("printers.filter_agent_count", { count: String(count) }),
          },
          value: (r) => this.#printerAgentOf(r).id,
          options: agentOptions,
        },
        cell: (r) => {
          if (r.kind === "a4")
            return html`<span data-test=${`page-printer-agent-${r.row.id}`}
              >${agentNameOf(r)}</span
            >`;
          const p = r.printer;
          return html`<span data-test=${`printer-agent-${p.id}`}> ${agentNameOf(r)} </span
            >${this.#seenStatus(p.id, this.#seenPrinters.get(p.id))}`;
        },
      },
      {
        key: "pending",
        choosable: "shown",
        label: t("printers.pending_jobs"),
        sortValue: (r) => (r.kind === "receipt" ? r.printer.pendingJobs : null),
        cell: (r) =>
          r.kind === "receipt"
            ? r.printer.pendingJobs
            : html`<span data-test=${`page-printer-pending-${r.row.id}`}>—</span>`,
      },
      {
        key: "lastPrint",
        choosable: "shown",
        label: t("printers.last_print"),
        sortValue: (r) => (r.kind === "receipt" ? r.printer.lastPrintAt : null),
        cell: (r) =>
          r.kind === "receipt"
            ? this.#timestamp(r.printer.lastPrintAt)
            : html`<span data-test=${`page-printer-last-print-${r.row.id}`}>—</span>`,
      },
      {
        key: "actions",
        label: t("printers.actions"),
        pinned: "end",
        cell: (r) =>
          r.kind === "receipt"
            ? this.#printerActions(r.printer)
            : this.canManage
              ? this.#pagePrinterRowActions(r.row)
              : nothing,
      },
    ];
  }

  #renderPrintersSection(): TemplateResult {
    this.#seenPrinters = new Map(this.printers.map((p) => [p.id, this.#printerObservation(p)]));
    const pages = this.#testPages;
    const rows: PrinterTableRow[] = [
      ...this.printers.map((printer) => ({ kind: "receipt" as const, printer })),
      ...this.pagePrinters.map((row) => ({ kind: "a4" as const, row })),
    ];
    return html`<section>
      ${this.#unreadTable(
        rows.length === 0 &&
          (this.#queries.failing("listPrinters") || this.#queries.failing("listPagePrinters")),
        (errorMessage) =>
          html`<wt-data-table
            noMatchesMessage=${tableNoMatches()}
            filterSearchPlaceholder=${t("categories.combobox_search")}
            filterNoResultsLabel=${t("categories.combobox_no_results")}
            data-test="printers-table"
            searchable
            searchLabel=${t("printers.search")}
            viewKey="waitron.printers.table"
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
            aria-label=${t("printers.list_title")}
            .rows=${rows}
            .columns=${this.#printerColumns(rows)}
            .rowKey=${(r: PrinterTableRow) => `${r.kind}:${printerRowId(r)}`}
            .loading=${this.loading}
            .loadingMessage=${t("printers.table_loading")}
            .emptyMessage=${t("printers.no_printers")}
            .errorMessage=${errorMessage}
            >${rows.length === 0 ? this.#renderAddPrinter("empty-action") : nothing}</wt-data-table
          >`,
      )}
      ${
        pages.actionError === null
          ? nothing
          : html`<p class="error" role="alert" data-test="page-printers-action-error">
              ${codeMessage(pages.actionError)}
            </p>`
      }
      ${
        pages.readError === null
          ? nothing
          : html`<p class="error" role="alert" data-test="page-printers-read-error">
              ${t("printers.refresh_failed")} ${codeMessage(pages.readError)}
            </p>`
      }
    </section>`;
  }

  #pagePrinterRowActions(row: PagePrinterRow): TemplateResult {
    const pages = this.#testPages;
    return html`<dashboard-row-actions .label=${fill("printers.row_actions", { name: row.name })}>
      <wt-button
        icon="menu-edit"
        data-test=${`edit-page-printer-${row.id}`}
        @click=${(event: Event) => {
          const button = event.currentTarget as HTMLElement;
          this.#showPrinterStatus(row.id, this.#rowMenuButton(button) ?? button);
          this.#openDetailEdit(row.id, { name: row.name, host: "", port: "" });
        }}
        >${t("action.edit_dialog")}</wt-button
      >
      <wt-button
        icon="menu-print"
        data-test=${`print-test-page-${row.id}`}
        ?disabled=${pages.unavailable(row)}
        ?loading=${pages.sending.has(row.id)}
        @click=${() => void pages.print(row)}
        >${t("printers.print_test_page")}</wt-button
      >
      ${rowActionTail(true, [
        html`<wt-button
          icon="menu-delete"
          variant="danger"
          data-test=${`delete-page-printer-${row.id}`}
          @click=${(event: Event) => {
            const button = event.currentTarget as HTMLElement;
            this.#openDelete(row, this.#rowMenuButton(button) ?? button, true);
          }}
          >${t("action.delete_dialog")}</wt-button
        >`,
      ])}
    </dashboard-row-actions>`;
  }

  #renderTabActions(): TemplateResult {
    return html`<div slot="actions">${this.#renderAddAgent()}${this.#renderAddPrinter()}</div>`;
  }

  #renderAddAgent(slot?: "empty-action"): TemplateResult {
    return html`<wt-button
      ?hidden=${this.view !== "agents"}
      slot=${ifDefined(slot)}
      variant="primary"
      data-test="open-add-agent"
      @click=${() => this.#openAgentModal()}
      >${t("printers.add_agent")}</wt-button
    >`;
  }

  #renderAddPrinter(slot?: "empty-action"): TemplateResult {
    return html`<wt-button
      ?hidden=${this.view !== "printers"}
      slot=${ifDefined(slot)}
      variant="primary"
      data-test="open-add-printer"
      @click=${() => this.#openAddPrinter()}
      >${t("printers.add_printer")}</wt-button
    >`;
  }

  #openAddPrinter(): void {
    this.#addPrinterOpening++;
    this.#resetPair();
    this.#finishPrinterName(this.#printerNameOpening);
    this.#disposeAddressDraft();
    const modal = this.renderRoot.querySelector<WtModal>("[data-test=new-printer-modal]");
    if (modal) modal.open = true;
    this.formAttempted = false;
    this.errorKey = null;
    this.addingPrinter = true;
    this.probeHost = "";
    this.probePort = "9100";
    this.#probeFeedback.reset();
    this.probeRefused = {};
    this.probeErrorKey = null;
    this.#registeredDevices.clear();
    this.discoveredNames = {};
    this.addingPagePrinter = null;
    this.pagePrinterRefusals = {};
    this.addedPrinterName = null;
    this.showAllBluetooth = false;
    this.#addressLeave = leaveCoordinatorFor(this);
    this.#addressScope = this.#addressLeave?.register({
      id: {},
      current: () => this.#addressValues(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.host === b.host && a.port === b.port,
      restore: (value) => {
        this.probeHost = value.host;
        this.probePort = value.port;
      },
    });
    void this.#scan();
  }

  #jobColumnKey = "";
  #jobColumnList: DataTableColumn<PrintJobRow>[] = [];

  #jobPrinterName(j: PrintJobRow): string {
    return this.printers.find((p) => p.id === j.printerId)?.name ?? j.printerName;
  }

  #jobColumns(): DataTableColumn<PrintJobRow>[] {
    const jobPrinters = new Map(this.jobs.map((j) => [j.printerId, this.#jobPrinterName(j)]));
    const printerOptions = [...jobPrinters].map(([value, label]) => ({ value, label }));
    const key = JSON.stringify([currentLocale(), printerOptions]);
    if (key !== this.#jobColumnKey) {
      this.#jobColumnKey = key;
      this.#jobColumnList = this.#buildJobColumns(printerOptions);
    }
    return this.#jobColumnList;
  }

  #buildJobColumns(
    printerOptions: { value: string; label: string }[],
  ): DataTableColumn<PrintJobRow>[] {
    return [
      {
        key: "printer",
        label: t("printers.job_printer"),
        searchValue: (j) => this.#jobPrinterName(j),
        filter: {
          label: t("printers.job_printer"),
          allLabel: t("printers.filter_printer_all"),
          multiple: {
            countLabel: (count) => fill("printers.filter_printer_count", { count: String(count) }),
          },
          value: (j) => j.printerId,
          options: printerOptions,
        },
        cell: (j) => {
          const printer = this.printers.find((p) => p.id === j.printerId);
          return html`<span data-test=${`job-row-${j.id}`}
              >${
                printer
                  ? html`<wt-button
                      variant="ghost"
                      part="printer-name"
                      data-test=${`job-printer-${j.id}`}
                      @click=${(event: Event) =>
                        this.#showPrinterStatus(printer.id, event.currentTarget as HTMLElement)}
                      >${printer.name}</wt-button
                    >`
                  : html`<span data-test=${`job-printer-${j.id}`}>${j.printerName}</span>`
              }</span
            >${
              j.kind !== "a4"
                ? nothing
                : html`<p part="job-reason">
                    ${t(
                      j.pageDocument === "invoice"
                        ? "printers.job_a4_invoice"
                        : j.pageDocument === "receipt"
                          ? "printers.job_a4_receipt"
                          : "printers.job_a4_page",
                    )}
                  </p>`
            }`;
        },
      },
      {
        key: "status",
        choosable: "shown",
        label: t("printers.status"),
        filter: {
          preserveOrder: true,
          label: t("printers.status"),
          allLabel: t("printers.filter_status_all"),
          multiple: {
            countLabel: (count) => fill("printers.filter_status_count", { count: String(count) }),
          },
          value: (j) => j.status,
          options: JOB_STATUSES.map((status) => ({ value: status, label: jobStatusName(status) })),
        },
        searchValue: (j) =>
          [jobStatusName(j.status), jobErrorMessage(j) ?? "", jobWaitMessage(j) ?? ""].join(" "),
        cell: (j) => {
          const waiting = jobWaitMessage(j);
          const error = jobErrorMessage(j);
          return html`<span part=${`job-status job-${j.status}`} data-test=${`job-status-${j.id}`}
              >${jobStatusName(j.status)}</span
            >${error === undefined ? nothing : html`<p part="job-reason" data-test=${`job-error-${j.id}`}>${error}</p>`}${waiting === undefined ? nothing : html`<p part="job-reason" data-test=${`job-wait-${j.id}`}>${waiting}</p>`}`;
        },
      },
      {
        key: "attempts",
        choosable: "shown",
        label: t("printers.job_attempts"),
        // A terminal office job is stamped with the retry cap even after a single submission.
        sortValue: (j) => (j.kind === "a4" ? null : j.attempts),
        cell: (j) =>
          html`<span data-test=${`job-attempts-${j.id}`}
            >${
              j.kind === "a4" || (j.lastError !== null && ENDED_BY_SERVER.has(j.lastError))
                ? "—"
                : j.attempts
            }</span
          >`,
      },
      {
        key: "queued",
        choosable: "shown",
        label: t("printers.queued_at"),
        sortValue: (j) => j.createdAt,
        cell: (j) => this.#timestamp(j.createdAt),
      },
      {
        key: "delivered",
        choosable: "shown",
        label: t("printers.delivered_at"),
        sortValue: (j) => j.deliveredAt,
        cell: (j) => this.#timestamp(j.deliveredAt),
      },
      {
        key: "preview",
        label: t("printers.actions"),
        cell: (j) =>
          j.kind === "a4"
            ? nothing
            : html`<div part="job-actions">
                <wt-button data-test=${`view-job-${j.id}`} @click=${() => void this.#viewJob(j.id)}
                  >${t("printers.view_job")}</wt-button
                >${
                  j.canResend
                    ? html`<wt-button
                        data-test=${`resend-job-${j.id}`}
                        ?loading=${this.reprintsSending.has(j.id)}
                        @click=${() => {
                          if (!this.reprintsSending.has(j.id)) this.reprintJob = j;
                        }}
                        >${t("printers.resend_job")}</wt-button
                      >`
                    : nothing
                }
              </div>`,
      },
    ];
  }

  #renderJobsSection(): TemplateResult {
    const delivered = this.jobs.filter((job) => job.status === "done" || job.status === "unknown");
    const hasOlder = delivered.length >= 100;
    return html`<section>
      ${this.#unreadTable(
        this.jobs.length === 0 && this.#queries.failing("listRecentJobs"),
        (errorMessage) =>
          html`<p class="hint">${t("printers.jobs_limit")}</p>
            ${
              hasOlder || this.completedJobsPage > 0
                ? html`<wt-button
                      data-test="newer-print-jobs"
                      data-history-page
                      ?disabled=${this.completedJobsPage === 0}
                      @click=${() => void this.#showCompletedJobs(this.completedJobsPage - 1)}
                      >${t("printers.newer_jobs")}</wt-button
                    >
                    <wt-button
                      data-test="older-print-jobs"
                      data-history-page
                      ?disabled=${!hasOlder}
                      @click=${() => void this.#showCompletedJobs(this.completedJobsPage + 1)}
                      >${t("printers.older_jobs")}</wt-button
                    >`
                : nothing
            }
            <wt-data-table
              noMatchesMessage=${tableNoMatches()}
              filterSearchPlaceholder=${t("categories.combobox_search")}
              filterNoResultsLabel=${t("categories.combobox_no_results")}
              data-test="jobs-table"
              aria-busy=${this.readingCompletedJobs}
              searchable
              searchLabel=${t("printers.jobs_search")}
              viewKey="waitron.printers.jobs.table"
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
              aria-label=${t("printers.jobs_title")}
              .rows=${this.jobs}
              .columns=${this.#jobColumns()}
              .rowKey=${(j: PrintJobRow) => j.id}
              .loading=${this.loading}
              .loadingMessage=${t("printers.table_loading")}
              .emptyMessage=${t("printers.no_jobs")}
              .errorMessage=${errorMessage}
            ></wt-data-table>`,
      )}
    </section>`;
  }

  #renderReprint(): TemplateResult | typeof nothing {
    if (this.reprintJob === null) return nothing;
    const id = this.reprintJob.id;
    return html`<dashboard-print-job-reprint-dialog
      .api=${this.#reprintApi}
      .job=${this.reprintJob}
      .printers=${this.printers}
      @reprint-close=${() => {
        this.reprintJob = null;
      }}
      @reprinted=${(event: CustomEvent<{ printerName: string }>) => {
        // Also sent by a dialog already closed, whose request was still being answered.
        if (this.reprintJob?.id === id) this.reprintJob = null;
        this.reprintSentTo = event.detail.printerName;
        if (this.isConnected) void this.#load();
      }}
    ></dashboard-print-job-reprint-dialog>`;
  }

  #renderReprintSent(): TemplateResult | typeof nothing {
    if (this.reprintSentTo === null) return nothing;
    return html`<wt-notice
      class="sent"
      data-test="reprint-sent"
      .duration=${NOTICE_MS}
      @wt-notice-gone=${() => {
        this.reprintSentTo = null;
      }}
      >${fill("printers.reprint_sent", { printer: this.reprintSentTo })}</wt-notice
    >`;
  }

  async #viewJob(id: string): Promise<void> {
    this.errorKey = null;
    try {
      this.preview = await this.api.getPrintJobPreview(id);
      this.previewOpen = true;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The button that opens the row menu `action` sits in. */
  #rowMenuButton(action: HTMLElement): HTMLButtonElement | undefined {
    return (
      action
        .closest("dashboard-row-actions")
        ?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? undefined
    );
  }

  #rememberEditTrigger(event: Event): void {
    const trigger = this.#rowMenuButton(event.currentTarget as HTMLElement);
    const menu = trigger?.getRootNode() as ShadowRoot | undefined;
    this.#editTrigger = menu?.querySelector("[popover]")?.matches(":popover-open")
      ? trigger
      : undefined;
  }

  #tabAction(key: "open-add-printer" | "open-add-agent"): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`[slot="actions"] [data-test="${key}"]`);
  }

  #restoreEditFocus(): void {
    // The action that opened the editor is hidden when its popover closes.
    this.#editTrigger?.focus();
    this.#editTrigger = undefined;
  }

  async #closeModal(id: string): Promise<void> {
    const modal = this.renderRoot.querySelector<WtModal>(`[data-test="${id}"]`);
    if (!modal?.open) return;
    if (id === "edit-agent-modal") {
      if (this.submitting) return;
      if (this.#agentLeave) {
        await modal.requestClose("cancel");
        return;
      }
    }
    if (id === "name-printer-modal" || id === "new-printer-modal") {
      if (id === "new-printer-modal" ? this.#addressScope : this.#printerNameScope) {
        await modal.requestClose(id === "new-printer-modal" ? "navigation" : "cancel");
        return;
      }
    }
    if (
      (id === "pair-printer-modal" && this.#pairLeave) ||
      (id === "pair-again-modal" && this.#pairAgainLeave)
    ) {
      await modal.requestClose("cancel");
      return;
    }
    if (id === "edit-printer-modal" && this.#calibrationLeave) {
      await modal.requestClose("cancel");
      return;
    }
    if (id === "new-printer-modal") this.#endScan();
    // Native close restores focus before wt-close removes the draft and modal from the template.
    const closed = new Promise<void>((resolve) =>
      modal.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    modal.open = false;
    await closed;
  }

  /** An empty list whose read failed never says there is nothing: the refresh alert says the read
   * failed, and the list is left out; with no alert showing, the list says it. */
  #unreadTable(
    unread: boolean,
    table: (errorMessage: string) => TemplateResult,
  ): TemplateResult | typeof nothing {
    if (!unread) return table("");
    return this.refreshErrorKey === null ? table(t("printers.refresh_failed")) : nothing;
  }

  /** A failed read, with its own retry, stays at the top of the page or the dialog. */
  #renderRefreshError(): TemplateResult | typeof nothing {
    if (!this.refreshErrorKey) return nothing;
    return html`<div data-test="printer-refresh-error" role="alert">
      <p class="error">${t("printers.refresh_failed")} ${codeMessage(this.refreshErrorKey)}</p>
      <wt-button data-test="refresh-printer-lists" @click=${() => void this.#load()}
        >${t("printers.refresh_lists")}</wt-button
      >
    </div>`;
  }

  /** Checks the draft once the form has been submitted, focusing the first invalid field. */
  #validatePrinter(row: PrinterDraft): boolean {
    this.formAttempted = true;
    const valid = Object.keys(this.#printerErrors(row)).length === 0;
    if (!valid) this.#focusFirstInvalid("[data-test=edit-printer-modal]");
    return valid;
  }

  #printerErrors(row: PrinterDraft): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!row.name.trim()) errors.name = t("form.name_required");
    if (row.transport === "network_tcp") {
      if (!row.host.trim()) errors.host = t("printers.host_required");
      if (
        row.port.trim() &&
        (!Number.isInteger(Number(row.port)) || Number(row.port) < 1 || Number(row.port) > 65535)
      )
        errors.port = t("printers.port_invalid");
    }
    if ((row.transport === "usb" || row.transport === "bluetooth") && !row.localKey?.trim())
      errors.localKey = t("printers.device_required");
    if (row.transport === "cloud_poll" && !row.pollId?.trim())
      errors.pollId = t("printers.poll_required");
    return errors;
  }

  #renderCalibrationFailure(): TemplateResult | typeof nothing {
    const job = this.jobs.find(({ id }) => id === this.calibrationJobId);
    if (job?.status !== "failed") return nothing;
    return html`<p class="error" role="alert" data-test="calibration-job-failed">
      ${fill("printers.calibration_job_failed", { reason: jobReason(job.lastError ?? "") })}
    </p>`;
  }

  #renderEditPrinter(): TemplateResult | typeof nothing {
    const p = this.editingPrinter;
    if (!p) return nothing;
    const opening = this.#calibrationOpening;
    const errors = this.formAttempted ? this.#printerErrors(p) : {};
    const settingDots = textGrid(p.paperWidth, p.resolution).widthDots;
    const bottom = bottomMessage(
      this.#bluetoothRefusal(this.errorKey),
      refusal(this.testError),
      ...Object.values(errors),
    );
    return html`<wt-modal
      size="standard"
      height="medium"
      data-test="edit-printer-modal"
      heading=${`${t("printers.calibrate")}: ${p.name}`}
      .open=${true}
      .opener=${this.#tabAction("open-add-printer")}
      .beforeClose=${this.#calibrationLeave ? this.#beforeCalibrationClose : undefined}
      @wt-close=${() => {
        this.#finishCalibration(opening);
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector(this.calibrationStep < 3 ? "[data-test=calibration-next]" : `[data-test="save-printer-${p.id}"]`))}
    >
      ${
        this.calibrationStep === 1
          ? html`<wt-help-tooltip
              slot="help"
              mode="help-mode"
              aria-label=${fill("help.badge_label", { part: t("printers.calibrate") })}
              guide-href=${guideHref("printers.calibrate")}
              guide-label=${t("help.guide_link")}
              >${t("printers.calibration_help")}</wt-help-tooltip
            >`
          : nothing
      }
      <div class="form-fields">
        ${this.#renderRefreshError()}
        <p role="status">
          ${fill("printers.calibration_progress", { step: String(this.calibrationStep) })}
        </p>
        ${this.#renderCalibrationFailure()}
        <div
          data-test="calibration-step-1"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 1}
        >
          <h2 class="title">${t("printers.calibration_layout")}</h2>
          <p class="hint">${t("printers.resolution_hint")}</p>
          <div class="print-row">
            <wt-button
              variant="primary"
              data-test=${`print-ruler-${p.id}`}
              ?loading=${this.printingTest}
              @click=${() => void this.#testPrint(p.id)}
              >${t("printers.ruler_print")}</wt-button
            >
          </div>
          <div class="field-row">
            <wt-combobox
              name="printer-ruler-number"
              label=${t("printers.ruler_last_number")}
              search="auto"
              placeholder=${t("printers.test_answer_choose")}
              .options=${[
                { value: "", label: t("printers.test_answer_choose") },
                ...SETTING_WIDTHS.map(({ widthDots }) => ({
                  value: String(widthDots),
                  label: String(widthDots),
                })),
              ]}
              .value=${this.rulerNumber}
              @wt-change=${(e: CustomEvent<{ value: string }>) => {
                this.rulerNumber = e.detail.value;
                const setting = SETTING_WIDTHS.find(
                  ({ widthDots }) => String(widthDots) === this.rulerNumber,
                );
                if (setting) this.#editPrinter(p.id, { paperWidth: setting.paperWidth });
              }}
            ></wt-combobox>
            <wt-combobox
              name="printer-qr-square"
              label=${t("printers.qr_square")}
              search="auto"
              .options=${[
                { value: "180dpi", label: t("printers.test_qr_45") },
                { value: "203dpi", label: t("printers.test_qr_40") },
              ]}
              .value=${p.resolution}
              @wt-change=${(e: CustomEvent<{ value: string }>) =>
                this.#editPrinter(p.id, { resolution: e.detail.value as PrintResolution })}
            ></wt-combobox>
          </div>
          <dl class="status-fields calibration-results" data-test="calibration-results">
            <div>
              <dt>${t("printers.paper_width")}</dt>
              <dd data-test="calibration-result-paper">
                ${t(p.paperWidth === "58mm" ? "printers.paper_width_58" : "printers.paper_width_80")}
              </dd>
            </div>
            <div>
              <dt>${t("printers.resolution")}</dt>
              <dd data-test="calibration-result-resolution">
                ${t(p.resolution === "180dpi" ? "printers.resolution_180" : "printers.resolution_203")}
              </dd>
            </div>
          </dl>
          ${
            this.rulerNumber !== "" && Number(this.rulerNumber) !== settingDots
              ? html`<p role="status" class="ruler-disagrees" data-test="ruler-disagrees">
                  ${fill("printers.ruler_disagrees", { ruler: this.rulerNumber, setting: String(settingDots) })}
                </p>`
              : nothing
          }
        </div>
        <div
          data-test="calibration-step-2"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 2}
        >
          <h2 class="title">${t("printers.calibration_receipt")}</h2>
          <p>${t("printers.sample_hint")}</p>
          <div class="print-row">
            <wt-button
              variant="primary"
              data-test=${`print-sample-receipt-${p.id}`}
              ?loading=${this.printingSample}
              @click=${() => void this.#sampleReceipt(p)}
              >${t("printers.sample_receipt")}</wt-button
            >
          </div>
        </div>
        <div
          data-test="calibration-step-3"
          class="form-fields"
          ?hidden=${this.calibrationStep !== 3}
        >
          <h2 class="title">${t("printers.calibration_drawer")}</h2>
          <wt-switch
            name="printer-cash-drawer"
            label=${t("printers.drawer_attached")}
            .checked=${p.hasCashDrawer}
            @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
              e.stopPropagation();
              this.#editPrinter(p.id, { hasCashDrawer: e.detail.checked });
              this.drawerOutcome = "";
              this.drawerTestSent = false;
            }}
          ></wt-switch>
          ${
            p.hasCashDrawer
              ? html`
                  <div class="print-row">
                    <wt-button
                      data-test="test-printer-drawer"
                      ?loading=${this.testingDrawer}
                      @click=${() => void this.#testDrawer(p)}
                      >${t("printers.drawer_test")}</wt-button
                    >
                  </div>
                  ${
                    this.drawerTestSent
                      ? html`<fieldset>
                          <legend>${t("printers.drawer_result")}</legend>
                          ${["opened", "closed"].map(
                            (result) =>
                              html`<label class="radio-answer">
                                <input
                                  type="radio"
                                  name="printer-drawer-result"
                                  value=${result}
                                  .checked=${this.drawerOutcome === result}
                                  @change=${() => {
                                    this.drawerOutcome = result;
                                  }}
                                />
                                ${t(result === "opened" ? "printers.drawer_opened" : "printers.drawer_closed")}
                              </label>`,
                          )}
                        </fieldset>`
                      : nothing
                  }
                  ${this.drawerOutcome === "closed" ? html`<p role="status">${t("printers.drawer_check")}</p>` : nothing}
                `
              : nothing
          }
          <div class="switch-field">
            <wt-switch
              name="printer-portable"
              label=${t("printers.portable")}
              description=${t("printers.portable_hint")}
              .checked=${p.portable}
              @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                e.stopPropagation();
                this.#editPrinter(p.id, { portable: e.detail.checked });
              }}
            ></wt-switch>
            <p class="hint" aria-hidden="true">${t("printers.portable_hint")}</p>
          </div>
          <wt-combobox
            name="printer-pickup-roles"
            searchPlaceholder=${t("categories.combobox_search")}
            noResultsLabel=${t("categories.combobox_no_results")}
            label=${t("printers.pickup_roles")}
            multiple
            show-empty-option
            .values=${p.pickupRoles}
            .countLabel=${() => t("printers.pickup_both")}
            .options=${[
              { value: "", label: t("printers.pickup_none") },
              { value: "receipt", label: t("devices.receipt_printer_now") },
              { value: "payment_slip", label: t("devices.slip_printer_now") },
            ]}
            @wt-change=${(e: CustomEvent<{ values: Printer["pickupRoles"] }>) => {
              e.stopPropagation();
              this.#editPrinter(p.id, { pickupRoles: e.detail.values });
            }}
          ></wt-combobox>
        </div>
      </div>
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          data-test="cancel-edit-printer"
          @click=${() => void this.#closeModal("edit-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        ${
          this.calibrationStep > 1
            ? html`<wt-button
                slot="cancel"
                data-test="calibration-back"
                @click=${() => {
                  this.calibrationStep--;
                  this.#calibrationStepAddress();
                }}
                >${t("action.back")}</wt-button
              >`
            : nothing
        }
        ${
          this.calibrationStep > 0 && this.calibrationStep < 3
            ? html`<wt-button
                variant="primary"
                data-test="calibration-next"
                @click=${() => {
                  if (this.#validatePrinter(p)) {
                    this.calibrationStep++;
                    this.#calibrationStepAddress();
                  }
                }}
                >${t("action.continue")}</wt-button
              >`
            : html`
                <wt-button
                  variant=${this.#calibrationSave().variant}
                  data-test=${`save-printer-${p.id}`}
                  ?disabled=${this.#calibrationSave().unchanged}
                  ?loading=${this.submitting}
                  @click=${() => void this.#savePrinter(p.id)}
                  >${t("action.save")}</wt-button
                >
              `
        }
      </wt-form-actions>
    </wt-modal>`;
  }

  #discoveredAddress(device: DiscoveredPrinter): string {
    if (!device.host) return device.localKey ?? "—";
    if (!device.ippOnly && device.office === undefined)
      return `${device.host}:${device.port ?? 9100}`;
    const queue = device.office ?? device.ipp;
    return `${device.host}:${queue?.port ?? device.port ?? 9100}${queue?.resourcePath ?? ""}`;
  }

  #discoveredAddressLine(device: DiscoveredPrinter): TemplateResult {
    const address = this.#discoveredAddress(device);
    if (device.transport !== "bluetooth") return html`<div>${address}</div>`;
    // A cut inside a two-character group reads as a different address, so it breaks only after a colon.
    const groups = address.split(":").map((group, i) => (i === 0 ? group : html`:<wbr />${group}`));
    return html`<div part="bluetooth-address">${groups}</div>`;
  }

  #discoveredLabel(device: DiscoveredPrinter): string {
    if (device.name != null && device.name !== "")
      return device.ippOnly && device.host
        ? `${device.name} (${device.serverName || device.host})`
        : device.name;
    const parts = [device.make, device.model].filter((x): x is string => x != null && x !== "");
    if (parts.length > 0) return parts.join(" ");
    return device.localKey ?? device.host ?? "";
  }

  #renderPrinterName(): TemplateResult | typeof nothing {
    const d = this.namingPrinter;
    if (!d) return nothing;
    const opening = this.#printerNameOpening;
    const key = this.#deviceKey(d);
    const name =
      this.discoveredNames[key] ?? this.#disabledPrinter(d)?.name ?? this.#discoveredLabel(d);
    const nameError = this.formAttempted && !name.trim() ? t("form.name_required") : "";
    return html`<wt-modal
      size="compact"
      data-test="name-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      .beforeClose=${this.#printerNameScope ? this.#beforePrinterNameClose : undefined}
      @wt-close=${() => {
        this.#finishPrinterName(opening);
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=confirm-add-printer]"))}
    >
      <div class="form-fields">
        ${this.#renderRefreshError()}
        <p class="hint">
          ${this.#discoveredLabel(d)} · ${d.host ? `${d.host}:${d.port ?? 9100}` : d.localKey}
        </p>
        <wt-input
          required
          name="new-printer-name"
          label=${t("printers.name")}
          data-test=${`discovered-name-${key}`}
          .value=${name}
          .invalid=${nameError !== ""}
          .error=${nameError}
          ?disabled=${this.submitting}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (opening !== this.#printerNameOpening) return;
            this.discoveredNames = { ...this.discoveredNames, [key]: event.detail.value };
            this.#printerNameScope?.changed();
          }}
        ></wt-input>
      </div>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(this.#bluetoothRefusal(this.errorKey), nameError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-printer-name"
          @click=${() => void this.#closeModal("name-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${saveActionState(this.#printerNameScope, { savableAtOpen: true }).variant}
          data-test="confirm-add-printer"
          ?loading=${this.submitting}
          ?disabled=${this.submitting || nameError !== ""}
          @click=${() => void this.#registerDiscovered(d)}
          >${t("action.add")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #renderPairDialog(): TemplateResult | typeof nothing {
    const d = this.pairingDevice;
    if (!d) return nothing;
    const epoch = this.#pairEpoch;
    const pinInvalid = this.pairAttempted && !BLUETOOTH_PIN.test(this.pairPin);
    const pinError = pinInvalid || this.pairRefused ? t("printers.bluetooth_pin_invalid") : "";
    const s = saveActionState(this.#pairScope);
    return html`<wt-modal
      size="compact"
      data-test="pair-printer-modal"
      heading=${t("printers.bluetooth_pair_title")}
      .open=${true}
      .beforeClose=${this.#pairLeave ? this.#beforePairClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (epoch === this.#pairEpoch) this.#resetPair();
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=confirm-pair]"))}
    >
      <div class="form-fields">
        <p class="hint">${this.#discoveredLabel(d)} · ${d.localKey}</p>
        <wt-input
          required
          name="pin"
          autocomplete="off"
          label=${t("printers.bluetooth_pin")}
          hint=${t("printers.bluetooth_pin_hint")}
          data-test="bluetooth-pin"
          .value=${this.pairPin}
          .invalid=${pinError !== ""}
          .error=${pinError}
          ?disabled=${this.pairSubmitting}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (epoch !== this.#pairEpoch) return;
            this.pairPin = event.detail.value;
            this.pairRefused = false;
            this.#pairScope?.changed();
          }}
        ></wt-input>
      </div>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(this.#bluetoothRefusal(this.pairErrorKey), pinError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-pair"
          @click=${() => void this.#closeModal("pair-printer-modal")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${s.variant}
          data-test="confirm-pair"
          ?loading=${this.pairSubmitting}
          ?disabled=${s.unchanged || pinInvalid}
          @click=${() => void this.#pair(d)}
          >${this.#canPairOnly(d) || this.pairAgain !== null ? t("printers.bluetooth_pair_only") : t("printers.bluetooth_pair")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  #finishAddPrinter(opening: number): void {
    if (opening !== this.#addPrinterOpening) return;
    this.#addPrinterOpening++;
    this.addingPrinter = false;
    this.addingPagePrinter = null;
    this.#finishPrinterName(this.#printerNameOpening);
    if (!this.pairSubmitting) this.#resetPair();
    this.#disposeAddressDraft();
    this.#endScan();
    this.#stopRenewing();
    this.#dropDialogCommands();
  }

  #dropDialogCommands(): void {
    this.commands = Object.fromEntries(
      Object.entries(this.commands).filter(([, command]) => command.kind === "forget"),
    );
    this.pairedDevices = {};
    this.#settleCommandPoll();
  }

  #repointNote(row: OfficeRow | undefined): TemplateResult | typeof nothing {
    if (row?.kind !== "repoint") return nothing;
    return html`<div>
      ${t(row.agentGone ? "printers.page_printer_no_agent" : "printers.page_printer_other_agent")}
    </div>`;
  }

  #officeAction(d: DiscoveredPrinter, row: ListedOfficeRow): TemplateResult {
    const key = this.#rowKey(d);
    if (row.kind === "refused")
      return html`<span part="page-printer-hint" data-test=${`page-printer-${this.#rowKey(d)}`}
        >${t(row.reason)}</span
      >`;
    const { entry } = row;
    if (row.kind === "add")
      return html`<div part="page-printer-action">
        <wt-button
          variant="primary"
          data-test=${`add-page-printer-${key}`}
          @click=${() => this.#openPagePrinterAdd(d, entry)}
          >${t("printers.page_printer_add")}</wt-button
        >
      </div>`;
    const refusedCode = this.pagePrinterRefusals[key];
    return html`<div part="page-printer-action">
      <wt-button
        variant="primary"
        data-test=${`${row.kind}-page-printer-${key}`}
        ?loading=${this.pagePrinterSending.has(key)}
        @click=${() => void this.#registerPagePrinter(key, entry)}
        >${t("printers.page_printer_use_agent")}</wt-button
      >
      ${
        refusedCode === undefined
          ? nothing
          : html`<span
              part="page-printer-error"
              role="alert"
              data-test=${`page-printer-error-${key}`}
              >${codeMessage(refusedCode)}</span
            >`
      }
    </div>`;
  }

  #renderPagePrinterAdd(): TemplateResult | typeof nothing {
    const adding = this.addingPagePrinter;
    if (adding === null) return nothing;
    return html`<dashboard-page-printer-add
      .api=${this.api}
      .entry=${adding.entry}
      .draftParent=${this.#addressScope?.id}
      description=${adding.description}
      .suggestedName=${adding.suggestedName}
      @page-printer-added=${async (
        event: CustomEvent<{ id: string; name: string; outcome: string }>,
      ) => {
        await this.#refreshPagePrinters();
        this.addedPrinterName =
          this.pagePrinters.find((row) => row.id === event.detail.id)?.name ??
          (event.detail.outcome === "created" ? event.detail.name : null);
      }}
      @page-printer-add-closed=${() => {
        this.addingPagePrinter = null;
      }}
    ></dashboard-page-printer-add>`;
  }

  #renderNewPrinter(): TemplateResult | typeof nothing {
    if (!this.addingPrinter) return nothing;
    const opening = this.#addPrinterOpening;
    const pairOnly = new Set(this.discovered.filter((d) => this.#canPairOnly(d)));
    const probe = this.#probeShown();
    const officeRows = this.discovered.map((d) => [d, this.#officeRow(d)] as const);
    // Left out like an added receipt printer: nothing to do on the agent it is added through.
    const added = new Set(officeRows.flatMap(([d, row]) => (row?.kind === "added" ? [d] : [])));
    const office = new Map(
      officeRows.flatMap(([d, row]) => (row && row.kind !== "added" ? [[d, row] as const] : [])),
    );
    const refused = (d: DiscoveredPrinter) => office.get(d)?.kind === "refused";
    const addable = this.discovered.filter(
      (d) => !added.has(d) && (office.has(d) || pairOnly.has(d) || this.#canAdd(d)),
    );
    // A device registered to a switched-on printer is a printer, whatever the scan decoded.
    const shown = (d: DiscoveredPrinter) =>
      d.transport !== "bluetooth" ||
      d.printerLike === true ||
      // A paired device of unknown kind shows: hiding a paired printer is the worse mistake.
      (d.paired === true && d.printerLike !== false) ||
      pairOnly.has(d);
    const rows = addable
      .filter(
        (d) =>
          shown(d) || this.showAllBluetooth || this.commands[this.#commandKeyOf(d)] !== undefined,
      )
      .sort((a, b) => Number(refused(a)) - Number(refused(b)));
    const bluetoothKeys = (devices: DiscoveredPrinter[]) =>
      new Set(devices.filter((d) => d.transport === "bluetooth").map((d) => this.#commandKeyOf(d)));
    const rowKeys = bluetoothKeys(rows);
    // A Pair whose device the list no longer shows keeps a status-only row while its notice shows.
    const lost = new Set(
      Object.entries(this.commands).flatMap(([key, { device, noticeGone }]) =>
        device !== undefined && !noticeGone && !rowKeys.has(key) ? [device] : [],
      ),
    );
    const listed = lost.size > 0 ? bluetoothKeys(this.discovered) : rowKeys;
    const columns: DataTableColumn<DiscoveredPrinter>[] = [
      {
        key: "name",
        label: t("printers.name"),
        cell: (d) =>
          html`<div
            part=${refused(d) ? "discovered-details discovered-page-printer" : "discovered-details"}
            data-test=${`discovered-row-${this.#rowKey(d)}`}
          >
            <strong>${this.#discoveredLabel(d)}</strong>
            <div part="printer-meta">
              <div>${transportName(d.transport)}</div>
              ${this.#discoveredAddressLine(d)}
              ${d.agentName ? html`<div>${fill("printers.discovered_seen_on", { agent: d.agentName })}</div>` : nothing}
              ${this.#repointNote(office.get(d))}
              ${lost.has(d) && !listed.has(this.#commandKeyOf(d)) ? html`<div>${t("printers.bluetooth_not_seen")}</div>` : nothing}
            </div>
          </div>`,
      },
      {
        key: "add",
        label: t("printers.actions"),
        cell: (d) => {
          const officeRow = office.get(d);
          if (officeRow) return this.#officeAction(d, officeRow);
          const add = html`<wt-button
            variant="primary"
            data-test=${`register-${this.#rowKey(d)}`}
            ?disabled=${this.submitting}
            @click=${() => {
              if (this.submitting) return;
              this.#namePrinter(d);
            }}
            >${t("action.add")}</wt-button
          >`;
          if (d.transport !== "bluetooth") return add;
          const key = this.#commandKeyOf(d);
          const command = this.commands[key];
          const status = this.#renderCommand(key, command, `discovered-command-${this.#rowKey(d)}`);
          if (lost.has(d)) return html`<div part="bluetooth-actions">${status}</div>`;
          // A succeeded pairing counts as paired before the agent's own paired report arrives, except
          // on a pair-only row, which keeps Pair so a pairing the agent never confirms can be retried.
          const paired = !pairOnly.has(d) && (d.paired === true || key in this.pairedDevices);
          return html`<div part="bluetooth-actions">
            ${
              paired
                ? add
                : html`<wt-button
                    variant="primary"
                    data-test=${`pair-${this.#rowKey(d)}`}
                    ?disabled=${command?.state === "pending"}
                    @click=${() => this.#openPair(d, this.#addressScope?.id)}
                    >${pairOnly.has(d) ? t("printers.bluetooth_pair_only") : t("printers.bluetooth_pair")}</wt-button
                  >`
            }
            ${status}
          </div>`;
        },
      },
    ];
    const bluetooth = rows.some((d) => d.transport === "bluetooth");
    const otherDevices = addable.some((d) => !shown(d));
    const probeChecked = this.#probeFeedback.attempted ? this.#probeValidate() : {};
    const probeErrors = { ...this.probeRefused, ...probeChecked };
    const probeInvalid = Object.keys(probeChecked).length > 0;
    const probeMessage = this.#probeFeedback.message(
      { request: refusal(this.probeErrorKey) ?? undefined },
      new Set(Object.keys(probeErrors)),
      t("form.fix_fields"),
    );
    return html`<wt-modal
      size="wide"
      data-test="new-printer-modal"
      heading=${t("printers.add_printer")}
      .open=${true}
      .beforeClose=${this.#addressScope ? this.#beforeAddPrinterClose : this.#printerNameScope ? this.#beforePrinterNameClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#finishAddPrinter(opening);
      }}
    >
      ${this.addedPrinterName ? html`<p role="status" data-test="printer-added">${fill("printers.added", { name: this.addedPrinterName })}</p>` : nothing}
      ${this.#renderRefreshError()}
      <wt-help-tooltip
        slot="help"
        mode="help-mode"
        aria-label=${fill("help.badge_label", { part: t("printers.add_printer") })}
        guide-href=${guideHref("printers.add-printer")}
        guide-label=${t("help.guide_link")}
        >${t("printers.add_help")}</wt-help-tooltip
      >
      <p class="hint">${t("printers.discovery_hint")}</p>
      ${this.agents.map(({ id, name, active, bluetooth: state = null }) =>
        active && state !== null && state !== "available"
          ? html`<p class="hint" data-test=${`bluetooth-unavailable-${id}`}>
              ${fill("printers.bluetooth_unavailable", {
                agent: name,
                // A code added to the agent after this dashboard was built still reads as a sentence.
                reason: t(
                  BLUETOOTH_UNAVAILABLE_TEXT[state] ?? "printers.bluetooth_unavailable.not_enabled",
                ),
              })}
            </p>`
          : nothing,
      )}
      ${bluetooth ? html`<p class="hint" data-test="bluetooth-note">${t("printers.bluetooth_pair_note")}</p>` : nothing}
      <details class="probe-panel" data-test="probe-panel">
        <summary>${t("printers.probe_title")}</summary>
        <p class="hint">${t("printers.probe_hint")}</p>
        <div
          class="field-row"
          @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=probe-printer]"))}
        >
          <wt-input
            name="printer-probe-address"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            required
            label=${t("printers.probe_host")}
            data-test="probe-host"
            .value=${this.probeHost}
            .invalid=${!!probeErrors.host}
            .error=${probeErrors.host ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (opening !== this.#addPrinterOpening) return;
              this.probeHost = event.detail.value;
              this.#addressScope?.changed();
              const refused = { ...this.probeRefused };
              delete refused.host;
              this.probeRefused = refused;
            }}
          ></wt-input>
          <wt-input
            name="printer-probe-port"
            required
            label=${t("printers.port")}
            data-test="probe-port"
            .value=${this.probePort}
            .invalid=${!!probeErrors.port}
            .error=${probeErrors.port ?? ""}
            ?disabled=${this.probeStatus === "pending"}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              if (opening !== this.#addPrinterOpening) return;
              this.probePort = event.detail.value;
              this.#addressScope?.changed();
              const refused = { ...this.probeRefused };
              delete refused.port;
              this.probeRefused = refused;
            }}
          ></wt-input>
          <wt-form-actions
            data-test="probe-actions"
            class=${probeMessage ? "with-message" : ""}
            .error=${probeMessage}
          >
            <wt-button
              variant="primary"
              data-test="probe-printer"
              ?loading=${this.probeStatus === "pending"}
              ?disabled=${probeInvalid}
              @click=${() => void this.#probe()}
              >${t("printers.probe_action")}</wt-button
            >
          </wt-form-actions>
        </div>
        <p role="status" data-test="probe-status">
          ${
            probe === "idle"
              ? nothing
              : t(
                  (
                    {
                      pending: "printers.probe_waiting",
                      found: "printers.probe_found",
                      missing: "printers.probe_missing",
                      registered: "printers.probe_registered",
                      page_printer: "printers.probe_page_printer",
                    } as const
                  )[probe],
                )
          }
        </p>
      </details>
      <div class="actions scan-actions">
        <wt-button
          data-test="scan-printers"
          ?loading=${this.scanning}
          @click=${() => void this.#scan()}
          >${this.scanning ? t("printers.scan_loading") : t("printers.scan")}</wt-button
        >
        ${
          otherDevices
            ? html`<wt-button
                data-test="show-all-bluetooth"
                @click=${() => {
                  this.showAllBluetooth = !this.showAllBluetooth;
                }}
                >${this.showAllBluetooth ? t("printers.bluetooth_hide_others") : t("printers.bluetooth_show_all")}</wt-button
              >`
            : nothing
        }
      </div>
      ${this.#unreadTable(
        rows.length + lost.size === 0 &&
          (this.discoveredUnread || this.#queries.failing("listDiscoveredPrinters")),
        (errorMessage) =>
          html`<wt-data-table
            noMatchesMessage=${tableNoMatches()}
            data-test="discovered-table"
            aria-label=${t("printers.discovered_title")}
            .columns=${columns}
            .rows=${[...rows, ...lost]}
            .rowKey=${(d: DiscoveredPrinter) => this.#rowKey(d)}
            .emptyMessage=${t(
              addable.length < this.discovered.length
                ? "printers.discovered_all_added"
                : this.scanning
                  ? "printers.scan_empty"
                  : "printers.no_discovered",
            )}
            .errorMessage=${errorMessage}
          ></wt-data-table>`,
      )}
      <wt-form-actions
        slot="footer"
        .error=${this.namingPrinter ? "" : bottomMessage(this.#bluetoothRefusal(this.errorKey))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-new-printer"
          @click=${() => void this.#closeModal("new-printer-modal")}
          >${t("action.close")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(p: { id: string; transport?: string }, opener: HTMLElement, page = false): void {
    this.#deleteIsPage = page;
    this.#deleteIsBluetooth = !page && p.transport === "bluetooth";
    this.#deleteDialog.open(
      p.id,
      opener,
      page ? "getPagePrinterDeleteImpact" : "getPrinterDeleteImpact",
    );
  }

  async #deleteReceiptPrinter(id: string): Promise<void> {
    const printer = this.printers.find((row) => row.id === id);
    const lastAgent = this.agents.find((agent) => agent.id === printer?.lastPrintAgentId);
    const { target, bluetoothUnpair } = await this.api.deletePrinter(id);
    if (!bluetoothUnpair) return;
    this.bluetoothDeleteWarnings = {
      ...this.bluetoothDeleteWarnings,
      [id]: bluetoothUnpair.warnings.map(({ agentName }) => ({
        name: target.name,
        agentName: agentName ?? lastAgent?.name ?? null,
      })),
    };
    for (const { agentId, agentName, command } of bluetoothUnpair.commands)
      this.#trackCommand(agentId, command, { deletedPrinter: { name: target.name, agentName } });
  }

  #renderBluetoothDeleteWarnings(): TemplateResult {
    const warnings = [
      ...Object.values(this.bluetoothDeleteWarnings).flat(),
      ...Object.values(this.commands).flatMap((command) =>
        command.deletedPrinter && isProblem(command) ? [command.deletedPrinter] : [],
      ),
    ];
    return html`<div role="status" aria-atomic="true">
      ${warnings.map(
        ({ name, agentName }) =>
          html`<p class="error" data-test="bluetooth-delete-warning">
            ${
              agentName === null
                ? fill("printers.delete_bluetooth_warning", { printer: name })
                : fill("printers.delete_bluetooth_warning_named", {
                    printer: name,
                    agent: agentName,
                  })
            }
          </p>`,
      )}
    </div>`;
  }

  #requestDetailDelete(p: Printer, opener: HTMLElement): void {
    this.#openDelete(p, opener);
  }

  /**
   * Ends everything still open on a printer that no longer exists — its delete dialog, its Put on
   * every station dialog, its details window and the form in it, its calibration wizard and its
   * label — without asking to keep their drafts, and drops its row. `refuse` says so where something
   * was open on it.
   */
  #printerGone(id: string, refuse: boolean, focusTo?: HTMLElement | null): void {
    const ours = this.#deleteDialog.submitting && this.#deleteDialog.target === id;
    let open = false;
    if (this.#deleteDialog.target === id) {
      open = true;
      this.#deleteDialog.close(focusTo);
    }
    if (this.everyStationId === id) {
      open = true;
      this.#closeEveryStation();
    }
    if (this.editingPrinter?.id === id) {
      open = true;
      this.#disposeCalibrationDraft();
      this.editingPrinter = null;
      this.#closeTest();
    }
    if (this.labelPrinterId === id) {
      open = true;
      this.labelPrinterId = null;
    }
    if (this.selectedPrinterId === id) {
      open = true;
      this.#resetPrinterSections();
      this.selectedPrinterId = null;
      void this.#url.write({ printer: null, editor: null, step: null }, true);
    }
    this.printers = this.printers.filter((p) => p.id !== id);
    this.pagePrinters = this.pagePrinters.filter((p) => p.id !== id);
    if (refuse && open && !ours) this.errorKey = "printer.not_found";
  }

  #renderEquipmentLabel(): TemplateResult | typeof nothing {
    const printer = this.printers.find((p) => p.id === this.labelPrinterId);
    if (printer === undefined) return nothing;
    return html`<dashboard-equipment-label
      .api=${this.api}
      kind="printer"
      .itemId=${printer.id}
      .name=${printer.name}
      .opener=${this.#labelOpener}
      @wt-close=${() => {
        this.labelPrinterId = null;
      }}
    ></dashboard-equipment-label>`;
  }

  /** Each of these dialogs shows the failed read itself, so nothing beneath it repeats it. */
  get #dialogShowsRefreshError(): boolean {
    return (
      this.addingAgent ||
      this.deletingAgent !== null ||
      this.addingPrinter ||
      this.pairAgain !== null ||
      this.editingAgent !== null ||
      this.editingPrinter !== null ||
      this.namingPrinter !== null
    );
  }

  override render(): TemplateResult {
    // Every action inside an open dialog shows its own refusal.
    const dialogOpen = this.#dialogShowsRefreshError || this.selectedPrinterId !== null;
    return html`<h1 class="title">${t("printers.title")}</h1>
      ${this.#renderBluetoothDeleteWarnings()}
      <wt-tabs
        label=${t("printers.title")}
        .value=${this.view}
        .items=${[
          { key: "queue", label: t("printers.jobs_title") },
          { key: "printers", label: t("printers.list_title") },
          { key: "agents", label: t("printers.agents_tab") },
        ]}
        @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
          this.view = event.detail.value;
          this.#url.write({ dashboard: "printers", view: this.view });
        }}
      >
        ${this.#renderTabActions()}
        <div slot="queue">${this.#renderJobsSection()}</div>
        <div slot="printers">${this.#renderPrintersSection()}</div>
        <div slot="agents">${this.#renderAgentsSection()}</div>
      </wt-tabs>
      ${
        dialogOpen
          ? nothing
          : html`${this.#renderTestPageSent()}${this.#renderEveryStationNotice()}${this.#renderReprintSent()}${this.#renderPairedAgain()}${this.errorKey ? html`<p class="error" role="alert">${this.#bluetoothRefusal(this.errorKey)}</p>` : nothing}
            ${this.#renderRefreshError()}`
      }
      ${this.#renderPrinterDetails()}${this.#renderAgentModal()}${this.#renderDeleteAgent()}${this.#renderEditAgent()}${this.#renderNewPrinter()}${this.#renderPrinterName()}${this.#renderPagePrinterAdd()}${this.#renderPairAgain()}${this.#renderPairDialog()}${this.#renderEditPrinter()}${this.#renderAcceptDialog()}${this.#renderEquipmentLabel()}${this.#deleteDialog.render("delete-printer-dialog", printerDeleteCopy(this.#deleteIsPage, this.#deleteIsBluetooth))}${this.#renderEveryStationDialog()}${this.#renderReprint()}
      <dashboard-print-job-preview
        .preview=${this.preview}
        .open=${this.previewOpen}
        @preview-close=${() => {
          this.previewOpen = false;
        }}
      ></dashboard-print-job-preview>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-printers-screen": PrintersScreen;
  }
}

function samePickupRoles(a: Printer["pickupRoles"], b: Printer["pickupRoles"]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
}
