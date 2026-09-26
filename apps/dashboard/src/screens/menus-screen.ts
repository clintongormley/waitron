import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import {
  baseStyles,
  setContentLanguages,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import {
  memberName,
  sectionParents,
  sectionsHolding,
  type SectionParents,
} from "../widgets/member-list-editor.js";
import "../widgets/menu-structure-tree.js";
import "../widgets/section-add-products.js";
import "../widgets/menu-prices-table.js";
import type { OfferSave } from "../widgets/menu-prices-table.js";
import { publishFailure, statusWords, type PublishResult } from "../widgets/menu-preview.js";
import { textField } from "../widgets/form-fields.js";
import { fieldOf, ListWriteQueue } from "../widgets/section-writes.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  LibrarySection,
  MemberRef,
  MenuPreview,
  MenuPriceRow,
  MenuStatus,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
  SectionUsages,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

const TABS = ["structure", "prices", "preview"] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

/** A list being edited, by section id, with the name it was shown under and the menu and path
 * it was reached by. */
interface ListTarget {
  menuId: string;
  path: string[];
  listId: string;
  name: string;
}

const NO_USAGES: SectionUsages = { menus: [], sections: [] };
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** A menu on the list with its publication state, or where that state's read stands. */
interface MenuRow extends CatalogueSummary {
  status: MenuStatus | "loading" | "failed";
}

/** Sorted by status, the menus needing a publish come first. */
const STATUS_ORDER = ["unpublished", "changed", "current", "loading", "failed"];

/** The state in one line, for the editor's heading. */
function statusLine(status: MenuStatus) {
  const { label, live } = statusWords(status);
  return live === null
    ? label
    : html`${label} · ${live.version} · <span class="time">${live.time}</span>`;
}

/** The state a publish answered as version `number` left, shown until the next read replaces it.
 * The answer carries no publication time, so a new version shows this browser's clock. */
function publishedStatus(number: number, hash: string, before: MenuStatus | null): MenuStatus {
  const publishedAt =
    before !== null && before.state !== "unpublished" && before.version === number
      ? before.publishedAt
      : new Date().toISOString();
  return { state: "current", version: number, publishedAt, hash };
}

function refusal(error: unknown): Record<string, string> {
  return { [fieldOf(error)]: codeMessage(codeOf(error)) };
}

function reachableProducts(nodes: MenuStructureNode[]): string[] {
  const found = new Set<string>();
  const walk = (list: MenuStructureNode[]): void => {
    for (const node of list)
      if (node.ref.kind === "product") found.add(node.ref.productId);
      else walk(node.children ?? []);
  };
  walk(nodes);
  return [...found];
}

/** The section nodes `path` follows from the menu's top level, as far as the structure still has it. */
function trailOf(structure: MenuStructure | null, path: readonly string[]): MenuStructureNode[] {
  const trail: MenuStructureNode[] = [];
  let nodes = structure?.nodes ?? [];
  for (const memberId of path) {
    const node = nodes.find((candidate) => candidate.memberId === memberId);
    if (node?.ref.kind !== "section") break;
    trail.push(node);
    nodes = node.children ?? [];
  }
  return trail;
}

function listIdOf(structure: MenuStructure | null, trail: MenuStructureNode[]): string | null {
  const last = trail.at(-1);
  return last?.ref.kind === "section" ? last.ref.sectionId : (structure?.rootSectionId ?? null);
}

function sameOrder(order: readonly string[], nodes: readonly MenuStructureNode[]): boolean {
  return (
    order.length === nodes.length && nodes.every(({ memberId }, index) => memberId === order[index])
  );
}

/** Every place `listId` appears in the structure, as that place's nodes. */
function placesOf(structure: MenuStructure | null, listId: string): MenuStructureNode[][] {
  if (structure === null) return [];
  const found: MenuStructureNode[][] = listId === structure.rootSectionId ? [structure.nodes] : [];
  const walk = (nodes: MenuStructureNode[]): void => {
    for (const node of nodes) {
      if (node.ref.kind !== "section" || node.children === undefined) continue;
      if (node.ref.sectionId === listId) found.push(node.children);
      walk(node.children);
    }
  };
  walk(structure.nodes);
  return found;
}

/**
 * The structure's nodes with every place `listId` appears in `ordered`'s order, or null when a
 * place's members are not exactly the ones `ordered` names, or a place's order is none of
 * `accepted`, which only a fresh read can resolve.
 */
function withOrder(
  structure: MenuStructure,
  listId: string,
  ordered: readonly SectionMember[],
  accepted: readonly (readonly string[])[],
): MenuStructureNode[] | null {
  let mismatch = false;
  const arrange = (nodes: MenuStructureNode[]): MenuStructureNode[] => {
    const byId = new Map(nodes.map((node) => [node.memberId, node]));
    if (
      byId.size !== ordered.length ||
      ordered.some(({ id }) => !byId.has(id)) ||
      !accepted.some((order) => sameOrder(order, nodes))
    ) {
      mismatch = true;
      return nodes;
    }
    return ordered.map(({ id }) => byId.get(id)!);
  };
  const walk = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
    nodes.map((node) => {
      if (node.ref.kind !== "section" || node.children === undefined) return node;
      const children = walk(node.children);
      return { ...node, children: node.ref.sectionId === listId ? arrange(children) : children };
    });
  const nodes = walk(structure.nodes);
  const result = listId === structure.rootSectionId ? arrange(nodes) : nodes;
  return mismatch ? null : result;
}

/**
 * The menus, and one menu's editor. Its Structure tab edits one list at a time, the menu's own top
 * level or a section reached from it, and each change to that list is its own request, sent in
 * order through one queue, because a move leaves the list's focus on the row. Its Prices tab lists
 * each product the menu reaches and edits what the menu charges for it.
 */
@customElement("dashboard-menus-screen")
export class MenusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-xl);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .page-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--wt-space-4);
      }
      .back {
        margin-bottom: var(--wt-space-3);
      }
      .structure {
        display: grid;
        gap: var(--wt-space-6);
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-tap-min) * 7)), 1fr)
        );
        align-items: start;
      }
      .panel,
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .breadcrumb ol {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .breadcrumb li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        overflow-wrap: anywhere;
      }
      .breadcrumb [aria-current] {
        font-weight: var(--wt-font-weight-bold);
        padding-inline: var(--wt-space-2);
      }
      .sep,
      .note,
      .help {
        color: var(--wt-color-text-muted);
      }
      .note,
      .help,
      .error {
        margin: 0;
      }
      .help {
        font-size: var(--wt-font-size-sm);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .prices {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-3);
      }
      .list-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
        text-align: start;
      }
      wt-data-table::part(note),
      wt-data-table::part(muted),
      .status-line {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(note) {
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      .status-line {
        margin: calc(var(--wt-space-3) * -1) 0 var(--wt-space-4);
      }
      .status-line .time {
        white-space: nowrap;
      }
      .list {
        container-type: inline-size;
      }
      .narrow-probe {
        display: none;
      }
      @container (max-width: 30rem) {
        .narrow-probe {
          display: block;
        }
      }
      wt-data-table::part(time) {
        white-space: nowrap;
      }
      wt-data-table::part(name-text) {
        text-align: start;
      }
      wt-data-table::part(stacked) {
        display: block;
        padding-inline: var(--wt-space-4);
      }
      /* The name and its status take the list's width less room for the row menu's column, and
         wrap inside it: the table itself never narrows a column below its content. */
      wt-data-table.narrow::part(name),
      wt-data-table.narrow::part(stacked) {
        max-width: calc(100cqi - 3 * var(--wt-tap-min));
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private menus: CatalogueSummary[] = [];
  @state() private sections: LibrarySection[] = [];
  @state() private products: Product[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private loading = true;
  @state() private loadError = false;

  /** The menu being edited; null on the list. */
  @state() private menuId: string | null = null;
  @state() private structure: MenuStructure | null = null;
  @state() private structureError = false;
  /** The member ids followed from the menu's top level to the list being edited. */
  @state() private path: string[] = [];
  /** Every section's wider use, by section id; null until first read. */
  @state() private usages: Record<string, SectionUsages> | null = null;
  @state() private usagesError = false;
  @state() private busy = false;
  @state() private memberError: string | null = null;
  @state() private view: Tab = TABS[0];

  /** Null until the open menu's prices are first read. */
  @state() private prices: MenuPriceRow[] | null = null;
  @state() private pricesError = false;
  @state() private editingOffer: string | null = null;
  @state() private savingOffer = false;
  @state() private offerRefusal: { field: string; message: string } | null = null;

  /** Every menu's publication state, followed while the list is shown; null until read. */
  @state() private statuses: Record<string, MenuStatus> | null = null;
  @state() private statusesError = false;
  /** The open menu's publication state, followed while its editor is shown: on the Preview tab
   * through the preview, which carries it. Null until read. */
  @state() private status: MenuStatus | null = null;
  @state() private statusError = false;
  /** Null until the open menu's preview is read, which happens only on the Preview tab. */
  @state() private preview: MenuPreview | null = null;
  @state() private previewError = false;
  /** The menus whose publish is out. Replaced, never mutated, so a change re-renders. */
  @state() private publishing: ReadonlySet<string> = new Set();
  /** The list is 30rem wide or less (the probe's container query), so each status sits under its
   * menu's name. */
  @state() private narrow = false;
  @state() private publishResult: PublishResult | null = null;

  /** Null while closed; `id` is null while creating. */
  @state() private menuForm: { id: string | null; name: string } | null = null;
  @state() private menuFormName = "";
  @state() private menuFormErrors: Record<string, string> = {};

  @state() private duplicating: {
    sourceId: string;
    sourceName: string;
    listId: string;
    listName: string;
    memberId: string;
    memberIds: string[];
  } | null = null;
  @state() private duplicateName = "";
  @state() private duplicateErrors: Record<string, string> = {};

  /** The list the new-section form adds to, while it is open. */
  @state() private creatingSection: ListTarget | null = null;
  @state() private newSectionName = "";
  @state() private newSectionErrors: Record<string, string> = {};

  /** The list the product picker adds to, while it is open. */
  @state() private addingProducts: ListTarget | null = null;
  @state() private addProductsError: string | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );
  readonly #structureQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.structureError = true;
    },
  );
  readonly #priceQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.pricesError = true;
    },
  );
  /** The menu whose prices are being watched, so showing the Prices tab while they already are
   * starts no second read. */
  #pricesFor: string | null = null;
  readonly #statusQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      if (this.menuId === null) this.statusesError = true;
      else this.statusError = true;
    },
  );
  /** The menu whose state is followed, null for every menu's, undefined before the first. */
  #statusFor: string | null | undefined = undefined;
  /** Whether the open menu's state is followed through its own query rather than the preview. */
  #statusOwnQuery = false;
  readonly #previewQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.previewError = true;
      if (this.status === null) this.statusError = true;
    },
  );
  #previewFor: string | null = null;
  readonly #usageQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.usagesError = true;
    },
  );

  /** An unknown menu or tab is replaced rather than pushed, so Back still leaves the screen. */
  readonly #url = new UrlStateController(this, () => this.#restore(), dashboardPath);

  /** Built once: `dashboard-app.ts` renders each screen under `keyed(currentLocale(), …)`, so a
   * language change builds a new screen. */
  readonly #columns: DataTableColumn<MenuRow>[] = this.#buildColumns(false);
  readonly #narrowColumns: DataTableColumn<MenuRow>[] = this.#buildColumns(true);
  #listSize: ResizeObserver | null = null;
  #rows: MenuRow[] = [];
  #sectionNames = new Map<string, string>();
  #parents: SectionParents = new Map();
  /** The nodes along {@link path}, one per member id. */
  #trail: MenuStructureNode[] = [];
  #listId: string | null = null;
  #listMembers: SectionMember[] = [];
  #inSection: string[] = [];
  #onMenu: string[] = [];
  #excluded: string[] = [];
  #memberProducts: Product[] = [];
  #addable: Product[] = [];
  readonly #writes = new ListWriteQueue();
  /** Per list, the current batch of moves: those made since the list last had none unanswered,
   * until one is refused. `out` counts the unanswered; `answered` holds the orders answered by
   * moves that were not shown because another write to the list waited behind them. */
  readonly #moveBatches = new Map<string, { answered: string[][]; out: number }>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** A narrow list has no status column to sort by, so a status sort gives way, visibly, to the
   * name order. */
  protected override updated(changed: PropertyValues): void {
    if (!changed.has("narrow") || !this.narrow) return;
    const table = this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      'wt-data-table[data-test="menus"]',
    );
    if (table?.sortKey !== "status") return;
    table.sortKey = "name";
    table.sortDirection = "ascending";
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("menus") || changed.has("statuses") || changed.has("statusesError"))
      this.#rows = this.menus.map((menu) => ({
        ...menu,
        status: this.statuses?.[menu.id] ?? (this.statusesError ? "failed" : "loading"),
      }));
    if (changed.has("sections")) {
      this.#sectionNames = new Map(this.sections.map(({ id, internalName }) => [id, internalName]));
      this.#parents = sectionParents(this.sections);
    }
    if (changed.has("structure") || changed.has("path")) {
      this.#resolvePath();
      this.#closeLostList();
    }
    if (changed.has("structure")) this.#onMenu = reachableProducts(this.structure?.nodes ?? []);
    if (changed.has("structure") || changed.has("path") || changed.has("sections"))
      this.#excluded = this.path.length === 0 ? [] : sectionsHolding(this.#parents, this.#listId!);
    if (changed.has("products") || changed.has("structure") || changed.has("path")) {
      const held = new Set(this.#inSection);
      this.#memberProducts = this.products.filter(
        (product) => product.active || held.has(product.id),
      );
    }
    if (changed.has("products")) this.#addable = this.products.filter((product) => product.active);
  }

  /** Keeps the longest part of the path the structure still has, and derives the list it names. */
  #resolvePath(): void {
    const trail = trailOf(this.structure, this.path);
    if (trail.length < this.path.length) this.path = this.path.slice(0, trail.length);
    this.#trail = trail;
    this.#listId = listIdOf(this.structure, trail);
    const nodes =
      trail.length === 0 ? (this.structure?.nodes ?? []) : (trail.at(-1)!.children ?? []);
    this.#listMembers = nodes.map(({ memberId, ref }, position) => ({
      id: memberId,
      position,
      ref,
    }));
    this.#inSection = nodes.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : []));
  }

  /** Whether the target's path, followed as far as the menu on screen still has it, ends at the
   * target's list. */
  #holds(target: ListTarget): boolean {
    return listIdOf(this.structure, trailOf(this.structure, target.path)) === target.listId;
  }

  /** Closes a window whose path no longer leads to its list, except while its request is out, so
   * the outcome is shown in the window that names its list, and except before its menu's structure
   * is read, when this runs again as it arrives. Only a list lost within the same menu is
   * explained; the menu itself changes only by navigation, and then the window closes without a
   * message. Says whether it closed one. */
  #closeLostList(): boolean {
    const target = this.addingProducts ?? this.creatingSection;
    if (target === null || this.busy) return false;
    if (target.menuId === this.menuId && (this.structure === null || this.#holds(target)))
      return false;
    this.addingProducts = null;
    this.creatingSection = null;
    if (target.menuId === this.menuId)
      this.memberError = t("menus.list_gone").replace("{name}", target.name);
    return true;
  }

  /** After a write to `target` was saved, says so when, in the same menu, its path no longer leads
   * to its list; with the menu's structure unread it cannot tell, and says nothing. */
  #reportSavedToLost(target: ListTarget): void {
    if (target.menuId === this.menuId && this.structure !== null && !this.#holds(target))
      this.memberError = t("menus.list_gone_saved").replace("{name}", target.name);
  }

  /** When a change to `target` is refused while the list on screen is not `target`'s — it is
   * another menu's, another list of the same menu, or there is none — names the list with the
   * refusal, so the refusal is not read as being about what is on screen. Says whether it did. */
  #reportRefusedElsewhere(target: ListTarget, error: unknown): boolean {
    if (target.menuId === this.menuId && target.listId === this.#listId) return false;
    this.memberError = t("menus.change_not_saved")
      .replace("{name}", target.name)
      .replace("{reason}", codeMessage(codeOf(error)));
    return true;
  }

  /** Closes a window whose request was refused while another menu, or none, is on screen, so it is
   * never left open over a menu it does not belong to. Within the same menu it leaves the window
   * open for its caller to show the refusal there. Says whether it closed one. */
  #closeRefusedElsewhere(target: ListTarget, error: unknown): boolean {
    if (target.menuId === this.menuId) return false;
    this.#reportRefusedElsewhere(target, error);
    this.addingProducts = null;
    this.creatingSection = null;
    return true;
  }

  #here(): ListTarget {
    return {
      menuId: this.menuId!,
      path: this.path,
      listId: this.#listId!,
      name: this.#listName(),
    };
  }

  // ── Loading and the address ─────────────────────────────────────────────────────────────────

  async #load(): Promise<void> {
    this.loadError = false;
    this.usagesError = false;
    this.#followStatus();
    // Kept apart from the load: a failure is reported beside the list it would describe.
    void this.#usageQueries
      .watch("listSectionUsages", [], (value) => {
        this.usages = value;
        this.usagesError = false;
      })
      .catch(() => undefined);
    try {
      await Promise.all([
        this.#watchMenus(),
        this.#watchSections(),
        this.#queries.watch("listLibraryProducts", [], (value) => {
          this.products = value;
        }),
        this.#queries.watch("listCategories", [], (value) => {
          this.categories = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          setContentLanguages(value);
        }),
      ]);
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
    this.#checkAddress();
  }

  #watchMenus(): Promise<void> {
    return this.#queries.watch("listCatalogues", [], (value) => {
      this.menus = value;
    });
  }

  #watchSections(): Promise<void> {
    return this.#queries.watch("listSections", [], (value) => {
      this.sections = value;
    });
  }

  async #watchStructure(): Promise<void> {
    const menuId = this.menuId;
    if (menuId === null) return;
    this.structureError = false;
    try {
      await this.#structureQueries.watch("getMenuStructure", [menuId], (value) => {
        if (this.menuId === menuId) this.structure = value;
      });
    } catch {
      if (this.menuId === menuId) this.structureError = true;
    }
  }

  /** The query slot holds one watch: watching another menu, or `#releasePrices`, stops the earlier
   * one, so its answers never land on another menu. */
  async #watchPrices(menuId: string): Promise<void> {
    this.#pricesFor = menuId;
    this.pricesError = false;
    try {
      await this.#priceQueries.watch("getMenuPrices", [menuId], (value) => {
        this.prices = value;
        this.pricesError = false;
      });
    } catch {
      this.pricesError = true;
    }
  }

  /** Follows every menu's state while the list is shown, and the open menu's alone while its
   * editor is — except on the Preview tab, where the preview's own answer carries it and a second
   * query would only repeat the read. `again` reads it afresh even when it is already followed,
   * keeping the open menu's state on screen until that read replaces it. */
  #followStatus(again = false): void {
    const menuId = this.menuId;
    const ownQuery = menuId !== null && this.view !== "preview";
    if (!again && this.#statusFor === menuId && this.#statusOwnQuery === ownQuery) return;
    const sameMenu = this.#statusFor === menuId;
    this.#statusFor = menuId;
    this.#statusOwnQuery = ownQuery;
    if (menuId === null) {
      this.#statusQueries.release("getMenuStatus");
      this.statuses = null;
      this.statusesError = false;
      void this.#statusQueries
        .watch("getMenuStatuses", [], (value) => {
          this.statuses = value;
          this.statusesError = false;
        })
        .catch(() => undefined);
      return;
    }
    this.#statusQueries.release("getMenuStatuses");
    if (!sameMenu) this.status = null;
    if (again || !sameMenu) this.statusError = false;
    if (!ownQuery) {
      this.#statusQueries.release("getMenuStatus");
      if (again) void this.#watchPreview(menuId);
      return;
    }
    void this.#statusQueries
      .watch("getMenuStatus", [menuId], (value) => {
        this.status = value;
        this.statusError = false;
      })
      .catch(() => undefined);
  }

  /** Re-reads from scratch, as after a refused publish, so the preview is never an old one. */
  async #watchPreview(menuId: string): Promise<void> {
    this.#previewFor = menuId;
    this.preview = null;
    this.previewError = false;
    try {
      await this.#previewQueries.watch("getMenuPreview", [menuId], (value) => {
        this.preview = value;
        this.previewError = false;
        this.status = value.status;
        this.statusError = false;
      });
    } catch {
      this.previewError = true;
    }
  }

  #releasePreview(): void {
    this.#previewFor = null;
    this.#previewQueries.release("getMenuPreview");
    this.preview = null;
    this.previewError = false;
  }

  /** Also forgets the rows, so the tab shows loading rather than old rows until the next read. */
  #releasePrices(): void {
    this.#pricesFor = null;
    this.#priceQueries.release("getMenuPrices");
    this.prices = null;
    this.pricesError = false;
  }

  /** The prices are watched only while the Prices tab is shown: the structure edits made on the
   * other tab write tables the prices read depends on. The preview likewise. */
  #showView(view: Tab): void {
    this.view = view;
    this.#followStatus();
    if (view !== "preview") this.#releasePreview();
    else if (this.menuId !== null && this.#previewFor !== this.menuId)
      void this.#watchPreview(this.menuId);
    // The window lives in the Prices panel, which the tabs hide; left open, its modal dialog would
    // block the page. A save still out reports a refusal beside the list instead (`#saveOffer`).
    if (view !== "prices") {
      this.editingOffer = null;
      this.offerRefusal = null;
      this.#releasePrices();
    } else if (this.menuId !== null && this.#pricesFor !== this.menuId)
      void this.#watchPrices(this.menuId);
  }

  /** A write that succeeded is never reported as a failed one: a failure here is a load failure. */
  async #refresh(): Promise<void> {
    await Promise.all([this.#watchStructure(), this.#watchSections().catch(() => undefined)]);
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "menus") return;
    this.#select(this.#url.read("menu"));
    const view = this.#url.read("view");
    this.#showView(isTab(view) ? view : TABS[0]);
    this.#checkAddress();
  }

  #select(menuId: string | null): void {
    if (menuId === this.menuId) return;
    this.menuId = menuId;
    this.path = [];
    this.structure = null;
    this.structureError = false;
    this.memberError = null;
    this.editingOffer = null;
    this.offerRefusal = null;
    this.publishResult = null;
    this.#releasePrices();
    this.#releasePreview();
    // An open menu's state waits for `#showView`, which each caller opening a menu runs next and
    // which knows whether the Preview tab carries it, so no query starts only to be released.
    if (menuId === null) {
      this.#followStatus();
      this.#structureQueries.release("getMenuStructure");
    } else void this.#watchStructure();
  }

  /** Replaces an address naming a menu that does not exist, or a tab the editor does not have. */
  #checkAddress(): void {
    if (this.#url.read("dashboard") !== "menus") return;
    if (this.menuId === null) {
      if (this.#url.read("view") !== null) this.#url.write({ view: null }, true);
      return;
    }
    if (!this.loading && !this.loadError && !this.menus.some(({ id }) => id === this.menuId)) {
      this.#select(null);
      this.#url.write({ menu: null, view: null }, true);
      return;
    }
    if (!isTab(this.#url.read("view"))) this.#url.write({ view: TABS[0] }, true);
  }

  #open(menuId: string): void {
    this.#select(menuId);
    this.#showView(TABS[0]);
    this.#url.write({ dashboard: "menus", menu: menuId, view: TABS[0] });
  }

  #backToList(): void {
    this.#select(null);
    this.#url.write({ dashboard: "menus", menu: null, view: null });
  }

  #menuName(): string {
    return this.menus.find(({ id }) => id === this.menuId)?.name ?? "";
  }

  /** Every node on the path is a section, so no product name is needed. */
  #nodeName(node: MenuStructureNode): string {
    return memberName(node.ref, NO_NAMES, this.#sectionNames);
  }

  #listName(): string {
    const last = this.#trail.at(-1);
    return last ? this.#nodeName(last) : this.#menuName();
  }

  /** The list holding the section being edited: the section before it on the path, or the root. */
  #parent(): { id: string; name: string } {
    const parent = this.#trail.at(-2);
    if (parent?.ref.kind === "section")
      return { id: parent.ref.sectionId, name: this.#nodeName(parent) };
    return { id: this.structure!.rootSectionId, name: this.#menuName() };
  }

  // ── Menus ────────────────────────────────────────────────────────────────────────────────────

  #openMenuForm(menu: CatalogueSummary | null): void {
    this.menuForm = { id: menu?.id ?? null, name: menu?.name ?? "" };
    this.menuFormName = menu?.name ?? "";
    this.menuFormErrors = {};
  }

  async #saveMenu(): Promise<void> {
    const form = this.menuForm;
    if (form === null || this.busy) return;
    const name = this.menuFormName.trim();
    if (name === "") {
      this.menuFormErrors = { name: t("menus.name_required") };
      return;
    }
    this.busy = true;
    this.menuFormErrors = {};
    try {
      if (form.id === null) await this.api.createCatalogue(name);
      else await this.api.renameCatalogue(form.id, name);
    } catch (error) {
      this.menuFormErrors = refusal(error);
      this.busy = false;
      return;
    }
    this.busy = false;
    this.menuForm = null;
    // A write that succeeded is never reported as a failed one: a failure here is a load failure.
    await this.#watchMenus().catch(() => undefined);
    this.#followStatus(true);
  }

  // ── Publishing ───────────────────────────────────────────────────────────────────────────────

  /**
   * Publishes the working state the preview showed, as `hash`; the server refuses it as
   * `menu.changed_since_preview` when the menu has changed since, and then the menu is previewed
   * again. A refusal that lands after the person left the menu is named beside the list.
   */
  async #publish(hash: string): Promise<void> {
    const menuId = this.menuId!;
    if (this.publishing.has(menuId)) return;
    const name = this.#menuName();
    const live = this.status;
    this.publishing = new Set([...this.publishing, menuId]);
    this.publishResult = null;
    let result: PublishResult;
    try {
      result = { kind: "published", number: (await this.api.publishMenu(menuId, hash)).number };
    } catch (error) {
      const code = codeOf(error);
      result =
        code === "menu.changed_since_preview"
          ? { kind: "stale" }
          : { kind: "failed", reason: codeMessage(code) };
    }
    this.publishing = new Set([...this.publishing].filter((id) => id !== menuId));
    if (this.menuId !== menuId) {
      if (result.kind !== "published")
        this.memberError = publishFailure(
          name,
          live,
          result.kind === "stale" ? codeMessage("menu.changed_since_preview") : result.reason,
        );
      return;
    }
    this.publishResult = result;
    if (result.kind === "failed") return;
    // A publish that succeeded is never reported as a failed one: a failure here is a load failure.
    if (result.kind === "published") {
      this.status = publishedStatus(result.number, hash, live);
      this.#followStatus(true);
    } else if (this.view === "preview") void this.#watchPreview(menuId);
  }

  // ── The list being edited ────────────────────────────────────────────────────────────────────

  /** Adds and removes hold `busy`, which disables the list until the menu is read again. */
  #listWrite(write: (listId: string) => Promise<unknown>): void {
    const target = this.#here();
    const { listId } = target;
    this.memberError = null;
    this.busy = true;
    this.#writes.run(listId, async () => {
      try {
        await write(listId);
      } catch (error) {
        if (!this.#reportRefusedElsewhere(target, error))
          this.memberError = codeMessage(codeOf(error));
        this.busy = false;
        return;
      }
      await this.#refresh();
      this.busy = false;
    });
  }

  /** Not `busy`: that would disable the handle the keyboard user is on and drop their focus. */
  #move(memberId: string, to: number): void {
    const target = this.#here();
    const { listId } = target;
    const moves = this.#moveBatches.get(listId) ?? { answered: [], out: 0 };
    this.#moveBatches.set(listId, moves);
    moves.out += 1;
    let sentOver: MenuStructure | null = null;
    this.memberError = null;
    this.#writes.move(
      listId,
      () => {
        sentOver = this.structure;
        return this.api.moveSectionMember(listId, memberId, to);
      },
      async (ordered, last) => {
        moves.out -= 1;
        if (moves.out === 0) this.#moveBatches.delete(listId);
        const answer = ordered.map(({ id }) => id);
        if (!last) {
          moves.answered.push(answer);
          return;
        }
        if (this.structure === null) return;
        // With no version to compare, the answer is shown only when the list's order on screen, at
        // every place it appears, is exactly the one this move was sent over, one an earlier move
        // of this batch answered, or this answer itself; any other order may be a newer change, so
        // the menu is read again, while an accepted order can itself be a newer change that
        // recreated it, such as one undoing this move, which the answer then covers until the menu
        // is next read.
        const accepted = [
          ...placesOf(sentOver, listId).map((nodes) => nodes.map((node) => node.memberId)),
          ...moves.answered,
          answer,
        ];
        const nodes = withOrder(this.structure, listId, ordered, accepted);
        if (nodes === null) await this.#watchStructure();
        else this.structure = { ...this.structure, nodes };
      },
      async (error) => {
        // The moves queued behind a refused one are dropped unanswered, so its batch ends here.
        this.#moveBatches.delete(listId);
        if (!this.#reportRefusedElsewhere(target, error))
          this.memberError = codeMessage(codeOf(error));
        await this.#refresh();
      },
    );
  }

  #openSection(sectionId: string): void {
    const member = this.#listMembers.find(
      ({ ref }) => ref.kind === "section" && ref.sectionId === sectionId,
    );
    if (member) this.#edit([...this.path, member.id]);
  }

  #edit(path: string[]): void {
    this.path = path;
    this.memberError = null;
  }

  #openDuplicate(): void {
    const node = this.#trail.at(-1)!;
    if (node.ref.kind !== "section") return;
    const parent = this.#parent();
    const sourceName = this.#listName();
    this.duplicating = {
      sourceId: node.ref.sectionId,
      sourceName,
      listId: parent.id,
      listName: parent.name,
      memberId: node.memberId,
      memberIds: (node.children ?? []).map(({ memberId }) => memberId),
    };
    this.duplicateName = t("sections.copy_name").replace("{name}", sourceName);
    this.duplicateErrors = {};
  }

  #duplicate(): void {
    const duplicating = this.duplicating;
    if (duplicating === null || this.busy) return;
    const internalName = this.duplicateName.trim();
    if (internalName === "") {
      this.duplicateErrors = { internalName: t("sections.internal_name_required") };
      return;
    }
    this.busy = true;
    this.duplicateErrors = {};
    this.#writes.run(duplicating.listId, async () => {
      try {
        await this.api.duplicateSection(duplicating.sourceId, {
          internalName,
          memberIds: duplicating.memberIds,
          replaceIn: { sectionId: duplicating.listId, memberId: duplicating.memberId },
        });
      } catch (error) {
        this.duplicateErrors = refusal(error);
        this.busy = false;
        return;
      }
      this.duplicating = null;
      await this.#refresh();
      this.busy = false;
    });
  }

  #openNewSection(): void {
    this.creatingSection = this.#here();
    this.newSectionName = "";
    this.newSectionErrors = {};
  }

  /** Two requests: the section, then its place in the list. A section left out of the list by a
   * refused second request is still in the library, and offered by the list's own picker. */
  #createSection(): void {
    if (this.creatingSection === null || this.busy || this.#closeLostList()) return;
    const internalName = this.newSectionName.trim();
    if (internalName === "") {
      this.newSectionErrors = { internalName: t("sections.internal_name_required") };
      return;
    }
    const target = this.creatingSection;
    const listId = target.listId;
    this.busy = true;
    this.newSectionErrors = {};
    this.memberError = null;
    this.#writes.run(listId, async () => {
      let created: LibrarySection;
      try {
        created = await this.api.createSection({ internalName });
      } catch (error) {
        if (!this.#closeRefusedElsewhere(target, error)) this.newSectionErrors = refusal(error);
        this.busy = false;
        return;
      }
      this.creatingSection = null;
      let added = true;
      try {
        await this.api.addSectionMember(listId, { kind: "section", sectionId: created.id });
      } catch {
        added = false;
        this.memberError =
          listId === this.#listId
            ? t("menus.section_not_added").replace("{name}", created.internalName)
            : t("menus.section_not_added_to")
                .replace("{name}", created.internalName)
                .replace("{list}", target.name);
      }
      await this.#refresh();
      if (added) this.#reportSavedToLost(target);
      this.busy = false;
    });
  }

  #addProducts(productIds: string[]): void {
    if (this.addingProducts === null || this.busy || this.#closeLostList()) return;
    const target = this.addingProducts;
    const { listId } = target;
    this.busy = true;
    this.addProductsError = null;
    this.#writes.run(listId, async () => {
      try {
        await this.api.addSectionProducts(listId, productIds);
      } catch (error) {
        if (!this.#closeRefusedElsewhere(target, error))
          this.addProductsError = codeMessage(codeOf(error));
        this.busy = false;
        return;
      }
      this.addingProducts = null;
      await this.#refresh();
      this.#reportSavedToLost(target);
      this.busy = false;
    });
  }

  // ── Prices ───────────────────────────────────────────────────────────────────────────────────

  /** A PATCH for the menu item when its price or switch changed, then a PUT of its variants when
   * one of them did. A refusal keeps the window open, unless it has been closed meanwhile (by
   * another menu or tab), when it is named beside the list instead. */
  async #saveOffer(save: OfferSave): Promise<void> {
    const menuId = this.menuId;
    if (menuId === null || this.savingOffer) return;
    this.offerRefusal = null;
    if (save.item === null && save.variants === null) {
      this.editingOffer = null;
      return;
    }
    this.savingOffer = true;
    const refused = (field: string, inWindow: string, elsewhere: string): void => {
      this.savingOffer = false;
      if (this.menuId === menuId && this.editingOffer === save.menuItemId)
        this.offerRefusal = { field, message: inWindow };
      else this.memberError = elsewhere;
    };
    /** Nothing of this save was written. */
    const notSaved = (error: unknown, field: string): void => {
      const reason = codeMessage(codeOf(error));
      refused(
        field,
        reason,
        t("menus.change_not_saved").replace("{name}", save.name).replace("{reason}", reason),
      );
    };
    const reread = async (): Promise<void> => {
      if (this.menuId === menuId && this.view === "prices") await this.#watchPrices(menuId);
    };
    if (save.item !== null)
      try {
        await this.api.updateMenuItem(menuId, save.menuItemId, save.item);
      } catch (error) {
        notSaved(error, fieldOf(error));
        return;
      }
    if (save.variants !== null)
      try {
        await this.api.setMenuVariants(menuId, save.menuItemId, save.variants);
      } catch (error) {
        if (save.item === null) {
          notSaved(error, "_form");
          return;
        }
        const partly = t("menu_prices.variants_not_saved")
          .replace("{name}", save.name)
          .replace("{reason}", codeMessage(codeOf(error)));
        refused("_form", partly, partly);
        // The menu price was saved, so the list behind the window is read again.
        await reread();
        return;
      }
    this.savingOffer = false;
    if (this.menuId !== menuId) return;
    this.editingOffer = null;
    await reread();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────

  #statusCell(menu: MenuRow) {
    const test = `status-${menu.id}`;
    if (typeof menu.status === "string")
      return html`<span part="muted" data-test=${test}
        >${t(menu.status === "loading" ? "menus.status_loading" : "menus.status_error")}</span
      >`;
    const { label, live } = statusWords(menu.status);
    return html`<span data-test=${test}
      >${label}${
        live === null
          ? nothing
          : html` <span part="note">${live.version} · <span part="time">${live.time}</span></span>`
      }</span
    >`;
  }

  /** On a narrow list the status moves under the name and its own column goes, as the variants
   * table does with its prices (docs/developers/design-system.md). */
  #buildColumns(narrow: boolean): DataTableColumn<MenuRow>[] {
    const name = (menu: MenuRow) =>
      html`<wt-button
        variant="ghost"
        part="name"
        align="start"
        data-test=${`open-${menu.id}`}
        @click=${() => this.#open(menu.id)}
        ><span part="name-text">${menu.name}</span></wt-button
      >`;
    return [
      {
        key: "name",
        label: t("menus.name"),
        sortValue: (menu) => menu.name,
        searchValue: (menu) => menu.name,
        cell: narrow
          ? (menu) => html`${name(menu)} <span part="stacked">${this.#statusCell(menu)}</span>`
          : name,
      },
      ...(narrow
        ? []
        : [
            {
              key: "status",
              label: t("menus.status"),
              sortValue: (menu: MenuRow) =>
                STATUS_ORDER.indexOf(
                  typeof menu.status === "string" ? menu.status : menu.status.state,
                ),
              cell: (menu: MenuRow) => this.#statusCell(menu),
            },
          ]),
      {
        key: "actions",
        label: t("menus.actions"),
        cell: (menu) =>
          html`<wt-row-actions label=${`${t("menus.actions")}: ${menu.name}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`edit-${menu.id}`}
              @click=${() => this.#open(menu.id)}
              >${t("menus.open")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`rename-${menu.id}`}
              @click=${() => this.#openMenuForm(menu)}
              >${t("menus.rename")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }

  #summary(errors: Record<string, string>) {
    return html`<wt-form-error-summary
      heading=${t("form.error_heading")}
      .errors=${Object.values(errors)}
    ></wt-form-error-summary>`;
  }

  #guardEscape = (event: KeyboardEvent): void => {
    if (this.busy && event.key === "Escape") event.preventDefault();
  };

  #nameInput(options: {
    name: string;
    label: string;
    value: string;
    errors: Record<string, string>;
    save: string;
    change: (value: string) => void;
  }) {
    const context = {
      busy: this.busy,
      locales: [],
      error: (key: string) => options.errors[key] ?? "",
    };
    return html`<div
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>(`[data-test="${options.save}"]`),
        )}
    >
      ${textField(context, options.name, options.label, options.value, options.change, true)}
    </div>`;
  }

  #formModal(options: {
    test: string;
    open: boolean;
    heading: string;
    body: unknown;
    save: string;
    saveLabel: string;
    close: () => void;
    submit: () => void;
  }) {
    return html`<wt-modal
      data-test=${options.test}
      .open=${options.open}
      heading=${options.heading}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) options.close();
      }}
    >
      ${options.open ? options.body : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test=${`${options.test}-cancel`}
          .disabled=${this.busy}
          @click=${() => {
            if (!this.busy) options.close();
          }}
          >${t("action.cancel")}</wt-button
        ><wt-button
          variant="primary"
          data-test=${options.save}
          .disabled=${this.busy}
          @click=${options.submit}
          >${options.saveLabel}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #renderMenuForm() {
    const form = this.menuForm;
    const errors = this.menuFormErrors;
    return this.#formModal({
      test: "menu-form",
      open: form !== null,
      heading:
        form?.id == null
          ? t("menus.create")
          : t("menus.rename_heading").replace("{name}", form.name),
      body: html`<div class="fields">
        ${this.#summary(errors)}
        ${this.#nameInput({
          name: "name",
          label: t("menus.name"),
          value: this.menuFormName,
          errors,
          save: "menu-save",
          change: (value) => {
            this.menuFormName = value;
            this.menuFormErrors = {};
          },
        })}
      </div>`,
      save: "menu-save",
      saveLabel: t("action.save"),
      close: () => {
        this.menuForm = null;
      },
      submit: () => void this.#saveMenu(),
    });
  }

  /** The probe is observed rather than the list: the probe's width follows the list's container,
   * not the table's contents. */
  #observeProbe = (probe: Element | undefined): void => {
    this.#listSize?.disconnect();
    this.#listSize = null;
    if (probe === undefined) return;
    this.#listSize = new ResizeObserver(() => {
      this.narrow = getComputedStyle(probe).display !== "none";
    });
    this.#listSize.observe(probe);
  };

  #renderList() {
    return html`<h1>${t("menus.title")}</h1>
      ${this.#renderLoadState()} ${this.#renderMemberError()}
      ${
        !this.loading && !this.loadError
          ? html`<div class="page-actions">
                <wt-button
                  data-test="add-menu"
                  variant="primary"
                  @click=${() => this.#openMenuForm(null)}
                  >${t("menus.add")}</wt-button
                >
              </div>
              <div class="list">
                <span class="narrow-probe" aria-hidden="true" ${ref(this.#observeProbe)}></span>
                <wt-data-table
                  data-test="menus"
                  class=${this.narrow ? "narrow" : ""}
                  aria-label=${t("menus.title")}
                  viewKey="waitron.menus.table"
                  sortKey="name"
                  sortDirection="ascending"
                  .rows=${this.#rows}
                  .columns=${this.narrow ? this.#narrowColumns : this.#columns}
                  .rowKey=${(menu: MenuRow) => menu.id}
                  .emptyMessage=${t("menus.empty")}
                ></wt-data-table>
              </div>`
          : nothing
      }
      ${this.#renderMenuForm()}`;
  }

  #renderLoadState() {
    return html`${
      this.loading ? html`<p role="status" data-test="loading">${t("menus.loading")}</p>` : nothing
    }
    ${
      this.loadError
        ? html`<p class="error" role="alert" data-test="load-error">${t("menus.load_error")}</p>
            <wt-button
              data-test="retry"
              variant="secondary"
              @click=${() => {
                this.#followStatus(true);
                void this.#load();
              }}
              >${t("menus.retry")}</wt-button
            >`
        : nothing
    }`;
  }

  /** Drawn whatever the structure's state, so a window closed by a refusal while another menu's
   * structure is unread still says why. */
  #renderMemberError() {
    return this.memberError
      ? html`<p class="error" role="alert" data-test="member-error">${this.memberError}</p>`
      : nothing;
  }

  #renderBreadcrumb() {
    const crumbs = [this.#menuName(), ...this.#trail.map((node) => this.#nodeName(node))];
    const last = crumbs.length - 1;
    return html`<nav class="breadcrumb" aria-label=${t("menus.breadcrumb")} data-test="breadcrumb">
      <ol>
        ${crumbs.map((name, index) =>
          index === last
            ? html`<li>
                <span aria-current="location" data-test=${`crumb-${index}`}>${name}</span>
              </li>`
            : html`<li>
                <wt-button
                  variant="ghost"
                  data-test=${`crumb-${index}`}
                  @click=${() => this.#edit(this.path.slice(0, index))}
                  >${name}</wt-button
                >
                <span class="sep" aria-hidden="true">›</span>
              </li>`,
        )}
      </ol>
    </nav>`;
  }

  #renderShared() {
    if (this.path.length === 0) return nothing;
    const duplicate = html`<div>
      <wt-button
        data-test="duplicate-here"
        variant="secondary"
        .disabled=${this.busy}
        @click=${() => this.#openDuplicate()}
        >${t("menus.duplicate_here")}</wt-button
      >
    </div>`;
    if (this.usagesError)
      return html`<p class="error" role="alert" data-test="usages-error">
          ${t("sections.usages_error")}
        </p>
        ${duplicate}`;
    if (this.usages === null)
      return html`<p class="note" role="status">${t("sections.usages_loading")}</p>
        ${duplicate}`;
    const usages = this.usages[this.#listId!] ?? NO_USAGES;
    const parent = this.#trail.at(-2);
    const parentId = parent?.ref.kind === "section" ? parent.ref.sectionId : null;
    const elsewhere = [
      ...usages.menus.filter(({ id }) => id !== this.menuId).map(({ name }) => name),
      ...usages.sections
        .filter(({ id }) => id !== parentId)
        .map(({ internalName }) => internalName),
    ];
    if (elsewhere.length === 0)
      return html`<p class="note" data-test="not-shared">${t("menus.not_shared")}</p>
        ${duplicate}`;
    return html`<p class="note" data-test="shared">
        ${t("menus.shared").replace("{list}", elsewhere.join(", "))}
      </p>
      <p class="help">${t("menus.shared_note")}</p>
      ${duplicate}`;
  }

  #renderListEditor() {
    const listName = this.#listName();
    return html`<section class="panel" aria-labelledby="list-heading">
      ${this.#renderBreadcrumb()}
      <h2 id="list-heading">${listName}</h2>
      ${this.#renderShared()}
      <p class="help">${t("sections.members_saved_note")}</p>
      <dashboard-member-list-editor
        .members=${this.#listMembers}
        .products=${this.#memberProducts}
        .sections=${this.sections}
        .excludeSectionIds=${this.#excluded}
        .busy=${this.busy}
        label=${t("sections.members_label").replace("{name}", listName)}
        listName=${listName}
        @wt-member-add=${(event: CustomEvent<{ ref: MemberRef }>) => {
          event.stopPropagation();
          const { ref } = event.detail;
          this.#listWrite((id) => this.api.addSectionMember(id, ref));
        }}
        @wt-member-remove=${(event: CustomEvent<{ memberId: string }>) => {
          event.stopPropagation();
          const { memberId } = event.detail;
          this.#listWrite((id) => this.api.removeSectionMember(id, memberId));
        }}
        @wt-member-move=${(event: CustomEvent<{ memberId: string; to: number }>) => {
          event.stopPropagation();
          this.#move(event.detail.memberId, event.detail.to);
        }}
        @wt-member-open=${(event: CustomEvent<{ sectionId: string }>) => {
          event.stopPropagation();
          this.#openSection(event.detail.sectionId);
        }}
      ></dashboard-member-list-editor>
      <div class="list-actions">
        <wt-button
          data-test="new-section"
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => this.#openNewSection()}
          >${t("menus.new_section")}</wt-button
        >
        <wt-button
          data-test="open-add-products"
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => {
            this.addProductsError = null;
            this.addingProducts = this.#here();
          }}
          >${t("sections.add_products")}</wt-button
        >
      </div>
    </section>`;
  }

  #renderStructure() {
    const structure = this.structure;
    const error = this.structureError
      ? html`<p class="error" role="alert" data-test="structure-error">
            ${t("menus.structure_error")}
          </p>
          <div>
            <wt-button
              data-test="structure-retry"
              variant="secondary"
              @click=${() => void this.#watchStructure()}
              >${t("menus.retry")}</wt-button
            >
          </div>`
      : nothing;
    if (structure === null)
      return html`${error}${
        this.structureError
          ? nothing
          : html`<p role="status" data-test="structure-loading">${t("menus.structure_loading")}</p>`
      }`;
    return html`${error}
      <div class="structure">
        <section class="panel" aria-labelledby="tree-heading">
          <h2 id="tree-heading">${t("menus.tree_heading")}</h2>
          <dashboard-menu-structure-tree
            .nodes=${structure.nodes}
            .products=${this.products}
            .sections=${this.sections}
            .current=${this.path}
            label=${this.#menuName()}
            @wt-structure-edit=${(event: CustomEvent<{ path: string[] }>) => {
              event.stopPropagation();
              this.#edit(event.detail.path);
            }}
          ></dashboard-menu-structure-tree>
        </section>
        ${this.#renderListEditor()}
      </div>`;
  }

  #renderPrices() {
    return html`<dashboard-menu-prices-table
        .rows=${this.prices ?? []}
        .loading=${this.prices === null && !this.pricesError}
        .failed=${this.pricesError}
        .sections=${this.sections}
        .categories=${this.categories}
        .products=${this.products}
        menuName=${this.#menuName()}
        .editing=${this.editingOffer}
        .busy=${this.savingOffer}
        .refusal=${this.offerRefusal}
        @wt-offer-edit=${(event: CustomEvent<{ menuItemId: string }>) => {
          event.stopPropagation();
          // One window at a time while a save is out, so its outcome lands in the window it came
          // from, or beside the list once that window has closed.
          if (this.savingOffer) return;
          this.offerRefusal = null;
          this.editingOffer = event.detail.menuItemId;
        }}
        @wt-offer-save=${(event: CustomEvent<OfferSave>) => {
          event.stopPropagation();
          void this.#saveOffer(event.detail);
        }}
        @wt-offer-cancel=${(event: Event) => {
          event.stopPropagation();
          this.editingOffer = null;
        }}
      ></dashboard-menu-prices-table>
      ${
        this.pricesError
          ? html`<div>
              <wt-button
                data-test="prices-retry"
                variant="secondary"
                @click=${() => void this.#watchPrices(this.menuId!)}
                >${t("menus.retry")}</wt-button
              >
            </div>`
          : nothing
      }`;
  }

  #renderPreview() {
    return html`<dashboard-menu-preview
      menuName=${this.#menuName()}
      .status=${this.status}
      .statusFailed=${this.statusError}
      .preview=${this.preview}
      .failed=${this.previewError}
      .publishing=${this.publishing.has(this.menuId!)}
      .result=${this.publishResult}
      @wt-menu-publish=${(event: CustomEvent<{ hash: string }>) => {
        event.stopPropagation();
        void this.#publish(event.detail.hash);
      }}
      @wt-preview-retry=${(event: Event) => {
        event.stopPropagation();
        void this.#watchPreview(this.menuId!);
      }}
    ></dashboard-menu-preview>`;
  }

  #renderStatusLine() {
    const words = this.statusError
      ? t("menus.status_error")
      : this.status === null
        ? t("menus.status_loading")
        : statusLine(this.status);
    return html`<p class="status-line" data-test="menu-status">${words}</p>`;
  }

  #renderDuplicate() {
    const duplicating = this.duplicating;
    const errors = this.duplicateErrors;
    return this.#formModal({
      test: "duplicate",
      open: duplicating !== null,
      heading: t("menus.duplicate_heading").replace("{name}", duplicating?.sourceName ?? ""),
      body: html`<div class="fields">
        ${this.#summary(errors)}
        ${this.#nameInput({
          name: "internalName",
          label: t("sections.internal_name"),
          value: this.duplicateName,
          errors,
          save: "duplicate-save",
          change: (value) => {
            this.duplicateName = value;
            this.duplicateErrors = {};
          },
        })}
        <p class="help">
          ${t("menus.duplicate_note")
            .replaceAll("{name}", duplicating?.sourceName ?? "")
            .replace("{list}", duplicating?.listName ?? "")}
        </p>
      </div>`,
      save: "duplicate-save",
      saveLabel: t("menus.duplicate_save"),
      close: () => {
        this.duplicating = null;
      },
      submit: () => this.#duplicate(),
    });
  }

  #renderNewSection() {
    const errors = this.newSectionErrors;
    return this.#formModal({
      test: "new-section",
      open: this.creatingSection !== null,
      heading: t("menus.new_section_heading").replace("{list}", this.creatingSection?.name ?? ""),
      body: html`<div class="fields">
        ${this.#summary(errors)}
        ${this.#nameInput({
          name: "internalName",
          label: t("sections.internal_name"),
          value: this.newSectionName,
          errors,
          save: "new-section-save",
          change: (value) => {
            this.newSectionName = value;
            this.newSectionErrors = {};
          },
        })}
        <p class="help">${t("sections.internal_name_help")}</p>
      </div>`,
      save: "new-section-save",
      saveLabel: t("action.save"),
      close: () => {
        this.creatingSection = null;
      },
      submit: () => this.#createSection(),
    });
  }

  #renderAddProducts() {
    const target = this.addingProducts;
    return html`<wt-modal
      data-test="add-products"
      .open=${target !== null}
      heading=${t("sections.add_products_heading").replace("{name}", target?.name ?? "")}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.addingProducts = null;
      }}
    >
      ${
        target !== null
          ? html`${
                this.addProductsError
                  ? html`<p class="error" role="alert" data-test="add-products-error">
                      ${this.addProductsError}
                    </p>`
                  : nothing
              }
              <dashboard-section-add-products
                .products=${this.#addable}
                .categories=${this.categories}
                .inSection=${target.listId === this.#listId ? this.#inSection : []}
                .onMenu=${target.menuId === this.menuId ? this.#onMenu : null}
                .busy=${this.busy}
                @wt-add-products=${(event: CustomEvent<{ productIds: string[] }>) => {
                  event.stopPropagation();
                  this.#addProducts(event.detail.productIds);
                }}
                ><wt-button
                  slot="cancel"
                  variant="secondary"
                  data-test="add-products-cancel"
                  .disabled=${this.busy}
                  @click=${() => {
                    this.addingProducts = null;
                  }}
                  >${t("action.cancel")}</wt-button
                ></dashboard-section-add-products
              >`
          : nothing
      }
    </wt-modal>`;
  }

  #renderEditor() {
    const name = this.#menuName();
    return html`<div class="back">
        <wt-button data-test="back" variant="ghost" @click=${() => this.#backToList()}
          >${t("menus.back")}</wt-button
        >
      </div>
      <h1>${name || t("menus.title")}</h1>
      ${this.#renderStatusLine()} ${this.#renderLoadState()} ${this.#renderMemberError()}
      <wt-tabs
        data-test="menu-tabs"
        label=${name || t("menus.title")}
        .value=${this.view}
        .items=${[
          { key: "structure", label: t("menus.tab_structure") },
          { key: "prices", label: t("menus.tab_prices") },
          { key: "preview", label: t("menus.tab_preview") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (event.target !== event.currentTarget) return;
          this.#showView(event.detail.value as Tab);
          this.#url.write({ view: event.detail.value });
        }}
      >
        <div slot="structure">${this.#renderStructure()}</div>
        <div slot="prices" class="prices">${this.#renderPrices()}</div>
        <div slot="preview">${this.#renderPreview()}</div>
      </wt-tabs>
      ${this.#renderDuplicate()} ${this.#renderNewSection()} ${this.#renderAddProducts()}`;
  }

  override render() {
    return this.menuId === null ? this.#renderList() : this.#renderEditor();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menus-screen": MenusScreen;
  }
}
