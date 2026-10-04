import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, type DataTableColumn, type WtDataTable } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { memberKindLabel, memberName } from "./member-list-editor.js";
import type { MenuStructureNode, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

const ROOT_KEY = "root";

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
    css`
      :host {
        display: block;
      }
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
    `,
  ];

  @property({ attribute: false }) nodes: MenuStructureNode[] = [];
  /** Where members' staff names and images come from. */
  @property({ attribute: false }) products: Product[] = [];
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
  #sectionNames = new Map<string, string>();
  /** While the way to the current section is being opened, a closed row on it is not the person's. */
  #revealing = 0;
  /** Set once the current section was reported hidden, until the host names another. */
  #lostReported = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("products")) {
      this.#productById = new Map(this.products.map((product) => [product.id, product]));
      this.#productNames = new Map(this.products.map(({ id, name }) => [id, name]));
    }
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
    }
    if (changed.has("current")) this.#lostReported = false;
  }

  protected override firstUpdated(): void {
    // Collapse all closes branches without telling anyone, so the table's own updates are watched.
    this.#table()!.addController({ hostUpdated: () => this.#checkCurrentShown() });
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
      readOnly: boolean,
    ) => {
      for (const node of nodes) {
        const path = [...parentPath, node.memberId];
        const key = path.join("/");
        const staffName = memberName(node.ref, this.#productNames, this.#sectionNames);
        const name = node.includedMenuId
          ? t("menus.menu_prefix").replace("{name}", staffName)
          : staffName;
        rows.push({ kind: "member", key, parentKey, path, node, name, holder, readOnly });
        walk(node.children ?? [], path, key, staffName, readOnly || Boolean(node.includedMenuId));
      }
    };
    walk(this.nodes, [], ROOT_KEY, this.menuName, false);
    return rows;
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
        ><wt-icon name="folder" size="lg"></wt-icon
        ><span part="name-stack"
          >${this.#nameSpan(row)}${
            this.nodes.length === 0
              ? html`<span part="note" data-test="empty">${t("menus.structure_empty")}</span>`
              : nothing
          }</span
        ></span
      >`;
    const { node, key, name } = row;
    const grip = row.readOnly
      ? html`<span part="grip-space" aria-hidden="true"><wt-icon name="grip"></wt-icon></span>`
      : html`<button
          part="drag-grip"
          type="button"
          data-test=${`drag-${key}`}
          aria-label=${`${t("members.reorder")}: ${name}`}
          ?disabled=${this.busy}
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
      return html`<span part="folder-cell"
        >${grip}<wt-icon name="folder" size="lg"></wt-icon>${stack}</span
      >`;
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
      }${stack}</span
    >`;
  }

  #button(test: string, label: string, variant: "secondary" | "danger", act: () => void) {
    return html`<wt-button
      align="start"
      variant=${variant}
      data-test=${test}
      .disabled=${this.busy}
      @click=${(event: Event) => {
        event.stopPropagation();
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
    ></wt-data-table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-structure-table": MenuStructureTable;
  }
}
