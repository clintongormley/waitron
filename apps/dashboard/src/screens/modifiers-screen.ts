import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  setContentLanguages,
  currentContentLanguages,
  type DataTableColumn,
} from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "../widgets/modifier-form.js";
import type { DashboardApi, Modifier, ModifierDependants, ModifierInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

/** A product or menu item that uses a modifier, as `modifierDependants` returns it. Both the
 * row-click usage modal and the delete confirmation list these. */
type Dependant = { id: string; name: string };
type UsageDependant = Dependant & { type: "product" | "menu" };

@customElement("dashboard-modifiers-screen")
export class ModifiersScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-xl);
      }
      .heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private modifiers: Modifier[] = [];
  @state() private locales: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private loadError = false;
  @state() private error: string | null = null;
  @state() private open = false;
  @state() private value: Modifier | null = null;
  @state() private busy = false;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private deleting: Modifier | null = null;
  @state() private dependants: ModifierDependants | null = null;
  /** The preview fetch failed. Distinct from `dependants === null` (still loading) and from a
   * loaded object whose lists are empty and orders is 0 (genuinely nothing depends on this). */
  @state() private dependantsError = false;
  // The modifier whose "products that use this" modal is open, or null when it is closed.
  @state() private viewing: Modifier | null = null;
  @state() private usage: ModifierDependants | null = null;
  /** The usage fetch failed. Distinct from `usage === null` (still loading) and from a loaded
   * object whose lists are empty (nothing uses this modifier yet). */
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
        this.#queries.watch("listModifiers", [], (value) => {
          this.modifiers = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.locales = value;
          setContentLanguages(value);
        }),
      ]);
      // A `?modifier=<id>` deep link opens that modifier's editor. An unknown id is ignored.
      // Clearing the param stops a refresh reopening the editor.
      const linked = new URL(location.href).searchParams.get("modifier");
      const target = linked ? this.modifiers.find((m) => m.id === linked) : undefined;
      if (target) {
        this.#edit(target);
        const url = new URL(location.href);
        url.searchParams.delete("modifier");
        history.replaceState(null, "", url);
      }
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }
  #edit(value: Modifier | null): void {
    this.value = value;
    this.fieldErrors = {};
    this.open = true;
  }
  #viewGeneration = 0;
  #openProducts(modifier: Modifier): void {
    this.usage = null;
    this.usageError = false;
    this.viewing = modifier;
    const generation = ++this.#viewGeneration;
    void this.#loadUsage(modifier.id, generation);
  }
  #closeProducts(): void {
    this.viewing = null;
    this.usage = null;
    this.usageError = false;
    this.#viewGeneration++;
  }
  /** Feeds the usage modal opened from a row click. `generation` guards a reopened modal against a
   * stale response the same way `#loadDependants` does: only a response whose generation still
   * matches the current open is applied. A failed fetch gets its own state rather than an empty
   * stand-in, which would read as "nothing uses this". */
  async #loadUsage(id: string, generation: number): Promise<void> {
    try {
      const usage = await this.api.getModifierDependants(id);
      if (generation === this.#viewGeneration) this.usage = usage;
    } catch {
      if (generation === this.#viewGeneration) this.usageError = true;
    }
  }
  #deleteGeneration = 0;
  #openDelete(modifier: Modifier): void {
    this.error = null;
    this.dependants = null;
    this.dependantsError = false;
    this.deleting = modifier;
    const generation = ++this.#deleteGeneration;
    void this.#loadDependants(modifier.id, generation);
  }
  #closeDelete(): void {
    this.deleting = null;
    this.dependants = null;
    this.dependantsError = false;
    this.error = null;
    this.#deleteGeneration++;
  }
  /** Feeds the delete confirmation's preview. The server refuses a delete only on an open order, so
   * every other consequence — the products and menu items that lose the modifier — cascades and
   * cannot be undone; a failed fetch therefore gets its own state rather than an empty stand-in,
   * which would read as "nothing depends on this" and have a manager confirm the cascade blind.
   * `generation` guards a reopened dialog against a stale response: comparing `this.deleting?.id`
   * alone cannot tell a superseded fetch from the current one when the SAME modifier is reopened,
   * so only a response whose generation still matches is applied. */
  async #loadDependants(id: string, generation: number): Promise<void> {
    try {
      const dependants = await this.api.getModifierDependants(id);
      if (generation === this.#deleteGeneration) this.dependants = dependants;
    } catch {
      if (generation === this.#deleteGeneration) this.dependantsError = true;
    }
  }
  #message(error: unknown): string {
    const code = codeOf(error);
    if (
      code === "modifier.in_use" &&
      typeof error === "object" &&
      error !== null &&
      "params" in error
    ) {
      const params = error.params;
      if (params && typeof params === "object" && "dependency" in params) {
        const dependency = params.dependency;
        if (
          dependency === "product" ||
          dependency === "menu" ||
          dependency === "order" ||
          dependency === "choice"
        )
          return t(`modifiers.in_use.${dependency}`);
      }
    }
    return codeMessage(code);
  }
  async #save(event: CustomEvent<{ value: ModifierInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.fieldErrors = {};
    try {
      if (this.value) await this.api.updateModifier(this.value.id, event.detail.value);
      else await this.api.createModifier(event.detail.value);
    } catch (error) {
      const message = this.#message(error);
      const params =
        typeof error === "object" && error !== null && "params" in error ? error.params : null;
      const field =
        params &&
        typeof params === "object" &&
        "field" in params &&
        typeof params.field === "string"
          ? params.field
          : "_form";
      this.fieldErrors = { [field]: message };
      this.busy = false;
      return;
    }
    this.open = false;
    this.busy = false;
    await this.#load();
  }
  async #delete(): Promise<void> {
    if (this.busy || !this.deleting) return;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteModifier(this.deleting.id);
    } catch (error) {
      this.error = this.#message(error);
      this.busy = false;
      return;
    }
    this.#closeDelete();
    this.busy = false;
    await this.#load();
  }
  #name(modifier: Modifier): string {
    return resolveEnabledContentText(modifier.name, currentLocale(), currentContentLanguages());
  }
  #choiceNames(modifier: Modifier): string {
    if (modifier.type !== "extras" && modifier.type !== "options") return "";
    return modifier.choices
      .map((choice) =>
        resolveEnabledContentText(choice.name, currentLocale(), currentContentLanguages()),
      )
      .join(", ");
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
    rows: Dependant[],
  ) {
    return html`<wt-data-table
      data-test=${testId}
      aria-label=${label}
      searchable
      searchLabel=${t("modifiers.search_products")}
      noMatchesMessage=${t("modifiers.products_no_matches")}
      viewKey=${viewKey}
      .rows=${rows}
      .columns=${this.#dependantColumns()}
      .rowKey=${(entry: Dependant) => entry.id}
      .emptyMessage=${emptyMessage}
    ></wt-data-table>`;
  }
  /** The usage modal's body: a spinner until `#loadUsage` resolves, then one filterable table for
   * every product and menu item that uses the modifier. A failed fetch says so instead, because an
   * empty table would read as "nothing uses this". */
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
      data-test="modifier-usage"
      aria-label=${t("modifiers.products_modal")}
      searchable
      searchLabel=${t("modifiers.search_products")}
      noMatchesMessage=${t("modifiers.products_no_matches")}
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
   * something to lose, so the "cannot be undone" opener always leads it. The open-order case is not
   * in here — it blocks the delete rather than warning about it, so it gets its own line. */
  #deleteWarning(dependants: ModifierDependants): string {
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
   * (each shown only when non-empty), and — when an open order still uses the modifier — a block
   * saying why the delete is refused. With nothing depending on the modifier there is no warning,
   * just the buttons. A failed fetch says so instead, because silence here would read as "nothing
   * to lose". */
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
            "modifier-delete-products",
            t("modifiers.affected_products"),
            "waitron.modifiers.delete.products.table",
            t("modifiers.no_products"),
            dependants.products,
          )
        : nothing
    }${
      dependants.menus.length > 0
        ? this.#dependantsTable(
            "modifier-delete-menus",
            t("modifiers.affected_menus"),
            "waitron.modifiers.delete.menus.table",
            t("modifiers.no_menus"),
            dependants.menus,
          )
        : nothing
    }${
      dependants.orders > 0
        ? html`<p class="error" data-test="orders-block" role="alert">
            ${t("modifiers.delete_orders_block")}
          </p>`
        : nothing
    }`;
  }
  override render() {
    const columns: DataTableColumn<Modifier>[] = [
      {
        key: "name",
        label: t("modifiers.name"),
        searchValue: (modifier) => this.#name(modifier),
        sortValue: (modifier) => this.#name(modifier),
        cell: (modifier) =>
          html`<wt-button
            variant="ghost"
            data-test=${`open-${modifier.id}`}
            @click=${() => this.#openProducts(modifier)}
            >${this.#name(modifier)}</wt-button
          >`,
      },
      {
        key: "type",
        label: t("modifiers.type"),
        sortValue: (modifier) => t(`modifiers.${modifier.type}`),
        cell: (modifier) => t(`modifiers.${modifier.type}`),
        filter: {
          label: t("modifiers.type"),
          allLabel: t("modifiers.filter_type_all"),
          value: (modifier) => modifier.type,
          options: (["text", "extras", "options"] as const).map((type) => ({
            value: type,
            label: t(`modifiers.${type}`),
          })),
        },
      },
      {
        key: "choices",
        label: t("modifiers.choices"),
        searchValue: (modifier) => this.#choiceNames(modifier),
        sortValue: (modifier) => this.#choiceNames(modifier),
        cell: (modifier) => this.#choiceNames(modifier),
      },
      {
        key: "actions",
        label: t("modifiers.actions"),
        cell: (modifier) =>
          html`<wt-row-actions label=${`${t("modifiers.actions")}: ${this.#name(modifier)}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`edit-${modifier.id}`}
              @click=${() => this.#edit(modifier)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`delete-${modifier.id}`}
              @click=${() => this.#openDelete(modifier)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
    return html`<div class="heading">
        <h1>${t("modifiers.title")}</h1>
        <wt-button
          data-test="create-modifier"
          variant="primary"
          .disabled=${!this.locales}
          @click=${() => this.#edit(null)}
          >${t("modifiers.add")}</wt-button
        >
      </div>
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
          ? html`<wt-data-table
              aria-label=${t("modifiers.title")}
              searchable
              searchLabel=${t("modifiers.search")}
              noMatchesMessage=${t("modifiers.no_matches")}
              viewKey="waitron.modifiers.table"
              sortKey="name"
              sortDirection="ascending"
              .rows=${this.modifiers}
              .columns=${columns}
              .rowKey=${(modifier: Modifier) => modifier.id}
              .emptyMessage=${t("modifiers.empty")}
            ></wt-data-table>`
          : nothing
      }
      <dashboard-modifier-form
        .open=${this.open}
        .value=${this.value}
        .busy=${this.busy}
        .locales=${this.locales?.languages ?? []}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: ModifierInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.open = false;
        }}
      ></dashboard-modifier-form>
      <wt-modal
        data-test="delete-dialog"
        .open=${this.deleting !== null}
        heading=${t("modifiers.delete_named").replace(
          "{name}",
          this.deleting ? this.#name(this.deleting) : "",
        )}
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
            .disabled=${this.busy || !this.dependants || this.dependants.orders > 0}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        ></wt-modal
      >
      <wt-modal
        data-test="products-modal"
        .open=${this.viewing !== null}
        heading=${
          this.viewing ? `${this.#name(this.viewing)} · ${t("modifiers.products_modal")}` : ""
        }
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.#closeProducts();
        }}
        >${this.viewing ? this.#renderUsage() : nothing}<wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="close-products"
            variant="secondary"
            @click=${() => this.#closeProducts()}
            >${t("action.close")}</wt-button
          ></wt-form-actions
        ></wt-modal
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-modifiers-screen": ModifiersScreen;
  }
}
