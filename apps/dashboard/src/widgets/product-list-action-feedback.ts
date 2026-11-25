import { css, html, nothing } from "lit";
import { codeOf } from "../i18n/codes.js";
import { refusalText } from "./delete-refusal.js";
import { fill, t } from "../i18n/t.js";
import type { ProductAvailabilityRefusal } from "./product-availability-actions.js";

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

export function productRoutingFeedback() {
  return html`<p slot="toolbar-bottom" class="error" role="status" data-test="routing-unavailable">
    ${t("folders.routing_unavailable")}
  </p>`;
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
  .availability-error[data-reserved] {
    box-sizing: border-box;
    block-size: calc(var(--wt-tap-min) + var(--wt-space-6));
    overflow: auto;
  }
  .availability-error:not([data-message]) {
    background: transparent;
    pointer-events: none;
  }
`;

function availabilityRefusalText({ batch, name, error }: ProductAvailabilityRefusal): string {
  const code = codeOf(error);
  const reason = refusalText(code, (error as { params?: unknown })?.params);
  const message =
    name === undefined
      ? reason
      : batch && code === "product.deleted"
        ? fill("product.batch_availability_deleted", { name })
        : fill("product.availability_refused", { name, reason });
  // A lost reply can follow a committed write.
  return batch && !code.startsWith("connection.") && code !== "server.internal"
    ? fill("product.batch_availability_refused", { reason: message })
    : message;
}

export function productAvailabilityFeedback(
  refusal: ProductAvailabilityRefusal | null,
  reserveSpace: boolean,
) {
  if (refusal === null && !reserveSpace) return nothing;
  return html`<p
    class="availability-error"
    role=${refusal === null ? nothing : "alert"}
    ?data-reserved=${reserveSpace}
    ?data-message=${refusal !== null}
  >
    ${refusal === null ? nothing : availabilityRefusalText(refusal)}
  </p>`;
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
