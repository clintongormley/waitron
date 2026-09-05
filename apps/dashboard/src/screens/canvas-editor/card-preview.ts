import { type TemplateResult, html } from "lit";
import { CARD_TYPES, type CardType } from "./card-contracts.js";

/**
 * A dashboard-LOCAL, static, presentational SILHOUETTE per card type: a lightweight, recognizable
 * preview of what each till card looks like (a product-grid → a mini tile grid, a basket → a few
 * sample lines, a total → a big value block, …) so an owner authoring a layout sees roughly the shape
 * of each card instead of a grey name box.
 *
 * These are deliberately NOT the till's real card widgets and NOT data-bound. The dashboard has no POS
 * data and cannot import `apps/till`'s widgets (they need ~30 runtime props + live stores), and it must
 * not runtime-import `@waitron/layouts` (the #70 bundle rule). So every silhouette here is a handful of
 * static `<div>`s with pure shapes (no text) — recognizable in spirit, sourced only from the local
 * `CardType`. Faithfulness is modelled on `apps/till/src/widgets/card-grid.ts`'s `#element` switch (read
 * for reference, never imported): product-grid, basket, total, tender-pay, held-orders, station-queue
 * (prep-queue), notifications, and the embedded big screens floor-plan/table-layout-editor/expo/
 * kds-board/table-order.
 *
 * Structure only — no chrome, no text. The silhouette's colours/spacing come from the host component's
 * shadow CSS (`canvas-grid-preview`), which also marks the wrapper `aria-hidden` and `pointer-events:
 * none` so the decorative preview never intercepts a drag/select and the screen reader skips it. Each
 * root carries `data-preview="<type>"` for the host and the unit tests.
 *
 * MEMOIsED: the silhouettes depend only on `type` (no data), so the exhaustive builder runs ONCE per
 * type at module load into {@link PREVIEWS} and `cardPreview(type)` returns that shared, fully-static
 * `TemplateResult` instance. Returning the same instance across many tiles and across every drag frame
 * re-render is safe in Lit (nothing in it varies), and it stops each drag frame rebuilding every tile's
 * silhouette (`draggingIndex`/`dropIndex` are `@state`, so a drag re-renders every tile).
 */
export function cardPreview(type: CardType): TemplateResult {
  return PREVIEWS[type];
}

/** `n` identical childless bars of one class — the repeated shape most silhouettes are built from. */
const bars = (n: number, cls: string): TemplateResult[] =>
  Array.from({ length: n }, () => html`<span class=${cls}></span>`);

/**
 * The EXHAUSTIVE builder, run once per {@link CardType} into {@link PREVIEWS}. The `switch` covers every
 * member: every arm returns, and the trailing `assertNever(type)` turns adding a new card type WITHOUT a
 * silhouette into a compile error (the argument stops being `never`) rather than a silently-missing
 * preview. A deliberate mirror of the till's `#element` switch — kept as the BUILDER even though the
 * result is memoised.
 */
function buildPreview(type: CardType): TemplateResult {
  switch (type) {
    case "product-grid":
      // A mini tile grid — the counter's tap-to-add product buttons.
      return html`<div class="cp cp-product-grid" data-preview="product-grid">
        ${bars(6, "cp-cell")}
      </div>`;
    case "basket":
      // A few sample order lines: a name bar + a small amount bar per row.
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
      // The order total — one large value block.
      return html`<div class="cp cp-total" data-preview="total">
        <span class="cp-amount"></span>
      </div>`;
    case "tender-pay":
      // A couple of pay buttons (cash / card), one accented.
      return html`<div class="cp cp-tender-pay" data-preview="tender-pay">
        <span class="cp-pay"></span><span class="cp-pay cp-pay-primary"></span>
      </div>`;
    case "held-orders":
      // Parked orders as stacked chips.
      return html`<div class="cp cp-held-orders" data-preview="held-orders">
        ${bars(3, "cp-chip")}
      </div>`;
    case "prep-queue":
      // The station queue as a rail of ticket rows.
      return html`<div class="cp cp-prep-queue" data-preview="prep-queue">
        ${bars(3, "cp-ticket")}
      </div>`;
    case "notifications":
      // A bell + a toast line.
      return html`<div class="cp cp-notifications" data-preview="notifications">
        <span class="cp-bell"></span><span class="cp-toast"></span>
      </div>`;
    case "floor-plan":
      // A few table shapes on the room plan (a mix of round and square).
      return html`<div class="cp cp-floor-plan" data-preview="floor-plan">
        <span class="cp-table cp-table-round"></span><span class="cp-table"></span
        ><span class="cp-table cp-table-round"></span><span class="cp-table"></span>
      </div>`;
    case "table-layout-editor":
      // The same room plan, in edit mode: tables plus a resize/edit handle in the corner.
      return html`<div class="cp cp-table-layout-editor" data-preview="table-layout-editor">
        <span class="cp-table"><span class="cp-edit-handle"></span></span
        ><span class="cp-table cp-table-round"></span><span class="cp-table"></span>
      </div>`;
    case "kds-board":
      // The kitchen board — a few status columns, each with ticket cards.
      return html`<div class="cp cp-kds-board" data-preview="kds-board">
        ${Array.from(
          { length: 3 },
          () => html`<span class="cp-column">${bars(2, "cp-column-ticket")}</span>`,
        )}
      </div>`;
    case "expo":
      // The expo pass — a row of order tickets awaiting fire/away.
      return html`<div class="cp cp-expo" data-preview="expo">
        ${Array.from(
          { length: 3 },
          () => html`<span class="cp-expo-ticket">${bars(2, "cp-expo-line")}</span>`,
        )}
      </div>`;
    case "table-order":
      // A table's tab: a header row plus its ordered lines.
      return html`<div class="cp cp-table-order" data-preview="table-order">
        <span class="cp-header"></span>
        ${bars(3, "cp-order-line")}
      </div>`;
  }
  /* v8 ignore next -- unreachable: the switch above is exhaustive over CardType (compile-time guard) */
  return assertNever(type);
}

/** Every silhouette, built once from the exhaustive {@link buildPreview}. Fully static, so the same
 * instance is safe to return from every render (see {@link cardPreview}). */
const PREVIEWS: Record<CardType, TemplateResult> = Object.fromEntries(
  CARD_TYPES.map((type) => [type, buildPreview(type)] as const),
) as Record<CardType, TemplateResult>;

/* v8 ignore start -- unreachable: only reachable if CardType gains an unhandled member (a compile error) */
function assertNever(value: never): never {
  throw new Error(`unhandled card type: ${String(value)}`);
}
/* v8 ignore stop */
