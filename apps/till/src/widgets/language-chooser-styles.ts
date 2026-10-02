import { css } from "lit";

/**
 * The till's placement of `wt-language-chooser`: `.language-corner` holds it at the top right on a
 * screen with no top bar, and at phone width the trigger shows the short code. The breakpoint is a
 * literal because a media query cannot read a token.
 */
export const languageChooserStyles = css`
  .language-corner {
    display: flex;
    justify-content: flex-end;
    padding-block-end: var(--wt-space-3);
  }

  @media (max-width: 40rem) {
    wt-language-chooser::part(name) {
      display: none;
    }

    wt-language-chooser::part(code) {
      display: inline;
    }
  }
`;
