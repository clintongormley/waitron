import { orderableMenus } from "../menu-filter.js";
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  readableTextColor,
  registerIcons,
  visuallyHiddenStyles,
} from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import {
  HOME_GRID_COLUMNS,
  arrangeHome,
  foldForSearch,
  indexDocument,
  openedSection,
  searchMatcher,
  sectionTrail,
  shownMembers,
  tileFill,
  tilePaths,
  type HomeIndex,
  type SectionStep,
} from "@waitron/catalogue/src/device-home.js";
import type {
  DocumentMember,
  DocumentTile,
  HomeDisplay,
  HomeTileMode,
} from "@waitron/catalogue/src/menu-document-types.js";
import "./modifier-picker.js";
import "./tender-pay.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import type { TillProduct, TillZoneMenu } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import { productName, unitName } from "./product-name.js";
import { hasSomethingToSell, pickProduct } from "./product-pick.js";

registerIcons({
  "menu-section":
    "M1.5 3.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z",
});

type SectionNode = Extract<DocumentMember, { kind: "section" }>;

type MenuIndex = HomeIndex<TillProduct>;

/**
 * A product member whose offer is not among `products` is left out, and so is one not sold
 * separately, which is ordered only as an extra on another dish, and a section left with nothing
 * to order. Staff only is shown: every till screen is staff's.
 */
function indexMenu(menu: TillZoneMenu, products: TillProduct[]): MenuIndex {
  const offers = new Map(
    products
      .filter((product) => product.ordering !== "not_sold_separately")
      .map((product) => [product.menuItemId, product]),
  );
  return indexDocument(menu.structure.members, (id) => offers.get(id));
}

function thumb(image: string): TemplateResult {
  return html`<img class="thumb" src=${`/media/${encodeURIComponent(image)}`} alt="" />`;
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
        gap: var(--wt-space-4);
        align-content: start;
      }

      section {
        display: grid;
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

      .grid[data-device="handheld"][data-columns-source="menu"] {
        --home-tile-min: calc(var(--wt-tap-min) * 1.5);
      }

      .thumb {
        display: block;
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
        border-radius: var(--wt-radius-sm);
      }

      .tile,
      .slot {
        width: 100%;
      }

      .slot {
        min-height: calc(var(--wt-tap-min) * 1.5);
      }

      .tile::part(button) {
        height: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-2);
      }

      /* A word breaks only when it is wider than the whole tile; the icon sits above the name, so
         it never takes the name's width. */
      .label {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        text-align: center;
        overflow-wrap: break-word;
      }

      /* A centred column item is as wide as its longest word, so without this a word wider than
         the tile would spill out of it instead of breaking. */
      .label > * {
        max-width: 100%;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
      }

      .price,
      .kind,
      .sold-out,
      .empty {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .tile[data-painted]::part(button) {
        background: var(--tile-fill);
        border-color: var(--tile-fill);
        color: var(--tile-ink);
      }

      .tile[data-painted]::part(button):hover:not(:disabled) {
        border-color: var(--tile-ink);
      }

      /* wt-icon sets its own text colour on its host, so it is named here as the labels are. */
      .tile[data-painted] .price,
      .tile[data-painted] .kind,
      .tile[data-painted] .sold-out,
      .tile[data-painted] wt-icon {
        color: inherit;
      }

      /* In place of wt-button's disabled fade; the button stays disabled. A ::part() rule from
         outside wt-button wins over wt-button's own. */
      .tile[data-sold-out]::part(button) {
        opacity: 1;
        background: var(--wt-color-surface-sunken);
        border-color: var(--wt-color-border);
        color: var(--wt-color-text);
      }

      /* Inset shadows take no layout width, so the labels stay centred. The text-coloured line
         under the stripe keeps a stripe close to the tile's own fill visible. */
      .tile[data-sold-out][data-painted]::part(button) {
        box-shadow:
          inset var(--wt-space-1) 0 0 var(--tile-fill),
          inset calc(var(--wt-space-1) + 1px) 0 0 var(--wt-color-text);
      }

      .tile[data-sold-out] .price,
      .tile[data-sold-out] .sold-out {
        color: inherit;
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
  @property({ attribute: false }) menu?: TillZoneMenu;

  /** This menu's offers as till products. */
  @property({ attribute: false }) products: TillProduct[] = [];

  /** This menu's offers before the diet filter. A section it holds and `products` does not is drawn
   * greyed in its place; unset, such a section is left out. */
  @property({ attribute: false }) unfilteredProducts?: TillProduct[];

  /** Every menu the device is served in its zone, in the zone's order, the shown one included. */
  @property({ attribute: false }) menus: readonly TillZoneMenu[] = [];

  /** Every served menu's offers as till products, through the same diet lens as `products`. */
  @property({ attribute: false }) servedProducts: TillProduct[] = [];

  @property({ attribute: false }) store!: WorkingOrderStore;

  /** Whether it shows the menu's Handheld display rather than its Till one. */
  @property({ type: Boolean }) handheld = false;

  /** A canvas card's own column count, which wins over the menu's display. */
  @property({ type: Number }) columns?: number;

  /** Asks a weighed dish's weight itself, with the pay widget's weight entry, for a screen whose own
   * pay widget does not take the dish. */
  @property({ type: Boolean }) weighs = false;

  /** The open section's path, as {@link sectionTrail} reads it. Empty is home. */
  @state() private path: SectionStep[] = [];

  @state() private query = "";

  @state() private notFound = false;

  @state() private pickerProduct?: TillProduct;

  #indexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #unfilteredIndexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #otherIndexes = new WeakMap<TillZoneMenu, { products: TillProduct[]; index: MenuIndex }>();

  #trailShown: SectionNode[] = [];

  /** Each indexed product with its name folded for search. Keyed by the index alone because
   * {@link productName} reads no language. */
  #searchable = new WeakMap<MenuIndex, [TillProduct, string][]>();

  #index(menu: TillZoneMenu): MenuIndex {
    const cached = this.#indexed;
    if (cached?.menu === menu && cached.products === this.products) return cached.index;
    const index = indexMenu(menu, this.products);
    this.#indexed = { menu, products: this.products, index };
    return index;
  }

  #unfilteredIndex(menu: TillZoneMenu): MenuIndex {
    const products = this.unfilteredProducts;
    if (products === undefined || products === this.products) return this.#index(menu);
    const cached = this.#unfilteredIndexed;
    if (cached?.menu === menu && cached.products === products) return cached.index;
    const index = indexMenu(menu, products);
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

  /** The open section is judged before each render, so a menu that has lost it never draws it. */
  override willUpdate(): void {
    if (this.menu === undefined) return;
    const trail = sectionTrail(this.path, this.#index(this.menu));
    if (trail === null) {
      this.notFound = true;
      this.path = [];
    }
    this.#trailShown = trail ?? [];
  }

  #open(path: SectionStep[]): void {
    this.notFound = false;
    this.path = path;
  }

  #pick(product: TillProduct): void {
    this.notFound = false;
    pickProduct(product, this.store, (picked) => {
      this.pickerProduct = picked;
    });
  }

  #onSearch(event: CustomEvent<{ value: string }>): void {
    this.query = event.detail.value;
    this.notFound = false;
  }

  #onModifierConfirm(detail: ModifierConfirmDetail): void {
    this.store.addProduct(detail.product, "1", detail);
    this.pickerProduct = undefined;
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
      data-columns-source=${this.columns === undefined ? "menu" : "card"}
      style=${`--columns: ${this.columns ?? display.columns};`}
    >
      ${content}
    </div>`;
  }

  #matches(index: MenuIndex, matches: (foldedName: string) => boolean): TillProduct[] {
    let names = this.#searchable.get(index);
    if (names === undefined) {
      names = [...index.products.values()].map((product): [TillProduct, string] => [
        product,
        foldForSearch(productName(product)),
      ]);
      this.#searchable.set(index, names);
    }
    return names.filter(([, name]) => matches(name)).map(([product]) => product);
  }

  #productButton(product: TillProduct, mode: HomeTileMode, onTap: () => void): TemplateResult {
    const price = `${formatMoney(product.unitPrice, currentLocale())}/${unitName(product)}`;
    const sellable = hasSomethingToSell(product);
    const fill = tileFill(mode, product.image, product.color);
    const paint = fill.kind === "color" ? tilePaint(fill.color) : undefined;
    return html`<wt-button
      class="tile"
      data-kind="product"
      style=${paint ?? nothing}
      ?data-painted=${paint !== undefined}
      ?data-sold-out=${!sellable}
      ?disabled=${!sellable}
      @click=${onTap}
    >
      <span class="label">
        ${fill.kind === "image" ? thumb(fill.image) : nothing}
        <span class="name">${productName(product)}</span>
        <span class="price">${price}</span>
        ${sellable ? nothing : html`<span class="sold-out">${t("menu.sold_out")}</span>`}
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
        ${fill.kind === "image" ? thumb(fill.image) : html`<wt-icon name="menu-section"></wt-icon>`}
        <span class="name">${this.#sectionName(section)}</span>
        <span class="kind">${t(filtered ? "menu.filtered_out" : "menu.section")}</span>
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
    const members = this.#listTiles(index.home, [], index, display.tiles);
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
        this.#listTiles(shownMembers(current.members), this.path, index, display.tiles),
        display,
      )}
    </section>`;
  }

  /** A menu's group carries no accessible name: two menus may share one, and two same-named
   * regions fail axe's landmark-unique. */
  #results(menu: TillZoneMenu, index: MenuIndex, display: HomeDisplay): TemplateResult {
    const matches = searchMatcher(this.query);
    const found = this.#matches(index, matches);
    const otherMenus = orderableMenus(this.menus).filter((other) => other.id !== menu.id);
    const others = otherMenus
      .map((other) => ({ menu: other, found: this.#matches(this.#otherIndex(other), matches) }))
      .filter((other) => other.found.length > 0);
    const tiles = (products: TillProduct[]) =>
      this.#grid(
        products.map((product) =>
          this.#productButton(product, display.tiles, () => this.#pick(product)),
        ),
        display,
      );
    const empty = (text: string) => html`<p class="empty">${text}</p>`;
    let body: TemplateResult;
    if (otherMenus.length === 0)
      body = found.length === 0 ? empty(t("menu.no_results")) : tiles(found);
    else if (found.length === 0 && others.length === 0) body = empty(t("menu.no_results_any_menu"));
    else
      body = html`<section data-menu=${menu.id}>
          <h3>${t("menu.results_this_menu").replace("{menu}", () => menu.name)}</h3>
          ${found.length === 0 ? empty(t("menu.no_results_this_menu")) : tiles(found)}
        </section>
        ${others.map(
          (other) =>
            html`<section data-menu=${other.menu.id}>
              <h3>${other.menu.name}</h3>
              ${tiles(other.found)}
            </section>`,
        )}`;
    return html`<section data-region="results" aria-labelledby="results-heading">
      <h2 id="results-heading">${t("menu.results")}</h2>
      ${body}
    </section>`;
  }

  override render() {
    const menu = this.menu;
    if (menu === undefined) return nothing;
    const index = this.#index(menu);
    const trail = this.#trailShown;
    const display = this.#display(menu);
    let view: TemplateResult;
    if (this.query.trim() !== "") view = this.#results(menu, index, display);
    else if (trail.length > 0) view = this.#sectionView(trail, index, display);
    else view = this.#home(menu, index, display);
    return html`
      <div data-region="search">
        <wt-input
          type="search"
          name="menu-search"
          label=${t("menu.search")}
          .value=${this.query}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSearch(event)}
        ></wt-input>
      </div>
      ${this.notFound ? html`<p class="notice" role="alert">${t("menu.not_found")}</p>` : nothing}
      ${view}
      ${
        this.weighs
          ? html`<till-tender-pay class="weigh" weighOnly .store=${this.store}></till-tender-pay>`
          : nothing
      }
      ${
        this.pickerProduct
          ? html`<till-modifier-picker
              .product=${this.pickerProduct}
              @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) =>
                this.#onModifierConfirm(event.detail)}
              @wt-modifier-cancel=${() => {
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
