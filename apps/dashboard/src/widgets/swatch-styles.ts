import { css, html, nothing, type TemplateResult } from "lit";
import { isStoredColor } from "@waitron/catalogue/src/color-inheritance.js";

/** A host whose tree rows draw colour swatches adds these: the rows render inside wt-data-table's
 * shadow root, so ::part is the only way in. */
export const swatchPartStyles = css`
  wt-data-table::part(swatch-button),
  wt-data-table::part(swatch-box) {
    display: inline-flex;
    flex: none;
    vertical-align: middle;
    align-items: center;
    justify-content: center;
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    padding: 0;
    border: 0;
    background: transparent;
  }
  wt-data-table::part(swatch-button) {
    cursor: pointer;
  }
  wt-data-table::part(swatch-button):disabled {
    cursor: default;
    opacity: var(--wt-opacity-disabled);
  }
  wt-data-table::part(color-swatch) {
    box-sizing: border-box;
    width: var(--wt-tap-min);
    height: var(--wt-tap-min);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
  }
`;

/** A colour's chip, drawn outlined for none. Checked, because the value lands in a style
 * attribute: anything but #rrggbb draws as none. */
export function swatchChip(color: string | null | undefined): TemplateResult {
  const painted = isStoredColor(color);
  return html`<span
    part=${painted ? "color-swatch" : "color-swatch empty"}
    style=${painted ? `background:${color}` : nothing}
  ></span>`;
}
