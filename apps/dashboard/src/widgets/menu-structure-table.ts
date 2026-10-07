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
import { categoryColor } from "@waitron/catalogue/src/color-inheritance.js";
import {
  FOLLOWING_FOLDER,
  folderPresentation,
} from "@waitron/catalogue/src/include-folder-presentation.js";
import type { Presentation } from "@waitron/catalogue/src/section-types.js";
import type {
  CategorySummary,
  HomeTile,
  MenuHome,
  MenuStructureNode,
  Product,
} from "../api/client.js";
import { t } from "../i18n/t.js";

export const ROOT_KEY = "root";
/** The Device Home Page row's key, and the list key its shortcuts' order is kept under. */
export const HOME_KEY = "home";

/** A section node's own customer-facing presentation, before any include's folder applies. */
export function ownPresentation(node: MenuStructureNode): Presentation {
  return { names: node.names ?? {}, image: node.image ?? null, color: node.color ?? null };
}

/** A section's swatch slot, at a product photo's width; blank on the menu's and home's rows. */
const folderFrame = (content: unknown = nothing) =>
  html`<span part="folder-frame">${content}</span>`;
const gripSpace = html`<span part="grip-space" aria-hidden="true"
  ><wt-icon name="grip"></wt-icon
></span>`;
const TOP_LIST = "";

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null; path: string[] };
type HomeRow = { kind: "home"; key: typeof HOME_KEY; parentKey: null; path: [] };

interface MemberRow {
  kind: "member";
  /** The member ids from the menu's top level to this member, joined with `/`. */
  key: string;
  parentKey: string;
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

interface ShortcutRow {
  kind: "shortcut";
  /** `home/` and the shortcut's member id. */
  key: string;
  parentKey: typeof HOME_KEY;
  path: [];
  tile: HomeTile;
  name: string;
}

type MovableRow = MemberRow | ShortcutRow;

type Row = HomeRow | RootRow | MemberRow | ShortcutRow;

const SHORTCUT_ADDS = [
  { kind: "product", label: () => t("home.add_product") },
  { kind: "section", label: () => t("home.add_section") },
] as const;

export type StructureAddAction = "new-section" | "include-menu" | "add-products";

const ADDS: { action: StructureAddAction; test: string; label: () => string }[] = [
  { action: "new-section", test: "new-section", label: () => t("menus.new_section") },
  { action: "include-menu", test: "include-menu", label: () => t("menus.include_menu") },
  { action: "add-products", test: "open-add-products", label: () => t("sections.add_products") },
];

const samePath = (next: string[], previous: string[] | undefined): boolean =>
  previous !== undefined && next.join("/") === previous.join("/");

/**
 * A menu's structure as one tree table: the Device Home Page with its shortcuts, then the menu
 * itself and every member in menu order, each place a section is shown keyed by its own path. The
 * widget only reports what the person asked for; the host owns every write.
 */
@customElement("dashboard-menu-structure-table")
export class MenuStructureTable extends LitElement {
  static override styles = [
    baseStyles,
    treeDragStyles,
    swatchPartStyles,
    css`
      :host {
        display: block;
      }
      /* Cell templates are rendered in wt-data-table's shadow root, so ::part is the one boundary
         crossing used for their presentation. */
      wt-data-table::part(folder-cell) {
        display: flex;
        align-items: center;
      }
      /* As wide as a product's photo, so a section's name starts where a product's does. */
      wt-data-table::part(folder-frame) {
        display: inline-flex;
        flex: none;
        justify-content: center;
        width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        align-items: center;
        margin-inline-end: var(--wt-space-3);
      }
      wt-data-table::part(tree-heading) {
        margin-inline-start: calc(var(--tree-arrow-width) + var(--wt-tap-min) + var(--wt-space-3));
      }
      /* Keep wrapped names on their first-line baseline beside the media slot. */
      wt-data-table::part(product-cell) {
        display: block;
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
      wt-data-table[narrow]::part(swatch-button),
      wt-data-table[narrow]::part(swatch-box),
      wt-data-table[narrow]::part(folder-frame),
      wt-data-table[narrow]::part(thumb-frame),
      wt-data-table[narrow]::part(thumb-placeholder) {
        display: none;
      }
      wt-data-table::part(thumbnail) {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      /* A column flex box takes its first item's baseline, so the row still lines up by the name. */
      wt-data-table::part(name-stack) {
        display: inline-flex;
        flex-direction: column;
      }
      /* A flex row takes its first item's baseline unless an item aligns by baseline, so without
         this the row lines up by the grip's or the swatch slot's baseline, not the name's. As tall as
         the slot and centred in it, the stack still sits level with the slot. */
      wt-data-table::part(folder-stack) {
        align-self: baseline;
        justify-content: center;
        min-height: var(--wt-tap-min);
      }
      wt-data-table::part(current) {
        font-weight: var(--wt-font-weight-bold);
        text-decoration: underline;
      }
      wt-data-table::part(read-only),
      wt-data-table::part(kind) {
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
  /** Where a product without its own colour takes one from. */
  @property({ attribute: false }) categories: CategorySummary[] = [];
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
  /** Null draws no Device Home Page row. */
  @property({ attribute: false }) home: MenuHome | null = null;

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
  @state() private announcement = "";
  #drag: { pointerId: number; key: string; x: number; y: number; active: boolean } | null = null;
  /** The sibling's key a release would move the dragged member to, while one is offered. */
  #target: string | undefined = undefined;
  #pointer = { x: 0, y: 0 };
  @state() private ghost: DragGhost | null = null;

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
      const shortcuts = this.#order.get(HOME_KEY);
      this.#order = new Map(shortcuts ? [[HOME_KEY, shortcuts]] : []);
    }
    if (changed.has("home")) this.#order.delete(HOME_KEY);
    if (changed.has("current")) this.#lostReported = false;
  }

  protected override firstUpdated(): void {
    // Collapse all closes branches without telling anyone, so the table's own updates are watched.
    this.#table()!.addController({
      hostUpdated: () => {
        this.#checkCurrentShown();
        this.#restoreFocus();
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
    if (row?.kind !== "member" || !this.#ownedSection(row)) return;
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

  /** A shortcut's siblings are the other shortcuts: no member's parent is the home row. */
  #siblingRows(row: MovableRow): MovableRow[] {
    return [...this.#rowByKey.values()].filter(
      (other): other is MovableRow =>
        (other.kind === "member" || other.kind === "shortcut") && other.parentKey === row.parentKey,
    );
  }

  #memberId(row: MovableRow): string {
    return row.kind === "member" ? row.node.memberId : row.tile.memberId;
  }

  #siblings(row: MovableRow): string[] {
    return this.#siblingRows(row).map((other) => this.#memberId(other));
  }

  #movable(key: string): MovableRow | undefined {
    const row = this.#rowByKey.get(key);
    return row?.kind === "member" || row?.kind === "shortcut" ? row : undefined;
  }

  #gripDown(event: PointerEvent, row: MovableRow): void {
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
      // A shortcut's row draws its name alone, and so does its ghost.
      const ref = row.kind === "member" ? row.node.ref : null;
      this.ghost = {
        label: row.name,
        image:
          ref?.kind === "product" ? (this.#productById.get(ref.productId)?.image ?? null) : null,
        folder: ref?.kind === "section",
      };
      void this.updateComplete.then(() => placeDragGhost(this.renderRoot, this.#pointer));
    }
    placeDragGhost(this.renderRoot, this.#pointer);
    const over = pointerElementsAt(event.clientX, event.clientY).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches("tr[data-row-key]"),
    )?.dataset.rowKey;
    const target = over === undefined ? undefined : this.#targetFor(drag.key, over);
    if (!starting && target === this.#target) return;
    this.#target = target;
    this.#paint();
  };

  readonly #endDrag = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const target = this.#target;
    this.#finishDrag();
    if (!drag.active || event.type !== "pointerup") return;
    blockClickAfterDrag(false);
    const row = this.#movable(drag.key);
    if (row === undefined || this.busy) return;
    const to = this.#siblingRows(row).findIndex((sibling) => sibling.key === target);
    if (to >= 0) this.#move(row, to);
  };

  readonly #dragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#drag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.#finishDrag();
    blockClickAfterDrag(true);
  };

  #finishDrag(): void {
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

  /** A member or shortcut moves only within its own list, so the row under the pointer stands for
   * the sibling whose branch holds it. Keys are compared by whole member ids: `m-fav` does not hold
   * `m-fav-drinks`. */
  #targetFor(dragged: string, over: string): string | undefined {
    const row = this.#movable(dragged);
    if (!row) return undefined;
    const target = this.#siblingRows(row).find(
      (sibling) => over === sibling.key || over.startsWith(`${sibling.key}/`),
    );
    return target === undefined || target.key === dragged ? undefined : target.key;
  }

  #paint(): void {
    const root = this.#table()!.shadowRoot!;
    clearDragMarks(root);
    const drag = this.#drag;
    if (!drag?.active) return;
    markDragging(shownRow(root, drag.key));
    const gap = this.#gap(drag.key);
    if (gap) markGap(root, gap);
  }

  #gap(dragged: string): DropGap | undefined {
    const row = this.#movable(dragged);
    if (this.#target === undefined || !row) return undefined;
    const keys = this.#siblingRows(row).map((sibling) => sibling.key);
    if (keys.indexOf(this.#target) < keys.indexOf(dragged))
      return { key: this.#target, side: "before" };
    return { key: lastShownRow(this.#table()!.shadowRoot!, this.#target), side: "after" };
  }

  #move(row: MovableRow, to: number): void {
    const siblings = this.#siblings(row);
    const memberId = this.#memberId(row);
    const order = reorder(siblings, siblings.indexOf(memberId), to);
    if (row.kind === "shortcut") {
      this.#order.set(HOME_KEY, order);
      this.#send("wt-shortcut-move", { memberId, to });
    } else {
      this.#order.set(row.list, order);
      this.#send("wt-member-move", { path: row.path.slice(0, -1), memberId, to });
    }
    this.requestUpdate();
  }

  #gripKey(event: KeyboardEvent, row: MovableRow): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0 || this.busy) return;
    // Without this the arrow scrolls the page, carrying the row out from under the grip.
    event.preventDefault();
    const siblings = this.#siblings(row);
    const to = siblings.indexOf(this.#memberId(row)) + delta;
    if (to < 0 || to >= siblings.length) return;
    this.#move(row, to);
    this.#refocus = row.key;
    this.announcement = t("action.reordered")
      .replace("{item}", row.name)
      .replace("{index}", String(to + 1))
      .replace("{total}", String(siblings.length));
  }

  #ownedSection(row: MemberRow): boolean {
    return row.node.ref.kind === "section" && !row.readOnly && !row.node.includedMenuId;
  }

  #table(): WtDataTable<Row> | null {
    return this.shadowRoot?.querySelector<WtDataTable<Row>>("wt-data-table") ?? null;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** Opens or closes the row `key` once the rows last given are drawn, without reporting it as a
   * person's change. */
  async setExpanded(key: string, expanded: boolean): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    await table?.updateComplete;
    table?.setExpanded(key, expanded);
  }

  /** Focuses the row's ⋮, or the nearest ancestor's when the row is not drawn. */
  focusRowMenu(key: string): void {
    const root = this.#table()?.shadowRoot;
    if (!root) return;
    const segments = key === ROOT_KEY ? [] : key.split("/");
    for (let depth = segments.length; depth >= 0; depth--) {
      const candidate = depth === 0 ? ROOT_KEY : segments.slice(0, depth).join("/");
      const menu = root.querySelector<HTMLElement>(
        `tr[data-row-key="${CSS.escape(candidate)}"] wt-row-actions[data-test^="actions-"]`,
      );
      if (menu) {
        menu.focus();
        return;
      }
    }
  }

  #rootName(): string {
    return t("menus.menu_prefix").replace("{name}", this.menuName);
  }

  #label(row: Row): string {
    if (row.kind === "root") return this.#rootName();
    return row.kind === "home" ? t("home.row") : row.name;
  }

  #rows(): Row[] {
    const rows: Row[] = [];
    if (this.home !== null) {
      rows.push({ kind: "home", key: HOME_KEY, parentKey: null, path: [] });
      for (const tile of this.#ordered(this.home.shortcuts, HOME_KEY))
        rows.push({
          kind: "shortcut",
          key: `${HOME_KEY}/${tile.memberId}`,
          parentKey: HOME_KEY,
          path: [],
          tile,
          name: tile.reachable
            ? tile.name
            : t("home.missing").replace("{name}", tile.missingName ?? tile.name),
        });
    }
    rows.push({ kind: "root", key: ROOT_KEY, parentKey: null, path: [] });
    const walk = (
      nodes: MenuStructureNode[],
      parentPath: string[],
      parentKey: string,
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
        rows.push({ kind: "member", key, parentKey, path, node, name, holder, list, readOnly });
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
    walk(this.nodes, [], ROOT_KEY, this.menuName, TOP_LIST, false);
    return rows;
  }

  #ordered<T extends { memberId: string }>(items: T[], list: string): T[] {
    const order = this.#order.get(list);
    if (!order) return items;
    return order.flatMap((memberId) => items.filter((item) => item.memberId === memberId));
  }

  /** The Device Home Page is no place in the menu, so neither it nor a shortcut is ever current. */
  #isCurrent(row: Row): boolean {
    if (row.kind === "home" || row.kind === "shortcut") return false;
    return row.path.join("/") === this.current.join("/");
  }

  #nameSpan(row: Row) {
    const parts = ["name"];
    if (this.#isCurrent(row)) parts.push("current");
    if (row.kind === "member" && row.readOnly) parts.push("read-only");
    return html`<span
      part=${parts.join(" ")}
      data-test=${row.kind === "root" ? "root-name" : "name"}
      aria-current=${this.#isCurrent(row) ? "true" : nothing}
      >${this.#label(row)}</span
    >`;
  }

  #grip(row: MovableRow) {
    if (!this.reordering) return nothing;
    if (row.kind === "member" && row.readOnly) return gripSpace;
    return html`<button
      part="drag-grip"
      type="button"
      data-test=${`drag-${row.key}`}
      aria-label=${`${t("members.reorder")}: ${row.name}`}
      ?disabled=${this.busy}
      @keydown=${(event: KeyboardEvent) => this.#gripKey(event, row)}
      @pointerdown=${(event: PointerEvent) => this.#gripDown(event, row)}
    >
      <wt-icon name="grip"></wt-icon>
    </button>`;
  }

  /** The Device Home Page's and the menu's rows: no grip, a blank slot, and a note when empty. */
  #topCell(row: HomeRow | RootRow, empty: string | null, emptyTest: string) {
    return html`<span part="folder-cell"
      >${folderFrame()}<span part="name-stack folder-stack"
        >${this.#nameSpan(row)}${
          empty === null ? nothing : html`<span part="note" data-test=${emptyTest}>${empty}</span>`
        }</span
      ></span
    >`;
  }

  #nameCell(row: Row) {
    if (row.kind === "root")
      return this.#topCell(
        row,
        this.nodes.length === 0 ? t("menus.structure_empty") : null,
        "empty",
      );
    if (row.kind === "home")
      return this.#topCell(
        row,
        this.home?.shortcuts.length === 0 ? t("home.empty") : null,
        "home-empty",
      );
    if (row.kind === "shortcut")
      return html`<span part="product-cell"
        ><span part="name-stack">${this.#nameSpan(row)}</span></span
      >`;
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
    if (node.ref.kind === "section")
      return html`<span part="folder-cell">${folderFrame(this.#swatch(row))}${stack}</span>`;
    return html`<span part="product-cell">${this.#swatch(row)}${stack}</span>`;
  }

  #swatch(row: MemberRow) {
    const { node, key, name } = row;
    if (node.ref.kind === "product") {
      const productId = node.ref.productId;
      const product = this.#productById.get(productId);
      return productMedia({
        key,
        productId,
        name,
        image: product?.image ?? null,
        color: product?.color ?? categoryColor(product?.categoryId ?? null, this.#categoryById),
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

  #button(test: string, label: string, variant: "secondary" | "danger", act: () => void) {
    return html`<wt-button
      align="start"
      variant=${variant}
      data-test=${test}
      .disabled=${this.busy}
      @click=${() => {
        if (!this.busy) act();
      }}
      >${label}</wt-button
    >`;
  }

  #adds(row: Row) {
    return ADDS.map(({ action, test, label }) =>
      this.#button(`${test}-${row.key}`, label(), "secondary", () =>
        this.#send("wt-structure-add", { action, path: row.path }),
      ),
    );
  }

  #remove(row: MemberRow, label: string) {
    return this.#button(`remove-${row.key}`, label, "secondary", () =>
      this.#send("wt-member-remove", {
        path: row.path.slice(0, -1),
        memberId: row.node.memberId,
      }),
    );
  }

  #menuItems(row: MemberRow) {
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
      return html`${this.#adds(row)}
        <hr part="menu-divider" />
        ${this.#button(`edit-${key}`, t("action.edit"), "secondary", () =>
          this.#send("wt-member-edit", detail),
        )}${this.#button(`delete-${key}`, t("action.delete"), "danger", () =>
          this.#send("wt-member-delete", detail),
        )}`;
    }
    return this.#remove(row, t("members.remove_from").replace("{list}", row.holder));
  }

  #shortcutItems(row: HomeRow | ShortcutRow) {
    if (row.kind === "shortcut")
      return this.#button(`remove-${row.key}`, t("home.remove"), "secondary", () =>
        this.#send("wt-shortcut-remove", { memberId: row.tile.memberId }),
      );
    return SHORTCUT_ADDS.map(({ kind, label }) =>
      this.#button(`add-${kind}-shortcut-${row.key}`, label(), "secondary", () =>
        this.#send("wt-shortcut-add", { kind }),
      ),
    );
  }

  #actionsCell(row: Row) {
    if (row.kind === "member" && row.readOnly) return nothing;
    return html`<wt-row-actions
      align="end"
      data-test=${`actions-${row.key}`}
      label=${`${t("members.actions")}: ${this.#label(row)}`}
      >${
        row.kind === "root"
          ? this.#adds(row)
          : row.kind === "member"
            ? this.#menuItems(row)
            : this.#shortcutItems(row)
      }</wt-row-actions
    >`;
  }

  #columns(): DataTableColumn<Row>[] {
    return [
      { key: "name", label: t("members.name"), cell: (row) => this.#nameCell(row) },
      {
        key: "kind",
        label: t("members.kind"),
        cell: (row) => {
          if (row.kind === "root" || row.kind === "home") return nothing;
          if (row.kind === "shortcut")
            return html`<span part="kind" data-test="kind"
              >${memberKindLabel(row.tile.reachable ? row.tile.ref : { kind: "missing", name: "" })}</span
            >`;
          return html`<span part=${row.readOnly ? "kind read-only" : "kind"} data-test="kind"
            >${memberKindLabel(row.node.ref)}</span
          >`;
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
    return html`<wt-data-table
        aria-label=${t("menus.tree_heading")}
        noMatchesMessage=${tableNoMatches()}
        expandAllLabel=${t("folders.expand_all")}
        collapseAllLabel=${t("folders.collapse_all")}
        initiallyCollapsed
        .rowControls=${this.reordering ? (row: Row) => (row.kind === "member" || row.kind === "shortcut" ? this.#grip(row) : gripSpace) : undefined}
        rowControlsLabel=${t("folders.drag")}
        rowControlsAlign="center"
        .rowCollapsible=${(row: Row) => row.kind !== "root"}
        .rowActivation=${(row: Row) =>
          row.kind === "home" || (row.kind === "member" && row.node.ref.kind === "section")
            ? "toggle"
            : "none"}
        .rowToggleLabel=${(row: Row, expanded: boolean) =>
          t(expanded ? "menus.collapse" : "menus.expand").replace("{name}", this.#label(row))}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => row.parentKey}
        @wt-expand-change=${this.#expandChange}
        ><slot name="toolbar-start" slot="toolbar-start"></slot
        ><slot name="toolbar-end" slot="toolbar-end"></slot
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
