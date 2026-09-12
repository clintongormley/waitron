import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import { CARD_PROVIDER_PANELS } from "@waitron/dashboard-modules";
import {
  registerCatalogue,
  type CardProviderPanel,
  type DashboardRequest,
  t as tRaw,
} from "@waitron/dashboard-kit";
import type {
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

/**
 * The generic Card-payments screen. It is the provider-NEUTRAL host: it lists the card providers with
 * their connection state, hosts each provider's own connect form and add-reader dialog (taken from
 * `CARD_PROVIDER_PANELS`, matched by `providerId`), and lists the readers in a data table. It names no
 * provider — a new provider is one new package plus one line in `@waitron/dashboard-modules`, and this
 * screen picks it up unchanged. It reaches the provider UIs ONLY through the registry (the APP_FORBIDDEN
 * seam rule), never by importing a provider package.
 *
 * `.api` is the provider-neutral client (list providers/readers, a reader's lazy status, disconnect,
 * retire); `.request` is the raw request primitive each provider panel builds its own typed client on
 * (the connect + add-reader forms POST through it). `.mode` is the venue's onboarding intent: in
 * `demo`/`prepare` the card path is a simulator, so the screen shows a "simulator" badge and a banner —
 * the API state stays connected/not_connected either way, so the Connect/Disconnect/Add-reader controls
 * track the real credential state regardless of mode.
 */
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
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  /** The provider-neutral HTTP client. */
  @property({ attribute: false }) api!: DashboardApi;

  /** The raw request primitive a provider panel builds its own typed client on (connect + add-reader
   * POST through it). Injected by the shell exactly as it injects it into module screens. */
  @property({ attribute: false }) request!: DashboardRequest;

  /** The venue's onboarding intent — governs the simulator banner/badge. Injected by the shell from
   * `getMe`; absent renders as live (no banner). */
  @property({ attribute: false }) mode?: "demo" | "prepare" | "live";

  /** The card-provider panels to host. Defaults to the registry; a test injects fakes so it need not
   * depend on the real provider elements. */
  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;

  @state() private providers?: PaymentProviderRow[];
  @state() private readers?: ReaderRow[];
  /** Per-reader live status, loaded lazily after the readers list; `undefined` means still loading. */
  @state() private statuses = new Map<string, ReaderStatusView | "error">();
  /** The provider whose connect form is open, or null. */
  @state() private connectingId: string | null = null;
  /** The provider whose add-reader dialog is open, or null. */
  @state() private addingId: string | null = null;
  /** The provider whose Disconnect is ARMED (awaiting a confirming second tap), or null. */
  @state() private armedDisconnectId: string | null = null;
  /** The reader whose Retire is ARMED (awaiting a confirming second tap), or null. */
  @state() private armedRetireId: string | null = null;
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Merge each panel's strings into the shared catalogue so its `displayNameKey` resolves even if the
    // panel module has not registered them by side-effect yet (the contract has the screen do this).
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
  }

  #simulator(): boolean {
    return this.mode === "demo" || this.mode === "prepare";
  }

  #panelFor(providerId: string): CardProviderPanel | undefined {
    return this.panels.find((p) => p.providerId === providerId);
  }

  /** The provider's display name from its panel (`displayNameKey`), or the raw token when no panel
   * names it (a provider with no UI panel — it still lists, just without localized chrome). */
  #providerName(providerId: string): string {
    const key = this.#panelFor(providerId)?.displayNameKey;
    return key ? tRaw(key) : providerId;
  }

  /** (Re)load the providers and readers, then each active reader's live status. A rejection anywhere
   * becomes the `errorKey` banner. Disarms the two-tap controls (an armed row may no longer exist). */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedDisconnectId = null;
    this.armedRetireId = null;
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

  /** Fetch each ACTIVE reader's status independently; a per-reader failure marks that row "error"
   * (rendered "Unknown"), never the whole screen. */
  async #loadStatuses(readers: ReaderRow[]): Promise<void> {
    await Promise.all(
      readers
        .filter((r) => r.active)
        .map(async (reader) => {
          try {
            const status = await this.api.readerStatus(reader.id);
            this.statuses = new Map(this.statuses).set(reader.id, status);
          } catch {
            this.statuses = new Map(this.statuses).set(reader.id, "error");
          }
        }),
    );
  }

  /** Run a mutation, then reload; a rejection becomes the `errorKey` banner. */
  async #mutate(action: () => Promise<unknown>): Promise<void> {
    this.errorKey = null;
    try {
      await action();
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onConnect(providerId: string): void {
    this.connectingId = this.connectingId === providerId ? null : providerId;
    this.addingId = null;
  }

  /** The two-tap disconnect: the first tap ARMS, a second on the armed provider confirms. Disconnect
   * drops the sealed credential, so the confirm gate is deliberate. */
  #onDisconnect(providerId: string): void {
    if (this.armedDisconnectId === providerId) {
      this.armedDisconnectId = null;
      void this.#mutate(() => this.api.disconnectPaymentProvider(providerId));
      return;
    }
    this.armedDisconnectId = providerId;
  }

  #onAddReader(providerId: string): void {
    this.addingId = this.addingId === providerId ? null : providerId;
    this.connectingId = null;
  }

  /** The two-tap retire: the first tap ARMS, a second on the armed reader confirms. Retire is a
   * soft-delete but not undoable from here, so the confirm gate mirrors the printers screen's idiom. */
  #onRetire(readerId: string): void {
    if (this.armedRetireId === readerId) {
      this.armedRetireId = null;
      void this.#mutate(() => this.api.retireReader(readerId));
      return;
    }
    this.armedRetireId = readerId;
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
                    @click=${() => this.#onAddReader(provider.providerId)}
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
                  void this.#load();
                },
                onClose: () => {
                  this.addingId = null;
                },
              })}
            </div>`
          : nothing
      }
    </li>`;
  }

  #statusText(reader: ReaderRow): string {
    if (!reader.active) return t("payments.reader_retired");
    const status = this.statuses.get(reader.id);
    if (status === undefined) return t("payments.reader_status_loading");
    if (status === "error") return t("payments.reader_status_unknown");
    if (status.pairingStatus === "processing") return t("payments.reader_pairing_processing");
    return status.online ? t("payments.reader_status_online") : t("payments.reader_status_offline");
  }

  #readerColumns(): DataTableColumn<ReaderRow>[] {
    const retireLabel = t("payments.retire");
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
          reader.active
            ? html`<wt-button
                variant="ghost"
                data-test="retire-${reader.id}"
                aria-label=${`${retireLabel} ${reader.name}`}
                @click=${() => this.#onRetire(reader.id)}
                >${
                  this.armedRetireId === reader.id ? t("payments.retire_confirm") : retireLabel
                }</wt-button
              >`
            : nothing,
      },
    ];
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
      <wt-data-table
        aria-label=${t("payments.readers_heading")}
        .rows=${this.readers ?? []}
        .columns=${this.#readerColumns()}
        .rowKey=${(reader: ReaderRow) => reader.id}
        .emptyMessage=${t("payments.readers_empty")}
      ></wt-data-table>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-screen": PaymentsScreen;
  }
}
