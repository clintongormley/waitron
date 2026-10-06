import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  baseStyles,
  visuallyHiddenStyles,
  type DataTableColumn,
  type WtDataTable,
} from "@waitron/ui";
import { formatMoney, resolveContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import { t, currentLocale } from "../i18n/t.js";
import {
  allergenState,
  allergenStateName,
  productStatusName,
  vatClassName,
} from "../i18n/domain.js";
import { categoryPathSearchText, categoryWithDescendants } from "./category-form.js";
import { priceSearchText } from "./form-fields.js";
import { swatchChip, swatchPartStyles } from "./swatch-styles.js";
import {
  holdPageCursor,
  pointerElementsAt,
  releasePageCursor,
} from "@waitron/ui/src/reorder-table.js";
import {
  blockClickAfterDrag,
  clearDragMarks,
  dragGhost,
  lastShownRow,
  markDragging,
  markGap,
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
import type { CategorySummary, MadeAt, Product } from "../api/client.js";
import type { FolderMadeAt } from "./folder-made-at.js";
import { EACH_UNIT_ID } from "@waitron/catalogue/src/unit-validation.js";
import {
  PRODUCT_ORDERINGS,
  type ProductOrdering,
} from "@waitron/catalogue/src/product-ordering.js";

export const ROOT_KEY = "root";

/** A category's swatch slot, at a product photo's width; blank where the row has no swatch. */
const folderFrame = (content: unknown = nothing) =>
  html`<span part="folder-frame">${content}</span>`;
/** How long a drag must rest on a closed category before it opens. */
export const HOVER_OPEN_MS = 600;
const DRAFT_KEY = "draft:new";

export type CategoryNameDraft =
  { kind: "create"; parentId: string | null } | { kind: "rename"; categoryId: string };

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null };
type CategoryRow = { kind: "folder"; key: string; parentKey: string; folder: CategorySummary };
type DraftRow = { kind: "draft"; key: typeof DRAFT_KEY; parentKey: string };
type ListRow = ProductRow | CategoryRow | RootRow | DraftRow;

interface ProductRow {
  kind: "product";
  key: string;
  parentKey: string;
  product: Product;
  variant: Product["variants"][number] | null;
}

function countOf(
  key: "folders.count" | "folders.product_count" | "product.variant_count",
  count: number,
): string {
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
    treeDragStyles,
    swatchPartStyles,
    css`
      :host([sticky-header]) {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
      }
      /* Cell templates are rendered in wt-data-table's shadow root, so ::part is the one boundary
         crossing used for their presentation. */
      /* Laid out as a product's cell is, so a wrapped name keeps its grip and swatch beside its
         first line. */
      wt-data-table::part(folder-cell) {
        display: block;
      }
      /* The name box's room is a flex basis; the phone's grid rule below still wins. */
      wt-data-table::part(naming) {
        display: flex;
        align-items: center;
      }
      wt-data-table::part(folder-frame) {
        display: inline-flex;
        flex: none;
        vertical-align: middle;
        justify-content: center;
        width: var(--wt-tap-min);
        margin-inline-end: var(--wt-space-3);
      }
      wt-data-table::part(tree-heading) {
        margin-inline-start: calc(var(--tree-arrow-width) + var(--wt-tap-min) + var(--wt-space-3));
      }
      wt-data-table[narrow]::part(folder-frame),
      wt-data-table[narrow]::part(thumb-frame),
      wt-data-table[narrow]::part(thumb-placeholder) {
        display: none;
      }
      wt-data-table::part(product-cell) {
        display: block;
      }
      wt-data-table::part(drop-target) {
        border-inline-start: var(--wt-selected-ring);
      }
      wt-data-table[narrow]::part(tree-heading) {
        margin-inline-start: var(--tree-arrow-width);
      }
      wt-data-table::part(drag-grip) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        width: var(--wt-tap-min);
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
      wt-data-table::part(grip-space) {
        display: inline-block;
        flex: none;
        vertical-align: middle;
        width: var(--wt-tap-min);
      }
      wt-data-table::part(name-line) {
        display: none;
      }
      wt-data-table[narrow]::part(name-line) {
        display: inline-block;
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
      }
      wt-data-table::part(thumb-frame),
      wt-data-table::part(thumb-placeholder) {
        box-sizing: border-box;
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
      wt-data-table::part(count),
      wt-data-table::part(unrouted-folder) {
        margin-inline-start: var(--wt-space-2);
      }
      wt-data-table::part(unrouted-folder) {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }
      wt-data-table::part(context) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(menu-divider) {
        align-self: stretch;
        margin: var(--wt-space-1) 0;
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }
      wt-data-table::part(count),
      wt-data-table::part(variant-count) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table[narrow]::part(count) {
        ${visuallyHiddenStyles}
        clip-path: inset(50%);
      }
      /* A column flex box takes its first item's baseline, so the row still lines up by the name. */
      wt-data-table::part(folder-name),
      wt-data-table::part(name-stack) {
        display: inline-flex;
        flex-direction: column;
      }
      wt-data-table::part(tree-toggle) {
        padding-inline-end: var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        text-align: end;
      }
      wt-data-table::part(variant-name) {
        padding-inline-start: calc(var(--wt-tap-min) + var(--wt-space-3));
      }
      wt-data-table[narrow]::part(variant-name) {
        padding-inline-start: 0;
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
      /* Each takes only the room #fitNames measures before the row's pinned cell, and wraps there. */
      wt-data-table::part(folder-name),
      wt-data-table::part(name-stack),
      wt-data-table::part(variant-name) {
        max-inline-size: var(--name-room);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(name-box) {
        flex: 1 1 calc(var(--wt-tap-min) * 4);
        min-width: 0;
        max-inline-size: max(var(--wt-tap-min), var(--name-box-room));
      }
      wt-data-table::part(name-after) {
        display: contents;
      }
      /* On a phone the name box takes a line of its own. The \`folder-cell\` span is held to the
         room #fitNames measures, so the asterisk wraps there instead of running under the
         pinned column. */
      wt-data-table[narrow]::part(naming) {
        display: grid;
        grid-template-columns: auto auto minmax(0, auto) 1fr;
        inline-size: max(var(--wt-tap-min), var(--name-box-room));
      }
      wt-data-table[narrow]::part(name-after) {
        display: block;
        overflow-wrap: anywhere;
      }
      wt-data-table[narrow]::part(name-box) {
        grid-row: 2;
        grid-column: 1 / -1;
      }
      wt-data-table::part(maker-link) {
        display: block;
        max-inline-size: 12rem;
        white-space: normal;
        overflow-wrap: anywhere;
        color: var(--wt-color-primary);
      }
      wt-data-table::part(maker-detail) {
        display: block;
        max-inline-size: calc(var(--wt-tap-min) * 5);
        white-space: normal;
        overflow-wrap: anywhere;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** Fills a bounded flex column, with the table's rows scrolling under its headings. */
  @property({ type: Boolean, reflect: true, attribute: "sticky-header" }) stickyHeader = false;
  @property({ type: Boolean }) selecting = false;
  /** Whether rows carry grips and can be dragged. On by default, so a mount that wants a tree
   * without them passes `.reordering=${false}`. */
  @property({ type: Boolean, reflect: true }) reordering = true;
  @property({ attribute: false }) selected: string[] = [];
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) madeAt: Record<string, MadeAt> = {};
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) unroutedFolderIds: string[] = [];
  /** Each category's baseline route; a category with none is drawn blank while routing loads. */
  @property({ attribute: false }) folderMadeAt: ReadonlyMap<string, FolderMadeAt> = new Map();
  /** Whether routing could not be read, so a blank is not mistaken for no route. */
  @property({ type: Boolean }) routingFailed = false;
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  /** The content language a stored unit's abbreviation is read in. */
  @property() unitLanguage = "en";
  /** The search box's text; while it lasts, the table holds every category above a match open. */
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
  /** Whether the catalogue has loaded, so that an empty one is known to be empty. */
  @property({ type: Boolean }) loaded = false;

  #listNames: ReadonlyMap<string, string> = new Map();
  #nameValue = "";
  /** Set once the box has sent its name or its cancel, until a refusal or a new box. */
  #nameSent = false;
  #emptyChecked = false;
  #rowByKey = new Map<string, ListRow>();
  #counts = new Map<string | null, { categories: number; products: number }>();
  #categorySearchTexts: ReadonlyMap<string, string> = new Map();
  #dragged: string[] = [];
  #pointerDrag: { pointerId: number; key: string; x: number; y: number; active: boolean } | null =
    null;
  /** The row a drop would file into — a category's key, or ROOT_KEY — while one is offered. */
  #target: string | undefined = undefined;
  #hover: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  #pointer = { x: 0, y: 0 };
  @state() private ghost: DragGhost | null = null;

  readonly #tableResize = new ResizeObserver(() => this.#scheduleFit());
  /** `narrow` moves the names without resizing the table or updating it. */
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
    this.#table()!.addController({
      hostUpdated: () => {
        this.#scheduleFit();
        // The table keeps a surviving row's cells, marks included, when its rows change mid-drag,
        // so after each of its updates the drop is judged again on the rows the list now holds and
        // the marks redrawn.
        if (!this.#pointerDrag?.active) return;
        if (this.#target !== undefined) this.#target = this.#dropTargetFor(this.#target);
        this.#paint();
      },
    });
  }

  /** A mouse drags a category or product from anywhere on its row; a finger only from the grip, so it
   * can still scroll; a control on the row is never a drag handle. */
  readonly #pointerDown = (event: PointerEvent): void => {
    if (!this.reordering) return;
    const path = event
      .composedPath()
      .filter((item): item is HTMLElement => item instanceof HTMLElement);
    const row = path.find((item) => item.matches("tr[data-row-key]"));
    const listed = row ? this.#rowByKey.get(row.dataset.rowKey!) : undefined;
    if (!row || !listed || listed.kind === "root" || listed.kind === "draft") return;
    if (listed.kind === "product" && listed.variant !== null) return;
    if (
      path.some((item) =>
        item.matches("input, a, wt-row-actions, wt-input, button:not(.row-activate, .drag-grip)"),
      )
    )
      return;
    const grip = path.some((item) => item.classList.contains("drag-grip"));
    this.#startDrag(event, listed.key, grip);
  };

  #startDrag(event: PointerEvent, key: string, grip: boolean): void {
    if (this.#pointerDrag || event.button !== 0) return;
    if (event.pointerType === "touch" && !grip) return;
    this.#pointerDrag = {
      pointerId: event.pointerId,
      key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    document.addEventListener("pointermove", this.#moveDrag);
    document.addEventListener("pointerup", this.#endDrag);
    document.addEventListener("pointercancel", this.#endDrag);
    document.addEventListener("keydown", this.#dragKey, true);
  }

  readonly #moveDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    event.preventDefault();
    if (!drag.active) {
      if (!this.#rowByKey.has(drag.key)) {
        this.#finishDrag();
        return;
      }
      drag.active = true;
      holdPageCursor();
      this.#dragged = this.selected.includes(drag.key) ? [...this.selected] : [drag.key];
      this.ghost = this.#ghostOf(this.#dragged);
      this.#send("drag-items", { keys: this.#dragged });
      void this.updateComplete.then(() => placeDragGhost(this.renderRoot, this.#pointer));
    }
    this.#pointer = { x: event.clientX, y: event.clientY };
    placeDragGhost(this.renderRoot, this.#pointer);
    const over = pointerElementsAt(event.clientX, event.clientY).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches("tr[data-row-key]"),
    )?.dataset.rowKey;
    const target = over === undefined ? undefined : this.#dropTargetFor(over);
    const changed = target !== this.#target;
    this.#target = target;
    this.#hoverOpen(over);
    if (changed) this.#paint();
  };

  readonly #endDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const keys = this.#dragged;
    // A backstop: the table-update hook in firstUpdated has already judged the drop again after
    // any refresh it saw.
    const target = this.#target === undefined ? undefined : this.#dropTargetFor(this.#target);
    this.#finishDrag();
    if (!drag.active || event.type !== "pointerup") return;
    blockClickAfterDrag(false);
    if (target !== undefined)
      this.#send("drop-items", { keys, folderId: target === ROOT_KEY ? null : target.slice(7) });
  };

  readonly #dragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#pointerDrag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.#finishDrag();
    blockClickAfterDrag(true);
  };

  #finishDrag(): void {
    const drag = this.#pointerDrag;
    document.removeEventListener("pointermove", this.#moveDrag);
    document.removeEventListener("pointerup", this.#endDrag);
    document.removeEventListener("pointercancel", this.#endDrag);
    document.removeEventListener("keydown", this.#dragKey, true);
    if (this.#hover) clearTimeout(this.#hover.timer);
    this.#hover = null;
    this.#pointerDrag = null;
    this.#target = undefined;
    this.#dragged = [];
    this.ghost = null;
    if (drag?.active) releasePageCursor();
    this.#paint();
    this.#send("drag-items", { keys: [] });
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
          : (this.#rowByKey.get(row.parentKey)?.parentKey ?? ROOT_KEY);
    if (
      !acceptsCatalogueDrop(
        this.#dragged,
        target === ROOT_KEY ? null : target.slice(7),
        this.categories,
      )
    )
      return undefined;
    return this.#dragged.some((dragged) => this.#rowByKey.get(dragged)?.parentKey !== target)
      ? target
      : undefined;
  }

  #hoverOpen(over: string | undefined): void {
    const table = this.#table();
    const closed =
      table !== null &&
      over !== undefined &&
      over === this.#target &&
      over.startsWith("folder:") &&
      !table.isExpanded(over);
    if (closed && this.#hover?.key === over) return;
    if (this.#hover) clearTimeout(this.#hover.timer);
    this.#hover = null;
    if (!closed || table === null || over === undefined) return;
    this.#hover = {
      key: over,
      timer: setTimeout(() => {
        this.#hover = null;
        if (!this.#pointerDrag?.active) return;
        table.setExpanded(over, true);
      }, HOVER_OPEN_MS),
    };
  }

  /** The table re-renders rows in place as a branch opens, so the marks are set again by key. */
  #paint(): void {
    const root = this.#table()?.shadowRoot;
    if (!root) return;
    clearDragMarks(root);
    if (!this.#pointerDrag?.active) return;
    for (const key of this.#dragged) markDragging(shownRow(root, key));
    if (this.#target === undefined) return;
    shownRow(root, this.#target)?.querySelector("td")?.part.add("drop-target");
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
    return { key: lastShownRow(root, target), side: "after" };
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

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("reordering") && !this.reordering && this.#pointerDrag) {
      const active = this.#pointerDrag.active;
      this.#finishDrag();
      if (active) blockClickAfterDrag(true);
    }
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
    if (changed.has("categories") || changed.has("products")) this.#counts = this.#count();
    if (changed.has("categories"))
      this.#categorySearchTexts = new Map(
        this.categories.map((category) => [
          category.id,
          categoryPathSearchText(category, this.categories),
        ]),
      );
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
    if (changed.has("nameDraft") && this.nameDraft) void this.#focusNameBox();
    if (this.loaded && !this.#emptyChecked) {
      this.#emptyChecked = true;
      if (this.products.length === 0 && this.categories.length === 0) void this.#openRootMenu();
    }
  }

  async #focusNameBox(): Promise<void> {
    const draft = this.nameDraft;
    const table = this.#table();
    if (!draft || !table) return;
    await table.updateComplete;
    await table.revealRow(draft.kind === "create" ? DRAFT_KEY : `folder:${draft.categoryId}`);
    const box = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    );
    if (!box) return;
    await box.updateComplete;
    // Fitted first, or focus scrolls the table sideways to show the whole uncapped box.
    this.#fitNames();
    box.focus();
    box.shadowRoot!.querySelector("input")!.select();
  }

  /** `show()` moves no focus, so the person's place on the page is kept. */
  async #openRootMenu(): Promise<void> {
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-root"]',
    );
    if (!menu) return;
    await menu.updateComplete;
    menu.show();
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

  #nameBox() {
    const draft = this.nameDraft;
    // A press on the square keeps the cursor in the input. The square is no Tab stop, so Tab still
    // leaves the box; the keyboard reaches a category's colour by its row's square.
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
      ><button
        slot="end"
        part="swatch-button"
        type="button"
        tabindex="-1"
        data-test="name-box-color"
        aria-label=${t("folders.choose_color")}
        @mousedown=${(event: Event) => event.preventDefault()}
        @click=${(event: Event) => {
          event.stopPropagation();
          if (this.#nameSent) return;
          this.#send("name-color", {});
        }}
      >
        ${swatchChip(this.nameColor)}
      </button></wt-input
    >`;
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
      this.#fitNames();
    });
  }

  /** The table is as wide as its widest row, which on a phone runs under the pinned column, so each
   * name, and the name box, takes only the room before that column, measured as if unscrolled, and
   * wraps inside it. Every room is measured before any is written, so writing one room does not
   * force a fresh layout before the next is read. A name box whose start the table is scrolled past
   * is scrolled back to, so a refusal that arrives after the person scrolled sideways is read from
   * its first letter. */
  #fitNames(): void {
    const root = this.#table()!.shadowRoot!;
    const scroll = root.querySelector<HTMLElement>(".scroll")!;
    const box = root.querySelector<HTMLElement>('wt-input[name="category-name"]');
    const names = [
      ...root.querySelectorAll<HTMLElement>(
        '[part~="folder-name"], [part~="name-stack"], [part~="variant-name"]',
      ),
    ];
    const fitted = box ? [...names, box] : names;
    const scrolled = scroll.scrollLeft;
    const rooms = fitted.map((element) => {
      const cell = element.closest("td")!;
      const end = cell
        .closest("tr")!
        .querySelector('td[data-pinned="end"]')!
        .getBoundingClientRect().left;
      const room =
        end -
        (element.getBoundingClientRect().left + scrolled) -
        parseFloat(getComputedStyle(cell).paddingInlineEnd);
      return `${Math.max(0, room)}px`;
    });
    fitted.forEach((element, index) => {
      // The box's room is set on its `folder-cell` span, which a phone lays out to that width.
      const [target, property] =
        element === box ? [box.parentElement!, "--name-box-room"] : [element, "--name-room"];
      if (target.style.getPropertyValue(property) !== rooms[index])
        target.style.setProperty(property, rooms[index]!);
    });
    if (!box) return;
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
      { kind: "root", key: ROOT_KEY, parentKey: null },
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

  #categorySearchText(id: string | null): string {
    if (id === null) return "";
    return this.#categorySearchTexts.get(id) ?? t("editor.missing_choice");
  }

  #modifierNames(product: Product): string {
    return product.modifiers.map((ref) => modifierListName(ref, this.#listNames)).join(", ");
  }

  /** Removed variants are kept but not counted: the default Status filter hides them. */
  #variantCount(product: Product) {
    const count = product.variants.filter(({ active }) => active).length;
    return count === 0
      ? nothing
      : html`<span part="variant-count" data-test="variant-count"
          >${countOf("product.variant_count", count)}</span
        >`;
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

  #unitWord(product: Product): string {
    if (product.unitId === EACH_UNIT_ID) return t("product.price_each");
    const language = this.unitLanguage;
    const name =
      resolveContentText(product.unit.abbreviation, language, language) ||
      resolveContentText(product.unit.name, language, language);
    return t("product.price_per").replace("{unit}", name);
  }

  #folderMadeAt(id: string) {
    const made = this.folderMadeAt.get(id);
    if (made === undefined)
      return this.routingFailed
        ? html`<span part="maker-detail">${t("folders.made_at_unavailable")}</span>`
        : nothing;
    const { maker, source } = made;
    const value =
      maker.kind === "no_preparation"
        ? t("product.no_preparation")
        : maker.kind === "no_replacement"
          ? t("product.no_replacement").replace(
              "{name}",
              () => maker.stationName ?? t("product.nowhere"),
            )
          : maker.kind === "station"
            ? maker.stationName
            : t("product.nowhere");
    const detail = [
      source === null
        ? ""
        : source.kind === "own"
          ? t("folders.made_at_own")
          : source.kind === "inherited"
            ? t("folders.made_at_inherited").replace(
                "{name}",
                () => source.name ?? t("editor.missing_choice"),
              )
            : source.kind === "default"
              ? t("folders.made_at_default")
              : t("folders.made_at_exception"),
      made.someElsewhere ? t("folders.made_at_some_elsewhere") : "",
    ]
      .filter((part) => part !== "")
      .join(" · ");
    return html`<a part="maker-link" href="/manage/prep-stations">${value}</a>${
        detail === "" ? nothing : html` <span part="maker-detail">${detail}</span>`
      }`;
  }

  #productColumns(): DataTableColumn<ProductRow>[] {
    return [
      {
        key: "name",
        label: t("product.name"),
        sortValue: (row) => row.variant?.name ?? row.product.name,
        searchValue: ({ product }) =>
          [
            product.name,
            ...product.variants.map(({ name }) => name),
            this.#categorySearchText(product.primaryCategoryId),
          ].join(" "),
        cell: ({ product, variant }, { ancestorOnly }) =>
          variant
            ? html`<span part="variant-name">${variant.name}</span>`
            : html`<span part=${ancestorOnly ? "product-cell context" : "product-cell"}>
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
                }<span part="name-stack"
                  ><strong>${product.name}</strong>${this.#variantCount(product)}</span
                >
              </span>`,
      },
      {
        key: "made-at",
        choosable: "shown",
        label: t("product.made_at"),
        cell: (row) => {
          if (row.variant) return nothing;
          const id = row.product.id;
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
        cell: ({ product, variant }) => (variant ? nothing : this.#modifierNames(product)),
        searchValue: ({ product, variant }) => (variant ? "" : this.#modifierNames(product)),
      },
      {
        key: "ordering",
        choosable: "shown",
        label: t("product.ordering"),
        // A variant is a way of buying its product, so the filter reads the PRODUCT's answer on
        // every row and a variant is shown or hidden together with its product.
        cell: ({ product, variant }) => {
          if (variant) return nothing;
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
              >${productStatusName(active, variant !== null)}</span
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
            { value: "inactive", label: t("product.disabled_badge") },
          ],
          initial: "active",
        },
      },
      {
        key: "allergens",
        choosable: "shown",
        label: t("product.allergens"),
        cell: ({ product, variant }) => {
          if (variant) return nothing;
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
          const { id, name, active } = variant ?? product;
          const restore = !active;
          const removal = restore
            ? { event: "restore-product" as const, test: "restore", label: t("product.enable") }
            : {
                event: "delete-product" as const,
                test: "delete",
                label: t("product.disable"),
              };
          return html`<wt-row-actions
            align="end"
            data-test=${`actions-${id}`}
            label=${`${t("staff.actions")}: ${name}`}
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`edit-${id}`}
              @click=${() => this.#send("edit-product", { productId: id })}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant=${restore ? "secondary" : "danger"}
              data-test=${`${removal.test}-${id}`}
              @click=${() => this.#send(removal.event, { productId: id })}
              >${removal.label}</wt-button
            ></wt-row-actions
          >`;
        },
      },
    ];
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

  #nameLine() {
    return this.reordering ? html`<span part="name-line" aria-hidden="true"></span>` : nothing;
  }

  #rowControls(row: ListRow) {
    if (row.kind === "folder") return this.#grip(row.folder.name);
    if (row.kind === "product" && row.variant === null) return this.#grip(row.product.name);
    return html`<span part="grip-space"></span>`;
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
        if (row.kind === "draft")
          return column.key === "name"
            ? html`<span part="folder-cell naming"
                >${this.#nameLine()}${folderFrame()}${this.#nameBox()}</span
              >`
            : nothing;
        if (row.kind === "root") {
          if (column.key === "name")
            return html`<span part="folder-cell"
              >${folderFrame()}<span part="folder-name"
                ><span
                  ><strong>${t("folders.all_products")}</strong
                  ><span part="count" data-test="count-root">${this.#contents(null)}</span></span
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
              >${this.#contents(folder.id)}</span
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
                ? html`${this.#nameLine()}${folderFrame()}${this.#nameBox()}<span part="name-after"
                      >${after}</span
                    >`
                : html`${folderFrame(
                      html`<button
                        part="swatch-button"
                        type="button"
                        data-test=${`color-${folder.id}`}
                        aria-label=${t("folders.edit_color").replace("{name}", folder.name)}
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          this.#send("folder-color", { folderId: folder.id });
                        }}
                      >
                        ${swatchChip(folder.color)}
                      </button>`,
                    )}<span part="folder-name"
                      ><span><strong>${folder.name}</strong>${after}</span></span
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
            <hr part="menu-divider" />
            <wt-button
              align="start"
              variant="secondary"
              data-test=${`rename-${folder.id}`}
              @click=${() => this.#send("rename-folder", { folderId: folder.id })}
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
              @click=${() => this.#send("delete-folder", { folderId: folder.id })}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`;
        if (column.key === "made-at") return this.#folderMadeAt(folder.id);
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
                    ? `${row.folder.name} ${this.#categorySearchText(row.folder.parentId)}`
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
        .stickyHeader=${this.stickyHeader}
        leading-filters
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
        expandAllLabel=${t("folders.expand_all")}
        collapseAllLabel=${t("folders.collapse_all")}
        initiallyCollapsed
        .searchTerm=${this.search}
        .rowControls=${this.reordering ? (row: ListRow) => this.#rowControls(row) : undefined}
        rowControlsLabel=${t("folders.drag")}
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
        .rowJoinsParent=${(row: ListRow) => row.kind === "product" && row.variant !== null}
        .rowKeepsChildOrder=${(row: ListRow) => row.kind === "product" && row.variant === null}
        .expandAllIncludes=${(row: ListRow) => row.kind === "folder"}
        .rowActivation=${(row: ListRow) =>
          row.kind === "folder" && !this.#renaming(row.folder.id)
            ? "toggle"
            : row.kind === "product"
              ? "click"
              : "none"}
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
        ><slot name="toolbar-start" slot="toolbar-start"></slot
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
