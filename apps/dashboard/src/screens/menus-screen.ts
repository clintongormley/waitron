import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { ref } from "lit/directives/ref.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  baseStyles,
  focusFirstInvalid,
  setContentLanguages,
  currentContentLanguages,
  submitOnEnter,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { memberName } from "../widgets/member-list-editor.js";
import "../widgets/menu-structure-table.js";
import type { StructureAddAction } from "../widgets/menu-structure-table.js";
import "../widgets/section-add-products.js";
import "../widgets/menu-prices-table.js";
import "../widgets/home-layout-editor.js";
import type { PriceOutcome, PriceSave } from "../widgets/menu-prices-table.js";
import { publishFailure, statusWords, type PublishResult } from "../widgets/menu-preview.js";
import "../widgets/section-details-form.js";
import "../widgets/product-color-form.js";
import { categoryColor } from "@waitron/catalogue/src/color-inheritance.js";
import { textField } from "../widgets/form-fields.js";
import { fieldOf, ListWriteQueue } from "../widgets/section-writes.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  HomeLayout,
  SectionDetails,
  SectionInput,
  MemberRef,
  MenuPreview,
  MenuPriceRow,
  MenuStatus,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath, leftToBrowser } from "../navigation.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

const TABS = ["structure", "prices", "home", "preview"] as const;
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

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** A menu on the list with its publication state, or where that state's read stands. */
interface MenuRow extends CatalogueSummary {
  status: MenuStatus | "loading" | "failed";
}

type ListLayout = "narrow" | "middle" | "wide";

/** Sorted by status, the menus needing a publish come first. */
const STATUS_ORDER = ["unpublished", "changed", "current", "loading", "failed"];

/** The state in one line, for the editor's heading. */
function statusLine(
  status: MenuStatus,
  drawLabel: (label: string) => string | TemplateResult = (label) => label,
) {
  const { label, live } = statusWords(status);
  return live === null
    ? drawLabel(label)
    : html`${drawLabel(label)} · ${live.version} · <span class="time">${live.time}</span>`;
}

function previewAddress(menuId: string): string {
  return `/manage/menus/menu/${encodeURIComponent(menuId)}/view/preview`;
}

/** The state a publish answered as version `number` left, shown until the next read replaces it.
 * The answer carries no publication time, so a new version shows this browser's clock. */
function publishedStatus(number: number, hash: string, before: MenuStatus | null): MenuStatus {
  const publishedAt =
    before !== null && before.state !== "unpublished" && before.version === number
      ? before.publishedAt
      : new Date().toISOString();
  return { state: "current", clashes: 0, version: number, publishedAt, hash };
}

function refusal(error: unknown): Record<string, string> {
  return { [fieldOf(error)]: codeMessage(codeOf(error)) };
}

/** Whether a refusal is about the price typed, so it belongs under that field, as
 * `namesTheName` in `course-list.ts` decides for a course's name. */
function namesThePrice(error: unknown, save: PriceSave): boolean {
  const code = codeOf(error);
  return (
    (code === "product.variant_invalid" && fieldOf(error) === "price") ||
    (code === "management.request_invalid" && ["grossPrice", "price"].includes(fieldOf(error))) ||
    (code === "product.variant_not_found" && save.variantId !== null)
  );
}

/** A form's one message at its bottom: every message not under a field `shown` names, then the
 * generic sentence when one is. */
function bottomMessage(errors: Record<string, string>, shown: ReadonlySet<string>): string {
  const marked = Object.entries(errors).some(([key, message]) => message && shown.has(key));
  const others = Object.entries(errors)
    .filter(([key, message]) => message && !shown.has(key))
    .map(([, message]) => message);
  return [...others, ...(marked ? [t("form.fix_fields")] : [])].join(" ");
}

const without = (errors: Record<string, string>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(errors).filter(([key]) => !keys.includes(key)));

/** Every product and section the structure holds, at any depth. */
function reachable(nodes: MenuStructureNode[]): { products: string[]; sections: Set<string> } {
  const products = new Set<string>();
  const sections = new Set<string>();
  const walk = (list: MenuStructureNode[]): void => {
    for (const node of list)
      if (node.ref.kind === "product") products.add(node.ref.productId);
      else {
        sections.add(node.ref.sectionId);
        walk(node.children ?? []);
      }
  };
  walk(nodes);
  return { products: [...products], sections };
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
  if (!structure) return [];
  if (listId === structure.rootSectionId) return [structure.nodes];
  const find = (nodes: readonly MenuStructureNode[]): MenuStructureNode[] | undefined => {
    for (const node of nodes) {
      if (node.ref.kind !== "section" || node.includedMenuId) continue;
      if (node.ref.sectionId === listId) return node.children ?? [];
      const found = find(node.children ?? []);
      if (found) return found;
    }
    return undefined;
  };
  const found = find(structure.nodes);
  return found ? [found] : [];
}

/**
 * The owned list `listId` in `ordered`'s order, or null when its members are not exactly the
 * ones `ordered` names, or its order is none of
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
      if (node.ref.kind !== "section" || node.includedMenuId || node.children === undefined)
        return node;
      const children = node.ref.sectionId === listId ? node.children : walk(node.children);
      return { ...node, children: node.ref.sectionId === listId ? arrange(children) : children };
    });
  const nodes = walk(structure.nodes);
  const result = listId === structure.rootSectionId ? arrange(nodes) : nodes;
  return mismatch ? null : result;
}

/**
 * The menus, and one menu's editor. Its Structure tab shows the menu as one tree, each list edited
 * from its own row, and each change is its own request, sent in order through one queue, because a
 * move leaves focus on the row. Its Price overrides tab lists every product the menu reaches, Active
 * or not, and edits the price this menu sets for each product and size.
 */
@customElement("dashboard-menus-screen")
export class MenusScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .field-error {
        color: var(--wt-color-danger);
      }
      [data-test="included-by"] a {
        display: inline-flex;
        align-items: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        font: inherit;
        text-decoration: underline;
      }
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-xl);
      }
      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .header h1 {
        margin: 0;
      }
      .header wt-button {
        margin-inline-start: auto;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-4);
      }
      .heading nav {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .heading h1 {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .heading a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      /* Padding on an inline link makes its tap target a tap target tall without making its line
         taller, so the line keeps its height whether the label is a link or words. */
      .status-line a {
        padding-block: calc((var(--wt-tap-min) - 1lh) / 2);
        color: var(--wt-color-primary-text);
      }
      .heading a:focus-visible,
      .status-line a:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .sep,
      .help {
        color: var(--wt-color-text-muted);
      }
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
      .prices,
      .home {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-3);
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
      .list,
      .sizer {
        container-type: inline-size;
      }
      .narrow-probe,
      .wide-probe {
        display: none;
      }
      @container (max-width: 30rem) {
        .narrow-probe {
          display: block;
        }
      }
      @container (min-width: 50rem) {
        .wide-probe {
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
      /* The list's cells start at their top, where the name button and the row menu are a tap target
         tall with their text centred, so the state's first line is centred on that height too. */
      wt-data-table:not(.narrow)::part(status) {
        display: block;
        padding-block-start: calc((var(--wt-tap-min) - 1lh) / 2);
      }
      wt-data-table::part(changes-link) {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary-text);
      }
      wt-data-table::part(changes-link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      /* The table itself never narrows a column below its content, so a long name wraps only
         within a width set here. On a narrow list the name and its status take the list's width
         less room for the row menu's column. */
      wt-data-table.narrow::part(name),
      wt-data-table.narrow::part(stacked) {
        max-width: calc(100cqi - 3 * var(--wt-tap-min));
      }
      /* The middle and wide name widths are set by container queries on the list's width, like
         the probes', rather than by the layout the probes choose, so they already apply in the
         frame before the probes are read. Between the narrow and the wide layouts, the name leaves
         room for the row menu and for the changes link under the state in Status. */
      @container (30rem < width < 50rem) {
        wt-data-table::part(name) {
          max-width: calc(100cqi - 3 * var(--wt-tap-min) - 8.5rem);
        }
      }
      /* A wide list leaves room for Status, Changes and the row menu. */
      @container (min-width: 50rem) {
        wt-data-table::part(name) {
          max-width: calc(100cqi - 30rem);
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private menus: CatalogueSummary[] = [];
  private get sections(): SectionDetails[] {
    const result: SectionDetails[] = [];
    const walk = (nodes: MenuStructureNode[]) => {
      for (const node of nodes)
        if (node.ref.kind === "section") {
          result.push({
            id: node.ref.sectionId,
            internalName: node.internalName ?? "",
            names: node.names ?? {},
            image: node.image ?? null,
            color: node.color ?? null,
            members: (node.children ?? []).map((child, position) => ({
              id: child.memberId,
              position,
              ref: child.ref,
            })),
          });
          walk(node.children ?? []);
        }
    };
    walk(this.structure?.nodes ?? []);
    return [...new Map(result.map((section) => [section.id, section])).values()];
  }
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
  @state() private busy = false;
  @state() private memberError: string | null = null;
  @state() private view: Tab = TABS[0];

  /** Null until the open menu's prices are first read. */
  @state() private prices: MenuPriceRow[] | null = null;
  @state() private pricesError = false;
  /** The prices table's row keys with a save queued or out. */
  @state() private savingPrices: ReadonlySet<string> = new Set();
  @state() private priceRefusals: Readonly<Record<string, string>> = {};
  @state() private priceOutcome: PriceOutcome | null = null;

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
  /** From the probes' container queries: "narrow" at 30rem or less, where each status sits under
   * its menu's name; "wide" from 50rem, where the changes link has a column of its own; "middle"
   * between, where the link sits under the status. */
  @state() private layout: ListLayout = "wide";
  @state() private publishResult: PublishResult | null = null;

  /** Null while closed; `id` is null while creating. */
  @state() private menuForm: { id: string | null; name: string } | null = null;
  /** Each name form's last refusal, less its name once the operator changes it. */
  @state() private menuFormErrors: Record<string, string> = {};
  /** The name forms, by `data-test`, whose Save has been pressed since they opened. */
  @state() private attempted: ReadonlySet<string> = new Set();

  /** The list the new-section form adds to, while it is open. */
  @state() private creatingSection: ListTarget | null = null;
  @state() private editingSection: SectionDetails | null = null;
  @state() private deletingSection: SectionDetails | null = null;
  /** The product whose own colour is being chosen. */
  @state() private colouring: Product | null = null;
  @state() private colorBusy = false;
  @state() private colorErrors: Record<string, string> = {};
  @state() private deleteSectionError = "";
  @state() private includingMenu: ListTarget | null = null;
  #menuFormGeneration = 0;
  @state() private includedRoot = "";
  @state() private includeError = "";
  @state() private menuDetails: SectionDetails | null = null;
  @state() private newSectionErrors: Record<string, string> = {};

  /** The list the product picker adds to, while it is open. */
  @state() private addingProducts: ListTarget | null = null;
  @state() private addProductsError: string | null = null;

  /** Null until the open menu's home page layouts are read, which happens only on their tab. */
  @state() private homeLayouts: HomeLayout[] | null = null;
  @state() private homeLoadError = false;
  /** Why a change on the Home page tab was refused. */
  @state() private homeError: string | null = null;
  /** The layout being edited; empty for the menu's default. */
  @state() private homeLayoutId = "";
  /** The layout form while it is open: a new layout, a copy of `layoutId`, or its new name. */
  @state() private layoutForm: {
    kind: "create" | "duplicate" | "rename";
    layoutId: string | null;
    name: string;
  } | null = null;
  @state() private layoutFormName = "";
  @state() private layoutFormErrors: Record<string, string> = {};
  @state() private deletingLayout: { id: string; name: string } | null = null;
  @state() private deleteLayoutError: string | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
    () => {
      this.loadError = false;
    },
  );
  readonly #structureQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.structureError = true;
    },
    () => {
      this.structureError = false;
    },
  );
  readonly #priceQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.pricesError = true;
    },
  );
  /** The menu whose prices are being watched, so showing the Price overrides tab while they already
   * are starts no second read. */
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
  readonly #homeQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.homeLoadError = true;
    },
  );
  #homeFor: string | null = null;
  /** An unknown menu or tab is replaced rather than pushed, so Back still leaves the screen. */
  readonly #url = new UrlStateController(this, () => this.#restore(), dashboardPath);

  /** Built once: `dashboard-app.ts` renders each screen under `keyed(currentLocale(), …)`, so a
   * language change builds a new screen. */
  readonly #columns: Record<ListLayout, DataTableColumn<MenuRow>[]> = {
    narrow: this.#buildColumns("narrow"),
    middle: this.#buildColumns("middle"),
    wide: this.#buildColumns("wide"),
  };
  #listSize: ResizeObserver | null = null;
  readonly #probes = new Map<"narrow" | "wide", Element>();
  #rows: MenuRow[] = [];
  #sectionNames = new Map<string, string>();
  /** The list {@link path} names. */
  #listId: string | null = null;
  #onMenu: string[] = [];
  /** The products the add-products window's own list already holds, which it does not offer. */
  #pickerHeld: string[] = [];
  #addable: Product[] = [];
  /** The tree row whose ⋮ gets focus back once its window has closed and nothing is out. */
  #focusReturn: { menuId: string; key: string } | null = null;
  #windowShut = false;
  /** What a home page tile may point at: the active products and the sections the structure
   * reaches. The server checks reach by membership alone; an inactive product is not offered. */
  #tileProducts: { id: string; name: string }[] = [];
  #tileSections: { id: string; internalName: string }[] = [];
  readonly #writes = new ListWriteQueue();
  readonly #priceWrites = new ListWriteQueue();
  #priceSavesMade = 0;
  /** Fields whose save was stored while a later save waited behind it. They stay marked saving
   * until the last save made ends, after the re-read that carries their prices when one runs. */
  readonly #pricesUnread = new Set<string>();
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
    this.#returnFocus();
    if (!changed.has("layout") || this.layout !== "narrow") return;
    const table = this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      'wt-data-table[data-test="menus"]',
    );
    if (table?.sortKey !== "status") return;
    table.sortKey = "name";
    table.sortDirection = "ascending";
  }

  protected override willUpdate(changed: PropertyValues): void {
    // The size report comes a frame after the list is drawn, and a table redrawn in another layout
    // replaces the link a person may already have focused.
    if (this.menuId === null && (changed.has("menuId") || changed.has("loading")))
      this.layout = this.#measuredLayout();
    if (changed.has("menus") || changed.has("statuses") || changed.has("statusesError"))
      this.#rows = this.menus.map((menu) => ({
        ...menu,
        status: this.statuses?.[menu.id] ?? (this.statusesError ? "failed" : "loading"),
      }));
    if (changed.has("structure")) {
      this.#sectionNames = new Map(this.sections.map(({ id, internalName }) => [id, internalName]));
    }
    if (changed.has("structure") || changed.has("path")) {
      this.#resolvePath();
      this.#closeLostList();
    }
    if (changed.has("structure")) {
      const reached = reachable(this.structure?.nodes ?? []);
      this.#onMenu = reached.products;
    }
    if (changed.has("structure") || changed.has("addingProducts")) {
      const target = this.addingProducts;
      const nodes = target ? (placesOf(this.structure, target.listId)[0] ?? []) : [];
      this.#pickerHeld = nodes.flatMap(({ ref }) =>
        ref.kind === "product" ? [ref.productId] : [],
      );
    }
    if (changed.has("products")) this.#addable = this.products.filter((product) => product.active);
    if (changed.has("structure") || changed.has("products")) {
      const products = new Map(
        this.products.filter((product) => product.active).map(({ id, name }) => [id, name]),
      );
      const foundProducts = new Map<string, string>();
      const foundSections = new Map<string, string>();
      const visit = (nodes: MenuStructureNode[], path: string[]) => {
        for (const node of nodes) {
          if (node.ref.kind === "product") {
            const name = products.get(node.ref.productId);
            if (name !== undefined && !foundProducts.has(node.ref.productId))
              foundProducts.set(node.ref.productId, [...path, name].join(" › "));
          } else {
            const next = [...path, node.internalName ?? ""];
            if (!foundSections.has(node.ref.sectionId))
              foundSections.set(node.ref.sectionId, next.join(" › "));
            visit(node.children ?? [], next);
          }
        }
      };
      visit(this.structure?.nodes ?? [], []);
      this.#tileProducts = [...foundProducts].map(([id, name]) => ({ id, name }));
      this.#tileSections = [...foundSections].map(([id, internalName]) => ({ id, internalName }));
    }
  }

  /** Keeps the longest part of the path the structure still has, and derives the list it names. */
  #resolvePath(): void {
    const trail = trailOf(this.structure, this.path);
    if (trail.length < this.path.length) this.path = this.path.slice(0, trail.length);
    this.#listId = listIdOf(this.structure, trail);
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
    const target = this.addingProducts ?? this.creatingSection ?? this.includingMenu;
    if (target === null || this.busy) return false;
    if (target.menuId === this.menuId && (this.structure === null || this.#holds(target)))
      return false;
    this.addingProducts = null;
    this.creatingSection = null;
    this.includingMenu = null;
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
    this.includingMenu = null;
    return true;
  }

  /** The list the tree row at `path` holds: the menu's top level for `[]`. */
  #targetAt(path: string[]): ListTarget {
    const trail = trailOf(this.structure, path);
    const last = trail.at(-1);
    return {
      menuId: this.menuId!,
      path,
      listId: listIdOf(this.structure, trail)!,
      name: last ? this.#nodeName(last) : this.#menuName(),
    };
  }

  // ── Loading and the address ─────────────────────────────────────────────────────────────────

  async #load(): Promise<void> {
    this.loadError = false;
    this.#followStatus();
    try {
      await Promise.all([
        this.#watchMenus(),
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

  async #watchStructure(): Promise<void> {
    const menuId = this.menuId;
    if (menuId === null) return;
    this.structureError = false;
    try {
      await this.#structureQueries.watch("getMenuStructure", [menuId], (value) => {
        if (this.menuId === menuId) {
          this.structure = value;
          if (value.includedBy.length)
            void this.#statusQueries
              .watch("getMenuStatuses", [], (statuses) => {
                this.statuses = statuses;
              })
              .catch(() => undefined);
        }
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
    if (!this.structure?.includedBy.length) this.#statusQueries.release("getMenuStatuses");
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

  /** The query slot holds one watch, so watching another menu's layouts stops the earlier one. */
  async #watchHome(menuId: string): Promise<void> {
    this.#homeFor = menuId;
    this.homeLoadError = false;
    try {
      await this.#homeQueries.watch("listHomeLayouts", [menuId], (value) => {
        this.homeLayouts = value;
        this.homeLoadError = false;
      });
    } catch {
      if (this.#homeFor === menuId) this.homeLoadError = true;
    }
  }

  #releaseHome(): void {
    this.#homeFor = null;
    this.#homeQueries.release("listHomeLayouts");
    this.homeLayouts = null;
    this.homeLoadError = false;
    this.homeError = null;
  }

  /** Also forgets the rows, so the tab shows loading rather than old rows until the next read. */
  #releasePrices(): void {
    this.#pricesFor = null;
    this.#priceQueries.release("getMenuPrices");
    this.prices = null;
    this.pricesError = false;
  }

  /** The prices are watched only while the Price overrides tab is shown: the structure edits made
   * on the other tab write tables the prices read depends on. The preview likewise. */
  #showView(view: Tab): void {
    this.view = view;
    this.#followStatus();
    if (view !== "preview") this.#releasePreview();
    else if (this.menuId !== null && this.#previewFor !== this.menuId)
      void this.#watchPreview(this.menuId);
    if (view !== "home") this.#releaseHome();
    else if (this.menuId !== null && this.#homeFor !== this.menuId)
      void this.#watchHome(this.menuId);
    if (view !== "prices") {
      this.priceRefusals = {};
      this.priceOutcome = null;
      this.#releasePrices();
    } else if (this.menuId !== null && this.#pricesFor !== this.menuId)
      void this.#watchPrices(this.menuId);
  }

  /** A write that succeeded is never reported as a failed one: a failure here is a load failure. */
  async #refresh(): Promise<void> {
    await this.#watchStructure();
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "menus") {
      this.#menuFormGeneration++;
      this.menuForm = null;
      return;
    }
    this.#select(this.#url.read("menu"));
    const view = this.#url.read("view");
    this.#showView(isTab(view) ? view : TABS[0]);
    this.#checkAddress();
  }

  #select(menuId: string | null): void {
    if (menuId === this.menuId) return;
    this.#menuFormGeneration++;
    this.menuForm = null;
    this.menuId = menuId;
    this.path = [];
    this.structure = null;
    this.structureError = false;
    this.memberError = null;
    this.priceRefusals = {};
    this.priceOutcome = null;
    this.publishResult = null;
    this.#releasePrices();
    this.#releasePreview();
    this.#releaseHome();
    this.homeLayoutId = "";
    this.layoutForm = null;
    this.deletingLayout = null;
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

  #open(menuId: string, view: Tab = TABS[0]): void {
    this.#select(menuId);
    this.#showView(view);
    this.#url.write({ dashboard: "menus", menu: menuId, view });
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

  // ── Menus ────────────────────────────────────────────────────────────────────────────────────

  override disconnectedCallback(): void {
    this.#menuFormGeneration++;
    super.disconnectedCallback();
  }

  /** The Add menu that opened the create form, which the closing dialog hands focus back to. */
  #addOpener: HTMLElement | null = null;

  async #openMenuForm(menu: CatalogueSummary | null): Promise<void> {
    const generation = ++this.#menuFormGeneration;
    this.menuFormErrors = {};
    this.menuDetails = null;
    this.menuForm = null;
    let details: SectionDetails | null = null;
    if (menu) {
      try {
        details = (await this.api.getMenuStructure(menu.id)).root;
      } catch {
        if (generation === this.#menuFormGeneration) this.loadError = true;
        return;
      }
    }
    if (generation !== this.#menuFormGeneration) return;
    this.menuDetails = details;
    this.menuForm = { id: menu?.id ?? null, name: menu?.name ?? "" };
  }

  #restart(form: string): void {
    this.attempted = new Set([...this.attempted].filter((open) => open !== form));
  }

  #attempt(form: string): void {
    this.attempted = new Set([...this.attempted, form]);
  }

  /** Moves focus to the first invalid field of the modal `form`, once it has rendered. */
  async #focusInvalid(form: string): Promise<void> {
    await this.updateComplete;
    const modal = this.shadowRoot!.querySelector(`wt-modal[data-test="${form}"]`);
    if (modal) await focusFirstInvalid(modal);
  }

  /** A name form's messages: its refusal, and once Save has been pressed, `required` while the
   * name is blank — which alone holds Save. */
  #nameFormErrors(
    form: string,
    refused: Record<string, string>,
    field: string,
    value: string,
    required: string,
  ): { errors: Record<string, string>; placed: { blocked: boolean; bottom: string } } {
    const blank = this.attempted.has(form) && value.trim() === "";
    const errors = { ...refused, ...(blank ? { [field]: required } : {}) };
    return { errors, placed: { blocked: blank, bottom: bottomMessage(errors, new Set([field])) } };
  }

  async #saveMenu(input: SectionInput): Promise<void> {
    const form = this.menuForm;
    if (!form || this.busy) return;
    this.busy = true;
    this.menuFormErrors = {};
    try {
      if (form.id === null) {
        const { internalName, ...details } = input;
        await this.api.createCatalogue(internalName, details);
      } else await this.api.updateMenuDetails(form.id, input);
    } catch (error) {
      const errors = refusal(error);
      this.menuFormErrors = errors.name ? { internalName: errors.name } : errors;
      this.busy = false;
      return;
    }
    const opener = form.id === null ? this.#addOpener : null;
    this.busy = false;
    this.menuForm = null;
    await this.#watchMenus().catch(() => undefined);
    await this.updateComplete;
    // The empty table's Add menu is gone once the menu it made is listed.
    if (opener?.isConnected === false)
      this.renderRoot.querySelector<HTMLElement>('.header [data-test="add-menu"]')?.focus();
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
    const warnings = this.preview?.warnings ?? [];
    this.publishing = new Set([...this.publishing, menuId]);
    this.publishResult = null;
    let result: PublishResult;
    try {
      result = {
        kind: "published",
        number: (await this.api.publishMenu(menuId, hash)).number,
        warnings,
      };
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

  /** Adds and removes hold `busy`, which disables the tree until the menu is read again. */
  #listWrite(path: string[], write: (listId: string) => Promise<unknown>): void {
    const target = this.#targetAt(path);
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
  #move(path: string[], memberId: string, to: number): void {
    const target = this.#targetAt(path);
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
        // With no version to compare, the answer is shown only when the list's order on screen, is exactly the one this move was sent over, one an earlier move
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

  #edit(path: string[]): void {
    this.path = path;
    this.memberError = null;
  }

  /** Opens an add's window on the list the tree row at `path` holds, which becomes current. */
  #openAdd(action: StructureAddAction, path: string[]): void {
    this.#edit(path);
    this.#returnFocusTo(path);
    const target = this.#targetAt(path);
    if (action === "new-section") {
      this.creatingSection = target;
      this.editingSection = null;
      this.newSectionErrors = {};
    } else if (action === "include-menu") {
      this.includingMenu = target;
      this.includedRoot = "";
      this.includeError = "";
    } else {
      this.addingProducts = target;
      this.addProductsError = null;
    }
  }

  #returnFocusTo(path: string[], shut = false): void {
    this.#focusReturn = { menuId: this.menuId!, key: path.join("/") || "root" };
    this.#windowShut = shut;
  }

  /** A window's close is reported after the dialog has put focus back. */
  #windowClosed(): void {
    this.#windowShut = true;
    this.requestUpdate();
  }

  /** Waits for the write out to be read back: the tree's rows are not keyed, so a ⋮ focused
   * before the read lands can end up on another row. */
  #returnFocus(): void {
    const target = this.#focusReturn;
    if (!target || !this.#windowShut || this.busy) return;
    this.#focusReturn = null;
    if (target.menuId === this.menuId)
      this.renderRoot.querySelector("dashboard-menu-structure-table")?.focusRowMenu(target.key);
  }

  #saveSection(input: SectionInput): void {
    if (this.busy) return;
    const target = this.creatingSection;
    const editing = this.editingSection;
    if (!editing && (!target || this.#closeLostList())) return;
    this.busy = true;
    this.newSectionErrors = {};
    this.#writes.run(editing?.id ?? target!.listId, async () => {
      try {
        if (editing) await this.api.updateSection(editing.id, input);
        else await this.api.createSectionIn(target!.listId, input);
      } catch (error) {
        if (editing || !this.#closeRefusedElsewhere(target!, error))
          this.newSectionErrors = refusal(error);
        this.busy = false;
        return;
      }
      this.creatingSection = null;
      this.editingSection = null;
      await this.#refresh();
      if (target) this.#reportSavedToLost(target);
      this.busy = false;
    });
  }

  async #deleteSection(): Promise<void> {
    const section = this.deletingSection;
    if (!section || this.busy) return;
    this.busy = true;
    this.deleteSectionError = "";
    try {
      await this.api.deleteSection(section.id);
    } catch (error) {
      this.deleteSectionError = codeMessage(codeOf(error));
      this.busy = false;
      return;
    }
    this.deletingSection = null;
    await this.#refresh();
    this.busy = false;
  }

  async #includeMenu(): Promise<void> {
    if (this.busy || !this.includingMenu || this.#closeLostList()) return;
    this.includeError = "";
    const target = this.includingMenu;
    this.busy = true;
    try {
      await this.api.addSectionMember(target.listId, {
        kind: "section",
        sectionId: this.includedRoot,
      });
    } catch (error) {
      if (!this.#closeRefusedElsewhere(target, error))
        this.includeError = codeMessage(codeOf(error));
      this.busy = false;
      return;
    }
    this.includingMenu = null;
    await this.#refresh();
    this.#reportSavedToLost(target);
    this.busy = false;
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

  // ── Home page ────────────────────────────────────────────────────────────────────────────────

  /** Reads the layouts again after a write, when their tab still shows the same menu. */
  async #rereadHome(menuId: string): Promise<void> {
    if (this.menuId === menuId && this.view === "home") await this.#watchHome(menuId);
  }

  /** Adds, removes and a new default hold `busy` until the layouts are read again. A tile write's
   * scope is its layout, as a move's is, so a move knows when another write to it waits behind. */
  #homeWrite(
    scope: string,
    write: () => Promise<unknown>,
    replacement?: (error?: unknown) => void,
  ): void {
    const menuId = this.menuId!;
    this.homeError = null;
    this.busy = true;
    this.#writes.run(scope, async () => {
      try {
        await write();
      } catch (error) {
        const shownLayout =
          this.homeLayouts?.find((layout) => layout.id === this.homeLayoutId)?.id ??
          this.homeLayouts?.[0]?.id;
        if (this.menuId === menuId && (!replacement || shownLayout === scope)) {
          if (replacement) replacement(error);
          else this.homeError = codeMessage(codeOf(error));
        }
        if (!replacement || this.menuId === menuId) this.busy = false;
        return;
      }
      replacement?.();
      await this.#rereadHome(menuId);
      if (!replacement || this.menuId === menuId) this.busy = false;
    });
  }

  /** The layout's tile ids in the order shown. */
  #tileOrder(layoutId: string): string[] {
    const layout = this.homeLayouts?.find(({ id }) => id === layoutId);
    return (layout?.tiles ?? []).map(({ memberId }) => memberId);
  }

  /** Not `busy`, as for a move in the Structure tab: the keyboard user's focus stays on the row. The
   * last queued write's answer is shown only while the order on screen is the one the move was sent
   * over, or the answer itself; any other order may be a newer change, so the layouts are read
   * again. */
  #moveTile(layoutId: string, memberId: string, to: number): void {
    const menuId = this.menuId!;
    this.homeError = null;
    let sentOver: string[] = [];
    this.#writes.move(
      layoutId,
      () => {
        sentOver = this.#tileOrder(layoutId);
        return this.api.moveHomeTile(layoutId, memberId, to);
      },
      async (ordered, last) => {
        if (!last || this.menuId !== menuId || this.homeLayouts === null) return;
        const layout = this.homeLayouts.find(({ id }) => id === layoutId);
        const tiles = new Map(layout?.tiles.map((tile) => [tile.memberId, tile]));
        const shown = this.#tileOrder(layoutId).join(" ");
        const answer = ordered.map(({ id }) => id);
        if (
          ordered.length !== tiles.size ||
          ordered.some(({ id }) => !tiles.has(id)) ||
          (shown !== sentOver.join(" ") && shown !== answer.join(" "))
        ) {
          await this.#rereadHome(menuId);
          return;
        }
        this.homeLayouts = this.homeLayouts.map((each) =>
          each.id === layoutId
            ? {
                ...each,
                tiles: ordered.map(({ id }, position) => ({ ...tiles.get(id)!, position })),
              }
            : each,
        );
      },
      async (error) => {
        if (this.menuId !== menuId) return;
        this.homeError = codeMessage(codeOf(error));
        await this.#rereadHome(menuId);
      },
    );
  }

  #openLayoutForm(kind: "create" | "duplicate" | "rename", layoutId: string | null): void {
    const name = this.homeLayouts?.find(({ id }) => id === layoutId)?.name ?? "";
    this.layoutForm = { kind, layoutId, name };
    this.layoutFormName =
      kind === "duplicate"
        ? t("sections.copy_name").replace("{name}", name)
        : kind === "rename"
          ? name
          : "";
    this.layoutFormErrors = {};
    this.#restart("layout-form");
  }

  /** A new layout or a copy is the one edited next. */
  async #saveLayout(): Promise<void> {
    const form = this.layoutForm;
    if (form === null || this.busy) return;
    this.#attempt("layout-form");
    this.layoutFormErrors = {};
    const name = this.layoutFormName.trim();
    if (name === "") {
      void this.#focusInvalid("layout-form");
      return;
    }
    const menuId = this.menuId!;
    this.busy = true;
    let made: string | null = null;
    try {
      if (form.kind === "create") made = (await this.api.createHomeLayout(menuId, name)).id;
      else if (form.kind === "duplicate")
        made = (await this.api.duplicateHomeLayout(form.layoutId!, name)).id;
      else await this.api.renameHomeLayout(form.layoutId!, name);
    } catch (error) {
      this.layoutFormErrors = refusal(error);
      this.busy = false;
      void this.#focusInvalid("layout-form");
      return;
    }
    this.busy = false;
    this.layoutForm = null;
    if (made !== null && this.menuId === menuId) this.homeLayoutId = made;
    await this.#rereadHome(menuId);
  }

  #openDeleteLayout(layoutId: string): void {
    const layout = this.homeLayouts?.find(({ id }) => id === layoutId);
    if (layout === undefined) return;
    this.deletingLayout = { id: layout.id, name: layout.name };
    this.deleteLayoutError = null;
  }

  async #deleteLayout(): Promise<void> {
    const target = this.deletingLayout;
    if (target === null || this.busy) return;
    const menuId = this.menuId!;
    this.busy = true;
    this.deleteLayoutError = null;
    try {
      await this.api.deleteHomeLayout(target.id);
    } catch (error) {
      this.deleteLayoutError = codeMessage(codeOf(error));
      this.busy = false;
      return;
    }
    this.busy = false;
    this.deletingLayout = null;
    await this.#rereadHome(menuId);
  }

  // ── Prices ───────────────────────────────────────────────────────────────────────────────────

  /** Unmarks the field of the save ending, `key`, and the fields a re-read has just carried, each
   * unless another save of it waits. Called by the save's own task before it ends, so the queue
   * still counts that save. */
  #priceSaveDone(key: string, carried: readonly string[] = []): void {
    const saving = new Set(this.savingPrices);
    for (const done of [key, ...carried])
      if (this.#priceWrites.pending(done) <= (done === key ? 1 : 0)) saving.delete(done);
    if (saving.size !== this.savingPrices.size) this.savingPrices = saving;
  }

  /** One field per request, in the order made; each field stays editable meanwhile. A refusal is
   * said in the tab's status line, and under the field when it names the price; once the menu,
   * the tab or the row has gone, it is named beside the list instead. The prices are read again
   * only after the last save made, and only when it or an earlier one was stored. A success is said
   * only for the last save made, so its Undo never reaches past a later write; never over a refusal
   * said since it was made, which would hide that refusal; and not over a failed re-read, which
   * the list reports as a load failure. */
  #savePrice(save: PriceSave): void {
    const menuId = this.menuId;
    if (menuId === null) return;
    const made = ++this.#priceSavesMade;
    this.priceRefusals = without(this.priceRefusals, [save.key]);
    this.priceOutcome = null;
    this.savingPrices = new Set(this.savingPrices).add(save.key);
    this.#priceWrites.run(save.key, async () => {
      let stored = true;
      try {
        if (save.variantId === null)
          await this.api.updateMenuItem(menuId, save.menuItemId, { grossPrice: save.price });
        else
          await this.api.setMenuVariantPrice(menuId, save.menuItemId, save.variantId, save.price);
      } catch (error) {
        stored = false;
        const reason = codeMessage(codeOf(error));
        const shown =
          this.menuId === menuId &&
          this.view === "prices" &&
          (this.prices ?? []).some(({ menuItemId }) => menuItemId === save.menuItemId);
        if (shown) {
          if (namesThePrice(error, save))
            this.priceRefusals = { ...this.priceRefusals, [save.key]: reason };
          this.priceOutcome = { kind: "refused", save, reason };
        } else
          this.memberError = t("menus.change_not_saved")
            .replace("{name}", save.name)
            .replace("{reason}", reason);
      }
      // Saves are answered in the order made, so a refusal under this field came from an earlier
      // save, and the field now holds a price that was stored.
      if (stored && save.key in this.priceRefusals)
        this.priceRefusals = without(this.priceRefusals, [save.key]);
      if (made !== this.#priceSavesMade) {
        if (stored) this.#pricesUnread.add(save.key);
        else this.#priceSaveDone(save.key);
        return;
      }
      const reread =
        (stored || this.#pricesUnread.size > 0) && this.menuId === menuId && this.view === "prices";
      if (reread) {
        await this.#watchPrices(menuId);
        const shown = this.menuId === menuId && this.view === "prices" && !this.pricesError;
        if (stored && shown && made === this.#priceSavesMade && this.priceOutcome === null)
          this.priceOutcome = { kind: "saved", save };
      }
      const carried = [...this.#pricesUnread];
      this.#pricesUnread.clear();
      this.#priceSaveDone(save.key, carried);
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────

  #statusCell(menu: MenuRow) {
    const test = `status-${menu.id}`;
    if (typeof menu.status === "string")
      return html`<span part="status muted" data-test=${test}
        >${t(menu.status === "loading" ? "menus.status_loading" : "menus.status_error")}</span
      >`;
    // The list's Status says what is live; a changed menu's drafts have the changes link.
    const { label, live } = statusWords(
      menu.status.state === "changed" ? { ...menu.status, state: "current" } : menu.status,
    );
    return html`<span part="status" data-test=${test}
      >${label}${menu.status.clashes ? html` <span part="clash">${menu.status.clashes} ${t(menu.status.clashes === 1 ? "menus.clash" : "menus.clashes")}</span>` : nothing}${
        live === null
          ? nothing
          : html` <span part="note">${live.version} · <span part="time">${live.time}</span></span>`
      }</span
    >`;
  }

  /** Only a menu with a live version can have changes to it; one never published has none. */
  #changesCell(menu: MenuRow) {
    if (typeof menu.status === "string" || menu.status.state !== "changed") return nothing;
    const label = t("menus.changes_link");
    return html`<a
      part="changes-link"
      data-test=${`changes-${menu.id}`}
      href=${previewAddress(menu.id)}
      aria-label=${`${label}: ${menu.name}`}
      @click=${(event: MouseEvent) => this.#openPreview(event, menu.id)}
      >${label}</a
    >`;
  }

  #openPreview(event: MouseEvent, menuId: string): void {
    if (leftToBrowser(event)) return;
    event.preventDefault();
    this.#open(menuId, "preview");
  }

  /** On a narrow list the status and the changes link move under the name and their columns go, as
   * the variants table does with its prices (docs/developers/design-system.md); between narrow and
   * wide the link moves under the status and its column goes. */
  #buildColumns(layout: ListLayout): DataTableColumn<MenuRow>[] {
    const narrow = layout === "narrow";
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
          ? (menu) => {
              const changes = this.#changesCell(menu);
              return html`${name(menu)}
                <span part="stacked">${this.#statusCell(menu)}</span>
                ${changes === nothing ? nothing : html`<span part="stacked">${changes}</span>`}`;
            }
          : name,
      },
      ...(narrow
        ? []
        : [
            {
              key: "status",
              label: t("menus.status"),
              choosable: "shown" as const,
              sortValue: (menu: MenuRow) =>
                STATUS_ORDER.indexOf(
                  typeof menu.status === "string" ? menu.status : menu.status.state,
                ),
              cell:
                layout === "middle"
                  ? (menu: MenuRow) => html`${this.#statusCell(menu)}${this.#changesCell(menu)}`
                  : (menu: MenuRow) => this.#statusCell(menu),
            },
            ...(layout === "middle"
              ? []
              : [
                  {
                    key: "changes",
                    label: t("menus.changes"),
                    choosable: "shown" as const,
                    activatesRow: false as const,
                    cell: (menu: MenuRow) => this.#changesCell(menu),
                  },
                ]),
          ]),
      {
        key: "actions",
        label: t("menus.actions"),
        pinned: "end",
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

  #formModal(
    options: {
      test: string;
      open: boolean;
      heading: string;
      body: unknown;
      /** The message above Save, and whether a field the form finds wrong holds it. */
      errors?: { blocked: boolean; bottom: string };
      close: () => void;
      /** Told whenever the dialog has closed, however it was closed. */
      closed?: () => void;
    } & (
      | {
          save: string;
          saveLabel: string;
          saveVariant?: "primary" | "danger";
          submit: () => void;
        }
      | { save?: never; saveLabel?: never; saveVariant?: never; submit?: never }
    ),
  ) {
    // A shut dialog holds no message: a form's errors clear only when it next opens, and the dialog
    // scrolls to its footer row's message as it opens, before the row has taken the cleared one.
    const message = options.open ? (options.errors?.bottom ?? "") : "";
    return html`<wt-modal
      size="compact"
      data-test=${options.test}
      .open=${options.open}
      heading=${options.heading}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) options.close();
        options.closed?.();
      }}
    >
      ${options.open ? options.body : nothing}
      ${options.test.startsWith("layout-") ? nothing : html`<p class="field-error" role="alert" data-test="form-error">${message || nothing}</p>`}
      <wt-form-actions slot="footer" .error=${options.test.startsWith("layout-") ? message : ""}
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test=${`${options.test}-cancel`}
          .disabled=${this.busy}
          @click=${() => {
            if (!this.busy) options.close();
          }}
          >${t("action.cancel")}</wt-button
        >${
          options.save
            ? html`<wt-button
                variant=${options.saveVariant ?? "primary"}
                data-test=${options.save}
                .disabled=${this.busy || options.errors?.blocked === true}
                @click=${options.submit}
                >${options.saveLabel}</wt-button
              >`
            : nothing
        }</wt-form-actions
      >
    </wt-modal>`;
  }

  #renderMenuForm() {
    return html`<dashboard-section-details-form
      data-test="menu-form"
      .nameLabel=${t("menus.name")}
      .nameRequired=${t("menus.name_required")}
      .open=${this.menuForm !== null}
      .busy=${this.busy}
      .api=${this.api}
      .languages=${currentContentLanguages()}
      .value=${this.menuDetails}
      .fieldErrors=${this.menuFormErrors}
      heading=${this.menuForm?.id ? t("menus.rename_heading").replace("{name}", this.menuForm.name) : t("menus.create")}
      @wt-submit=${(event: CustomEvent<SectionInput>) => {
        event.stopPropagation();
        void this.#saveMenu(event.detail);
      }}
      @wt-cancel=${(event: Event) => {
        event.stopPropagation();
        this.#menuFormGeneration++;
        this.menuForm = null;
      }}
    ></dashboard-section-details-form>`;
  }

  /** The probes are observed rather than the list: a probe's width follows the list's container,
   * not the table's contents. */
  #observeNarrowProbe = (probe: Element | undefined): void => this.#observeProbe("narrow", probe);
  #observeWideProbe = (probe: Element | undefined): void => this.#observeProbe("wide", probe);

  #measuredLayout(): ListLayout {
    const shown = (which: "narrow" | "wide") => {
      const found = this.#probes.get(which);
      return found !== undefined && getComputedStyle(found).display !== "none";
    };
    return shown("narrow") ? "narrow" : shown("wide") ? "wide" : "middle";
  }

  #observeProbe(kind: "narrow" | "wide", probe: Element | undefined): void {
    const before = this.#probes.get(kind);
    if (before !== undefined) this.#listSize?.unobserve(before);
    this.#probes.delete(kind);
    if (probe === undefined) return;
    this.#probes.set(kind, probe);
    this.#listSize ??= new ResizeObserver(() => {
      this.layout = this.#measuredLayout();
    });
    this.#listSize.observe(probe);
  }

  #renderAddMenu(slot?: "empty-action") {
    return html`<wt-button
      data-test="add-menu"
      slot=${ifDefined(slot)}
      variant="primary"
      @click=${(event: Event) => {
        this.#addOpener = event.currentTarget as HTMLElement;
        void this.#openMenuForm(null);
      }}
      >${t("menus.add")}</wt-button
    >`;
  }

  #renderList() {
    const loaded = !this.loading && !this.loadError;
    return html`<div class="header">
        <h1>${t("menus.title")}</h1>
        ${loaded ? this.#renderAddMenu() : nothing}
      </div>
      ${this.#renderLoadState()} ${this.#renderMemberError()}
      ${
        loaded
          ? html`<div class="list">
              <wt-data-table
                noMatchesMessage=${tableNoMatches()}
                data-test="menus"
                class=${this.layout}
                aria-label=${t("menus.title")}
                top-aligned
                viewKey="waitron.menus.list.table"
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
                sortKey="name"
                sortDirection="ascending"
                .rows=${this.#rows}
                .columns=${this.#columns[this.layout]}
                .rowKey=${(menu: MenuRow) => menu.id}
                .rowClick=${(menu: MenuRow) => this.#open(menu.id)}
                .rowClickLabel=${(menu: MenuRow) => `${t("menus.open")}: ${menu.name}`}
                .emptyMessage=${t("menus.empty")}
                >${this.#rows.length === 0 ? this.#renderAddMenu("empty-action") : nothing}</wt-data-table
              >
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
      ${(structure.includedBy ?? []).length ? html`<p data-test="included-by">${t("menus.included_in")}: ${structure.includedBy.map((menu, index) => html`${index ? ", " : ""}<a href=${`/manage/menus/menu/${menu.id}/view/structure`}>${menu.name}${this.statuses?.[menu.id]?.clashes ? ` (${this.statuses[menu.id]!.clashes} ${t(this.statuses[menu.id]!.clashes === 1 ? "menus.clash" : "menus.clashes")})` : ""}</a>`)}</p>` : nothing}
      <dashboard-menu-structure-table
        .nodes=${structure.nodes}
        .products=${this.products}
        .categories=${this.categories}
        .current=${this.path}
        .busy=${this.busy}
        menuName=${this.#menuName()}
        @wt-structure-edit=${(event: CustomEvent<{ path: string[] }>) => {
          event.stopPropagation();
          this.#edit(event.detail.path);
        }}
        @wt-structure-add=${(
          event: CustomEvent<{ action: StructureAddAction; path: string[] }>,
        ) => {
          event.stopPropagation();
          this.#openAdd(event.detail.action, event.detail.path);
        }}
        @wt-member-remove=${(event: CustomEvent<{ path: string[]; memberId: string }>) => {
          event.stopPropagation();
          const { path, memberId } = event.detail;
          this.#returnFocusTo(path, true);
          this.#listWrite(path, (id) => this.api.removeSectionMember(id, memberId));
        }}
        @wt-member-move=${(
          event: CustomEvent<{ path: string[]; memberId: string; to: number }>,
        ) => {
          event.stopPropagation();
          const { path, memberId, to } = event.detail;
          this.#move(path, memberId, to);
        }}
        @wt-member-edit=${(event: CustomEvent<{ sectionId: string; path: string[] }>) => {
          event.stopPropagation();
          this.#returnFocusTo(event.detail.path);
          this.editingSection =
            this.sections.find((section) => section.id === event.detail.sectionId) ?? null;
          this.newSectionErrors = {};
        }}
        @wt-product-color=${(event: CustomEvent<{ productId: string }>) => {
          event.stopPropagation();
          this.colouring =
            this.products.find((product) => product.id === event.detail.productId) ?? null;
          this.colorErrors = {};
        }}
        @wt-member-delete=${(event: CustomEvent<{ sectionId: string; path: string[] }>) => {
          event.stopPropagation();
          this.#returnFocusTo(event.detail.path);
          this.deletingSection =
            this.sections.find((section) => section.id === event.detail.sectionId) ?? null;
          this.deleteSectionError = "";
        }}
      ></dashboard-menu-structure-table>`;
  }

  #renderPrices() {
    return html`<dashboard-menu-prices-table
        .nodes=${this.structure?.nodes ?? []}
        .rows=${this.prices ?? []}
        .loading=${this.prices === null && !this.pricesError}
        .failed=${this.pricesError}
        .sections=${this.sections}
        .categories=${this.categories}
        .products=${this.products}
        menuName=${this.#menuName()}
        .saving=${this.savingPrices}
        .refusals=${this.priceRefusals}
        .outcome=${this.priceOutcome}
        @wt-price-save=${(event: CustomEvent<PriceSave>) => {
          event.stopPropagation();
          this.#savePrice(event.detail);
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

  #renderHome() {
    const error = this.homeError
      ? html`<p class="error" role="alert" data-test="home-error">${this.homeError}</p>`
      : nothing;
    const loadError = this.homeLoadError
      ? html`<p class="error" role="alert" data-test="home-load-error">${t("home.error")}</p>
          <div>
            <wt-button
              data-test="home-retry"
              variant="secondary"
              @click=${() => void this.#watchHome(this.menuId!)}
              >${t("menus.retry")}</wt-button
            >
          </div>`
      : nothing;
    if (this.homeLayouts === null)
      return html`${error}${loadError}${
        this.homeLoadError
          ? nothing
          : html`<p role="status" data-test="home-loading">${t("home.loading")}</p>`
      }`;
    const layoutId = (event: CustomEvent<{ layoutId: string }>): string => {
      event.stopPropagation();
      return event.detail.layoutId;
    };
    return html`${error}${loadError}
      <dashboard-home-layout-editor
        .layouts=${this.homeLayouts}
        selected=${this.homeLayoutId}
        .products=${this.#tileProducts}
        .sections=${this.#tileSections}
        .busy=${this.busy}
        menuName=${this.#menuName()}
        @wt-layout-select=${(event: CustomEvent<{ layoutId: string }>) => {
          this.homeLayoutId = layoutId(event);
          this.homeError = null;
        }}
        @wt-layout-add=${(event: Event) => {
          event.stopPropagation();
          this.#openLayoutForm("create", null);
        }}
        @wt-layout-rename=${(event: CustomEvent<{ layoutId: string }>) =>
          this.#openLayoutForm("rename", layoutId(event))}
        @wt-layout-duplicate=${(event: CustomEvent<{ layoutId: string }>) =>
          this.#openLayoutForm("duplicate", layoutId(event))}
        @wt-layout-delete=${(event: CustomEvent<{ layoutId: string }>) =>
          this.#openDeleteLayout(layoutId(event))}
        @wt-layout-default=${(event: CustomEvent<{ layoutId: string }>) => {
          const id = layoutId(event);
          const menuId = this.menuId!;
          // The editor stays on the layout it shows, which would otherwise be whichever layout
          // is the default, and so first, after the read.
          this.homeLayoutId =
            this.homeLayouts?.find(({ id: shown }) => shown === this.homeLayoutId)?.id ??
            this.homeLayouts?.[0]?.id ??
            "";
          this.#homeWrite(`home:${menuId}`, () => this.api.setDefaultHomeLayout(menuId, id));
        }}
        @wt-tile-add=${(event: CustomEvent<{ layoutId: string; ref: MemberRef }>) => {
          event.stopPropagation();
          const { layoutId: id, ref } = event.detail;
          this.#homeWrite(id, () => this.api.addHomeTile(id, ref));
        }}
        @wt-tile-replace=${(
          event: CustomEvent<{ layoutId: string; memberId: string; ref: MemberRef }>,
        ) => {
          event.stopPropagation();
          const { layoutId: id, memberId, ref } = event.detail;
          const complete = (
            event.currentTarget as HTMLElementTagNameMap["dashboard-home-layout-editor"]
          ).replacementCompletion(memberId);
          this.#homeWrite(
            id,
            () => this.api.replaceHomeTile(id, memberId, ref),
            (error) => {
              const code = codeOf(error);
              const params = (
                error as { params?: { ref?: MemberRef; sectionId?: string } } | undefined
              )?.params;
              const field =
                (code === "menu.shortcut_unreachable" &&
                  params?.ref?.kind === ref.kind &&
                  (ref.kind === "product"
                    ? params.ref.kind === "product" && params.ref.productId === ref.productId
                    : params.ref.kind === "section" && params.ref.sectionId === ref.sectionId)) ||
                (ref.kind === "section" &&
                  (code === "menu_section.not_found" || code === "menu_section.wrong_role") &&
                  params?.sectionId === ref.sectionId);
              complete(error === undefined ? "" : codeMessage(code), field);
            },
          );
        }}
        @wt-tile-remove=${(event: CustomEvent<{ layoutId: string; memberId: string }>) => {
          event.stopPropagation();
          const { layoutId: id, memberId } = event.detail;
          this.#homeWrite(id, () => this.api.removeHomeTile(id, memberId));
        }}
        @wt-tile-move=${(
          event: CustomEvent<{ layoutId: string; memberId: string; to: number }>,
        ) => {
          event.stopPropagation();
          this.#moveTile(event.detail.layoutId, event.detail.memberId, event.detail.to);
        }}
      ></dashboard-home-layout-editor>`;
  }

  #renderLayoutForm() {
    const form = this.layoutForm;
    const { errors, placed } = this.#nameFormErrors(
      "layout-form",
      this.layoutFormErrors,
      "name",
      this.layoutFormName,
      t("home.name_required"),
    );
    const heading =
      form === null
        ? ""
        : form.kind === "create"
          ? t("home.create_heading")
          : t(form.kind === "duplicate" ? "home.duplicate_heading" : "home.rename_heading").replace(
              "{name}",
              form.name,
            );
    return this.#formModal({
      test: "layout-form",
      open: form !== null,
      heading,
      body: html`<div class="fields">
        ${this.#nameInput({
          name: "name",
          label: t("home.name"),
          value: this.layoutFormName,
          errors,
          save: "layout-save",
          change: (value) => {
            this.layoutFormName = value;
            this.layoutFormErrors = without(this.layoutFormErrors, ["name"]);
          },
        })}
        ${
          form?.kind === "duplicate"
            ? html`<p class="help">${t("home.duplicate_note")}</p>`
            : nothing
        }
      </div>`,
      save: "layout-save",
      saveLabel: form?.kind === "duplicate" ? t("home.duplicate_save") : t("action.save"),
      errors: placed,
      close: () => {
        this.layoutForm = null;
      },
      submit: () => void this.#saveLayout(),
    });
  }

  #renderDeleteLayout() {
    const target = this.deletingLayout;
    return this.#formModal({
      test: "layout-delete",
      open: target !== null,
      heading: t("home.delete_heading").replace("{name}", target?.name ?? ""),
      body: html`<p>${t("home.delete_note")}</p>`,
      save: "layout-delete-confirm",
      saveLabel: t("action.delete"),
      saveVariant: "danger",
      errors: { blocked: false, bottom: this.deleteLayoutError ?? "" },
      close: () => {
        this.deletingLayout = null;
      },
      submit: () => void this.#deleteLayout(),
    });
  }

  /** On the Preview tab the changes are already shown, so the label stays plain words there. */
  #renderStatusLine(menuId: string) {
    const words = this.statusError
      ? t("menus.status_error")
      : this.status === null
        ? t("menus.status_loading")
        : this.status.state === "changed" && this.view !== "preview"
          ? statusLine(
              this.status,
              (label) =>
                html`<a
                  data-test="status-changes"
                  href=${previewAddress(menuId)}
                  @click=${(event: MouseEvent) => this.#openPreview(event, menuId)}
                  >${label}</a
                >`,
            )
          : statusLine(this.status);
    return html`<p class="status-line" data-test="menu-status">${words}</p>`;
  }

  async #saveProductColor(color: string | null): Promise<void> {
    const product = this.colouring;
    if (!product || this.colorBusy) return;
    this.colorBusy = true;
    try {
      await this.api.setProductColor(product.id, color);
      this.colouring = null;
    } catch (error) {
      this.colorErrors =
        fieldOf(error) === "color"
          ? { color: t("editor.field_rejected") }
          : { _form: codeMessage(codeOf(error)) };
    } finally {
      this.colorBusy = false;
    }
  }

  #renderProductColor() {
    const product = this.colouring;
    return html`<dashboard-product-color-form
      .open=${product !== null}
      .busy=${this.colorBusy}
      .name=${product?.name ?? ""}
      .color=${product?.color ?? null}
      .inherited=${
        product
          ? categoryColor(
              product.categoryId,
              new Map(this.categories.map((category) => [category.id, category])),
            )
          : null
      }
      .errors=${this.colorErrors}
      @wt-submit=${(event: CustomEvent<{ color: string | null }>) => {
        event.stopPropagation();
        void this.#saveProductColor(event.detail.color);
      }}
      @wt-cancel=${(event: Event) => {
        event.stopPropagation();
        this.colouring = null;
      }}
    ></dashboard-product-color-form>`;
  }

  #renderNewSection() {
    return html`<dashboard-section-details-form
        data-test="section-form"
        .open=${this.creatingSection !== null || this.editingSection !== null}
        .busy=${this.busy}
        .api=${this.api}
        .languages=${currentContentLanguages()}
        .value=${this.editingSection}
        .fieldErrors=${this.newSectionErrors}
        heading=${this.editingSection ? t("menus.edit_section") : t("menus.new_section_heading").replace("{list}", this.creatingSection?.name ?? "")}
        @wt-close=${{
          // The form stops its dialog's close, so it is caught on its way in.
          handleEvent: () => this.#windowClosed(),
          capture: true,
        }}
        @wt-submit=${(event: CustomEvent<SectionInput>) => {
          event.stopPropagation();
          this.#saveSection(event.detail);
        }}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.creatingSection = null;
          this.editingSection = null;
        }}
      ></dashboard-section-details-form>
      ${this.#formModal({
        test: "include",
        open: this.includingMenu !== null,
        heading: t("menus.include_menu"),
        body: html`<wt-combobox
          name="included-menu"
          required
          label=${t("menus.include_menu")}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          placeholder=${t("menus.choose_menu")}
          .options=${(this.structure?.includable ?? []).map((menu) => ({
            value: menu.rootSectionId,
            label: menu.name,
          }))}
          .value=${this.includedRoot}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.includedRoot = event.detail.value;
            if (this.includedRoot) void this.#includeMenu();
          }}
        ></wt-combobox>`,
        errors: {
          blocked: false,
          bottom: this.includeError,
        },
        close: () => {
          this.includingMenu = null;
        },
        closed: () => this.#windowClosed(),
      })}
      ${this.#formModal({
        test: "delete-section",
        open: this.deletingSection !== null,
        heading: t("menus.delete_section"),
        body: html`<p>
          ${t(
            this.deletingSection &&
              this.#ownedDescendants(this.#sectionNode(this.deletingSection.id)?.children ?? []) ===
                1
              ? "menus.delete_section_one"
              : "menus.delete_section_note",
          )
            .replace("{name}", this.deletingSection?.internalName ?? "")
            .replace(
              "{count}",
              String(
                this.deletingSection
                  ? this.#ownedDescendants(
                      this.#sectionNode(this.deletingSection.id)?.children ?? [],
                    )
                  : 0,
              ),
            )}
        </p>`,
        save: "delete-section-save",
        saveLabel: t("action.delete"),
        saveVariant: "danger",
        errors: { blocked: false, bottom: this.deleteSectionError },
        close: () => {
          this.deletingSection = null;
        },
        closed: () => this.#windowClosed(),
        submit: () => void this.#deleteSection(),
      })}`;
  }

  #ownedDescendants(nodes: readonly MenuStructureNode[]): number {
    return nodes.reduce(
      (count, node) =>
        count +
        (node.ref.kind === "section" && !node.includedMenuId
          ? 1 + this.#ownedDescendants(node.children ?? [])
          : 0),
      0,
    );
  }

  #sectionNode(id: string): MenuStructureNode | undefined {
    const walk = (nodes: MenuStructureNode[]): MenuStructureNode | undefined => {
      for (const node of nodes) {
        if (node.ref.kind === "section" && node.ref.sectionId === id) return node;
        const child = walk(node.children ?? []);
        if (child) return child;
      }
      return undefined;
    };
    return walk(this.structure?.nodes ?? []);
  }

  #renderAddProducts() {
    const target = this.addingProducts;
    return html`<wt-modal
      size="standard"
      data-test="add-products"
      .open=${target !== null}
      heading=${t("sections.add_products_heading").replace("{name}", target?.name ?? "")}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.addingProducts = null;
        this.#windowClosed();
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
                .inSection=${this.#pickerHeld}
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

  #renderEditor(menuId: string) {
    const name = this.#menuName();
    return html`<div class="heading">
        <nav aria-label=${t("menus.menu_trail")} data-test="menu-breadcrumb">
          <a
            data-test="back"
            href="/manage/menus"
            @click=${(event: MouseEvent) => {
              if (leftToBrowser(event)) return;
              event.preventDefault();
              this.#backToList();
            }}
            >${t("menus.title")}</a
          ><span class="sep" aria-hidden="true">›</span>
        </nav>
        <h1>${name || t("menus.title")}</h1>
      </div>
      ${this.#renderStatusLine(menuId)} ${this.#renderLoadState()} ${this.#renderMemberError()}
      <wt-tabs
        data-test="menu-tabs"
        label=${name || t("menus.title")}
        .value=${this.view}
        .items=${[
          { key: "structure", label: t("menus.tab_structure") },
          { key: "prices", label: t("menus.tab_prices") },
          { key: "home", label: t("menus.tab_home") },
          { key: "preview", label: t("menus.tab_preview") },
        ]}
        @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
          this.#showView(event.detail.value as Tab);
          this.#url.write({ view: event.detail.value });
        }}
      >
        <div slot="structure">${this.#renderStructure()}</div>
        <div slot="prices" class="prices">${this.#renderPrices()}</div>
        <div slot="home" class="home">${this.#renderHome()}</div>
        <div slot="preview">${this.#renderPreview()}</div>
      </wt-tabs>
      ${this.#renderNewSection()} ${this.#renderProductColor()} ${this.#renderAddProducts()}
      ${this.#renderLayoutForm()} ${this.#renderDeleteLayout()}`;
  }

  override render() {
    // Drawn in both views and as wide as the list, so the list's layout is known before its table
    // is first drawn, coming back from a menu included.
    return html`<div class="sizer" aria-hidden="true">
        <span class="narrow-probe" ${ref(this.#observeNarrowProbe)}></span>
        <span class="wide-probe" ${ref(this.#observeWideProbe)}></span>
      </div>
      ${this.menuId === null ? this.#renderList() : this.#renderEditor(this.menuId)}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menus-screen": MenusScreen;
  }
}
