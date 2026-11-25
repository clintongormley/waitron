import { css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-toast.js";
import { codeOf } from "../i18n/codes.js";
import { refusalText } from "./delete-refusal.js";
import { fill, t } from "../i18n/t.js";
import { countOf } from "./count-text.js";
import type {
  ProductAvailabilityRefusal,
  ProductBatchAvailabilityNotice,
} from "./product-availability-actions.js";

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
  .batch-availability-notice {
    position: fixed;
    z-index: 10;
    inset: auto var(--wt-space-3) calc(var(--wt-space-3) + env(safe-area-inset-bottom));
    max-inline-size: calc(var(--wt-tap-min) * 11);
    inline-size: auto;
    margin: 0 auto;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    overflow-wrap: anywhere;
  }
  .batch-availability-notice:not([open]) {
    display: none;
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

export function productAvailabilityFeedback(refusal: ProductAvailabilityRefusal | null) {
  return refusal === null
    ? nothing
    : html`<p class="availability-error" role="alert">${availabilityRefusalText(refusal)}</p>`;
}

export function productBatchAvailabilityNotice(
  notice: ProductBatchAvailabilityNotice | null,
  dismiss: (event: Event) => void,
) {
  const result = notice !== null && !("error" in notice);
  const message = result
    ? countOf(
        notice.available ? "product.marked_available" : "product.marked_unavailable",
        notice.count,
      )
    : notice === null
      ? ""
      : availabilityRefusalText(notice);
  return html`<wt-toast
    class="batch-availability-notice"
    data-test="batch-availability-notice"
    popover="manual"
    tone=${result ? "info" : "error"}
    .duration=${result ? 8000 : 0}
    .held=${result}
    .open=${notice !== null}
    .message=${message}
    close-label=${t("action.close")}
    @wt-close=${dismiss}
  ></wt-toast>`;
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
