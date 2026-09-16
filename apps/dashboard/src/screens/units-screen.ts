import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, selectStyles, setContentLanguages } from "@waitron/ui";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DashboardApi, ProductUsingUnit, Unit, UnitInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage } from "../i18n/codes.js";
import { localizedName } from "../i18n/localized.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/unit-form.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type UnitError = { code?: string; params?: { products?: ProductUsingUnit[] } };

/** The reassign target that means "no unit" (Each). Distinct from a uuid and from the placeholder
 * "", so the disabled guard treats it as a real choice; `#changeUnit` maps it to a null target. */
const REASSIGN_EACH = "__each__";

const decimalMarkers = new Map<string, string>();
function decimalMarker(locale: string): string {
  let marker = decimalMarkers.get(locale);
  if (marker === undefined) {
    marker =
      new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ??
      ".";
    decimalMarkers.set(locale, marker);
  }
  return marker;
}

@customElement("dashboard-units-screen")
export class UnitsScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      h1 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
      }
      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: center;
      }
      .description {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .in-use-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: end;
        margin: var(--wt-space-3) 0;
      }
      .in-use-toolbar .in-use-search {
        flex: 1;
        min-width: 12rem;
      }
      .reassign {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .reassign select {
        width: auto;
        min-width: 10rem;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.error = error as UnitError;
    },
  );
  @state() private units: Unit[] = [];
  @state() private languages: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private editorOpen = false;
  @state() private editing: Unit | null = null;
  @state() private busy = false;
  @state() private error: UnitError | null = null;
  @state() private fieldErrors: { name?: string; precision?: string } = {};
  /** The unit whose deletion is blocked, driving the in-use modal; null when the modal is closed. */
  @state() private inUseUnitId: string | null = null;
  @state() private inUseProducts: ProductUsingUnit[] = [];
  @state() private inUseSearch = "";
  /** The products ticked for a bulk unit change, and the unit to move them onto. */
  @state() private selectedProducts: string[] = [];
  @state() private reassignTarget = "";
  private focusTarget: HTMLElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loading = true;
    try {
      await Promise.all([
        this.#queries.watch("listUnits", [], (value) => {
          this.units = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.languages = value;
          setContentLanguages(value);
        }),
      ]);
    } catch (error) {
      this.error = error as UnitError;
    } finally {
      this.loading = false;
    }
  }

  #openCreate(event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = null;
    this.error = null;
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #openEdit(unit: Unit, event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = unit;
    this.error = null;
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #closeEditor(): void {
    this.editorOpen = false;
    this.editing = null;
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  async #save(event: CustomEvent<{ value: UnitInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.fieldErrors = {};
    try {
      const canonical = this.editing
        ? await this.api.updateUnit(this.editing.id, event.detail.value)
        : await this.api.createUnit(event.detail.value);
      this.units = this.editing
        ? this.units.map((unit) => (unit.id === canonical.id ? canonical : unit))
        : [...this.units, canonical];
      this.#closeEditor();
      try {
        this.units = await this.api.background.listUnits();
      } catch (error) {
        this.error = error as UnitError;
      }
    } catch (error) {
      this.error = error as UnitError;
      const code = this.error.code;
      this.fieldErrors =
        code === "unit.precision_invalid"
          ? { precision: t("units.precision_invalid") }
          : code === "content.translation_required" || code === "content.translation_invalid"
            ? { name: codeMessage(code) }
            : {};
    } finally {
      this.busy = false;
    }
  }

  /** The row's Delete action, and the modal's own Delete, both run this: no confirmation step —
   * a delete is attempted straight away. A refusal because products use it opens the in-use modal
   * (or refreshes it, when the modal is the caller); any other error is an inline banner. */
  async #deleteUnit(id: string): Promise<void> {
    if (id === "" || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteUnit(id);
      this.units = this.units.filter((unit) => unit.id !== id);
      this.#closeInUse();
    } catch (error) {
      const failure = error as UnitError;
      if (failure.code === "unit.in_use") {
        this.#openInUse(id, failure.params?.products ?? []);
      } else {
        this.error = failure;
        this.#closeInUse();
      }
    } finally {
      this.busy = false;
    }
  }

  #requestDelete(unit: Unit, event: Event): void {
    event.stopPropagation();
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions");
    this.focusTarget = menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null;
    void this.#deleteUnit(unit.id);
  }

  /** Clicking a unit row opens the delete screen with the products that must be moved first.
   * Fetches the products, then reuses the state populated by a refused delete. */
  async #openUnitProducts(unit: Unit): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const products = await this.api.listUnitProducts(unit.id);
      this.#openInUse(unit.id, products);
    } catch (error) {
      this.error = error as UnitError;
    } finally {
      this.busy = false;
    }
  }

  #openInUse(unitId: string, products: ProductUsingUnit[]): void {
    this.inUseUnitId = unitId;
    this.inUseProducts = products;
    this.inUseSearch = "";
    this.selectedProducts = [];
    this.reassignTarget = "";
  }

  #closeInUse(): void {
    this.inUseUnitId = null;
    this.inUseProducts = [];
    this.inUseSearch = "";
    this.selectedProducts = [];
    this.reassignTarget = "";
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  #onSelectionChange(event: CustomEvent<{ selected: string[] }>): void {
    event.stopPropagation();
    this.selectedProducts = event.detail.selected;
  }

  /** Move the ticked products onto the chosen unit; they then drop out of the refreshed list. */
  async #changeUnit(): Promise<void> {
    if (
      this.inUseUnitId === null ||
      this.selectedProducts.length === 0 ||
      this.reassignTarget === "" ||
      this.busy
    )
      return;
    this.busy = true;
    this.error = null;
    const target = this.reassignTarget === REASSIGN_EACH ? null : this.reassignTarget;
    try {
      this.inUseProducts = await this.api.reassignProductsUnit(
        this.inUseUnitId,
        this.selectedProducts,
        target,
      );
      this.selectedProducts = [];
      this.reassignTarget = "";
    } catch (error) {
      this.error = error as UnitError;
    } finally {
      this.busy = false;
    }
  }

  /** Jump to the product's editor on the catalogue screen. The person navigates back themselves;
   * the modal reopens fresh the next time they attempt the delete. */
  #editProduct(productId: string, event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #productColumns(): DataTableColumn<ProductUsingUnit>[] {
    return [
      {
        key: "name",
        label: t("units.name"),
        cell: (product) => product.name,
        sortValue: (product) => product.name,
      },
      {
        key: "availability",
        label: t("units.availability"),
        cell: (product) =>
          product.available ? t("product.active_badge") : t("product.inactive_badge"),
        sortValue: (product) => (product.available ? 1 : 0),
      },
      {
        key: "actions",
        label: t("units.actions"),
        cell: (product) => html`
          <wt-button
            data-test=${`edit-product-${product.id}`}
            variant="ghost"
            @click=${(event: Event) => this.#editProduct(product.id, event)}
            >${t("action.edit")}</wt-button
          >
        `,
      },
    ];
  }

  /** The precision written with the reader's decimal marker: precision 3 → ",000" (es) / ".000"
   * (en); precision 0 → "0". Shown in the column cell, the filter's options, so a manager reads a
   * unit's precision the way a price of that precision would print, not as a bare digit. */
  #precisionLabel(precision: number): string {
    return precision === 0 ? "0" : decimalMarker(currentLocale()) + "0".repeat(precision);
  }

  /** One filter option per distinct precision the units in the list actually use, ascending, each
   * labelled with the same marker text as its cell. A precision nothing uses would match no row. */
  #precisionOptions(): { value: string; label: string }[] {
    return [...new Set(this.units.map((unit) => unit.precision))]
      .sort((a, b) => a - b)
      .map((precision) => ({ value: String(precision), label: this.#precisionLabel(precision) }));
  }

  #columns(): DataTableColumn<Unit>[] {
    return [
      {
        key: "name",
        label: t("units.name"),
        cell: (unit) => localizedName(unit.name),
        searchValue: (unit) => localizedName(unit.name),
        sortValue: (unit) => localizedName(unit.name),
      },
      {
        key: "abbreviation",
        label: t("units.abbreviation"),
        cell: (unit) => localizedName(unit.abbreviation),
        searchValue: (unit) => localizedName(unit.abbreviation),
        sortValue: (unit) => localizedName(unit.abbreviation),
      },
      {
        key: "precision",
        label: t("units.precision"),
        cell: (unit) => this.#precisionLabel(unit.precision),
        sortValue: (unit) => unit.precision,
        filter: {
          label: t("units.precision"),
          allLabel: t("units.filter_precision_all"),
          value: (unit) => String(unit.precision),
          options: this.#precisionOptions(),
        },
      },
      {
        key: "actions",
        label: t("units.actions"),
        cell: (unit) => html`
          <wt-row-actions label=${`${t("units.actions")}: ${localizedName(unit.name)}`}>
            <wt-button
              align="start"
              data-test=${`edit-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => this.#openEdit(unit, event)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              align="start"
              data-test=${`delete-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => this.#requestDelete(unit, event)}
              >${t("action.delete")}</wt-button
            >
          </wt-row-actions>
        `,
      },
    ];
  }

  override render() {
    const productNeedle = this.inUseSearch.trim().toLocaleLowerCase();
    const inUseRows =
      productNeedle === ""
        ? this.inUseProducts
        : this.inUseProducts.filter((product) =>
            product.name.toLocaleLowerCase().includes(productNeedle),
          );
    const unitNameCollator = new Intl.Collator(currentLocale(), { sensitivity: "base" });
    const otherUnits = this.units
      .filter((unit) => unit.id !== this.inUseUnitId)
      .sort((left, right) =>
        unitNameCollator.compare(localizedName(left.name), localizedName(right.name)),
      );
    return html`
      <div class="heading">
        <h1>${t("units.title")}</h1>
        <div class="header-actions">
          <wt-button data-test="create" variant="primary" @click=${this.#openCreate}
            >${t("units.create")}</wt-button
          >
        </div>
      </div>
      <p class="description">${t("units.description")}</p>
      ${
        this.error
          ? html`<div class="error" role="alert">
              ${
                // A failure carrying a domain code states itself; only a codeless failure (a
                // network drop during the initial load) falls back to the load message.
                this.error.code ? codeMessage(this.error.code) : t("units.load_error")
              }
            </div>`
          : nothing
      }
      <wt-data-table
        aria-label=${t("units.title")}
        searchable
        searchLabel=${t("units.search")}
        noMatchesMessage=${t("units.no_matches")}
        viewKey="waitron.units.table"
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.units}
        .columns=${this.#columns()}
        .rowKey=${(unit: Unit) => unit.id}
        .rowClick=${(unit: Unit) => void this.#openUnitProducts(unit)}
        .rowClickLabel=${(unit: Unit) => `${t("units.delete_unit")}: ${localizedName(unit.name)}`}
        .loading=${this.loading}
        emptyMessage=${t("units.empty")}
      ></wt-data-table>
      <dashboard-unit-form
        .open=${this.editorOpen}
        .busy=${this.busy}
        .locales=${this.languages?.languages ?? []}
        .value=${this.editing}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: UnitInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.#closeEditor();
        }}
      ></dashboard-unit-form>
      <wt-modal
        data-test="in-use-dialog"
        .open=${this.inUseUnitId !== null}
        heading=${t("units.delete_unit")}
        @wt-close=${this.#closeInUse}
      >
        ${
          this.inUseProducts.length === 0
            ? html`<p>${t("units.in_use_empty")}</p>`
            : html`<p class="error" data-test="in-use-warning">${t("units.in_use_body")}</p>`
        }
        ${
          this.inUseProducts.length > 0
            ? html`
                <div class="in-use-toolbar">
                  <wt-input
                    class="in-use-search"
                    data-test="in-use-search"
                    name="in-use-search"
                    label=${t("units.in_use_search")}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.inUseSearch = event.detail.value;
                    }}
                  ></wt-input>
                  <div class="reassign">
                    <select
                      data-test="reassign-unit"
                      name="reassign-unit"
                      aria-label=${t("units.change_unit")}
                      .value=${this.reassignTarget}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        this.reassignTarget = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="" .selected=${this.reassignTarget === ""}>
                        ${t("units.change_unit_placeholder")}
                      </option>
                      <option
                        value=${REASSIGN_EACH}
                        .selected=${this.reassignTarget === REASSIGN_EACH}
                      >
                        ${t("units.change_unit_each")}
                      </option>
                      ${otherUnits.map(
                        (unit) =>
                          html`<option
                            value=${unit.id}
                            .selected=${this.reassignTarget === unit.id}
                          >
                            ${localizedName(unit.name)}
                          </option>`,
                      )}
                    </select>
                    <wt-button
                      data-test="change-unit"
                      variant="secondary"
                      ?disabled=${
                        this.selectedProducts.length === 0 ||
                        this.reassignTarget === "" ||
                        this.busy
                      }
                      @click=${() => void this.#changeUnit()}
                      >${t("units.change_unit")}</wt-button
                    >
                  </div>
                </div>
                <wt-data-table
                  aria-label=${t("units.in_use_title")}
                  .rows=${inUseRows}
                  .columns=${this.#productColumns()}
                  .rowKey=${(product: ProductUsingUnit) => product.id}
                  .selectable=${true}
                  .selected=${this.selectedProducts}
                  .selectionLabel=${(product: ProductUsingUnit) =>
                    `${t("units.select_product")}: ${product.name}`}
                  selectAllLabel=${t("units.select_all")}
                  @wt-selection-change=${this.#onSelectionChange}
                ></wt-data-table>
              `
            : nothing
        }
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel-in-use"
            variant="secondary"
            @click=${this.#closeInUse}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="delete-unit"
            variant="danger"
            ?disabled=${this.busy}
            @click=${() => void this.#deleteUnit(this.inUseUnitId ?? "")}
            >${t("action.delete")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-units-screen": UnitsScreen;
  }
}
