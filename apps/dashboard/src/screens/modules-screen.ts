import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  pageTitleStyles,
  draftScopeFor,
  UrlStateController,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-toast.js";
import { CARD_PROVIDER_PANELS, MODULE_LABEL_KEYS } from "@waitron/dashboard-modules";
import {
  registerCatalogue,
  tableNoMatches,
  t as text,
  type CardProviderPanel,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import type { DashboardApi, ModuleRow, PaymentProviderRow, ReaderRow } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { guideHref } from "../help-guide.js";

export const CARD_PROVIDERS_PATH = "/modules/view/card-providers/state/all";

@customElement("dashboard-modules-screen")
export class ModulesScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .configuration {
        width: calc(var(--wt-tap-min) * 8);
        max-width: calc(90vw - var(--wt-space-5) * 2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(switch-reason) {
        color: var(--wt-color-text-muted);
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(disconnect-notice) {
        max-width: min(300px, calc(100vw - 4 * var(--wt-space-4)));
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ type: Boolean }) canManageProviders = false;
  @property({ type: Boolean }) canManageModules = false;
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;
  @state() private menu?: ModuleRow[];
  @state() private providers?: PaymentProviderRow[];
  @state() private readers?: ReaderRow[];
  @state() private readersError = "";
  @state() private disconnectError = "";
  @state() private armedDisconnectId: string | null = null;
  @state() private refusedDisconnectId: string | null = null;
  @state() private menuError = "";
  @state() private providersError = "";
  @state() private category = "all";
  @state() private filter = "enabled";
  @state() private busy = false;
  @state() private editor?: ModuleRow;
  @state() private switching?: ModuleRow;
  @state() private switchError = "";
  @state() private readerNames: string[] = [];
  #scope?: DraftScope<null>;
  #leave?: LeaveCoordinator;
  #opener?: HTMLElement;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "modules") return;
      this.category = this.#url.read("view") === "card-providers" ? "card-providers" : "all";
      const state = this.#url.read("state");
      this.filter = state === "disabled" || state === "all" ? state : "enabled";
    },
    dashboardPath,
  );
  readonly #menuQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.menuError = codeOf(error);
    },
  );
  readonly #providerQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.providersError = codeOf(error);
    },
  );
  readonly #readerQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readersError = codeOf(error);
    },
  );
  override connectedCallback(): void {
    super.connectedCallback();
    for (const panel of this.panels) registerCatalogue(panel.strings);
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    this.armedDisconnectId = null;
    await Promise.all([
      this.#menuQuery.watch("listModules", [], (rows) => {
        this.menu = rows;
        this.menuError = "";
      }),
      this.#providerQuery.watch(
        "listPaymentProviders",
        [],
        (rows) => {
          this.providers = rows;
          this.providersError = "";
          if (
            !rows.some(
              (row) => row.providerId === this.armedDisconnectId && row.state === "connected",
            )
          )
            this.armedDisconnectId = null;
        },
        { passive: true },
      ),
      this.#readerQuery.watch(
        "listReaders",
        [],
        (rows) => {
          this.readers = rows;
          this.readersError = "";
        },
        { passive: true },
      ),
    ]).catch(() => undefined);
  }
  #onDisconnect(providerId: string): void {
    if (this.busy) return;
    this.refusedDisconnectId = null;
    if (this.readers?.some((reader) => reader.provider === providerId && reader.active)) {
      this.armedDisconnectId = null;
      this.refusedDisconnectId = providerId;
      return;
    }
    if (this.armedDisconnectId === providerId) {
      this.armedDisconnectId = null;
      void this.#disconnect(providerId);
    } else this.armedDisconnectId = providerId;
  }
  async #disconnect(providerId: string): Promise<void> {
    this.busy = true;
    this.disconnectError = "";
    try {
      try {
        await this.api.disconnectPaymentProvider(providerId);
      } catch (error) {
        if (codeOf(error) !== "payment.provider_in_use") throw error;
        this.refusedDisconnectId = providerId;
      }
      await this.#load();
    } catch (error) {
      this.disconnectError = codeOf(error);
    } finally {
      this.busy = false;
    }
  }
  #filters(category: string, filter: string): void {
    this.category = category;
    this.filter = filter;
    this.#url.write({ dashboard: "modules", view: category, state: filter });
  }
  #name(row: ModuleRow): string {
    const key =
      row.category === "card-provider"
        ? this.panels.find((panel) => panel.providerId === row.id)?.displayNameKey
        : MODULE_LABEL_KEYS[row.id];
    return key ? text(key) : row.id;
  }
  #configure(row: ModuleRow, event: Event): void {
    this.#opener = event.currentTarget as HTMLElement;
    const { coordinator, scope } = draftScopeFor(this, {
      id: this,
      current: () => null,
      snapshot: (value) => value,
      equal: () => true,
      restore() {},
    });
    this.#scope = scope;
    this.#leave = coordinator;
    this.editor = row;
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  #closed(): void {
    this.editor = undefined;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#opener?.focus();
  }
  #saved(): void {
    this.renderRoot.querySelector<WtDialog>("wt-dialog")?.closeAfter("saved");
    this.#closed();
    void this.#load();
  }
  async #switchProvider(): Promise<void> {
    const row = this.switching;
    if (!row || this.busy) return;
    this.busy = true;
    this.switchError = "";
    this.readerNames = [];
    try {
      const current = this.menu?.find(
        (entry) => entry.id === row.id && entry.category === row.category,
      );
      if (row.category === "module")
        await this.api.setModuleState(row.id, !row.enabled, current?.revision ?? row.revision ?? 0);
      else
        await this.api.setPaymentProviderState(
          row.id,
          !row.enabled,
          current?.revision ?? row.revision ?? 0,
        );
      if (row.category === "module") this.#filters(this.category, "all");
      this.switching = undefined;
      void this.#load();
    } catch (error) {
      this.switchError = codeOf(error);
      const names = (error as { params?: { readerNames?: unknown } } | null)?.params?.readerNames;
      this.readerNames = Array.isArray(names)
        ? names.filter((name): name is string => typeof name === "string")
        : [];
      if (this.switchError === "settings.out_of_date") await this.#load();
    } finally {
      this.busy = false;
    }
  }
  #configuration(row: ModuleRow): string {
    if (row.category === "module") return "";
    if (this.providersError) return text("modules.configuration_unavailable");
    if (this.providers === undefined) return text("modules.loading");
    return text(
      this.providers.find((provider) => provider.providerId === row.id)?.state === "connected"
        ? "modules.configured"
        : "modules.needs_setup",
    );
  }
  #columns(): DataTableColumn<ModuleRow>[] {
    return [
      {
        key: "name",
        label: text("modules.name"),
        cell: (row) => this.#name(row),
        searchValue: (row) => this.#name(row),
      },
      {
        key: "state",
        choosable: "shown",
        label: text("modules.state"),
        cell: (row) =>
          html`${text(row.enabled ? "modules.enabled" : "modules.disabled")}${row.applied !== undefined && row.applied !== row.enabled ? html`<span part="switch-reason">${text("modules.restart_pending")}</span>` : nothing}`,
      },
      {
        key: "configuration",
        choosable: "shown",
        label: text("modules.configuration"),
        cell: (row) => this.#configuration(row),
        searchValue: (row) => this.#configuration(row),
      },
      {
        key: "actions",
        label: "",
        pinned: "end",
        cell: (row) =>
          row.category === "module" && this.canManageModules
            ? html`<wt-row-actions label=${this.#name(row)}
                ><wt-button
                  data-test=${`switch-${row.id}`}
                  @click=${() => {
                    this.switching = row;
                    this.switchError = "";
                  }}
                  >${text(row.enabled ? "modules.turn_off" : "modules.turn_on")}</wt-button
                ></wt-row-actions
              >`
            : row.category === "card-provider"
              ? this.#providerActions(row)
              : nothing,
      },
    ];
  }
  #providerActions(row: ModuleRow) {
    const panel = this.panels.some((panel) => panel.providerId === row.id);
    const connected = this.providers?.some(
      (provider) => provider.providerId === row.id && provider.state === "connected",
    );
    if (!panel && !connected) return nothing;
    return html`<wt-row-actions
      label=${this.#name(row)}
      @click=${(event: Event) => {
        const menu = event.currentTarget as HTMLElement;
        if (
          event
            .composedPath()
            .some(
              (node) =>
                node instanceof HTMLElement &&
                node.matches('button[part~="trigger"]') &&
                node.getRootNode() === menu.shadowRoot,
            )
        )
          this.armedDisconnectId = null;
      }}
    >
      ${panel ? html`<wt-button data-test=${`configure-${row.id}`} @click=${(event: Event) => this.#configure(row, event)}>${text("modules.configure")}</wt-button>` : nothing}
      ${
        panel &&
        this.canManageProviders &&
        this.menu?.find((module) => module.id === "payments" && module.category === "module")
          ?.enabled !== false
          ? html`<wt-button
              data-test=${`switch-${row.id}`}
              @click=${() => {
                this.switching = row;
                this.switchError = "";
                this.readerNames = [];
              }}
              >${text(row.enabled ? "modules.turn_off" : "modules.turn_on")}</wt-button
            >`
          : nothing
      }
      ${
        connected
          ? html`<wt-button
                data-keep-open
                data-test=${`disconnect-${row.id}`}
                variant=${this.armedDisconnectId === row.id ? "danger" : "ghost"}
                data-armed=${this.armedDisconnectId === row.id ? "true" : nothing}
                ?disabled=${this.busy}
                @click=${() => this.#onDisconnect(row.id)}
                >${t(this.armedDisconnectId === row.id ? "payments.disconnect_confirm" : "payments.disconnect")}</wt-button
              >
              <wt-toast
                part="disconnect-notice"
                data-test=${`disconnect-notice-${row.id}`}
                tone="error"
                .open=${this.refusedDisconnectId === row.id}
                .message=${codeMessage("payment.provider_in_use")}
                .closeLabel=${t("action.close")}
                @wt-close=${() => {
                  this.refusedDisconnectId = null;
                }}
              ></wt-toast>`
          : nothing
      }
    </wt-row-actions>`;
  }
  override render() {
    const readError = this.menuError || this.providersError || this.readersError;
    const editor = this.editor;
    const panel =
      editor?.category === "card-provider"
        ? this.panels.find((panel) => panel.providerId === editor.id)
        : undefined;
    const rows = this.menu?.filter(
      (row) =>
        (this.category !== "card-providers" || row.category === "card-provider") &&
        (this.filter === "all" || row.enabled === (this.filter === "enabled")),
    );
    return html`
      <div class="toolbar">
        <h1>${text("nav.modules")}</h1>
        <wt-button data-test="add-module" @click=${() => this.#filters(this.category, "disabled")}
          >${text("modules.add")}</wt-button
        >
      </div>
      <div class="filters">
        <wt-combobox
          name="category"
          stable-width
          label=${text("modules.category")}
          .value=${this.category}
          .options=${[
            { value: "all", label: text("modules.all_categories") },
            { value: "card-providers", label: text("modules.providers") },
          ]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#filters(event.detail.value, this.filter)}
        ></wt-combobox>
        <wt-combobox
          name="state"
          stable-width
          label=${text("modules.state")}
          .value=${this.filter}
          .options=${["enabled", "disabled", "all"].map((value) => ({ value, label: text(`modules.${value}`) }))}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#filters(this.category, event.detail.value)}
        ></wt-combobox>
      </div>
      ${this.disconnectError ? html`<p class="error" role="alert">${codeMessage(this.disconnectError)}</p>` : nothing}
      ${readError ? html`<p class="error" role="alert">${codeMessage(readError)} <wt-button data-test="retry-modules" variant="secondary" @click=${() => void this.#load()}>${text("modules.retry")}</wt-button></p>` : nothing}
      ${
        rows
          ? html`<wt-data-table
              aria-label=${text("nav.modules")}
              viewKey="waitron.modules.table"
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
              searchable
              searchLabel=${text("modules.search")}
              .emptyMessage=${tableNoMatches()}
              noMatchesMessage=${tableNoMatches()}
              .rows=${rows}
              .columns=${this.#columns()}
              .rowKey=${(row: ModuleRow) => `${row.category}:${row.id}`}
              .wrapToFit=${true}
            ></wt-data-table>`
          : html`<p>${text("modules.loading")}</p>`
      }
      <p><a href=${guideHref("modules.set-up")}>${text("modules.guide")}</a></p>
      ${
        this.switching
          ? html`<wt-dialog
              .open=${true}
              heading=${`${text(this.switching.enabled ? "modules.turn_off" : "modules.turn_on")}: ${this.#name(this.switching)}`}
              .dismissible=${!this.busy}
              @wt-close=${() => {
                this.switching = undefined;
              }}
            >
              <p>
                ${text(this.switching.category === "module" ? `modules.${this.switching.id === "workforce-es" ? "workforce_es" : this.switching.id}_explanation` : this.switching.enabled ? "modules.off_explanation" : "modules.on_explanation")}
              </p>
              ${
                this.switchError && this.switching.category === "card-provider"
                  ? html`<p class="error" role="alert" data-test="provider-state-error">
                      ${this.switchError === "payment.provider_in_use" ? text("modules.remove_readers") : codeMessage(this.switchError)}
                      ${this.readerNames.join(", ")}
                      ${this.switchError === "payment.provider_in_use" ? html`<a data-test="remove-readers" href="/payments">${text("modules.open_readers")}</a>` : nothing}
                    </p>`
                  : nothing
              }
              <wt-form-actions
                slot="footer"
                error=${this.switching.category === "module" && this.switchError ? codeMessage(this.switchError) : ""}
                ><wt-button
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.switching = undefined;
                  }}
                  >${t("action.cancel")}</wt-button
                ><wt-button
                  variant="primary"
                  data-test="confirm-provider-state"
                  ?loading=${this.busy}
                  ?disabled=${this.busy}
                  @click=${() => void this.#switchProvider()}
                  >${text(this.switching.enabled ? "modules.turn_off" : "modules.turn_on")}</wt-button
                ></wt-form-actions
              >
            </wt-dialog>`
          : nothing
      }
      ${
        editor && panel
          ? html`<wt-dialog
              .open=${true}
              heading=${`${text("modules.configure")}: ${this.#name(editor)}`}
              .dismissible=${!this.busy}
              .beforeClose=${this.#beforeClose}
              @wt-close=${() => this.#closed()}
            >
              <div class="configuration">
                ${panel.renderConnectForm({
                  request: this.request,
                  onConnected: () => this.#saved(),
                  actions: {
                    saveLabel: t("action.save"),
                    cancelLabel: t("action.cancel"),
                    onCancel: () => {
                      void this.renderRoot
                        .querySelector<WtDialog>("wt-dialog")
                        ?.requestClose("cancel");
                    },
                    onBusy: (busy) => {
                      this.busy = busy;
                    },
                  },
                })}
              </div>
            </wt-dialog>`
          : nothing
      }
    `;
  }
}
