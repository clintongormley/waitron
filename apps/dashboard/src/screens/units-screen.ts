import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, setContentLanguages } from "@waitron/ui";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { LitElement, css, html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import type { DashboardApi, ProductUsingUnit, Unit, UnitInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage } from "../i18n/codes.js";
import { localizedName } from "../i18n/localized.js";
import { currentLocale, t } from "../i18n/t.js";
import { unitRefusalErrors, type UnitFormErrors } from "../widgets/unit-form.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
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
      .reassign wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 7);
        min-width: 0;
      }
      .reassign wt-button {
        flex: none;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    (error) => {
      if (this.error === error) this.#showError(null);
    },
  );
  @state() private units: Unit[] = [];
  @state() private languages: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private editorOpen = false;
  @state() private editing: Unit | null = null;
  @state() private busy = false;
  @state() private error: UnitError | null = null;
  /** Whether `error` is a read's failure, the only message a later read's failure may replace. */
  #readErrorShown = false;
  @state() private fieldErrors: UnitFormErrors = {};
  @state() private inUseUnitId: string | null = null;
  @state() private inUseProducts: ProductUsingUnit[] = [];
  @state() private inUseSearch = "";
  @state() private selectedProducts: string[] = [];
  @state() private selectingProducts = false;
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
      this.#showReadError(error);
    } finally {
      this.loading = false;
    }
  }

  #showError(error: UnitError | null, fromRead = false): void {
    this.error = error;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.error === null || this.#readErrorShown) this.#showError(error as UnitError, true);
  }

  #renderCreate(slot?: "empty-action") {
    return html`<wt-button
      data-test="create"
      slot=${ifDefined(slot)}
      variant="primary"
      @click=${this.#openCreate}
      >${t("units.create")}</wt-button
    >`;
  }

  #openCreate(event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = null;
    this.#showError(null);
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #openEdit(unit: Unit, event: Event): void {
    event.stopPropagation();
    this.focusTarget = event.currentTarget as HTMLElement;
    this.editing = unit;
    this.#showError(null);
    this.fieldErrors = {};
    this.editorOpen = true;
  }

  #closeEditor(): void {
    this.editorOpen = false;
    this.editing = null;
    requestAnimationFrame(() => {
      // The empty table's create button is gone once the unit it made is listed.
      const header = this.shadowRoot!.querySelector<HTMLElement>(
        ".header-actions [data-test=create]",
      );
      (this.focusTarget?.isConnected ? this.focusTarget : header)?.focus();
    });
  }

  async #save(event: CustomEvent<{ value: UnitInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.#showError(null);
    this.fieldErrors = {};
    try {
      const canonical = this.editing
        ? await this.api.updateUnit(this.editing.id, event.detail.value)
        : await this.api.createUnit(event.detail.value);
      this.units = this.editing
        ? this.units.map((unit) => (unit.id === canonical.id ? canonical : unit))
        : [...this.units, canonical];
      this.shadowRoot!.querySelector("dashboard-unit-form")!.closeSaved(event.detail.value);
      this.#closeEditor();
      try {
        this.units = await this.api.background.listUnits();
      } catch (error) {
        this.#showReadError(error);
      }
    } catch (error) {
      this.fieldErrors = unitRefusalErrors(error);
    } finally {
      this.busy = false;
    }
  }

  /** No confirmation step: a delete is attempted straight away, and a refusal because products use the
   * unit opens the in-use modal. */
  async #deleteUnit(id: string): Promise<void> {
    if (id === "" || this.busy) return;
    this.busy = true;
    this.#showError(null);
    try {
      await this.api.deleteUnit(id);
      this.units = this.units.filter((unit) => unit.id !== id);
      this.#closeInUse();
    } catch (error) {
      const failure = error as UnitError;
      if (failure.code === "unit.in_use") {
        this.#openInUse(id, failure.params?.products ?? []);
      } else {
        this.#showError(failure);
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

  async #openUnitProducts(unit: Unit): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.#showError(null);
    try {
      const products = await this.api.listUnitProducts(unit.id);
      this.#openInUse(unit.id, products);
    } catch (error) {
      this.#showReadError(error);
    } finally {
      this.busy = false;
    }
  }

  #openInUse(unitId: string, products: ProductUsingUnit[]): void {
    this.inUseUnitId = unitId;
    this.inUseProducts = products;
    this.inUseSearch = "";
    this.selectedProducts = [];
    this.selectingProducts = false;
    this.reassignTarget = "";
  }

  #closeInUse(): void {
    this.inUseUnitId = null;
    this.inUseProducts = [];
    this.inUseSearch = "";
    this.selectedProducts = [];
    this.selectingProducts = false;
    this.reassignTarget = "";
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  #onSelectionChange(event: CustomEvent<{ selected: string[] }>): void {
    event.stopPropagation();
    this.selectedProducts = event.detail.selected;
  }

  async #changeUnit(): Promise<void> {
    if (
      this.inUseUnitId === null ||
      this.selectedProducts.length === 0 ||
      this.reassignTarget === "" ||
      this.busy
    )
      return;
    this.busy = true;
    this.#showError(null);
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
      this.#showError(error as UnitError);
    } finally {
      this.busy = false;
    }
  }

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
        key: "status",
        label: t("units.status"),
        cell: (product) =>
          product.active ? t("product.active_badge") : t("product.disabled_badge"),
        sortValue: (product) => (product.active ? 1 : 0),
      },
      {
        key: "actions",
        label: t("units.actions"),
        pinned: "end",
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

  /** Written with the reader's decimal marker, as a price of that precision prints, not as a bare digit. */
  #precisionLabel(precision: number): string {
    return precision === 0 ? "0" : decimalMarker(currentLocale()) + "0".repeat(precision);
  }

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
        choosable: "shown",
        cell: (unit) => localizedName(unit.abbreviation),
        searchValue: (unit) => localizedName(unit.abbreviation),
        sortValue: (unit) => localizedName(unit.abbreviation),
      },
      {
        key: "precision",
        label: t("units.precision"),
        choosable: "shown",
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
        pinned: "end",
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
        <div class="header-actions">${this.#renderCreate()}</div>
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
        noMatchesMessage=${tableNoMatches()}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        aria-label=${t("units.title")}
        searchable
        searchLabel=${t("units.search")}
        viewKey="waitron.units.table"
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
        filtersLabel=${t("table.filters")}
        filteredColumnLabel=${t("table.filtered_column")}
        filtersClearAllLabel=${t("table.filters_clear_all")}
        filtersCloseLabel=${t("table.filters_close")}
        sortKey="name"
        sortDirection="ascending"
        .rows=${this.units}
        .columns=${this.#columns()}
        .rowKey=${(unit: Unit) => unit.id}
        .rowClick=${(unit: Unit) => void this.#openUnitProducts(unit)}
        .rowClickLabel=${(unit: Unit) => `${t("units.delete_unit")}: ${localizedName(unit.name)}`}
        .loading=${this.loading}
        emptyMessage=${t("units.empty")}
        >${this.units.length === 0 ? this.#renderCreate("empty-action") : nothing}</wt-data-table
      >
      <dashboard-unit-form
        .open=${this.editorOpen}
        .api=${this.api}
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
        size="wide"
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
                  <wt-button
                    data-test="select-products"
                    variant="secondary"
                    @click=${() => {
                      this.selectingProducts = !this.selectingProducts;
                      if (!this.selectingProducts) this.selectedProducts = [];
                    }}
                    >${t(this.selectingProducts ? "units.cancel_selection" : "units.select")}</wt-button
                  >
                  ${
                    this.selectingProducts
                      ? html`<span data-test="selected-count" aria-live="polite"
                          >${
                            this.selectedProducts.length === 1
                              ? t("units.selected_one")
                              : t("units.selected_count").replace(
                                  "{count}",
                                  String(this.selectedProducts.length),
                                )
                          }</span
                        >`
                      : nothing
                  }
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
                    <wt-combobox
                      data-test="reassign-unit"
                      name="reassign-unit"
                      label=${t("units.change_unit")}
                      hide-label
                      search="auto"
                      placeholder=${t("units.change_unit_placeholder")}
                      searchPlaceholder=${t("categories.combobox_search")}
                      noResultsLabel=${t("categories.combobox_no_results")}
                      .options=${[
                        { value: "", label: t("units.change_unit_placeholder") },
                        { value: REASSIGN_EACH, label: t("units.change_unit_each") },
                        ...otherUnits.map((unit) => ({
                          value: unit.id,
                          label: localizedName(unit.name),
                        })),
                      ]}
                      .value=${this.reassignTarget}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        this.reassignTarget = event.detail.value;
                      }}
                    ></wt-combobox>
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
                  noMatchesMessage=${tableNoMatches()}
                  emptyMessage=${tableNoMatches()}
                  aria-label=${t("units.in_use_title")}
                  .rows=${inUseRows}
                  .columns=${this.#productColumns()}
                  .rowKey=${(product: ProductUsingUnit) => product.id}
                  .selectable=${this.selectingProducts}
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
