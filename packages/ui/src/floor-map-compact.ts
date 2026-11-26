import { css } from "lit";
import { fitScale, type PlanRect } from "./floor-plan-geometry.js";

export const floorMapPanHintStyles = css`
  .pan-hint {
    position: absolute;
    z-index: 1;
    inset-inline-end: var(--wt-space-2);
    inset-block-end: var(--wt-space-2);
    padding: var(--wt-space-1) var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    pointer-events: none;
  }
`;

export function fitCompactFloorMap(
  crop: PlanRect,
  size: { width: number; height: number },
  smallestEdge: number,
  styles: CSSStyleDeclaration,
): { scale: number; minimum: number; inset: number } {
  const tap = parseFloat(styles.getPropertyValue("--wt-tap-min"));
  const inset =
    parseFloat(styles.getPropertyValue("--wt-space-4")) +
    parseFloat(styles.getPropertyValue("--wt-space-1"));
  const minimum = tap / smallestEdge;
  const widthFit = (size.width - 2 * inset) / crop.width;
  // A short screen favors width without zooming a short row to the entire screen width.
  const preferred = Math.max(fitScale(crop, size), 2.5 * minimum);
  const scale = Math.max(minimum, Math.min(widthFit, preferred));
  return { scale, minimum, inset };
}

export function keepPlanInView(offset: number, start: number, end: number, size: number): number {
  const low = Math.min(-start, size - end);
  const high = Math.max(-start, size - end);
  return Math.min(high, Math.max(low, offset));
}
