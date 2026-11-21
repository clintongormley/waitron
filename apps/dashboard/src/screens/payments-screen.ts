import type { TenderRefundView, StuckTenderRefundRow } from "../api/tender-refund-types.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  UrlStateController,
  baseStyles,
  pageTitleStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  type DataTableColumn,
  type WtDialog,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import { centsToDecimal, formatMoney, stringToCents } from "@waitron/shared";
import {
  registerCatalogue,
  QueryController,
  tableNoMatches,
  type CardProviderPanel,
  type DashboardRequest,
  t as tRaw,
} from "@waitron/dashboard-kit";
import type {
  AbandonedRefundOutcome,
  AvailableReader,
  BillRecoveryOutcome,
  DashboardApi,
  PaymentProviderRow,
  ReaderHolderRow,
  ReaderRow,
  ReaderStatusView,
  StuckBillPaymentRow,
  StuckBillRefundRow,
  HeldOutcome,
  HeldPaymentRow,
} from "../api/client.js";
import { dashboardPath } from "../navigation.js";
import { CARD_PROVIDERS_FROM_READERS_PATH } from "./modules-screen.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { formatAlertTime, sourceLabel } from "../widgets/alert-format.js";
import "../widgets/equipment-label.js";
import "../widgets/backup-audit.js";
import { holderText } from "../i18n/equipment.js";
import { HardwareDeleteDialog } from "../widgets/hardware-delete-dialog.js";
import { readerDeleteCopy } from "../widgets/reader-delete-copy.js";

export const readerSettingFields = [
  { name: "reader-name", labelKey: "payments.reader_col_name" },
  { name: "prints-own-slip-automatically", labelKey: "payments.prints_own_slip_automatically" },
] as const;

/** The section's own wording for a refused check; any other code reads its shared message. */
function paymentRefusalText(error: unknown): string {
  const code = codeOf(error);
  if (code === "payment.outcome_unknown") {
    const reason = (error as { params?: { reason?: unknown } }).params?.reason;
    if (reason === "unreachable") return t("payments.stuck.unknown_unreachable");
    if (reason === "ambiguous") return t("payments.stuck.unknown_ambiguous");
  }
  if (code === "reader.provider_disconnected") return t("payments.stuck.provider_disconnected");
  if (code === "server.internal") return t("payments.partial.failed");
  return codeMessage(code);
}

type BillTarget =
  | { kind: "payment"; row: StuckBillPaymentRow }
  | { kind: "refund"; row: StuckBillRefundRow }
  | { kind: "tender"; row: StuckTenderRefundRow };

type BillDraft = { outcome: string; note: string; pin: string };

type ReaderStatusKey =
  | "online"
  | "offline"
  | "processing"
  | "unknown"
  | "timed_out"
  | "loading"
  | "unavailable"
  | "unpaired";

const READER_STATUS_FILTER: readonly ReaderStatusKey[] = [
  "online",
  "offline",
  "processing",
  "unknown",
  "timed_out",
  "unavailable",
  "unpaired",
];

function readerStatusLabel(key: ReaderStatusKey): string {
  switch (key) {
    case "online":
      return t("payments.reader_status_online");
    case "offline":
      return t("payments.reader_status_offline");
    case "processing":
      return t("payments.reader_pairing_processing");
    case "unknown":
      return t("payments.reader_status_unknown");
    case "timed_out":
      return codeMessage("connection.timed_out");
    case "loading":
      return t("payments.reader_status_loading");
    case "unavailable":
      return t("payments.reader_unavailable");
    case "unpaired":
      return t("payments.reader_unpaired");
  }
}
type HeldField = "outcome" | "note" | "pin";

function billAmount(target: BillTarget): string {
  return target.kind === "payment"
    ? centsToDecimal(stringToCents(target.row.applied) + stringToCents(target.row.tip))
    : centsToDecimal(stringToCents(target.row.appliedAmount) + stringToCents(target.row.tipAmount));
}

function billRefusalText(error: unknown): string {
  const code = codeOf(error);
  const reason = (error as { params?: { reason?: unknown } }).params?.reason;
  if (code === "bill.payment_outcome_unconfirmed") {
    if (reason === "attempting") return t("payments.bill.payment_attempting");
    if (reason === "unreachable") return t("payments.bill.payment_unreachable");
    if (reason === "ambiguous") return t("payments.bill.payment_ambiguous");
  }
  if (code === "bill.refund_outcome_unconfirmed") {
    if (reason === "pending") return t("payments.bill.refund_pending");
    if (reason === "not_found") return t("payments.bill.refund_not_found");
    if (reason === "ambiguous") return t("payments.bill.refund_ambiguous");
    if (reason === "unreachable") return t("payments.bill.refund_unreachable");
  }
  return codeMessage(code);
}

// Two status reads can wait on the card provider; keep other browser connections
// available, including in browsers without Web Locks.
let statusSlotsFree = 2;
let nextStatusQueryKey = 0;
const statusSlotWaiters: (() => void)[] = [];

async function takeLocalStatusSlot(): Promise<void> {
  if (statusSlotsFree > 0) {
    statusSlotsFree--;
    return;
  }
  await new Promise<void>((resolve) => statusSlotWaiters.push(resolve));
}

function releaseLocalStatusSlot(): void {
  const next = statusSlotWaiters.shift();
  if (next) next();
  else statusSlotsFree++;
}

// Each lock is one place. A document that closes releases its held Web Lock even if its read hangs.
async function takeStatusSlot(): Promise<() => void> {
  await takeLocalStatusSlot();
  if (!navigator.locks) return releaseLocalStatusSlot;

  try {
    const releaseWebSlot = await new Promise<() => void>((resolve, reject) => {
      const controllers = [new AbortController(), new AbortController()];
      let acquired = false;
      controllers.forEach((controller, index) => {
        void navigator.locks
          .request(`waitron.reader-status.${index}`, { signal: controller.signal }, async () => {
            if (acquired) return;
            acquired = true;
            for (const other of controllers) if (other !== controller) other.abort();
            await new Promise<void>((release) => resolve(release));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted || acquired) return;
            acquired = true;
            for (const other of controllers) if (other !== controller) other.abort();
            reject(error);
          });
      });
    });
    return () => {
      releaseWebSlot();
      releaseLocalStatusSlot();
    };
  } catch {
    return releaseLocalStatusSlot;
  }
}

/** Provider forms come through CARD_PROVIDER_PANELS; this screen never imports a provider package. */
@customElement("dashboard-payments-screen")
export class PaymentsScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin-top: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      h2 {
        font-size: var(--wt-font-size-md);
      }
      .banner {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .panel-slot {
        margin-top: var(--wt-space-3);
      }
      .reader-tools,
      .discovery-row {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .discovery-reader {
        flex: 1;
        min-width: var(--wt-row-field-min-width);
      }
      .added {
        color: var(--wt-color-text-muted);
      }
      .reader-details {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-2) var(--wt-space-4);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .stuck-section {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
        margin-bottom: var(--wt-space-6);
      }
      .stuck-section.pending {
        border-color: var(--wt-color-danger);
      }
      .stuck-section h2 {
        margin-top: 0;
      }
      .stuck-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .stuck {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .stuck-body {
        flex: 1 1 calc(var(--wt-tap-min) * 6);
      }
      .stuck-order {
        font-weight: var(--wt-font-weight-bold);
        margin: 0 0 var(--wt-space-2);
      }
      .held-amounts {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .stuck-details {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-1) var(--wt-space-3);
        margin: 0;
      }
      .stuck-details dt {
        color: var(--wt-color-text-muted);
      }
      .bill-outcome {
        margin-block: var(--wt-space-3);
      }
      .held-dialog-amounts {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--wt-space-1) var(--wt-space-3);
        margin: 0;
      }
      .held-dialog-amounts dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        text-align: end;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  /** A provider panel builds its own typed client on this. */
  @property({ attribute: false }) request!: DashboardRequest;

  @property({ attribute: false }) simulatedCardPayments?: boolean;

  @property({ attribute: false }) surface: "readers" | "checks" = "readers";

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  @state() private providers?: PaymentProviderRow[];
  @state() private readers?: ReaderRow[];
  @state() private holders = new Map<string, ReaderHolderRow>();
  /** The reader whose equipment label is open. */
  @state() private labelReader: ReaderRow | null = null;
  #labelOpener: HTMLElement | null = null;
  @state() private statuses = new Map<
    string,
    ReaderStatusView | "error" | "connection.timed_out"
  >();
  @state() private choosingProvider = false;
  @state() private addingId: string | null = null;
  @state() private discoveringId: string | null = null;
  @state() private available?: AvailableReader[];
  @state() private listingFailed = false;
  @state() private drafts: Record<string, string> = {};
  /** Discovered readers whose Add has been pressed; their names are checked from then on. */
  @state() private attemptedNames = new Set<string>();
  @state() private editor: {
    reader: ReaderRow;
    mode: "edit" | "details" | "unpair";
  } | null = null;
  @state() private editName = "";
  @state() private editOwnSlip = false;
  @state() private editAttempted = false;
  @state() private dialogError: string | null = null;
  @state() private busy = false;
  @state() private refreshing = false;
  #linkedReader: string | null = null;
  #addressReader: string | null = null;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.surface !== "readers" || this.#url.read("dashboard") !== "payments") return;
      const id = this.#url.read("reader");
      if (id === this.#addressReader) return;
      const previous = this.#addressReader;
      this.#linkedReader = this.#addressReader = id;
      if (id === null) {
        if (previous !== null) void this.#closeEditor(false);
      } else this.#openLinkedReader();
    },
    dashboardPath,
  );

  #clearReaderAddress(): void {
    this.#linkedReader = this.#addressReader = null;
    if (this.surface === "readers" && this.#url.read("dashboard") === "payments")
      void this.#url.write({ reader: null }, true);
  }

  #openLinkedReader(): void {
    const id = this.#linkedReader;
    if (
      this.surface !== "readers" ||
      id === null ||
      this.readers === undefined ||
      this.busy ||
      this.#listQueries.failing("listReaders")
    )
      return;
    this.#linkedReader = null;
    const reader = this.readers.find((row) => row.id === id);
    if (!reader) this.#clearReaderAddress();
    else if (this.editor?.reader.id !== id || this.editor.mode !== "edit")
      this.#openEditor(reader, "edit");
  }

  override updated(): void {
    this.#openLinkedReader();
  }

  #opener?: HTMLElement;
  #discoveryVersion = 0;
  #statusVersion = 0;
  #statusPasses = 0;
  #statusCompletedAt = -Infinity;
  readonly #statusQueryKey = `reader-status:${++nextStatusQueryKey}`;
  readonly #statusQueries = new QueryController(
    this,
    () => this.api.liveData,
    () => {},
  );
  #pairSucceeded = false;
  #statusesDue = true;
  #statusIds: string | undefined;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a list read's failure, the only message the read's recovery may clear. */
  #readErrorShown = false;
  @state() private retainingPartial = false;
  @state() private confirmingPartial: StuckBillPaymentRow | null = null;
  @state() private billPayments: StuckBillPaymentRow[] = [];
  @state() private billRefunds: StuckBillRefundRow[] = [];
  @state() private tenderRefunds: StuckTenderRefundRow[] = [];
  @state() private tenderRefundLoadError: string | null = null;
  #tenderRefundRead = 0;
  @state() private billPaymentLoadError: string | null = null;
  @state() private billRefundLoadError: string | null = null;
  @state() private heldPayments: HeldPaymentRow[] = [];
  @state() private heldLoadError: string | null = null;
  #heldRead = 0;
  @state() private billResult: { text: string; refused: boolean } | null = null;
  @state() private billAction: { target: BillTarget; mode: "check" | "attest" } | null = null;
  @state() private billBusy = false;
  @state() private billOutcome = "";
  @state() private billNote = "";
  @state() private billPin = "";
  @state() private billAttempted = false;
  @state() private billFormError: string | null = null;
  @state() private billFormErrorText: string | null = null;
  @state() private heldAction: HeldPaymentRow | null = null;
  @state() private heldOutcome = "";
  @state() private heldNote = "";
  @state() private heldPin = "";
  @state() private heldAttempted = false;
  @state() private heldRefusal: { code: string; text: string; field: HeldField | null } | null =
    null;
  readonly #deleteDialog = new HardwareDeleteDialog(this, () => this.api, {
    notFound: ["reader.not_found"],
    // The impact does not follow the provider connection live, so read it again before retrying.
    retryCode: "reader.provider_disconnected",
    send: (id, impact) =>
      impact?.ends.some(({ key }) => key === "provider_registration_kept")
        ? this.api.deleteReader(id, { acceptRegistrationKept: true })
        : this.api.deleteReader(id),
    onGone: (id, source) => {
      this.#readerGone(id, true);
      if (source === "send") return this.#load();
    },
    onDeleted: (id) => {
      this.#readerGone(id, false);
      return this.#load();
    },
  });
  readonly #listQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
    },
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );
  readonly #billPaymentQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.billPaymentLoadError = codeOf(error);
    },
  );
  readonly #billRefundQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.billRefundLoadError = codeOf(error);
    },
  );

  @state() private abandonedRefunds: AbandonedRefundOutcome[] = [];
  @state() private abandonedRefundError = "";
  readonly #abandonedQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.abandonedRefundError = codeOf(error);
    },
  );

  readonly #heldQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.heldLoadError = codeOf(error);
    },
  );

  readonly #tenderRefundQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.tenderRefundLoadError = codeOf(error);
    },
  );

  #billLeave?: LeaveCoordinator;
  #billScope?: DraftScope<BillDraft>;
  #billOperation?: object;
  readonly #beforeBillClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#billLeave ||
    !this.#billScope ||
    (await this.#billLeave.request({ scopes: [this.#billScope.id], reason, proceed() {} })) ===
      "proceeded";

  #billDraft(): BillDraft {
    return { outcome: this.billOutcome, note: this.billNote.trim(), pin: this.billPin };
  }

  #closeBillAction(): void {
    this.#billScope?.dispose();
    this.#billScope = undefined;
    this.billAction = null;
    this.billOutcome = "";
    this.billNote = "";
    this.billPin = "";
  }

  async #requestBillClose(): Promise<void> {
    const action = this.billAction;
    if (
      await this.renderRoot
        .querySelector<WtDialog>("[data-test=bill-attest-dialog]")
        ?.requestClose("cancel")
    ) {
      if (this.billAction === action) this.#closeBillAction();
    }
  }

  #heldLeave?: LeaveCoordinator;
  #heldScope?: DraftScope<BillDraft>;
  readonly #beforeHeldClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#heldLeave ||
    !this.#heldScope ||
    (await this.#heldLeave.request({ scopes: [this.#heldScope.id], reason, proceed() {} })) ===
      "proceeded";

  #heldDraft(): BillDraft {
    return { outcome: this.heldOutcome, note: this.heldNote.trim(), pin: this.heldPin };
  }

  #closeHeldAction(): void {
    this.#heldScope?.dispose();
    this.#heldScope = undefined;
    this.heldAction = null;
    this.heldOutcome = "";
    this.heldNote = "";
    this.heldPin = "";
  }

  async #requestHeldClose(): Promise<void> {
    const action = this.heldAction;
    if (
      await this.renderRoot
        .querySelector<WtDialog>("[data-test=held-outcome-dialog]")
        ?.requestClose("cancel")
    ) {
      if (this.heldAction === action) this.#closeHeldAction();
    }
  }

  #readerLeave?: LeaveCoordinator;
  #editScope?: DraftScope<{ name: string; printsOwnSlipAutomatically: boolean }>;
  readonly #discoveryScopes = new Map<string, DraftScope<string>>();
  #readerOperation?: object;
  readonly #beforeEditorClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#readerLeave ||
    !this.#editScope ||
    (await this.#readerLeave.request({ scopes: [this.#editScope.id], reason, proceed() {} })) ===
      "proceeded";
  readonly #beforeDiscoveryClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#readerLeave ||
    (await this.#readerLeave.request({
      scopes: [...this.#discoveryScopes.values()].map((scope) => scope.id),
      reason,
      proceed() {},
    })) === "proceeded";

  #disposeDiscoveryDrafts(): void {
    for (const scope of this.#discoveryScopes.values()) scope.dispose();
    this.#discoveryScopes.clear();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // So each panel's `displayNameKey` resolves even before its module has registered its strings.
    for (const panel of this.panels) registerCatalogue(panel.strings);
    this.#showError(null);
    if (this.surface === "readers") {
      void this.#load();
      return;
    }
    void this.#billPaymentQuery
      .watch("listStuckBillPayments", [], (rows) => {
        this.billPayments = rows;
        this.billPaymentLoadError = null;
      })
      .catch(() => undefined);
    void this.#tenderRefundQuery
      .watch("listStuckTenderRefunds", [], (rows) => {
        this.#tenderRefundRead++;
        this.tenderRefunds = rows;
        this.tenderRefundLoadError = null;
      })
      .catch(() => undefined);
    void this.#billRefundQuery
      .watch("listStuckBillRefunds", [], (rows) => {
        this.billRefunds = rows;
        this.billRefundLoadError = null;
      })
      .catch(() => undefined);
    void this.#abandonedQuery
      .watch(
        "listAbandonedRefunds",
        [],
        (rows) => {
          this.abandonedRefunds = rows;
          this.abandonedRefundError = "";
        },
        { passive: true },
      )
      .catch(() => undefined);
    void this.#heldQuery
      .watch("listHeldPayments", [], (rows) => {
        this.#heldRead++;
        this.heldPayments = rows;
        this.heldLoadError = null;
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#linkedReader = this.#addressReader = null;
    this.#tenderRefundRead++;
    this.#heldRead++;
    this.#deleteDialog.close();
    this.#statusVersion++;
    this.#billOperation = undefined;
    this.renderRoot
      .querySelector<WtDialog>("[data-test=bill-attest-dialog]")
      ?.closeAfter("security");
    this.#closeBillAction();
    this.renderRoot
      .querySelector<WtDialog>("[data-test=held-outcome-dialog]")
      ?.closeAfter("security");
    this.#closeHeldAction();
    this.billBusy = false;
    this.#readerOperation = undefined;
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.#disposeDiscoveryDrafts();
    this.#discoveryVersion++;
    this.editor = null;
    this.discoveringId = null;
    this.busy = false;
  }

  #panelFor(providerId: string): CardProviderPanel | undefined {
    return this.panels.find((p) => p.providerId === providerId);
  }

  #providerName(providerId: string): string {
    const key = this.#panelFor(providerId)?.displayNameKey;
    return key ? tRaw(key) : providerId;
  }

  async #load(): Promise<void> {
    if (this.#readErrorShown) this.#showError(null);
    this.#statusesDue = true;
    // After this load's first readers read fails, only an automatic retry can succeed in its place.
    let attended = true;
    await Promise.allSettled([
      this.#listQueries.watch("listPaymentProviders", [], (providers) => {
        this.providers = providers;
      }),
      this.#listQueries.watch("listReaderHolders", [], (rows) => {
        this.holders = new Map(rows.map((row) => [row.readerId, row]));
      }),
      this.#listQueries
        .watch("listReaders", [], (readers) => {
          const listed = new Set(readers.map(({ id }) => id));
          const gone = (this.readers ?? []).filter(({ id }) => !listed.has(id));
          this.readers = readers;
          for (const { id } of gone) this.#readerGone(id, true);
          const ids = JSON.stringify(
            readers
              .filter((r) => r.active)
              .map((r) => r.id)
              .sort(),
          );
          const due = this.#statusesDue;
          if (!due && ids === this.#statusIds) return;
          if (due) this.statuses = new Map();
          this.#statusesDue = false;
          this.#statusIds = ids;
          void this.#loadStatuses(readers, !due || !attended);
          if (!readers.some((r) => r.active)) this.#statusQueries.release("statuses");
          else
            void this.#statusQueries
              .watch(
                "statuses",
                {
                  key: this.#statusQueryKey,
                  dependencies: [],
                  refreshMs: 60_000,
                  quietWhileConnected: false,
                  read: async () => {
                    // Reconnects refresh all queries too; only a completed pass starts the cooldown.
                    if (this.#statusPasses || Date.now() - this.#statusCompletedAt < 60_000) return;
                    await this.#loadStatuses(this.readers ?? [], true);
                  },
                },
                () => {},
              )
              .catch(() => undefined);
        })
        .catch(() => {
          attended = false;
        }),
    ]);
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** One reader's failed status marks only that row, never the whole screen. */
  async #loadStatuses(readers: ReaderRow[], background = false): Promise<void> {
    // An action that finishes after the screen closed still reloads it, and its slots are shared.
    if (!this.isConnected) return;
    const client = background ? (this.api.background ?? this.api) : this.api;
    const version = ++this.#statusVersion;
    this.#statusPasses++;
    this.refreshing = true;
    await Promise.all(
      readers
        .filter((r) => r.active)
        .map(async (reader) => {
          const releaseStatusSlot = await takeStatusSlot();
          try {
            if (version !== this.#statusVersion) return;
            const status = await client.readerStatus(reader.id);
            if (version === this.#statusVersion)
              this.statuses = new Map(this.statuses).set(reader.id, status);
          } catch (error) {
            if (version === this.#statusVersion)
              this.statuses = new Map(this.statuses).set(
                reader.id,
                codeOf(error) === "connection.timed_out" ? "connection.timed_out" : "error",
              );
          } finally {
            releaseStatusSlot();
          }
        }),
    );
    this.#statusCompletedAt = Date.now();
    if (--this.#statusPasses === 0) this.refreshing = false;
  }

  async #onAddReader(providerId: string): Promise<void> {
    this.#disposeDiscoveryDrafts();
    this.#readerOperation = undefined;
    this.busy = false;
    this.#readerLeave = leaveCoordinatorFor(this);
    this.discoveringId = providerId;
    this.addingId = null;
    this.available = undefined;
    this.listingFailed = false;
    this.attemptedNames = new Set();
    this.dialogError = null;
    const version = ++this.#discoveryVersion;
    try {
      const readers = await this.api.availableReaders(providerId);
      if (version !== this.#discoveryVersion) return;
      this.available = readers;
      this.drafts = Object.fromEntries(readers.map((reader) => [reader.providerRef, reader.name]));
      for (const reader of readers) {
        if (reader.status === "added") continue;
        const ref = reader.providerRef;
        const scope = this.#readerLeave?.register({
          id: {},
          current: () => (this.drafts[ref] ?? "").trim(),
          snapshot: (value) => value,
          equal: (a, b) => a === b,
          restore: () => {},
        });
        if (scope) this.#discoveryScopes.set(ref, scope);
      }
    } catch {
      if (version === this.#discoveryVersion) this.listingFailed = true;
    }
  }

  async #requestDiscoveryClose(): Promise<void> {
    const version = this.#discoveryVersion;
    if (
      await this.renderRoot
        .querySelector<WtDialog>("[data-test=reader-discovery]")
        ?.requestClose("cancel")
    ) {
      if (version === this.#discoveryVersion) this.#closeDiscovery();
    }
  }

  #closeDiscovery(): void {
    this.#disposeDiscoveryDrafts();
    this.renderRoot.querySelector<WtDialog>("[data-test=reader-discovery]")?.closeAfter("security");
    this.#discoveryVersion++;
    this.discoveringId = null;
  }

  async #pairNew(): Promise<void> {
    const id = this.discoveringId;
    const version = this.#discoveryVersion;
    if (
      !id ||
      !(await this.renderRoot
        .querySelector<WtDialog>("[data-test=reader-discovery]")
        ?.requestClose("navigation"))
    )
      return;
    if (!this.isConnected) return;
    if (this.discoveringId === id && this.#discoveryVersion === version) this.#closeDiscovery();
    await this.updateComplete;
    if (!this.isConnected || this.discoveringId !== null || this.#discoveryVersion !== version + 1)
      return;
    this.#pairSucceeded = false;
    this.addingId = id;
  }

  #nameInvalid(providerRef: string): boolean {
    return this.attemptedNames.has(providerRef) && !(this.drafts[providerRef] ?? "").trim();
  }

  async #adopt(reader: AvailableReader): Promise<void> {
    if (this.busy) return;
    const name = (this.drafts[reader.providerRef] ?? "").trim();
    this.attemptedNames = new Set(this.attemptedNames).add(reader.providerRef);
    this.dialogError = null;
    if (!name) {
      this.#focusFirstInvalid("[data-test=reader-discovery]");
      return;
    }
    const version = this.#discoveryVersion;
    const scope = this.#discoveryScopes.get(reader.providerRef);
    const operation = {};
    this.#readerOperation = operation;
    this.busy = true;
    try {
      await this.api.adoptReader({
        providerId: this.discoveringId!,
        providerRef: reader.providerRef,
        name,
      });
      if (!this.isConnected || version !== this.#discoveryVersion) return;
      scope?.commit(name);
      if (![...this.#discoveryScopes.values()].some((draft) => draft.isDirty()))
        this.#closeDiscovery();
      else if (!scope?.isDirty())
        this.available = this.available?.map((row) =>
          row.providerRef === reader.providerRef ? { ...row, name, status: "added" } : row,
        );
      await this.#load();
    } catch (error) {
      if (this.isConnected && version === this.#discoveryVersion) this.dialogError = codeOf(error);
    } finally {
      if (this.#readerOperation === operation) {
        this.#readerOperation = undefined;
        this.busy = false;
      }
    }
  }

  #openEditor(reader: ReaderRow, mode: "edit" | "details" | "unpair", event?: Event): void {
    const menu = (event?.currentTarget as HTMLElement | undefined)?.closest("wt-row-actions");
    this.#opener =
      menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ??
      this.renderRoot.querySelector<HTMLElement>("h1") ??
      undefined;
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.#readerOperation = undefined;
    this.busy = false;
    this.editor = { reader, mode };
    this.editName = reader.name;
    this.editOwnSlip = reader.printsOwnSlipAutomatically;
    if (mode === "edit") {
      const { coordinator, scope } = draftScopeFor(this, {
        id: {},
        current: () => ({
          name: this.editName.trim(),
          printsOwnSlipAutomatically: this.editOwnSlip,
        }),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          a.name === b.name && a.printsOwnSlipAutomatically === b.printsOwnSlipAutomatically,
        restore: () => {},
      });
      this.#readerLeave = coordinator;
      this.#editScope = scope;
    } else this.#readerLeave = leaveCoordinatorFor(this);
    this.editAttempted = false;
    this.dialogError = null;
  }

  async #requestEditorClose(): Promise<void> {
    const editor = this.editor;
    if (
      await this.renderRoot
        .querySelector<WtDialog>("[data-test=reader-editor]")
        ?.requestClose(editor?.mode === "details" ? "navigation" : "cancel")
    ) {
      if (this.editor === editor) await this.#closeEditor();
    }
  }

  async #closeEditor(clearAddress = true): Promise<void> {
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.editor = null;
    if (clearAddress && this.#addressReader !== null) this.#clearReaderAddress();
    await this.updateComplete;
    if (this.#opener?.isConnected) this.#opener.focus();
  }

  async #saveEditor(): Promise<void> {
    if (this.busy || this.editor === null) return;
    const editor = this.editor;
    const scope = this.#editScope;
    const { reader, mode } = editor;
    const name = this.editName.trim();
    const input = { name, printsOwnSlipAutomatically: this.editOwnSlip };
    if (mode === "edit" && saveActionState(scope).unchanged) return;
    this.dialogError = null;
    if (mode === "edit") this.editAttempted = true;
    if (mode === "edit" && !name) {
      this.#focusFirstInvalid("[data-test=reader-editor]");
      return;
    }
    const operation = {};
    this.#readerOperation = operation;
    this.busy = true;
    try {
      if (mode === "edit") await this.api.saveReader(reader.id, input);
      else await this.api.unpairReader(reader.id);
      if (!this.isConnected || this.editor !== editor) {
        if (this.isConnected && mode !== "edit") await this.#load();
        return;
      }
      scope?.commit(input);
      if (!scope?.isDirty()) {
        this.renderRoot.querySelector<WtDialog>("[data-test=reader-editor]")?.closeAfter("saved");
        await this.#closeEditor();
      }
      await this.#load();
    } catch (error) {
      if (this.isConnected && this.editor === editor) this.dialogError = codeOf(error);
    } finally {
      if (this.#readerOperation === operation) {
        this.#readerOperation = undefined;
        this.busy = false;
      }
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────

  #openDelete(reader: ReaderRow, event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    this.#deleteDialog.open(
      reader.id,
      menu.shadowRoot!.querySelector<HTMLButtonElement>("button"),
      "getReaderDeleteImpact",
    );
  }

  /**
   * Ends everything still open on a reader that no longer exists — its delete dialog, its editor
   * and its label — without asking to keep a draft, and drops its row. `refuse` says so where
   * something was open on it.
   */
  #readerGone(id: string, refuse: boolean): void {
    const ours = this.#deleteDialog.submitting && this.#deleteDialog.target === id;
    let open = false;
    if (this.#deleteDialog.target === id) {
      open = true;
      // Refresh can be disabled while status reads are pending.
      this.#deleteDialog.close(this.renderRoot.querySelector<HTMLElement>("h1"));
    }
    if (this.editor?.reader.id === id) {
      open = true;
      this.#editScope?.dispose();
      this.#editScope = undefined;
      this.#readerOperation = undefined;
      this.busy = false;
      this.editor = null;
    }
    if (this.labelReader?.id === id) {
      open = true;
      this.labelReader = null;
    }
    if (this.#addressReader === id) this.#clearReaderAddress();
    this.readers = this.readers?.filter((reader) => reader.id !== id);
    if (refuse && open && !ours) this.#showError("reader.not_found");
  }

  #billOrder(row: StuckBillPaymentRow | StuckBillRefundRow | StuckTenderRefundRow): string {
    if ("saleId" in row) return fill("payments.tender.sale", { id: row.invoiceNumber });
    const order = t("payments.stuck.order").replace("{number}", String(row.orderNumber));
    return row.label ? `${order} · ${row.label}` : order;
  }

  async #loadBillRecovery(background: boolean): Promise<void> {
    const tenderRead = ++this.#tenderRefundRead;
    const heldRead = ++this.#heldRead;
    const client = background ? (this.api.background ?? this.api) : this.api;
    const [payments, refunds, tenders, held] = await Promise.allSettled([
      client.listStuckBillPayments(),
      client.listStuckBillRefunds(),
      client.listStuckTenderRefunds(),
      client.listHeldPayments(),
    ]);
    if (payments.status === "fulfilled") {
      this.billPayments = payments.value;
      this.billPaymentLoadError = null;
    } else this.billPaymentLoadError = codeOf(payments.reason);
    if (refunds.status === "fulfilled") {
      this.billRefunds = refunds.value;
      this.billRefundLoadError = null;
    } else this.billRefundLoadError = codeOf(refunds.reason);
    if (heldRead === this.#heldRead && this.isConnected) {
      if (held.status === "fulfilled") {
        this.heldPayments = held.value;
        this.heldLoadError = null;
      } else this.heldLoadError = codeOf(held.reason);
    }
    if (tenderRead === this.#tenderRefundRead && this.isConnected) {
      if (tenders.status === "fulfilled") {
        this.tenderRefunds = tenders.value;
        this.tenderRefundLoadError = null;
      } else this.tenderRefundLoadError = codeOf(tenders.reason);
    }
  }

  #openBillAction(target: BillTarget, mode: "check" | "attest"): void {
    if (this.billBusy) return;
    this.#closeBillAction();
    this.billAction = { target, mode };
    this.billOutcome = "";
    this.billNote = "";
    this.billPin = "";
    this.billAttempted = false;
    this.billFormError = null;
    this.billFormErrorText = null;
    if (mode === "attest") {
      const { coordinator, scope } = draftScopeFor(this, {
        id: {},
        current: () => this.#billDraft(),
        snapshot: (value: BillDraft) => ({ ...value }),
        equal: (a, b) => a.outcome === b.outcome && a.note === b.note && a.pin === b.pin,
        restore: () => {},
      });
      this.#billLeave = coordinator;
      this.#billScope = scope;
    } else this.#billLeave = leaveCoordinatorFor(this);
  }

  #billOutcomeText(
    answer: BillRecoveryOutcome | { outcome: TenderRefundView["state"] },
    kind: BillTarget["kind"],
  ): string | null {
    if (kind === "tender" && (answer.outcome === "completed" || answer.outcome === "failed"))
      return t(
        answer.outcome === "completed" ? "payments.tender.completed" : "payments.tender.failed",
      );
    switch (answer.outcome) {
      case "received":
        return t("payments.bill.received");
      case "not_charged":
        return t("payments.bill.not_charged");
      case "completed":
        return t("payments.bill.completed");
      case "failed":
        return t("payments.bill.failed");
      default:
        return null;
    }
  }

  async #checkBill(): Promise<void> {
    const action = this.billAction;
    if (action === null || this.billBusy) return;
    this.billAction = null;
    this.billBusy = true;
    this.billResult = null;
    const target = action.target;
    const operation = (this.#billOperation = {});
    const current = () => this.isConnected && this.#billOperation === operation;
    try {
      const answer =
        target.kind === "payment"
          ? await this.api.resolveStuckBillPayment(target.row.billPaymentId)
          : target.kind === "refund"
            ? await this.api.resolveStuckBillRefund(target.row.refundId)
            : await this.api.resolveStuckTenderRefund(target.row.id);
      if (!current()) return;
      const message = this.#billOutcomeText(answer, target.kind);
      this.billResult = {
        text: `${this.#billOrder(target.row)}: ${message ?? t("payments.bill.check_failed")}`,
        refused: message === null,
      };
    } catch (error) {
      if (!current()) return;
      this.billResult = {
        text: `${this.#billOrder(target.row)}: ${billRefusalText(error)}`,
        refused: true,
      };
    }
    try {
      await this.#loadBillRecovery(true);
    } finally {
      if (current()) {
        this.#billOperation = undefined;
        this.billBusy = false;
      }
    }
  }

  async #attestBill(): Promise<void> {
    const action = this.billAction;
    if (action === null || action.mode !== "attest" || this.billBusy) return;
    const outcome = this.billOutcome;
    const note = this.billNote.trim();
    const pin = this.billPin;
    const scope = this.#billScope;
    if (saveActionState(scope).unchanged) return;
    const operation = {};
    this.billAttempted = true;
    this.billFormError = null;
    this.billFormErrorText = null;
    if (!outcome || !note || !pin) {
      this.#focusFirstInvalid("[data-test=bill-attest-dialog]");
      return;
    }
    this.#billOperation = operation;
    this.billBusy = true;
    try {
      const target = action.target;
      const answer =
        target.kind === "payment"
          ? await this.api.attestStuckBillPayment(target.row.billPaymentId, {
              outcome: outcome as "received" | "failed",
              note,
              pin,
            })
          : target.kind === "refund"
            ? await this.api.attestStuckBillRefund(target.row.refundId, {
                outcome: outcome as "completed" | "failed",
                note,
                pin,
              })
            : await this.api.attestStuckTenderRefund(target.row.id, {
                outcome: outcome as "completed" | "failed",
                note,
                pin,
              });
      if (!this.isConnected || this.billAction !== action) return;
      scope?.commit({ outcome, note, pin });
      const message = this.#billOutcomeText(answer, target.kind);
      this.billResult = {
        text: `${this.#billOrder(target.row)}: ${message ?? t("payments.bill.check_failed")}`,
        refused: message === null,
      };
      if (!scope?.isDirty()) {
        this.renderRoot
          .querySelector<WtDialog>("[data-test=bill-attest-dialog]")
          ?.closeAfter("saved");
        this.#closeBillAction();
      }
      await this.#loadBillRecovery(true);
    } catch (error) {
      if (!this.isConnected || this.billAction !== action) return;
      const code = codeOf(error);
      if (
        code === "tender.refund_not_stuck" ||
        code === "tender.refund_not_found" ||
        code === "bill.payment_not_stuck" ||
        code === "bill.refund_not_stuck" ||
        code === "bill.payment_not_found" ||
        code === "bill.refund_not_found"
      ) {
        this.renderRoot
          .querySelector<WtDialog>("[data-test=bill-attest-dialog]")
          ?.closeAfter("security");
        this.#closeBillAction();
        this.billResult = {
          text: `${this.#billOrder(action.target.row)}: ${billRefusalText(error)}`,
          refused: true,
        };
        await this.#loadBillRecovery(true);
      } else {
        this.billFormError = code;
        this.billFormErrorText = billRefusalText(error);
      }
    } finally {
      if (this.#billOperation === operation) {
        this.#billOperation = undefined;
        this.billBusy = false;
      }
    }
    if (this.#billPinRefused()) this.#focusFirstInvalid("[data-test=bill-attest-dialog]");
  }

  #openHeldAction(row: HeldPaymentRow): void {
    if (this.billBusy) return;
    this.#closeHeldAction();
    this.heldAction = row;
    this.heldAttempted = false;
    this.heldRefusal = null;
    const { coordinator, scope } = draftScopeFor(this, {
      id: {},
      current: () => this.#heldDraft(),
      snapshot: (value: BillDraft) => ({ ...value }),
      equal: (a, b) => a.outcome === b.outcome && a.note === b.note && a.pin === b.pin,
      restore: () => {},
    });
    this.#heldLeave = coordinator;
    this.#heldScope = scope;
  }

  async #recordHeld(): Promise<void> {
    const row = this.heldAction;
    if (row === null || this.billBusy) return;
    const scope = this.#heldScope;
    if (saveActionState(scope).unchanged) return;
    const outcome = this.heldOutcome;
    const note = this.heldNote.trim();
    const pin = this.heldPin;
    this.heldAttempted = true;
    this.heldRefusal = null;
    if (!outcome || !pin) {
      this.#focusFirstInvalid("[data-test=held-outcome-dialog]");
      return;
    }
    const operation = {};
    this.#billOperation = operation;
    this.billBusy = true;
    const order = this.#heldOrder(row);
    try {
      await this.api.recordHeldOutcome(row.paymentId, {
        outcome: outcome as HeldOutcome,
        ...(note ? { note } : {}),
        pin,
      });
      if (!this.isConnected || this.heldAction !== row) return;
      scope?.commit({ outcome, note, pin });
      this.billResult = { text: `${order}: ${t("payments.held.recorded")}`, refused: false };
      if (!scope?.isDirty()) {
        this.renderRoot
          .querySelector<WtDialog>("[data-test=held-outcome-dialog]")
          ?.closeAfter("saved");
        this.#closeHeldAction();
      }
      await this.#loadBillRecovery(true);
    } catch (error) {
      if (!this.isConnected || this.heldAction !== row) return;
      const code = codeOf(error);
      if (code === "payment.hold_not_found" || code === "payment.hold_already_recorded") {
        this.renderRoot
          .querySelector<WtDialog>("[data-test=held-outcome-dialog]")
          ?.closeAfter("security");
        this.#closeHeldAction();
        this.billResult = { text: `${order}: ${codeMessage(code)}`, refused: true };
        await this.#loadBillRecovery(true);
      } else {
        const named = (error as { params?: { field?: unknown } } | null)?.params?.field;
        const field: HeldField | null =
          code === "pin.invalid" || code === "pin.throttled"
            ? "pin"
            : code === "management.request_invalid" && (named === "outcome" || named === "note")
              ? named
              : null;
        this.heldRefusal = { code, text: codeMessage(code), field };
      }
    } finally {
      if (this.#billOperation === operation) {
        this.#billOperation = undefined;
        this.billBusy = false;
      }
    }
    if (this.heldRefusal?.field) this.#focusFirstInvalid("[data-test=held-outcome-dialog]");
  }

  #heldErrors(): Partial<Record<HeldField, string>> {
    const errors: Partial<Record<HeldField, string>> = {};
    if (this.heldAttempted) {
      if (!this.heldOutcome) errors.outcome = t("payments.held.outcome_required");
      if (!this.heldPin) errors.pin = t("payments.bill.pin_required");
    }
    const refusal = this.heldRefusal;
    if (refusal?.field) errors[refusal.field] = refusal.text;
    return errors;
  }

  #billPinRefused(): boolean {
    return this.billFormError === "pin.invalid" || this.billFormError === "pin.throttled";
  }

  /** The attestation's own checks, once submitted. */
  #billChecks(): Partial<Record<"outcome" | "note" | "pin", string>> {
    const errors: Partial<Record<"outcome" | "note" | "pin", string>> = {};
    if (!this.billAttempted) return errors;
    if (!this.billOutcome) errors.outcome = t("payments.bill.outcome_required");
    if (!this.billNote.trim()) errors.note = t("payments.bill.note_required");
    if (!this.billPin) errors.pin = t("payments.bill.pin_required");
    return errors;
  }

  /** Once the dialog has rendered its field messages, focuses the first invalid field in it. */
  #focusFirstInvalid(dialog: string): void {
    void this.updateComplete.then(() => {
      const root = this.shadowRoot!.querySelector(dialog);
      if (root) void focusFirstInvalid(root);
    });
  }

  #billProviderState(state: string | null): string {
    if (state === "attempting") return t("payments.bill.state_attempting");
    if (state === "failed" || state === "voided") return t("payments.bill.state_failed");
    if (state === "captured" || state === "refunded" || state === "partially_refunded")
      return t("payments.bill.state_charged");
    if (state === "initiated") return t("payments.bill.state_started");
    return t("payments.bill.state_missing");
  }

  #renderBillRow(target: BillTarget): TemplateResult {
    if (target.kind === "payment" && target.row.partialRefund)
      return this.#renderPartialRow(target.row);
    if (target.kind === "tender")
      return html`<li class="stuck" data-test=${`tender-refund-${target.row.id}`}>
        <div class="stuck-body">
          <p class="stuck-order">${this.#billOrder(target.row)}</p>
          <p>${t("payments.tender.intro")}</p>
          <dl class="stuck-details">
            <dt>${t("payments.bill.refund_reason")}</dt>
            <dd>${target.row.reason}</dd>
            <dt>${t("payments.stuck.provider")}</dt>
            <dd>
              ${target.row.provider ? this.#providerName(target.row.provider) : t("payments.bill.provider_unknown")}
            </dd>
            <dt>${t("payments.tender.reference")}</dt>
            <dd>${target.row.providerPaymentRef ?? t("payments.bill.provider_unknown")}</dd>
            <dt>${t("payments.tender.attempt")}</dt>
            <dd>${target.row.id}</dd>
            <dt>${t("payments.stuck.amount")}</dt>
            <dd>${formatMoney(billAmount(target), currentLocale())}</dd>
            <dt>${t("payments.stuck.started")}</dt>
            <dd>
              <time datetime=${target.row.createdAt}>${formatAlertTime(target.row.createdAt)}</time>
            </dd>
          </dl>
        </div>
        <wt-button
          variant="secondary"
          data-test=${`check-tender-refund-${target.row.id}`}
          aria-label=${`${t("payments.bill.check")}: ${this.#billOrder(target.row)}`}
          ?disabled=${this.billBusy}
          @click=${() => this.#openBillAction(target, "check")}
          >${t("payments.bill.check")}</wt-button
        >
        <wt-button
          variant="secondary"
          data-test=${`attest-tender-refund-${target.row.id}`}
          aria-label=${`${t("payments.bill.attest")}: ${this.#billOrder(target.row)}`}
          ?disabled=${this.billBusy}
          @click=${() => this.#openBillAction(target, "attest")}
          >${t("payments.bill.attest")}</wt-button
        >
      </li>`;
    const id = target.kind === "payment" ? target.row.billPaymentId : target.row.refundId;
    const kind = target.kind === "payment" ? "bill-payment" : "bill-refund";
    return html`<li class="stuck" data-test=${`${kind}-${id}`}>
      <div class="stuck-body">
        <p class="stuck-order">${this.#billOrder(target.row)}</p>
        <dl class="stuck-details">
          <dt>${t("payments.stuck.device")}</dt>
          <dd data-test="stuck-device">${sourceLabel(target.row)}</dd>
          <dt>${t("payments.stuck.provider")}</dt>
          <dd>
            ${target.row.provider ? this.#providerName(target.row.provider) : t("payments.bill.provider_unknown")}
          </dd>
          <dt>${t("payments.stuck.amount")}</dt>
          <dd>${formatMoney(billAmount(target), currentLocale())}</dd>
          ${
            target.kind === "payment"
              ? html`<dt>${t("payments.bill.provider_state")}</dt>
                  <dd>${this.#billProviderState(target.row.providerState)}</dd>`
              : html`<dt>${t("payments.bill.refund_reason")}</dt>
                  <dd>${target.row.reason}</dd>
                  <dt>${t("payments.bill.sent_at")}</dt>
                  <dd>
                    ${
                      target.row.sentAt
                        ? html`<time datetime=${target.row.sentAt}
                            >${formatAlertTime(target.row.sentAt)}</time
                          >`
                        : t("payments.bill.not_sent")
                    }
                  </dd>
                  <dt>${t("payments.bill.send_count")}</dt>
                  <dd>${target.row.sendCount}</dd>`
          }
          <dt>${t("payments.stuck.started")}</dt>
          <dd>
            <time
              datetime=${target.kind === "payment" ? target.row.startedAt : target.row.requestedAt}
              >${formatAlertTime(target.kind === "payment" ? target.row.startedAt : target.row.requestedAt)}</time
            >
          </dd>
        </dl>
      </div>
      <wt-button
        variant="secondary"
        data-test=${`check-${kind}-${id}`}
        aria-label=${`${t("payments.bill.check")}: ${this.#billOrder(target.row)}`}
        ?disabled=${this.billBusy}
        @click=${() => this.#openBillAction(target, "check")}
        >${t("payments.bill.check")}</wt-button
      >
      <wt-button
        variant="secondary"
        data-test=${`attest-${kind}-${id}`}
        aria-label=${`${t("payments.bill.attest")}: ${this.#billOrder(target.row)}`}
        ?disabled=${this.billBusy}
        @click=${() => this.#openBillAction(target, "attest")}
        >${t("payments.bill.attest")}</wt-button
      >
    </li>`;
  }

  #renderBillRecovery(): TemplateResult | typeof nothing {
    const errors = [
      ...new Set(
        [
          this.billPaymentLoadError,
          this.billRefundLoadError,
          this.tenderRefundLoadError,
          this.heldLoadError,
        ]
          .filter((code): code is string => code !== null)
          .map((code) => codeMessage(code)),
      ),
    ];
    const pending =
      this.billPayments.length ||
      this.billRefunds.length ||
      this.tenderRefunds.length ||
      this.heldPayments.length;
    if (!pending && !this.billResult && !errors.length) return nothing;
    return html`<section
      class="stuck-section ${pending ? "pending" : ""}"
      data-test="bill-recovery"
      aria-labelledby="bill-recovery-heading"
    >
      <h2 id="bill-recovery-heading">${t("payments.bill.heading")}</h2>
      <p>${t("payments.bill.intro")}</p>
      ${this.billResult ? html`<p data-test="bill-action-result" role=${this.billResult.refused ? "alert" : "status"} class=${this.billResult.refused ? "error" : ""}>${this.billResult.text}</p>` : nothing}
      ${errors.length ? html`<p data-test="bill-load-error" role="alert" class="error">${errors.join(" ")}</p>` : nothing}
      <wt-button
        variant="secondary"
        data-test="refresh-bill-recovery"
        ?disabled=${this.billBusy}
        @click=${() => void this.#loadBillRecovery(false)}
        >${t("payments.bill.refresh")}</wt-button
      >
      <h3>${t("payments.bill.payments")}</h3>
      ${
        this.billPayments.length
          ? html`<ul class="stuck-list">
              ${this.billPayments.map((row) => this.#renderBillRow({ kind: "payment", row }))}
            </ul>`
          : html`<p>${t("payments.bill.no_payments")}</p>`
      }
      <h3>${t("payments.bill.refunds")}</h3>
      ${
        this.billRefunds.length
          ? html`<ul class="stuck-list">
              ${this.billRefunds.map((row) => this.#renderBillRow({ kind: "refund", row }))}
            </ul>`
          : html`<p>${t("payments.bill.no_refunds")}</p>`
      }
      ${
        this.tenderRefunds.length
          ? html`<h3>${t("payments.tender.heading")}</h3>
              <ul class="stuck-list">
                ${this.tenderRefunds.map((row) => this.#renderBillRow({ kind: "tender", row }))}
              </ul>`
          : nothing
      }
      ${
        this.heldPayments.length
          ? html`<div data-test="held-payments">
              <h3>${t("payments.held.heading")}</h3>
              <ul class="stuck-list">
                ${this.heldPayments.map((row) => this.#renderHeldRow(row))}
              </ul>
            </div>`
          : nothing
      }
    </section>`;
  }

  #heldOrder(row: HeldPaymentRow): string {
    const order = fill("payments.stuck.order", { number: String(row.orderNumber) });
    return row.label ? `${order} · ${row.label}` : order;
  }

  #heldOrderAndTime(row: HeldPaymentRow): string {
    const order = this.#heldOrder(row);
    return row.settledAt ? `${order} · ${formatAlertTime(row.settledAt)}` : order;
  }

  #heldOrderLine(row: HeldPaymentRow): TemplateResult {
    return html`<p class="stuck-order">
      ${this.#heldOrder(row)}${
        row.settledAt
          ? html` · <time datetime=${row.settledAt}>${formatAlertTime(row.settledAt)}</time>`
          : nothing
      }
    </p>`;
  }

  #renderHeldRow(row: HeldPaymentRow): TemplateResult {
    const order = this.#heldOrderAndTime(row);
    return html`<li class="stuck" data-test=${`held-payment-${row.paymentId}`}>
      <div class="stuck-body">
        ${this.#heldOrderLine(row)}
        <p class="held-amounts">
          ${fill("payments.held.amounts", {
            amount: formatMoney(row.amount, currentLocale()),
            provider: this.#providerName(row.provider),
            providerAmount: formatMoney(row.providerAmount, currentLocale()),
          })}
        </p>
      </div>
      <wt-button
        variant="secondary"
        data-test=${`record-held-${row.paymentId}`}
        aria-label=${`${t("payments.held.record")}: ${order}`}
        ?disabled=${this.billBusy}
        @click=${() => this.#openHeldAction(row)}
        >${t("payments.held.record")}</wt-button
      >
    </li>`;
  }

  #renderHeldDialog(): TemplateResult | typeof nothing {
    const row = this.heldAction;
    if (row === null) return nothing;
    const errors = this.#heldErrors();
    const refusal = this.heldRefusal;
    const invalid = this.heldAttempted && (!this.heldOutcome || !this.heldPin);
    const record = saveActionState(this.#heldScope);
    const bottom = [
      ...(refusal && !refusal.field ? [refusal.text] : []),
      ...(Object.keys(errors).length > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    const provider = this.#providerName(row.provider);
    const change = (field: HeldField, value: string) => {
      if (!this.isConnected || this.heldAction !== row) return;
      if (field === "outcome") this.heldOutcome = value;
      else if (field === "note") this.heldNote = value;
      else this.heldPin = value;
      this.#heldScope?.changed();
      if (this.heldRefusal?.field === field) this.heldRefusal = null;
    };
    return html`<wt-dialog
      data-test="held-outcome-dialog"
      .open=${true}
      .beforeClose=${this.#heldLeave ? this.#beforeHeldClose : undefined}
      ?dismissible=${!this.billBusy}
      heading=${t("payments.held.dialog_heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.billBusy && this.heldAction === row) this.#closeHeldAction();
      }}
    >
      ${this.#heldOrderLine(row)}
      <dl class="held-dialog-amounts">
        <dt>${t("payments.held.charged_here")}</dt>
        <dd>${formatMoney(row.amount, currentLocale())}</dd>
        <dt>${fill("payments.held.provider_paid", { provider })}</dt>
        <dd>${formatMoney(row.providerAmount, currentLocale())}</dd>
      </dl>
      <wt-combobox
        class="bill-outcome"
        name="outcome"
        required
        data-test="held-outcome-outcome"
        label=${t("payments.held.outcome")}
        search="auto"
        placeholder=${t("payments.bill.choose_outcome")}
        .options=${[
          { value: "refunded_at_provider", label: t("payments.held.refunded_option") },
          { value: "kept", label: t("payments.held.kept_option") },
        ]}
        .value=${this.heldOutcome}
        error=${errors.outcome ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) =>
          change("outcome", event.detail.value)}
      ></wt-combobox>
      <wt-input
        name="note"
        data-test="held-outcome-note"
        label=${t("payments.held.note")}
        .value=${this.heldNote}
        .error=${errors.note ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => change("note", event.detail.value)}
      ></wt-input>
      <wt-input
        name="pin"
        type="password"
        autocomplete="off"
        required
        data-test="held-outcome-pin"
        label=${t("payments.bill.pin")}
        .value=${this.heldPin}
        .error=${errors.pin ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => change("pin", event.detail.value)}
      ></wt-input>
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.billBusy}
          @click=${() => void this.#requestHeldClose()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="confirm-held-outcome"
          variant=${record.variant}
          ?loading=${this.billBusy}
          ?disabled=${record.unchanged || invalid}
          @click=${() => void this.#recordHeld()}
          >${t("payments.held.confirm")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #renderBillDialog(): TemplateResult | typeof nothing {
    const action = this.billAction;
    if (action === null) return nothing;
    if (action.mode === "check")
      return html`<wt-dialog
        data-test="bill-check-dialog"
        .open=${true}
        heading=${t(action.target.kind === "tender" ? "payments.tender.check_heading" : "payments.bill.check_heading")}
        @wt-close=${() => {
          if (!this.billBusy) this.billAction = null;
        }}
      >
        <p>
          ${fill(action.target.kind === "tender" ? "payments.tender.check_body" : "payments.bill.check_body", { order: this.#billOrder(action.target.row) })}
        </p>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            variant="secondary"
            @click=${() => {
              this.billAction = null;
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button data-test="confirm-bill-check" @click=${() => void this.#checkBill()}
            >${t("payments.bill.check")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>`;
    const payment = action.target.kind === "payment";
    const checked = this.#billChecks();
    const errors = this.#billPinRefused()
      ? { ...checked, pin: codeMessage(this.billFormError!) }
      : checked;
    const invalid = Object.keys(checked).length > 0;
    const record = saveActionState(this.#billScope);
    const bottom = [
      ...(this.billFormError && !this.#billPinRefused() ? [this.billFormErrorText] : []),
      ...(Object.keys(errors).length > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-dialog
      data-test="bill-attest-dialog"
      .open=${true}
      .beforeClose=${this.#billLeave ? this.#beforeBillClose : undefined}
      ?dismissible=${!this.billBusy}
      heading=${t("payments.bill.attest_heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.billBusy && this.billAction === action) this.#closeBillAction();
      }}
    >
      <p>${fill("payments.bill.attest_body", { order: this.#billOrder(action.target.row) })}</p>
      <wt-combobox
        class="bill-outcome"
        name="outcome"
        required
        data-test="bill-attest-outcome"
        label=${t("payments.bill.outcome")}
        search="auto"
        placeholder=${t("payments.bill.choose_outcome")}
        .options=${[
          {
            value: payment ? "received" : "completed",
            label: t(payment ? "payments.bill.received_option" : "payments.bill.completed_option"),
          },
          {
            value: "failed",
            label: t(
              payment
                ? "payments.bill.failed_payment_option"
                : "payments.bill.failed_refund_option",
            ),
          },
        ]}
        .value=${this.billOutcome}
        error=${errors.outcome ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!this.isConnected || this.billAction !== action) return;
          this.billOutcome = event.detail.value;
          this.#billScope?.changed();
        }}
      ></wt-combobox>
      <wt-input
        name="note"
        required
        data-test="bill-attest-note"
        label=${t("payments.bill.note")}
        .value=${this.billNote}
        .error=${errors.note ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!this.isConnected || this.billAction !== action) return;
          this.billNote = event.detail.value;
          this.#billScope?.changed();
        }}
      ></wt-input>
      <wt-input
        name="pin"
        type="password"
        autocomplete="off"
        required
        data-test="bill-attest-pin"
        label=${t("payments.bill.pin")}
        .value=${this.billPin}
        .error=${errors.pin ?? ""}
        ?disabled=${this.billBusy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!this.isConnected || this.billAction !== action) return;
          this.billPin = event.detail.value;
          this.#billScope?.changed();
          if (this.#billPinRefused()) {
            this.billFormError = null;
            this.billFormErrorText = null;
          }
        }}
      ></wt-input>
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.billBusy}
          @click=${() => void this.#requestBillClose()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="confirm-bill-attest"
          variant=${record.variant}
          ?loading=${this.billBusy}
          ?disabled=${record.unchanged || invalid}
          @click=${() => void this.#attestBill()}
          >${t("payments.bill.attest")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #partialAmounts(row: StuckBillPaymentRow): string {
    const facts = row.partialRefund!;
    return fill("payments.partial.amounts", {
      captured: formatMoney(facts.captured, currentLocale()),
      refunded: formatMoney(facts.refunded, currentLocale()),
      remaining: formatMoney(facts.remaining, currentLocale()),
    });
  }

  #renderPartialRow(row: StuckBillPaymentRow): TemplateResult {
    const id = row.partialRefund!.paymentId;
    return html`<li class="stuck" data-test=${`partial-refund-${id}`}>
      <div class="stuck-body">
        <p class="stuck-order">${this.#billOrder(row)}</p>
        <p>${this.#providerName(row.provider!)} · ${this.#partialAmounts(row)}</p>
        ${row.billState === "failed" ? html`<p>${t("payments.partial.failed_link")}</p>` : nothing}
      </div>
      <wt-button
        variant="secondary"
        data-test=${`release-partial-${id}`}
        aria-label=${`${t("payments.partial.confirm")}: ${this.#billOrder(row)}`}
        ?disabled=${this.billBusy}
        @click=${() => {
          this.retainingPartial = false;
          this.confirmingPartial = row;
        }}
        >${t("payments.partial.confirm")}</wt-button
      >
      ${
        row.retention
          ? html`<wt-button
              variant="secondary"
              data-test=${`retain-partial-${id}`}
              ?disabled=${this.billBusy}
              @click=${() => {
                this.retainingPartial = true;
                this.confirmingPartial = row;
              }}
              >${t("payments.partial.retain")}</wt-button
            >`
          : nothing
      }
    </li>`;
  }

  async #releasePartial(): Promise<void> {
    const row = this.confirmingPartial;
    if (!row || this.billBusy) return;
    const retain = this.retainingPartial;
    this.confirmingPartial = null;
    this.billBusy = true;
    this.billResult = null;
    const operation = (this.#billOperation = {});
    const current = () => this.isConnected && this.#billOperation === operation;
    try {
      if (retain && row.retention) {
        const { remaining, applied, tip } = row.retention;
        await this.api.retainPartialRefund(row.partialRefund!.paymentId, {
          remaining,
          applied,
          tip,
        });
      } else await this.api.releasePartialRefund(row.partialRefund!.paymentId);
      if (!current()) return;
      this.billResult = {
        text: `${this.#billOrder(row)}: ${t(retain ? "payments.partial.retained" : "payments.partial.released")}`,
        refused: false,
      };
    } catch (error) {
      if (!current()) return;
      this.billResult = {
        text: `${this.#billOrder(row)}: ${codeOf(error) === "payment.outcome_unknown" ? ((error as { params?: { reason?: unknown } }).params?.reason === "refund_reference_missing" ? t("payments.partial.reference_missing") : t(retain ? "payments.partial.retain_unconfirmed" : "payments.partial.unconfirmed")) : paymentRefusalText(error)}`,
        refused: true,
      };
    }
    try {
      await this.#loadBillRecovery(true);
    } finally {
      if (current()) {
        this.billBusy = false;
        this.#billOperation = undefined;
      }
    }
  }

  #renderPartialDialog(): TemplateResult | typeof nothing {
    const row = this.confirmingPartial;
    if (!row) return nothing;
    const retain = this.retainingPartial;
    const title = t(retain ? "payments.partial.retain" : "payments.partial.confirm");
    return html`<wt-dialog
      data-test="partial-refund-dialog"
      .open=${true}
      heading=${title}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.confirmingPartial = null;
      }}
    >
      <p>${this.#billOrder(row)}</p>
      <p>${this.#partialAmounts(row)}</p>
      <p>
        ${
          retain && row.retention
            ? fill("payments.partial.retain_instructions", {
                applied: formatMoney(row.retention.applied, currentLocale()),
                tip: formatMoney(row.retention.tip, currentLocale()),
                outstanding: formatMoney(row.retention.outstanding, currentLocale()),
              })
            : fill("payments.partial.instructions", {
                provider: this.#providerName(row.provider!),
                remaining: formatMoney(row.partialRefund!.remaining, currentLocale()),
              })
        }
      </p>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-partial-refund"
          @click=${() => {
            this.confirmingPartial = null;
          }}
          >${t("action.cancel")}</wt-button
        >
        <wt-button data-test="confirm-partial-refund" @click=${() => void this.#releasePartial()}
          >${title}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #startAddReader(): void {
    if (this.providers === undefined || this.#listQueries.failing("listPaymentProviders")) return;
    const connected = this.providers.filter((provider) => provider.state === "connected");
    if (connected.length === 1) void this.#onAddReader(connected[0]!.providerId);
    else if (connected.length > 1) this.choosingProvider = true;
  }

  #renderAddReader(): TemplateResult {
    const loaded =
      this.providers !== undefined && !this.#listQueries.failing("listPaymentProviders");
    const connected = this.providers?.filter((provider) => provider.state === "connected") ?? [];
    if (loaded && connected.length === 0)
      return html`<a data-test="configure-providers" href=${CARD_PROVIDERS_FROM_READERS_PATH}
        >${tRaw("modules.configure_providers")}</a
      >`;
    return html`<wt-button
      data-test="add-reader"
      variant=${!loaded || this.busy ? "secondary" : "primary"}
      ?disabled=${!loaded || this.busy}
      @click=${() => this.#startAddReader()}
      >${t("payments.add_reader")}</wt-button
    >`;
  }

  #renderProviderChoice(): TemplateResult | typeof nothing {
    if (!this.choosingProvider) return nothing;
    return html`<wt-dialog
      data-test="choose-reader-provider"
      .open=${true}
      heading=${t("payments.choose_provider")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.choosingProvider = false;
      }}
    >
      <div class="reader-tools">
        ${(this.providers ?? [])
          .filter((provider) => provider.state === "connected")
          .map(
            (provider) =>
              html`<wt-button
                data-test="add-reader-${provider.providerId}"
                @click=${() => {
                  this.choosingProvider = false;
                  void this.#onAddReader(provider.providerId);
                }}
                >${this.#providerName(provider.providerId)}</wt-button
              >`,
          )}
      </div>
      <p><a href=${CARD_PROVIDERS_FROM_READERS_PATH}>${tRaw("modules.configure_providers")}</a></p>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          @click=${() => {
            this.choosingProvider = false;
          }}
          >${t("action.cancel")}</wt-button
        ></wt-form-actions
      >
    </wt-dialog>`;
  }

  #renderPairReader(): TemplateResult | typeof nothing {
    const id = this.addingId;
    const panel = id === null ? undefined : this.#panelFor(id);
    if (!panel) return nothing;
    return html`<div class="panel-slot" data-test="add-reader-dialog-${id}">
      ${panel.renderAddReader({
        request: this.request,
        onAdded: () => {
          this.#pairSucceeded = true;
          void this.#load();
        },
        onClose: () => {
          this.addingId = null;
          if (!this.#pairSucceeded) void this.#onAddReader(id!);
        },
      })}
    </div>`;
  }

  #statusKey(reader: ReaderRow): ReaderStatusKey {
    if (!reader.active) return reader.canEnable ? "unavailable" : "unpaired";
    const status = this.statuses.get(reader.id);
    if (status === undefined) return "loading";
    if (status === "connection.timed_out") return "timed_out";
    if (status === "error" || status.unreachable) return "unknown";
    if (status.pairingStatus === "processing") return "processing";
    return status.online ? "online" : "offline";
  }

  #statusText(reader: ReaderRow): string {
    return readerStatusLabel(this.#statusKey(reader));
  }

  #readerColumns(): DataTableColumn<ReaderRow>[] {
    return [
      {
        key: "name",
        label: t("payments.reader_col_name"),
        cell: (reader) => reader.name,
        searchValue: (reader) => reader.name,
        sortValue: (reader) => reader.name,
      },
      {
        key: "provider",
        choosable: "shown",
        label: t("payments.reader_col_provider"),
        filter: {
          label: t("payments.reader_col_provider"),
          allLabel: t("payments.filter_provider_all"),
          multiple: {
            countLabel: (count) => fill("payments.filter_provider_count", { count: String(count) }),
          },
          value: (reader) => reader.provider,
          options: [...new Set((this.readers ?? []).map((reader) => reader.provider))].map(
            (provider) => ({ value: provider, label: this.#providerName(provider) }),
          ),
        },
        cell: (reader) => this.#providerName(reader.provider),
        searchValue: (reader) => this.#providerName(reader.provider),
        sortValue: (reader) => this.#providerName(reader.provider),
      },
      {
        key: "status",
        choosable: "shown",
        label: t("payments.reader_col_status"),
        filter: {
          preserveOrder: true,
          label: t("payments.reader_col_status"),
          allLabel: t("payments.filter_status_all"),
          multiple: {
            countLabel: (count) => fill("payments.filter_status_count", { count: String(count) }),
          },
          value: (reader) => this.#statusKey(reader),
          options: READER_STATUS_FILTER.map((key) => ({
            value: key,
            label: readerStatusLabel(key),
          })),
        },
        searchValue: (reader) => this.#statusText(reader),
        cell: (reader) =>
          html`<span data-test="reader-status-${reader.id}">${this.#statusText(reader)}</span>`,
      },
      {
        key: "battery",
        choosable: "shown",
        label: t("payments.reader_col_battery"),
        cell: (reader) => {
          const status = this.statuses.get(reader.id);
          const battery =
            status && status !== "error" && status !== "connection.timed_out"
              ? status.batteryPercent
              : undefined;
          return html`<span data-test=${`reader-battery-${reader.id}`}
            >${battery === undefined ? "" : `${battery}%`}</span
          >`;
        },
      },
      {
        key: "deviceCount",
        choosable: "shown",
        label: t("payments.reader_col_in_use_by"),
        searchValue: (reader) => reader.deviceNames.join(" "),
        cell: (reader) =>
          html`<span data-test=${`reader-use-${reader.id}`} title=${reader.deviceNames.join(", ")}
            >${reader.deviceNames.slice(0, 2).join(", ")}${reader.deviceNames.length > 2 ? ` +${reader.deviceNames.length - 2}` : ""}</span
          >`,
        sortValue: (reader) => reader.deviceCount,
      },
      {
        key: "actions",
        label: t("payments.reader_col_actions"),
        align: "end",
        pinned: "end",
        cell: (reader) =>
          html`<wt-row-actions label=${`${t("payments.reader_col_actions")}: ${reader.name}`}>
            <wt-button
              data-test=${`edit-${reader.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) => this.#openEditor(reader, "edit", event)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              data-test=${`label-${reader.id}`}
              @click=${(event: Event) => {
                this.#labelOpener = event.currentTarget as HTMLElement;
                this.labelReader = reader;
              }}
              >${t("equipment.label")}</wt-button
            >
            <wt-button
              data-test=${`details-${reader.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) => this.#openEditor(reader, "details", event)}
              >${t("payments.details")}</wt-button
            >
            ${
              reader.canEnable &&
              this.providers?.find((p) => p.providerId === reader.provider)?.canUnpair
                ? html` <wt-button
                    data-test=${`unpair-${reader.id}`}
                    ?disabled=${this.busy}
                    @click=${(event: Event) => this.#openEditor(reader, "unpair", event)}
                  >
                    ${fill("payments.unpair", { provider: this.#providerName(reader.provider) })}</wt-button
                  >`
                : nothing
            }
            <wt-button
              variant=${this.busy ? "secondary" : "danger"}
              data-test=${`delete-${reader.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) => this.#openDelete(reader, event)}
              >${t("action.delete")}</wt-button
            >
          </wt-row-actions>`,
      },
    ];
  }

  #renderDiscovery(): TemplateResult | typeof nothing {
    if (this.discoveringId === null) return nothing;
    const version = this.#discoveryVersion;
    const invalid = (this.available ?? []).some(
      (reader) => reader.status !== "added" && this.#nameInvalid(reader.providerRef),
    );
    const bottom = [
      ...(this.dialogError ? [codeMessage(this.dialogError)] : []),
      ...(invalid ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-dialog
      data-test="reader-discovery"
      .open=${true}
      .dismissible=${!this.busy}
      .beforeClose=${this.#discoveryScopes.size ? this.#beforeDiscoveryClose : undefined}
      heading=${t("payments.discovery_heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (version === this.#discoveryVersion) this.#closeDiscovery();
      }}
    >
      <p>
        ${fill("payments.discovery_intro", { provider: this.#providerName(this.discoveringId) })}
      </p>
      ${
        this.listingFailed
          ? html`<p role="status">${t("payments.discovery_failed")}</p>`
          : this.available === undefined
            ? html`<p role="status">${t("payments.discovery_loading")}</p>`
            : this.available.length === 0
              ? html`<p>${t("payments.discovery_empty")}</p>`
              : this.available.map(
                  (reader) =>
                    html`<div class="discovery-row ${reader.status === "added" ? "added" : ""}">
                      <div class="discovery-reader">
                        ${
                          reader.status !== "available"
                            ? html`<p>
                                ${reader.name} ·
                                ${t(reader.status === "added" ? "payments.already_added" : "payments.reader_retained")}
                              </p>`
                            : html`<wt-input
                                name="reader-name"
                                required
                                label=${t("payments.reader_col_name")}
                                data-test=${`name-${reader.providerRef}`}
                                .value=${this.drafts[reader.providerRef] ?? reader.name}
                                .error=${this.#nameInvalid(reader.providerRef) ? t("payments.name_required") : ""}
                                ?disabled=${this.busy}
                                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, (event.currentTarget as HTMLElement).closest(".discovery-row")!.querySelector("wt-button"))}
                                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                                  if (
                                    !this.isConnected ||
                                    !(event.currentTarget as HTMLElement).isConnected ||
                                    version !== this.#discoveryVersion
                                  )
                                    return;
                                  this.drafts = {
                                    ...this.drafts,
                                    [reader.providerRef]: event.detail.value,
                                  };
                                  this.#discoveryScopes.get(reader.providerRef)?.changed();
                                }}
                              ></wt-input>`
                        }
                        <p>${[reader.model, reader.serial].filter(Boolean).join(" · ")}</p>
                      </div>
                      ${
                        reader.status === "added"
                          ? nothing
                          : html`<wt-button
                              data-test=${`adopt-${reader.providerRef}`}
                              variant=${saveActionState(this.#discoveryScopes.get(reader.providerRef), { savableAtOpen: true }).variant}
                              ?disabled=${this.busy || this.#nameInvalid(reader.providerRef)}
                              @click=${() => void this.#adopt(reader)}
                              >${t("action.add")}</wt-button
                            >`
                      }
                    </div>`,
                )
      }
      <p>${t("payments.pair_hint")}</p>
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-discovery"
          ?disabled=${this.busy}
          @click=${() => void this.#requestDiscoveryClose()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="pair-new-reader"
          ?disabled=${this.busy}
          @click=${() => void this.#pairNew()}
          >${t("payments.pair_new")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #renderEditor(): TemplateResult | typeof nothing {
    if (this.editor === null) return nothing;
    const editor = this.editor;
    const { reader, mode } = editor;
    const unpair = fill("payments.unpair", { provider: this.#providerName(reader.provider) });
    const heading =
      mode === "edit"
        ? t("payments.edit_reader")
        : mode === "unpair"
          ? unpair
          : t("payments.details");
    const status = this.statuses.get(reader.id);
    const details =
      status && status !== "error" && status !== "connection.timed_out"
        ? [
            [t("payments.connection"), status.connection],
            [t("payments.activity"), status.activity],
            [t("payments.firmware"), status.firmwareVersion],
            [t("payments.last_seen"), status.lastSeenAt],
            [t("payments.model"), status.model],
            [t("payments.serial"), status.serial],
          ].filter(([, value]) => value !== undefined)
        : [];
    const invalid = mode === "edit" && this.editAttempted && !this.editName.trim();
    const save =
      mode === "edit"
        ? saveActionState(this.#editScope)
        : { variant: "danger" as const, unchanged: false };
    const dialogMessage =
      mode === "unpair" && reader.active && this.dialogError === "reader.unpair_failed"
        ? t("payments.unpair_failed_unchanged")
        : this.dialogError && codeMessage(this.dialogError);
    const bottom = [
      ...(dialogMessage ? [dialogMessage] : []),
      ...(invalid ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-dialog
      data-test="reader-editor"
      .open=${true}
      .dismissible=${mode !== "edit" || !this.busy}
      .beforeClose=${mode === "edit" && this.#readerLeave ? this.#beforeEditorClose : undefined}
      heading=${`${heading}: ${reader.name}`}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.editor === editor) void this.#closeEditor();
      }}
    >
      ${
        mode === "edit"
          ? html`<wt-input
                name="reader-name"
                required
                data-test="edit-reader-name"
                label=${t("payments.reader_col_name")}
                .value=${this.editName}
                .error=${invalid ? t("payments.name_required") : ""}
                ?disabled=${this.busy}
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=save-reader]"))}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  if (
                    !this.isConnected ||
                    !(event.currentTarget as HTMLElement).isConnected ||
                    this.editor !== editor
                  )
                    return;
                  this.editName = event.detail.value;
                  this.#editScope?.changed();
                }}
              ></wt-input>
              <wt-switch
                name="prints-own-slip-automatically"
                data-test="reader-own-slip"
                label=${t("payments.prints_own_slip_automatically")}
                .checked=${this.editOwnSlip}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  if (
                    !this.isConnected ||
                    !(event.currentTarget as HTMLElement).isConnected ||
                    this.editor !== editor
                  )
                    return;
                  this.editOwnSlip = event.detail.checked;
                  this.#editScope?.changed();
                }}
              ></wt-switch>`
          : mode === "unpair"
            ? html`<p>${t("payments.unpair_warning")}</p>`
            : html`<p>${this.#statusText(reader)}</p>
                <p data-test="reader-holder">
                  ${t("payments.reader_holder")}:
                  ${holderText(this.holders.get(reader.id)?.holder ?? null)}
                </p>
                ${
                  details.length
                    ? html`<dl class="reader-details">
                        ${details.map(
                          ([label, value]) =>
                            html`<dt>${label}</dt>
                              <dd>${value}</dd>`,
                        )}
                      </dl>`
                    : html`<p>${t("payments.details_empty")}</p>`
                }`
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="close-reader-editor"
          ?disabled=${mode === "edit" && this.busy}
          @click=${() => void this.#requestEditorClose()}
          >${t(mode === "details" ? "action.close" : "action.cancel")}</wt-button
        >
        ${
          mode === "details"
            ? nothing
            : html`<wt-button
                data-test=${mode === "edit" ? "save-reader" : "confirm-unpair"}
                variant=${save.variant}
                ?disabled=${this.busy || invalid || save.unchanged}
                @click=${() => void this.#saveEditor()}
                >${mode === "edit" ? t("action.save") : unpair}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-dialog>`;
  }

  @state() private backupOpen = false;

  override render(): TemplateResult {
    return html`<h1 tabindex="-1">
        ${t(this.surface === "checks" ? "payments.checks_title" : "payments.title")}
      </h1>
      ${this.surface === "checks" ? this.#renderChecks() : this.#renderReaders()}`;
  }

  #renderChecks(): TemplateResult {
    return html`
      ${this.#renderBillRecovery()}
      ${this.abandonedRefundError ? html`<p role="alert">${codeMessage(this.abandonedRefundError)}</p>` : nothing}
      ${
        this.abandonedRefunds.length
          ? html`<section data-test="abandoned-refunds">
              <h2>${t("payments.abandoned.title")}</h2>
              <ul class="stuck-list">
                ${this.abandonedRefunds.map(
                  (row) =>
                    html`<li class="stuck">
                      ${row.settledAt ? html`<time datetime=${row.settledAt}>${formatAlertTime(row.settledAt)}</time>` : nothing}
                      <p>
                        ${row.paymentRef} · ${row.externalRef ?? ""} ·
                        ${formatMoney(row.amount, currentLocale())}
                      </p>
                      <p>
                        ${t(row.outcome === "confirmed" ? "payments.abandoned.confirmed" : "payments.abandoned.unconfirmed")}
                      </p>
                    </li>`,
                )}
              </ul>
            </section>`
          : nothing
      }

      <wt-button
        variant="secondary"
        @click=${() => {
          this.backupOpen = !this.backupOpen;
        }}
        aria-expanded=${this.backupOpen}
        >${t("payments.backup.title")}</wt-button
      >
      ${this.backupOpen ? html`<dashboard-backup-audit .api=${this.api}></dashboard-backup-audit>` : nothing}
      ${this.#renderPartialDialog()} ${keyed(this.billAction, this.#renderBillDialog())}
      ${keyed(this.heldAction, this.#renderHeldDialog())}
    `;
  }

  #renderReaders(): TemplateResult {
    return html`
      ${
        this.simulatedCardPayments === true
          ? html`<p class="banner" data-test="simulator-banner" role="status">
              ${t("payments.simulator_banner")}
            </p>`
          : nothing
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      <section data-test="readers-section">
        <h2 id="card-readers-heading">${t("payments.readers_heading")}</h2>
        <div class="reader-tools">
          ${this.#renderAddReader()}
          <wt-button
            variant="secondary"
            data-test="refresh-readers"
            ?disabled=${this.refreshing || this.busy}
            @click=${() => void this.#loadStatuses(this.readers ?? [])}
            >${t("payments.refresh")}</wt-button
          >
        </div>
        ${
          this.readers === undefined
            ? nothing
            : html`<wt-data-table
                noMatchesMessage=${tableNoMatches()}
                filterSearchPlaceholder=${t("categories.combobox_search")}
                filterNoResultsLabel=${t("categories.combobox_no_results")}
                filtersLabel=${t("table.filters")}
                filteredColumnLabel=${t("table.filtered_column")}
                filtersClearAllLabel=${t("table.filters_clear_all")}
                filtersCloseLabel=${t("table.filters_close")}
                aria-label=${t("payments.readers_heading")}
                searchable
                searchLabel=${t("payments.readers_search")}
                viewKey="waitron.payments.readers.table"
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
                .rows=${this.readers ?? []}
                .columns=${this.#readerColumns()}
                .rowKey=${(reader: ReaderRow) => reader.id}
                .emptyMessage=${this.readers?.length ? tableNoMatches() : t("payments.readers_empty")}
              ></wt-data-table>`
        }
      </section>
      ${this.#renderProviderChoice()} ${this.#renderPairReader()}
      ${keyed(this.#discoveryVersion, this.#renderDiscovery())}
      ${keyed(this.editor, this.#renderEditor())}
      ${this.#deleteDialog.render(
        "delete-reader-dialog",
        readerDeleteCopy((id) => this.#providerName(id)),
      )}
      ${
        this.labelReader === null
          ? nothing
          : html`<dashboard-equipment-label
              .api=${this.api}
              kind="reader"
              .itemId=${this.labelReader.id}
              .name=${this.labelReader.name}
              .opener=${this.#labelOpener}
              @wt-close=${() => {
                this.labelReader = null;
              }}
            ></dashboard-equipment-label>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-screen": PaymentsScreen;
  }
}
