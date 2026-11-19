import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
  type LeaveReason,
} from "@waitron/ui";
import type { DashboardApi, MenuSummary, Product } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { dishRefusal } from "./set-menu-dish-choices.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";

@customElement("dashboard-set-menu-copy-dishes")
export class SetMenuCopyDishes extends LitElement {
  static override styles = baseStyles;
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @state() private sources: MenuSummary[] | null = null;
  @state() private source = "";
  @state() private failed = false;
  @state() private saving = false;
  @state() private error = "";
  #scope?: DraftScope<string>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.source,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.source = value;
      },
    }).scope;
    this.#scope.commit("");
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.failed = false;
    try {
      const menus = await (this.api.background ?? this.api).listMenus();
      this.sources = menus.filter(({ id, kind }) => id !== this.menuId && kind === "set_menu");
    } catch {
      this.failed = true;
    }
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.saving) return false;
    const leave = leaveCoordinatorFor(this);
    return (
      !leave || (await leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };

  async #copy(): Promise<void> {
    if (this.saving || !this.source) return;
    this.saving = true;
    this.error = "";
    try {
      const result = await this.api.copySetMenuDishes(this.menuId, this.source);
      this.#scope?.commit(this.source);
      this.renderRoot.querySelector("wt-modal")!.closeAfter("saved");
      this.dispatchEvent(
        new CustomEvent("set-menu-dishes-saved", { detail: result, bubbles: true, composed: true }),
      );
    } catch (error) {
      let products: Product[] = [];
      if (codeOf(error) === "set_menu.dish_sold_by_measure")
        products = await (this.api.background ?? this.api).listLibraryProducts().catch(() => []);
      this.error = dishRefusal(error, products);
    } finally {
      this.saving = false;
    }
  }

  #body() {
    if (this.failed)
      return html`<p role="alert">${t("menus.set_menu_sources_load_error")}</p>
        <wt-button variant="secondary" @click=${() => void this.#load()}
          >${t("menus.retry")}</wt-button
        >`;
    if (this.sources === null) return html`<p role="status">${t("menus.loading")}</p>`;
    if (!this.sources.length) return html`<p>${t("menus.set_menu_no_copy_source")}</p>`;
    return html`<wt-combobox
      name="sourceMenu"
      label=${t("menus.set_menu_kind")}
      required
      .value=${this.source}
      .disabled=${this.saving}
      .options=${this.sources.map(({ id, name }) => ({ value: id, label: name }))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.source = event.detail.value;
        this.error = "";
        this.#scope?.changed();
      }}
    ></wt-combobox>`;
  }

  override render() {
    const save = saveActionState(this.#scope);
    return html`<wt-modal
      open
      size="compact"
      heading=${t("menus.set_menu_copy_dishes")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        if (event.target === event.currentTarget)
          this.dispatchEvent(
            new CustomEvent("set-menu-dish-dialog-closed", { bubbles: true, composed: true }),
          );
      }}
      >${this.#body()}
      <wt-form-actions slot="footer" .error=${this.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${this.saving}
          @click=${() => void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        ${
          this.sources?.length
            ? html`<wt-button
                variant=${save.variant}
                .disabled=${save.unchanged || !this.source || this.saving}
                .loading=${this.saving}
                @click=${() => void this.#copy()}
                >${t("menus.set_menu_copy_confirm")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-copy-dishes": SetMenuCopyDishes;
  }
}
