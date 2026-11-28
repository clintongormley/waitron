import { type TemplateResult, css, html, nothing } from "lit";
import { scrollAncestors } from "@waitron/ui/src/reorder-table.js";

/** A row's second line: its parts joined by " · ", or nothing when it has none. */
export function rowMore(
  parts: readonly (TemplateResult | string)[],
): TemplateResult | typeof nothing {
  return parts.length === 0
    ? nothing
    : html`<span class="row-more"
        >${parts.map((part, i) => (i === 0 ? part : html` · ${part}`))}</span
      >`;
}

/** The text cells an order row draws — quantity, name, second line and price — shared by the new
 * dishes' rows and the sent ones. Each row's own sheet lays the cells out. */
export const rowTextStyles = css`
  .row-qty {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
  }
  .row-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row-name {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-medium);
  }
  .row-more {
    display: block;
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
    color: var(--wt-color-text-muted);
  }
  .row-price {
    margin-inline-start: var(--wt-space-2);
    font-size: var(--wt-font-size-md);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
`;

export const OPEN_BORDER = css`2px`;

/** An opened order row's box, new or sent: the declarations for the rule that opens it. */
export const openRowBox = css`
  margin: var(--wt-space-1) var(--wt-space-2);
  border: ${OPEN_BORDER} solid var(--wt-color-primary);
  border-radius: var(--wt-radius-md);
  background: var(--wt-color-surface);
  box-shadow: none;
`;

/** An opened row's outlined buttons, new or sent: the declarations for their rule. */
export const openRowAction = css`
  box-sizing: border-box;
  height: var(--wt-tap-min);
  margin: 0;
  padding: 0 var(--wt-space-3);
  border: 1px solid var(--wt-color-border);
  border-radius: var(--wt-radius-md);
  background: var(--wt-color-surface);
  color: var(--wt-color-text);
  font: inherit;
  font-size: var(--wt-font-size-md);
  font-weight: var(--wt-font-weight-bold);
  cursor: pointer;
`;

/** The nearest ancestor of `element` that scrolls, across shadow roots, else the page. */
export function scrollAreaOf(element: Element): Element {
  const scroller = scrollAncestors(element).find((node): node is Element => {
    if (!(node instanceof Element)) return false;
    const { overflowY } = getComputedStyle(node);
    return (
      (overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight
    );
  });
  return scroller ?? document.scrollingElement ?? document.documentElement;
}

/** Brings the foot of `aim`, an opened row's box or a part of it, above the bar at the foot of
 * `scroller`, the area the order scrolls in, by the clearance the box's `scroll-margin-block-end`
 * holds. Where the box is taller than the area, the aim's foot wins. */
export function revealOpenBox(box: Element, scroller: Element, aim: Element = box): void {
  const foot =
    scroller === document.scrollingElement
      ? innerHeight
      : scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight;
  const margin = Number.parseFloat(getComputedStyle(box).scrollMarginBlockEnd);
  const over = aim.getBoundingClientRect().bottom - (foot - margin);
  if (over <= 0) return;
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  if (aim === box) box.scrollIntoView({ block: "end", behavior });
  else scroller.scrollBy({ top: over, behavior });
}
