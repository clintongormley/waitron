import { css } from "lit";

/** The Give money back window's look, shared by its steps and the under-way view. */
export const giveBackStyles = css`
  wt-dialog[data-approval-covered] {
    --wt-dialog-scrim: transparent;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-4);
  }
  p {
    overflow-wrap: anywhere;
    margin: 0;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }
  legend,
  .heading {
    font-weight: var(--wt-font-weight-bold);
    margin-bottom: var(--wt-space-2);
  }
  .muted,
  .reason {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }
  .apart {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
  }
  .unavailable {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-3) var(--wt-space-4);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-lg);
    background: var(--wt-color-surface);
    color: var(--wt-color-text-muted);
  }
  .unavailable .title {
    font-weight: var(--wt-font-weight-bold);
  }
  .unavailable .hint {
    font-size: var(--wt-font-size-sm);
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    min-height: var(--wt-tap-min);
  }
  .option input {
    flex: none;
    accent-color: var(--wt-color-primary);
  }
  .summary {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
    padding: var(--wt-space-3) var(--wt-space-4);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-lg);
    background: var(--wt-color-surface);
  }
  .error {
    color: var(--wt-color-danger);
    font-size: var(--wt-font-size-sm);
  }
  .body-step {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-3);
  }
  .total {
    font-size: var(--wt-font-size-lg);
    font-weight: var(--wt-font-weight-bold);
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
  }
`;

export const giveBackDialogStyles = css`
  ${giveBackStyles}

  @media (width <= 480px) {
    .body {
      inline-size: calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5));
    }

    wt-dish-pick-row::part(portion) {
      padding-inline-start: var(--wt-space-5);
    }
  }
`;
