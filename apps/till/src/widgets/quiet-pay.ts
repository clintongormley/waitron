import { css } from "lit";

export const quietPayStyles = css`
  .quiet-pay-amount dd {
    font-size: var(--wt-font-size-xl);
  }

  :is([data-pay-way], [data-pay-method]) .options {
    display: grid;
    gap: var(--wt-space-2);
  }

  [data-pay-way] .options {
    grid-template-columns: minmax(0, 1fr);
  }

  [data-pay-method] .options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  :is([data-pay-way], [data-pay-method]) .option {
    min-width: 0;
    padding-inline: var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    font-weight: var(--wt-font-weight-bold);
  }

  [data-pay-way] .option {
    padding-block: var(--wt-space-1);
  }

  .pay-way-hint {
    display: block;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-normal);
  }

  [data-pay-method] .option:only-child {
    grid-column: 1 / -1;
  }

  :is([data-pay-way], [data-pay-method]) .option:has(input:checked) {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-surface-lifted);
  }

  [data-pay-method] .option:has(input[value="manual"]) {
    grid-column: 1 / -1;
    justify-self: start;
    padding-inline: 0;
    border-color: transparent;
    background: transparent;
    color: var(--wt-color-primary-text);
    font-size: var(--wt-font-size-sm);
    text-decoration: underline;
  }
`;
