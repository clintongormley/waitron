import { html, nothing, type TemplateResult } from "lit";
import { currentContentLanguages, menuTilePaint } from "@waitron/ui";
import "@waitron/ui/src/components/wt-count-badge.js";
import type { TillProduct } from "../api/menu-api.js";
import { countText, t } from "../i18n/t.js";
import { productName, productTilePrice } from "./product-name.js";
import { hasSomethingToSell } from "./product-pick.js";

export interface DishTileHandlers {
  /** Opens the dish's information window. */
  info: (product: TillProduct) => void;
  /** Every press, before any hold is known. */
  press: (product: TillProduct, event: PointerEvent) => void;
  /** True while the press that ends in this click was a hold, which already did its work. */
  held: () => boolean;
}

/** A dish's tile. A tap on a sellable dish runs `onTap` with the tile; on a sold-out one it opens
 * the dish's information, as holding it or Shift+F10 does. `count` is the dish's items in the New
 * order; undefined, or 0, draws none. */
export function dishTile(
  product: TillProduct,
  count: number | undefined,
  onTap: (tile: HTMLElement) => void,
  handlers: DishTileHandlers,
): TemplateResult {
  const sellable = hasSomethingToSell(product);
  const paint = menuTilePaint(product.color);
  const counted = count ?? 0;
  return html`<wt-button
    class="tile"
    data-kind="product"
    style=${paint ?? nothing}
    ?data-painted=${paint !== undefined}
    ?data-sold-out=${!sellable}
    ?data-in-order=${counted > 0}
    @contextmenu=${(event: Event) => event.preventDefault()}
    @keydown=${(event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        handlers.info(product);
      }
    }}
    @pointerdown=${(event: PointerEvent) => handlers.press(product, event)}
    @click=${(event: MouseEvent) => {
      if (event.detail !== 0 && handlers.held()) return;
      if (!sellable) handlers.info(product);
      else onTap(event.currentTarget as HTMLElement);
    }}
  >
    <span class="label">
      ${
        counted > 0
          ? html`<wt-count-badge
              class="in-order"
              data-in-order-count
              tone="notice"
              aria-hidden="true"
              publish-width
              .count=${counted}
            ></wt-count-badge>`
          : nothing
      }
      <span class="name" lang=${currentContentLanguages().defaultLanguage}
        >${counted > 0 ? html`<span class="name-start"></span>` : nothing}${productName(
          product,
        )}</span
      >
      <span class="price">${productTilePrice(product)}</span>
      ${sellable ? nothing : html`<span class="sold-out">${t("menu.sold_out")}</span>`}
      ${
        counted > 0
          ? html`<span class="in-order-words"
              >, ${countText(counted, "order_counts.unsent", "order_counts.unsent_one")}</span
            >`
          : nothing
      }
    </span>
  </wt-button>`;
}

/** A section's tile, never painted in the section's colour. Without `onTap` it is a section the
 * diet filter emptied: greyed and not openable. */
export function sectionTile(name: string, onTap?: () => void): TemplateResult {
  const filtered = onTap === undefined;
  return html`<wt-button
    class="tile"
    data-kind="section"
    ?data-filtered=${filtered}
    ?disabled=${filtered}
    @click=${onTap ?? nothing}
  >
    <span class="label">
      <wt-icon name="menu-section" aria-hidden="true"></wt-icon>
      <span class="name">${name}</span>
      <span class="section-kind">${t("menu.section")}</span>
      ${filtered ? html`<span class="kind">${t("menu.filtered_out")}</span>` : nothing}
    </span>
  </wt-button>`;
}

/** A set menu's tile, or with no `price` the tile of the set-menu folders held on this bill. */
export function setMenuTile(
  name: string,
  price: string | undefined,
  onTap: () => void,
): TemplateResult {
  return html`<wt-button
    class="tile"
    data-kind=${price === undefined ? "section" : "set_menu"}
    @click=${onTap}
    ><span class="label">
      <wt-icon name="menu-section"></wt-icon>
      <span class="name">${name}</span>
      ${price === undefined ? nothing : html`<span class="price">${price}</span>`}
    </span></wt-button
  >`;
}
