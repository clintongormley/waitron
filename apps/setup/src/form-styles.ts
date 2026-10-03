import { css } from "lit";

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

/** Two short fields that belong together share a row while each can still be five tap targets wide. */
export const pairStyles = css`
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--wt-tap-min) * 5)), 1fr));
    column-gap: var(--wt-space-3);
  }
`;

export const introStyles = css`
  .intro {
    color: var(--wt-color-text-muted);
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

export const helpLinkStyles = css`
  a {
    color: var(--wt-color-primary);
  }
`;
