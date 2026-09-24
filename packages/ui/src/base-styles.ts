import { css } from "lit";
export { baseStyles, disabledStyles } from "@waitron/ui-core/base-styles";

export const floorTrayStyles = css`
  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: var(--wt-space-2);
    padding: var(--wt-space-2);
    border: 1px dashed var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }

  .tray-label {
    width: 100%;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }

  .tray-item {
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
`;

/** A native form `<select>`; a consumer needing more layers its own `select` rule after this. */
export const selectStyles = css`
  select {
    font: inherit;
    padding: var(--wt-space-2);
    border-radius: var(--wt-radius-md);
    border: 1px solid var(--wt-color-border);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    width: 100%;
  }
`;
