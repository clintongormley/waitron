import { type TemplateResult, html } from "lit";
import { CARD_TYPES, type CardType } from "./card-contracts.js";

/**
 * Decorative, static silhouettes per card type, not the till's real widgets. Built once per type into
 * {@link PREVIEWS}, because a drag re-renders every tile; returning the same fully static
 * `TemplateResult` every render is safe in Lit.
 */
export function cardPreview(type: CardType): TemplateResult {
  return PREVIEWS[type];
}

const bars = (n: number, cls: string): TemplateResult[] =>
  Array.from({ length: n }, () => html`<span class=${cls}></span>`);

/** The trailing `assertNever(type)` turns a new card type WITHOUT a silhouette into a compile error. */
function buildPreview(type: CardType): TemplateResult {
  switch (type) {
    case "product-grid":
      return html`<div class="cp cp-product-grid" data-preview="product-grid">
        ${bars(6, "cp-cell")}
      </div>`;
    case "basket":
      return html`<div class="cp cp-basket" data-preview="basket">
        ${Array.from(
          { length: 3 },
          () =>
            html`<span class="cp-line"
              ><span class="cp-line-name"></span><span class="cp-line-amount"></span
            ></span>`,
        )}
      </div>`;
    case "total":
      return html`<div class="cp cp-total" data-preview="total">
        <span class="cp-amount"></span>
      </div>`;
    case "tender-pay":
      return html`<div class="cp cp-tender-pay" data-preview="tender-pay">
        <span class="cp-pay"></span><span class="cp-pay cp-pay-primary"></span>
      </div>`;
    case "held-orders":
      return html`<div class="cp cp-held-orders" data-preview="held-orders">
        ${bars(3, "cp-chip")}
      </div>`;
    case "prep-queue":
      return html`<div class="cp cp-prep-queue" data-preview="prep-queue">
        ${bars(3, "cp-ticket")}
      </div>`;
    case "notifications":
      return html`<div class="cp cp-notifications" data-preview="notifications">
        <span class="cp-bell"></span><span class="cp-toast"></span>
      </div>`;
    case "floor-plan":
      return html`<div class="cp cp-floor-plan" data-preview="floor-plan">
        <span class="cp-table cp-table-round"></span><span class="cp-table"></span
        ><span class="cp-table cp-table-round"></span><span class="cp-table"></span>
      </div>`;
    case "table-layout-editor":
      return html`<div class="cp cp-table-layout-editor" data-preview="table-layout-editor">
        <span class="cp-table"><span class="cp-edit-handle"></span></span
        ><span class="cp-table cp-table-round"></span><span class="cp-table"></span>
      </div>`;
    case "kds-board":
      return html`<div class="cp cp-kds-board" data-preview="kds-board">
        ${Array.from(
          { length: 3 },
          () => html`<span class="cp-column">${bars(2, "cp-column-ticket")}</span>`,
        )}
      </div>`;
    case "expo":
      return html`<div class="cp cp-expo" data-preview="expo">
        ${Array.from(
          { length: 3 },
          () => html`<span class="cp-expo-ticket">${bars(2, "cp-expo-line")}</span>`,
        )}
      </div>`;
    case "table-order":
      return html`<div class="cp cp-table-order" data-preview="table-order">
        <span class="cp-header"></span>
        ${bars(3, "cp-order-line")}
      </div>`;
  }
  /* v8 ignore start -- unreachable: the switch above is exhaustive over CardType (compile-time guard) */
  return assertNever(type);
  /* v8 ignore stop */
}

const PREVIEWS: Record<CardType, TemplateResult> = Object.fromEntries(
  CARD_TYPES.map((type) => [type, buildPreview(type)] as const),
) as Record<CardType, TemplateResult>;

/* v8 ignore start -- unreachable: only reachable if CardType gains an unhandled member (a compile error) */
function assertNever(value: never): never {
  throw new Error(`unhandled card type: ${String(value)}`);
}
/* v8 ignore stop */
