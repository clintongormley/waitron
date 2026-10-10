import { css, unsafeCSS } from "lit";
import { PHONE_WIDTH } from "./language-chooser-styles.js";

/**
 * A screen drawn as one card, with `wt-card`'s frame. Drawn here rather than with `wt-card`, which
 * exposes no part for its frame, because at phone width the frame goes and the content sits on the
 * page like the till's other screens.
 */
export const screenCardStyles = css`
  .screen {
    background: var(--wt-color-surface);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-lg);
    padding: var(--wt-space-4);
  }

  @media ${unsafeCSS(PHONE_WIDTH)} {
    .screen {
      background: none;
      border: 0;
      border-radius: 0;
      padding-inline: 0;
    }
  }
`;
