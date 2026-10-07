import { css, html, nothing } from "lit";
import { isStoredColor } from "@waitron/catalogue/src/color-inheritance.js";
import { t } from "../i18n/t.js";

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
    background: var(--product-media-color, transparent);
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
  /** Opens the product's Edit in place; without it the click follows the link. */
  open?: () => void;
}) {
  const { key, productId = key, name, image, color, editable = true, busy, open } = options;
  const painted = isStoredColor(color);
  const frame = html`<span
    part=${`${image ? "thumb-frame media-photo-frame" : "thumb-placeholder"} color-swatch media-frame${image && painted ? " photo-ring" : ""}${painted ? "" : " empty"}`}
    data-test=${image ? "thumb" : "thumb-placeholder"}
    style=${painted ? `--product-media-color:${color}` : nothing}
    aria-hidden="true"
    >${image ? html`<img part="thumbnail" src=${`/media/${image}`} alt="" draggable="false" />` : nothing}</span
  >`;
  if (!editable)
    return html`<span part="product-media swatch-box" data-test=${`color-${key}`} aria-hidden="true"
      >${frame}</span
    >`;
  return html`<a
    part=${busy ? "product-media media-link media-link-busy" : "product-media media-link"}
    data-test=${`color-${key}`}
    ?data-own-click=${open !== undefined}
    href=${`/manage/catalogue/product/${encodeURIComponent(productId)}?field=image`}
    aria-label=${t("product.edit_named").replace("{name}", name)}
    aria-disabled=${busy ? "true" : nothing}
    @click=${(event: MouseEvent) => {
      event.stopPropagation();
      if (busy) {
        event.preventDefault();
        return;
      }
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      if (!open) return;
      event.preventDefault();
      open();
    }}
    >${frame}</a
  >`;
}
