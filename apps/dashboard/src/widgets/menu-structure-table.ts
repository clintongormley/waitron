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
import { memberKindLabel, memberName } from "./member-list-editor.js";
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
import { effectiveColor } from "@waitron/catalogue/src/color-inheritance.js";
import type { CategorySummary, MenuStructureNode, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

const ROOT_KEY = "root";

const folderIcon = html`<span part="folder-frame"
  ><wt-icon name="folder" size="lg"></wt-icon
></span>`;
const gripSpace = html`<span part="grip-space" aria-hidden="true"
  ><wt-icon name="grip"></wt-icon
></span>`;
const TOP_LIST = "";

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null; path: string[] };

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

type Row = RootRow | MemberRow;

export type StructureAddAction = "new-section" | "include-menu" | "add-products";

const ADDS: { action: StructureAddAction; test: string; label: () => string }[] = [
  { action: "new-section", test: "new-section", label: () => t("menus.new_section") },
  { action: "include-menu", test: "include-menu", label: () => t("menus.include_menu") },
  { action: "add-products", test: "open-add-products", label: () => t("sections.add_products") },
];

const samePath = (next: string[], previous: string[] | undefined): boolean =>
  previous !== undefined && next.join("/") === previous.join("/");

/**
 * A menu's structure as one tree table: the menu itself, then every member in menu order, each place
 * a section is shown keyed by its own path. The widget only reports what the person asked for; the
 * host owns every write.
 */
@customElement("dashboard-menu-structure-table")
export class MenuStructureTable extends LitElement {
  static override styles = [
    baseStyles,
    treeDragStyles,
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
        margin-inline-end: var(--wt-space-3);
      }
      /* The table's arrow, the grip and the folder come before the menu's own name. */
      wt-data-table::part(tree-heading) {
        margin-inline-start: calc(3 * var(--wt-tap-min) + var(--wt-space-3));
      }
      /* Inline, not flex: the table lines a row up by its cells' first baselines, and a flex row
         would give the cell the thumbnail's bottom edge as its baseline instead of the name's. */
      wt-data-table::part(product-cell) {
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
      /* A column flex box takes its first item's baseline, so the row still lines up by the name. */
      wt-data-table::part(name-stack) {
        display: inline-flex;
        flex-direction: column;
      }
      wt-data-table::part(swatch-button),
      wt-data-table::part(swatch-box) {
        display: inline-flex;
        flex: none;
        vertical-align: middle;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
      }
      wt-data-table::part(swatch-button) {
        cursor: pointer;
      }
      wt-data-table::part(swatch-button):disabled {
        cursor: default;
        opacity: var(--wt-opacity-disabled);
      }
      wt-data-table::part(color-swatch) {
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
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
      wt-data-table::part(menu-link) {
        display: inline-flex;
        align-items: center;
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-decoration: none;
      }
      wt-data-table::part(menu-link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
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
    }
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

  #siblingRows(row: MemberRow): MemberRow[] {
    return [...this.#rowByKey.values()].filter(
      (other): other is MemberRow => other.kind === "member" && other.parentKey === row.parentKey,
    );
  }

  #siblings(row: MemberRow): string[] {
    return this.#siblingRows(row).map((other) => other.node.memberId);
  }

  #member(key: string): MemberRow | undefined {
    const row = this.#rowByKey.get(key);
    return row?.kind === "member" ? row : undefined;
  }

  #gripDown(event: PointerEvent, row: MemberRow): void {
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
      const row = this.#member(drag.key);
      if (!row) {
        this.#finishDrag();
        return;
      }
      drag.active = true;
      holdPageCursor();
      this.ghost = {
        label: row.name,
        image:
          row.node.ref.kind === "product"
            ? (this.#productById.get(row.node.ref.productId)?.image ?? null)
            : null,
        folder: row.node.ref.kind === "section",
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
    const row = this.#member(drag.key);
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

  /** A member moves only within its own list, so the row under the pointer stands for the sibling
   * whose branch holds it. Keys are compared by whole member ids: `m-fav` does not hold
   * `m-fav-drinks`. */
  #targetFor(dragged: string, over: string): string | undefined {
    const row = this.#member(dragged);
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
    const row = this.#member(dragged);
    if (this.#target === undefined || !row) return undefined;
    const keys = this.#siblingRows(row).map((sibling) => sibling.key);
    if (keys.indexOf(this.#target) < keys.indexOf(dragged))
      return { key: this.#target, side: "before" };
    return { key: lastShownRow(this.#table()!.shadowRoot!, this.#target), side: "after" };
  }

  #move(row: MemberRow, to: number): void {
    const siblings = this.#siblings(row);
    this.#order.set(row.list, reorder(siblings, siblings.indexOf(row.node.memberId), to));
    this.#send("wt-member-move", {
      path: row.path.slice(0, -1),
      memberId: row.node.memberId,
      to,
    });
    this.requestUpdate();
  }

  #gripKey(event: KeyboardEvent, row: MemberRow): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0 || this.busy) return;
    // Without this the arrow scrolls the page, carrying the row out from under the grip.
    event.preventDefault();
    const siblings = this.#siblings(row);
    const to = siblings.indexOf(row.node.memberId) + delta;
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

  /** Focuses the row's ⋮, or the nearest ancestor's when the row is not drawn. */
  focusRowMenu(key: string): void {
    const root = this.#table()?.shadowRoot;
    if (!root) return;
    const segments = key === ROOT_KEY ? [] : key.split("/");
    for (let depth = segments.length; depth >= 0; depth--) {
      const candidate = depth === 0 ? ROOT_KEY : segments.slice(0, depth).join("/");
      const menu = root.querySelector<HTMLElement>(
        `tr[data-row-key="${CSS.escape(candidate)}"] wt-row-actions`,
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

  #rows(): Row[] {
    const rows: Row[] = [{ kind: "root", key: ROOT_KEY, parentKey: null, path: [] }];
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

  #ordered(nodes: MenuStructureNode[], list: string): MenuStructureNode[] {
    const order = this.#order.get(list);
    if (!order) return nodes;
    return order.flatMap((memberId) => nodes.filter((node) => node.memberId === memberId));
  }

  #isCurrent(row: Row): boolean {
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
      >${row.kind === "root" ? this.#rootName() : row.name}</span
    >`;
  }

  #nameCell(row: Row) {
    if (row.kind === "root")
      return html`<span part="folder-cell"
        >${gripSpace}${folderIcon}<span part="name-stack"
          >${this.#nameSpan(row)}${
            this.nodes.length === 0
              ? html`<span part="note" data-test="empty">${t("menus.structure_empty")}</span>`
              : nothing
          }</span
        ></span
      >`;
    const { node, key, name } = row;
    const grip = row.readOnly
      ? gripSpace
      : html`<button
          part="drag-grip"
          type="button"
          data-test=${`drag-${key}`}
          aria-label=${`${t("members.reorder")}: ${name}`}
          ?disabled=${this.busy}
          @keydown=${(event: KeyboardEvent) => this.#gripKey(event, row)}
          @pointerdown=${(event: PointerEvent) => this.#gripDown(event, row)}
        >
          <wt-icon name="grip"></wt-icon>
        </button>`;
    const stack = html`<span part="name-stack"
      >${this.#nameSpan(row)}${
        node.includedMenuId && !row.readOnly
          ? html`<span part="note" data-test=${`read-only-${key}`}
              >${t("menus.read_only_here")}</span
            >`
          : nothing
      }</span
    >`;
    if (node.ref.kind === "section")
      return html`<span part="folder-cell">${grip}${folderIcon}${stack}${this.#swatch(row)}</span>`;
    const image = this.#productById.get(node.ref.productId)?.image ?? null;
    return html`<span part="product-cell"
      >${grip}${
        image === null
          ? html`<span
              part="thumb-placeholder"
              data-test="thumb-placeholder"
              aria-hidden="true"
            ></span>`
          : html`<span part="thumb-frame" data-test="thumb"
              ><img part="thumbnail" src=${`/media/${image}`} alt="" draggable="false"
            /></span>`
      }${stack}${this.#swatch(row)}</span
    >`;
  }

  /** After the name, so names at one depth still start on one line. */
  #swatch(row: MemberRow) {
    const { node, key, name } = row;
    let color: string | null;
    let send: () => void;
    let editable: boolean;
    if (node.ref.kind === "section") {
      const detail = { sectionId: node.ref.sectionId, path: row.path };
      color = node.color ?? null;
      send = () => this.#send("wt-member-edit", detail);
      editable = this.#ownedSection(row);
    } else {
      const productId = node.ref.productId;
      const product = this.#productById.get(productId);
      color = effectiveColor(
        product?.color ?? null,
        product?.categoryId ?? null,
        this.#categoryById,
      );
      send = () => this.#send("wt-product-color", { productId });
      editable = !row.readOnly;
    }
    const chip = html`<span
      part=${color ? "color-swatch" : "color-swatch empty"}
      style=${color ? `background:${color}` : nothing}
    ></span>`;
    if (!editable)
      return html`<span part="swatch-box" data-test=${`color-${key}`} aria-hidden="true"
        >${chip}</span
      >`;
    return html`<button
      part="swatch-button"
      type="button"
      data-test=${`color-${key}`}
      aria-label=${t("folders.edit_color").replace("{name}", name)}
      ?disabled=${this.busy}
      @click=${send}
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
          part="menu-link"
          data-test=${`source-${key}`}
          href=${`/manage/menus/menu/${node.includedMenuId}/view/structure`}
          >${t("menus.edit_included").replace(
            "{name}",
            memberName(node.ref, this.#productNames, this.#sectionNames),
          )}</a
        >${this.#remove(row, t("menus.remove_included"))}`;
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

  #actionsCell(row: Row) {
    if (row.kind === "member" && row.readOnly) return nothing;
    const name = row.kind === "root" ? this.#rootName() : row.name;
    return html`<wt-row-actions
      align="end"
      data-test=${`actions-${row.key}`}
      label=${`${t("members.actions")}: ${name}`}
      >${row.kind === "root" ? this.#adds(row) : this.#menuItems(row)}</wt-row-actions
    >`;
  }

  #columns(): DataTableColumn<Row>[] {
    return [
      { key: "name", label: t("members.name"), cell: (row) => this.#nameCell(row) },
      {
        key: "kind",
        label: t("members.kind"),
        cell: (row) =>
          row.kind === "root"
            ? nothing
            : html`<span part=${row.readOnly ? "kind read-only" : "kind"} data-test="kind"
                >${memberKindLabel(row.node.ref)}</span
              >`,
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
        .rowCollapsible=${(row: Row) => row.kind !== "root"}
        .rowActivation=${(row: Row) =>
          row.kind === "member" && row.node.ref.kind === "section" ? "toggle" : "none"}
        .rowToggleLabel=${(row: Row, expanded: boolean) =>
          t(expanded ? "menus.collapse" : "menus.expand").replace(
            "{name}",
            row.kind === "root" ? this.#rootName() : row.name,
          )}
        .rows=${rows}
        .columns=${this.#columns()}
        .rowKey=${(row: Row) => row.key}
        .rowParent=${(row: Row) => row.parentKey}
        @wt-expand-change=${this.#expandChange}
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
