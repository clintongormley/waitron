import { css, html, nothing } from "lit";
import { isStoredColor } from "@waitron/catalogue/src/color-inheritance.js";
import "@waitron/ui/src/components/wt-row-actions.js";
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
  wt-data-table::part(media-trigger) {
    display: flex;
    padding: 0;
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
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
  wt-data-table::part(media-photo-link) {
    padding: var(--wt-space-3);
    color: var(--wt-color-text);
    border-radius: var(--wt-radius-md);
    text-decoration: none;
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
  colour: () => void;
  photo?: () => void;
}) {
  const {
    key,
    productId = key,
    name,
    image,
    color,
    editable = true,
    busy,
    colour,
    photo,
  } = options;
  const painted = isStoredColor(color);
  const frame = html`<span
    slot="trigger"
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
  return html`<wt-row-actions
    part="product-media"
    exportparts="trigger:media-trigger"
    data-test=${`color-${key}`}
    label=${t("product.media_actions").replace("{name}", name)}
    .disabled=${busy}
    @click=${(event: Event) => event.stopPropagation()}
    >${frame}
    <wt-button
      data-test="media-colour"
      align="start"
      variant="secondary"
      .disabled=${busy}
      @click=${() => {
        if (!busy) colour();
      }}
      >${t("product.media_colour")}</wt-button
    >
    <a
      part="media-photo-link"
      data-test="media-photo"
      href=${`/manage/catalogue/product/${encodeURIComponent(productId)}?field=image`}
      @click=${(event: MouseEvent) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return;
        if (!photo) return;
        event.preventDefault();
        photo();
      }}
      >${t("product.media_photo")}</a
    >
  </wt-row-actions>`;
}
