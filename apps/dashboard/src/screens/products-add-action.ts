import { css, html, nothing } from "lit";
import { t } from "../i18n/t.js";

export const productsAddActionStyles = css`
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-3);
    margin-bottom: var(--wt-space-4);
  }
  .header h1 {
    margin: 0;
    color: var(--wt-color-text);
  }
  .add-action {
    display: inline-grid;
    justify-items: center;
    gap: var(--wt-space-1);
  }
  .add-action wt-button:not([disabled]) {
    --wt-action-background: var(--wt-color-palette-teal);
    --wt-action-text: var(--wt-color-on-palette-teal);
    --wt-action-hover: var(--wt-color-palette-teal);
  }
  .add-action small {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
`;

export function productsAddAction(
  loaded: boolean,
  hasLanguages: boolean,
  hasUnits: boolean,
  add: () => void,
  slot?: "empty-action",
) {
  const reason =
    !loaded || (hasLanguages && hasUnits)
      ? ""
      : t(hasLanguages ? "products.add_needs_unit" : "products.add_needs_language");
  const ready = loaded && reason === "";
  return html`<span class="add-action" slot=${slot ?? nothing}>
    <wt-button
      data-test="add-product"
      variant="primary"
      .disabled=${!ready}
      .ariaDescription=${reason || null}
      @click=${ready ? add : nothing}
      >${t("products.add_product")}</wt-button
    >
    ${reason ? html`<small>${reason}</small>` : nothing}
  </span>`;
}
