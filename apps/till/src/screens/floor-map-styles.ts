import { css, unsafeCSS } from "lit";
import { PHONE_WIDTH } from "../widgets/chooser-styles.js";

export const floorMapStyles = css`
  .map {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-3);
  }

  wt-floor-map {
    align-self: center;
    width: min(
      100%,
      calc(max(var(--wt-tap-min) * 6, 100dvh - var(--wt-tap-min) * 8) * var(--floor-map-ratio))
    );
    aspect-ratio: var(--floor-map-ratio);
  }

  @media ${unsafeCSS(PHONE_WIDTH)}, (max-height: 40rem) and (orientation: landscape) {
    wt-floor-map {
      --floor-map-tap-size: var(--wt-tap-min);
      min-height: calc(var(--wt-tap-min) + var(--wt-space-2) * 2);
    }
  }
`;
