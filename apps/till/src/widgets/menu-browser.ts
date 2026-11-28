import type { FirstReadView } from "../state/first-read.js";
import { firstMenuRead, firstReadNoticeStyles } from "./first-read-notice.js";
import { needsModifierPicker } from "../state/order-line.js";
import { refreshProductDeclarations } from "../state/menu-refresh.js";
import { orderableMenus, EMPTY_MENU_FILTERS, type MenuFilters } from "../menu-filter.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  menuTileStyles,
  visuallyHiddenStyles,
  Gestures,
} from "@waitron/ui";
import "./product-info.js";
import {
  foldCache,
  foldForSearch,
  formatMoney,
  searchFor,
  type NameSearch,
  arrangeHome,
  openedSection,
  sectionTrail,
  shownMembers,
  tilePaths,
  type BillSetMenuState,
  type SectionStep,
} from "@waitron/shared";
import type { DocumentMember, DocumentTile } from "@waitron/shared";
import "./modifier-picker.js";
import "./tender-pay.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import { menuOfferToTillProduct, type TillProduct, type TillZoneMenu } from "../api/menu-api.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import { helpBadge } from "./help-badge.js";
import { productName, soldByTheUnit } from "./product-name.js";
import { hasSomethingToSell, pickProduct, setMenuProduct } from "./product-pick.js";
import { setMenuLineOf, type OrderingCopy, type OwnSetMenuOffers } from "../state/set-menus.js";
import { type PickSetMenuDishDetail } from "./set-menu-folder.js";
import {
  dishTile,
  sectionTile,
  setMenuTile,
  type CountWords,
  type DishTileHandlers,
} from "./menu-tiles.js";
import { countedNameStyles } from "./counted-name.js";
import { menuPath, menuPathStyles } from "./menu-path.js";
import {
  indexMenu,
  listsSetMenu,
  type MenuIndex,
  type SearchResult,
  type SectionNode,
} from "./menu-index.js";

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
    firstReadNoticeStyles,
    menuTileStyles,
    countedNameStyles,
    menuPathStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-4);
        align-content: start;
      }

      [data-menu-head] {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--wt-space-2);
      }

      /* The path's own tap height already spaces it from the tiles below. */
      [data-menu-head]:has(> .breadcrumb) {
        margin-block-end: calc(-1 * (var(--wt-space-3) + var(--wt-space-1) / 2));
      }

      :host([pinned-head]) [data-menu-head] {
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--wt-color-bg);
      }

      /* The picker takes a line of its own, but a wrapping row still sums the two for its natural
         width, so a screen sizing the menu from that width gives it room for both side by side. */
      .menu-tools {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      ::slotted([slot="menu-picker"]) {
        flex: 1 0 100%;
      }

      [data-region="search"] {
        display: flex;
        flex: 1 1 auto;
        gap: var(--wt-space-2);
        align-items: center;
        min-inline-size: 0;
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
        max-width: none;
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

      .empty {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

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
  @property({ attribute: false }) menu?: TillZoneMenu;
  @property({ attribute: false }) firstRead?: FirstReadView;
  @property({ attribute: false }) retryFirstRead?: () => void;
  @property({ type: Boolean }) handheld = false;
  @property({ type: Boolean }) hasMenuPicker = false;
  /** Keeps the head in view while the tiles scroll under it. */
  @property({ type: Boolean, reflect: true, attribute: "pinned-head" }) pinnedHead = false;
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

  /** Product id → items of that dish in the order being taken (a table's New order or the
   * Counter's basket); a tile with a number above 0 shows it. */
  @property({ attribute: false }) inOrder?: ReadonlyMap<string, number>;
  @property() countWords: CountWords = "unsent";

  /** Uses the shared amount keypad when this screen takes payment elsewhere. */
  @property({ type: Boolean }) weighs = false;

  #waitingForMenu(): boolean {
    return this.hasMenuPicker && this.menu === undefined;
  }

  /** The open section's path, as {@link sectionTrail} reads it. Empty is home. */
  @state() private path: SectionStep[] = [];

  @state() private query = "";

  @state() private notFound = false;

  @state() private pickerProduct?: TillProduct;
  #pickerSetMenu?: PickSetMenuDishDetail;

  @property({ attribute: false }) setMenuCopies: readonly OrderingCopy[] = [];
  @property({ attribute: false }) ownSetMenuOffer?: OwnSetMenuOffers;
  @property({ attribute: false }) setMenuBill?: BillSetMenuState;
  @property({ attribute: false }) setMenuCourses: Readonly<Record<string, string>> = {};
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
    if (this.pickerProduct && this.#pickerSetMenu !== undefined)
      this.pickerProduct = this.#withOwnDeclarations(
        this.pickerProduct,
        this.#pickerSetMenu.setMenuId,
      );
    if (this.#waitingForMenu()) {
      this.#pendingSection = undefined;
      this.query = "";
      this.path = [];
      this.notFound = false;
      this.infoProduct = undefined;
      if (this.#pickerSetMenu === undefined || this.setMenuCopies.length === 0) {
        this.pickerProduct = undefined;
        this.#pickerSetMenu = undefined;
      }
      if (this.setMenuCopies.length === 0) {
        this.setMenuFolder = undefined;
      }
      return;
    }
    if (this.infoProduct) this.infoProduct = this.#currentInfoOffer(this.infoProduct);
    if (this.pickerProduct && this.#pickerSetMenu === undefined) {
      const { menuItemId } = this.pickerProduct;
      const own = (product: TillProduct) => product.menuItemId === menuItemId;
      this.pickerProduct = refreshProductDeclarations(
        this.pickerProduct,
        (this.unfilteredProducts ?? this.products).find(own) ??
          (this.unfilteredServedProducts ?? this.servedProducts).find(own),
      );
    }
    if (this.menu === undefined) return;
    const pending = this.#pendingSection;
    const previous = changed.get("menu") as TillZoneMenu | undefined;
    if (previous !== undefined && previous.id !== this.menu.id) {
      // Another menu's sections are not this one's; a search result waiting for it opens below.
      this.notFound = false;
      this.path = [];
      this.setMenuFolder = undefined;
    }
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

  #pick(product: TillProduct): void {
    this.notFound = false;
    pickProduct(product, this.store, (picked) => {
      this.pickerProduct = picked;
    });
  }

  #onSearch(event: CustomEvent<{ value: string }>): void {
    this.#pendingSection = undefined;
    this.query = event.detail.value;
    this.setMenuFolder = undefined;
    this.notFound = false;
  }

  #withOwnDeclarations(product: TillProduct, setMenuId: string): TillProduct {
    const own = this.ownSetMenuOffer?.(setMenuLineOf({ product, setMenuId }));
    return refreshProductDeclarations(product, own && menuOfferToTillProduct(own));
  }

  #pickSetMenu(pick: PickSetMenuDishDetail, confirmed?: ModifierConfirmDetail): void {
    const product = this.#withOwnDeclarations(
      confirmed?.product ?? setMenuProduct(pick),
      pick.setMenuId,
    );
    if (!hasSomethingToSell(product) || this.store.editsLocked) return;
    if (confirmed === undefined && needsModifierPicker(product)) {
      this.#pickerSetMenu = pick;
      this.pickerProduct = product;
      return;
    }
    this.store.addProduct(product, "1", { ...confirmed, setMenu: { id: pick.setMenuId } });
  }

  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    const setMenu = this.#pickerSetMenu;
    this.#pickerSetMenu = undefined;
    this.pickerProduct = undefined;
    if (setMenu !== undefined) this.#pickSetMenu(setMenu, detail);
    else this.store.addProduct(detail.product, "1", detail);
  }

  #sectionName(section: SectionNode): string {
    return descriptionFor(section.names, section.internalName);
  }

  #grid(content: unknown): TemplateResult {
    return html`<div class="grid">${content}</div>`;
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

  #resultTile(result: SearchResult, menuId: string): TemplateResult {
    if (result.kind === "product") return this.#dishTile(result.product);
    if (result.kind === "set_menu") return this.#setMenuTile(result.row);
    return this.#sectionTile(
      result.section,
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

  #keepTileAboveAmount(tile: HTMLElement): void {
    const panel = this.renderRoot.querySelector("till-tender-pay");
    if (!panel) return;
    requestAnimationFrame(() => {
      if (!tile.isConnected || panel.offsetHeight === 0) return;
      const tileBox = tile.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      if (tileBox.bottom > panelBox.top && tileBox.top < panelBox.bottom)
        tile.scrollIntoView({ block: "start" });
    });
  }

  #dishTile(product: TillProduct): TemplateResult {
    return dishTile(
      product,
      this.inOrder?.get(product.id),
      (tile) => {
        this.#pick(product);
        if (this.weighs && !soldByTheUnit(product)) this.#keepTileAboveAmount(tile);
      },
      this.#dishHandlers,
      this.countWords,
    );
  }

  #dishHandlers: DishTileHandlers = {
    info: (product) => {
      this.infoProduct = product;
    },
    press: (product, event) => {
      this.#pressedProduct = product;
      this.#pressedTarget = event.composedPath()[0];
      this.#suppressClick = false;
    },
    held: () => this.#suppressClick,
  };

  #sectionTile(section: SectionNode, onTap?: () => void): TemplateResult {
    return sectionTile(this.#sectionName(section), onTap);
  }

  /** The button for a section or product the index holds, a greyed one for a section only the
   * unfiltered index holds, else nothing; `opens` is the path a section tile opens. A structural
   * section is drawn from itself, a section shortcut from the copy it opens. */
  #tile(
    ref: DocumentTile | DocumentMember,
    opens: SectionStep[],
    index: MenuIndex,
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
        return this.#sectionTile(own ?? openedSection(id, index)!, () => this.#open(opens));
      const unfiltered = this.#unfilteredIndex(this.menu!);
      return unfiltered.sections.has(id)
        ? this.#sectionTile(own ?? openedSection(id, unfiltered)!)
        : nothing;
    }
    const product = index.products.get(ref.productId);
    return product === undefined ? nothing : this.#dishTile(product);
  }

  #listTiles(
    list: readonly DocumentMember[],
    path: SectionStep[],
    index: MenuIndex,
  ): (TemplateResult | typeof nothing)[] {
    const opens = tilePaths(list, path);
    return list.map((member, place) => this.#tile(member, opens[place]!, index));
  }

  #home(menu: TillZoneMenu, index: MenuIndex): TemplateResult {
    const shortcuts = menu.home.shortcuts.map((tile) =>
      this.#tile(
        tile,
        tile.kind === "section" ? [{ sectionId: tile.sectionId, copy: 0 }] : [],
        index,
      ),
    );
    const members = this.#listTiles(
      shownMembers(menu.structure.members, this.setMenuCopies.length > 0),
      [],
      index,
    );
    if (this.#heldMenuFolders().length > 0) members.push(this.#setMenuTile(undefined, true));
    const { blocks, divider } = arrangeHome(
      menu.home.order,
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
            ${this.#grid(cells)}
          </section>`
        : html`<section data-region=${region} aria-label=${label}>${this.#grid(cells)}</section>`;
    })}`;
  }

  #sectionView(trail: SectionNode[], index: MenuIndex): TemplateResult {
    return html`<section data-region="section">
      ${this.#grid(
        this.#listTiles(
          shownMembers(trail.at(-1)!.members, this.setMenuCopies.length > 0),
          this.path,
          index,
        ),
      )}
    </section>`;
  }

  #path(trail: SectionNode[]): TemplateResult {
    return menuPath(
      () => this.#open([]),
      trail.slice(0, -1).map((section, position) => ({
        name: this.#sectionName(section),
        open: () => this.#open(this.path.slice(0, position + 1)),
      })),
      this.#sectionName(trail.at(-1)!),
      this.locked,
    );
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
    return setMenuTile(
      copy?.name ?? t("set_menu.folders"),
      copy === undefined ? undefined : formatMoney(copy.terms.price, currentLocale()),
      () => {
        this.setMenuFolder = { id: copy?.menuId, held };
      },
    );
  }

  #setMenuView(row: OrderingCopy | undefined): TemplateResult {
    return html`<section data-region="section">
      <nav class="set-menu-back" aria-label=${t("menu.breadcrumb")}>
        <wt-button
          variant="ghost"
          @click=${() => {
            this.setMenuFolder =
              row !== undefined && this.setMenuFolder?.held ? { held: true } : undefined;
          }}
          >${t("action.back")}</wt-button
        >
      </nav>
      ${
        row === undefined
          ? this.#grid(this.#heldMenuFolders().map((held) => this.#setMenuTile(held, true)))
          : html`<till-set-menu-folder
              .copy=${row.copy}
              .versionId=${row.versionId}
              .courseNames=${this.setMenuCourses}
              .busy=${this.store.editsLocked}
              @pick-set-menu-dish=${(event: CustomEvent<PickSetMenuDishDetail>) => this.#pickSetMenu(event.detail)}
            ></till-set-menu-folder>`
      }
    </section>`;
  }

  /** A menu's group carries no accessible name: two menus may share one, and two same-named
   * regions fail axe's landmark-unique. */
  #results(menu: TillZoneMenu, index: MenuIndex): TemplateResult {
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
      this.#grid(results.map((result) => this.#resultTile(result, menuId)));
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
    const { menu, firstRead: stage } = this;
    const folder = this.setMenuCopies.find(({ copy }) => copy.menuId === this.setMenuFolder?.id);
    let view: TemplateResult | typeof nothing = nothing;
    let path: TemplateResult | typeof nothing = nothing;
    if (this.setMenuFolder !== undefined) view = this.#setMenuView(folder);
    else if (menu !== undefined) {
      const index = this.#index(menu);
      const trail = this.#trailShown;
      if (this.query.trim() !== "") view = this.#results(menu, index);
      else if (trail.length > 0) {
        view = this.#sectionView(trail, index);
        path = this.#path(trail);
      } else view = this.#home(menu, index);
    } else if (this.#heldMenuFolders().length > 0) {
      view = html`<section data-region="structure">
        ${this.#grid([this.#setMenuTile(undefined, true)])}
      </section>`;
    }
    const showContent = view !== nothing;
    if (!showContent && stage !== undefined) {
      return firstMenuRead(stage, this.handheld, this.retryFirstRead);
    }
    if (!showContent && !this.hasMenuPicker) return nothing;
    return html`
      ${
        menu === undefined && !this.hasMenuPicker
          ? nothing
          : html`<div data-menu-head>
              <div class="menu-tools">
                <slot name="menu-picker"></slot>
                ${
                  menu === undefined
                    ? nothing
                    : html`<div data-region="search" ?inert=${this.locked}>
                        <wt-input
                          type="search"
                          name="menu-search"
                          variant="outlined"
                          label=${t("menu.search")}
                          placeholder=${t("menu.search_placeholder")}
                          .value=${this.query}
                          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSearch(event)}
                          ><wt-icon slot="start" name="search"></wt-icon>${helpBadge(
                            "help.menu.dishes",
                            t("menu.search"),
                            { guide: "products.nutrition-at-the-till", slot: "help" },
                          )}</wt-input
                        >
                        <slot name="filters"></slot>
                      </div>`
                }
              </div>
              ${path}
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
        this.infoProduct
          ? html`<till-product-info
              .product=${this.infoProduct}
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
              .products=${this.unfilteredServedProducts ?? this.servedProducts}
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
