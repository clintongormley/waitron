import { needsModifierPicker } from "../state/order-line.js";
import { refreshProductDeclarations } from "../state/menu-refresh.js";
import type { ChangeAvailability, ChangeOptionAvailability } from "./product-info.js";
import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { orderableMenus, EMPTY_MENU_FILTERS, type MenuFilters } from "../menu-filter.js";
import {
  LitElement,
  css,
  html,
  nothing,
  unsafeCSS,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  currentContentLanguages,
  readableTextColor,
  registerIcons,
  visuallyHiddenStyles,
  Gestures,
} from "@waitron/ui";
import "./product-info.js";
import { nutritionDietLabels } from "../diet-labels.js";
import {
  centsToDecimal,
  copiesListing,
  foldCache,
  placeInOrder,
  setMenuCopyOf,
  suggestMove,
  type DishMove,
  type DishPlace,
  type DishToPlace,
  foldForSearch,
  formatMoney,
  searchFor,
  type NameSearch,
  HOME_GRID_COLUMNS,
  HOME_DISPLAY_DEFAULTS,
  arrangeHome,
  indexDocument,
  openedSection,
  sectionTrail,
  shownMembers,
  tileFill,
  tilePaths,
  type BillSetMenuState,
  type HomeIndex,
  type SectionStep,
} from "@waitron/shared";
import type { DocumentMember, DocumentTile, HomeDisplay, HomeTileMode } from "@waitron/shared";
import "./modifier-picker.js";
import "./tender-pay.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { countText, currentLocale, fill, t } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import { helpBadge } from "./help-badge.js";
import { menuTileStyles } from "./menu-tile-styles.js";
import { productName, productTilePrice } from "./product-name.js";
import { hasSomethingToSell, pickProduct, setMenuProduct } from "./product-pick.js";
import {
  draftMenuDishes,
  draftPlacementId,
  menusWithCopies,
  type OrderingCopy,
} from "../state/set-menus.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";
import { type PickSetMenuDishDetail } from "./set-menu-folder.js";

registerIcons({
  "menu-section":
    "M1.5 3.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z",
});

type SectionNode = Extract<DocumentMember, { kind: "section" }>;

type MenuIndex = HomeIndex<TillProduct>;
type SetMenuPlaceChoice = { label: string; run: () => Promise<string | undefined> };
type SetMenuTarget = DishPlace | ReadonlySet<string>;
type MenuPick = {
  detail: PickSetMenuDishDetail;
  confirmed?: ModifierConfirmDetail;
  existing?: OrderLine;
};
const EMPTY_SET_MENUS: BillSetMenuState = { copies: [], dishes: [], setMenus: [], recorded: {} };
function listsSetMenu(members: readonly DocumentMember[], id: string): boolean {
  return members.some((member) =>
    member.kind === "set_menu"
      ? member.menuId === id
      : member.kind === "section" && listsSetMenu(member.members, id),
  );
}

type SearchResult =
  | { kind: "product"; product: TillProduct }
  | { kind: "set_menu"; row: OrderingCopy }
  | { kind: "section"; section: SectionNode; path: SectionStep[]; disabled: boolean };

/**
 * A product member whose offer is not among `products` is left out, and so is one not sold
 * separately, which is ordered only as an extra on another dish, and a section left with nothing
 * to order. Staff only is shown: every till screen is staff's.
 */
function indexMenu(
  menu: TillZoneMenu,
  products: TillProduct[],
  copies: readonly OrderingCopy[] = [],
): MenuIndex {
  const offers = new Map(
    products
      .filter((product) => product.ordering !== "not_sold_separately")
      .map((product) => [product.menuItemId, product]),
  );
  return indexDocument(
    menu.structure.members,
    (id) => offers.get(id),
    (id) => copies.some(({ copy }) => copy.menuId === id),
  );
}

function thumb(image: string): TemplateResult {
  return html`<img class="thumb" src=${liveMediaImage(image, "till")} alt="" />`;
}

const paints = new Map<string, string>();

/** Custom properties for a tile painted in a colour `tileFill` has checked, with black or white ink
 * for contrast. Worked out once per colour, not on every render of every tile. */
function tilePaint(color: string): string {
  let paint = paints.get(color);
  if (paint === undefined)
    paints.set(color, (paint = `--tile-fill:${color};--tile-ink:${readableTextColor(color)}`));
  return paint;
}

/**
 * The till's menu home: search, then the menu's Device Home Page shortcuts and the menu's own
 * structure in the order the device's display sets, with each section opening in place behind a
 * breadcrumb. Tiles coordinate only through the store: they never reference the basket or total
 * widgets.
 *
 * When a new `menu` or `products` no longer holds the open section, or any section on the way to
 * it, it says "Not found" and shows home.
 */
@customElement("till-menu-browser")
export class TillMenuBrowser extends LitElement {
  #gestures?: Gestures;
  #pressedProduct?: TillProduct;
  #pressedTarget?: EventTarget;
  #suppressClick = false;
  @state() private infoProduct?: TillProduct;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#gestures = new Gestures(this, {
      holdStart: (at) => {
        if (at.target === this.#pressedTarget) this.#suppressClick = true;
      },
      longPress: (at) => {
        if (at.target === this.#pressedTarget && this.#pressedProduct)
          this.infoProduct = this.#pressedProduct;
      },
      cancel: () => {
        this.#suppressClick = true;
      },
    });
  }

  override disconnectedCallback(): void {
    this.#gestures?.disconnect();
    this.#pressedProduct = undefined;
    this.infoProduct = undefined;
    super.disconnectedCallback();
  }
  constructor() {
    super();
    new ContentLanguageController(this);
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-4);
        align-content: start;
      }

      .menu-toolbar,
      [data-region="search"] {
        display: flex;
        gap: var(--wt-space-2);
        align-items: end;
      }
      ::slotted([slot="menu-picker"]) {
        flex: 1;
      }

      [data-region="search"] {
        flex: 2;
        min-inline-size: 0;
      }

      @supports (grid-template-columns: subgrid) {
        .menu-toolbar[data-menu-picker] {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
        }

        .menu-toolbar[data-menu-picker] [data-region="search"] {
          display: grid;
          grid-column: 2 / -1;
          grid-template-columns: subgrid;
        }
      }

      [data-menu-content] {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-4);
      }

      [data-region="search"][inert],
      [data-menu-content][inert] {
        opacity: var(--wt-opacity-disabled);
      }

      [data-region="search"] wt-input {
        flex: 1;
        min-width: 0;
      }

      section {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-2);
      }

      [data-region="results"] h2 {
        ${visuallyHiddenStyles}
      }

      [data-region="results"] h3 {
        margin: 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      section[data-menu] + section[data-menu] {
        padding-block-start: var(--wt-space-2);
        border-block-start: 1px solid var(--wt-color-border);
      }

      .divider {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }

      .divider::before,
      .divider::after {
        content: "";
        flex: 1;
        border-block-start: 1px solid var(--wt-color-border);
      }

      .grid {
        display: grid;
        gap: var(--wt-space-3);
        grid-template-columns: ${unsafeCSS(HOME_GRID_COLUMNS)};
      }

      .grid[data-device="handheld"] {
        --home-tile-min: calc(var(--wt-tap-min) * 1.5);
      }

      ${menuTileStyles}

      .empty {
        margin: 0;
      }

      .notice {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
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

      .sep {
        color: var(--wt-color-text-muted);
      }

      .weigh {
        position: sticky;
        bottom: 0;
        z-index: 2;
        background: var(--wt-color-bg);
      }
    `,
  ];

  /** The menu as a zone-offers body serves it: its structure and its Device Home Page. Nothing
   * renders until it is set. */
  @property({ attribute: false }) changeAvailability?: ChangeAvailability;
  @property({ attribute: false }) changeOptionAvailability?: ChangeOptionAvailability;
  @property({ attribute: false }) menu?: TillZoneMenu;
  @property({ type: Boolean }) hasMenuPicker = false;
  @property({ type: Boolean }) locked = false;

  /** This menu's offers as till products. */
  @property({ attribute: false }) products: TillProduct[] = [];
  @property({ attribute: false }) filters: MenuFilters = EMPTY_MENU_FILTERS;

  /** This menu's offers before the diet filter. A section it holds and `products` does not is drawn
   * greyed in its place; unset, such a section is left out. */
  @property({ attribute: false }) unfilteredProducts?: TillProduct[];

  /** Every menu the device is served in its zone, in the zone's order, the shown one included. */
  @property({ attribute: false }) menus: readonly TillZoneMenu[] = [];

  /** Every served menu's offers as till products, through the same diet lens as `products`. */
  @property({ attribute: false }) servedProducts: TillProduct[] = [];

  @property({ attribute: false }) unfilteredServedProducts?: TillProduct[];

  @property({ attribute: false }) store!: WorkingOrderStore;

  /** Product id → items of that dish in the New order; a tile with a number above 0 shows it. */
  @property({ attribute: false }) inOrder?: ReadonlyMap<string, number>;

  /** Whether it shows the menu's Handheld display rather than its Till one. */
  @property({ type: Boolean }) handheld = false;

  /** Asks a weighed dish's weight itself, with the pay widget's weight entry, for a screen whose own
   * pay widget does not take the dish. */
  @property({ type: Boolean }) weighs = false;

  #waitingForMenu(): boolean {
    return this.hasMenuPicker && this.menu === undefined;
  }

  /** The open section's path, as {@link sectionTrail} reads it. Empty is home. */
  @state() private path: SectionStep[] = [];

  @state() private query = "";

  @state() private notFound = false;

  @state() private pickerProduct?: TillProduct;
  #pickerSetMenu?: { pick: MenuPick; target?: SetMenuTarget };

  @property({ attribute: false }) setMenuCopies: readonly OrderingCopy[] = [];
  @property({ attribute: false }) setMenuBill?: BillSetMenuState;
  @property({ attribute: false }) setMenuCourses: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) addSetMenu?: (id: string) => Promise<string | undefined>;
  @property({ attribute: false }) moveSetMenuDishes?: (
    moves: readonly DishMove[],
  ) => Promise<string | undefined>;
  @property({ attribute: false }) setMenuDishNames: ReadonlyMap<string, string> = new Map();
  @state() private placeRequest?: MenuPick;
  #replaceAfterPick?: OrderLine;
  @state() private setMenuError = "";
  @state() private changingSetMenu = false;
  @state() private setMenuFolder?: { id?: string; held: boolean };

  #indexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #unfilteredIndexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #otherIndexes = new WeakMap<TillZoneMenu, { products: TillProduct[]; index: MenuIndex }>();

  #trailShown: SectionNode[] = [];

  #pendingSection?: { menuId: string; sourceId: string; path: SectionStep[] };

  #otherUnfilteredIndexes = new WeakMap<
    TillZoneMenu,
    { products: TillProduct[]; index: MenuIndex }
  >();

  /** Each indexed product with its name folded for search. Keyed by the index alone because
   * {@link productName} reads no language. */
  #searchable = new WeakMap<MenuIndex, [TillProduct, string][]>();

  #sectionSearchName = foldCache<SectionNode>();

  #customerSearchName = foldCache<TillProduct>();

  #index(menu: TillZoneMenu): MenuIndex {
    const cached = this.#indexed;
    if (cached?.menu === menu && cached.products === this.products) return cached.index;
    const index = indexMenu(menu, this.products, this.setMenuCopies);
    this.#indexed = { menu, products: this.products, index };
    return index;
  }

  #unfilteredIndex(menu: TillZoneMenu): MenuIndex {
    const products = this.unfilteredProducts;
    if (products === undefined || products === this.products) return this.#index(menu);
    const cached = this.#unfilteredIndexed;
    if (cached?.menu === menu && cached.products === products) return cached.index;
    const index = indexMenu(menu, products, this.setMenuCopies);
    this.#unfilteredIndexed = { menu, products, index };
    return index;
  }

  /** Another served menu's index, over `servedProducts`: a menu's structure names only its own
   * offers, so a product on two menus is indexed at each menu's offer. */
  #otherIndex(menu: TillZoneMenu): MenuIndex {
    const cached = this.#otherIndexes.get(menu);
    if (cached?.products === this.servedProducts) return cached.index;
    const index = indexMenu(menu, this.servedProducts);
    this.#otherIndexes.set(menu, { products: this.servedProducts, index });
    return index;
  }

  #otherUnfilteredIndex(menu: TillZoneMenu): MenuIndex {
    const products = this.unfilteredServedProducts ?? this.servedProducts;
    const cached = this.#otherUnfilteredIndexes.get(menu);
    if (cached?.products === products) return cached.index;
    const index = indexMenu(menu, products);
    this.#otherUnfilteredIndexes.set(menu, { products, index });
    return index;
  }

  #currentInfoOffer(product: TillProduct): TillProduct | undefined {
    const key = product.menuItemId ?? product.id;
    return [...this.products, ...this.servedProducts].find(
      (candidate) =>
        (candidate.menuItemId ?? candidate.id) === key &&
        candidate.ordering !== "not_sold_separately",
    );
  }

  /** The open section is judged before each render, so a menu that has lost it never draws it. */
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("setMenuCopies")) {
      this.#indexed = undefined;
      this.#unfilteredIndexed = undefined;
      const id = this.setMenuFolder?.id;
      if (id !== undefined && !this.setMenuCopies.some(({ copy }) => copy.menuId === id))
        this.setMenuFolder = undefined;
    }
    if (this.#waitingForMenu()) {
      this.#pendingSection = undefined;
      this.query = "";
      this.path = [];
      this.notFound = false;
      this.infoProduct = undefined;
      if (this.#pickerSetMenu === undefined || this.setMenuCopies.length === 0) {
        this.pickerProduct = undefined;
        this.#pickerSetMenu = undefined;
        this.#replaceAfterPick = undefined;
      }
      if (this.setMenuCopies.length === 0) {
        this.setMenuFolder = undefined;
        this.placeRequest = undefined;
        this.setMenuError = "";
      }
      return;
    }
    if (this.infoProduct) this.infoProduct = this.#currentInfoOffer(this.infoProduct);
    if (this.pickerProduct && this.#pickerSetMenu === undefined)
      this.pickerProduct = refreshProductDeclarations(this.pickerProduct, [
        ...(this.unfilteredProducts ?? this.products),
        ...(this.unfilteredServedProducts ?? this.servedProducts),
      ]);
    if (this.menu === undefined) return;
    const pending = this.#pendingSection;
    if (pending !== undefined) {
      const target = orderableMenus(this.menus).find((menu) => menu.id === pending.menuId);
      const arrived = this.menu.id === pending.menuId;
      const index = arrived
        ? this.#index(this.menu)
        : target === undefined
          ? undefined
          : this.#otherIndex(target);
      if (
        target === undefined ||
        index === undefined ||
        !this.#pathAvailable(pending.path, index) ||
        (!arrived && this.menu.id !== pending.sourceId)
      ) {
        this.#pendingSection = undefined;
        this.notFound = true;
        this.path = [];
      } else if (arrived) {
        this.#pendingSection = undefined;
        this.#open(pending.path);
      }
    }
    const trail = sectionTrail(this.path, this.#index(this.menu));
    if (trail === null) {
      this.notFound = true;
      this.path = [];
    }
    this.#trailShown = trail ?? [];
  }

  #pathAvailable(path: SectionStep[], index: MenuIndex): boolean {
    const section = sectionTrail(path, index)?.at(-1);
    if (section === undefined) return false;
    const holdsOffers = (members: readonly DocumentMember[]): boolean =>
      members.some((member) =>
        member.kind === "product"
          ? index.products.has(member.productId)
          : member.kind === "section" && holdsOffers(member.members),
      );
    return holdsOffers(section.members);
  }

  #open(path: SectionStep[]): void {
    this.notFound = false;
    this.path = path;
    this.setMenuFolder = undefined;
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("path")) void this.#revealTrail();
  }

  /** Waits for the section's buttons to draw: scrolled before they have their height, the trail
   * ends above view once they grow and the browser's scroll anchoring moves the page. */
  async #revealTrail(): Promise<void> {
    const trail = this.renderRoot.querySelector("nav.breadcrumb");
    if (trail === null) return;
    const buttons = this.renderRoot.querySelectorAll<LitElement>(
      '[data-region="section"] wt-button',
    );
    await Promise.all([...buttons].map((button) => button.updateComplete));
    if (trail.isConnected) trail.scrollIntoView({ block: "nearest" });
  }

  #pick(product: TillProduct, replacing?: OrderLine): void {
    this.notFound = false;
    pickProduct(
      product,
      this.store,
      (picked) => {
        this.#replaceAfterPick = replacing;
        this.pickerProduct = picked;
      },
      replacing,
    );
  }

  #onSearch(event: CustomEvent<{ value: string }>): void {
    this.#pendingSection = undefined;
    this.query = event.detail.value;
    this.setMenuFolder = undefined;
    this.notFound = false;
  }

  #pickCandidates(pick: MenuPick): DishToPlace[] {
    const product = pick.confirmed?.product ?? setMenuProduct(pick.detail);
    const variants =
      pick.confirmed === undefined && product.variants?.length
        ? product.variants.filter(({ available }) => available).map(({ id }) => id)
        : [product.variantId ?? null];
    return variants.map((variantId) => ({
      id: "picked-dish",
      productId: product.productId ?? product.id,
      variantId,
      reserved: null,
    }));
  }

  #pickSetMenu(pick: MenuPick, target?: SetMenuTarget): void {
    const product = pick.confirmed?.product ?? setMenuProduct(pick.detail);
    if (!hasSomethingToSell(product) || this.store.editsLocked) return;
    const bill = this.setMenuBill ?? EMPTY_SET_MENUS;
    const candidates = this.#pickCandidates(pick);
    const draft = draftMenuDishes(this.store.lines.filter((line) => line !== pick.existing));
    const reserved =
      target === undefined || "place" in target
        ? target
        : candidates.flatMap(
            (dish) =>
              placeInOrder(
                {
                  ...bill,
                  setMenus: bill.setMenus.filter(({ lineId }) => target.has(lineId)),
                },
                [dish],
              ).placed,
          )[0];
    if (
      reserved === undefined &&
      (target !== undefined ||
        !candidates.some(
          (dish) => !placeInOrder(bill, [...draft, dish]).unplaced.includes(dish.id),
        ))
    ) {
      this.setMenuError = "";
      this.placeRequest = { ...pick };
      return;
    }
    if (pick.confirmed === undefined && needsModifierPicker(product)) {
      this.#pickerSetMenu = { pick, target };
      this.pickerProduct = product;
      return;
    }
    this.store.addProduct(
      product,
      "1",
      {
        ...pick.confirmed,
        setMenu: { id: pick.detail.setMenuId, reserved },
      },
      pick.existing,
    );
  }

  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    const setMenu = this.#pickerSetMenu;
    this.#pickerSetMenu = undefined;
    this.pickerProduct = undefined;
    if (setMenu !== undefined) {
      this.#pickSetMenu({ ...setMenu.pick, confirmed: detail }, setMenu.target);
      return;
    }
    const replacing = this.#replaceAfterPick;
    this.#replaceAfterPick = undefined;
    this.store.addProduct(detail.product, "1", detail, replacing);
  }

  openSetMenuPlace(line: OrderLine): boolean {
    const row = this.setMenuCopies.find(({ copy }) => copy.menuId === line.setMenuId);
    const offer = row?.copy.offers.find(({ id }) => id === line.product.menuItemId);
    if (row === undefined || offer === undefined) return false;
    this.setMenuError = "";
    this.placeRequest = {
      detail: { offer, setMenuId: row.copy.menuId, versionId: row.versionId },
      confirmed: {
        product: line.product,
        extras: line.extras,
        options: line.options,
        optionSnapshots: line.optionSnapshots,
        note: line.note,
      },
      existing: line,
    };
    return true;
  }

  #placeChoices(pick: MenuPick): SetMenuPlaceChoice[] {
    const bill = this.setMenuBill ?? EMPTY_SET_MENUS;
    const draft = this.store.lines.filter((line) => line !== pick.existing);
    const dishes = draftMenuDishes(draft);
    const placed = placeInOrder(bill, dishes).placed;
    const candidates = this.#pickCandidates(pick);
    const choices: SetMenuPlaceChoice[] = [];
    const add = this.addSetMenu;
    if (add !== undefined)
      for (const { copy, versionId } of this.setMenuCopies) {
        if (
          !candidates.some(
            ({ productId, variantId }) =>
              copiesListing([setMenuCopyOf(copy, versionId)], productId, variantId).length > 0,
          )
        )
          continue;
        choices.push({
          label: `${fill(t("set_menu.add"), { name: copy.name })} (${formatMoney(copy.terms.price, currentLocale())})`,
          run: async () => {
            const error = await add(copy.menuId);
            if (error !== undefined || !this.isConnected) return error;
            const now = this.setMenuBill ?? EMPTY_SET_MENUS;
            const old = new Set(bill.setMenus.map(({ lineId }) => lineId));
            const added = new Set(
              now.setMenus.map(({ lineId }) => lineId).filter((id) => !old.has(id)),
            );
            const pinned = new Map<number, OrderLine>();
            for (const { id, place, setMenuLineId } of placed) {
              const line = draft.find((line, index) => draftPlacementId(line, index) === id)!;
              const index = this.store.lines.indexOf(line);
              if (index >= 0)
                pinned.set(index, { ...line, setMenuReserved: { place, setMenuLineId } });
            }
            if (pinned.size > 0) this.store.adoptLines(pinned);
            this.#pickSetMenu(pick, added);
            return undefined;
          },
        });
      }
    const move = this.moveSetMenuDishes;
    if (move !== undefined && candidates.length === 1) {
      const drafted = placed.map((place) => ({
        ...dishes.find(({ id }) => id === place.id)!,
        ...place,
      }));
      const suggestion = suggestMove(bill, drafted, candidates[0]!);
      if (suggestion !== null && suggestion.moves.length > 0) {
        const names = new Map(
          menusWithCopies(bill).map(({ menu, copy }) => [menu.lineId, copy.name]),
        );
        const moves = suggestion.moves.map(({ lineId, to, priceCents }) =>
          fill(t("set_menu.move_named"), {
            dish: this.setMenuDishNames.get(lineId) ?? lineId,
            menu: names.get(to.setMenuLineId) ?? "",
            price: formatMoney(centsToDecimal(priceCents), currentLocale()),
          }),
        );
        choices.push({
          label: fill(t("set_menu.move_for_dish"), {
            moves: moves.join(" · "),
            dish: pick.detail.offer.name,
          }),
          run: async () => {
            const error = await move(suggestion.moves.map(({ lineId, to }) => ({ lineId, to })));
            if (error === undefined && this.isConnected) this.#pickSetMenu(pick, suggestion.place);
            return error;
          },
        });
      }
    }
    const ordinary = (this.unfilteredServedProducts ?? this.servedProducts).find(
      (product) =>
        (product.productId ?? product.id) === pick.detail.offer.productId &&
        product.ordering !== "not_sold_separately" &&
        hasSomethingToSell(product),
    );
    if (ordinary !== undefined)
      choices.push({
        label: fill(t("set_menu.order_separately"), {
          price: formatMoney(ordinary.unitPrice, currentLocale()),
        }),
        run: async () => {
          this.#pick(ordinary, pick.existing);
          return undefined;
        },
      });
    return choices;
  }

  #sectionName(section: SectionNode): string {
    return descriptionFor(section.names, section.internalName);
  }

  #display(menu: TillZoneMenu): HomeDisplay {
    return menu.home[this.handheld ? "handheld" : "till"];
  }

  #grid(content: unknown, display: HomeDisplay): TemplateResult {
    return html`<div
      class="grid"
      data-device=${this.handheld ? "handheld" : "till"}
      style=${`--columns: ${display.columns};`}
    >
      ${content}
    </div>`;
  }

  #productMatches(index: MenuIndex, search: NameSearch): TillProduct[] {
    let names = this.#searchable.get(index);
    if (names === undefined) {
      names = [...index.products.values()].map((product): [TillProduct, string] => [
        product,
        foldForSearch(productName(product)),
      ]);
      this.#searchable.set(index, names);
    }
    return search(names);
  }

  #matches(
    menu: TillZoneMenu,
    index: MenuIndex,
    unfiltered: MenuIndex,
    search: NameSearch,
  ): SearchResult[] {
    this.#productMatches(index, searchFor(""));
    const productNames = new Map(this.#searchable.get(index)!);
    const seen = new Set<string>();
    const seenSetMenus = new Set<string>();
    const walk = (members: readonly DocumentMember[], path: SectionStep[]) => {
      const list = shownMembers(members, true);
      const paths = tilePaths(list, path);
      const named: [SearchResult, string][] = [];
      const customerNamed: [SearchResult, string][] = [];
      let populated = false;
      let enabled = false;
      list.forEach((member, position) => {
        if (member.kind === "product") {
          populated ||= unfiltered.products.has(member.productId);
          const product = index.products.get(member.productId);
          if (product === undefined) return;
          enabled = true;
          if (seen.has(member.productId)) return;
          seen.add(member.productId);
          const result: SearchResult = { kind: "product", product };
          named.push([result, productNames.get(product)!]);
          const customerName = descriptionFor(product.customerName ?? {}, "");
          if (customerName !== "")
            customerNamed.push([result, this.#customerSearchName(product, customerName)]);
        } else if (member.kind === "set_menu") {
          const row = this.#setMenuCopy(member.menuId);
          if (row === undefined || seenSetMenus.has(member.menuId)) return;
          seenSetMenus.add(member.menuId);
          named.push([{ kind: "set_menu", row }, foldForSearch(row.copy.name)]);
        } else {
          const opens = paths[position]!;
          const children = walk(member.members, opens);
          if (children.populated) {
            populated = true;
            enabled ||= children.enabled;
            named.push([
              { kind: "section", section: member, path: opens, disabled: !children.enabled },
              this.#sectionSearchName(member, this.#sectionName(member)),
            ]);
          }
          named.push(...children.named);
          customerNamed.push(...children.customerNamed);
        }
      });
      return { named, customerNamed, populated, enabled };
    };
    const { named, customerNamed } = walk(menu.structure.members, []);
    const found = search(named);
    const shown = new Set(found);
    return [...found, ...search(customerNamed).filter((result) => !shown.has(result))];
  }

  #resultTile(result: SearchResult, mode: HomeTileMode, menuId: string): TemplateResult {
    if (result.kind === "product")
      return this.#productButton(result.product, mode, () => this.#pick(result.product));
    if (result.kind === "set_menu") return this.#setMenuTile(result.row);
    return this.#sectionButton(
      result.section,
      mode,
      result.disabled
        ? undefined
        : () => {
            this.query = "";
            if (this.menu!.id === menuId) this.#open(result.path);
            else {
              this.path = [];
              this.notFound = false;
              this.#pendingSection = { menuId, sourceId: this.menu!.id, path: result.path };
              this.dispatchEvent(
                new CustomEvent("menu-selected", {
                  detail: { id: menuId },
                  bubbles: true,
                  composed: true,
                }),
              );
            }
          },
    );
  }

  #productButton(product: TillProduct, mode: HomeTileMode, onTap: () => void): TemplateResult {
    const price = productTilePrice(product);
    const sellable = hasSomethingToSell(product);
    const fill = tileFill(mode, product.image, product.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    const marked =
      Object.keys(product.allergens ?? {}).length > 0 ||
      nutritionDietLabels(product.diet, product.dietaryDeclarations).length > 0;
    const inOrder = this.inOrder?.get(product.id) ?? 0;
    return html`<wt-button
      class="tile"
      data-kind="product"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
      ?data-sold-out=${!sellable}
      ?data-nutrition=${marked}
      ?data-counted=${this.inOrder !== undefined}
      ?data-in-order=${inOrder > 0}
      @contextmenu=${(event: Event) => event.preventDefault()}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          this.infoProduct = product;
        }
      }}
      @pointerdown=${(event: PointerEvent) => {
        this.#pressedProduct = product;
        this.#pressedTarget = event.composedPath()[0];
        this.#suppressClick = false;
      }}
      @click=${(event: MouseEvent) => {
        if (event.detail === 0 || !this.#suppressClick) {
          if (!sellable) this.infoProduct = product;
          else onTap();
        }
      }}
    >
      ${marked ? html`<wt-icon class="nutrition-mark" name="allergies"></wt-icon>` : nothing}
      ${
        inOrder > 0
          ? html`<span class="in-order" data-in-order-count aria-hidden="true">${inOrder}</span>`
          : nothing
      }
      <span class="label">
        ${fill.kind === "image" ? thumb(fill.image) : nothing}
        <span class="name" lang=${currentContentLanguages().defaultLanguage}
          >${productName(product)}</span
        >
        <span class="price">${price}</span>
        ${sellable ? nothing : html`<span class="sold-out">${t("menu.sold_out")}</span>`}
        ${
          inOrder > 0
            ? html`<span class="in-order-words"
                >, ${countText(inOrder, "order_counts.unsent", "order_counts.unsent_one")}</span
              >`
            : nothing
        }
      </span>
    </wt-button>`;
  }

  /** Without `onTap`, the section is one the diet filter emptied: greyed and not openable. */
  #sectionButton(section: SectionNode, mode: HomeTileMode, onTap?: () => void): TemplateResult {
    const fill = tileFill(mode, section.image, section.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    const filtered = onTap === undefined;
    return html`<wt-button
      class="tile"
      data-kind="section"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
      ?data-filtered=${filtered}
      ?disabled=${filtered}
      @click=${onTap ?? nothing}
    >
      <span class="label">
        ${
          fill.kind === "image"
            ? html`<span class="section-photo">
                ${thumb(fill.image)}
                <wt-icon class="folder-badge" name="menu-section" aria-hidden="true"></wt-icon>
              </span>`
            : html`<wt-icon name="menu-section" aria-hidden="true"></wt-icon>`
        }
        <span class="name">${this.#sectionName(section)}</span>
        <span class="section-kind">${t("menu.section")}</span>
        ${filtered ? html`<span class="kind">${t("menu.filtered_out")}</span>` : nothing}
      </span>
    </wt-button>`;
  }

  /** The button for a section or product the index holds, a greyed one for a section only the
   * unfiltered index holds, else nothing; `opens` is the path a section tile opens. A structural
   * section is drawn from itself, a section shortcut from the copy it opens. */
  #tile(
    ref: DocumentTile | DocumentMember,
    opens: SectionStep[],
    index: MenuIndex,
    mode: HomeTileMode,
  ): TemplateResult | typeof nothing {
    if (ref.kind === "empty") return nothing;
    if (ref.kind === "set_menu") {
      const row = this.#setMenuCopy(ref.menuId);
      return row === undefined ? nothing : this.#setMenuTile(row);
    }
    if (ref.kind === "section") {
      const id = ref.sectionId;
      const own = "members" in ref ? ref : undefined;
      if (index.sections.has(id))
        return this.#sectionButton(own ?? openedSection(id, index)!, mode, () => this.#open(opens));
      const unfiltered = this.#unfilteredIndex(this.menu!);
      return unfiltered.sections.has(id)
        ? this.#sectionButton(own ?? openedSection(id, unfiltered)!, mode)
        : nothing;
    }
    const product = index.products.get(ref.productId);
    return product === undefined
      ? nothing
      : this.#productButton(product, mode, () => this.#pick(product));
  }

  #listTiles(
    list: readonly DocumentMember[],
    path: SectionStep[],
    index: MenuIndex,
    mode: HomeTileMode,
  ): (TemplateResult | typeof nothing)[] {
    const opens = tilePaths(list, path);
    return list.map((member, place) => this.#tile(member, opens[place]!, index, mode));
  }

  #home(menu: TillZoneMenu, index: MenuIndex, display: HomeDisplay): TemplateResult {
    const shortcuts = menu.home.shortcuts.map((tile) =>
      this.#tile(
        tile,
        tile.kind === "section" ? [{ sectionId: tile.sectionId, copy: 0 }] : [],
        index,
        display.tiles,
      ),
    );
    const members = this.#listTiles(
      shownMembers(menu.structure.members, this.setMenuCopies.length > 0),
      [],
      index,
      display.tiles,
    );
    if (this.#heldMenuFolders().length > 0) members.push(this.#setMenuTile(undefined, true));
    const { blocks, divider } = arrangeHome(
      display.order,
      shortcuts.some((cell) => cell !== nothing),
      members.some((cell) => cell !== nothing),
    );
    return html`${blocks.map((block, place) => {
      const shortcutBlock = block === "shortcuts";
      const label = t(shortcutBlock ? "menu.shortcuts" : "menu.full");
      const cells = shortcutBlock
        ? shortcuts.map((cell) =>
            cell === nothing ? html`<span class="slot" aria-hidden="true"></span>` : cell,
          )
        : members;
      const region = shortcutBlock ? "shortcuts" : "structure";
      return place === 1 && divider
        ? html`<section data-region=${region} aria-labelledby=${`${region}-divider`}>
            <h2 class="divider" id=${`${region}-divider`}><span>${label}</span></h2>
            ${this.#grid(cells, display)}
          </section>`
        : html`<section data-region=${region} aria-label=${label}>
            ${this.#grid(cells, display)}
          </section>`;
    })}`;
  }

  #sectionView(trail: SectionNode[], index: MenuIndex, display: HomeDisplay): TemplateResult {
    const current = trail.at(-1)!;
    return html`<section data-region="section">
      <nav class="breadcrumb" aria-label=${t("menu.breadcrumb")}>
        <ol>
          <li>
            <wt-button variant="ghost" @click=${() => this.#open([])}>${t("menu.home")}</wt-button>
            <span class="sep" aria-hidden="true">›</span>
          </li>
          ${trail.slice(0, -1).map(
            (section, position) =>
              html`<li>
                <wt-button
                  variant="ghost"
                  @click=${() => this.#open(this.path.slice(0, position + 1))}
                  >${this.#sectionName(section)}</wt-button
                >
                <span class="sep" aria-hidden="true">›</span>
              </li>`,
          )}
          <li><span aria-current="location">${this.#sectionName(current)}</span></li>
        </ol>
      </nav>
      ${this.#grid(
        this.#listTiles(
          shownMembers(current.members, this.setMenuCopies.length > 0),
          this.path,
          index,
          display.tiles,
        ),
        display,
      )}
    </section>`;
  }

  #heldMenuFolders(): OrderingCopy[] {
    const recorded = this.setMenuBill?.recorded;
    if (recorded === undefined) return [];
    const menus = [...this.menus, ...(this.menu === undefined ? [] : [this.menu])];
    return this.setMenuCopies.filter(
      ({ copy }) =>
        Object.hasOwn(recorded, copy.menuId) &&
        !menus.some((menu) => menu.orderable && listsSetMenu(menu.structure.members, copy.menuId)),
    );
  }

  #setMenuCopy(menuId: string): OrderingCopy | undefined {
    return this.setMenuCopies.find(({ copy }) => copy.menuId === menuId);
  }

  #setMenuTile(row: OrderingCopy | undefined, held = false): TemplateResult {
    const copy = row?.copy;
    return html`<wt-button
      class="tile"
      data-kind=${copy === undefined ? "section" : "set_menu"}
      @click=${() => {
        this.setMenuFolder = { id: copy?.menuId, held };
      }}
      ><span class="label">
        <wt-icon name="menu-section"></wt-icon>
        <span class="name">${copy?.name ?? t("set_menu.folders")}</span>
        ${copy === undefined ? nothing : html`<span class="price">${formatMoney(copy.terms.price, currentLocale())}</span>`}
      </span></wt-button
    >`;
  }

  async #chooseSetMenu(run: () => Promise<string | undefined>, close = false): Promise<void> {
    if (this.changingSetMenu || this.store.editsLocked) return;
    const request = this.placeRequest;
    this.changingSetMenu = true;
    this.setMenuError = (await run().catch(() => codeMessage("server.internal"))) ?? "";
    this.changingSetMenu = false;
    if (close && this.setMenuError === "" && this.placeRequest === request)
      this.placeRequest = undefined;
  }

  #closeSetMenuPlace(event: Event): void {
    event.stopPropagation();
    this.placeRequest = undefined;
    this.setMenuError = "";
  }

  #setMenuView(row: OrderingCopy | undefined, display: HomeDisplay): TemplateResult {
    return html`<section data-region="section">
      <nav class="breadcrumb" aria-label=${t("menu.breadcrumb")}>
        <wt-button
          variant="ghost"
          @click=${() => {
            this.setMenuFolder =
              row !== undefined && this.setMenuFolder?.held ? { held: true } : undefined;
            this.setMenuError = "";
          }}
          >${t("action.back")}</wt-button
        >
      </nav>
      ${
        row === undefined
          ? this.#grid(
              this.#heldMenuFolders().map((held) => this.#setMenuTile(held, true)),
              display,
            )
          : html`<till-set-menu-folder
              .copy=${row.copy}
              .versionId=${row.versionId}
              .courseNames=${this.setMenuCourses}
              .busy=${this.changingSetMenu || this.store.editsLocked}
              @add-set-menu=${(event: CustomEvent<{ setMenuId: string }>) => this.addSetMenu && void this.#chooseSetMenu(() => this.addSetMenu!(event.detail.setMenuId))}
              @pick-set-menu-dish=${(event: CustomEvent<PickSetMenuDishDetail>) => this.#pickSetMenu({ detail: event.detail })}
            ></till-set-menu-folder>`
      }
      ${this.setMenuError === "" ? nothing : html`<p class="notice" role="alert">${this.setMenuError}</p>`}
    </section>`;
  }

  /** A menu's group carries no accessible name: two menus may share one, and two same-named
   * regions fail axe's landmark-unique. */
  #results(menu: TillZoneMenu, index: MenuIndex, display: HomeDisplay): TemplateResult {
    const search = searchFor(this.query);
    const found = this.#matches(menu, index, this.#unfilteredIndex(menu), search);
    const otherMenus = orderableMenus(this.menus).filter((other) => other.id !== menu.id);
    const others = otherMenus
      .map((other) => ({
        menu: other,
        found: this.#matches(
          other,
          this.#otherIndex(other),
          this.#otherUnfilteredIndex(other),
          search,
        ),
      }))
      .filter((other) => other.found.length > 0);
    const tiles = (results: SearchResult[], menuId: string) =>
      this.#grid(
        results.map((result) => this.#resultTile(result, display.tiles, menuId)),
        display,
      );
    const empty = (text: string) => html`<p class="empty">${text}</p>`;
    let body: TemplateResult;
    if (otherMenus.length === 0)
      body = found.length === 0 ? empty(t("menu.no_results")) : tiles(found, menu.id);
    else if (found.length === 0 && others.length === 0) body = empty(t("menu.no_results_any_menu"));
    else
      body = html`<section data-menu=${menu.id}>
          <h3>${t("menu.results_this_menu").replace("{menu}", () => menu.name)}</h3>
          ${found.length === 0 ? empty(t("menu.no_results_this_menu")) : tiles(found, menu.id)}
        </section>
        ${others.map(
          (other) =>
            html`<section data-menu=${other.menu.id}>
              <h3>${other.menu.name}</h3>
              ${tiles(other.found, other.menu.id)}
            </section>`,
        )}`;
    return html`<section data-region="results" aria-labelledby="results-heading">
      <h2 id="results-heading">${t("menu.results")}</h2>
      ${body}
    </section>`;
  }

  override render() {
    const menu = this.menu;
    const folder = this.setMenuCopies.find(({ copy }) => copy.menuId === this.setMenuFolder?.id);
    const display =
      menu === undefined
        ? HOME_DISPLAY_DEFAULTS[this.handheld ? "handheld" : "till"]
        : this.#display(menu);
    let view: TemplateResult | typeof nothing = nothing;
    if (this.setMenuFolder !== undefined) view = this.#setMenuView(folder, display);
    else if (menu !== undefined) {
      const index = this.#index(menu);
      const trail = this.#trailShown;
      view =
        this.query.trim() !== ""
          ? this.#results(menu, index, display)
          : trail.length > 0
            ? this.#sectionView(trail, index, display)
            : this.#home(menu, index, display);
    } else if (this.#heldMenuFolders().length > 0) {
      view = html`<section data-region="structure">
        ${this.#grid([this.#setMenuTile(undefined, true)], display)}
      </section>`;
    }
    const showContent = view !== nothing || this.placeRequest !== undefined;
    if (!showContent && !this.hasMenuPicker) return nothing;
    return html`
      ${
        menu === undefined && !this.hasMenuPicker
          ? nothing
          : html`<div class="menu-toolbar" ?data-menu-picker=${this.hasMenuPicker}>
              <slot name="menu-picker"></slot>
              ${
                menu === undefined
                  ? nothing
                  : html`<div data-region="search" ?inert=${this.locked}>
                      <wt-input
                        type="search"
                        name="menu-search"
                        label=${t("menu.search")}
                        .value=${this.query}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSearch(event)}
                        >${helpBadge("help.menu.dishes", t("menu.search"), {
                          guide: "products.nutrition-at-the-till",
                          slot: "help",
                        })}</wt-input
                      >
                      <slot name="filters"></slot>
                    </div>`
              }
            </div>`
      }
      ${
        showContent
          ? html`<div data-menu-content ?inert=${this.locked}>${this.#menuContent(view)}</div>`
          : nothing
      }
    `;
  }

  #menuContent(view: TemplateResult | typeof nothing): TemplateResult {
    return html`
      ${this.notFound ? html`<p class="notice" role="alert">${t("menu.not_found")}</p>` : nothing}
      ${view}
      ${
        this.placeRequest === undefined
          ? nothing
          : html`<wt-dialog
              ${trackDialog()}
              data-set-menu-place
              .open=${true}
              .dismissible=${!this.changingSetMenu}
              .heading=${fill(t("set_menu.no_place_heading"), { dish: this.placeRequest.detail.offer.name })}
              @wt-close=${this.#closeSetMenuPlace}
            >
              ${this.setMenuError === "" ? nothing : html`<p role="alert">${this.setMenuError}</p>`}
              <wt-button
                slot="footer"
                variant="secondary"
                ?disabled=${this.changingSetMenu}
                @click=${this.#closeSetMenuPlace}
                >${t("action.cancel")}</wt-button
              >
              ${this.#placeChoices(this.placeRequest).map(
                ({ label, run }) =>
                  html`<wt-button
                    slot="footer"
                    variant="secondary"
                    ?disabled=${this.changingSetMenu}
                    @click=${() => void this.#chooseSetMenu(run, true)}
                    >${label}</wt-button
                  >`,
              )}
            </wt-dialog>`
      }
      ${
        this.infoProduct
          ? html`<till-product-info
              .product=${this.infoProduct}
              .changeAvailability=${this.changeAvailability}
              .changeOptionAvailability=${this.changeOptionAvailability}
              @close-info=${(event: Event) => {
                event.stopPropagation();
                this.infoProduct = undefined;
              }}
              @add-product=${(event: CustomEvent<TillProduct>) => {
                event.stopPropagation();
                const current = this.#currentInfoOffer(event.detail);
                this.infoProduct = undefined;
                if (current) this.#pick(current);
              }}
            ></till-product-info>`
          : nothing
      }
      ${
        this.weighs && !this.#waitingForMenu()
          ? html`<till-tender-pay
              class="weigh"
              weighOnly
              .store=${this.store}
              .filters=${this.filters}
            ></till-tender-pay>`
          : nothing
      }
      ${
        this.pickerProduct
          ? html`<till-modifier-picker
              .product=${this.pickerProduct}
              .filters=${this.filters}
              @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) =>
                this.#onModifierConfirm(event.detail)}
              @wt-modifier-cancel=${() => {
                this.#pickerSetMenu = undefined;
                this.#replaceAfterPick = undefined;
                this.pickerProduct = undefined;
              }}
            ></till-modifier-picker>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-menu-browser": TillMenuBrowser;
  }
}
