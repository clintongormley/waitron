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
