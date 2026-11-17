import { cardFrameStyles } from "@waitron/ui";
import { css, unsafeCSS } from "lit";
import { PHONE_WIDTH } from "./chooser-styles.js";

/**
 * A screen drawn as one card, with `wt-card`'s frame. Drawn here rather than with `wt-card`, which
 * exposes no part for its frame, because at phone width the frame goes and the content sits on the
 * page like the till's other screens.
 */
export const screenCardStyles = css`
  .screen {
    ${cardFrameStyles}
  }

  @media ${unsafeCSS(PHONE_WIDTH)} {
    .screen {
      background: none;
      --wt-form-actions-surface: var(--wt-color-bg);
      border: 0;
      border-radius: 0;
      padding-inline: 0;
    }
  }
`;
