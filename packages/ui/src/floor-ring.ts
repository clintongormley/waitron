import { css, html, nothing, type TemplateResult } from "lit";

export type FloorRing = "forgotten" | "overdue" | "fire" | "waiting";

export type FloorPulse = "forgotten" | "overdue" | "fire";

const PULSE: Record<FloorRing, "slow" | "fast" | null> = {
  forgotten: "fast",
  overdue: "slow",
  fire: "slow",
  waiting: null,
};

/** The ring lies over its box, so the element holding it must be `position: relative`. */
export const floorRingStyles = css`
  .ring {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 0 0 var(--wt-space-1) currentColor;
  }

  .ring-forgotten,
  .ring-overdue {
    color: var(--wt-color-danger);
    --ring-dim: var(--wt-color-danger-pulse-dim);
  }

  .ring-fire,
  .ring-waiting {
    color: var(--wt-color-warning);
    --ring-dim: var(--wt-color-warning-pulse-dim);
  }

  .ring-waiting {
    box-shadow: inset 0 0 0 calc(var(--wt-space-1) / 2) currentColor;
  }

  .ring.on-fill {
    box-shadow:
      inset 0 0 0 var(--wt-space-1) currentColor,
      inset 0 0 0 calc(var(--wt-space-1) + 1px) var(--wt-color-surface);
  }

  /* After .ring.on-fill, which it must override at the same specificity. */
  .ring-waiting.on-fill {
    box-shadow:
      inset 0 0 0 calc(var(--wt-space-1) / 2) currentColor,
      inset 0 0 0 calc(var(--wt-space-1) / 2 + 1px) var(--wt-color-surface);
  }

  /* Outside the shape: the surface gap keeps the ring apart from a fill of its own colour. */
  .pulse {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      0 0 0 calc(var(--wt-space-1) / 2) var(--wt-color-surface),
      0 0 0 calc(var(--wt-space-1) * 1.5) currentColor;
  }

  /* --ring-dim is set per ring above, not a token: the colour its pulse dims to half-way. */
  @keyframes wt-pulse {
    50% {
      color: var(--ring-dim);
    }
  }

  .wt-pulse-slow {
    animation: wt-pulse var(--wt-duration-pulse-slow) ease-in-out infinite;
  }

  .wt-pulse-fast {
    animation: wt-pulse var(--wt-duration-pulse-fast) ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .wt-pulse-slow,
    .wt-pulse-fast {
      animation: none;
    }
  }
`;

/** The ring for `ring`, pulsing at its speed only while `moving`; nothing for no ring. `onFill`
 * adds a surface line inside the outline so it reads on a solid fill. */
export function renderFloorRing(
  ring: FloorRing | null,
  moving: boolean,
  { onFill = false }: { onFill?: boolean } = {},
): TemplateResult | typeof nothing {
  if (ring === null) return nothing;
  const pulse = moving ? PULSE[ring] : null;
  const pulseClass = pulse === null ? "" : ` wt-pulse-${pulse}`;
  const fillClass = onFill ? " on-fill" : "";
  return html`<span
    class="ring ring-${ring}${pulseClass}${fillClass}"
    data-ring=${ring}
    aria-hidden="true"
  ></span>`;
}

/** A ring outside its box, pulsing at its speed; nothing for no pulse, or while not `moving`. */
export function renderFloorPulse(
  pulse: FloorPulse | null,
  moving: boolean,
): TemplateResult | typeof nothing {
  if (pulse === null || !moving) return nothing;
  return html`<span
    class="pulse ring-${pulse} wt-pulse-${PULSE[pulse]}"
    data-pulse=${pulse}
    aria-hidden="true"
  ></span>`;
}
