import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  leaveCoordinatorFor,
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
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import { centsToDecimal, formatMoney, stringToCents } from "@waitron/shared";
import {
  registerCatalogue,
  tableNoMatches,
  type CardProviderPanel,
  type DashboardRequest,
  t as tRaw,
} from "@waitron/dashboard-kit";
import type {
  AvailableReader,
  BillRecoveryOutcome,
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
  StuckPaymentResolution,
  StuckPaymentRow,
  StuckBillPaymentRow,
  StuckBillRefundRow,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { formatAlertTime, sourceLabel } from "../widgets/alert-format.js";

/** The section's own wording for a refused check; any other code reads its shared message. */
function stuckRefusalText(error: unknown): string {
  const code = codeOf(error);
  if (code === "payment.outcome_unknown") {
    const reason = (error as { params?: { reason?: unknown } }).params?.reason;
    if (reason === "unreachable") return t("payments.stuck.unknown_unreachable");
    if (reason === "ambiguous") return t("payments.stuck.unknown_ambiguous");
  }
  if (code === "reader.provider_disconnected") return t("payments.stuck.provider_disconnected");
  if (code === "server.internal") return t("payments.stuck.failed");
  return codeMessage(code);
}

function stuckOutcomeText(resolution: StuckPaymentResolution): string | null {
  if (resolution.outcome === "filed") return t("payments.stuck.filed");
  if (resolution.outcome === "not_charged") {
    return t(
      resolution.orderUnlocked
        ? "payments.stuck.not_charged_unlocked"
        : "payments.stuck.not_charged_locked",
    );
  }
  return null;
}

type BillTarget =
  { kind: "payment"; row: StuckBillPaymentRow } | { kind: "refund"; row: StuckBillRefundRow };

type BillDraft = { outcome: string; note: string; pin: string };

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
    if (reason === "mismatched") return t("payments.bill.payment_mismatched");
  }
  if (code === "bill.refund_outcome_unconfirmed") {
    if (reason === "pending") return t("payments.bill.refund_pending");
    if (reason === "not_found") return t("payments.bill.refund_not_found");
    if (reason === "ambiguous") return t("payments.bill.refund_ambiguous");
    if (reason === "unreachable") return t("payments.bill.refund_unreachable");
  }
  return codeMessage(code);
}

// Two status reads can wait on the card provider for 250 seconds; keep other browser connections
// available, including in browsers without Web Locks.
let statusSlotsFree = 2;
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
    css`
      :host {
        display: block;
      }
      h1 {
        margin-top: 0;
        font-size: var(--wt-font-size-lg);
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
      .providers {
        list-style: none;
        margin: 0 0 var(--wt-space-6);
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .provider {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
      }
      .provider-head {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .provider-name {
        font-weight: 600;
      }
      .badge {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        padding: 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .badge.connected {
        color: var(--wt-color-primary);
        border-color: var(--wt-color-primary);
      }
      .provider-actions {
        margin-inline-start: auto;
        display: flex;
        gap: var(--wt-space-2);
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
        min-width: 12rem;
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
      .reader-tools wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  /** A provider panel builds its own typed client on this. */
  @property({ attribute: false }) request!: DashboardRequest;

  @property({ attribute: false }) mode?: "demo" | "prepare" | "live";

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  @state() private providers?: PaymentProviderRow[];
  @state() private readers?: ReaderRow[];
  @state() private statuses = new Map<
    string,
    ReaderStatusView | "error" | "connection.timed_out"
  >();
  @state() private connectingId: string | null = null;
  @state() private addingId: string | null = null;
  @state() private armedDisconnectId: string | null = null;
  @state() private discoveringId: string | null = null;
  @state() private available?: AvailableReader[];
  @state() private listingFailed = false;
  @state() private drafts: Record<string, string> = {};
  /** Discovered readers whose Add has been pressed; their names are checked from then on. */
  @state() private attemptedNames = new Set<string>();
  @state() private readerFilter = "active";
  @state() private editor: { reader: ReaderRow; mode: "edit" | "details" | "unpair" } | null = null;
  @state() private editName = "";
  @state() private editAttempted = false;
  @state() private dialogError: string | null = null;
  @state() private busy = false;
  @state() private refreshing = false;
  #opener?: HTMLElement;
  #discoveryVersion = 0;
  #statusVersion = 0;
  #pairSucceeded = false;
  #statusesDue = true;
  #statusIds: string | undefined;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a list read's failure, the only message the read's recovery may clear. */
  #readErrorShown = false;
  @state() private stuck: StuckPaymentRow[] = [];
  @state() private stuckLoadError: string | null = null;
  @state() private confirmingStuck: StuckPaymentRow | null = null;
  @state() private resolvingId: string | null = null;
  @state() private stuckResult: { text: string; refused: boolean } | null = null;
  @state() private billPayments: StuckBillPaymentRow[] = [];
  @state() private billRefunds: StuckBillRefundRow[] = [];
  @state() private billPaymentLoadError: string | null = null;
  @state() private billRefundLoadError: string | null = null;
  @state() private billResult: { text: string; refused: boolean } | null = null;
  @state() private billAction: { target: BillTarget; mode: "check" | "attest" } | null = null;
  @state() private billBusy = false;
  @state() private billOutcome = "";
  @state() private billNote = "";
  @state() private billPin = "";
  @state() private billAttempted = false;
  @state() private billFormError: string | null = null;
  @state() private billFormErrorText: string | null = null;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.stuckLoadError = codeOf(error);
    },
  );
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

  #readerLeave?: LeaveCoordinator;
  #editScope?: DraftScope<string>;
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
    void this.#load();
    void this.#queries
      .watch("listStuckPayments", [], (rows) => {
        this.stuck = rows;
        this.stuckLoadError = null;
      })
      .catch(() => undefined);
    void this.#billPaymentQuery
      .watch("listStuckBillPayments", [], (rows) => {
        this.billPayments = rows;
        this.billPaymentLoadError = null;
      })
      .catch(() => undefined);
    void this.#billRefundQuery
      .watch("listStuckBillRefunds", [], (rows) => {
        this.billRefunds = rows;
        this.billRefundLoadError = null;
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#statusVersion++;
    this.#billOperation = undefined;
    this.renderRoot
      .querySelector<WtDialog>("[data-test=bill-attest-dialog]")
      ?.closeAfter("security");
    this.#closeBillAction();
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

  #simulator(): boolean {
    return this.mode === "demo" || this.mode === "prepare";
  }

  #panelFor(providerId: string): CardProviderPanel | undefined {
    return this.panels.find((p) => p.providerId === providerId);
  }

  #providerName(providerId: string): string {
    const key = this.#panelFor(providerId)?.displayNameKey;
    return key ? tRaw(key) : providerId;
  }

  /** Disarms the two-tap Disconnect, since the armed row may no longer exist. */
  async #load(): Promise<void> {
    if (this.#readErrorShown) this.#showError(null);
    this.armedDisconnectId = null;
    this.#statusesDue = true;
    // After this load's first readers read fails, only an automatic retry can succeed in its place.
    let attended = true;
    await Promise.allSettled([
      this.#listQueries.watch("listPaymentProviders", [], (providers) => {
        this.providers = providers;
        const armed = this.armedDisconnectId;
        if (!providers.some((p) => p.providerId === armed && p.state === "connected"))
          this.armedDisconnectId = null;
      }),
      this.#listQueries
        .watch("listReaders", [], (readers) => {
          this.readers = readers;
          // A status may ask the provider itself, so a background refresh asks again only when the
          // set of active readers changed.
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
    if (version === this.#statusVersion) this.refreshing = false;
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.#showError(null);
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.#showError(codeOf(error));
    } finally {
      this.busy = false;
    }
  }

  #onConnect(providerId: string): void {
    this.connectingId = this.connectingId === providerId ? null : providerId;
    this.addingId = null;
  }

  /** Disconnect deletes the stored credential, so it takes a second, confirming tap. */
  #onDisconnect(providerId: string): void {
    if (this.armedDisconnectId === providerId) {
      this.armedDisconnectId = null;
      void this.#mutate(() => this.api.disconnectPaymentProvider(providerId));
      return;
    }
    this.armedDisconnectId = providerId;
  }

  async #onAddReader(providerId: string): Promise<void> {
    this.#disposeDiscoveryDrafts();
    this.#readerOperation = undefined;
    this.busy = false;
    this.#readerLeave = leaveCoordinatorFor(this);
    this.discoveringId = providerId;
    this.addingId = null;
    this.connectingId = null;
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
        ?.requestClose("cancel"))
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

  #openEditor(reader: ReaderRow, mode: "edit" | "details" | "unpair", event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    this.#opener = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.#readerOperation = undefined;
    this.busy = false;
    this.editor = { reader, mode };
    this.editName = reader.name;
    this.#readerLeave = leaveCoordinatorFor(this);
    if (mode === "edit")
      this.#editScope = this.#readerLeave?.register({
        id: {},
        current: () => this.editName.trim(),
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: () => {},
      });
    this.editAttempted = false;
    this.dialogError = null;
  }

  async #requestEditorClose(): Promise<void> {
    const editor = this.editor;
    if (
      await this.renderRoot
        .querySelector<WtDialog>("[data-test=reader-editor]")
        ?.requestClose("cancel")
    ) {
      if (this.editor === editor) await this.#closeEditor();
    }
  }

  async #closeEditor(): Promise<void> {
    this.#editScope?.dispose();
    this.#editScope = undefined;
    this.editor = null;
    await this.updateComplete;
    if (this.#opener?.isConnected) this.#opener.focus();
  }

  async #saveEditor(): Promise<void> {
    if (this.busy || this.editor === null) return;
    const editor = this.editor;
    const scope = this.#editScope;
    const { reader, mode } = editor;
    const name = this.editName.trim();
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
      if (mode === "edit") await this.api.renameReader(reader.id, name);
      else await this.api.unpairReader(reader.id);
      if (!this.isConnected || this.editor !== editor) {
        if (this.isConnected && mode === "unpair") await this.#load();
        return;
      }
      scope?.commit(name);
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

  #stuckOrder(row: StuckPaymentRow): string {
    const order = t("payments.stuck.order").replace("{number}", String(row.orderNumber));
    return row.label ? `${order} · ${row.label}` : order;
  }

  #billOrder(row: StuckBillPaymentRow | StuckBillRefundRow): string {
    const order = t("payments.stuck.order").replace("{number}", String(row.orderNumber));
    return row.label ? `${order} · ${row.label}` : order;
  }

  async #loadBillRecovery(background: boolean): Promise<void> {
    const client = background ? (this.api.background ?? this.api) : this.api;
    const [payments, refunds] = await Promise.allSettled([
      client.listStuckBillPayments(),
      client.listStuckBillRefunds(),
    ]);
    if (payments.status === "fulfilled") {
      this.billPayments = payments.value;
      this.billPaymentLoadError = null;
    } else this.billPaymentLoadError = codeOf(payments.reason);
    if (refunds.status === "fulfilled") {
      this.billRefunds = refunds.value;
      this.billRefundLoadError = null;
    } else this.billRefundLoadError = codeOf(refunds.reason);
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
    this.#billLeave = leaveCoordinatorFor(this);
    if (mode === "attest")
      this.#billScope = this.#billLeave?.register({
        id: {},
        current: () => this.#billDraft(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.outcome === b.outcome && a.note === b.note && a.pin === b.pin,
        restore: () => {},
      });
  }

  #billOutcomeText(answer: BillRecoveryOutcome): string | null {
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
    try {
      const answer =
        target.kind === "payment"
          ? await this.api.resolveStuckBillPayment(target.row.billPaymentId)
          : await this.api.resolveStuckBillRefund(target.row.refundId);
      const message = this.#billOutcomeText(answer);
      this.billResult = {
        text: `${this.#billOrder(target.row)}: ${message ?? t("payments.bill.check_failed")}`,
        refused: message === null,
      };
    } catch (error) {
      this.billResult = {
        text: `${this.#billOrder(target.row)}: ${billRefusalText(error)}`,
        refused: true,
      };
    }
    try {
      await this.#loadBillRecovery(true);
    } finally {
      this.billBusy = false;
    }
  }

  async #attestBill(): Promise<void> {
    const action = this.billAction;
    if (action === null || action.mode !== "attest" || this.billBusy) return;
    const outcome = this.billOutcome;
    const note = this.billNote.trim();
    const pin = this.billPin;
    const scope = this.#billScope;
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
          : await this.api.attestStuckBillRefund(target.row.refundId, {
              outcome: outcome as "completed" | "failed",
              note,
              pin,
            });
      if (!this.isConnected || this.billAction !== action) return;
      scope?.commit({ outcome, note, pin });
      const message = this.#billOutcomeText(answer);
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
    if (state === "failed" || state === "declined" || state === "voided")
      return t("payments.bill.state_failed");
    if (
      state === "captured" ||
      state === "settled" ||
      state === "refunded" ||
      state === "partially_refunded" ||
      state === "accepted_offline"
    )
      return t("payments.bill.state_charged");
    if (state === "initiated") return t("payments.bill.state_started");
    return t("payments.bill.state_missing");
  }

  #renderBillRow(target: BillTarget): TemplateResult {
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
        [this.billPaymentLoadError, this.billRefundLoadError]
          .filter((code): code is string => code !== null)
          .map((code) => codeMessage(code)),
      ),
    ];
    if (!this.billPayments.length && !this.billRefunds.length && !this.billResult && !errors.length)
      return nothing;
    return html`<section
      class="stuck-section ${this.billPayments.length || this.billRefunds.length ? "pending" : ""}"
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
    </section>`;
  }

  #renderBillDialog(): TemplateResult | typeof nothing {
    const action = this.billAction;
    if (action === null) return nothing;
    if (action.mode === "check")
      return html`<wt-dialog
        data-test="bill-check-dialog"
        .open=${true}
        heading=${t("payments.bill.check_heading")}
        @wt-close=${() => {
          if (!this.billBusy) this.billAction = null;
        }}
      >
        <p>
          ${t("payments.bill.check_body").replace("{order}", this.#billOrder(action.target.row))}
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
    const bottom = [
      ...(this.billFormError && !this.#billPinRefused() ? [this.billFormErrorText] : []),
      ...(Object.keys(errors).length > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-dialog
      data-test="bill-attest-dialog"
      .open=${true}
      .beforeClose=${this.#billScope ? this.#beforeBillClose : undefined}
      ?dismissible=${!this.billBusy}
      heading=${t("payments.bill.attest_heading")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.billBusy && this.billAction === action) this.#closeBillAction();
      }}
    >
      <p>
        ${t("payments.bill.attest_body").replace("{order}", this.#billOrder(action.target.row))}
      </p>
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
          ?loading=${this.billBusy}
          ?disabled=${invalid}
          @click=${() => void this.#attestBill()}
          >${t("payments.bill.attest")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #openResolve(row: StuckPaymentRow): void {
    if (this.resolvingId !== null) return;
    this.confirmingStuck = row;
  }

  /** The list is refreshed whatever the answer; a failed refresh is a load failure, never the
   * check's own outcome. */
  async #resolve(): Promise<void> {
    const row = this.confirmingStuck;
    if (row === null) return;
    this.confirmingStuck = null;
    this.resolvingId = row.paymentId;
    this.stuckResult = null;
    const order = this.#stuckOrder(row);
    try {
      const outcome = stuckOutcomeText(await this.api.resolveStuckPayment(row.paymentId));
      this.stuckResult =
        outcome === null
          ? { text: `${order}: ${t("payments.stuck.failed")}`, refused: true }
          : { text: `${order}: ${outcome}`, refused: false };
    } catch (error) {
      this.stuckResult = { text: `${order}: ${stuckRefusalText(error)}`, refused: true };
    }
    try {
      this.stuck = await (this.api.background ?? this.api).listStuckPayments();
      this.stuckLoadError = null;
    } catch (error) {
      this.stuckLoadError = codeOf(error);
    } finally {
      this.resolvingId = null;
    }
  }

  #renderStuck(): TemplateResult | typeof nothing {
    if (this.stuck.length === 0 && this.stuckResult === null && this.stuckLoadError === null) {
      return nothing;
    }
    return html`<section
      class="stuck-section ${this.stuck.length ? "pending" : ""}"
      data-test="stuck-payments"
      aria-labelledby="stuck-heading"
    >
      <h2 id="stuck-heading">${t("payments.stuck.heading")}</h2>
      ${this.stuck.length ? html`<p>${t("payments.stuck.intro")}</p>` : nothing}
      ${
        this.stuckResult
          ? html`<p
              data-test="stuck-result"
              class=${this.stuckResult.refused ? "error" : ""}
              role=${this.stuckResult.refused ? "alert" : "status"}
            >
              ${this.stuckResult.text}
            </p>`
          : nothing
      }
      ${
        this.stuckLoadError
          ? html`<p data-test="stuck-load-error" class="error" role="alert">
              ${codeMessage(this.stuckLoadError)}
            </p>`
          : nothing
      }
      ${
        this.stuck.length
          ? html`<ul class="stuck-list">
              ${this.stuck.map((row) => this.#renderStuckRow(row))}
            </ul>`
          : nothing
      }
    </section>`;
  }

  #renderStuckRow(row: StuckPaymentRow): TemplateResult {
    const order = this.#stuckOrder(row);
    return html`<li class="stuck" data-test="stuck-${row.paymentId}">
      <div class="stuck-body">
        <p class="stuck-order">${order}</p>
        <dl class="stuck-details">
          <dt>${t("payments.stuck.device")}</dt>
          <dd data-test="stuck-device">${sourceLabel(row)}</dd>
          <dt>${t("payments.stuck.provider")}</dt>
          <dd>${this.#providerName(row.provider)}</dd>
          <dt>${t("payments.stuck.amount")}</dt>
          <dd>${formatMoney(row.amount, currentLocale())}</dd>
          <dt>${t("payments.stuck.started")}</dt>
          <dd><time datetime=${row.startedAt}>${formatAlertTime(row.startedAt)}</time></dd>
        </dl>
      </div>
      <wt-button
        variant="secondary"
        data-test="resolve-${row.paymentId}"
        aria-label=${`${t("payments.stuck.check")}: ${order}`}
        ?loading=${this.resolvingId === row.paymentId}
        ?disabled=${this.resolvingId !== null}
        @click=${() => this.#openResolve(row)}
        >${t("payments.stuck.check")}</wt-button
      >
    </li>`;
  }

  #renderResolveDialog(): TemplateResult | typeof nothing {
    const row = this.confirmingStuck;
    if (row === null) return nothing;
    const provider = this.#providerName(row.provider);
    return html`<wt-dialog
      data-test="resolve-dialog"
      .open=${true}
      heading=${t("payments.stuck.confirm_heading").replace("{provider}", provider)}
      @wt-close=${() => {
        this.confirmingStuck = null;
      }}
    >
      <p>
        ${t("payments.stuck.confirm_body")
          .replaceAll("{provider}", provider)
          .replace("{amount}", formatMoney(row.amount, currentLocale()))
          .replace("{order}", this.#stuckOrder(row))}
      </p>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-resolve"
          @click=${() => {
            this.confirmingStuck = null;
          }}
          >${t("action.cancel")}</wt-button
        >
        <wt-button data-test="confirm-resolve" @click=${() => void this.#resolve()}
          >${t("payments.stuck.confirm")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #renderProvider(provider: PaymentProviderRow): TemplateResult {
    const connected = provider.state === "connected";
    const simulator = this.#simulator();
    const badgeLabel = simulator
      ? t("payments.state.simulator")
      : connected
        ? t("payments.state.connected")
        : t("payments.state.not_connected");
    const name = this.#providerName(provider.providerId);
    const panel = this.#panelFor(provider.providerId);
    return html`<li class="provider" data-test="provider-${provider.providerId}">
      <div class="provider-head">
        <span class="provider-name">${name}</span>
        <span
          class="badge ${connected && !simulator ? "connected" : ""}"
          data-test="provider-state-${provider.providerId}"
          >${badgeLabel}</span
        >
        <div class="provider-actions">
          ${
            connected
              ? html`
                  <wt-button
                    variant="secondary"
                    data-test="add-reader-${provider.providerId}"
                    ?disabled=${this.busy}
                    @click=${() => void this.#onAddReader(provider.providerId)}
                    >${t("payments.add_reader")}</wt-button
                  >
                  <wt-button
                    variant="ghost"
                    data-test="disconnect-${provider.providerId}"
                    @click=${() => this.#onDisconnect(provider.providerId)}
                    >${
                      this.armedDisconnectId === provider.providerId
                        ? t("payments.disconnect_confirm")
                        : t("payments.disconnect")
                    }</wt-button
                  >
                `
              : html`<wt-button
                  variant="secondary"
                  data-test="connect-${provider.providerId}"
                  @click=${() => this.#onConnect(provider.providerId)}
                  >${t("payments.connect")}</wt-button
                >`
          }
        </div>
      </div>
      ${
        panel && this.connectingId === provider.providerId
          ? html`<div class="panel-slot" data-test="connect-form-${provider.providerId}">
              ${panel.renderConnectForm({
                request: this.request,
                onConnected: () => {
                  this.connectingId = null;
                  void this.#load();
                },
              })}
            </div>`
          : nothing
      }
      ${
        panel && this.addingId === provider.providerId
          ? html`<div class="panel-slot" data-test="add-reader-dialog-${provider.providerId}">
              ${panel.renderAddReader({
                request: this.request,
                onAdded: () => {
                  this.#pairSucceeded = true;
                  void this.#load();
                },
                onClose: () => {
                  this.addingId = null;
                  if (!this.#pairSucceeded) void this.#onAddReader(provider.providerId);
                },
              })}
            </div>`
          : nothing
      }
    </li>`;
  }

  #statusText(reader: ReaderRow): string {
    if (!reader.active) return t("payments.reader_disabled");
    const status = this.statuses.get(reader.id);
    if (status === undefined) return t("payments.reader_status_loading");
    if (status === "connection.timed_out") return codeMessage(status);
    if (status === "error" || status.unreachable) return t("payments.reader_status_unknown");
    if (status.pairingStatus === "processing") return t("payments.reader_pairing_processing");
    return status.online ? t("payments.reader_status_online") : t("payments.reader_status_offline");
  }

  #readerColumns(): DataTableColumn<ReaderRow>[] {
    return [
      {
        key: "name",
        label: t("payments.reader_col_name"),
        cell: (reader) => reader.name,
        sortValue: (reader) => reader.name,
      },
      {
        key: "provider",
        choosable: "shown",
        label: t("payments.reader_col_provider"),
        cell: (reader) => this.#providerName(reader.provider),
        sortValue: (reader) => this.#providerName(reader.provider),
      },
      {
        key: "status",
        choosable: "shown",
        label: t("payments.reader_col_status"),
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
        label: t("payments.reader_col_default_count"),
        align: "end",
        cell: (reader) => String(reader.deviceCount),
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
              variant="secondary"
              align="start"
              data-test=${`edit-${reader.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) => this.#openEditor(reader, "edit", event)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              variant="secondary"
              align="start"
              data-test=${`details-${reader.id}`}
              ?disabled=${this.busy}
              @click=${(event: Event) => this.#openEditor(reader, "details", event)}
              >${t("payments.details")}</wt-button
            >
            ${
              reader.active || reader.canEnable
                ? html`<wt-button
                    variant="secondary"
                    align="start"
                    data-test=${`${reader.active ? "disable" : "enable"}-${reader.id}`}
                    ?disabled=${this.busy}
                    @click=${() => void this.#mutate(() => (reader.active ? this.api.disableReader(reader.id) : this.api.enableReader(reader.id)))}
                  >
                    ${t(reader.active ? "payments.disable" : "payments.enable")}</wt-button
                  >`
                : nothing
            }
            ${
              this.providers?.find((p) => p.providerId === reader.provider)?.canUnpair
                ? html` <wt-button
                    variant="secondary"
                    align="start"
                    data-test=${`unpair-${reader.id}`}
                    ?disabled=${this.busy}
                    @click=${(event: Event) => this.#openEditor(reader, "unpair", event)}
                  >
                    ${t("payments.unpair").replace("{provider}", this.#providerName(reader.provider))}</wt-button
                  >`
                : nothing
            }
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
        ${t("payments.discovery_intro").replace("{provider}", this.#providerName(this.discoveringId))}
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
                          reader.status === "added"
                            ? html`<p>${reader.name} · ${t("payments.already_added")}</p>`
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
                        <p>
                          ${[reader.model, reader.serial, reader.status === "disabled" ? t("payments.reader_disabled") : undefined].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      ${
                        reader.status === "added"
                          ? nothing
                          : html`<wt-button
                              data-test=${`adopt-${reader.providerRef}`}
                              ?disabled=${this.busy || this.#nameInvalid(reader.providerRef)}
                              @click=${() => void this.#adopt(reader)}
                              >${t(reader.status === "disabled" ? "payments.enable" : "action.add")}</wt-button
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
    const unpair = t("payments.unpair").replace("{provider}", this.#providerName(reader.provider));
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
    const bottom = [
      ...(this.dialogError ? [codeMessage(this.dialogError)] : []),
      ...(invalid ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-dialog
      data-test="reader-editor"
      .open=${true}
      .dismissible=${mode !== "edit" || !this.busy}
      .beforeClose=${this.#editScope ? this.#beforeEditorClose : undefined}
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
            ></wt-input>`
          : mode === "unpair"
            ? html`<p>${t("payments.unpair_warning")}</p>`
            : html`<p>${this.#statusText(reader)}</p>
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
                ?disabled=${this.busy || invalid}
                @click=${() => void this.#saveEditor()}
                >${mode === "edit" ? t("action.save") : unpair}</wt-button
              >`
        }
      </wt-form-actions>
    </wt-dialog>`;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("payments.title")}</h1>
      ${
        this.#simulator()
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
      ${this.#renderStuck()} ${this.#renderBillRecovery()}

      <h2>${t("payments.providers_heading")}</h2>
      ${
        this.providers === undefined
          ? nothing
          : this.providers.length === 0
            ? html`<p>${t("payments.no_providers")}</p>`
            : html`<ul class="providers">
                ${this.providers.map((provider) => this.#renderProvider(provider))}
              </ul>`
      }

      <h2>${t("payments.readers_heading")}</h2>
      <div class="reader-tools">
        <wt-combobox
          name="reader-status-filter"
          label=${t("payments.reader_col_status")}
          search="auto"
          .options=${[
            { value: "active", label: t("payments.filter_active") },
            { value: "disabled", label: t("payments.filter_disabled") },
            { value: "all", label: t("payments.filter_all") },
          ]}
          .value=${this.readerFilter}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.readerFilter = event.detail.value;
          }}
        ></wt-combobox>
        <wt-button
          variant="secondary"
          data-test="refresh-readers"
          ?disabled=${this.refreshing || this.busy}
          @click=${() => void this.#loadStatuses(this.readers ?? [])}
          >${t("payments.refresh")}</wt-button
        >
      </div>
      <wt-data-table
        noMatchesMessage=${tableNoMatches()}
        aria-label=${t("payments.readers_heading")}
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
        .rows=${(this.readers ?? []).filter((reader) => this.readerFilter === "all" || reader.active === (this.readerFilter === "active"))}
        .columns=${this.#readerColumns()}
        .rowKey=${(reader: ReaderRow) => reader.id}
        .emptyMessage=${this.readers?.length ? tableNoMatches() : t("payments.readers_empty")}
      ></wt-data-table>
      ${keyed(this.#discoveryVersion, this.#renderDiscovery())}
      ${keyed(this.editor, this.#renderEditor())} ${this.#renderResolveDialog()}
      ${keyed(this.billAction, this.#renderBillDialog())}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-screen": PaymentsScreen;
  }
}
