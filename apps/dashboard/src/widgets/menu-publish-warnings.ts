import { css, html, type TemplateResult } from "lit";
import type { MenuPreview } from "../api/client.js";
import { staffPresentationName } from "@waitron/catalogue/src/product-presentation.js";
import { localizedName } from "../i18n/localized.js";
import { fill, t } from "../i18n/t.js";
import { leftToBrowser } from "../navigation.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

export const publishWarningStyles = css`
  .menu-publish-warnings,
  .menu-publish-warnings ul {
    display: grid;
    gap: var(--wt-space-2);
    min-width: 0;
    margin: 0;
    padding-inline-start: var(--wt-space-5);
    overflow-wrap: anywhere;
  }
  .menu-publish-warnings p {
    margin: 0;
  }
  .menu-publish-warnings a {
    color: var(--wt-color-primary-text);
  }
`;

function openProduct(event: MouseEvent, id: string): void {
  if (leftToBrowser(event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget!.dispatchEvent(
    new CustomEvent("wt-edit-product", {
      detail: { productId: id },
      bubbles: true,
      composed: true,
    }),
  );
}

export function renderMenuWarnings(
  warnings: MenuPreview["warnings"],
  menuName: string,
): TemplateResult {
  const missing = warnings.filter((warning) => warning.kind === "shortcut_missing").length;
  return html`<ul class="menu-publish-warnings" data-test="warnings">
    ${missing === 0 ? [] : html`<li>${fill(missing === 1 ? "menu_preview.shortcut_missing_one" : "menu_preview.shortcut_missing", { count: String(missing), menu: menuName })}</li>`}
    ${warnings.map((warning) => {
      if (warning.kind === "extra_portion_precision")
        return html`<li>
          ${fill("menu_preview.extra_portion_precision", { list: warning.listName, product: warning.name, amount: `${warning.portion} ${localizedName(warning.abbreviation)}`.trim(), precision: String(warning.precision) })}
        </li>`;
      if (warning.kind === "allergens_unreviewed")
        return html`<li>
          <p>${t("menu_preview.allergens_unreviewed")}</p>
          <ul>
            ${warning.products.map((product) => html`<li><a href=${`/manage/catalogue/product/${encodeURIComponent(product.id)}`} @click=${(event: MouseEvent) => openProduct(event, product.id)}>${staffPresentationName({ name: product.parentName ?? product.name, variantName: product.parentName === null ? null : product.name })}</a></li>`)}
          </ul>
        </li>`;
      return [];
    })}
  </ul>`;
}

export interface PublishWarningConfirmation {
  preview: MenuPreview;
  menuName: string;
  actionLabel: string;
  busy: boolean;
  confirm: () => void;
  cancel: () => void;
}

export function renderPublishWarningConfirmation(
  options: PublishWarningConfirmation,
): TemplateResult {
  return html`<wt-dialog
    .open=${true}
    heading=${options.actionLabel}
    data-test="publish-confirmation"
    .dismissible=${!options.busy}
    @wt-close=${(event: Event) => {
      event.stopPropagation();
      options.cancel();
    }}
  >
    ${renderMenuWarnings(options.preview.warnings, options.menuName)}
    <wt-form-actions slot="footer">
      <wt-button
        slot="cancel"
        variant="secondary"
        data-test="publish-cancel"
        ?disabled=${options.busy}
        @click=${(event: Event) => {
          event.stopPropagation();
          options.cancel();
        }}
        >${t("action.cancel")}</wt-button
      >
      <wt-button
        variant="primary"
        data-test="publish-confirm"
        .loading=${options.busy}
        ?disabled=${options.busy || options.preview.clashes.length > 0}
        @click=${(event: Event) => {
          event.stopPropagation();
          options.confirm();
        }}
        >${options.actionLabel}</wt-button
      >
    </wt-form-actions>
  </wt-dialog>`;
}
