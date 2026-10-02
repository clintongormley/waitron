import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import { t, currentLocale } from "../i18n/t.js";
import { allergenState, allergenStateName, vatClassName } from "../i18n/domain.js";
import { categoryPath, categoryWithDescendants } from "./category-form.js";
import { priceSearchText } from "./form-fields.js";
import {
  holdPageCursor,
  pointerElementsAt,
  releasePageCursor,
} from "@waitron/ui/src/reorder-table.js";
import {
  modifierListName,
  modifierListNames,
  type ModifierListChoice,
} from "./product-editor-model.js";
import type { CategorySummary, MadeAt, Product } from "../api/client.js";
import {
  PRODUCT_ORDERINGS,
  type ProductOrdering,
} from "@waitron/catalogue/src/product-ordering.js";

type ListRow =
  ProductRow | { kind: "folder"; key: string; parentKey: null; folder: CategorySummary };

interface ProductRow {
  kind: "product";
  key: string;
  parentKey: string | null;
  product: Product;
  variant: Product["variants"][number] | null;
}

function orderingName(ordering: ProductOrdering): string {
  return t(`product.ordering_${ordering}`);
}

/** The till sells a variant only while it AND its product are Active, so that is its status. */
function rowActive({ product, variant }: ProductRow): boolean {
  return product.active && (variant?.active ?? true);
}

export function acceptsCatalogueDrop(
  keys: string[],
  folderId: string | null,
  categories: CategorySummary[],
): boolean {
  return (
    keys.length > 0 &&
    (folderId === null ||
      !keys.some(
        (key) =>
          key.startsWith("folder:") &&
          categoryWithDescendants(key.slice(7), categories).has(folderId),
      ))
  );
}

@customElement("dashboard-product-list")
export class ProductList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Cell templates are rendered in wt-data-table's shadow root, so ::part is the one boundary
         crossing used for their presentation. */
      wt-data-table::part(folder-cell) {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      /* Inline, not flex: the table lines a row up by its cells' first baselines, and a flex row
         would give the cell the thumbnail's bottom edge as its baseline instead of the name's. */
      wt-data-table::part(product-cell) {
        display: block;
      }
      wt-data-table::part(drop-target) {
        background: var(--wt-color-surface-lifted);
        outline: var(--wt-selected-ring);
      }
      wt-data-table::part(dragging) {
        position: relative;
        z-index: 1;
        pointer-events: none;
        background: var(--wt-color-surface-lifted);
        box-shadow: var(--wt-shadow-2);
      }
      wt-data-table::part(drag-grip) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        touch-action: none;
        user-select: none;
        cursor: var(--reorder-drag-cursor, grab);
      }
      wt-data-table::part(thumb-frame),
      wt-data-table::part(thumb-placeholder) {
        display: inline-block;
        vertical-align: middle;
        margin-inline-end: var(--wt-space-3);
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
        background: var(--wt-color-surface);
      }
      wt-data-table::part(thumbnail) {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      wt-data-table::part(badge) {
        display: inline-flex;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      wt-data-table::part(unrouted-folder) {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(variant-muted),
      wt-data-table::part(context) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(vat-note) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
      wt-data-table::part(maker-link) {
        display: block;
        max-inline-size: 12rem;
        white-space: normal;
        overflow-wrap: anywhere;
        color: var(--wt-color-primary);
      }
    `,
  ];

  @property({ type: Boolean }) selecting = false;
  @property({ attribute: false }) selected: string[] = [];
  @property({ attribute: false }) folders: CategorySummary[] = [];
  @property({ type: Boolean }) showPath = true;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) madeAt: Record<string, MadeAt> = {};
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) unroutedFolderIds: string[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];

  #listNames: ReadonlyMap<string, string> = new Map();
  #dragged: string[] = [];
  #dropTarget: HTMLElement | null = null;
  #pointerDrag: {
    pointerId: number;
    key: string;
    row: HTMLElement;
    x: number;
    y: number;
    top: number;
    active: boolean;
  } | null = null;

  override disconnectedCallback(): void {
    if (this.#pointerDrag)
      this.#endDrag(new PointerEvent("pointercancel", { pointerId: this.#pointerDrag.pointerId }));
    super.disconnectedCallback();
  }

  #clearDropTarget(): void {
    this.#dropTarget?.part.remove("drop-target");
    this.#dropTarget = null;
  }
  #startDrag(event: PointerEvent, key: string): void {
    if (this.#pointerDrag || event.button !== 0) return;
    if (
      event.pointerType === "touch" &&
      !(event.currentTarget as HTMLElement).classList.contains("drag-grip")
    )
      return;
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>("tr[data-row-key]");
    if (!row) return;
    this.#pointerDrag = {
      pointerId: event.pointerId,
      key,
      row,
      x: event.clientX,
      y: event.clientY,
      top: row.getBoundingClientRect().top,
      active: false,
    };
    document.addEventListener("pointermove", this.#moveDrag);
    document.addEventListener("pointerup", this.#endDrag);
    document.addEventListener("pointercancel", this.#endDrag);
  }
  readonly #moveDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      drag.row.part.add("dragging");
      holdPageCursor();
      this.#dragged = this.selected.includes(drag.key) ? [...this.selected] : [drag.key];
      this.dispatchEvent(
        new CustomEvent("drag-items", {
          detail: { keys: this.#dragged },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.#clearDropTarget();
    const path = pointerElementsAt(event.clientX, event.clientY);
    const target = path.find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.part?.contains("folder-cell"),
    );
    const folderId = target
      ?.closest<HTMLElement>("tr[data-row-key]")
      ?.dataset.rowKey?.replace(/^folder:/, "");
    if (target && folderId && acceptsCatalogueDrop(this.#dragged, folderId, this.categories)) {
      this.#dropTarget = target;
      target.part.add("drop-target");
    }
    const hovered =
      this.#dropTarget?.closest("tr") ??
      path.find((item) => item instanceof HTMLElement && item.matches("li[data-crumb-drop]"));
    const hoverBox = hovered?.getBoundingClientRect();
    const below = hoverBox ? hoverBox.bottom + 8 : event.clientY - (drag.y - drag.top);
    const top =
      hoverBox && below + drag.row.offsetHeight > window.innerHeight
        ? hoverBox.top - drag.row.offsetHeight - 8
        : below;
    drag.row.style.transform = `translateY(${top - drag.top}px)`;
    this.dispatchEvent(
      new CustomEvent("pointer-drag-move", {
        detail: { path },
        bubbles: true,
        composed: true,
      }),
    );
  };
  readonly #endDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    document.removeEventListener("pointermove", this.#moveDrag);
    document.removeEventListener("pointerup", this.#endDrag);
    document.removeEventListener("pointercancel", this.#endDrag);
    this.#pointerDrag = null;
    drag.row.part.remove("dragging");
    drag.row.style.removeProperty("transform");
    if (drag.active) releasePageCursor();
    if (drag.active && event.type === "pointerup") {
      // Pointer drags still produce a click; keep it from activating the source or destination.
      document.addEventListener("click", this.#blockPostDragClick, true);
      setTimeout(() => document.removeEventListener("click", this.#blockPostDragClick, true), 0);
    }
    if (drag.active && event.type === "pointerup" && this.#dropTarget) {
      const folderId = this.#dropTarget
        .closest<HTMLElement>("tr[data-row-key]")
        ?.dataset.rowKey?.replace(/^folder:/, "");
      if (folderId) this.#dropFolder(folderId);
    }
    if (drag.active) {
      this.dispatchEvent(
        new CustomEvent("pointer-drag-end", {
          detail: { cancelled: event.type === "pointercancel" },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.#clearDropTarget();
    this.#dragged = [];
    this.dispatchEvent(
      new CustomEvent("drag-items", { detail: { keys: [] }, bubbles: true, composed: true }),
    );
  };
  readonly #blockPostDragClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.removeEventListener("click", this.#blockPostDragClick, true);
  };
  #dropFolder(folderId: string): void {
    this.dispatchEvent(
      new CustomEvent("drop-items", {
        detail: { keys: [...this.#dragged], folderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
  }

  #emit(
    event: Event,
    name: "edit-product" | "delete-product" | "restore-product",
    productId: string,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ productId: string }>(name, {
        detail: { productId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #rows(): ListRow[] {
    return [
      ...this.folders.map((folder): ListRow => ({
        kind: "folder",
        key: `folder:${folder.id}`,
        parentKey: null,
        folder,
      })),
      ...this.products.flatMap((product) => [
        { kind: "product" as const, key: product.id, parentKey: null, product, variant: null },
        ...product.variants.map((variant) => ({
          kind: "product" as const,
          key: `${product.id}:${variant.id}`,
          parentKey: product.id,
          product,
          variant,
        })),
      ]),
    ];
  }

  #category(id: string | null): string {
    if (id === null) return "";
    const category = this.categories.find((candidate) => candidate.id === id);
    return category ? categoryPath(category, this.categories) : t("editor.missing_choice");
  }

  /** A variant's row reads the main category it is reported under, which the server resolves: its
   * own or its parent's. */
  #values({ product, variant }: ProductRow): { primaryCategoryId: string | null } {
    return variant?.effective ?? product;
  }

  #modifierNames(product: Product): string {
    return product.modifiers.map((ref) => modifierListName(ref, this.#listNames)).join(", ");
  }

  #unavailableBadge() {
    return html`<span part="badge" data-test="unavailable-badge"
      >${t("product.unavailable_badge")}</span
    >`;
  }

  /** A product with an Active variant is sold only as one of them, and one with none sells as
   * itself. */
  #amounts({ product, variant }: ProductRow): string[] {
    if (variant) return [variant.effective.unitPrice];
    const sold = product.variants.filter(({ active }) => active);
    return sold.length ? sold.map(({ effective }) => effective.unitPrice) : [product.unitPrice];
  }

  #prices(row: ProductRow): { low: number; high: number } {
    const prices = this.#amounts(row).map(Number);
    return { low: Math.min(...prices), high: Math.max(...prices) };
  }

  #price(row: ProductRow): string {
    const locale = currentLocale();
    const { low, high } = this.#prices(row);
    const text = formatMoney(String(low), locale);
    return low === high ? text : `${text}–${formatMoney(String(high), locale)}`;
  }

  #productColumns(): DataTableColumn<ProductRow>[] {
    return [
      {
        key: "name",
        label: t("product.name"),
        sortValue: (row) => row.variant?.name ?? row.product.name,
        searchValue: (row) => row.variant?.name ?? row.product.name,
        cell: ({ product, variant }, { ancestorOnly }) =>
          variant
            ? html`<strong>${variant.name}</strong>`
            : html`<span
                part=${ancestorOnly ? "product-cell context" : "product-cell"}
                @pointerdown=${(event: PointerEvent) => this.#startDrag(event, product.id)}
              >
                <button
                  class="drag-grip"
                  part="drag-grip"
                  type="button"
                  aria-label=${`${t("folders.drag")}: ${product.name}`}
                  @pointerdown=${(event: PointerEvent) => this.#startDrag(event, product.id)}
                >
                  <wt-icon name="grip"></wt-icon>
                </button>
                ${
                  product.image === null
                    ? html`<span
                        part="thumb-placeholder"
                        data-test="thumb-placeholder"
                        aria-hidden="true"
                      ></span>`
                    : html`<span part="thumb-frame" data-test="thumb"
                        ><img
                          part="thumbnail"
                          src=${`/media/${product.image}`}
                          alt=""
                          draggable="false"
                      /></span>`
                }<strong>${product.name}</strong>
              </span>`,
      },
      {
        key: "reporting-category",
        choosable: "shown",
        label: t("editor.main_category"),
        cell: (row) => this.#category(this.#values(row).primaryCategoryId),
        searchValue: (row) => this.#category(this.#values(row).primaryCategoryId),
      },
      {
        key: "made-at",
        choosable: "shown",
        label: t("product.made_at"),
        cell: (row) => {
          const id = row.variant?.id ?? row.product.id;
          const maker = this.madeAt[id];
          const name = maker?.noPreparation
            ? t("product.no_preparation")
            : (maker?.stationName ?? t("product.nowhere"));
          return html`<a part="maker-link" href=${`/manage/prep-stations/test/${id}`}
            >${name}${maker?.variesByZone ? html` · ${t("product.varies_by_zone")}` : nothing}</a
          >`;
        },
      },
      {
        key: "price",
        choosable: "shown",
        label: t("product.price"),
        align: "end",
        // The list has no VAT column; a variant whose VAT differs from its product's notes it under
        // its price, since nothing else on the row would show it.
        cell: (row) => {
          const vat = row.variant?.effective.vatClass;
          return html`<span data-test="price">${this.#price(row)}</span>${
              vat === undefined || vat === row.product.vatClass
                ? nothing
                : html`<span part="vat-note" data-test="vat-note"
                    >${t("product.vat")}: ${vatClassName(vat)}</span
                  >`
            }`;
        },
        sortValue: (row) => this.#prices(row).low,
        searchValue: (row) => {
          const { low, high } = this.#prices(row);
          const ends = this.#amounts(row).filter((raw) => [low, high].includes(Number(raw)));
          return priceSearchText(this.#price(row), ends);
        },
      },
      {
        key: "modifiers",
        choosable: "shown",
        label: t("editor.modifiers"),
        cell: ({ product, variant }) =>
          variant ? html`<span part="variant-muted">—</span>` : this.#modifierNames(product),
        searchValue: ({ product, variant }) => (variant ? "" : this.#modifierNames(product)),
      },
      {
        key: "ordering",
        choosable: "shown",
        label: t("product.ordering"),
        // A variant is a way of buying its product, so the filter reads the PRODUCT's answer on
        // every row and a variant is shown or hidden together with its product.
        cell: ({ product, variant }) => {
          if (variant) return html`<span part="variant-muted">—</span>`;
          return html`<span
            part="badge"
            data-test="ordering-badge"
            data-ordering=${product.ordering}
            >${orderingName(product.ordering)}</span
          >`;
        },
        searchValue: ({ product, variant }) => (variant ? "" : orderingName(product.ordering)),
        sortValue: ({ product }) => PRODUCT_ORDERINGS.indexOf(product.ordering),
        filter: {
          label: t("product.ordering"),
          allLabel: t("product.filter_ordering_all"),
          value: ({ product }) => product.ordering,
          options: PRODUCT_ORDERINGS.map((ordering) => ({
            value: ordering,
            label: orderingName(ordering),
          })),
        },
      },
      {
        key: "active",
        choosable: "shown",
        label: t("product.status"),
        // A variant of an Inactive product answers Inactive (see rowActive), so it moves with its
        // product and never leaves it behind as an empty context row; its badge still shows its OWN
        // flag.
        cell: ({ product, variant }) => {
          const active = variant?.active ?? product.active;
          return html`<span
              part="badge"
              data-test="active-badge"
              data-active=${active ? "true" : "false"}
              >${active ? t("product.active_badge") : t("product.inactive_badge")}</span
            >
            ${(variant ?? product).available ? nothing : this.#unavailableBadge()}`;
        },
        sortValue: (row) => (rowActive(row) ? 0 : 1),
        filter: {
          label: t("product.status"),
          allLabel: t("product.filter_status_all"),
          value: (row) => (rowActive(row) ? "active" : "inactive"),
          options: [
            { value: "active", label: t("product.active_badge") },
            { value: "inactive", label: t("product.inactive_badge") },
          ],
          initial: "active",
        },
      },
      {
        key: "allergens",
        choosable: "shown",
        label: t("product.allergens"),
        cell: ({ product, variant }) => {
          if (variant) return html`<span part="variant-muted">—</span>`;
          const state = allergenState(product.allergens);
          return html`<span part="badge" data-test="allergen-state" data-state=${state}
            >${allergenStateName(state)}</span
          >`;
        },
        sortValue: ({ product, variant }) =>
          variant ? "" : allergenStateName(allergenState(product.allergens)),
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        pinned: "end",
        cell: ({ product, variant }) => {
          const { id, name } = variant ?? product;
          const restore = variant !== null && !variant.active;
          const removal = restore
            ? { event: "restore-product" as const, test: "restore", label: t("product.restore") }
            : {
                event: "delete-product" as const,
                test: "delete",
                label: variant ? t("action.remove") : t("action.delete"),
              };
          return html`<wt-row-actions
            align="end"
            data-test=${`actions-${id}`}
            label=${`${t("staff.actions")}: ${name}`}
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`edit-${id}`}
              @click=${(event: Event) => this.#emit(event, "edit-product", id)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant=${restore ? "secondary" : "danger"}
              data-test=${`${removal.test}-${id}`}
              @click=${(event: Event) => this.#emit(event, removal.event, id)}
              >${removal.label}</wt-button
            ></wt-row-actions
          >`;
        },
      },
    ];
  }

  #emitFolder(event: Event, name: string, folderId: string): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent(name, { detail: { folderId }, bubbles: true, composed: true }),
    );
  }

  #columns(): DataTableColumn<ListRow>[] {
    return this.#productColumns()
      .filter((column) => this.showPath || column.key !== "reporting-category")
      .map((column) => ({
        key: column.key,
        label: column.label,
        align: column.align,
        choosable: column.choosable,
        pinned: column.pinned,
        cell: (row, context) => {
          if (row.kind === "product") return column.cell(row, context);
          const { folder } = row;
          if (column.key === "name")
            return html`<span
              part="folder-cell"
              @pointerdown=${(event: PointerEvent) => this.#startDrag(event, row.key)}
              ><button
                class="drag-grip"
                part="drag-grip"
                type="button"
                aria-label=${`${t("folders.drag")}: ${folder.name}`}
                @pointerdown=${(event: PointerEvent) => this.#startDrag(event, row.key)}
              >
                <wt-icon name="grip"></wt-icon></button
              ><wt-icon name="folder"></wt-icon
              ><wt-button
                variant="ghost"
                aria-label=${t("folders.open_named").replace("{name}", folder.name)}
                data-test=${`open-${folder.id}`}
                @click=${(event: Event) => this.#emitFolder(event, "open-folder", folder.id)}
                >${folder.name}</wt-button
              >${this.unroutedFolderIds.includes(folder.id) ? html`<span part="unrouted-folder" data-test="unrouted-folder" role="img" aria-label=${t("folders.no_routing_rule")} title=${t("folders.no_routing_rule")}>*</span>` : nothing}</span
            >`;
          if (column.key === "reporting-category") return this.#category(folder.parentId);
          if (column.key === "actions")
            return html`<wt-row-actions
              align="end"
              label=${`${t("staff.actions")}: ${folder.name}`}
              data-test=${`actions-folder-${folder.id}`}
              ><wt-button
                align="start"
                variant="secondary"
                data-test=${`rename-${folder.id}`}
                @click=${(event: Event) => this.#emitFolder(event, "rename-folder", folder.id)}
                >${t("folders.rename")}</wt-button
              ><wt-button
                align="start"
                variant="danger"
                data-test=${`delete-folder-${folder.id}`}
                @click=${(event: Event) => this.#emitFolder(event, "delete-folder", folder.id)}
                >${t("action.delete")}</wt-button
              ></wt-row-actions
            >`;
          return nothing;
        },
        ...(column.sortValue
          ? {
              sortValue: (row: ListRow) =>
                column.key === "name"
                  ? row.kind === "folder"
                    ? "a" + row.folder.name
                    : "b" + (row.variant?.name ?? row.product.name)
                  : row.kind === "folder"
                    ? ""
                    : column.sortValue!(row),
            }
          : {}),
        ...(column.searchValue
          ? {
              searchValue: (row: ListRow) =>
                row.kind === "folder"
                  ? column.key === "name"
                    ? row.folder.name
                    : column.key === "reporting-category"
                      ? this.#category(row.folder.parentId)
                      : ""
                  : column.searchValue!(row),
            }
          : {}),
        ...(column.filter
          ? {
              filter: {
                ...column.filter,
                value: (row: ListRow) =>
                  row.kind === "folder"
                    ? column.filter!.options.map((option) => option.value)
                    : column.filter!.value(row),
              },
            }
          : {}),
      }));
  }

  override render() {
    return html`<wt-data-table
      filterSearchPlaceholder=${t("categories.combobox_search")}
      filterNoResultsLabel=${t("categories.combobox_no_results")}
      aria-label=${t("catalogue.title")}
      viewKey="waitron.products.table"
      columnsLabel=${t("table.columns")}
      sortKey="name"
      sortDirection="ascending"
      collapseLabel=${t("categories.collapse")}
      expandLabel=${t("categories.expand")}
      initiallyCollapsed
      .selectable=${this.selecting}
      .selected=${this.selected}
      .rowSelectable=${(row: ListRow) => row.kind === "folder" || row.variant === null}
      .selectionLabel=${(row: ListRow) => (row.kind === "folder" ? row.folder.name : (row.variant?.name ?? row.product.name))}
      .rows=${this.#rows()}
      .columns=${this.#columns()}
      .rowKey=${(row: ListRow) => row.key}
      .rowParent=${(row: ListRow) => row.parentKey}
      .emptyMessage=${t("catalogue.no_products")}
    ></wt-data-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
