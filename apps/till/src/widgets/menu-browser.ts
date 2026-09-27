import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContentLanguageController, baseStyles, registerIcons } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import type { DocumentMember } from "@waitron/catalogue/src/menu-document-types.js";
import "./modifier-picker.js";
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
 * and so is a section left with nothing to order.
 */
function indexMenu(menu: TillZoneMenu, products: TillProduct[]): MenuIndex {
  const offers = new Map(products.map((product) => [product.menuItemId, product]));
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
 * the store, as `till-product-grid`'s do.
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

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(var(--wt-tap-min) * 3), 1fr));
        gap: var(--wt-space-3);
      }

      .tile {
        width: 100%;
      }

      .tile::part(button) {
        height: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-2);
      }

      .label {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        overflow-wrap: anywhere;
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
      }

      .price,
      .kind,
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
    `,
  ];

  /** The menu as a zone-offers body serves it: its structure, its layouts and the device's layout.
   * Nothing renders until it is set. */
  @property({ attribute: false }) menu?: TillZoneMenu;

  /** This menu's offers as till products. */
  @property({ attribute: false }) products: TillProduct[] = [];

  @property({ attribute: false }) store!: WorkingOrderStore;

  /** The grids' column count; unset, they fill the width with as many columns as fit. */
  @property({ type: Number }) columns?: number;

  /** The open section's path of section ids: its first found anywhere in the menu, each next among
   * the previous one's members. Empty is home. */
  @state() private path: string[] = [];

  @state() private query = "";

  @state() private notFound = false;

  @state() private pickerProduct?: TillProduct;

  #indexed?: { menu: TillZoneMenu; products: TillProduct[]; index: MenuIndex };

  #trailShown: SectionNode[] = [];

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

  #gridStyle(): string | typeof nothing {
    return this.columns === undefined
      ? nothing
      : `grid-template-columns: repeat(${this.columns}, 1fr);`;
  }

  #productButton(product: TillProduct, onTap: () => void): TemplateResult {
    const price = `${formatMoney(product.unitPrice, currentLocale())}/${unitName(product)}`;
    return html`<wt-button
      class="tile"
      data-kind="product"
      ?disabled=${!hasSomethingToSell(product)}
      @click=${onTap}
    >
      <span class="label">
        <span class="name">${productName(product)}</span>
        <span class="price">${price}</span>
      </span>
    </wt-button>`;
  }

  #sectionButton(section: SectionNode, onTap: () => void): TemplateResult {
    return html`<wt-button class="tile" data-kind="section" @click=${onTap}>
      <wt-icon name="menu-section"></wt-icon>
      <span class="label">
        <span class="name">${this.#sectionName(section)}</span>
        <span class="kind">${t("menu.section")}</span>
      </span>
    </wt-button>`;
  }

  /** A list's members as buttons, in order; `path` is where a section member opens beneath. */
  #members(members: DocumentMember[], path: string[], index: MenuIndex): TemplateResult {
    return html`<div class="grid" style=${this.#gridStyle()}>
      ${members.map((member) => {
        if (member.kind === "section") {
          if (!index.sections.has(member.sectionId)) return nothing;
          return this.#sectionButton(member, () => this.#open([...path, member.sectionId]));
        }
        const product = index.products.get(member.productId);
        return product === undefined
          ? nothing
          : this.#productButton(product, () => this.#pick(product));
      })}
    </div>`;
  }

  #home(menu: TillZoneMenu, index: MenuIndex): TemplateResult {
    const layouts = menu.homeLayouts;
    const layout = layouts.find(({ id }) => id === menu.homeLayoutId) ?? layouts[0];
    return html`
      <section data-region="shortcuts" aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading">${t("menu.shortcuts")}</h2>
        <div class="grid" style=${this.#gridStyle()}>
          ${(layout?.tiles ?? []).map((tile) => {
            if (tile.kind === "section") {
              const section = index.sections.get(tile.sectionId);
              return section === undefined
                ? nothing
                : this.#sectionButton(section, () => this.#open([tile.sectionId]));
            }
            const product = index.products.get(tile.productId);
            return product === undefined
              ? nothing
              : this.#productButton(product, () => this.#pick(product));
          })}
        </div>
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
    const found = [...index.products.values()].filter((product) =>
      folded(productName(product)).includes(wanted),
    );
    return html`<section data-region="results" aria-labelledby="results-heading">
      <h2 id="results-heading">${t("menu.results")}</h2>
      ${
        found.length === 0
          ? html`<p class="empty">${t("menu.no_results")}</p>`
          : html`<div class="grid" style=${this.#gridStyle()}>
              ${found.map((product) => this.#productButton(product, () => this.#pick(product)))}
            </div>`
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
