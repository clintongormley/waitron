import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContentLanguageController, baseStyles, registerIcons } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { TILL_COLUMNS } from "@waitron/catalogue/src/home-layout-columns.js";
import type { DocumentMember, DocumentTile } from "@waitron/catalogue/src/menu-document-types.js";
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

/** What the widget can show of one menu, given the offers it holds. */
interface MenuIndex {
  /** Keyed by section id: every section with something to order somewhere beneath it. */
  sections: Map<string, SectionNode>;
  /** Keyed by product id: each product the structure reaches and the offers hold, once. */
  products: Map<string, TillProduct>;
}

/**
 * A product member whose offer is not among `products` is left out (switched off on this menu, D5),
 * and so is one not sold separately, which is ordered only as an extra on another dish, and a
 * section left with nothing to order. Staff only is shown: every till screen is staff's.
 */
function indexMenu(menu: TillZoneMenu, products: TillProduct[]): MenuIndex {
  const offers = new Map(
    products
      .filter((product) => product.ordering !== "not_sold_separately")
      .map((product) => [product.menuItemId, product]),
  );
  const index: MenuIndex = { sections: new Map(), products: new Map() };
  const walk = (members: DocumentMember[]): boolean => {
    let holdsSomething = false;
    for (const member of members) {
      if (member.kind === "product") {
        const product = offers.get(member.menuItemId);
        if (product === undefined) continue;
        holdsSomething = true;
        // A product placed twice keeps its first place: a Map keeps a key where it was first set.
        index.products.set(member.productId, product);
      } else if (walk(member.members)) {
        holdsSomething = true;
        index.sections.set(member.sectionId, member);
      }
    }
    return holdsSomething;
  };
  walk(menu.structure.members);
  return index;
}

/** Case- and accent-blind, so "jamon" finds "Jamón". */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/**
 * The till's menu home: search, then the device's home layout's shortcuts, then the menu's own
 * structure, with each section opening in place behind a breadcrumb. Tiles coordinate only through
 * the store: they never reference the basket or total widgets.
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

      h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      /* Up to --columns tracks, and fewer wherever a tile would be narrower than the minimum.
         auto-fill keeps a track's width the same however many tiles there are, so the tiles fill
         the grid row by row, in order, at every count. */
      .grid {
        display: grid;
        gap: var(--wt-space-3);
        grid-template-columns: repeat(
          auto-fill,
          minmax(
            max(
              calc(var(--wt-tap-min) * 2 + var(--wt-space-4)),
              calc((100% - (var(--columns) - 1) * var(--wt-space-3)) / var(--columns))
            ),
            1fr
          )
        );
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

  /** The menu as a zone-offers body serves it: its structure, its layouts and the device's layout.
   * Nothing renders until it is set. */
  @property({ attribute: false }) menu?: TillZoneMenu;

  /** This menu's offers as till products. */
  @property({ attribute: false }) products: TillProduct[] = [];

  @property({ attribute: false }) store!: WorkingOrderStore;

  /** The most columns a grid shows. */
  @property({ type: Number }) columns = TILL_COLUMNS;

  /** Asks a weighed dish's weight itself, with the pay widget's weight entry, for a screen whose own
   * pay widget does not take the dish. */
  @property({ type: Boolean }) weighs = false;

  /** The open section's path of section ids: its first found anywhere in the menu, each next among
   * the previous one's members. Empty is home. */
  @state() private path: string[] = [];

  @state() private query = "";

  @state() private notFound = false;

  @state() private pickerProduct?: TillProduct;

  #indexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #trailShown: SectionNode[] = [];

  /** Each indexed product with its name folded for search. Keyed by the index alone because
   * {@link productName} reads no language. */
  #searchable?: { index: MenuIndex; names: [TillProduct, string][] };

  #index(menu: TillZoneMenu): MenuIndex {
    const cached = this.#indexed;
    if (cached?.menu === menu && cached.products === this.products) return cached.index;
    const index = indexMenu(menu, this.products);
    this.#indexed = { menu, products: this.products, index };
    return index;
  }

  #trail(path: string[], index: MenuIndex): SectionNode[] | null {
    const trail: SectionNode[] = [];
    for (const id of path) {
      const previous = trail.at(-1);
      const next =
        previous === undefined
          ? index.sections.get(id)
          : previous.members.find(
              (member): member is SectionNode =>
                member.kind === "section" && member.sectionId === id && index.sections.has(id),
            );
      if (next === undefined) return null;
      trail.push(next);
    }
    return trail;
  }

  /** The open section is judged before each render, so a menu that has lost it never draws it. */
  override willUpdate(): void {
    if (this.menu === undefined) return;
    const trail = this.#trail(this.path, this.#index(this.menu));
    if (trail === null) {
      this.notFound = true;
      this.path = [];
    }
    this.#trailShown = trail ?? [];
  }

  #open(path: string[]): void {
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

  #grid(content: unknown): TemplateResult {
    return html`<div class="grid" style=${`--columns: ${this.columns};`}>${content}</div>`;
  }

  #searchableNames(index: MenuIndex): [TillProduct, string][] {
    if (this.#searchable?.index === index) return this.#searchable.names;
    const names = [...index.products.values()].map((product): [TillProduct, string] => [
      product,
      folded(productName(product)),
    ]);
    this.#searchable = { index, names };
    return names;
  }

  #productButton(product: TillProduct, onTap: () => void): TemplateResult {
    const price = `${formatMoney(product.unitPrice, currentLocale())}/${unitName(product)}`;
    const sellable = hasSomethingToSell(product);
    return html`<wt-button class="tile" data-kind="product" ?disabled=${!sellable} @click=${onTap}>
      <span class="label">
        <span class="name">${productName(product)}</span>
        <span class="price">${price}</span>
        ${sellable ? nothing : html`<span class="sold-out">${t("menu.sold_out")}</span>`}
      </span>
    </wt-button>`;
  }

  #sectionButton(section: SectionNode, onTap: () => void): TemplateResult {
    return html`<wt-button class="tile" data-kind="section" @click=${onTap}>
      <span class="label">
        <wt-icon name="menu-section"></wt-icon>
        <span class="name">${this.#sectionName(section)}</span>
        <span class="kind">${t("menu.section")}</span>
      </span>
    </wt-button>`;
  }

  /** The button for a section or product the index holds, else nothing; `path` is where a section
   * opens beneath. */
  #tile(ref: DocumentTile, path: string[], index: MenuIndex): TemplateResult | typeof nothing {
    if (ref.kind === "empty") return nothing;
    if (ref.kind === "section") {
      const section = index.sections.get(ref.sectionId);
      return section === undefined
        ? nothing
        : this.#sectionButton(section, () => this.#open([...path, ref.sectionId]));
    }
    const product = index.products.get(ref.productId);
    return product === undefined
      ? nothing
      : this.#productButton(product, () => this.#pick(product));
  }

  /** A list's members as buttons, in order; `path` is where a section member opens beneath. */
  #members(members: DocumentMember[], path: string[], index: MenuIndex): TemplateResult {
    return this.#grid(members.map((member) => this.#tile(member, path, index)));
  }

  #homeTile(ref: DocumentTile, index: MenuIndex): TemplateResult {
    const tile = this.#tile(ref, [], index);
    return tile === nothing ? html`<span class="slot" aria-hidden="true"></span>` : tile;
  }

  #home(menu: TillZoneMenu, index: MenuIndex): TemplateResult {
    const layouts = menu.homeLayouts;
    const layout = layouts.find(({ id }) => id === menu.homeLayoutId) ?? layouts[0];
    return html`
      <section data-region="shortcuts" aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading">${t("menu.shortcuts")}</h2>
        ${this.#grid((layout?.tiles ?? []).map((tile) => this.#homeTile(tile, index)))}
      </section>
      <section data-region="structure" aria-labelledby="structure-heading">
        <h2 id="structure-heading">${t("menu.full")}</h2>
        ${this.#members(menu.structure.members, [], index)}
      </section>
    `;
  }

  #sectionView(trail: SectionNode[], index: MenuIndex): TemplateResult {
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
      ${this.#members(current.members, this.path, index)}
    </section>`;
  }

  #results(index: MenuIndex): TemplateResult {
    const wanted = folded(this.query.trim());
    const found = this.#searchableNames(index)
      .filter(([, name]) => name.includes(wanted))
      .map(([product]) => product);
    return html`<section data-region="results" aria-labelledby="results-heading">
      <h2 id="results-heading">${t("menu.results")}</h2>
      ${
        found.length === 0
          ? html`<p class="empty">${t("menu.no_results")}</p>`
          : this.#grid(
              found.map((product) => this.#productButton(product, () => this.#pick(product))),
            )
      }
    </section>`;
  }

  override render() {
    const menu = this.menu;
    if (menu === undefined) return nothing;
    const index = this.#index(menu);
    const trail = this.#trailShown;
    let view: TemplateResult;
    if (this.query.trim() !== "") view = this.#results(index);
    else if (trail.length > 0) view = this.#sectionView(trail, index);
    else view = this.#home(menu, index);
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
