import { DragEdgeScroll } from "@waitron/ui/src/drag-edge-scroll.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, reorder, type DataTableColumn, type WtDataTable } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import {
  holdPageCursor,
  pointerElementsAt,
  releasePageCursor,
} from "@waitron/ui/src/reorder-table.js";
import { memberKindLabel, memberName } from "./member-names.js";
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
import { productMedia, productMediaStyles } from "./product-media.js";
import { swatchChip, swatchPartStyles } from "./swatch-styles.js";
import { menuTreeCell, menuTreeStyles } from "./menu-tree-presentation.js";
import { categoryColor } from "@waitron/catalogue/src/color-inheritance.js";
import {
  FOLLOWING_FOLDER,
  folderPresentation,
} from "@waitron/catalogue/src/include-folder-presentation.js";
import type { Presentation } from "@waitron/catalogue/src/section-types.js";
import type { CategorySummary, MenuStructureNode, Product } from "../api/client.js";
import { t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";

/** A section node's own customer-facing presentation, before any include's folder applies. */
export function ownPresentation(node: MenuStructureNode): Presentation {
  return { names: node.names ?? {}, image: node.image ?? null, color: node.color ?? null };
}

const gripSpace = html`<span part="grip-space" aria-hidden="true"
  ><wt-icon name="grip"></wt-icon
></span>`;
const TOP_LIST = "";

type MemberRef = MenuStructureNode["ref"];

const sameRef = (a: MemberRef, b: MemberRef): boolean =>
  a.kind === "product"
    ? b.kind === "product" && a.productId === b.productId
    : b.kind === "section" && a.sectionId === b.sectionId;

const holds = (members: MenuStructureNode[], ref: MemberRef): boolean =>
  members.some((member) => sameRef(member.ref, ref));

/** A section can be drawn in several places, so what lies inside a member is told by section id. */
function sectionIdsWithin(node: MenuStructureNode): string[] {
  return node.ref.kind === "section"
    ? [node.ref.sectionId, ...(node.children ?? []).flatMap(sectionIdsWithin)]
    : [];
}

/** Where a release would put the dragged member: beside a sibling (a reorder), at the end of a
 * closed section's list, or beside a row of another list. */
type Drop =
  | { kind: "sibling"; key: string }
  | { kind: "into"; key: string }
  | { kind: "beside"; key: string; side: "before" | "after" };

const sameDrop = (a: Drop | undefined, b: Drop | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

interface Row {
  /** The member ids from the menu's top level to this member, joined with `/`. */
  key: string;
  /** Null for a member of the menu's own top level. */
  parentKey: string | null;
  path: string[];
  node: MenuStructureNode;
  name: string;
  /** The name of the list holding this member: the menu's, or its section's. */
  holder: string;
  /** Which list holds this member: TOP_LIST, or its section's id. */
  list: string;
  /** Inside an included menu, which is edited only from its own page. */
  readOnly: boolean;
}

export type StructureAddAction = "new-section" | "include-menu" | "add-products";

const ADDS: { action: StructureAddAction; test: string; label: () => string }[] = [
  { action: "new-section", test: "new-section", label: () => t("menus.new_section") },
  { action: "include-menu", test: "include-menu", label: () => t("menus.include_menu") },
  { action: "add-products", test: "open-add-products", label: () => t("sections.add_products") },
];

const samePath = (next: string[], previous: string[] | undefined): boolean =>
  previous !== undefined && next.join("/") === previous.join("/");

/**
 * A menu's structure as one tree table: every member in menu order, each place a section is shown keyed by its own path. The
 * widget only reports what the person asked for; the host owns every write.
 */
@customElement("dashboard-menu-structure-table")
export class MenuStructureTable extends LitElement {
  static override styles = [
    baseStyles,
    treeDragStyles,
    swatchPartStyles,
    menuTreeStyles,
    css`
      :host {
        display: block;
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
      wt-data-table::part(drag-grip):disabled {
        cursor: default;
        opacity: var(--wt-opacity-disabled);
      }
      /* The grip's own box and icon, unseen, so the row lines up by the same baseline as one with a
         grip. */
      wt-data-table::part(grip-space) {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        visibility: hidden;
      }
      wt-data-table::part(current) {
        font-weight: var(--wt-font-weight-bold);
        text-decoration: underline;
      }
      wt-data-table::part(read-only),
      wt-data-table::part(kind),
      wt-data-table::part(available) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(note) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(menu-divider) {
        align-self: stretch;
        margin: var(--wt-space-1) 0;
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }
      .empty-adds {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--wt-space-2);
      }
      .reorder-status {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
    productMediaStyles,
  ];

  @property({ attribute: false }) nodes: MenuStructureNode[] = [];
  /** Where members' staff names and images come from. */
  @property({ attribute: false }) products: Product[] = [];
  /** With `defaultColor`, where a product without its own colour takes one from. */
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) defaultColor: string | null = null;
  @property() menuName = "";
  /** The path of the current section; empty for the menu's own top level. */
  @property({
    attribute: false,
    hasChanged: (next: string[], previous?: string[]) => !samePath(next, previous),
  })
  current: string[] = [];
  @property({ type: Boolean }) busy = false;
  /** Whether rows carry grips and can be moved. On by default, so a mount that wants a tree
   * without them passes `.reordering=${false}`. */
  @property({ type: Boolean, reflect: true }) reordering = true;
  /** The search box's text; while it lasts, the table holds every section above a match open. */
  @property() search = "";
  /** Whether rows the menu owns carry a box; the host owns which are ticked. */
  @property({ type: Boolean }) selecting = false;
  /** The ticked rows' keys. */
  @property({ attribute: false }) selected: string[] = [];

  #rowByKey = new Map<string, Row>();
  #productById = new Map<string, Product>();
  #productNames = new Map<string, string>();
  #categoryById: ReadonlyMap<string, CategorySummary> = new Map();
  #sectionNames = new Map<string, string>();
  /** While the way to the current section is being opened, a closed row on it is not the person's. */
  #revealing = 0;
  /** Set once the current section was reported hidden, until the host names another. */
  #lostReported = false;
  /** Each list's order after moves the host has not answered yet, keyed by list, so every place a
   * section is shown agrees. */
  #order = new Map<string, string[]>();
  /** The rows are not keyed, so a move leaves focus on whichever grip now sits where it was. */
  #refocus: string | null = null;
  /** A move into another list, answered by the host reading the menu again: the grip to focus
   * then, the one it left if the move did not happen, and whether new nodes have arrived. */
  #movedFocus: { key: string; fallback: string; read: boolean } | null = null;
  @state() private announcement = "";
  #drag: { pointerId: number; key: string; x: number; y: number; active: boolean } | null = null;
  #target: Drop | undefined = undefined;
  #pointer = { x: 0, y: 0 };
  @state() private ghost: DragGhost | null = null;
  /** Whether a column filter is narrowing the rows, as the table last reported. */
  @state() private filtering = false;

  override disconnectedCallback(): void {
    if (this.#drag) this.#finishDrag();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("reordering") && !this.reordering && this.#drag) {
      const active = this.#drag.active;
      this.#finishDrag();
      if (active) blockClickAfterDrag(true);
    }
    if (changed.has("products")) {
      this.#productById = new Map(this.products.map((product) => [product.id, product]));
      this.#productNames = new Map(this.products.map(({ id, name }) => [id, name]));
    }
    if (changed.has("categories"))
      this.#categoryById = new Map(this.categories.map((category) => [category.id, category]));
    if (changed.has("nodes")) {
      const names = new Map<string, string>();
      const walk = (nodes: MenuStructureNode[]) => {
        for (const node of nodes)
          if (node.ref.kind === "section") {
            names.set(node.ref.sectionId, node.internalName ?? t("members.missing"));
            walk(node.children ?? []);
          }
      };
      walk(this.nodes);
      this.#sectionNames = names;
      this.#order = new Map();
      if (this.#movedFocus) this.#movedFocus.read = true;
    }
    if (changed.has("current")) this.#lostReported = false;
  }

  protected override firstUpdated(): void {
    // Collapse all closes branches without telling anyone, so the table's own updates are watched.
    this.#table()!.addController({
      hostUpdated: () => {
        this.#checkCurrentShown();
        this.#restoreFocus();
        this.#restoreMovedFocus();
        if (this.#drag?.active) this.#paint();
      },
    });
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("current")) void this.#revealCurrent();
  }

  async #revealCurrent(): Promise<void> {
    const table = this.#table()!;
    this.#revealing++;
    try {
      await table.updateComplete;
      for (const key of this.#currentKeys()) table.setExpanded(key, true);
    } finally {
      this.#revealing--;
    }
  }

  #currentKeys(): string[] {
    return this.current.map((_, index) => this.current.slice(0, index + 1).join("/"));
  }

  #checkCurrentShown(): void {
    const table = this.#table()!;
    const keys = this.#currentKeys();
    if (this.#revealing > 0 || this.#lostReported || keys.length === 0) return;
    // A current section no longer in the menu is the host's to resolve.
    if (!this.#rowByKey.has(keys.at(-1)!)) return;
    const closed = keys.findIndex((key) => !table.isExpanded(key));
    if (closed === -1) return;
    this.#lostReported = true;
    this.#send("wt-structure-edit", { path: this.current.slice(0, closed) });
  }

  readonly #expandChange = (event: CustomEvent<{ key: string; expanded: boolean }>): void => {
    event.stopPropagation();
    const { key, expanded } = event.detail;
    const row = this.#rowByKey.get(key);
    if (row === undefined || !this.#ownedSection(row)) return;
    if (expanded) {
      this.#send("wt-structure-edit", { path: row.path });
      return;
    }
    const current = this.current.join("/");
    if (current !== key && !current.startsWith(`${key}/`)) return;
    this.#lostReported = true;
    this.#send("wt-structure-edit", { path: row.path.slice(0, -1) });
  };

  #restoreFocus(): void {
    const key = this.#refocus;
    if (key === null) return;
    this.#refocus = null;
    this.#table()
      ?.shadowRoot?.querySelector<HTMLElement>(`[data-test="drag-${CSS.escape(key)}"]`)
      ?.focus();
  }

  /** Waits for the menu read again and for the host to stop being busy, which disables every grip,
   * and for the way to the current section to be opened, which draws the moved row. */
  #restoreMovedFocus(): void {
    const pending = this.#movedFocus;
    if (!pending?.read || this.busy || this.#revealing > 0) return;
    this.#movedFocus = null;
    const root = this.#table()!.shadowRoot!;
    const gripAt = (key: string) =>
      root.querySelector<HTMLElement>(`[data-test="drag-${CSS.escape(key)}"]`);
    (gripAt(pending.key) ?? gripAt(pending.fallback))?.focus();
  }

  #siblingRows(row: Row): Row[] {
    return [...this.#rowByKey.values()].filter((other) => other.parentKey === row.parentKey);
  }

  /** While a search or filter hides rows, a grip moves only past the siblings the person can see. */
  #shownSiblingRows(row: Row): Row[] {
    const root = this.#table()!.shadowRoot!;
    return this.#siblingRows(row).filter((sibling) => shownRow(root, sibling.key) !== null);
  }

  /** Whether the list holding `row` already holds `ref`. */
  #listHolds(row: Row, ref: MemberRef): boolean {
    return holds(
      this.#siblingRows(row).map((other) => other.node),
      ref,
    );
  }

  #siblings(row: Row): string[] {
    return this.#siblingRows(row).map((other) => other.node.memberId);
  }

  #movable(key: string): Row | undefined {
    return this.#rowByKey.get(key);
  }

  #gripDown(event: PointerEvent, row: Row): void {
    if (this.#drag || this.busy || event.button !== 0) return;
    // Keep the press from selecting text or starting the browser's own drag.
    event.preventDefault();
    this.#drag = {
      pointerId: event.pointerId,
      key: row.key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    document.addEventListener("pointermove", this.#moveDrag);
    document.addEventListener("pointerup", this.#endDrag);
    document.addEventListener("pointercancel", this.#endDrag);
    document.addEventListener("keydown", this.#dragKey, true);
  }

  readonly #edgeScroll = new DragEdgeScroll();

  readonly #moveDrag = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    event.preventDefault();
    this.#pointer = { x: event.clientX, y: event.clientY };
    const starting = !drag.active;
    if (starting) {
      const row = this.#movable(drag.key);
      if (!row) {
        this.#finishDrag();
        return;
      }
      drag.active = true;
      holdPageCursor();
      const ref = row.node.ref;
      this.ghost = {
        label: row.name,
        image:
          ref.kind === "product" ? (this.#productById.get(ref.productId)?.image ?? null) : null,
        folder: ref.kind === "section",
      };
      void this.updateComplete.then(() => placeDragGhost(this.renderRoot, this.#pointer));
    }
    if (starting) {
      const origin = shownRow(this.#table()!.shadowRoot!, drag.key);
      if (origin) this.#edgeScroll.start(origin, this.#pointer, () => this.#trackDrop());
    }
    this.#edgeScroll.update(this.#pointer);
    this.#trackDrop();
    if (starting) this.#paint();
  };

  #trackDrop(): void {
    placeDragGhost(this.renderRoot, this.#pointer);
    const over = pointerElementsAt(this.#pointer.x, this.#pointer.y).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches("tr[data-row-key]"),
    )?.dataset.rowKey;
    const target = over === undefined ? undefined : this.#targetFor(this.#drag!.key, over);
    if (sameDrop(target, this.#target)) return;
    this.#target = target;
    this.#paint();
  }

  readonly #endDrag = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const target = this.#target;
    this.#finishDrag();
    if (!drag.active || event.type !== "pointerup") return;
    blockClickAfterDrag(false);
    const row = this.#movable(drag.key);
    const at = target && this.#rowByKey.get(target.key);
    if (row === undefined || this.busy || !target || !at) return;
    if (target.kind === "sibling") {
      const to = this.#siblingRows(row).findIndex((sibling) => sibling.key === target.key);
      if (to >= 0) this.#move(row, to);
      return;
    }
    const from = row.path.slice(0, -1);
    const memberId = row.node.memberId;
    if (target.kind === "into") {
      this.#send("wt-member-move-into", { from, memberId, to: at.path });
      return;
    }
    const position =
      this.#siblings(at).indexOf(at.node.memberId) + (target.side === "after" ? 1 : 0);
    this.#send("wt-member-move-into", { from, memberId, to: at.path.slice(0, -1), position });
  };

  readonly #dragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#drag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.#finishDrag();
    blockClickAfterDrag(true);
  };

  #finishDrag(): void {
    this.#edgeScroll.stop();
    const drag = this.#drag;
    document.removeEventListener("pointermove", this.#moveDrag);
    document.removeEventListener("pointerup", this.#endDrag);
    document.removeEventListener("pointercancel", this.#endDrag);
    document.removeEventListener("keydown", this.#dragKey, true);
    this.#drag = null;
    this.#target = undefined;
    this.ghost = null;
    if (drag?.active) releasePageCursor();
    this.#paint();
  }

  /** What a release over the row `over` would do. A closed section the menu owns takes the member
   * at its end over its middle half; elsewhere a row offers the place beside it in its own list, by
   * the pointer's half. Branches are compared by whole member ids: `m-fav` does not hold
   * `m-fav-drinks`. */
  #targetFor(dragged: string, over: string): Drop | undefined {
    const row = this.#movable(dragged);
    const at = this.#rowByKey.get(over);
    if (!row || !at || over === dragged || over.startsWith(`${dragged}/`)) return undefined;
    const inside = new Set(sectionIdsWithin(row.node));
    if (inside.has(at.list) || at.readOnly) return undefined;
    const ref = row.node.ref;
    const sibling = at.parentKey === row.parentKey;
    if (!this.#known(ref) && !sibling) return undefined;
    const height = this.#heightIn(over);
    if (
      this.#canHold(at, row) &&
      shownRow(this.#table()!.shadowRoot!, over)!.getAttribute("aria-expanded") !== "true" &&
      height >= 0.25 &&
      height < 0.75
    )
      return holds(at.node.children ?? [], ref) ? undefined : { kind: "into", key: over };
    if (sibling) return { kind: "sibling", key: over };
    // This also refuses the dragged member's own list drawn in another place, which holds it.
    if (this.#listHolds(at, ref)) return undefined;
    return { kind: "beside", key: over, side: height < 0.5 ? "before" : "after" };
  }

  /** The server leaves a product no longer in the catalogue out of a list's contents, so it can
   * only be reordered where it is. */
  #known(ref: MemberRef): boolean {
    return ref.kind === "section" || this.#productById.has(ref.productId);
  }

  /** Whether `section` is a section the menu owns that could take `row` without holding itself. */
  #canHold(section: Row, row: Row): boolean {
    return (
      this.#known(row.node.ref) &&
      section.node.ref.kind === "section" &&
      this.#ownedSection(section) &&
      !sectionIdsWithin(row.node).includes(section.node.ref.sectionId)
    );
  }

  /** How far down the row's content the pointer is, from 0 to 1. A drawn gap pads the row's cells,
   * so the content box, not the row, keeps a pointer in the same band once the gap appears. */
  #heightIn(key: string): number {
    const cell = shownRow(this.#table()!.shadowRoot!, key)!.querySelector("td")!;
    const box = cell.getBoundingClientRect();
    const style = getComputedStyle(cell);
    const top = box.top + parseFloat(style.paddingTop);
    const bottom = box.bottom - parseFloat(style.paddingBottom);
    return (this.#pointer.y - top) / (bottom - top);
  }

  #paint(): void {
    const root = this.#table()!.shadowRoot!;
    clearDragMarks(root);
    const drag = this.#drag;
    if (!drag?.active) return;
    markDragging(shownRow(root, drag.key));
    if (this.#target?.kind === "into")
      shownRow(root, this.#target.key)?.querySelector("td")?.part.add("drop-target");
    const gap = this.#gap(drag.key);
    if (gap) markGap(root, gap);
  }

  #gap(dragged: string): DropGap | undefined {
    const row = this.#movable(dragged);
    const target = this.#target;
    if (target === undefined || target.kind === "into" || !row) return undefined;
    const root = this.#table()!.shadowRoot!;
    if (target.kind === "beside")
      return target.side === "before"
        ? { key: target.key, side: "before" }
        : { key: lastShownRow(root, target.key), side: "after" };
    const keys = this.#siblingRows(row).map((sibling) => sibling.key);
    if (keys.indexOf(target.key) < keys.indexOf(dragged))
      return { key: target.key, side: "before" };
    return { key: lastShownRow(root, target.key), side: "after" };
  }

  #move(row: Row, to: number): void {
    const siblings = this.#siblings(row);
    const memberId = row.node.memberId;
    this.#order.set(row.list, reorder(siblings, siblings.indexOf(memberId), to));
    this.#send("wt-member-move", { path: row.path.slice(0, -1), memberId, to });
    this.requestUpdate();
  }

  #gripKey(event: KeyboardEvent, row: Row): void {
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !this.busy) {
      event.preventDefault();
      if (event.key === "ArrowRight") this.#moveIntoAbove(row);
      else this.#moveOut(row);
      return;
    }
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0 || this.busy) return;
    // Without this the arrow scrolls the page, carrying the row out from under the grip.
    event.preventDefault();
    const shown = this.#shownSiblingRows(row);
    const at = shown.indexOf(row) + delta;
    const target = shown[at];
    if (target === undefined) return;
    this.#move(row, this.#siblings(row).indexOf(target.node.memberId));
    this.#refocus = row.key;
    this.announcement = t("action.reordered")
      .replace("{item}", row.name)
      .replace("{index}", String(at + 1))
      .replace("{total}", String(shown.length));
  }

  /** Like indenting in an outline: into the section drawn directly above, at its end. */
  #moveIntoAbove(row: Row): void {
    const shown = this.#shownSiblingRows(row);
    const above = shown[shown.indexOf(row) - 1];
    if (!above || !this.#canHold(above, row) || holds(above.node.children ?? [], row.node.ref))
      return;
    this.#moveAcross(
      row,
      above.path,
      undefined,
      t("action.moved_into").replace("{item}", row.name).replace("{section}", above.name),
    );
  }

  /** Out of its section, to the place directly after that section in the section's own list. */
  #moveOut(row: Row): void {
    const section = row.parentKey === null ? undefined : this.#rowByKey.get(row.parentKey);
    if (!section || !this.#known(row.node.ref) || this.#listHolds(section, row.node.ref)) return;
    const position = this.#siblings(section).indexOf(section.node.memberId) + 1;
    this.#moveAcross(
      row,
      section.path.slice(0, -1),
      position,
      t("action.moved_out").replace("{item}", row.name).replace("{list}", section.holder),
    );
  }

  #moveAcross(row: Row, to: string[], position: number | undefined, announcement: string): void {
    const memberId = row.node.memberId;
    const from = row.path.slice(0, -1);
    this.#send(
      "wt-member-move-into",
      position === undefined ? { from, memberId, to } : { from, memberId, to, position },
    );
    this.#movedFocus = { key: [...to, memberId].join("/"), fallback: row.key, read: false };
    this.announcement = announcement;
  }

  /** While a search or filter narrows the rows, a section the table keeps only on the way to a
   * match would carry everything the search hides when acted on, so only one that matches itself
   * takes a box. No section answers the Available filter, so none matches while it is on. */
  #rowSelectable(row: Row): boolean {
    if (row.readOnly) return false;
    if (row.node.ref.kind !== "section") return true;
    if (this.filtering) return false;
    const term = this.search.trim().toLocaleLowerCase();
    return term === "" || row.name.toLocaleLowerCase().includes(term);
  }

  readonly #filterChange = (event: CustomEvent<{ filters: Record<string, string | string[]> }>) => {
    this.filtering = Object.values(event.detail.filters).some((value) => value.length > 0);
  };

  #ownedSection(row: Row): boolean {
    return row.node.ref.kind === "section" && !row.readOnly && !row.node.includedMenuId;
  }

  #table(): WtDataTable<Row> | null {
    return this.shadowRoot?.querySelector<WtDataTable<Row>>("wt-data-table") ?? null;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** The keys of the rows that take a box and that the search and the Available filter show,
   * including rows inside a closed section. */
  shownSelectableKeys(): Set<string> {
    const shown = this.#table()?.shownKeys() ?? [];
    return new Set(
      shown.filter((key) => {
        const row = this.#rowByKey.get(key);
        return row !== undefined && this.#rowSelectable(row);
      }),
    );
  }

  /** Opens or closes the row `key` once the rows last given are drawn, without reporting it as a
   * person's change. */
  async setExpanded(key: string, expanded: boolean): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    await table?.updateComplete;
    table?.setExpanded(key, expanded);
  }

  /** Focuses the row's ⋮, or the nearest drawn ancestor's; for the top level (`""`), or when no
   * ancestor is drawn, the toolbar's Add menu; in an empty menu, which draws no toolbar, the empty
   * box's first add. */
  focusRowMenu(key: string): void {
    const table = this.#table();
    const root = table?.shadowRoot;
    if (!table || !root) return;
    // A host asks from its own `updated`, before the rows it just handed over are drawn: emptying
    // the menu swaps the toolbar's Add menu for the empty box's adds.
    if (this.isUpdatePending || table.isUpdatePending) {
      void (async () => {
        await this.updateComplete;
        await table.updateComplete;
        this.focusRowMenu(key);
      })();
      return;
    }
    const segments = key === "" ? [] : key.split("/");
    for (let depth = segments.length; depth > 0; depth--) {
      const candidate = segments.slice(0, depth).join("/");
      const menu = root.querySelector<HTMLElement>(
        `tr[data-row-key="${CSS.escape(candidate)}"] wt-row-actions[data-test^="actions-"]`,
      );
      if (menu) {
        menu.focus();
        return;
      }
    }
    this.renderRoot
      .querySelector<HTMLElement>('[data-test="toolbar-adds"], [data-test$="-empty"]')
      ?.focus();
  }

  #rows(): Row[] {
    const rows: Row[] = [];
    const walk = (
      nodes: MenuStructureNode[],
      parentPath: string[],
      parentKey: string | null,
      holder: string,
      list: string,
      readOnly: boolean,
    ) => {
      for (const node of this.#ordered(nodes, list)) {
        const path = [...parentPath, node.memberId];
        const key = path.join("/");
        const staffName = memberName(node.ref, this.#productNames, this.#sectionNames);
        const name = node.includedMenuId
          ? t("menus.menu_prefix").replace("{name}", staffName)
          : staffName;
        rows.push({ key, parentKey, path, node, name, holder, list, readOnly });
        walk(
          node.children ?? [],
          path,
          key,
          staffName,
          node.ref.kind === "section" ? node.ref.sectionId : list,
          readOnly || Boolean(node.includedMenuId),
        );
      }
    };
    walk(this.nodes, [], null, this.menuName, TOP_LIST, false);
    return rows;
  }

  #ordered<T extends { memberId: string }>(items: T[], list: string): T[] {
    const order = this.#order.get(list);
    if (!order) return items;
    return order.flatMap((memberId) => items.filter((item) => item.memberId === memberId));
  }

  #isCurrent(row: Row): boolean {
    return row.path.join("/") === this.current.join("/");
  }

  #nameSpan(row: Row) {
    const parts = ["name"];
    if (this.#isCurrent(row)) parts.push("current");
    if (row.readOnly) parts.push("read-only");
    return html`<span
      part=${parts.join(" ")}
      data-test="name"
      aria-current=${this.#isCurrent(row) ? "true" : nothing}
      >${row.name}</span
    >`;
  }

  #grip(row: Row) {
    if (!this.reordering) return nothing;
    if (row.readOnly) return gripSpace;
    return html`<button
      part="drag-grip"
      type="button"
      data-test=${`drag-${row.key}`}
      aria-label=${`${t("members.reorder")}: ${row.name}`}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      ?disabled=${this.busy}
      @keydown=${(event: KeyboardEvent) => this.#gripKey(event, row)}
      @pointerdown=${(event: PointerEvent) => this.#gripDown(event, row)}
    >
      <wt-icon name="grip"></wt-icon>
    </button>`;
  }

  #nameCell(row: Row) {
    const { node, key } = row;
    const stack = html`<span
      part=${node.ref.kind === "section" ? "name-stack folder-stack" : "name-stack"}
      >${this.#nameSpan(row)}${
        node.includedMenuId && !row.readOnly
          ? html`<span part="note" data-test=${`folder-setting-${key}`}
              >${t(
                (node.folder ?? FOLLOWING_FOLDER).showAsFolder
                  ? "menus.include_as_folder"
                  : "menus.include_direct",
              )}</span
            >`
          : nothing
      }</span
    >`;
    return menuTreeCell(node.ref.kind, this.#swatch(row), stack);
  }

  #swatch(row: Row) {
    const { node, key, name } = row;
    if (node.ref.kind === "product") {
      const productId = node.ref.productId;
      const product = this.#productById.get(productId);
      return productMedia({
        key,
        productId,
        name,
        image: product?.image ?? null,
        color:
          product === undefined
            ? null
            : (product.color ??
              categoryColor(product.categoryId, this.#categoryById, this.defaultColor)),
        editable: !row.readOnly && product !== undefined,
        busy: this.busy,
      });
    }
    const sectionId = node.ref.sectionId;
    const own = ownPresentation(node);
    const chip = swatchChip(folderPresentation(own, node.folder ?? FOLLOWING_FOLDER).color);
    if (!this.#ownedSection(row))
      return html`<span part="swatch-box" data-test=${`color-${key}`} aria-hidden="true"
        >${chip}</span
      >`;
    return html`<button
      part="swatch-button"
      type="button"
      data-test=${`color-${key}`}
      aria-label=${t("folders.edit_color").replace("{name}", name)}
      ?disabled=${this.busy}
      @click=${() => this.#send("wt-member-edit", { sectionId, path: row.path })}
    >
      ${chip}
    </button>`;
  }

  #button(
    test: string,
    label: string,
    variant: "secondary" | "danger",
    act: () => void,
    align: "start" | "center" = "start",
  ) {
    return html`<wt-button
      align=${align}
      variant=${variant}
      data-test=${test}
      .disabled=${this.busy}
      @click=${() => {
        if (!this.busy) act();
      }}
      >${label}</wt-button
    >`;
  }

  /** The three adds for the list at `path`, as a menu's items or, with `align` "center", as the
   * empty box's buttons. */
  #adds(path: string[], suffix: string, align: "start" | "center" = "start") {
    return ADDS.map(({ action, test, label }) =>
      this.#button(
        `${test}-${suffix}`,
        label(),
        "secondary",
        () => this.#send("wt-structure-add", { action, path }),
        align,
      ),
    );
  }

  #remove(row: Row, label: string) {
    return this.#button(`remove-${row.key}`, label, "secondary", () =>
      this.#send("wt-member-remove", {
        path: row.path.slice(0, -1),
        memberId: row.node.memberId,
      }),
    );
  }

  #menuItems(row: Row) {
    const { node, key } = row;
    if (node.includedMenuId)
      return html`<a
          data-test=${`source-${key}`}
          href=${`/manage/menus/menu/${node.includedMenuId}/view/structure`}
          >${t("menus.open_included").replace(
            "{name}",
            memberName(node.ref, this.#productNames, this.#sectionNames),
          )}</a
        >${this.#button(`edit-${key}`, t("action.edit"), "secondary", () =>
          this.#send("wt-include-edit", {
            path: row.path.slice(0, -1),
            memberId: node.memberId,
          }),
        )}${this.#remove(row, t("menus.remove_included"))}`;
    if (node.ref.kind === "section") {
      const detail = { sectionId: node.ref.sectionId, path: row.path };
      return html`${this.#adds(row.path, row.key)}
        <hr part="menu-divider" />
        ${this.#button(`edit-${key}`, t("action.edit"), "secondary", () =>
          this.#send("wt-member-edit", detail),
        )}${this.#button(`delete-${key}`, t("action.delete"), "danger", () =>
          this.#send("wt-member-delete", detail),
        )}`;
    }
    const productId = node.ref.productId;
    return html`${
      this.#productById.has(productId)
        ? html`<a
            data-test=${`edit-product-${key}`}
            href=${`/manage/catalogue/product/${encodeURIComponent(productId)}`}
            @click=${(event: MouseEvent) => {
              if (leftToBrowser(event)) return;
              event.preventDefault();
              this.#send("wt-edit-product", { productId });
            }}
            >${t("product.edit")}</a
          >`
        : nothing
    }${this.#remove(row, t("members.remove_from").replace("{list}", row.holder))}`;
  }

  #actionsCell(row: Row) {
    if (row.readOnly) return nothing;
    return html`<wt-row-actions
      align="end"
      data-test=${`actions-${row.key}`}
      label=${`${t("members.actions")}: ${row.name}`}
      >${this.#menuItems(row)}</wt-row-actions
    >`;
  }

  #columns(): DataTableColumn<Row>[] {
    return [
      {
        key: "name",
        label: t("members.name"),
        cell: (row) => this.#nameCell(row),
        searchValue: (row) => row.name,
      },
      {
        key: "kind",
        label: t("members.kind"),
        cell: (row) =>
          html`<span part=${row.readOnly ? "kind read-only" : "kind"} data-test="kind"
            >${memberKindLabel(row.node.ref)}</span
          >`,
      },
      {
        key: "available",
        label: t("editor.available"),
        cell: (row) => {
          if (row.node.ref.kind !== "product") return nothing;
          const product = this.#productById.get(row.node.ref.productId);
          if (product === undefined) return nothing;
          return html`<span
            part=${row.readOnly ? "available read-only" : "available"}
            data-test="available"
            >${t(product.available ? "menus.available_yes" : "menus.available_no")}</span
          >`;
        },
        filter: {
          label: t("editor.available"),
          allLabel: t("menus.filter_available_all"),
          // A section or an included menu answers no option: the table keeps it only on the way
          // to a product that matches.
          value: (row) => {
            if (row.node.ref.kind !== "product") return [];
            const product = this.#productById.get(row.node.ref.productId);
            if (product === undefined) return [];
            return product.available ? "yes" : "no";
          },
          options: [
            { value: "yes", label: t("menus.available_yes") },
            { value: "no", label: t("menus.available_no") },
          ],
        },
      },
      {
        key: "actions",
        label: t("members.actions"),
        align: "end",
        pinned: "end",
        cell: (row) => this.#actionsCell(row),
      },
    ];
  }

  override render() {
    const rows = this.#rows();
    this.#rowByKey = new Map(rows.map((row) => [row.key, row]));
    const empty = this.nodes.length === 0;
    return html`<wt-data-table
        aria-label=${t("menus.tree_heading")}
        emptyMessage=${t("menus.structure_empty")}
        noMatchesMessage=${tableNoMatches()}
        filterSearchPlaceholder=${t("categories.combobox_search")}
        filterNoResultsLabel=${t("categories.combobox_no_results")}
        filtersLabel=${t("table.filters")}
        filteredColumnLabel=${t("table.filtered_column")}
        filtersClearAllLabel=${t("table.filters_clear_all")}
        filtersCloseLabel=${t("table.filters_close")}
        searchOpensPath
        .searchTerm=${this.search}
        expandAllLabel=${t("folders.expand_all")}
        collapseAllLabel=${t("folders.collapse_all")}
        initiallyCollapsed
        .rowControls=${this.reordering ? (row: Row) => this.#grip(row) : undefined}
        rowControlsLabel=${t("folders.drag")}
        rowControlsAlign="center"
        .rowActivation=${(row: Row) => (row.node.ref.kind === "section" ? "toggle" : "none")}
        .rowToggleLabel=${(row: Row, expanded: boolean) =>
          t(expanded ? "menus.collapse" : "menus.expand").replace("{name}", row.name)}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => row.parentKey}
        .selectable=${this.selecting}
        selectAllLabel=${t("menus.select_all")}
        .selected=${this.selected}
        .rowSelectable=${(row: Row) => this.#rowSelectable(row)}
        .selectionLabel=${(row: Row) =>
          t("menus.selection_label").replace("{name}", row.name).replace("{list}", row.holder)}
        @wt-selection-change=${(event: CustomEvent<{ selected: string[] }>) => {
          event.stopPropagation();
          this.#send("wt-selection-change", { selected: event.detail.selected });
        }}
        @wt-expand-change=${this.#expandChange}
        @wt-filter-change=${this.#filterChange}
        ><slot name="toolbar-start" slot="toolbar-start"></slot
        ><slot name="toolbar-search" slot="toolbar-search"></slot>${
          empty
            ? html`<div slot="empty-action" class="empty-adds">
                ${this.#adds([], "empty", "center")}
              </div>`
            : html`<wt-row-actions
                slot="toolbar-end"
                align="end"
                icon="plus"
                data-test="toolbar-adds"
                label=${t("menus.add_to_menu")}
                >${this.#adds([], "top")}</wt-row-actions
              >`
        }<slot name="toolbar-end" slot="toolbar-end"></slot
        ><slot name="toolbar-bottom" slot="toolbar-bottom"></slot
      ></wt-data-table>
      <div role="status" aria-live="polite" class="reorder-status">${this.announcement}</div>
      ${dragGhost(this.ghost)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-structure-table": MenuStructureTable;
  }
}
