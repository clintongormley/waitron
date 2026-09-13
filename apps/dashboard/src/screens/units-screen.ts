import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, setContentLanguages } from "@waitron/ui";
import type { DataTableColumn } from "@waitron/ui/src/components/wt-data-table.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DashboardApi, ProductUsingUnit, Unit, UnitInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage } from "../i18n/codes.js";
import { localizedName } from "../i18n/localized.js";
import { t } from "../i18n/t.js";
import "../widgets/unit-form.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type UnitError = { code?: string; params?: { products?: ProductUsingUnit[] } };

@customElement("dashboard-units-screen")
export class UnitsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .description {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      .toolbar {
        display: flex;
        gap: var(--wt-space-3);
        align-items: end;
        margin-bottom: var(--wt-space-4);
      }
      .search {
        flex: 1;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .in-use-search {
        display: block;
        margin: var(--wt-space-3) 0;
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
  @state() private search = "";
  @state() private editorOpen = false;
  @state() private editing: Unit | null = null;
  @state() private busy = false;
  @state() private error: UnitError | null = null;
  @state() private fieldErrors: { name?: string; precision?: string } = {};
  @state() private deleteTarget: Unit | null = null;
  /** The unit whose deletion is blocked, driving the in-use modal; null when the modal is closed. */
  @state() private inUseUnitId: string | null = null;
  @state() private inUseProducts: ProductUsingUnit[] = [];
  @state() private inUseSearch = "";
  /** Set by the shell after a product save to reopen the in-use modal for that unit with a fresh
   * list; consumed once (the shell clears it on the `wt-reopen-consumed` reply). */
  @property({ attribute: false }) reopenUnitId: string | null = null;
  #reopenHandled: string | null = null;
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

  #closeDelete(): void {
    this.deleteTarget = null;
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

  async #delete(): Promise<void> {
    if (!this.deleteTarget || this.busy) return;
    const target = this.deleteTarget;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteUnit(target.id);
      this.units = this.units.filter((unit) => unit.id !== target.id);
      this.#closeDelete();
    } catch (error) {
      const failure = error as UnitError;
      if (failure.code === "unit.in_use") {
        // Hand off from the confirm dialog to the in-use modal, which takes focus itself.
        this.deleteTarget = null;
        this.inUseUnitId = target.id;
        this.inUseProducts = failure.params?.products ?? [];
        this.inUseSearch = "";
      } else {
        this.error = failure;
        this.#closeDelete();
      }
    } finally {
      this.busy = false;
    }
  }

  #closeInUse(): void {
    this.inUseUnitId = null;
    this.inUseProducts = [];
    this.inUseSearch = "";
    requestAnimationFrame(() => this.focusTarget?.focus());
  }

  /** Retry the delete from inside the modal. Success removes the unit and closes; a still-in-use
   * refusal refreshes the list (a product was reassigned); any other error becomes an inline banner. */
  async #deleteUnitFromModal(): Promise<void> {
    if (this.inUseUnitId === null || this.busy) return;
    const id = this.inUseUnitId;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteUnit(id);
      this.units = this.units.filter((unit) => unit.id !== id);
      this.#closeInUse();
    } catch (error) {
      const failure = error as UnitError;
      if (failure.code === "unit.in_use") {
        this.inUseProducts = failure.params?.products ?? [];
      } else {
        this.error = failure;
        this.#closeInUse();
      }
    } finally {
      this.busy = false;
    }
  }

  /** The shell navigates to the product's editor and, on save, returns and reopens this modal. */
  #editProduct(productId: string, event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId, returnToUnitId: this.inUseUnitId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override updated(changed: PropertyValues): void {
    if (!changed.has("reopenUnitId")) return;
    if (this.reopenUnitId === null) {
      this.#reopenHandled = null;
    } else if (this.reopenUnitId !== this.#reopenHandled) {
      this.#reopenHandled = this.reopenUnitId;
      void this.#reopenInUse(this.reopenUnitId);
    }
  }

  async #reopenInUse(unitId: string): Promise<void> {
    this.inUseSearch = "";
    this.inUseUnitId = unitId;
    try {
      this.inUseProducts = await this.api.productsUsingUnit(unitId);
    } catch (error) {
      this.error = error as UnitError;
      this.inUseUnitId = null;
    }
    this.dispatchEvent(new CustomEvent("wt-reopen-consumed", { bubbles: true, composed: true }));
  }

  #productColumns(): DataTableColumn<ProductUsingUnit>[] {
    return [
      {
        key: "name",
        label: t("units.name"),
        cell: (product) => localizedName(product.name),
        sortValue: (product) => localizedName(product.name),
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

  #columns(): DataTableColumn<Unit>[] {
    return [
      {
        key: "name",
        label: t("units.name"),
        cell: (unit) => localizedName(unit.name),
        sortValue: (unit) => localizedName(unit.name),
      },
      {
        key: "precision",
        label: t("units.precision"),
        cell: (unit) => unit.precision,
        sortValue: (unit) => unit.precision,
      },
      {
        key: "actions",
        label: t("units.actions"),
        cell: (unit) => html`
          <wt-row-actions label=${`${t("units.actions")}: ${localizedName(unit.name)}`}>
            <wt-button
              data-test=${`edit-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => this.#openEdit(unit, event)}
              >${t("action.edit")}</wt-button
            >
            <wt-button
              data-test=${`delete-${unit.id}`}
              variant="ghost"
              @click=${(event: Event) => {
                event.stopPropagation();
                const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
                this.focusTarget = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
                this.deleteTarget = unit;
                this.error = null;
              }}
              >${t("action.delete")}</wt-button
            >
          </wt-row-actions>
        `,
      },
    ];
  }

  override render() {
    const needle = this.search.trim().toLocaleLowerCase();
    const rows =
      needle === ""
        ? this.units
        : this.units.filter((unit) =>
            Object.values(unit.name).some((name) => name.toLocaleLowerCase().includes(needle)),
          );
    const productNeedle = this.inUseSearch.trim().toLocaleLowerCase();
    const inUseRows =
      productNeedle === ""
        ? this.inUseProducts
        : this.inUseProducts.filter((product) =>
            Object.values(product.name).some((name) =>
              name.toLocaleLowerCase().includes(productNeedle),
            ),
          );
    return html`
      <h1>${t("units.title")}</h1>
      <p class="description">${t("units.description")}</p>
      <div class="toolbar">
        <wt-input
          class="search"
          data-test="search"
          name="unit-search"
          label=${t("units.search")}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        <wt-button data-test="create" variant="primary" @click=${this.#openCreate}
          >${t("units.create")}</wt-button
        >
      </div>
      ${
        this.error
          ? html`<div class="error" role="alert">
              ${
                this.editorOpen && this.error.code
                  ? codeMessage(this.error.code)
                  : t("units.load_error")
              }
            </div>`
          : nothing
      }
      <wt-data-table
        aria-label=${t("units.title")}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(unit: Unit) => unit.id}
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
      <wt-dialog
        .open=${this.deleteTarget !== null}
        heading=${t("units.delete_title")}
        @wt-close=${this.#closeDelete}
      >
        <p>${t("units.delete_body")}</p>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel-delete"
            variant="secondary"
            @click=${this.#closeDelete}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="confirm-delete"
            variant="danger"
            ?disabled=${this.busy}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
      <wt-dialog
        data-test="in-use-dialog"
        .open=${this.inUseUnitId !== null}
        heading=${this.inUseProducts.length === 0 ? t("units.delete_unit") : t("units.in_use_title")}
        @wt-close=${this.#closeInUse}
      >
        <p>${this.inUseProducts.length === 0 ? t("units.in_use_empty") : t("units.in_use_body")}</p>
        ${
          this.inUseProducts.length > 0
            ? html`
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
                <wt-data-table
                  aria-label=${t("units.in_use_title")}
                  .rows=${inUseRows}
                  .columns=${this.#productColumns()}
                  .rowKey=${(product: ProductUsingUnit) => product.id}
                ></wt-data-table>
              `
            : nothing
        }
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="close-in-use"
            variant="secondary"
            @click=${this.#closeInUse}
            >${t("action.close")}</wt-button
          >
          <wt-button
            data-test="delete-unit"
            variant="danger"
            ?disabled=${this.busy}
            @click=${() => void this.#deleteUnitFromModal()}
            >${t("units.delete_unit")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-units-screen": UnitsScreen;
  }
}
