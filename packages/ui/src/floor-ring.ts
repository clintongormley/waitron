import { css, html, nothing, type TemplateResult } from "lit";

export type FloorRing = "forgotten" | "overdue" | "fire" | "waiting";

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

  /* --ring-dim is set per ring, not a token: the colour its pulse dims to half-way. */
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

/** The ring for `ring`, pulsing at its speed only while `moving`; nothing for no ring. */
export function renderFloorRing(
  ring: FloorRing | null,
  moving: boolean,
): TemplateResult | typeof nothing {
  if (ring === null) return nothing;
  const pulse = moving ? PULSE[ring] : null;
  const pulseClass = pulse === null ? "" : ` wt-pulse-${pulse}`;
  return html`<span
    class="ring ring-${ring}${pulseClass}"
    data-ring=${ring}
    aria-hidden="true"
  ></span>`;
}
