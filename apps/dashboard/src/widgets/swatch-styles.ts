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
  wt-data-table::part(color-swatch inherited) {
    padding: var(--wt-space-1);
    border-style: dashed;
    border-color: var(--wt-color-text-muted);
    border-radius: var(--wt-radius-md);
    background-clip: content-box;
  }
`;

/** A colour's chip, drawn outlined for none and dashed for a colour taken from elsewhere. Checked,
 * because the value lands in a style attribute: anything but #rrggbb draws as none. */
export function swatchChip(color: string | null | undefined, inherited = false): TemplateResult {
  const painted = isStoredColor(color);
  return html`<span
    part=${painted ? (inherited ? "color-swatch inherited" : "color-swatch") : "color-swatch empty"}
    style=${painted ? `background:${color}` : nothing}
  ></span>`;
}
