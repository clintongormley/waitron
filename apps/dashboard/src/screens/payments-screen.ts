import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import { formatMoney } from "@waitron/shared";
import {
  registerCatalogue,
  type CardProviderPanel,
  type DashboardRequest,
  t as tRaw,
} from "@waitron/dashboard-kit";
import type {
  AvailableReader,
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
  StuckPaymentResolution,
  StuckPaymentRow,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { formatAlertTime } from "../widgets/alert-format.js";

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
  if (resolution.outcome === "released") return t("payments.stuck.released");
  return null;
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
        font-weight: 600;
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
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  /** A provider panel builds its own typed client on this. */
  @property({ attribute: false }) request!: DashboardRequest;

  @property({ attribute: false }) mode?: "demo" | "prepare" | "live";

  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  @state() private providers?: PaymentProviderRow[];
  @state() private readers?: ReaderRow[];
  @state() private statuses = new Map<string, ReaderStatusView | "error">();
  @state() private connectingId: string | null = null;
  @state() private addingId: string | null = null;
  @state() private armedDisconnectId: string | null = null;
  @state() private discoveringId: string | null = null;
  @state() private available?: AvailableReader[];
  @state() private listingFailed = false;
  @state() private drafts: Record<string, string> = {};
  @state() private invalidNames = new Set<string>();
  @state() private readerFilter = "active";
  @state() private editor: { reader: ReaderRow; mode: "edit" | "details" | "unpair" } | null = null;
  @state() private editName = "";
  @state() private nameInvalid = false;
  @state() private dialogError: string | null = null;
  @state() private busy = false;
  @state() private refreshing = false;
  #opener?: HTMLElement;
  #discoveryVersion = 0;
  #statusVersion = 0;
  #pairSucceeded = false;
  @state() private errorKey: string | null = null;
  @state() private stuck: StuckPaymentRow[] = [];
  @state() private stuckLoadError: string | null = null;
  @state() private confirmingStuck: StuckPaymentRow | null = null;
  @state() private resolvingId: string | null = null;
  @state() private stuckResult: { text: string; refused: boolean } | null = null;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.stuckLoadError = codeOf(error);
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    // So each panel's `displayNameKey` resolves even before its module has registered its strings.
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
    void this.#queries
      .watch("listStuckPayments", [], (rows) => {
        this.stuck = rows;
        this.stuckLoadError = null;
      })
      .catch(() => undefined);
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
    this.errorKey = null;
    this.armedDisconnectId = null;
    try {
      const [providers, readers] = await Promise.all([
        this.api.listPaymentProviders(),
        this.api.listReaders(),
      ]);
      this.providers = providers;
      this.readers = readers;
      this.statuses = new Map();
      void this.#loadStatuses(readers);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** One reader's failed status marks only that row, never the whole screen. */
  async #loadStatuses(readers: ReaderRow[]): Promise<void> {
    const version = ++this.#statusVersion;
    this.refreshing = true;
    await Promise.all(
      readers
        .filter((r) => r.active)
        .map(async (reader) => {
          try {
            const status = await this.api.readerStatus(reader.id);
            if (version === this.#statusVersion)
              this.statuses = new Map(this.statuses).set(reader.id, status);
          } catch {
            if (version === this.#statusVersion)
              this.statuses = new Map(this.statuses).set(reader.id, "error");
          }
        }),
    );
    if (version === this.#statusVersion) this.refreshing = false;
  }

  async #mutate(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
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
    this.discoveringId = providerId;
    this.addingId = null;
    this.connectingId = null;
    this.available = undefined;
    this.listingFailed = false;
    this.invalidNames = new Set();
    this.dialogError = null;
    const version = ++this.#discoveryVersion;
    try {
      const readers = await this.api.availableReaders(providerId);
      if (version !== this.#discoveryVersion) return;
      this.available = readers;
      this.drafts = Object.fromEntries(readers.map((reader) => [reader.providerRef, reader.name]));
    } catch {
      if (version === this.#discoveryVersion) this.listingFailed = true;
    }
  }

  #closeDiscovery(): void {
    this.#discoveryVersion++;
    this.discoveringId = null;
  }

  async #pairNew(): Promise<void> {
    const id = this.discoveringId!;
    this.#closeDiscovery();
    await this.updateComplete;
    this.#pairSucceeded = false;
    this.addingId = id;
  }

  async #adopt(reader: AvailableReader): Promise<void> {
    if (this.busy) return;
    const name = (this.drafts[reader.providerRef] ?? "").trim();
    if (!name) {
      this.invalidNames = new Set(this.invalidNames).add(reader.providerRef);
      return;
    }
    this.busy = true;
    this.dialogError = null;
    try {
      await this.api.adoptReader({
        providerId: this.discoveringId!,
        providerRef: reader.providerRef,
        name,
      });
      this.#closeDiscovery();
      await this.#load();
    } catch (error) {
      this.dialogError = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  #openEditor(reader: ReaderRow, mode: "edit" | "details" | "unpair", event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    this.#opener = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    this.editor = { reader, mode };
    this.editName = reader.name;
    this.nameInvalid = false;
    this.dialogError = null;
  }

  async #closeEditor(): Promise<void> {
    this.editor = null;
    await this.updateComplete;
    if (this.#opener?.isConnected) this.#opener.focus();
  }

  async #saveEditor(): Promise<void> {
    if (this.busy || this.editor === null) return;
    const { reader, mode } = this.editor;
    const name = this.editName.trim();
    if (mode === "edit" && !name) {
      this.nameInvalid = true;
      return;
    }
    this.busy = true;
    this.dialogError = null;
    try {
      if (mode === "edit") await this.api.renameReader(reader.id, name);
      else await this.api.unpairReader(reader.id);
      await this.#closeEditor();
      await this.#load();
    } catch (error) {
      this.dialogError = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  #stuckOrder(row: StuckPaymentRow): string {
    const order = t("payments.stuck.order").replace("{number}", String(row.orderNumber));
    return row.label ? `${order} · ${row.label}` : order;
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
          <dt>${t("payments.stuck.till")}</dt>
          <dd>${row.tillName}</dd>
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
        label: t("payments.reader_col_provider"),
        cell: (reader) => this.#providerName(reader.provider),
        sortValue: (reader) => this.#providerName(reader.provider),
      },
      {
        key: "status",
        label: t("payments.reader_col_status"),
        cell: (reader) =>
          html`<span data-test="reader-status-${reader.id}">${this.#statusText(reader)}</span>`,
      },
      {
        key: "battery",
        label: t("payments.reader_col_battery"),
        cell: (reader) => {
          const status = this.statuses.get(reader.id);
          const battery = status && status !== "error" ? status.batteryPercent : undefined;
          return html`<span data-test=${`reader-battery-${reader.id}`}
            >${battery === undefined ? "" : `${battery}%`}</span
          >`;
        },
      },
      {
        key: "deviceCount",
        label: t("payments.reader_col_default_count"),
        align: "end",
        cell: (reader) => String(reader.deviceCount),
        sortValue: (reader) => reader.deviceCount,
      },
      {
        key: "actions",
        label: t("payments.reader_col_actions"),
        align: "end",
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
    return html`<wt-dialog
      data-test="reader-discovery"
      .open=${true}
      heading=${t("payments.discovery_heading")}
      @wt-close=${() => this.#closeDiscovery()}
    >
      <p>
        ${t("payments.discovery_intro").replace("{provider}", this.#providerName(this.discoveringId))}
      </p>
      ${this.dialogError ? html`<p class="error" role="alert">${codeMessage(this.dialogError)}</p>` : nothing}
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${this.invalidNames.size ? [t("payments.name_required")] : []}
      ></wt-form-error-summary>
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
                                .error=${this.invalidNames.has(reader.providerRef) ? t("payments.name_required") : ""}
                                ?disabled=${this.busy}
                                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, (event.currentTarget as HTMLElement).closest(".discovery-row")!.querySelector("wt-button"))}
                                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                                  this.drafts = {
                                    ...this.drafts,
                                    [reader.providerRef]: event.detail.value,
                                  };
                                  const errors = new Set(this.invalidNames);
                                  errors.delete(reader.providerRef);
                                  this.invalidNames = errors;
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
                              ?disabled=${this.busy}
                              @click=${() => void this.#adopt(reader)}
                              >${t(reader.status === "disabled" ? "payments.add_again" : "action.add")}</wt-button
                            >`
                      }
                    </div>`,
                )
      }
      <p>${t("payments.pair_hint")}</p>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-discovery"
          @click=${() => this.#closeDiscovery()}
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
    const { reader, mode } = this.editor;
    const unpair = t("payments.unpair").replace("{provider}", this.#providerName(reader.provider));
    const heading =
      mode === "edit"
        ? t("payments.edit_reader")
        : mode === "unpair"
          ? unpair
          : t("payments.details");
    const status = this.statuses.get(reader.id);
    const details =
      status && status !== "error"
        ? [
            [t("payments.connection"), status.connection],
            [t("payments.activity"), status.activity],
            [t("payments.firmware"), status.firmwareVersion],
            [t("payments.last_seen"), status.lastSeenAt],
            [t("payments.model"), status.model],
            [t("payments.serial"), status.serial],
          ].filter(([, value]) => value !== undefined)
        : [];
    return html`<wt-dialog
      data-test="reader-editor"
      .open=${true}
      heading=${`${heading}: ${reader.name}`}
      @wt-close=${() => void this.#closeEditor()}
    >
      ${this.dialogError ? html`<p class="error" role="alert">${codeMessage(this.dialogError)}</p>` : nothing}
      ${
        mode === "edit"
          ? html` <wt-form-error-summary
                heading=${t("form.error_heading")}
                .errors=${this.nameInvalid ? [t("payments.name_required")] : []}
              ></wt-form-error-summary>
              <wt-input
                name="reader-name"
                required
                data-test="edit-reader-name"
                label=${t("payments.reader_col_name")}
                .value=${this.editName}
                .error=${this.nameInvalid ? t("payments.name_required") : ""}
                ?disabled=${this.busy}
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-test=save-reader]"))}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  this.editName = event.detail.value;
                  this.nameInvalid = false;
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
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="close-reader-editor"
          @click=${() => void this.#closeEditor()}
          >${t(mode === "details" ? "action.close" : "action.cancel")}</wt-button
        >
        ${
          mode === "details"
            ? nothing
            : html`<wt-button
                data-test=${mode === "edit" ? "save-reader" : "confirm-unpair"}
                ?disabled=${this.busy}
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
      ${this.#renderStuck()}

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
        <label
          >${t("payments.reader_col_status")}
          <select
            name="reader-status-filter"
            .value=${this.readerFilter}
            @change=${(event: Event) => {
              this.readerFilter = (event.target as HTMLSelectElement).value;
            }}
          >
            <option value="active">${t("payments.filter_active")}</option>
            <option value="disabled">${t("payments.filter_disabled")}</option>
            <option value="all">${t("payments.filter_all")}</option>
          </select></label
        >
        <wt-button
          variant="secondary"
          data-test="refresh-readers"
          ?disabled=${this.refreshing || this.busy}
          @click=${() => void this.#loadStatuses(this.readers ?? [])}
          >${t("payments.refresh")}</wt-button
        >
      </div>
      <wt-data-table
        aria-label=${t("payments.readers_heading")}
        .rows=${(this.readers ?? []).filter((reader) => this.readerFilter === "all" || reader.active === (this.readerFilter === "active"))}
        .columns=${this.#readerColumns()}
        .rowKey=${(reader: ReaderRow) => reader.id}
        .emptyMessage=${t("payments.readers_empty")}
      ></wt-data-table>
      ${this.#renderDiscovery()} ${this.#renderEditor()} ${this.#renderResolveDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-screen": PaymentsScreen;
  }
}
