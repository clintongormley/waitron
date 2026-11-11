import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
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
import "@waitron/ui/src/components/wt-row-actions.js";
import { CARD_PROVIDER_PANELS, MODULE_LABEL_KEYS } from "@waitron/dashboard-modules";
import {
  registerCatalogue,
  tableNoMatches,
  t as text,
  type CardProviderPanel,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import type { DashboardApi, ModuleRow, PaymentProviderRow } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { guideHref } from "../help-guide.js";

export const CARD_PROVIDERS_PATH = "/manage/modules/view/card-providers/state/all";

@customElement("dashboard-modules-screen")
export class ModulesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
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
      .error,
      wt-data-table::part(switch-reason) {
        color: var(--wt-color-danger);
      }
      wt-data-table::part(switch-reason) {
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) panels: readonly CardProviderPanel[] = CARD_PROVIDER_PANELS;
  @state() private catalogue?: ModuleRow[];
  @state() private providers?: PaymentProviderRow[];
  @state() private catalogueError = "";
  @state() private providersError = "";
  @state() private category = "all";
  @state() private filter = "enabled";
  @state() private busy = false;
  @state() private editor?: ModuleRow;
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
  readonly #catalogueQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.catalogueError = codeOf(error);
    },
  );
  readonly #providerQuery = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.providersError = codeOf(error);
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
    await Promise.all([
      this.#catalogueQuery.watch("listModules", [], (rows) => {
        this.catalogue = rows;
        this.catalogueError = "";
      }),
      this.#providerQuery.watch("listPaymentProviders", [], (rows) => {
        this.providers = rows;
        this.providersError = "";
      }),
    ]).catch(() => undefined);
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
  #columns(): DataTableColumn<ModuleRow>[] {
    return [
      {
        key: "name",
        label: text("modules.name"),
        cell: (row) =>
          html`${this.#name(row)}${row.category === "module" ? html`<span part="switch-reason">${text("modules.switch_unavailable")}</span>` : nothing}`,
      },
      {
        key: "state",
        label: text("modules.state"),
        cell: (row) => text(row.enabled ? "modules.enabled" : "modules.disabled"),
      },
      {
        key: "configuration",
        label: text("modules.configuration"),
        cell: (row) =>
          row.category === "module"
            ? text("modules.no_settings")
            : this.providers === undefined
              ? text("modules.loading")
              : text(
                  this.providers.find((provider) => provider.providerId === row.id)?.state ===
                    "connected"
                    ? "modules.configured"
                    : "modules.needs_setup",
                ),
      },
      {
        key: "actions",
        label: "",
        pinned: "end",
        cell: (row) =>
          html`<wt-row-actions label=${this.#name(row)}
            ><wt-button
              data-test=${`configure-${row.id}`}
              variant="secondary"
              @click=${(event: Event) => this.#configure(row, event)}
              >${text("modules.configure")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }
  override render() {
    const editor = this.editor;
    const panel =
      editor?.category === "card-provider"
        ? this.panels.find((panel) => panel.providerId === editor.id)
        : undefined;
    const rows = this.catalogue?.filter(
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
      ${this.catalogueError || this.providersError ? html`<p class="error" role="alert">${codeMessage(this.catalogueError || this.providersError)} <wt-button data-test="retry-modules" variant="secondary" @click=${() => void this.#load()}>${text("modules.retry")}</wt-button></p>` : nothing}
      ${rows ? html`<wt-data-table aria-label=${text("nav.modules")} .emptyMessage=${tableNoMatches()} noMatchesMessage=${tableNoMatches()} .rows=${rows} .columns=${this.#columns()} .rowKey=${(row: ModuleRow) => `${row.category}:${row.id}`} .wrapToFit=${true}></wt-data-table>` : html`<p>${text("modules.loading")}</p>`}
      <p><a href=${guideHref("modules.set-up")}>${text("modules.guide")}</a></p>
      ${
        editor
          ? html`<wt-dialog
              .open=${true}
              heading=${`${text("modules.configure")}: ${this.#name(editor)}`}
              .dismissible=${!this.busy}
              .beforeClose=${this.#beforeClose}
              @wt-close=${() => this.#closed()}
            >
              ${
                panel
                  ? html`<div class="configuration">
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
                    </div>`
                  : html`<p>${text("modules.no_settings")}</p>`
              }
              ${!panel ? html`<wt-button slot="footer" data-test="close-module" variant="secondary" @click=${() => void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel")}>${t("action.close")}</wt-button>` : nothing}
            </wt-dialog>`
          : nothing
      }
    `;
  }
}
