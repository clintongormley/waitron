import { css } from "lit";
import { fitScale, type PlanRect } from "./floor-plan-geometry.js";

export const viewportStyles = css`
  .map-content {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .plan {
    position: relative;
    overflow: clip;
  }
  .pan-hint {
    justify-self: end;
    margin: 0 var(--wt-space-2) var(--wt-space-2);
    padding: var(--wt-space-1) var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    pointer-events: none;
  }
  @media (orientation: landscape) {
    .map-content {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: minmax(0, 1fr);
    }
    .pan-hint {
      align-self: end;
      max-inline-size: calc(4 * var(--wt-tap-min));
    }
  }
`;

export function viewport(map: HTMLElement): { width: number; height: number } {
  const plan = map.shadowRoot?.querySelector(".plan") ?? map;
  return { width: plan.clientWidth, height: plan.clientHeight };
}

export function fit(
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
  const preferred =
    size.width > size.height
      ? (size.height - 2 * inset) / crop.height
      : Math.max(fitScale(crop, size), 2.5 * minimum);
  const scale = Math.max(minimum, Math.min(widthFit, preferred));
  return { scale, minimum, inset };
}

export function clampView(
  { x, y, scale }: { x: number; y: number; scale: number },
  crop: PlanRect,
  size: { width: number; height: number },
): { x: number; y: number; scale: number } {
  return {
    scale,
    x: keepPlanInView(x, crop.x * scale, (crop.x + crop.width) * scale, size.width),
    y: keepPlanInView(y, crop.y * scale, (crop.y + crop.height) * scale, size.height),
  };
}

function keepPlanInView(offset: number, start: number, end: number, size: number): number {
  const low = Math.min(-start, size - end);
  const high = Math.max(-start, size - end);
  return Math.min(high, Math.max(low, offset));
}
