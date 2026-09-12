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
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

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

  /** Run a mutation, then reload; a rejection becomes the `errorKey` banner. */
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
      ${this.#renderDiscovery()} ${this.#renderEditor()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-payments-screen": PaymentsScreen;
  }
}
