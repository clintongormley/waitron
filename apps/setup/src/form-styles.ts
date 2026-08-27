import { css } from "lit";

/**
 * The screen-chrome rule blocks the setup wizard's step screens share verbatim: the button row, a
 * stacked form field, the validation-banner text, and the muted status line. Each was byte-duplicated
 * across the seven step screens (in two drifted spellings that computed the same result), so each is
 * extracted here as a single `css` fragment. A screen composes only the fragments it uses into its
 * `static styles`, after `baseStyles`, and keeps its own unique rules inline. Mirrors the
 * import-and-compose idiom of `@waitron/ui`'s `selectStyles`.
 */
export const actionsStyles = css`
  .actions {
    display: flex;
    gap: var(--wt-space-3);
    margin-top: var(--wt-space-4);
  }
`;

export const fieldStyles = css`
  .field {
    display: block;
    margin-bottom: var(--wt-space-4);
  }
`;

export const errorStyles = css`
  .error {
    color: var(--wt-color-danger);
    margin-top: var(--wt-space-3);
  }
`;

export const statusStyles = css`
  .status {
    margin: var(--wt-space-3) 0 0;
    color: var(--wt-color-text-muted);
  }
`;
