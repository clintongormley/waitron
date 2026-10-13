import { css } from "lit";

/** Sets `--period-fill` and `--period-on-fill` on each `[data-colour]` element from its
 *  `CALENDAR_COLOURS` (src/hours-types.ts) colour; this list and that one change together. */
export const periodColourStyles = css`
  [data-colour="red"] {
    --period-fill: var(--wt-color-palette-red);
    --period-on-fill: var(--wt-color-on-palette-red);
  }
  [data-colour="amber"] {
    --period-fill: var(--wt-color-palette-amber);
    --period-on-fill: var(--wt-color-on-palette-amber);
  }
  [data-colour="grey"] {
    --period-fill: var(--wt-color-palette-grey);
    --period-on-fill: var(--wt-color-on-palette-grey);
  }
  [data-colour="blue"] {
    --period-fill: var(--wt-color-palette-blue);
    --period-on-fill: var(--wt-color-on-palette-blue);
  }
  [data-colour="green"] {
    --period-fill: var(--wt-color-palette-green);
    --period-on-fill: var(--wt-color-on-palette-green);
  }
  [data-colour="purple"] {
    --period-fill: var(--wt-color-palette-purple);
    --period-on-fill: var(--wt-color-on-palette-purple);
  }
`;
