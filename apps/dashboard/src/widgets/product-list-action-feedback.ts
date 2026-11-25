import { css, html, nothing } from "lit";
import { codeOf } from "../i18n/codes.js";
import { refusalText } from "./delete-refusal.js";
import { fill, t } from "../i18n/t.js";

export function productListActionFeedback(message: string, announce: boolean) {
  return message
    ? html`<p
        slot="toolbar-bottom"
        class="error"
        data-test="list-action-error"
        role=${announce ? "alert" : nothing}
      >
        ${message}
      </p>`
    : nothing;
}

export const productAvailabilityFeedbackStyles = css`
  .availability-error {
    position: sticky;
    inset-block-start: 0;
    z-index: 4;
    margin: 0;
    padding: var(--wt-space-2) var(--wt-space-3);
    background: var(--wt-color-surface);
    color: var(--wt-color-danger);
    overflow-wrap: anywhere;
  }
`;

export function productAvailabilityFeedback(refusal: { name: string; error: unknown } | null) {
  return refusal
    ? html`<p class="availability-error" role="alert">
        ${fill("product.availability_refused", {
          name: refusal.name,
          reason: refusalText(
            codeOf(refusal.error),
            (refusal.error as { params?: unknown })?.params,
          ),
        })}
      </p>`
    : nothing;
}

export function clearProductSearch(clear: () => void, slot?: string) {
  return html`<wt-button slot=${slot ?? nothing} variant="secondary" @click=${clear}
    >${t("product.clear_search_filters")}</wt-button
  >`;
}

export function hiddenProductSave(name: string, clear: () => void) {
  return html`<div slot="toolbar-bottom" class="actions" data-test="product-saved-hidden">
    <span role="status">${fill("product.saved_hidden", { name })}</span>
    ${clearProductSearch(clear)}
  </div>`;
}
