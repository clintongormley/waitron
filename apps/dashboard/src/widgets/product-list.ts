import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn, type WtDataTable } from "@waitron/ui";
import { formatMoney, resolveContentText } from "@waitron/shared";
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
import type { CategorySummary, MadeAt, Product, Unit } from "../api/client.js";
import {
  PRODUCT_ORDERINGS,
  type ProductOrdering,
} from "@waitron/catalogue/src/product-ordering.js";

export const ROOT_KEY = "root";

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null };
type CategoryRow = { kind: "folder"; key: string; parentKey: string; folder: CategorySummary };
type ListRow = ProductRow | CategoryRow | RootRow;

interface ProductRow {
  kind: "product";
  key: string;
  parentKey: string;
  product: Product;
  variant: Product["variants"][number] | null;
}

function countOf(key: "folders.count" | "folders.product_count", count: number): string {
  return t(count === 1 ? `${key}_one` : key).replace("{count}", String(count));
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
      wt-data-table::part(menu-divider) {
        align-self: stretch;
        margin: var(--wt-space-1) 0;
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }
      wt-data-table::part(count) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(price-unit) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) madeAt: Record<string, MadeAt> = {};
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) unroutedFolderIds: string[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  /** The venue's stored units; a product whose unit is not among them is sold by the each. */
  @property({ attribute: false }) units: readonly Unit[] = [];
  /** The content language a stored unit's abbreviation is read in. */
  @property() unitLanguage = "en";
  /** The search box's text; while it lasts, the table holds every category above a match open. */
  @property() search = "";
  /** Whether a product can be made yet: the editor needs a content language and a unit. */
  @property({ type: Boolean }) canAddProduct = false;

  #listNames: ReadonlyMap<string, string> = new Map();
  #rowByKey = new Map<string, ListRow>();
  #counts = new Map<string | null, { categories: number; products: number }>();
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
  /** A mouse drags a category or product from anywhere on its row; a finger only from the grip, so it
   * can still scroll; a control on the row is never a drag handle. */
  readonly #pointerDown = (event: PointerEvent): void => {
    const path = event
      .composedPath()
      .filter((item): item is HTMLElement => item instanceof HTMLElement);
    const row = path.find((item) => item.matches("tr[data-row-key]"));
    const listed = row ? this.#rowByKey.get(row.dataset.rowKey!) : undefined;
    if (!row || !listed || listed.kind === "root") return;
    if (listed.kind === "product" && listed.variant !== null) return;
    if (
      path.some((item) =>
        item.matches("input, a, wt-row-actions, wt-input, button:not(.row-activate, .drag-grip)"),
      )
    )
      return;
    const grip = path.some((item) => item.classList.contains("drag-grip"));
    this.#startDrag(event, listed.key, row, grip);
  };

  #startDrag(event: PointerEvent, key: string, row: HTMLElement, grip: boolean): void {
    if (this.#pointerDrag || event.button !== 0) return;
    if (event.pointerType === "touch" && !grip) return;
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
    const row = pointerElementsAt(event.clientX, event.clientY).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement &&
        item.matches(`tr[data-row-key^="folder:"], tr[data-row-key="${ROOT_KEY}"]`),
    );
    const key = row?.dataset.rowKey;
    const cell = row?.querySelector<HTMLElement>('[part~="folder-cell"]');
    if (
      cell &&
      key &&
      acceptsCatalogueDrop(this.#dragged, key === ROOT_KEY ? null : key.slice(7), this.categories)
    ) {
      this.#dropTarget = cell;
      cell.part.add("drop-target");
    }
    const hoverBox = this.#dropTarget?.closest("tr")?.getBoundingClientRect();
    const below = hoverBox ? hoverBox.bottom + 8 : event.clientY - (drag.y - drag.top);
    const top =
      hoverBox && below + drag.row.offsetHeight > window.innerHeight
        ? hoverBox.top - drag.row.offsetHeight - 8
        : below;
    drag.row.style.transform = `translateY(${top - drag.top}px)`;
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
      const key = this.#dropTarget.closest<HTMLElement>("tr[data-row-key]")!.dataset.rowKey!;
      this.#dropFolder(key === ROOT_KEY ? null : key.slice(7));
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
  #dropFolder(folderId: string | null): void {
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
    if (changed.has("categories") || changed.has("products")) this.#counts = this.#count();
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
    const known = new Set(this.categories.map(({ id }) => id));
    const keyOf = (id: string | null): string =>
      id !== null && known.has(id) ? `folder:${id}` : ROOT_KEY;
    return [
      { kind: "root", key: ROOT_KEY, parentKey: null },
      ...this.categories.map((folder): CategoryRow => ({
        kind: "folder",
        key: `folder:${folder.id}`,
        parentKey: keyOf(folder.parentId),
        folder,
      })),
      ...this.products.flatMap((product): ProductRow[] => [
        {
          kind: "product",
          key: product.id,
          parentKey: keyOf(product.primaryCategoryId),
          product,
          variant: null,
        },
        ...product.variants.map((variant): ProductRow => ({
          kind: "product",
          key: `${product.id}:${variant.id}`,
          parentKey: product.id,
          product,
          variant,
        })),
      ]),
    ];
  }

  /** What each category holds directly, and under `null` the whole catalogue, counted once per change
   * of the lists rather than once per row drawn. Inactive products are left out, as the default
   * Status filter hides them. */
  #count(): Map<string | null, { categories: number; products: number }> {
    const counts = new Map<string | null, { categories: number; products: number }>([
      [null, { categories: this.categories.length, products: 0 }],
    ]);
    const entry = (id: string) =>
      counts.get(id) ?? counts.set(id, { categories: 0, products: 0 }).get(id)!;
    for (const category of this.categories)
      if (category.parentId !== null) entry(category.parentId).categories++;
    for (const product of this.products) {
      if (!product.active) continue;
      counts.get(null)!.products++;
      if (product.primaryCategoryId !== null) entry(product.primaryCategoryId).products++;
    }
    return counts;
  }

  #contents(categoryId: string | null): string {
    const { categories, products } = this.#counts.get(categoryId) ?? { categories: 0, products: 0 };
    const parts = categories > 0 ? [countOf("folders.count", categories)] : [];
    if (products > 0 || categories === 0) parts.push(countOf("folders.product_count", products));
    return parts.join(", ");
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

  /** The rule the product editor's `unitShortLabel` uses: Each for a unit that is not stored, else
   * the abbreviation, or the name when it has none. A listed product with no stored unit still
   * carries one, the server's Each, so only the stored list tells the two apart. */
  #unitWord(product: Product): string {
    if (!this.units.some(({ id }) => id === product.unitId)) return t("product.price_each");
    const language = this.unitLanguage;
    const name =
      resolveContentText(product.unit.abbreviation, language, language) ||
      resolveContentText(product.unit.name, language, language);
    return t("product.price_per").replace("{unit}", name);
  }

  #productColumns(): DataTableColumn<ProductRow>[] {
    return [
      {
        key: "name",
        label: t("product.name"),
        sortValue: (row) => row.variant?.name ?? row.product.name,
        searchValue: ({ product }) =>
          [product.name, ...product.variants.map(({ name }) => name)].join(" "),
        cell: ({ product, variant }, { ancestorOnly }) =>
          variant
            ? html`<strong>${variant.name}</strong>`
            : html`<span part=${ancestorOnly ? "product-cell context" : "product-cell"}>
                <button
                  class="drag-grip"
                  part="drag-grip"
                  type="button"
                  aria-label=${`${t("folders.drag")}: ${product.name}`}
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
            : maker?.noReplacement
              ? t("product.no_replacement").replace(
                  "{name}",
                  maker.stationName ?? t("product.nowhere"),
                )
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
          return html`<span data-test="price">${this.#price(row)}</span>
            <span part="price-unit" data-test="price-unit">${this.#unitWord(row.product)}</span>${
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

  #addItems(categoryId: string | null) {
    const test = categoryId ?? ROOT_KEY;
    return html`<wt-button
        align="start"
        variant="secondary"
        data-test=${`add-product-${test}`}
        ?disabled=${!this.canAddProduct}
        @click=${() => {
          if (this.canAddProduct) this.#send("add-product", { categoryId });
        }}
        >${t("catalogue.add_product")}</wt-button
      ><wt-button
        align="start"
        variant="secondary"
        data-test=${`add-category-${test}`}
        @click=${() => this.#send("add-category", { parentId: categoryId })}
        >${t("folders.add_category")}</wt-button
      >`;
  }

  #columns(): DataTableColumn<ListRow>[] {
    return this.#productColumns().map((column) => ({
      key: column.key,
      label: column.label,
      align: column.align,
      choosable: column.choosable,
      pinned: column.pinned,
      cell: (row, context) => {
        if (row.kind === "product") return column.cell(row, context);
        if (row.kind === "root") {
          if (column.key === "name")
            return html`<span part="folder-cell"
              ><wt-icon name="folder"></wt-icon><strong>${t("folders.all_products")}</strong
              ><span part="count" data-test="count-root">${this.#contents(null)}</span></span
            >`;
          if (column.key === "actions")
            return html`<wt-row-actions
              align="end"
              data-test="actions-root"
              label=${`${t("staff.actions")}: ${t("folders.all_products")}`}
              >${this.#addItems(null)}</wt-row-actions
            >`;
          return nothing;
        }
        const { folder } = row;
        if (column.key === "name")
          return html`<span part="folder-cell"
            ><button
              class="drag-grip"
              part="drag-grip"
              type="button"
              aria-label=${`${t("folders.drag")}: ${folder.name}`}
            >
              <wt-icon name="grip"></wt-icon></button
            ><wt-icon name="folder"></wt-icon><strong>${folder.name}</strong
            ><span part="count" data-test=${`count-${folder.id}`}>${this.#contents(folder.id)}</span
            >${
              this.unroutedFolderIds.includes(folder.id)
                ? html`<span
                    part="unrouted-folder"
                    data-test="unrouted-folder"
                    role="img"
                    aria-label=${t("folders.no_routing_rule")}
                    title=${t("folders.no_routing_rule")}
                    >*</span
                  >`
                : nothing
            }</span
          >`;
        if (column.key === "actions")
          return html`<wt-row-actions
            align="end"
            label=${`${t("staff.actions")}: ${folder.name}`}
            data-test=${`actions-folder-${folder.id}`}
            >${this.#addItems(folder.id)}
            <hr part="menu-divider" />
            <wt-button
              align="start"
              variant="secondary"
              data-test=${`rename-${folder.id}`}
              @click=${(event: Event) => this.#emitFolder(event, "rename-folder", folder.id)}
              >${t("folders.rename")}</wt-button
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`move-${folder.id}`}
              @click=${() => this.#send("move-folder", { folderId: folder.id })}
              >${t("folders.move")}</wt-button
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
              row.kind === "product"
                ? column.sortValue!(row)
                : row.kind === "folder"
                  ? row.folder.name
                  : "",
          }
        : {}),
      ...(column.searchValue
        ? {
            // A variant is found through its product, whose text holds its variants' names.
            searchValue: (row: ListRow) =>
              row.kind === "product"
                ? row.variant === null
                  ? column.searchValue!(row)
                  : ""
                : row.kind === "root"
                  ? ""
                  : column.key === "name"
                    ? row.folder.name
                    : column.key === "reporting-category"
                      ? this.#category(row.folder.parentId)
                      : "",
          }
        : {}),
      ...(column.filter
        ? {
            filter: {
              ...column.filter,
              value: (row: ListRow) =>
                row.kind === "product"
                  ? column.filter!.value(row)
                  : column.filter!.options.map((option) => option.value),
            },
          }
        : {}),
    }));
  }

  #table(): WtDataTable<ListRow> | null {
    return this.shadowRoot?.querySelector<WtDataTable<ListRow>>("wt-data-table") ?? null;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  readonly #expandChange = (event: CustomEvent<{ key: string; expanded: boolean }>): void => {
    event.stopPropagation();
    const { key, expanded } = event.detail;
    if (key.startsWith("folder:"))
      this.#send("category-toggle", { categoryId: key.slice(7), open: expanded });
  };

  /** Opens the category and every category above it, and scrolls it into view. */
  async revealCategory(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    table.setExpanded(`folder:${id}`, true);
    await table.revealRow(`folder:${id}`);
  }

  /** Opens every category above a product and scrolls it into view. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    await table.revealRow(id);
  }

  focusRowMenu(categoryId: string | null): void {
    const key = categoryId === null ? ROOT_KEY : `folder:${categoryId}`;
    this.#table()
      ?.shadowRoot?.querySelector<HTMLElement>(
        `tr[data-row-key="${CSS.escape(key)}"] wt-row-actions`,
      )
      ?.focus();
  }

  override render() {
    const rows = this.#rows();
    this.#rowByKey = new Map(rows.map((row) => [row.key, row]));
    return html`<wt-data-table
      noMatchesMessage=${tableNoMatches()}
      filterSearchPlaceholder=${t("categories.combobox_search")}
      filterNoResultsLabel=${t("categories.combobox_no_results")}
      aria-label=${t("catalogue.title")}
      viewKey="waitron.products.table"
      rememberExpanded
      searchOpensPath
      columnsLabel=${t("table.columns")}
      sortKey="name"
      sortDirection="ascending"
      collapseLabel=${t("categories.collapse")}
      expandLabel=${t("categories.expand")}
      initiallyCollapsed
      .searchTerm=${this.search}
      .selectable=${this.selecting}
      .selected=${this.selected}
      .rowSelectable=${(row: ListRow) =>
        row.kind === "folder" || (row.kind === "product" && row.variant === null)}
      .selectionLabel=${(row: ListRow) =>
        row.kind === "folder"
          ? row.folder.name
          : row.kind === "product"
            ? (row.variant?.name ?? row.product.name)
            : ""}
      .rowGroup=${(row: ListRow) => (row.kind === "product" ? 1 : 0)}
      .rowCollapsible=${(row: ListRow) => row.kind !== "root"}
      .rowActivation=${(row: ListRow) =>
        row.kind === "folder" ? "toggle" : row.kind === "root" ? "none" : "click"}
      .rowToggleLabel=${(row: ListRow, expanded: boolean) =>
        row.kind === "folder"
          ? t(expanded ? "folders.close_named" : "folders.open_named").replace(
              "{name}",
              row.folder.name,
            )
          : t(expanded ? "categories.collapse" : "categories.expand")}
      .rowClick=${(row: ListRow) => {
        if (row.kind === "product")
          this.#send("edit-product", { productId: (row.variant ?? row.product).id });
      }}
      .rowClickLabel=${(row: ListRow) =>
        row.kind === "product" ? `${t("action.edit")}: ${(row.variant ?? row.product).name}` : ""}
      .rows=${rows}
      .columns=${this.#columns()}
      .rowKey=${(row: ListRow) => row.key}
      .rowParent=${(row: ListRow) => row.parentKey}
      @pointerdown=${this.#pointerDown}
      @wt-expand-change=${this.#expandChange}
    ></wt-data-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
