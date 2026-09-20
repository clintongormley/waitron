import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, setContentLanguages, type DataTableColumn } from "@waitron/ui";
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
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

/** The two tabs, and the two kinds of modifier list behind them. */
type Kind = "extras" | "options";

/** A list of either kind, reduced to what this screen's tables, modals and dialogs read. */
type ModifierList = ExtraList | OptionList;

/** A product or menu item that carries a list, as both dependants readers return it. */
type Dependant = { id: string; name: string };
type UsageDependant = Dependant & { type: "product" | "menu" };

/**
 * What deleting a list of either kind would touch. `extraListDependants` and `optionListDependants`
 * (packages/catalogue/src/{extras,options}.ts) each return exactly these two arrays and no order
 * count: options never touch an order, and an extras-list delete leaves an open order's child lines
 * alone because they name the PRODUCT, not the list (spec
 * 2026-09-18-one-product-model-design.md §3.5).
 */
type ListDependants = { products: Dependant[]; menus: Dependant[] };

/** The list a modal is open on. The name is COPIED at open, so the heading does not depend on the
 * row still being in the list a later refresh loads. */
type Target = { kind: Kind; id: string; name: string };

/**
 * The Modifiers page: one screen, two tabs — Extras and Options — each the Categories-pattern table
 * for its kind (spec 2026-09-18-one-product-model-design.md §9.2). A tab has a header Add button, a
 * searchable and filterable table whose sort is remembered under its OWN session-storage key, a
 * detail modal with Edit and Close, and a delete flow that previews what would be lost.
 *
 * Neither kind's delete previews an order count — see {@link ListDependants} — and neither is
 * blocked before the write: `options.in_use` and `extras.in_use` are declared and status-mapped but
 * thrown by nothing, which the `STATUS` map in `apps/server/src/catalogue-api.ts` states on those
 * two entries itself. A refusal that arrives anyway is still shown in the dialog.
 *
 * The extras form edits rows picked from PRODUCTS, which it never loads: this screen reads them
 * (every catalogue's products, as the catalogue screen does) and hands them over.
 */
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
  @state() private extraLists: ExtraList[] = [];
  @state() private optionLists: OptionList[] = [];
  /** Every catalogue's products, deduplicated by id — the rows the extras form offers. */
  @state() private products: Product[] = [];
  @state() private locales: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private loadError = false;
  @state() private error: string | null = null;
  /** Which editor is open, and on which list; null when neither is. A null `value` is a create. */
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
  /** The catalogue ids the product read is grouped over; set by `#load` before `#loadProducts`.
   * Not reactive state: nothing renders it, and `#loadProducts` reads it in the same turn. */
  #catalogueIds: string[] = [];
  /** The extras form picks its rows from products, which live per catalogue. One watch per
   * catalogue, merged by id, is the shape the catalogue screen uses for the same reason. */
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
  #viewGeneration = 0;
  #openDetail(kind: Kind, list: ModifierList): void {
    this.usage = null;
    this.usageError = false;
    this.viewing = { kind, id: list.id, name: list.name };
    const generation = ++this.#viewGeneration;
    void this.#loadUsage(kind, list.id, generation);
  }
  #closeDetail(): void {
    this.viewing = null;
    this.usage = null;
    this.usageError = false;
    this.#viewGeneration++;
  }
  /** Feeds the detail modal. `generation` guards a reopened modal against a stale response the same
   * way `#loadDependants` does: only a response whose generation still matches the current open is
   * applied. A failed fetch gets its own state rather than an empty stand-in, which would read as
   * "nothing carries this list". */
  async #loadUsage(kind: Kind, id: string, generation: number): Promise<void> {
    try {
      const usage = await this.#dependantsOf(kind, id);
      if (generation === this.#viewGeneration) this.usage = usage;
    } catch {
      if (generation === this.#viewGeneration) this.usageError = true;
    }
  }
  #deleteGeneration = 0;
  #openDelete(kind: Kind, list: ModifierList): void {
    this.error = null;
    this.dependants = null;
    this.dependantsError = false;
    this.deleting = { kind, id: list.id, name: list.name };
    const generation = ++this.#deleteGeneration;
    void this.#loadDependants(kind, list.id, generation);
  }
  #closeDelete(): void {
    this.deleting = null;
    this.dependants = null;
    this.dependantsError = false;
    this.error = null;
    this.#deleteGeneration++;
  }
  /** Feeds the delete confirmation's preview. Every consequence here cascades and cannot be undone,
   * so a failed fetch gets its own state rather than an empty stand-in, which would read as
   * "nothing depends on this" and have a manager confirm the cascade blind. `generation` guards a
   * reopened dialog against a stale response: comparing `this.deleting?.id` alone cannot tell a
   * superseded fetch from the current one when the SAME list is reopened. */
  async #loadDependants(kind: Kind, id: string, generation: number): Promise<void> {
    try {
      const dependants = await this.#dependantsOf(kind, id);
      if (generation === this.#deleteGeneration) this.dependants = dependants;
    } catch {
      if (generation === this.#deleteGeneration) this.dependantsError = true;
    }
  }
  /** The field an authoring refusal names, or `_form` when it names none. Both kinds' refusals
   * carry it under the same key: `extras.invalid`, `options.invalid` and the two
   * `*.translation_required` siblings all declare `field` (packages/catalogue/src/errors.ts), and
   * each form maps that path onto its own inputs. */
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
    this.#closeDelete();
    this.busy = false;
    await this.#load();
  }
  /** An extras list's offered products, by their STAFF names — the name every dashboard surface
   * shows (docs/developers/products.md). A product the screen no longer holds is skipped rather
   * than named: the picker inside the editor is where a missing one is reported. */
  #itemNames(list: ExtraList): string {
    return list.items
      .map((item) => this.products.find((product) => product.id === item.productId)?.name)
      .filter((name): name is string => name !== undefined)
      .join(", ");
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
            @click=${() => this.#openDetail(kind, list)}
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
              @click=${() => this.#openDelete(kind, list)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }
  /** The single Name column behind each delete-preview table, searching and sorting on the staff
   * name so a product is found by what the dashboard calls it. */
  #dependantColumns(): DataTableColumn<Dependant>[] {
    return [
      {
        key: "name",
        label: t("modifiers.name"),
        cell: (entry) => entry.name,
        searchValue: (entry) => entry.name,
        sortValue: (entry) => entry.name,
      },
    ];
  }
  #usageColumns(): DataTableColumn<UsageDependant>[] {
    return [
      {
        key: "name",
        label: t("modifiers.name"),
        cell: (entry) => entry.name,
        searchValue: (entry) => entry.name,
        sortValue: (entry) => entry.name,
      },
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
  /** A read-only table of products or menu items in the delete confirmation's cascade preview. */
  #dependantsTable(
    testId: string,
    label: string,
    viewKey: string,
    emptyMessage: string,
    searchLabel: string,
    noMatchesMessage: string,
    rows: Dependant[],
  ) {
    return html`<wt-data-table
      data-test=${testId}
      aria-label=${label}
      searchable
      searchLabel=${searchLabel}
      noMatchesMessage=${noMatchesMessage}
      viewKey=${viewKey}
      .rows=${rows}
      .columns=${this.#dependantColumns()}
      .rowKey=${(entry: Dependant) => entry.id}
      .emptyMessage=${emptyMessage}
    ></wt-data-table>`;
  }
  /** The detail modal's body: a spinner until `#loadUsage` resolves, then one filterable table of
   * every product and menu item that carries the list. A failed fetch says so instead, because an
   * empty table would read as "nothing carries this". */
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
  /** The single red warning at the top of the delete confirmation: one paragraph naming every
   * cascade consequence, space-joined from the sentences that apply. Only called when there IS
   * something to lose, so the "cannot be undone" opener always leads it. */
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
  /** The delete confirmation's preview: a spinner until `#loadDependants` resolves, then the red
   * warning naming every cascade consequence above the affected-products and affected-menus tables
   * (each shown only when non-empty). With nothing depending on the list there is no warning, just
   * the buttons. A failed fetch says so instead, because silence here would read as "nothing to
   * lose". */
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
        ? this.#dependantsTable(
            "list-delete-products",
            t("modifiers.affected_products"),
            "waitron.modifiers.delete.products.table",
            t("modifiers.no_products"),
            t("modifiers.search_products"),
            t("modifiers.products_no_matches"),
            dependants.products,
          )
        : nothing
    }${
      dependants.menus.length > 0
        ? this.#dependantsTable(
            "list-delete-menus",
            t("modifiers.affected_menus"),
            "waitron.modifiers.delete.menus.table",
            t("modifiers.no_menus"),
            t("modifiers.search_menus"),
            t("modifiers.menus_no_matches"),
            dependants.menus,
          )
        : nothing
    }`;
  }
  /** One tab: its heading and Add button, then its table. Each kind's table carries its OWN
   * `viewKey`, so a sort chosen on one tab is not restored onto the other. */
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
                event.stopPropagation();
                this.tab = event.detail.value === "options" ? "options" : "extras";
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
          if (!this.busy) this.#closeDelete();
        }}
      >
        ${this.deleting ? this.#renderDependants() : nothing}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => this.#closeDelete()}
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
          this.#closeDetail();
        }}
        >${this.viewing ? this.#renderUsage() : nothing}<wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="close-detail"
            variant="secondary"
            @click=${() => this.#closeDetail()}
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
  /** The detail modal's Edit: close the modal and open the same list in its own editor. The list is
   * re-read from the loaded rows, so an edit started after a background refresh edits what the
   * screen currently holds rather than the snapshot the modal was opened on. */
  #editViewed(): void {
    const viewing = this.viewing;
    if (!viewing) return;
    const list = this.#lists(viewing.kind).find((each) => each.id === viewing.id);
    this.#closeDetail();
    if (list) this.#edit(viewing.kind, list);
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-modifiers-screen": ModifiersScreen;
  }
}
