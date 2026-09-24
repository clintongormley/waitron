import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  UrlStateController,
  baseStyles,
  setContentLanguages,
  type DataTableColumn,
} from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "../widgets/option-list-form.js";
import "../widgets/extra-list-form.js";
import type {
  DashboardApi,
  ExtraList,
  ExtraListInput,
  OptionList,
  OptionListInput,
  Product,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

type Kind = "extras" | "options";

type Modal = "view" | "delete";

type ModifierList = ExtraList | OptionList;

type Dependant = { id: string; name: string };
type UsageDependant = Dependant & { type: "product" | "menu" };

/**
 * No order count: options never touch an order, and an extras-list delete leaves an open order's
 * child lines alone because they name the product, not the list (spec
 * 2026-09-18-one-product-model-design.md §3.5).
 */
type ListDependants = { products: Dependant[]; menus: Dependant[] };

/** The list a modal is open on. The name is COPIED at open, so the heading does not depend on the
 * row still being in the list a later refresh loads. */
type Target = { kind: Kind; id: string; name: string };

/** The extras form picks its rows from products but never loads them: this screen reads them and
 * hands them over. */
@customElement("dashboard-modifiers-screen")
export class ModifiersScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-xl);
      }
      /* The tab strip names the panel, so the Add button sits alone on its row rather than under a
         second heading repeating the tab's own label. */
      .tab-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private tab: Kind = "extras";
  /** An unknown tab falls back to Extras and replaces rather than pushes, so Back still leaves the
   * screen. */
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "modifiers") return;
      const view = this.#url.read("view");
      this.tab = view === "options" ? "options" : "extras";
      if (view !== this.tab) this.#url.write({ view: this.tab }, true);
    },
    dashboardPath,
  );
  @state() private extraLists: ExtraList[] = [];
  @state() private optionLists: OptionList[] = [];
  @state() private products: Product[] = [];
  @state() private locales: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private loadError = false;
  @state() private error: string | null = null;
  /** A null `value` is a create. */
  @state() private editing: { kind: Kind; value: ModifierList | null } | null = null;
  @state() private busy = false;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private deleting: Target | null = null;
  @state() private dependants: ListDependants | null = null;
  /** The preview fetch failed. Distinct from `dependants === null` (still loading) and from a
   * loaded object whose lists are both empty (genuinely nothing depends on this). */
  @state() private dependantsError = false;
  @state() private viewing: Target | null = null;
  @state() private usage: ListDependants | null = null;
  /** The detail read failed. Distinct from `usage === null` (still loading) and from a loaded
   * object whose lists are both empty (nothing carries this list yet). */
  @state() private usageError = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );
  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("products"))
      this.#productById = new Map(this.products.map((product) => [product.id, product]));
    if (changed.has("products") || changed.has("extraLists"))
      this.#itemNamesByList = new Map(
        this.extraLists.map((list) => [list.id, this.#joinItemNames(list)]),
      );
  }
  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await Promise.all([
        this.#queries.watch("listExtraLists", [], (value) => {
          this.extraLists = value;
        }),
        this.#queries.watch("listOptionLists", [], (value) => {
          this.optionLists = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.locales = value;
          setContentLanguages(value);
        }),
        this.#queries.watch("listCatalogues", [], (value) => {
          this.#catalogueIds = value.map((catalogue) => catalogue.id);
        }),
      ]);
      await this.#loadProducts();
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }
  #catalogueIds: string[] = [];
  async #loadProducts(): Promise<void> {
    if (this.#catalogueIds.length === 0) {
      this.products = [];
      this.#queries.release("listProducts");
      return;
    }
    await this.#queries.watchGroup(
      "listProducts",
      this.#catalogueIds.map((id) => [id] as [string]),
      (lists) => {
        this.products = [...new Map(lists.flat().map((product) => [product.id, product])).values()];
      },
    );
  }
  #lists(kind: Kind): ModifierList[] {
    return kind === "extras" ? this.extraLists : this.optionLists;
  }
  #edit(kind: Kind, value: ModifierList | null): void {
    this.fieldErrors = {};
    this.editing = { kind, value };
  }
  #dependantsOf(kind: Kind, id: string): Promise<ListDependants> {
    return kind === "extras"
      ? this.api.getExtraListDependants(id)
      : this.api.getOptionListDependants(id);
  }
  /** How far each modal has been reopened. Only a response minted under the CURRENT count is
   * applied: comparing the open list's id alone cannot tell a superseded fetch from the current one
   * when the SAME list is reopened. */
  #generation: Record<Modal, number> = { view: 0, delete: 0 };
  #setTarget(modal: Modal, target: Target | null): void {
    if (modal === "view") this.viewing = target;
    else this.deleting = target;
  }
  #setDependants(modal: Modal, rows: ListDependants | null, failed: boolean): void {
    if (modal === "view") {
      this.usage = rows;
      this.usageError = failed;
    } else {
      this.dependants = rows;
      this.dependantsError = failed;
    }
  }
  #openModal(modal: Modal, kind: Kind, list: ModifierList): void {
    if (modal === "delete") this.error = null;
    this.#setDependants(modal, null, false);
    this.#setTarget(modal, { kind, id: list.id, name: list.name });
    void this.#loadDependants(modal, kind, list.id, ++this.#generation[modal]);
  }
  #closeModal(modal: Modal): void {
    if (modal === "delete") this.error = null;
    this.#setTarget(modal, null);
    this.#setDependants(modal, null, false);
    this.#generation[modal]++;
  }
  /** A failed fetch sets an error flag rather than empty lists, which would read as "nothing depends
   * on this" and have a manager confirm the cascade blind. */
  async #loadDependants(modal: Modal, kind: Kind, id: string, generation: number): Promise<void> {
    try {
      const rows = await this.#dependantsOf(kind, id);
      if (generation === this.#generation[modal]) this.#setDependants(modal, rows, false);
    } catch {
      if (generation === this.#generation[modal]) this.#setDependants(modal, null, true);
    }
  }
  /** The extras and options saves' refusals that name an input — `extras.invalid`, `options.invalid`,
   * `extras.product_has_variants` and both `*.translation_required` codes — declare `field`
   * (packages/catalogue/src/errors.ts). */
  #fieldOf(error: unknown): string {
    const params =
      typeof error === "object" && error !== null && "params" in error ? error.params : null;
    return params &&
      typeof params === "object" &&
      "field" in params &&
      typeof params.field === "string"
      ? params.field
      : "_form";
  }
  async #save(
    kind: Kind,
    event: CustomEvent<{ value: ExtraListInput | OptionListInput }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    const editing = this.editing;
    if (!editing) return;
    this.busy = true;
    this.fieldErrors = {};
    try {
      const value = event.detail.value;
      if (kind === "extras") {
        const input = value as ExtraListInput;
        if (editing.value) await this.api.updateExtraList(editing.value.id, input);
        else await this.api.createExtraList(input);
      } else {
        const input = value as OptionListInput;
        if (editing.value) await this.api.updateOptionList(editing.value.id, input);
        else await this.api.createOptionList(input);
      }
    } catch (error) {
      this.fieldErrors = { [this.#fieldOf(error)]: codeMessage(codeOf(error)) };
      this.busy = false;
      return;
    }
    // The write succeeded, so the editor closes BEFORE the refresh: a failed refresh is a load
    // failure, not a failed save, and a retained create form invites a duplicate submission.
    this.editing = null;
    this.busy = false;
    await this.#load();
  }
  async #delete(): Promise<void> {
    const target = this.deleting;
    if (this.busy || !target) return;
    this.busy = true;
    this.error = null;
    try {
      if (target.kind === "extras") await this.api.deleteExtraList(target.id);
      else await this.api.deleteOptionList(target.id);
    } catch (error) {
      this.error = codeMessage(codeOf(error));
      this.busy = false;
      return;
    }
    this.#closeModal("delete");
    this.busy = false;
    await this.#load();
  }
  /** Built in `willUpdate`, not per read: the joined names feed the items column's cell, search and
   * sort, which run per row on every keystroke. */
  #productById = new Map<string, Product>();
  #itemNamesByList = new Map<string, string>();
  /** A product the screen no longer holds is skipped: the editor's picker reports a missing one. */
  #joinItemNames(list: ExtraList): string {
    return list.items
      .map((item) => this.#productById.get(item.productId)?.name)
      .filter((name): name is string => name !== undefined)
      .join(", ");
  }
  #itemNames(list: ExtraList): string {
    return this.#itemNamesByList.get(list.id) ?? this.#joinItemNames(list);
  }
  #labelNames(list: OptionList): string {
    return list.labels.map((label) => label.name).join(", ");
  }
  #statusText(kind: Kind, list: ModifierList): string {
    return list.active ? t(`${kind}.active`) : t(`${kind}.not_in_use`);
  }
  #columns(kind: Kind): DataTableColumn<ModifierList>[] {
    const detail: DataTableColumn<ModifierList> =
      kind === "extras"
        ? {
            key: "items",
            label: t("extras.items"),
            searchValue: (list) => this.#itemNames(list as ExtraList),
            sortValue: (list) => this.#itemNames(list as ExtraList),
            cell: (list) => this.#itemNames(list as ExtraList),
          }
        : {
            key: "labels",
            label: t("options.labels"),
            searchValue: (list) => this.#labelNames(list as OptionList),
            sortValue: (list) => this.#labelNames(list as OptionList),
            cell: (list) => this.#labelNames(list as OptionList),
          };
    const row = kind === "extras" ? "extra" : "option";
    return [
      {
        key: "name",
        label: t("modifiers.name"),
        searchValue: (list) => list.name,
        sortValue: (list) => list.name,
        cell: (list) =>
          html`<wt-button
            variant="ghost"
            data-test=${`open-${row}-${list.id}`}
            @click=${() => this.#openModal("view", kind, list)}
            >${list.name}</wt-button
          >`,
      },
      detail,
      {
        key: "status",
        label: t(`${kind}.status`),
        sortValue: (list) => this.#statusText(kind, list),
        cell: (list) => this.#statusText(kind, list),
        filter: {
          label: t(`${kind}.status`),
          allLabel: t(`${kind}.filter_status_all`),
          value: (list) => (list.active ? "active" : "inactive"),
          options: [
            { value: "active", label: t(`${kind}.active`) },
            { value: "inactive", label: t(`${kind}.not_in_use`) },
          ],
        },
      },
      {
        key: "actions",
        label: t("modifiers.actions"),
        cell: (list) =>
          html`<wt-row-actions label=${`${t("modifiers.actions")}: ${list.name}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`edit-${row}-${list.id}`}
              @click=${() => this.#edit(kind, list)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`delete-${row}-${list.id}`}
              @click=${() => this.#openModal("delete", kind, list)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }
  #nameColumn<T extends Dependant>(): DataTableColumn<T> {
    return {
      key: "name",
      label: t("modifiers.name"),
      cell: (entry) => entry.name,
      searchValue: (entry) => entry.name,
      sortValue: (entry) => entry.name,
    };
  }
  #usageColumns(): DataTableColumn<UsageDependant>[] {
    return [
      this.#nameColumn<UsageDependant>(),
      {
        key: "type",
        label: t("modifiers.type"),
        cell: (entry) => t(`modifiers.usage_type.${entry.type}`),
        sortValue: (entry) => t(`modifiers.usage_type.${entry.type}`),
        filter: {
          label: t("modifiers.type"),
          allLabel: t("modifiers.filter_usage_type_all"),
          value: (entry) => entry.type,
          options: (["product", "menu"] as const).map((type) => ({
            value: type,
            label: t(`modifiers.usage_type.${type}`),
          })),
        },
      },
    ];
  }
  /** No `emptyMessage`: both call sites render this only when there are rows. */
  #dependantsTable(options: {
    testId: string;
    label: string;
    viewKey: string;
    searchLabel: string;
    noMatchesMessage: string;
    rows: Dependant[];
  }) {
    return html`<wt-data-table
      data-test=${options.testId}
      aria-label=${options.label}
      searchable
      searchLabel=${options.searchLabel}
      noMatchesMessage=${options.noMatchesMessage}
      viewKey=${options.viewKey}
      .rows=${options.rows}
      .columns=${[this.#nameColumn<Dependant>()]}
      .rowKey=${(entry: Dependant) => entry.id}
    ></wt-data-table>`;
  }
  #renderUsage() {
    if (this.usageError)
      return html`<p class="error" data-test="usage-error" role="alert">
        ${t("modifiers.usage_error")}
      </p>`;
    const usage = this.usage;
    if (!usage) return html`<wt-spinner></wt-spinner>`;
    const rows: UsageDependant[] = [
      ...usage.products.map((entry) => ({ ...entry, type: "product" as const })),
      ...usage.menus.map((entry) => ({ ...entry, type: "menu" as const })),
    ];
    return html`<wt-data-table
      data-test="list-usage"
      aria-label=${t("modifiers.products_modal")}
      searchable
      searchLabel=${t("modifiers.search_usage")}
      noMatchesMessage=${t("modifiers.usage_no_matches")}
      viewKey="waitron.modifiers.usage.table"
      sortKey="name"
      sortDirection="ascending"
      .rows=${rows}
      .columns=${this.#usageColumns()}
      .rowKey=${(entry: UsageDependant) => `${entry.type}:${entry.id}`}
      .emptyMessage=${t("modifiers.no_usage")}
    ></wt-data-table>`;
  }
  #deleteWarning(dependants: ListDependants): string {
    const parts = [t("modifiers.delete_warning_intro")];
    if (dependants.products.length > 0)
      parts.push(
        t("modifiers.delete_warning_products").replace(
          "{count}",
          String(dependants.products.length),
        ),
      );
    if (dependants.menus.length > 0)
      parts.push(
        t("modifiers.delete_warning_menus").replace("{count}", String(dependants.menus.length)),
      );
    return parts.join(" ");
  }
  #renderDependants() {
    if (this.dependantsError)
      return html`<p class="error" data-test="dependants-error" role="alert">
        ${t("modifiers.delete_preview_error")}
      </p>`;
    const dependants = this.dependants;
    if (!dependants) return html`<wt-spinner></wt-spinner>`;
    const hasCascade = dependants.products.length > 0 || dependants.menus.length > 0;
    return html`${
      hasCascade
        ? html`<p class="error" data-test="delete-warning" role="alert">
            ${this.#deleteWarning(dependants)}
          </p>`
        : nothing
    }${
      dependants.products.length > 0
        ? this.#dependantsTable({
            testId: "list-delete-products",
            label: t("modifiers.affected_products"),
            viewKey: "waitron.modifiers.delete.products.table",
            searchLabel: t("modifiers.search_products"),
            noMatchesMessage: t("modifiers.products_no_matches"),
            rows: dependants.products,
          })
        : nothing
    }${
      dependants.menus.length > 0
        ? this.#dependantsTable({
            testId: "list-delete-menus",
            label: t("modifiers.affected_menus"),
            viewKey: "waitron.modifiers.delete.menus.table",
            searchLabel: t("modifiers.search_menus"),
            noMatchesMessage: t("modifiers.menus_no_matches"),
            rows: dependants.menus,
          })
        : nothing
    }`;
  }
  /** Each kind's table has its own `viewKey`, so a sort chosen on one tab is not restored on the other. */
  #renderTab(kind: Kind) {
    const row = kind === "extras" ? "extra" : "option";
    return html`<div class="tab-actions">
        <wt-button
          data-test=${`add-${row}-list`}
          variant="primary"
          .disabled=${!this.locales}
          @click=${() => this.#edit(kind, null)}
          >${t(`${kind}.add`)}</wt-button
        >
      </div>
      <wt-data-table
        data-test=${`${row}-lists`}
        aria-label=${t(`${kind}.title`)}
        searchable
        searchLabel=${t(`${kind}.search`)}
        noMatchesMessage=${t(`${kind}.no_matches`)}
        viewKey=${`waitron.modifiers.${kind}.table`}
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.#lists(kind)}
        .columns=${this.#columns(kind)}
        .rowKey=${(list: ModifierList) => list.id}
        .emptyMessage=${t(`${kind}.empty`)}
      ></wt-data-table>`;
  }
  override render() {
    const editing = this.editing;
    return html`<h1>${t("modifiers.title")}</h1>
      ${this.loading ? html`<p role="status">${t("modifiers.loading")}</p>` : nothing}
      ${
        this.loadError
          ? html`<p class="error" role="alert" data-test="load-error">
                ${t("modifiers.load_error")}
              </p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("content_languages.retry")}</wt-button
              >`
          : nothing
      }
      ${
        !this.loading && !this.loadError
          ? html`<wt-tabs
              label=${t("modifiers.title")}
              .value=${this.tab}
              .items=${[
                { key: "extras", label: t("extras.title") },
                { key: "options", label: t("options.title") },
              ]}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                // A panel's content is slotted INTO this element, so any composed `wt-change` a
                // control inside a tab dispatches passes this listener with the same name. Only the
                // tab strip's own event — the one whose target is this element — is a tab choice.
                if (event.target !== event.currentTarget) return;
                this.tab = event.detail.value === "options" ? "options" : "extras";
                this.#url.write({ dashboard: "modifiers", view: this.tab });
              }}
            >
              <div slot="extras">${this.#renderTab("extras")}</div>
              <div slot="options">${this.#renderTab("options")}</div>
            </wt-tabs>`
          : nothing
      }
      <dashboard-extra-list-form
        .open=${editing?.kind === "extras"}
        .value=${editing?.kind === "extras" ? (editing.value as ExtraList | null) : null}
        .busy=${this.busy}
        .products=${this.products}
        .languages=${this.locales ?? { defaultLanguage: "en", languages: ["en"] }}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: ExtraListInput }>) =>
          void this.#save("extras", event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.editing = null;
        }}
      ></dashboard-extra-list-form>
      <dashboard-option-list-form
        .open=${editing?.kind === "options"}
        .value=${editing?.kind === "options" ? (editing.value as OptionList | null) : null}
        .busy=${this.busy}
        .languages=${this.locales ?? { defaultLanguage: "en", languages: ["en"] }}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: OptionListInput }>) =>
          void this.#save("options", event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.editing = null;
        }}
      ></dashboard-option-list-form>
      <wt-modal
        data-test="delete-dialog"
        .open=${this.deleting !== null}
        heading=${t("modifiers.delete_named").replace("{name}", this.deleting?.name ?? "")}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeModal("delete");
        }}
      >
        ${this.deleting ? this.#renderDependants() : nothing}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => this.#closeModal("delete")}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="confirm-delete"
            variant="danger"
            .disabled=${this.busy || !this.dependants}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        ></wt-modal
      >
      <wt-modal
        data-test="detail-modal"
        .open=${this.viewing !== null}
        heading=${this.viewing ? `${this.viewing.name} · ${t("modifiers.products_modal")}` : ""}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.#closeModal("view");
        }}
        >${this.viewing ? this.#renderUsage() : nothing}<wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="close-detail"
            variant="secondary"
            @click=${() => this.#closeModal("view")}
            >${t("action.close")}</wt-button
          ><wt-button
            data-test="detail-edit"
            variant="primary"
            .disabled=${!this.locales}
            @click=${() => this.#editViewed()}
            >${t("action.edit")}</wt-button
          ></wt-form-actions
        ></wt-modal
      >`;
  }
  /** Re-reads the list from the loaded rows, so an edit started after a background refresh edits what
   * the screen holds now rather than the snapshot the modal opened on. */
  #editViewed(): void {
    const viewing = this.viewing;
    if (!viewing) return;
    const list = this.#lists(viewing.kind).find((each) => each.id === viewing.id);
    this.#closeModal("view");
    if (list) this.#edit(viewing.kind, list);
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-modifiers-screen": ModifiersScreen;
  }
}
