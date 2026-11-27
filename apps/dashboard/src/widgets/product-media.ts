import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { css, html, nothing } from "lit";
import { isStoredColor } from "@waitron/shared";
import "@waitron/ui/src/components/wt-icon.js";
import { fill } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";

export const productMediaStyles = css`
  wt-data-table::part(product-media) {
    display: inline-flex;
    flex: none;
    vertical-align: middle;
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    margin-inline-end: var(--wt-space-3);
  }
  wt-data-table[narrow]::part(product-media) {
    display: none;
  }
  wt-data-table::part(media-link) {
    border-radius: var(--wt-radius-md);
  }
  wt-data-table::part(media-link-busy) {
    cursor: default;
    opacity: var(--wt-opacity-disabled);
  }
  wt-data-table::part(media-link):focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  wt-data-table::part(media-frame) {
    margin-inline-end: 0;
    overflow: hidden;
    border-color: var(--product-media-color, var(--wt-color-border));
    background: var(--product-media-color, var(--menu-tree-media-fallback, transparent));
  }
  wt-data-table::part(media-photo-frame) {
    background: transparent;
  }
  wt-data-table::part(photo-ring) {
    border-width: var(--wt-space-1);
  }
`;

export function productMedia(options: {
  key: string;
  productId?: string;
  name: string;
  image: string | null;
  color: string | null;
  editable?: boolean;
  busy: boolean;
  lazy?: boolean;
  fallbackIcon?: string;
  /** Opens the product's Edit in place; without it the click follows the link. */
  open?: () => void;
  /** Where `color` comes from when it is not the product's own: a category's name or All products. */
  inheritedFrom?: string;
}) {
  const { key, productId = key, name, image, color, editable = true, busy, open } = options;
  const inheritedFrom = isStoredColor(color) ? options.inheritedFrom : undefined;
  const frame = productMediaFrame(
    image,
    color,
    inheritedFrom !== undefined,
    options.lazy,
    options.fallbackIcon,
  );
  if (!editable)
    return html`<span part="product-media swatch-box" data-test=${`color-${key}`} aria-hidden="true"
      >${frame}</span
    >`;
  return html`<a
    part=${busy ? "product-media media-link media-link-busy" : "product-media media-link"}
    data-test=${`color-${key}`}
    ?data-own-click=${open !== undefined}
    href=${`/products/product/${encodeURIComponent(productId)}?field=image`}
    aria-label=${
      inheritedFrom === undefined
        ? fill("product.edit_named", { name })
        : fill("product.edit_named_inherited", { name, from: inheritedFrom })
    }
    aria-disabled=${busy ? "true" : nothing}
    @click=${(event: MouseEvent) => {
      event.stopPropagation();
      if (busy) {
        event.preventDefault();
        return;
      }
      if (leftToBrowser(event)) return;
      if (!open) return;
      event.preventDefault();
      open();
    }}
    >${frame}</a
  >`;
}

export function productMediaFrame(
  image: string | null,
  color: string | null,
  inherited = false,
  lazy = false,
  fallbackIcon?: string,
) {
  const painted = isStoredColor(color);
  return html`<span
    part=${`${image ? "thumb-frame media-photo-frame" : "thumb-placeholder"} color-swatch media-frame${image && painted ? " photo-ring" : ""}${painted ? (inherited ? " inherited" : "") : " empty"}`}
    data-test=${image ? "thumb" : "thumb-placeholder"}
    style=${painted ? `--product-media-color:${color}` : nothing}
    aria-hidden="true"
    >${image ? html`<img part="thumbnail" loading=${lazy ? "lazy" : nothing} src=${liveMediaImage(image, "square")} alt="" draggable="false" />` : fallbackIcon ? html`<wt-icon part="media-placeholder-icon" name=${fallbackIcon}></wt-icon>` : nothing}</span
  >`;
}
