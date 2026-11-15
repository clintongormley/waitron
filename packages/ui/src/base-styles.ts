import { css } from "lit";
import { baseStyles as sharedBaseStyles } from "@waitron/ui-core/base-styles";
export {
  disabledStyles,
  pageTitleStyles,
  visuallyHiddenStyles,
} from "@waitron/ui-core/base-styles";

// Lit replaces adopted sheets when it creates the render root, so the polyfill's
// injected hiding rule does not survive. Keep it in the component styles themselves.
export const popoverVisibilityStyles = css`
  [popover].\\:popover-open {
    z-index: 100;
  }
  [popover]:not(:is(:popover-open, .\\:popover-open)) {
    display: none;
  }
`;

export const baseStyles = css`
  ${sharedBaseStyles}${popoverVisibilityStyles}
`;

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
