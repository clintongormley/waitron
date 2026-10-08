import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { ref } from "lit/directives/ref.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import {
  baseStyles,
  iconButtonStyles,
  trackIconTooltip,
  leaveCoordinatorFor,
  type LeaveReason,
  focusFirstInvalid,
  setContentLanguages,
  currentContentLanguages,
  UrlStateController,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-slider.js";
import { PATH_SEPARATOR } from "../widgets/category-form.js";
import { memberName } from "../widgets/member-names.js";
import "../widgets/menu-structure-table.js";
import {
  ROOT_KEY,
  ownPresentation,
  type StructureAddAction,
} from "../widgets/menu-structure-table.js";
import "../widgets/section-add-products.js";
import "../widgets/menu-prices-table.js";
import "../widgets/device-home-preview.js";
import "../widgets/home-shortcut-picker.js";
import { overtakeSentence } from "../widgets/menu-publications.js";
import type { PriceOutcome, PriceSave } from "../widgets/menu-prices-table.js";
import { publishFailure, statusWords, type PublishResult } from "../widgets/menu-preview.js";
import "../widgets/section-details-form.js";
import "../widgets/include-folder-form.js";
import { fieldOf, ListWriteQueue } from "../widgets/section-writes.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  HomeDevice,
  HomeDisplay,
  IncludeFolderInput,
  MenuHome,
  MenuReadModels,
  MenuReadPart,
  MenuReadResult,
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
import { MenuReadController } from "../api/menu-read-controller.js";
import { DashboardQueries } from "../api/query-controller.js";
import {
  HOME_COLUMN_RANGE,
  HOME_DEVICES,
  HOME_ORDERS,
  HOME_TILE_MODES,
} from "@waitron/catalogue/src/device-home.js";
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

/** The live version and when it went live; a menu never published says so instead. */
function liveWords(status: MenuStatus) {
  const { label, live } = statusWords(
    status.state === "current" ? { ...status, state: "changed" } : status,
  );
  if (live === null) return label;
  return html`${live.version} · <span class="time">${live.time}</span>`;
}

function tabAddress(menuId: string, tab: Tab): string {
  return `/manage/menus/menu/${encodeURIComponent(menuId)}/view/${tab}`;
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

/** The include dialog's refusals worded for the folder; codes.ts's sentences speak of a section. */
function includeRefusal(error: unknown): Record<string, string> {
  const code = codeOf(error);
  const field = fieldOf(error);
  if (code === "menu_section.translation_required")
    return { [field]: t("menus.include_names_required") };
  if (code === "menu_section.invalid" && field === "image")
    return { image: t("menus.include_image_invalid") };
  if (code === "menu_section.invalid" && field === "color")
    return { color: t("menus.include_color_invalid") };
  return refusal(error);
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

const without = (errors: Record<string, string>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(errors).filter(([key]) => !keys.includes(key)));

/** Refusals about the target a shortcut picker chose, which belong under the picker. */
const SHORTCUT_TARGET_REFUSALS = new Set([
  "menu.shortcut_unreachable",
  "menu_section.member_duplicate",
  "menu_section.not_found",
  "menu_section.wrong_role",
]);

const HOME_DISPLAY_FIELDS: readonly string[] = ["columns", "tiles", "order"];

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
 * move leaves focus on the row. Its Price overrides tab lists every Active product the menu reaches,
 * with its Active variants, and edits the price this menu sets for each product and variant.
 */
@customElement("dashboard-menus-screen")
export class MenusScreen extends LitElement {
  static override styles = [
    baseStyles,
    iconButtonStyles,
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
        margin-bottom: var(--wt-space-4);
      }
      .heading nav {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
      }
      .heading .sep {
        color: var(--wt-color-primary-text);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: var(--wt-space-2);
        min-width: 0;
      }
      .heading h1 {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .live {
        color: var(--wt-color-text-muted);
      }
      .live .time {
        white-space: nowrap;
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
      .home fieldset {
        display: grid;
        gap: var(--wt-space-1);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .home fieldset > .field-error {
        margin: 0;
        font-size: var(--wt-font-size-sm);
      }
      .home legend {
        padding: 0;
        margin-bottom: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-4);
      }
      .choices label {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      .choices input[type="radio"] {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
      .choices input[type="radio"]:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .home {
        container-type: inline-size;
      }
      .home-columns,
      .home-settings,
      .home-preview {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-3);
        min-width: 0;
      }
      .home-columns {
        gap: var(--wt-space-5);
      }
      /* The Preview tab's breakpoint, so both tabs go to two columns at the same width. */
      /* A handheld's column is no wider than its frame (.frame[data-device="handheld"] in
         device-home-preview.ts), so the settings sit beside the phone; a till's takes the rest. */
      @container (min-width: 800px) {
        .home-columns {
          grid-template-columns: minmax(0, 1fr) calc(var(--wt-tap-min) * 7);
          align-items: start;
        }
        .home-columns[data-device="handheld"] {
          grid-template-columns: minmax(0, calc(var(--wt-tap-min) * 9)) calc(var(--wt-tap-min) * 7);
        }
      }
      .home h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
        text-align: start;
      }
      wt-data-table::part(note),
      wt-data-table::part(muted) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(note) {
        display: block;
        font-size: var(--wt-font-size-sm);
      }
      .status-line {
        margin: calc(var(--wt-space-3) * -1) 0 var(--wt-space-4);
      }
      .status-line .clashes {
        color: var(--wt-color-danger);
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
  @state() private defaultColor: string | null = null;
  @state() private loading = true;
  @state() private loadError = false;

  /** The menu being edited; null on the list. */
  @state() private menuId: string | null = null;
  @state() private structure: MenuStructure | null = null;
  @state() private structureError = false;
  /** The member ids followed from the menu's top level to the list being edited. */
  @state() private path: string[] = [];
  @state() private busy = false;
  /** Whether the Structure tree shows its grips; each menu opens with it off. */
  @state() private structureReordering = false;
  @state() private memberError: string | null = null;
  @state() private view: Tab = TABS[0];

  /** Null until the open menu's prices are first read. */
  @state() private prices: MenuPriceRow[] | null = null;
  @state() private pricesError = false;
  @state() private showPriceClashes = false;
  /** The prices table's row keys with a save queued or out. */
  @state() private savingPrices: ReadonlySet<string> = new Set();
  @state() private priceRefusals: Readonly<Record<string, string>> = {};
  @state() private priceOutcome: PriceOutcome | null = null;

  /** Every menu's publication state, followed while the list is shown; null until read. */
  @state() private statuses: Record<string, MenuStatus> | null = null;
  @state() private statusesError = false;
  @state() private statusesResetRequired = false;
  /** The open menu's publication state, followed while its editor is shown: on the Preview tab
   * through the preview, which carries it. Null until read. */
  @state() private status: MenuStatus | null = null;
  @state() private statusError = false;
  @state() private statusResetRequired = false;
  /** Null until the open menu's preview is read, which happens only on the Preview tab. */
  @state() private preview: MenuPreview | null = null;
  @state() private previewError = false;
  @state() private previewResetRequired = false;
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

  /** The list the new-section form adds to, while it is open. */
  @state() private creatingSection: ListTarget | null = null;
  @state() private editingSection: SectionDetails | null = null;
  @state() private deletingSection: SectionDetails | null = null;
  @state() private deleteSectionError = "";
  @state() private includingMenu: ListTarget | null = null;
  #menuFormGeneration = 0;
  @state() private includedRoot = "";
  @state() private includeError = "";
  @state() private menuDetails: SectionDetails | null = null;
  /** The include whose Edit dialog is open, as the structure held it when the dialog opened. */
  @state() private editingInclude: {
    listId: string;
    memberId: string;
    node: MenuStructureNode;
  } | null = null;
  @state() private includeErrors: Record<string, string> = {};
  @state() private newSectionErrors: Record<string, string> = {};

  /** The list the product picker adds to, while it is open. */
  @state() private addingProducts: ListTarget | null = null;
  @state() private addProductsError: string | null = null;

  /** Null until the open menu's Device Home Page is read, which happens only on the Home page tab. */
  @state() private menuHome: MenuHome | null = null;
  @state() private homeLoadError = false;
  /** Why a display setting was refused when the refusal names no control on screen, or why a
   * shortcut's remove or move was refused. */
  @state() private homeError: string | null = null;
  @state() private homeDevice: HomeDevice = "handheld";
  /** The setting whose save is out, shown over the saved one until the save is answered. */
  @state() private homePending: {
    menuId: string;
    device: HomeDevice;
    patch: Partial<HomeDisplay>;
  } | null = null;
  @state() private homeFieldErrors: Partial<Record<keyof HomeDisplay, string>> = {};
  /** The shortcut picker while it is open. */
  @state() private addingShortcut: "product" | "section" | null = null;
  /** A refusal about the chosen target, shown under the picker. */
  @state() private shortcutError = "";
  /** Any other refusal of an add, shown at the picker's end. */
  @state() private shortcutFormError = "";

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
  readonly #menuReads = new MenuReadController(
    this,
    () => this.api,
    (error) => {
      this.#menuReadFailed(error);
    },
  );
  #includedStatusesFor: string | null = null;
  #menuReadKey = "";
  #menuReadGeneration = 0;
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
    (error) => {
      if (this.menuId === null) {
        this.statusesError = true;
        this.statusesResetRequired = codeOf(error) === "menu.reset_required";
      } else {
        this.statusError = true;
        this.statusResetRequired = codeOf(error) === "menu.reset_required";
      }
    },
  );
  /** The menu whose state is followed, null for every menu's, undefined before the first. */
  #statusFor: string | null | undefined = undefined;
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
  /** The tree row's ⋮, or the Home page tab's shortcut ⋮ or add tile, that gets focus back once
   * nothing is out and the window it opened, if any, has closed. */
  #focusReturn:
    | { menuId: string; key: string }
    | { menuId: string; shortcuts: string[]; add: "product" | "section" }
    | null = null;
  #windowShut = false;
  /** What a home page tile may point at: the active products and the sections the structure
   * reaches. The server checks reach by membership alone; an inactive product is not offered. */
  #tileProducts: { id: string; name: string }[] = [];
  #tileSections: { id: string; internalName: string }[] = [];
  readonly #writes = new ListWriteQueue();
  readonly #priceWrites = new ListWriteQueue();
  #priceSavesMade = 0;
  /** Fields whose save was stored while a later save waited behind it. They stay listed as saving
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
              foundProducts.set(node.ref.productId, [...path, name].join(PATH_SEPARATOR));
          } else {
            const next = [...path, node.internalName ?? ""];
            if (!foundSections.has(node.ref.sectionId))
              foundSections.set(
                node.ref.sectionId,
                [
                  ...path,
                  node.includedMenuId
                    ? t("menus.menu_prefix").replace("{name}", node.internalName ?? "")
                    : (node.internalName ?? ""),
                ].join(PATH_SEPARATOR),
              );
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
        this.#queries.watch("getCatalogueSettings", [], (value) => {
          this.defaultColor = value.defaultColor;
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

  #menuReadParts(): MenuReadPart[] {
    return [
      "structure",
      ...(this.view === "home" ? ["home" as const] : []),
      this.view === "home" || this.view === "preview" ? "preview" : "status",
    ];
  }

  #menuReadFailed(error: unknown, parts = this.#menuReadParts()): void {
    for (const part of parts) {
      if (part === "structure") this.structureError = true;
      if (part === "home") this.homeLoadError = true;
      if (part === "preview") {
        this.previewError = true;
        this.previewResetRequired = codeOf(error) === "menu.reset_required";
      }
      if (part === "status" || (part === "preview" && this.status === null)) {
        this.statusError = true;
        this.statusResetRequired = codeOf(error) === "menu.reset_required";
      }
    }
  }

  #applyMenuRead(menuId: string, result: MenuReadResult): void {
    for (const part of this.#menuReadParts()) {
      const response = result[part];
      if (response === undefined) continue;
      if (response.status !== 200) {
        this.#menuReadFailed((response.body as { error: unknown }).error, [part]);
        continue;
      }
      if (part === "structure") {
        this.structure = response.body as MenuReadModels["structure"];
        this.structureError = false;
        if (this.structure.includedBy.length && this.#includedStatusesFor !== menuId) {
          this.#includedStatusesFor = menuId;
          void this.#statusQueries
            .watch("getMenuStatuses", [], (value) => {
              this.statuses = value;
            })
            .catch(() => undefined);
        }
      }
      if (part === "home") {
        this.menuHome = response.body as MenuReadModels["home"];
        this.homeLoadError = false;
      }
      if (part === "preview") {
        this.preview = response.body as MenuReadModels["preview"];
        this.previewError = false;
        this.previewResetRequired = false;
        this.status = this.preview.status;
      }
      if (part === "status") this.status = response.body as MenuReadModels["status"];
      if (part === "status" || part === "preview") {
        this.statusError = false;
        this.statusResetRequired = false;
      }
    }
  }

  async #watchMenu(again = false): Promise<void> {
    const menuId = this.menuId;
    if (menuId === null) return;
    const parts = this.#menuReadParts();
    const key = JSON.stringify([menuId, parts]);
    if (key !== this.#menuReadKey) {
      this.#menuReadKey = key;
      this.#menuReadGeneration++;
    }
    const generation = this.#menuReadGeneration;
    const initialRead = async (): Promise<MenuReadResult> => {
      const cached = {
        structure: this.structureError ? null : this.structure,
        home: this.homeLoadError ? null : this.menuHome,
        status: null,
        preview: this.previewError ? null : this.preview,
      };
      const reads = {
        structure: () => this.api.getMenuStructure(menuId),
        home: () => this.api.getMenuHome(menuId),
        status: () => this.api.getMenuStatus(menuId),
        preview: () => this.api.getMenuPreview(menuId),
      };
      const entries = await Promise.all(
        parts.map(async (part) => {
          let response;
          try {
            response = { status: 200, body: cached[part] ?? (await reads[part]()) };
          } catch (error) {
            response = { status: 409, body: { error } };
          }
          if (this.#menuReadGeneration === generation && this.menuId === menuId)
            this.#applyMenuRead(menuId, { [part]: response } as MenuReadResult);
          return [part, response];
        }),
      );
      return Object.fromEntries(entries) as MenuReadResult;
    };
    try {
      await this.#menuReads.watch(
        menuId,
        parts,
        (value) => this.#applyMenuRead(menuId, value),
        initialRead,
      );
    } catch {
      // The controller reports read failures independently of write refusals.
    }
    if (again) await this.#menuReads.refresh();
  }

  #watchStructure(): Promise<void> {
    return this.#watchMenu(true);
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

  #followStatus(again = false): void {
    const menuId = this.menuId;
    if (menuId !== null) {
      this.#statusFor = menuId;
      if (!this.structure?.includedBy.length) {
        this.#statusQueries.release("getMenuStatuses");
        this.#includedStatusesFor = null;
      }
      if (again && (this.view === "preview" || this.view === "home"))
        void this.#watchPreview(menuId);
      else void this.#watchMenu(again);
      return;
    }
    if (!again && this.#statusFor === null) return;
    this.#statusFor = null;
    this.statuses = null;
    this.statusesError = false;
    this.statusesResetRequired = false;
    void this.#statusQueries
      .watch("getMenuStatuses", [], (value) => {
        this.statuses = value;
        this.statusesError = false;
        this.statusesResetRequired = false;
      })
      .catch(() => undefined);
  }

  #watchPreview(menuId: string): Promise<void> {
    if (this.menuId !== menuId) return Promise.resolve();
    this.preview = null;
    this.previewError = false;
    this.previewResetRequired = false;
    return this.#watchMenu(true);
  }

  #releasePreview(): void {
    this.preview = null;
    this.previewError = false;
    this.previewResetRequired = false;
  }

  #watchHome(menuId: string): Promise<void> {
    return this.menuId === menuId ? this.#watchMenu(true) : Promise.resolve();
  }

  #releaseHome(): void {
    this.menuHome = null;
    this.homeLoadError = false;
    this.homeError = null;
    this.homeFieldErrors = {};
  }

  /** Also forgets the rows, so the tab shows loading rather than old rows until the next read. */
  #releasePrices(): void {
    this.#pricesFor = null;
    this.#priceQueries.release("getMenuPrices");
    this.prices = null;
    this.pricesError = false;
  }

  /** The prices are watched only while the Price overrides tab is shown: the structure edits made
   * on the other tab write tables the prices read depends on. The preview and the menu's home
   * likewise, each on the tabs that draw it. */
  #showView(view: Tab): void {
    this.view = view;
    this.#followStatus();
    if (view !== "preview" && view !== "home") this.#releasePreview();
    if (view !== "home") this.#releaseHome();
    if (view !== "prices") {
      this.priceRefusals = {};
      this.priceOutcome = null;
      this.#releasePrices();
    } else if (this.menuId !== null && this.#pricesFor !== this.menuId)
      void this.#watchPrices(this.menuId);
  }

  /** A write that succeeded is never reported as a failed one: a failure here is a load failure. */
  async #refresh(afterWrite = true): Promise<void> {
    await this.#menuReads.refresh(afterWrite);
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "menus") {
      this.#menuFormGeneration++;
      this.menuForm = null;
      return;
    }
    this.#select(this.#url.read("menu"));
    const view = this.#url.read("view");
    this.showPriceClashes = view === "prices" && this.#url.read("price-filter") === "clashes";
    this.#showView(isTab(view) ? view : TABS[0]);
    this.#checkAddress();
  }

  #select(menuId: string | null): void {
    if (menuId === this.menuId) return;
    this.#menuFormGeneration++;
    this.menuForm = null;
    this.#menuReads.release();
    this.#menuReadGeneration++;
    this.#menuReadKey = "";
    this.#includedStatusesFor = null;
    this.menuId = menuId;
    this.showPriceClashes = false;
    this.status = null;
    this.statusError = false;
    this.statusResetRequired = false;
    this.path = [];
    this.structureReordering = false;
    this.structure = null;
    this.structureError = false;
    this.memberError = null;
    this.priceRefusals = {};
    this.priceOutcome = null;
    this.publishResult = null;
    this.#releasePrices();
    this.#releasePreview();
    this.#releaseHome();
    this.homeDevice = "handheld";
    this.addingShortcut = null;
    // An open menu's state waits for `#showView`, which each caller opening a menu runs next and
    // which knows whether the preview carries it, so no query starts only to be released.
    if (menuId === null) {
      this.#followStatus();
    }
  }

  /** Replaces an address naming a menu that does not exist, or a tab the editor does not have. */
  #checkAddress(): void {
    if (this.#url.read("dashboard") !== "menus") return;
    const priceFilter = this.#url.read("price-filter");
    if (
      priceFilter !== null &&
      (this.menuId === null || this.view !== "prices" || priceFilter !== "clashes")
    )
      this.#url.write({ "price-filter": null }, true);
    if (this.menuId === null) {
      if (this.#url.read("view") !== null) this.#url.write({ view: null }, true);
      return;
    }
    if (!this.loading && !this.loadError && !this.menus.some(({ id }) => id === this.menuId)) {
      this.#select(null);
      this.#url.write({ menu: null, view: null, "price-filter": null }, true);
      return;
    }
    if (!isTab(this.#url.read("view"))) this.#url.write({ view: TABS[0] }, true);
  }

  #open(menuId: string, view: Tab = TABS[0], priceFilter: "clashes" | null = null): void {
    this.#select(menuId);
    this.showPriceClashes = priceFilter === "clashes";
    this.#showView(view);
    this.#url.write({ dashboard: "menus", menu: menuId, view, "price-filter": priceFilter });
  }

  #backToList(): void {
    this.#select(null);
    this.#url.write({ dashboard: "menus", menu: null, view: null, "price-filter": null });
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
    this.#menuReadGeneration++;
    this.#menuReadKey = "";
    this.#includedStatusesFor = null;
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

  /** Moves focus to the first invalid field of the modal `form`, once it has rendered. */
  async #focusInvalid(form: string): Promise<void> {
    await this.updateComplete;
    const modal = this.shadowRoot!.querySelector(`wt-modal[data-test="${form}"]`);
    if (modal) await focusFirstInvalid(modal);
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
    this.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-section-details-form"]>(
      '[data-test="menu-form"]',
    )!.closeSaved(input);
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
          : { kind: "failed", reason: await this.#publishRefusal(menuId, code, error) };
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

  /** An overtake refusal names the scheduled versions in the way, read from the menu's list. */
  async #publishRefusal(menuId: string, code: string, error: unknown): Promise<string> {
    if (code !== "menu_publication.overtakes_queued") return codeMessage(code);
    const overtaken = (error as { params?: { overtaken?: unknown } }).params?.overtaken;
    if (!Array.isArray(overtaken)) return codeMessage(code);
    try {
      const answer = await this.api.getMenuPublications(menuId);
      return (
        overtakeSentence(overtaken as { versionId: string }[], "now", answer) ?? codeMessage(code)
      );
    } catch {
      return codeMessage(code);
    }
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
        await this.#refresh(false);
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
    this.#focusReturn = { menuId: this.menuId!, key: path.join("/") || ROOT_KEY };
    this.#windowShut = shut;
  }

  /** A window's close is reported after the dialog has put focus back. */
  #windowClosed(): void {
    this.#windowShut = true;
    this.requestUpdate();
  }

  /** Waits for the write out to be read back: the row whose ⋮ had focus may be gone after it. */
  #returnFocus(): void {
    const target = this.#focusReturn;
    if (!target || !this.#windowShut || this.busy) return;
    this.#focusReturn = null;
    if (target.menuId !== this.menuId) return;
    if ("key" in target) {
      this.renderRoot.querySelector("dashboard-menu-structure-table")?.focusRowMenu(target.key);
      return;
    }
    const preview = this.renderRoot.querySelector("dashboard-device-home-preview");
    if (preview === null) return;
    void (async () => {
      for (const memberId of target.shortcuts) if (await preview.focusShortcut(memberId)) return;
      await preview.focusAdd(target.add);
    })();
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
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-section-details-form"]>(
        '[data-test="section-form"]',
      )!.closeSaved(input);
      this.creatingSection = null;
      this.editingSection = null;
      await this.#refresh();
      if (target) this.#reportSavedToLost(target);
      this.busy = false;
    });
  }

  #saveInclude(input: IncludeFolderInput): void {
    const editing = this.editingInclude;
    if (this.busy || !editing) return;
    const { listId, memberId } = editing;
    this.busy = true;
    this.includeErrors = {};
    this.#writes.run(listId, async () => {
      try {
        await this.api.setIncludeFolder(listId, memberId, input);
      } catch (error) {
        this.includeErrors = includeRefusal(error);
        this.busy = false;
        return;
      }
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-include-folder-form"]>(
        '[data-test="include-folder-form"]',
      )!.closeSaved(input);
      this.editingInclude = null;
      await this.#refresh();
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

  readonly #beforeProductsClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const picker = this.shadowRoot!.querySelector("dashboard-section-add-products");
    const leave = leaveCoordinatorFor(this);
    return (
      !picker ||
      !leave ||
      (await leave.request({ scopes: [picker], reason, proceed() {} })) === "proceeded"
    );
  };

  #addProducts(productIds: string[]): void {
    if (this.addingProducts === null || this.busy || this.#closeLostList()) return;
    const target = this.addingProducts;
    const picker = this.shadowRoot!.querySelector("dashboard-section-add-products");
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
      picker?.commitSaved(productIds);
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
        '[data-test="add-products"]',
      )!.closeAfter("saved");
      this.addingProducts = null;
      await this.#refresh();
      this.#reportSavedToLost(target);
      this.busy = false;
    });
  }

  // ── The Device Home Page ─────────────────────────────────────────────────────────────────────

  /** Reads the home again after a write, while the Home page tab still shows the same menu. */
  async #rereadHome(menuId: string, afterWrite = false): Promise<void> {
    if (this.menuId === menuId && this.view === "home") await this.#menuReads.refresh(afterWrite);
  }

  /** A remove holds `busy` until the home is read again, or until it is refused. Its scope is the
   * menu's home, as a move's is, so a move knows when another write to the shortcuts waits behind
   * it. A refusal that lands after the person has left the menu is dropped. */
  #shortcutWrite(
    write: (menuId: string) => Promise<unknown>,
    refused: (error: unknown) => void,
  ): void {
    const menuId = this.menuId!;
    this.memberError = null;
    this.busy = true;
    this.#writes.run(`home:${menuId}`, async () => {
      try {
        await write(menuId);
      } catch (error) {
        if (this.menuId === menuId) refused(error);
        this.busy = false;
        return;
      }
      await this.#rereadHome(menuId, true);
      this.busy = false;
    });
  }

  /** Focus then goes to the removed shortcut's ⋮ while it is still drawn, as after a refusal, else
   * the next shortcut's, else the previous one's, else the tile that adds products. */
  #removeHomeShortcut(memberId: string): void {
    const order = this.#shortcutOrder();
    const at = order.indexOf(memberId);
    this.#focusReturn = {
      menuId: this.menuId!,
      shortcuts: [memberId, order[at + 1], order[at - 1]].filter((id) => id !== undefined),
      add: "product",
    };
    this.#windowShut = true;
    this.homeError = null;
    this.#shortcutWrite(
      (menuId) => this.api.removeHomeShortcut(menuId, memberId),
      (error) => {
        this.homeError = codeMessage(codeOf(error));
      },
    );
  }

  /** Focus goes back to the add tile that opened the window once nothing is out: while busy the
   * tile is disabled, so the dialog's own focus return finds nothing. */
  #openShortcutPicker(kind: "product" | "section"): void {
    this.addingShortcut = kind;
    this.shortcutError = "";
    this.shortcutFormError = "";
    this.#focusReturn = { menuId: this.menuId!, shortcuts: [], add: kind };
    this.#windowShut = false;
  }

  readonly #beforeShortcutsClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const picker = this.shadowRoot!.querySelector("dashboard-home-shortcut-picker");
    const leave = leaveCoordinatorFor(this);
    return (
      !picker ||
      !leave ||
      (await leave.request({ scopes: [picker], reason, proceed() {} })) === "proceeded"
    );
  };

  /** One add per target, in the order chosen, all inside one write to the menu's home so a move
   * waits behind every one of them. Stops at the first refusal, leaving the targets not yet added
   * chosen. */
  #addShortcuts(kind: "product" | "section", ids: string[]): void {
    if (this.addingShortcut !== kind || this.busy || ids.length === 0) return;
    const menuId = this.menuId!;
    const picker = this.shadowRoot!.querySelector("dashboard-home-shortcut-picker");
    const names = new Map((picker?.options ?? []).map(({ value, label }) => [value, label]));
    this.memberError = null;
    this.shortcutError = "";
    this.shortcutFormError = "";
    this.busy = true;
    this.#writes.run(`home:${menuId}`, async () => {
      for (const [at, id] of ids.entries()) {
        if (this.menuId !== menuId) {
          this.busy = false;
          return;
        }
        const ref: MemberRef =
          kind === "product" ? { kind, productId: id } : { kind, sectionId: id };
        try {
          await this.api.addHomeShortcut(menuId, ref);
        } catch (error) {
          if (this.menuId === menuId) this.#shortcutsRefused(error, ids.slice(at), names);
          if (at > 0) await this.#rereadHome(menuId, true);
          this.busy = false;
          return;
        }
      }
      if (this.menuId !== menuId) {
        this.busy = false;
        return;
      }
      picker?.commitSaved();
      this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
        'wt-modal[data-test="add-shortcut"]',
      )!.closeAfter("saved");
      this.addingShortcut = null;
      await this.#rereadHome(menuId, true);
      this.busy = false;
    });
  }

  /** A refusal about a target names it under the field; any other goes at the bottom. */
  #shortcutsRefused(error: unknown, notAdded: string[], names: Map<string, string>): void {
    this.shadowRoot!.querySelector("dashboard-home-shortcut-picker")?.keepChosen(notAdded);
    const code = codeOf(error);
    if (!SHORTCUT_TARGET_REFUSALS.has(code)) {
      this.shortcutFormError = codeMessage(code);
      return;
    }
    this.shortcutError = t("home.add_refused")
      .replace("{name}", names.get(notAdded[0]!) ?? notAdded[0]!)
      .replace("{reason}", codeMessage(code));
    void this.#focusInvalid("add-shortcut");
  }

  #shortcutOrder(): string[] {
    return (this.menuHome?.shortcuts ?? []).map(({ memberId }) => memberId);
  }

  /** Not `busy`, as for a member's move: the keyboard user's focus stays on the grip. The last queued
   * write's answer is shown only while the order on screen is the one the move was sent over, or
   * the answer itself; any other order may be a newer change, so the home is read again. */
  #moveShortcut(memberId: string, to: number, report: (message: string) => void): void {
    const menuId = this.menuId!;
    this.memberError = null;
    let sentOver: string[] = [];
    this.#writes.move(
      `home:${menuId}`,
      () => {
        sentOver = this.#shortcutOrder();
        return this.api.moveHomeShortcut(menuId, memberId, to);
      },
      async (ordered, last) => {
        if (!last || this.menuId !== menuId || this.menuHome === null) return;
        const tiles = new Map(this.menuHome.shortcuts.map((tile) => [tile.memberId, tile]));
        const shown = this.#shortcutOrder().join(" ");
        const answer = ordered.map(({ id }) => id);
        if (
          ordered.length !== tiles.size ||
          ordered.some(({ id }) => !tiles.has(id)) ||
          (shown !== sentOver.join(" ") && shown !== answer.join(" "))
        ) {
          await this.#rereadHome(menuId, true);
          return;
        }
        this.menuHome = {
          ...this.menuHome,
          shortcuts: ordered.map(({ id }, position) => ({ ...tiles.get(id)!, position })),
        };
      },
      async (error) => {
        if (this.menuId !== menuId) return;
        report(codeMessage(codeOf(error)));
        await this.#rereadHome(menuId);
      },
    );
  }

  /** Saves one display setting of the device shown. A refusal naming a control of that device goes
   * under it; any other is said above the controls. A saved value is kept in the home shown, so it
   * still shows when the read that follows fails. */
  async #saveDisplay(patch: Partial<HomeDisplay>): Promise<void> {
    const menuId = this.menuId;
    if (menuId === null || this.homePending !== null) return;
    const device = this.homeDevice;
    const fields = Object.keys(patch) as (keyof HomeDisplay)[];
    this.homePending = { menuId, device, patch };
    this.homeError = null;
    this.homeFieldErrors = Object.fromEntries(
      Object.entries(this.homeFieldErrors).filter(
        ([key]) => !fields.includes(key as keyof HomeDisplay),
      ),
    );
    try {
      await this.api.setHomeDisplay(menuId, device, patch);
    } catch (error) {
      this.homePending = null;
      if (this.menuId !== menuId) return;
      const code = codeOf(error);
      const params = (error as { params?: { device?: unknown; field?: unknown } } | undefined)
        ?.params;
      const field = params?.field;
      if (
        code === "menu.home_display_invalid" &&
        params?.device === this.homeDevice &&
        typeof field === "string" &&
        HOME_DISPLAY_FIELDS.includes(field)
      )
        this.homeFieldErrors = { ...this.homeFieldErrors, [field]: codeMessage(code) };
      else this.homeError = codeMessage(code);
      return;
    }
    this.homePending = null;
    if (this.menuId === menuId && this.menuHome !== null)
      this.menuHome = { ...this.menuHome, [device]: { ...this.menuHome[device], ...patch } };
    await this.#rereadHome(menuId, true);
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
   * said in the tab's floating outcome message, and under the field when it names the price; once the menu,
   * the tab or the row has gone, it is named beside the list instead. The prices are read again
   * only after the last save made, and only when it or an earlier one was stored. A success is said
   * only for the last save made, so its Undo never reaches past a later write; never over a refusal
   * said since it was made and not yet closed, which would hide that refusal; and not over a
   * failed re-read, which the list reports as a load failure. */
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
      href=${tabAddress(menu.id, "preview")}
      aria-label=${`${label}: ${menu.name}`}
      @click=${(event: MouseEvent) => this.#openTab(event, menu.id, "preview")}
      >${label}</a
    >`;
  }

  #openTab(event: MouseEvent, menuId: string, tab: Tab): void {
    if (leftToBrowser(event)) return;
    event.preventDefault();
    this.#open(menuId, tab);
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
      <p class="field-error" role="alert" data-test="form-error">${message || nothing}</p>
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
      ${this.statusesError && this.statusesResetRequired ? html`<p class="error" role="alert" data-test="status-reset-error">${codeMessage("menu.reset_required")}</p>` : nothing}
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
        .defaultColor=${this.defaultColor}
        .current=${this.path}
        .busy=${this.busy}
        .reordering=${this.structureReordering}
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
        @wt-include-edit=${(event: CustomEvent<{ path: string[]; memberId: string }>) => {
          event.stopPropagation();
          const { path, memberId } = event.detail;
          const node = trailOf(this.structure, [...path, memberId]).at(-1);
          if (node?.memberId !== memberId || !node.includedMenuId) return;
          this.#returnFocusTo([...path, memberId]);
          this.editingInclude = { listId: this.#targetAt(path).listId, memberId, node };
          this.includeErrors = {};
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
        @wt-member-delete=${(event: CustomEvent<{ sectionId: string; path: string[] }>) => {
          event.stopPropagation();
          this.#returnFocusTo(event.detail.path);
          this.deletingSection =
            this.sections.find((section) => section.id === event.detail.sectionId) ?? null;
          this.deleteSectionError = "";
        }}
        ><!-- A native button: wt-button does not pass aria-pressed to its inner button. -->
        <button
          type="button"
          slot="toolbar-start"
          class="icon-button"
          data-test="reorder"
          aria-label=${t("menus.reorder")}
          aria-pressed=${String(this.structureReordering)}
          @click=${() => {
            this.structureReordering = !this.structureReordering;
          }}
          @pointerenter=${trackIconTooltip}
          @pointerleave=${trackIconTooltip}
          @focus=${trackIconTooltip}
          @blur=${trackIconTooltip}
        >
          <wt-icon name="grip"></wt-icon
          ><span class="icon-tooltip" aria-hidden="true">${t("menus.reorder")}</span>
        </button>
        ${
          this.structureReordering
            ? html`<wt-button
                slot="toolbar-end"
                data-test="reorder-done"
                variant="secondary"
                @click=${() => void this.#leaveReordering()}
                >${t("action.done")}</wt-button
              >`
            : nothing
        }</dashboard-menu-structure-table
      >`;
  }

  /** Done removes itself, so focus goes back to the mode's toggle rather than to the page. */
  async #leaveReordering(): Promise<void> {
    this.structureReordering = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('[data-test="reorder"]')?.focus();
  }

  #renderPrices() {
    return html`<dashboard-menu-prices-table
        .clashesFor=${this.showPriceClashes ? this.menuId! : ""}
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
        @wt-price-outcome-close=${(event: Event) => {
          event.stopPropagation();
          this.priceOutcome = null;
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
      .includedBy=${this.structure?.includedBy ?? []}
      .status=${this.status}
      .preview=${this.preview}
      .failed=${this.previewError}
      .failureReason=${this.previewResetRequired ? codeMessage("menu.reset_required") : ""}
      .publishing=${this.publishing.has(this.menuId!)}
      .result=${this.publishResult}
      @wt-preview-clashes=${(event: Event) => {
        event.stopPropagation();
        this.#open(this.menuId!, "prices", "clashes");
      }}
      @wt-menu-publish=${(event: CustomEvent<{ hash: string }>) => {
        event.stopPropagation();
        void this.#publish(event.detail.hash);
      }}
      @wt-preview-retry=${(event: Event) => {
        event.stopPropagation();
        void this.#watchPreview(this.menuId!);
      }}
      ><dashboard-menu-publications
        slot="schedule"
        .api=${this.api}
        menuId=${this.menuId!}
        menuName=${this.#menuName()}
        .preview=${this.previewError ? null : this.preview}
      ></dashboard-menu-publications
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
    const home = this.menuHome;
    if (home === null)
      return html`${error}${loadError}${
        this.homeLoadError
          ? nothing
          : html`<p role="status" data-test="home-loading">${t("home.loading")}</p>`
      }`;
    const device = this.homeDevice;
    const pending = this.homePending;
    const display =
      pending?.menuId === this.menuId && pending.device === device
        ? { ...home[device], ...pending.patch }
        : home[device];
    const range = HOME_COLUMN_RANGE[device];
    return html`${error}${loadError}
      <div class="home-columns" data-device=${device}>
        <section
          class="home-preview"
          data-test="home-preview-pane"
          aria-labelledby="home-preview-heading"
        >
          <h2 id="home-preview-heading">${t("home.preview_heading")}</h2>
          ${this.#renderHomePreview(device, home)}
        </section>
        <div class="home-settings" data-test="home-settings">
          ${this.#renderHomeSettings(device, display, range)}
        </div>
      </div>`;
  }

  #renderHomeSettings(
    device: HomeDevice,
    display: HomeDisplay,
    range: (typeof HOME_COLUMN_RANGE)[HomeDevice],
  ) {
    return html`<fieldset>
        <legend>${t("home.device")}</legend>
        <div class="choices">
          ${HOME_DEVICES.map(
            (each) =>
              html`<label
                ><input
                  type="radio"
                  name="home-device"
                  value=${each}
                  .checked=${each === device}
                  @change=${() => {
                    this.homeDevice = each;
                    this.homeFieldErrors = {};
                  }}
                />${t(each === "handheld" ? "home.device_handheld" : "home.device_till")}</label
              >`,
          )}
        </div>
      </fieldset>
      <wt-slider
        name="home-columns"
        label=${t("home.columns")}
        .min=${range.min}
        .max=${range.max}
        .value=${live(display.columns)}
        .disabled=${this.homePending !== null}
        error=${this.homeFieldErrors.columns ?? ""}
        @wt-change=${(event: CustomEvent<{ value: number }>) => {
          event.stopPropagation();
          void this.#saveDisplay({ columns: event.detail.value });
        }}
      ></wt-slider>
      <p class="help" data-test="columns-note">
        ${t(device === "handheld" ? "home.columns_note_handheld" : "home.columns_note_till")}
      </p>
      ${this.#homeChoice(
        "tiles",
        t("home.tiles"),
        HOME_TILE_MODES.map((mode) => ({
          value: mode,
          label: t(mode === "colours" ? "home.tiles_colours" : "home.tiles_thumbnails"),
        })),
        display.tiles,
        (value) => void this.#saveDisplay({ tiles: value as HomeDisplay["tiles"] }),
      )}
      ${this.#homeChoice(
        "order",
        t("home.order"),
        HOME_ORDERS.map((order) => ({
          value: order,
          label: t(order === "home_first" ? "home.order_home_first" : "home.order_menu_first"),
        })),
        display.order,
        (value) => void this.#saveDisplay({ order: value as HomeDisplay["order"] }),
      )}`;
  }

  /** One display setting as a group of radios, its refusal beneath it. These radios and the slider
   * bind through `live`: a refused change leaves the saved value unchanged, and without it the
   * refused choice would stay showing once its save is answered. */
  #homeChoice(
    field: "tiles" | "order",
    legend: string,
    options: { value: string; label: string }[],
    value: string,
    change: (value: string) => void,
  ) {
    const error = this.homeFieldErrors[field];
    const errorId = `home-${field}-error`;
    return html`<fieldset aria-describedby=${ifDefined(error ? errorId : undefined)}>
      <legend>${legend}</legend>
      <div class="choices">
        ${options.map(
          (option) =>
            html`<label
              ><input
                type="radio"
                name=${`home-${field}`}
                value=${option.value}
                .checked=${live(option.value === value)}
                .disabled=${this.homePending !== null}
                aria-invalid=${ifDefined(error ? "true" : undefined)}
                @change=${() => change(option.value)}
              />${option.label}</label
            >`,
        )}
      </div>
      ${
        error
          ? html`<p class="field-error" role="alert" id=${errorId} data-test=${errorId}>
              ${error}
            </p>`
          : nothing
      }
    </fieldset>`;
  }

  #renderHomePreview(device: HomeDevice, home: MenuHome) {
    if (this.preview !== null)
      return html`<dashboard-device-home-preview
        .document=${this.preview.document}
        device=${device}
        .shortcuts=${home.shortcuts}
        .busy=${this.busy}
        @wt-shortcut-add=${(event: CustomEvent<{ kind: "product" | "section" }>) => {
          event.stopPropagation();
          this.#openShortcutPicker(event.detail.kind);
        }}
        @wt-shortcut-remove=${(event: CustomEvent<{ memberId: string }>) => {
          event.stopPropagation();
          this.#removeHomeShortcut(event.detail.memberId);
        }}
        @wt-shortcut-move=${(event: CustomEvent<{ memberId: string; to: number }>) => {
          event.stopPropagation();
          this.homeError = null;
          this.#moveShortcut(event.detail.memberId, event.detail.to, (message) => {
            this.homeError = message;
          });
        }}
      ></dashboard-device-home-preview>`;
    if (!this.previewError)
      return html`<p role="status" data-test="home-preview-loading">
        ${t("home.preview_loading")}
      </p>`;
    return html`<p class="error" role="alert" data-test="home-preview-error">
        ${this.previewResetRequired ? codeMessage("menu.reset_required") : t("home.preview_error")}
      </p>
      <div>
        <wt-button
          data-test="home-preview-retry"
          variant="secondary"
          @click=${() => void this.#watchPreview(this.menuId!)}
          >${t("menus.retry")}</wt-button
        >
      </div>`;
  }

  #shortcutOptions(kind: "product" | "section"): { value: string; label: string }[] {
    const held = new Set(
      (this.menuHome?.shortcuts ?? []).map(({ ref }) =>
        ref.kind === "product" ? ref.productId : ref.kind === "section" ? ref.sectionId : null,
      ),
    );
    return kind === "section"
      ? this.#tileSections
          .filter(({ id }) => !held.has(id))
          .map(({ id, internalName }) => ({ value: id, label: internalName }))
      : this.#tileProducts
          .filter(({ id }) => !held.has(id))
          .map(({ id, name }) => ({ value: id, label: name }));
  }

  #renderShortcutPicker() {
    const kind = this.addingShortcut;
    return html`<wt-modal
      size="compact"
      data-test="add-shortcut"
      .open=${kind !== null}
      .beforeClose=${leaveCoordinatorFor(this) ? this.#beforeShortcutsClose : undefined}
      heading=${t(kind === "section" ? "home.add_sections" : "home.add_products")}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        if (!this.busy) this.addingShortcut = null;
        this.#windowClosed();
      }}
    >
      ${
        kind !== null
          ? html`<dashboard-home-shortcut-picker
              kind=${kind}
              .options=${this.#shortcutOptions(kind)}
              .busy=${this.busy}
              error=${this.shortcutError}
              formError=${this.shortcutFormError}
              @wt-shortcuts-add=${(
                event: CustomEvent<{ kind: "product" | "section"; ids: string[] }>,
              ) => {
                event.stopPropagation();
                this.#addShortcuts(event.detail.kind, event.detail.ids);
              }}
              ><wt-button
                slot="cancel"
                variant="secondary"
                data-test="add-shortcut-cancel"
                .disabled=${this.busy}
                @click=${() => {
                  if (leaveCoordinatorFor(this))
                    void this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
                      'wt-modal[data-test="add-shortcut"]',
                    )!.requestClose("cancel");
                  else this.addingShortcut = null;
                }}
                >${t("action.cancel")}</wt-button
              ></dashboard-home-shortcut-picker
            >`
          : nothing
      }
    </wt-modal>`;
  }

  #renderLiveWords() {
    const words = this.statusError
      ? this.statusResetRequired
        ? codeMessage("menu.reset_required")
        : t("menus.status_error")
      : this.status === null
        ? t("menus.status_loading")
        : liveWords(this.status);
    return html`<span class="live" data-test="menu-status">(${words})</span>`;
  }

  #hasUnpublishedChanges(): boolean {
    return !this.statusError && this.status?.state === "changed";
  }

  /** On the Prices tab the clash words stay plain words, since a link would only open it again. */
  #renderClashes(menuId: string) {
    const clashes =
      this.statusError || (this.view === "preview" && this.previewError)
        ? 0
        : (this.status?.clashes ?? 0);
    if (!clashes) return nothing;
    const waits =
      clashes === 1
        ? t("menus.publish_waits_clash")
        : t("menus.publish_waits_clashes").replace("{count}", String(clashes));
    return html`<p class="status-line" data-test="menu-clashes">
      ${
        this.view === "prices"
          ? html`<span class="clashes" data-test="status-clashes">${waits}</span>`
          : html`<a
              class="clashes"
              data-test="status-clashes"
              href=${tabAddress(menuId, "prices")}
              @click=${(event: MouseEvent) => this.#openTab(event, menuId, "prices")}
              >${waits}</a
            >`
      }
    </p>`;
  }

  #renderIncludeEdit() {
    const node = this.editingInclude?.node;
    return html`<dashboard-include-folder-form
      data-test="include-folder-form"
      .open=${node !== undefined}
      .busy=${this.busy}
      .api=${this.api}
      .languages=${currentContentLanguages()}
      menuName=${node ? this.#nodeName(node) : ""}
      .own=${node ? ownPresentation(node) : { names: {}, image: null, color: null }}
      .value=${node?.folder ?? null}
      .fieldErrors=${this.includeErrors}
      @wt-close=${{
        // The form stops its dialog's close, so it is caught on its way in.
        handleEvent: () => this.#windowClosed(),
        capture: true,
      }}
      @wt-submit=${(event: CustomEvent<IncludeFolderInput>) => {
        event.stopPropagation();
        this.#saveInclude(event.detail);
      }}
      @wt-cancel=${(event: Event) => {
        event.stopPropagation();
        this.editingInclude = null;
      }}
    ></dashboard-include-folder-form>`;
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
      .beforeClose=${leaveCoordinatorFor(this) ? this.#beforeProductsClose : undefined}
      heading=${t("sections.add_products_heading").replace("{name}", target?.name ?? "")}
      @keydown=${this.#guardEscape}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
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
                    if (leaveCoordinatorFor(this))
                      void this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
                        '[data-test="add-products"]',
                      )!.requestClose("cancel");
                    else this.addingProducts = null;
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
        <div class="title">
          <h1>${name || t("menus.title")}</h1>
          ${this.#renderLiveWords()}
        </div>
      </div>
      ${this.#renderClashes(menuId)} ${this.#renderLoadState()} ${this.#renderMemberError()}
      ${this.statusesError && this.statusesResetRequired ? html`<p class="error" role="alert" data-test="status-reset-error">${codeMessage("menu.reset_required")}</p>` : nothing}
      <wt-tabs
        data-test="menu-tabs"
        label=${name || t("menus.title")}
        .value=${this.view}
        .items=${[
          { key: "structure", label: t("menus.tab_structure") },
          { key: "prices", label: t("menus.tab_prices") },
          { key: "home", label: t("menus.tab_home") },
          {
            key: "preview",
            label: t("menus.tab_preview"),
            marked: this.#hasUnpublishedChanges() ? t("menus.tab_preview_unpublished") : undefined,
          },
        ]}
        @wt-tab-change=${(event: CustomEvent<{ value: string }>) => {
          this.showPriceClashes = false;
          this.#showView(event.detail.value as Tab);
          this.#url.write({ view: event.detail.value, "price-filter": null });
        }}
      >
        <div slot="structure">${this.#renderStructure()}</div>
        <div slot="prices" class="prices">${this.#renderPrices()}</div>
        <div slot="home" class="home">${this.#renderHome()}</div>
        <div slot="preview">${this.#renderPreview()}</div>
      </wt-tabs>
      ${this.#renderNewSection()} ${this.#renderIncludeEdit()} ${this.#renderAddProducts()}
      ${this.#renderShortcutPicker()}`;
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
