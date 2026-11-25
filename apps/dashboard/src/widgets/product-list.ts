import { unitPresentation } from "@waitron/menu/src/unit-presentation.js";
import { DragEdgeScroll } from "@waitron/ui/src/drag-edge-scroll.js";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  rowActionTail,
  baseStyles,
  belongsToComposition,
  currentContentLanguages,
  type DataTableColumn,
  type WtDataTable,
} from "@waitron/ui";
import {
  formatMoney,
  categoryColorSource,
  createLabelComparator,
  isStoredColor,
  PRODUCT_ORDERINGS,
  type ProductOrdering,
} from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import { fill, t, currentLocale } from "../i18n/t.js";
import { countOf } from "./count-text.js";
import { allergenState, allergenStateName, vatRateText } from "../i18n/domain.js";
import { categoryPath, categoryWithDescendants } from "./category-form.js";
import { productMedia, productMediaStyles } from "./product-media.js";
import { swatchChip, swatchPartStyles } from "./swatch-styles.js";
import {
  blockClickAfterDrag,
  TreePointerDrag,
  clearDragMarks,
  dragGhost,
  lastShownRow,
  markDragging,
  markGap,
  markInto,
  placeDragGhost,
  shownRow,
  treeDragStyles,
  type DragGhost,
  type DropGap,
} from "./tree-drag.js";
import {
  modifierListName,
  modifierListNames,
  type ModifierListChoice,
} from "./product-editor-model.js";
import { type Product } from "../api/client.js";
import { type Course } from "../api/kitchen-api.js";
import { type CategorySummary } from "../api/catalog-api.js";
import { EACH_UNIT_ID } from "@waitron/menu/src/unit-validation.js";
import {
  keepAvailabilityFocus,
  productAvailabilitySwitch,
  type ProductAvailabilityChange,
} from "./product-tree-availability.js";
import {
  productDetailText,
  productRowLabels,
  productRowStyles,
  unavailableLabel,
} from "./product-list-row-parts.js";
import {
  PRODUCTS_PHONE_WIDTH,
  productCategoryColumn,
  productListCategoryStyles,
} from "./product-list-category.js";

import { fullRowProductsMediaStyles, productListLayoutStyles } from "./product-list-layout.js";

export type ProductsView = "list" | "tree";

export const ROOT_KEY = "root";

const DRAFT_KEY = "draft:new";
/** The Course filter's value for a row with no course. Never `""`: a multiple choice's `""` row is
 * its "any" row, and choosing it clears the choice. Course ids are UUIDs, so this is never one. */
const NO_COURSE = "no-course";
const PHONE_SELECTION_HIDDEN_COLUMNS = ["price", "available"] as const;
const PRODUCTS_COMPACT_WIDTH = 800;

export type CategoryNameDraft =
  { kind: "create"; parentId: string | null } | { kind: "rename"; categoryId: string };

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null };
type CategoryRow = { kind: "folder"; key: string; parentKey: string; folder: CategorySummary };
type DraftRow = { kind: "draft"; key: typeof DRAFT_KEY; parentKey: string };
type ListRow = ProductRow | CategoryRow | RootRow | DraftRow;
type CategoryCounts = { categories: number; products: number; unavailable: number };

interface ProductRow {
  kind: "product";
  key: string;
  parentKey: string | null;
  product: Product;
  variant: Product["variants"][number] | null;
}

function availabilityFilter({ product, variant }: ProductRow): string | string[] {
  if (!product.available) return "no";
  if (variant !== null) return variant.available ? "yes" : "no";
  return product.variants.some(({ active, available }) => active && !available)
    ? ["yes", "no"]
    : "yes";
}

function orderingName(ordering: ProductOrdering): string {
  return t(`product.ordering_${ordering}`);
}

/** The till sells a variant only while it AND its product are Active, so that is its status. */
function rowActive({ product, variant }: ProductRow): boolean {
  return product.active && (variant?.active ?? true);
}

const OVERRIDE_DIETS = ["vegan", "vegetarian", "halal", "kosher"] as const;

function hasDietaryInfo(product: Product): boolean {
  return (
    product.dietaryDeclarations.length > 0 ||
    OVERRIDE_DIETS.some((diet) => product.dietOverride?.[diet] !== undefined)
  );
}

function dietaryInfoText(product: Product): string {
  const declared = product.dietaryDeclarations.map((label) => t(`editor.diet.${label}`));
  const overridden = OVERRIDE_DIETS.flatMap((diet) => {
    const answer = product.dietOverride?.[diet];
    return answer === undefined ? [] : [`${t(`diet.${diet}`)}: ${t(`diet.${answer}`)}`];
  });
  return [...declared, ...overridden].join(", ");
}

export function acceptsMenuDrop(
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

interface ShownColor {
  color: string | null;
  inheritedFrom: string | undefined;
}

@customElement("dashboard-product-list")
export class ProductList extends LitElement {
  static override styles = [
    baseStyles,
    treeDragStyles,
    swatchPartStyles,
    productListLayoutStyles,
    productMediaStyles,
    productRowStyles,
    productListCategoryStyles,
    fullRowProductsMediaStyles,
  ];

  @property({ attribute: false }) view: ProductsView = "tree";
  @state() private phone = false;
  @property({ type: Boolean }) selecting = false;
  /** Whether rows carry grips and can be dragged. On by default, so a mount that wants a tree
   * without them passes `.reordering=${false}`. */
  @property({ type: Boolean, reflect: true }) reordering = true;
  @property({ attribute: false }) selected: string[] = [];
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) availabilityPending: ReadonlyMap<string, boolean> = new Map();
  @property({ attribute: false }) courses: Course[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) defaultColor: string | null = null;
  /** Whether the venue's region charges a separate class taken away. */
  @property({ attribute: false }) takeawayVat = false;
  @property({ attribute: false }) unroutedFolderIds: string[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property() search = "";
  /** Whether a product can be made yet: the editor needs a content language and a unit. */
  @property({ type: Boolean }) canAddProduct = false;
  @property({ attribute: false }) nameDraft: CategoryNameDraft | null = null;
  /** The server's refusal of the name the box last sent, shown under the box. */
  @property() nameError = "";
  /** The colour the box's square shows, which the box's name is saved with. */
  @property({ attribute: false }) nameColor: string | null = null;
  /** Whether the box's colour chooser is open: it takes the cursor without the person leaving the
   * box. */
  @property({ type: Boolean }) choosingColor = false;

  #listNames: ReadonlyMap<string, string> = new Map();
  #nameValue = "";
  /** Set once the box has sent its name or its cancel, until a refusal or a new box. */
  #nameSent = false;
  /** Rebuilt in willUpdate only when a property #rows() reads changes, and a new read there joins
   * that list; kept otherwise so wt-data-table keeps the search text it prepared for each row. */
  #rowList: ListRow[] = [];
  #rowByKey = new Map<string, ListRow>();
  #counts = new Map<string | null, CategoryCounts>();
  #branchCounts = new WeakMap<readonly ListRow[], ReadonlyMap<string, number>>();
  #categoryRanks?: {
    categories: readonly CategorySummary[];
    locale: string;
    ranks: Map<string, number>;
  };

  #categoryGroups(): (row: ListRow) => number {
    const locale = currentLocale();
    if (
      this.#categoryRanks?.categories !== this.categories ||
      this.#categoryRanks.locale !== locale
    ) {
      const compare = createLabelComparator(locale);
      const sorted = [...this.categories].sort((left, right) => compare(left.name, right.name));
      this.#categoryRanks = {
        categories: this.categories,
        locale,
        ranks: new Map(sorted.map(({ id }, index) => [id, index])),
      };
    }
    const { ranks } = this.#categoryRanks;
    return (row) => {
      if (row.kind === "folder") return ranks.get(row.folder.id)!;
      if (row.kind === "draft") return ranks.size;
      return ranks.size + 1;
    };
  }

  #categoryById: ReadonlyMap<string, CategorySummary> = new Map();
  #dragged: string[] = [];
  get #pointerDrag() {
    return this.#drag.state;
  }
  get #pointer() {
    return this.#drag.point;
  }
  get #target() {
    return this.#drag.target;
  }
  readonly #drag = new TreePointerDrag<string[], string>({
    activate: (key) => {
      if (!this.#rowByKey.has(key)) return undefined;
      const visible = new Set(
        [...this.#table()!.shadowRoot!.querySelectorAll<HTMLElement>("tr[data-row-key]")].map(
          (row) => row.dataset.rowKey!,
        ),
      );
      this.#dragged = this.selected.includes(key)
        ? this.selected.filter((key) => visible.has(key))
        : [key];
      return this.#dragged;
    },
    targetFor: (_data, over) => this.#dropTargetFor(over),
    sameTarget: (a, b) => a === b,
    moved: ({ changed, target, starting }) => {
      if (starting) {
        this.ghost = this.#ghostOf(this.#dragged);
        this.#send("drag-items", { keys: this.#dragged });
        void this.updateComplete.then(() => placeDragGhost(this.renderRoot, this.#pointer));
      }
      if (this.#edgeOrigin === null) {
        const origin = shownRow(this.#table()!.shadowRoot!, this.#pointerDrag!.key);
        if (origin) {
          this.#edgeScroll.start(origin, this.#pointer, () => this.#drag.repaint());
          this.#edgeOrigin = origin;
        }
      }
      this.#edgeScroll.update(this.#pointer);
      placeDragGhost(this.renderRoot, this.#pointer);
      if (changed || target !== undefined) this.#paint();
    },
    ended: () => {
      this.#edgeScroll.stop();
      this.#edgeOrigin = null;
      this.#dragged = [];
      this.ghost = null;
      this.#paint();
      this.#send("drag-items", { keys: [] });
    },
    drop: (keys, target) =>
      this.#send("drop-items", {
        keys,
        folderId: target === ROOT_KEY ? null : target.slice(7),
      }),
  });
  @state() private ghost: DragGhost | null = null;

  readonly #tableResize = new ResizeObserver(() => this.#scheduleFit());
  readonly #tableNarrow = new MutationObserver(() => this.#scheduleFit());
  #fitFrame = 0;

  override disconnectedCallback(): void {
    if (this.#pointerDrag) this.#finishDrag();
    this.#tableResize.disconnect();
    this.#tableNarrow.disconnect();
    cancelAnimationFrame(this.#fitFrame);
    this.#fitFrame = 0;
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#watchTable();
  }

  protected override firstUpdated(): void {
    this.#watchTable();
    keepAvailabilityFocus(this.#table()!);
    this.#table()!.addController({
      hostUpdated: () => {
        this.#scheduleFit();
        // The table keeps a surviving row's cells, marks included, when its rows change mid-drag,
        // so after each of its updates the drop is judged again on the rows the list now holds and
        // the marks redrawn.
        if (!this.#pointerDrag?.active) return;
        this.#drag.revalidate();
        this.#paint();
      },
    });
  }

  /** Touch starts a drag at the grip so a gesture on the rest of the row can scroll. */
  readonly #pointerDown = (event: PointerEvent): void => {
    if (this.view === "list") return;
    if (!this.reordering) return;
    const path = event
      .composedPath()
      .filter((item): item is HTMLElement => item instanceof HTMLElement);
    const row = path.find((item) => item.matches("tr[data-row-key]"));
    const listed = row ? this.#rowByKey.get(row.dataset.rowKey!) : undefined;
    if (!row || !listed || listed.kind === "root" || listed.kind === "draft") return;
    if (listed.kind === "product" && listed.variant !== null) return;
    if (listed.kind === "product" && path.some((item) => item.dataset.rowActivate === "false"))
      return;
    if (
      path.some((item) =>
        item.matches("input, a, wt-row-actions, wt-input, button:not(.row-activate, .drag-grip)"),
      )
    )
      return;
    const grip = path.some((item) => item.classList.contains("drag-grip"));
    if (!grip && path.some((item) => item.hasAttribute("data-selection-cell"))) return;
    this.#startDrag(event, listed.key, grip);
  };

  readonly #clickAvailableCell = (event: MouseEvent): void => {
    const cell = event.composedPath()[0];
    if (!(cell instanceof HTMLTableCellElement) || cell.dataset.rowActivate !== "false") return;
    const row = cell.closest("tr");
    if (row?.dataset.rowKey?.startsWith("folder:"))
      row.querySelector<HTMLButtonElement>("button.row-activate")?.click();
  };

  #startDrag(event: PointerEvent, key: string, grip: boolean): void {
    if (event.pointerType === "touch" && !grip) return;
    this.#drag.start(event, key);
  }

  readonly #edgeScroll = new DragEdgeScroll();
  #edgeOrigin: Element | null = null;

  #finishDrag(): void {
    this.#drag.finish();
  }

  /** Over a category or All products a drop files into it; over a product or variant, into the
   * category that product is in. A drop that would move nothing is not offered, nor one over the
   * row the drag started on, even when other selected rows sit in other categories. Nothing is
   * offered once a refresh has removed any dragged row. */
  #dropTargetFor(key: string): string | undefined {
    if (key === this.#pointerDrag?.key) return undefined;
    if (!this.#dragged.every((dragged) => this.#rowByKey.has(dragged))) return undefined;
    const row = this.#rowByKey.get(key);
    if (!row || row.kind === "draft") return undefined;
    const target =
      row.kind !== "product"
        ? row.key
        : row.variant === null
          ? row.parentKey
          : (this.#rowByKey.get(row.product.id)?.parentKey ?? ROOT_KEY);
    if (
      target === null ||
      !acceptsMenuDrop(this.#dragged, target === ROOT_KEY ? null : target.slice(7), this.categories)
    )
      return undefined;
    return this.#dragged.some((dragged) => this.#rowByKey.get(dragged)?.parentKey !== target)
      ? target
      : undefined;
  }

  /** The table re-renders rows in place as a branch opens, so the marks are set again by key. */
  #paint(): void {
    const root = this.#table()?.shadowRoot;
    if (!root) return;
    clearDragMarks(root);
    if (!this.#pointerDrag?.active) return;
    for (const key of this.#dragged) markDragging(shownRow(root, key));
    if (this.#target === undefined) return;
    markInto(shownRow(root, this.#target, this.#pointer));
    const gap = this.#gap(this.#target);
    if (gap) markGap(root, gap);
  }

  /** Where the first dragged row would land among the target's children, in the table's sort order:
   * products and categories have no order of their own. */
  #gap(target: string): DropGap | undefined {
    const table = this.#table()!;
    const root = table.shadowRoot!;
    const moving = this.#rowByKey.get(this.#dragged[0]!);
    if (!moving || !table.isExpanded(target)) return undefined;
    const shown = (key: string) =>
      root.querySelector(`tr[data-row-key="${CSS.escape(key)}"]`) !== null;
    const siblings = [...this.#rowByKey.values()].filter(
      (row) => row.parentKey === target && !this.#dragged.includes(row.key) && shown(row.key),
    );
    const order = table.sortedSiblings([...siblings, moving]);
    const next = order[order.indexOf(moving) + 1];
    if (next) return { key: next.key, side: "before" };
    // With nothing drawn under the target, a gap after it would sit on the row the drop goes into.
    const last = lastShownRow(root, target, this.#pointer);
    return !last || last.dataset.rowKey === target
      ? undefined
      : { key: last.dataset.rowKey!, side: "after", row: last };
  }

  #ghostOf(keys: readonly string[]): DragGhost {
    const first = this.#rowByKey.get(keys[0]!);
    const name =
      first?.kind === "folder"
        ? first.folder.name
        : first?.kind === "product"
          ? first.product.name
          : "";
    return {
      label:
        keys.length > 1 ? t("folders.drag_count").replace("{count}", String(keys.length)) : name,
      image: first?.kind === "product" ? first.product.image : null,
      folder: first?.kind === "folder",
    };
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("reordering") && !this.reordering && this.#pointerDrag) {
      const active = this.#pointerDrag.active;
      this.#finishDrag();
      if (active) blockClickAfterDrag(true);
    }
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
    if (changed.has("categories") || changed.has("products")) this.#counts = this.#count();
    if (["view", "categories", "products", "nameDraft"].some((key) => changed.has(key))) {
      this.#rowList = this.#rows();
      this.#rowByKey = new Map(this.#rowList.map((row) => [row.key, row]));
    }
    // The Course filter offers the courses, and has none while there are none.
    if (["view", "phone", "categories", "defaultColor", "courses"].some((key) => changed.has(key)))
      this.#columnLocale = "";
    if (changed.has("courses")) {
      this.#courseOrder = new Map(this.courses.map((course, index) => [course.id, index]));
    }
    if (changed.has("categories")) {
      this.#categoryById = new Map(this.categories.map((category) => [category.id, category]));
    }
    if (changed.has("nameDraft")) {
      const draft = this.nameDraft;
      this.#nameSent = false;
      this.#nameValue =
        draft?.kind === "rename"
          ? (this.categories.find(({ id }) => id === draft.categoryId)?.name ?? "")
          : "";
    }
    if (changed.has("nameError") && this.nameError !== "") this.#nameSent = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("nameDraft") && this.nameDraft) void this.#revealNameBox(true);
    else if (changed.has("nameError") && this.nameError) void this.#revealNameBox(false);
  }

  async #revealNameBox(focus: boolean): Promise<void> {
    const draft = this.nameDraft;
    const table = this.#table();
    if (!draft || !table) return;
    const nameBox = () =>
      table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        'wt-input[name="category-name"]',
      );
    await table.updateComplete;
    if (!focus) await nameBox()?.updateComplete;
    if (this.nameDraft !== draft) return;
    await table.revealRow(draft.kind === "create" ? DRAFT_KEY : `folder:${draft.categoryId}`);
    const box = nameBox();
    if (!box) return;
    await box.updateComplete;
    if (this.nameDraft !== draft) return;
    // Fit before focusing so the input does not scroll the table sideways.
    this.#fitNameBox();
    if (focus) {
      box.focus();
      box.select();
    }
  }

  #commitName(): void {
    if (this.#nameSent) return;
    const name = this.#nameValue.trim();
    if (name === "") {
      this.#cancelName();
      return;
    }
    this.#nameSent = true;
    this.#send("name-commit", { name });
  }

  #cancelName(): void {
    if (this.#nameSent) return;
    this.#nameSent = true;
    this.#send("name-cancel", {});
  }

  /** The open name box's colour square, in the row's leading slot. A press keeps the cursor in the
   * input; it is no Tab stop, so Tab still leaves the box. */
  #nameFrame(parentId: string | null) {
    const inherited = this.#inheritedColor(parentId);
    const color = this.nameColor ?? inherited.color;
    const from =
      this.nameColor === null && isStoredColor(color) ? inherited.inheritedFrom : undefined;
    return html`<span part="folder-frame naming-frame"
      ><button
        part="swatch-button"
        type="button"
        tabindex="-1"
        data-test="name-box-color"
        aria-label=${
          from === undefined
            ? t("folders.choose_color")
            : fill("folders.choose_color_inherited", { from })
        }
        @mousedown=${(event: Event) => event.preventDefault()}
        @click=${(event: Event) => {
          event.stopPropagation();
          if (this.#nameSent) return;
          this.#send("name-color", {});
        }}
      >
        ${swatchChip(color, this.nameColor === null)}
      </button></span
    >`;
  }

  #nameBox() {
    const draft = this.nameDraft;
    return html`<wt-input
      part="name-box"
      name="category-name"
      label=${t("folders.name")}
      hide-label
      .value=${this.#nameValue}
      .error=${this.nameError}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#nameValue = event.detail.value;
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (belongsToComposition(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          this.#commitName();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.#cancelName();
        }
      }}
      @focusout=${() => {
        // A box removed while it holds the cursor also loses it, after the next box's draft is set.
        if (this.nameDraft !== draft || this.#nameSent || this.choosingColor) return;
        if (this.#nameValue.trim() === "") this.#cancelName();
        else this.#commitName();
      }}
    ></wt-input>`;
  }

  #watchTable(): void {
    const table = this.#table()!;
    this.#tableResize.observe(table);
    this.#tableNarrow.observe(table, { attributes: true, attributeFilter: ["narrow"] });
  }

  /** Re-measured a frame after the table resizes, updates or its `narrow` changes, never inside the
   * resize observer's callback, which the names' new heights would re-trigger. */
  #scheduleFit(): void {
    if (this.#fitFrame) return;
    this.#fitFrame = requestAnimationFrame(() => {
      this.#fitFrame = 0;
      const table = this.#table()!;
      const width = table.clientWidth;
      if (width > 0) {
        this.phone = width <= PRODUCTS_PHONE_WIDTH;
        const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll");
        table.toggleAttribute(
          "data-compact-products",
          (scroll?.clientWidth ?? width) < PRODUCTS_COMPACT_WIDTH,
        );
      }
      this.#fitNameBox();
    });
  }

  #fitNameBox(): void {
    const root = this.#table()!.shadowRoot!;
    const scroll = root.querySelector<HTMLElement>(".scroll");
    const box = root.querySelector<HTMLElement>('wt-input[name="category-name"]');
    if (!scroll || !box) return;
    const naming = box.parentElement!;
    const cell = box.closest("td")!;
    const pinned = cell.closest("tr")!.querySelector('td[data-pinned="end"]')!;
    const tableEnd = pinned.getBoundingClientRect().left - scroll.scrollLeft;
    const padding = parseFloat(getComputedStyle(cell).paddingInlineEnd);
    const cellEnd = Math.min(cell.getBoundingClientRect().right, tableEnd) - padding;
    const room = Math.max(0, cellEnd - naming.getBoundingClientRect().left);
    // Category rows have no price or switch, so a narrow field can use that room while editing.
    const fieldEnd = root.host.hasAttribute("narrow") ? tableEnd - padding : cellEnd;
    const boxRoom = Math.max(0, fieldEnd - box.getBoundingClientRect().left);
    naming.style.setProperty("--name-room", `${room}px`);
    naming.style.setProperty("--name-box-room", `${boxRoom}px`);
    const hidden = scroll.getBoundingClientRect().left - box.getBoundingClientRect().left;
    if (hidden > 0) scroll.scrollLeft -= hidden;
  }

  #renaming(id: string): boolean {
    return this.nameDraft?.kind === "rename" && this.nameDraft.categoryId === id;
  }

  #rows(): ListRow[] {
    const known = new Set(this.categories.map(({ id }) => id));
    const keyOf = (id: string | null): string =>
      id !== null && known.has(id) ? `folder:${id}` : ROOT_KEY;
    return [
      ...(this.view === "list"
        ? []
        : [
            { kind: "root", key: ROOT_KEY, parentKey: null } satisfies RootRow,
            ...this.categories.map((folder): CategoryRow => ({
              kind: "folder",
              key: `folder:${folder.id}`,
              parentKey: keyOf(folder.parentId),
              folder,
            })),
            ...(this.nameDraft?.kind === "create"
              ? [
                  {
                    kind: "draft",
                    key: DRAFT_KEY,
                    parentKey: keyOf(this.nameDraft.parentId),
                  } satisfies DraftRow,
                ]
              : []),
          ]),
      ...this.products.flatMap((product): ProductRow[] =>
        [
          {
            kind: "product" as const,
            key: product.id,
            parentKey: this.view === "tree" ? keyOf(product.primaryCategoryId) : null,
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
        ].filter(rowActive),
      ),
    ];
  }

  /** What each category holds directly, and under `null` the whole menu, counted once per change
   * of the lists rather than once per row drawn. */
  #count() {
    const root = { categories: this.categories.length, products: 0, unavailable: 0 };
    const counts = new Map<string | null, CategoryCounts>([[null, root]]);
    const entry = (id: string) =>
      counts.get(id) ?? counts.set(id, { categories: 0, products: 0, unavailable: 0 }).get(id)!;
    for (const category of this.categories)
      if (category.parentId !== null) entry(category.parentId).categories++;
    for (const product of this.products) {
      if (!product.active) continue;
      root.products++;
      if (product.primaryCategoryId === null) continue;
      const category = entry(product.primaryCategoryId);
      category.products++;
      if (
        !product.available ||
        product.variants.some(({ active, available }) => active && !available)
      )
        category.unavailable++;
    }
    return counts;
  }

  #productsByBranch(rows: readonly ListRow[]): ReadonlyMap<string, number> {
    const cached = this.#branchCounts.get(rows);
    if (cached) return cached;
    const counts = new Map<string, number>();
    const products = new Set<string>();
    for (const row of rows) {
      if (row.kind !== "product" || products.has(row.product.id)) continue;
      products.add(row.product.id);
      const visited = new Set<string>();
      let branch = this.#rowByKey.get(row.product.id)?.parentKey;
      while (branch && !visited.has(branch)) {
        visited.add(branch);
        counts.set(branch, (counts.get(branch) ?? 0) + 1);
        branch = this.#rowByKey.get(branch)?.parentKey ?? undefined;
      }
    }
    this.#branchCounts.set(rows, counts);
    return counts;
  }

  readonly #filterCandidates = (rows: readonly ListRow[], hasFilters: boolean) => {
    if (!hasFilters) return rows;
    const counts = this.#productsByBranch(rows);
    return rows.filter(
      (row) => row.kind !== "folder" || counts.has(row.key) || this.#renaming(row.folder.id),
    );
  };

  #contents(categoryId: string | null, filterMatches?: readonly ListRow[]): string {
    if (filterMatches !== undefined) {
      const key = categoryId === null ? ROOT_KEY : `folder:${categoryId}`;
      const total = this.#productsByBranch(this.#rowList).get(key) ?? 0;
      const matching = this.#productsByBranch(filterMatches).get(key) ?? 0;
      return fill(total === 1 ? "folders.matching_products_one" : "folders.matching_products", {
        matching: String(matching),
        total: String(total),
      });
    }
    const { categories = 0, products = 0, unavailable = 0 } = this.#counts.get(categoryId) ?? {};
    const parts = categories > 0 ? [countOf("folders.count", categories)] : [];
    if (products > 0 || categories === 0) parts.push(countOf("folders.product_count", products));
    const totals = parts.join(", ");
    return categoryId !== null && unavailable && !this.#table()?.isExpanded(`folder:${categoryId}`)
      ? `${totals} · ${countOf("product.unavailable_count", unavailable)}`
      : totals;
  }

  #modifierNames(product: Product): string {
    return product.modifiers.map((ref) => modifierListName(ref, this.#listNames)).join(", ");
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

  #unitWord(product: Product): string {
    if (product.unitId === EACH_UNIT_ID) return "";
    const name = unitPresentation(
      product.unit,
      currentLocale(),
      currentContentLanguages(),
    ).abbreviation;
    return fill("product.price_per", { unit: name });
  }

  #categoryPath(row: ListRow): string {
    const id =
      row.kind === "folder"
        ? row.folder.parentId
        : row.kind === "product"
          ? row.product.primaryCategoryId
          : null;
    const parent = id === null ? undefined : this.#categoryById.get(id);
    if (!parent) return "";
    const categories =
      row.kind === "folder"
        ? this.categories.filter((category) => category.id !== row.folder.id)
        : this.categories;
    return categoryPath(parent, categories);
  }

  #searchPath(row: ListRow) {
    const path = this.#categoryPath(row);
    return path === "" ? nothing : html`<span part="search-path">${path}</span>`;
  }

  #productColumns(
    inlineCategory?: ReturnType<typeof productCategoryColumn>,
  ): DataTableColumn<ProductRow>[] {
    return [
      {
        key: "name",
        label: t("product.name"),
        filter: {
          label: t("editor.variants"),
          allLabel: t("product.filter_any"),
          value: ({ product }) => (product.variants.some(({ active }) => active) ? "has" : "none"),
          options: [
            { value: "has", label: t("product.has_variants") },
            { value: "none", label: t("product.no_variants") },
          ],
        },
        sortValue: (row) => row.variant?.name ?? row.product.name,
        searchValue: ({ product }) =>
          [product.name, ...product.variants.map(({ name }) => name)].join(" "),
        cell: (row, context) => {
          const { ancestorOnly, searchRoot } = context;
          const { product, variant } = row;
          const category = variant ? undefined : inlineCategory?.categoryName(row);
          const { color, inheritedFrom } =
            product.color === null
              ? this.#inheritedColor(product.primaryCategoryId)
              : { color: product.color, inheritedFrom: undefined };
          return variant
            ? html`<span part="variant-cell"
                ><span part="products-media-slot"
                  >${productMedia({
                    key: variant.id,
                    name: variant.name,
                    image: variant.image ?? product.image,
                    color,
                    inheritedFrom,
                    busy: false,
                    lazy: true,
                    open: () =>
                      this.#send("edit-product", { productId: variant.id, field: "image" }),
                  })}</span
                ><span part="variant-name"
                  ><span>${variant.name}${unavailableLabel(variant.available)}</span></span
                ></span
              >`
            : html`<span part=${ancestorOnly ? "product-cell context" : "product-cell"}>
                <span part="products-media-slot"
                  >${productMedia({
                    key: product.id,
                    name: product.name,
                    image: product.image,
                    color,
                    inheritedFrom,
                    busy: false,
                    lazy: true,
                    open: () =>
                      this.#send("edit-product", { productId: product.id, field: "image" }),
                  })}</span
                ><span part="name-stack"
                  >${
                    searchRoot && this.view === "tree"
                      ? html`<span part="search-name-line"
                          ><span
                            ><strong>${product.name}</strong
                            >${unavailableLabel(product.available)}</span
                          >${this.#searchPath(row)}</span
                        >`
                      : html`<span
                          ><strong>${product.name}</strong
                          >${unavailableLabel(product.available)}</span
                        >`
                  }${
                    category && !this.#table()?.isColumnShown("category")
                      ? html`<span part="phone-category category-path-name">${category}</span>`
                      : nothing
                  }${productRowLabels(product)}</span
                >
              </span>`;
        },
      },
      {
        key: "course",
        choosable: "hidden",
        label: t("product.course"),
        // A variant row names only a course of its own; one that follows its product's is blank.
        cell: ({ product, variant }) => {
          const courseId = variant ? variant.courseId : product.courseId;
          if (courseId === null) return nothing;
          return productDetailText(this.#courseName(courseId));
        },
        sortValue: ({ product }) => this.#courseRank(product.courseId),
        ...(this.courses.length
          ? {
              filter: {
                preserveOrder: true, // Configured course order, then No course.
                label: t("product.course"),
                allLabel: t("product.filter_course_all"),
                multiple: {
                  countLabel: (count: number) =>
                    t("product.filter_course_count").replace("{count}", String(count)),
                },
                value: ({ product, variant }: ProductRow) =>
                  (variant ? variant.effective.courseId : product.courseId) ?? NO_COURSE,
                options: [
                  ...this.courses.map((course) => ({ value: course.id, label: course.name })),
                  { value: NO_COURSE, label: t("product.filter_no_course") },
                ],
              },
            }
          : {}),
      },
      {
        key: "price",
        choosable: "shown",
        label: t("product.price"),
        align: "end",
        // The list has no VAT column; a variant whose takeaway rate differs from its product's notes
        // it under its price, since nothing else on the row would show it.
        cell: (row) => {
          const takeaway = this.takeawayVat ? row.variant?.effective.takeawayVatRate : undefined;
          const unit = this.#unitWord(row.product);
          return html`<span part="price-layout">
            <span
              part=${row.variant?.unitPrice === null ? "price-amount inherited-price" : "price-amount"}
              data-test="price"
              >${this.#price(row)}</span
            >
            ${unit ? html`<span part="price-unit" data-test="price-unit">${unit}</span>` : nothing}
            ${
              takeaway === undefined || takeaway === row.product.takeawayVatRate
                ? nothing
                : html`<span part="vat-note" data-test="takeaway-vat-note"
                    >${t("editor.takeaway_vat")}: ${vatRateText(takeaway)}</span
                  >`
            }
          </span>`;
        },
        sortValue: (row) => this.#prices(row).low,
      },
      {
        key: "modifiers",
        choosable: "hidden",
        label: t("editor.modifiers"),
        cell: ({ product, variant }) =>
          variant ? nothing : productDetailText(this.#modifierNames(product)),
        filter: {
          label: t("editor.modifiers"),
          allLabel: t("product.filter_any"),
          value: ({ product }) => (product.modifiers.length ? "has" : "none"),
          options: [
            { value: "has", label: t("product.has_modifiers") },
            { value: "none", label: t("product.no_modifiers") },
          ],
        },
      },
      {
        key: "ordering",
        choosable: "hidden",
        label: t("product.ordering"),
        // A variant is a way of buying its product, so the filter reads the PRODUCT's answer on
        // every row and a variant is shown or hidden together with its product.
        cell: ({ product, variant }) => {
          if (variant || product.ordering === "public") return nothing;
          return html`<span
            part="badge product-detail"
            data-test="ordering-badge"
            data-ordering=${product.ordering}
            >${orderingName(product.ordering)}</span
          >`;
        },
        sortValue: ({ product }) => PRODUCT_ORDERINGS.indexOf(product.ordering),
        filter: {
          label: t("editor.ordered_on_own"),
          allLabel: t("product.filter_ordering_all"),
          multiple: {
            countLabel: (count) =>
              t("product.filter_ordering_count").replace("{count}", String(count)),
          },
          value: ({ product }) => product.ordering,
          options: PRODUCT_ORDERINGS.map((ordering) => ({
            value: ordering,
            label: orderingName(ordering),
          })),
        },
      },
      {
        key: "available",
        choosable: "shown",
        activatesRow: false,
        label: t("editor.available"),
        hideHeadingLabel: this.phone,
        help: {
          text: t("help.products.availability"),
          label: fill("help.badge_label", { part: t("editor.available") }),
        },
        cell: ({ product, variant }) =>
          productAvailabilitySwitch(
            variant ? { ...variant, name: `${product.name}, ${variant.name}` } : product,
            this.availabilityPending,
            (change: ProductAvailabilityChange) => this.#send("change-availability", change),
          ),
        sortValue: (row) => ((row.variant ?? row.product).available ? 0 : 1),
        filter: {
          label: t("editor.available"),
          allLabel: t("product.filter_any"),
          preserveOrder: true,
          value: availabilityFilter,
          options: [
            { value: "yes", label: t("product.available_yes") },
            { value: "no", label: t("product.available_no") },
          ],
        },
      },
      {
        key: "allergens",
        choosable: "hidden",
        label: t("product.allergens"),
        cell: ({ product, variant }) => {
          const state = allergenState(variant ? variant.effective.allergens : product.allergens);
          return html`<span
            part=${
              variant?.allergensInherited
                ? "badge product-detail inherited-allergens"
                : "badge product-detail"
            }
            data-test="allergen-state"
            data-state=${state}
            >${allergenStateName(state)}</span
          >`;
        },
        sortValue: ({ product, variant }) =>
          allergenStateName(
            allergenState(variant ? variant.effective.allergens : product.allergens),
          ),
        filter: {
          label: t("product.allergens"),
          allLabel: t("product.filter_any"),
          value: ({ product, variant }) =>
            allergenState(variant ? variant.effective.allergens : product.allergens),
          options: (["pending", "none", "declared"] as const).map((state) => ({
            value: state,
            label: allergenStateName(state),
          })),
        },
      },
      {
        key: "dietary",
        choosable: "hidden",
        label: t("product.dietary_info"),
        cell: ({ product, variant }) =>
          variant ? nothing : productDetailText(dietaryInfoText(product)),
        filter: {
          label: t("product.dietary_info"),
          allLabel: t("product.filter_any"),
          value: ({ product }) => (hasDietaryInfo(product) ? "has" : "none"),
          options: [
            { value: "has", label: t("product.dietary_has") },
            { value: "none", label: t("product.dietary_none") },
          ],
        },
      },
      {
        key: "actions",
        label: t("staff.actions"),
        align: "end",
        pinned: "end",
        cell: (row) => {
          const { id, name } = row.variant ?? row.product;
          return html`<wt-row-actions
            align="end"
            data-test=${`actions-${id}`}
            label=${`${t("staff.actions")}: ${name}`}
          >
            <wt-button
              icon="menu-edit"
              data-test=${`edit-${id}`}
              @click=${() => this.#send("edit-product", { productId: id })}
              >${t("action.edit")}</wt-button
            >${rowActionTail(true, [
              html`<wt-button
                icon="menu-delete"
                variant="danger"
                data-test=${`delete-${id}`}
                @click=${() => this.#send("delete-product", { productId: id })}
                >${t("action.delete")}</wt-button
              >`,
            ])}
          </wt-row-actions>`;
        },
      },
    ];
  }

  #addItems(categoryId: string | null) {
    const test = categoryId ?? ROOT_KEY;
    return html`<wt-button
        icon="menu-add"
        data-test=${`add-product-${test}`}
        ?disabled=${!this.canAddProduct}
        @click=${() => {
          if (this.canAddProduct) this.#send("add-product", { categoryId });
        }}
        >${t("products.add_product")}</wt-button
      ><wt-button
        icon="menu-add"
        data-test=${`add-category-${test}`}
        @click=${() => this.#send("add-category", { parentId: categoryId })}
        >${t("folders.add_category")}</wt-button
      >`;
  }

  #grip(name: string) {
    return this.reordering
      ? html`<button
          class="drag-grip"
          part="drag-grip"
          type="button"
          aria-label=${`${t("folders.drag")}: ${name}`}
        >
          <wt-icon name="grip"></wt-icon>
        </button>`
      : nothing;
  }

  #rowControls(row: ListRow) {
    if (row.kind === "folder") return this.#grip(row.folder.name);
    if (row.kind === "product" && row.variant === null) return this.#grip(row.product.name);
    return html`<span part="grip-space"></span>`;
  }

  #columnLocale = "";
  #courseOrder = new Map<string, number>();

  #courseName(courseId: string): string {
    const index = this.#courseOrder.get(courseId);
    return index === undefined ? t("editor.missing_choice") : this.courses[index]!.name;
  }

  // Null, not a number, so the table keeps a row with no course last in both directions.
  #courseRank(courseId: string | null): number | null {
    if (courseId === null) return null;
    return this.#courseOrder.get(courseId) ?? this.courses.length;
  }

  #columnList: DataTableColumn<ListRow>[] = [];

  #columns(): DataTableColumn<ListRow>[] {
    const locale = currentLocale();
    if (this.#columnLocale !== locale) {
      this.#columnLocale = locale;
      this.#columnList = this.#buildColumns();
    }
    return this.#columnList;
  }

  #buildColumns(): DataTableColumn<ListRow>[] {
    const category =
      this.view === "list"
        ? productCategoryColumn(this.categories, this.defaultColor, this.phone)
        : undefined;
    const columns = this.#productColumns(this.phone ? category : undefined);
    if (category) columns.splice(1, 0, category);
    return columns.map((column) => ({
      key: column.key,
      label: column.label,
      hideHeadingLabel: column.hideHeadingLabel,
      help: column.help,
      align: column.align,
      choosable: column.choosable,
      pinned: column.pinned,
      activatesRow: column.activatesRow,
      cell: (row, { filterMatches, ...context }) => {
        if (row.kind === "product") return column.cell(row, context);
        if (row.kind === "draft")
          return column.key === "name"
            ? html`<span part="folder-cell naming"
                >${this.#nameFrame(row.parentKey === ROOT_KEY ? null : row.parentKey.slice(7))}${this.#nameBox()}</span
              >`
            : nothing;
        if (row.kind === "root") {
          if (column.key === "name")
            return html`<span part="folder-cell"
              >${this.#swatchButton(
                ROOT_KEY,
                t("folders.all_products"),
                { color: this.defaultColor, inheritedFrom: undefined },
                "root-color",
                {},
              )}<span part="folder-name"
                ><span
                  ><strong>${t("folders.all_products")}</strong
                  ><span part="count" data-test="count-root"
                    >${this.#contents(null, filterMatches)}</span
                  ></span
                ></span
              ></span
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
        if (column.key === "name") {
          const after = html`<span part="count" data-test=${`count-${folder.id}`}
              >${this.#contents(folder.id, filterMatches)}</span
            >${
              this.unroutedFolderIds.includes(folder.id)
                ? html`<span
                    part="unrouted-folder"
                    data-test="unrouted-folder"
                    role="img"
                    aria-label=${t("folders.no_active_station")}
                    title=${t("folders.no_active_station")}
                    >*</span
                  >`
                : nothing
            }`;
          return html`<span part=${this.#renaming(folder.id) ? "folder-cell naming" : "folder-cell"}
            >${
              this.#renaming(folder.id)
                ? html`${this.#nameFrame(folder.parentId)}${this.#nameBox()}<span part="name-after"
                      >${after}</span
                    >`
                : html`${this.#swatchButton(
                      folder.id,
                      folder.name,
                      folder.color === null
                        ? this.#inheritedColor(folder.parentId)
                        : { color: folder.color, inheritedFrom: undefined },
                      "folder-color",
                      { folderId: folder.id },
                    )}<span part="folder-name"
                      ><span part=${context.searchRoot ? "search-name-line" : nothing}
                        ><span><strong>${folder.name}</strong>${after}</span
                        >${context.searchRoot ? this.#searchPath(row) : nothing}</span
                      ></span
                    >`
            }</span
          >`;
        }
        if (column.key === "actions")
          return html`<wt-row-actions
            align="end"
            label=${`${t("staff.actions")}: ${folder.name}`}
            data-test=${`actions-folder-${folder.id}`}
            >${this.#addItems(folder.id)}
            <wt-button
              icon="menu-rename"
              data-test=${`rename-${folder.id}`}
              @click=${() => this.#send("rename-folder", { folderId: folder.id })}
              >${t("folders.rename")}</wt-button
            ><wt-button
              icon="menu-move"
              data-test=${`move-${folder.id}`}
              @click=${() => this.#send("move-folder", { folderId: folder.id })}
              >${t("folders.move")}</wt-button
            >${rowActionTail(true, [
              html`<wt-button
                icon="menu-delete"
                variant="danger"
                data-test=${`delete-folder-${folder.id}`}
                @click=${() => this.#send("delete-folder", { folderId: folder.id })}
                >${t("action.delete_dialog")}</wt-button
              >`,
            ])}</wt-row-actions
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
                  : row.kind === "draft"
                    ? null
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
                : row.kind === "root" || row.kind === "draft"
                  ? ""
                  : column.key === "name"
                    ? row.folder.name
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

  #inheritedColor(categoryId: string | null): ShownColor {
    const source = categoryColorSource(categoryId, this.#categoryById, this.defaultColor);
    if (source.color === null) return { color: null, inheritedFrom: undefined };
    const from = source.categoryId === null ? undefined : this.#categoryById.get(source.categoryId);
    return { color: source.color, inheritedFrom: from?.name ?? t("folders.all_products") };
  }

  #swatchButton(
    key: string,
    name: string,
    { color, inheritedFrom }: ShownColor,
    event: string,
    detail: unknown,
  ) {
    const inherited = inheritedFrom !== undefined && isStoredColor(color);
    return html`<span part="folder-frame"
      ><button
        part="swatch-button"
        type="button"
        data-test=${`color-${key}`}
        aria-label=${
          inherited
            ? fill("folders.edit_color_inherited", { name, from: inheritedFrom })
            : fill("folders.edit_color", { name })
        }
        @click=${(clicked: Event) => {
          clicked.stopPropagation();
          this.#send(event, detail);
        }}
      >
        ${swatchChip(color, inherited)}
      </button></span
    >`;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  readonly #expandChange = (
    event: CustomEvent<{ key: string; expanded: boolean; filtering?: boolean }>,
  ): void => {
    event.stopPropagation();
    if (this.search.trim() !== "" || event.detail.filtering) return;
    const { key, expanded } = event.detail;
    if (key === ROOT_KEY) this.#send("category-toggle", { categoryId: null, open: expanded });
    else if (key.startsWith("folder:"))
      this.#send("category-toggle", { categoryId: key.slice(7), open: expanded });
  };

  async revealCategory(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    const key = `folder:${id}`;
    table.setExpanded(key, true);
    await table.revealRow(key);
    // The table applies its measured width on a frame before Products can fit the expanded rows.
    await new Promise<void>((ready) =>
      requestAnimationFrame(() => requestAnimationFrame(() => ready())),
    );
    this.#fitNameBox();
    const root = table.shadowRoot!;
    const name = root.querySelector(`tr[data-row-key="${CSS.escape(key)}"] strong`);
    const header = root.querySelector("thead");
    const scroll = root.querySelector<HTMLElement>(".scroll");
    if (!name || !header || !scroll) return;
    const { top, bottom } = name.getBoundingClientRect();
    // Keep the first line readable even when the wrapped title is taller than the space left.
    const above = top - header.getBoundingClientRect().bottom;
    const below = bottom - scroll.getBoundingClientRect().bottom;
    scroll.scrollTop += Math.min(above, Math.max(0, below));
  }

  /** Opens every category above a product and scrolls it into view. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    await table.revealRow(this.#productRow(id)?.key ?? id);
  }

  async hiddenSelectedCount(): Promise<number> {
    await this.updateComplete;
    const table = this.#table();
    if (!table || !this.selected.length) return 0;
    await table.updateComplete;
    const shown = new Set(table.shownKeys({ includeCollapsedSearchMatches: true }));
    return this.selected.filter((key) => !shown.has(key)).length;
  }

  async hiddenSavedProductName(id: string): Promise<string | undefined> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    const row = this.#productRow(id);
    if (
      row?.kind !== "product" ||
      table.shownKeys({ includeCollapsedSearchMatches: true }).includes(row.key)
    )
      return;
    return row.variant ? `${row.product.name}, ${row.variant.name}` : row.product.name;
  }

  #productRow(id: string): ListRow | undefined {
    return this.#rowList.find(
      (row) => row.kind === "product" && (row.variant ?? row.product).id === id,
    );
  }

  resetCategoryView(): void {
    const table = this.#table();
    if (table) void table.updateComplete.then(() => table.resetColumnView("category", "name"));
  }

  clearFilters(): void {
    this.#table()?.clearFilters();
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
    return html`<slot name="above-table"></slot
      ><wt-data-table
        noMatchesMessage=${tableNoMatches()}
        emptyMessage=${t("add_products.empty")}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        aria-label=${t("products.title")}
        viewKey="waitron.products.table"
        rememberExpanded
        flatTreeSearch
        keep-toolbar-when-empty
        dense-rows
        wrap-to-fit
        ?data-availability-saving=${this.availabilityPending.size > 0}
        ?data-list=${this.view === "list"}
        .filterCandidates=${this.#filterCandidates}
        .filterOpensBranch=${(row: ListRow) => row.kind === "root" || row.kind === "folder"}
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
        collapseLabel=${t("categories.collapse")}
        expandLabel=${t("categories.expand")}
        initiallyCollapsed
        collapseDescendants
        .rowInitiallyExpanded=${(row: ListRow) => row.kind === "root"}
        .searchTerm=${this.search}
        .rowControls=${this.view === "tree" && this.reordering ? (row: ListRow) => this.#rowControls(row) : undefined}
        rowControlsLabel=${t("folders.drag")}
        .selectable=${this.selecting}
        .rowSelectAll=${(row: ListRow, filtered: boolean) => !filtered || row.kind !== "folder"}
        .selected=${this.selected}
        .rowSelectable=${(row: ListRow) =>
          row.kind === "folder" || (row.kind === "product" && row.variant === null)}
        .selectionLabel=${(row: ListRow) =>
          row.kind === "folder"
            ? row.folder.name
            : row.kind === "product"
              ? (row.variant?.name ?? row.product.name)
              : ""}
        .rowGroup=${this.view === "tree" ? this.#categoryGroups() : undefined}
        .rowJoinsParent=${(row: ListRow) => row.kind === "product" && row.variant !== null}
        .rowKeepsChildOrder=${(row: ListRow) => row.kind === "product" && row.variant === null}
        .rowActivation=${(row: ListRow) =>
          row.kind === "folder" && !this.#renaming(row.folder.id)
            ? "toggle"
            : row.kind === "product"
              ? "click"
              : "none"}
        .rowToggleParts=${(row: ListRow) => (row.kind === "product" ? "variant-toggle" : "")}
        .rowToggleLabel=${(row: ListRow, expanded: boolean) =>
          row.kind === "folder" || row.kind === "root"
            ? fill(expanded ? "folders.close_named" : "folders.open_named", {
                name: row.kind === "root" ? t("folders.all_products") : row.folder.name,
              })
            : t(expanded ? "categories.collapse" : "categories.expand")}
        .rowClick=${(row: ListRow) => {
          if (row.kind === "product")
            this.#send("edit-product", { productId: (row.variant ?? row.product).id });
        }}
        .rowClickLabel=${(row: ListRow) =>
          row.kind === "product" ? `${t("action.edit")}: ${(row.variant ?? row.product).name}` : ""}
        .rows=${this.#rowList}
        .rowCellParts=${() => "products-cell"}
        .rowSpansUnpinnedColumns=${
          this.phone && this.view === "tree"
            ? (row: ListRow, columns: readonly DataTableColumn<ListRow>[]) =>
                row.kind !== "product" &&
                columns.every(({ key }) => key === "name" || key === "price" || key === "available")
            : undefined
        }
        .columns=${this.#columns()}
        .layoutHiddenColumns=${
          this.phone && this.selecting ? PHONE_SELECTION_HIDDEN_COLUMNS : undefined
        }
        .rowKey=${(row: ListRow) => row.key}
        .rowParent=${(row: ListRow) => row.parentKey}
        @pointerdown=${this.#pointerDown}
        @click=${this.#clickAvailableCell}
        @wt-expand-change=${this.#expandChange}
        ><slot name="empty-action" slot="empty-action"></slot
        ><slot name="no-matches-action" slot="no-matches-action"></slot
        ><slot name="toolbar-start" slot="toolbar-start"></slot
        ><slot name="toolbar-search" slot="toolbar-search"></slot
        ><slot name="toolbar-end" slot="toolbar-end"></slot
        ><slot name="toolbar-bottom" slot="toolbar-bottom"></slot></wt-data-table
      >${dragGhost(this.ghost)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-list": ProductList;
  }
}
