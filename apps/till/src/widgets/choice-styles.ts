import { css } from "lit";

const choiceBase = css`
  .choice {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .choice legend {
    padding: 0;
    margin-bottom: var(--wt-space-2);
    font-weight: var(--wt-font-weight-bold);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    min-height: var(--wt-tap-min);
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .option input {
    flex: none;
    accent-color: var(--wt-color-primary);
  }
`;

/**
 * A till dialog's radio question: a `fieldset.choice` with its `legend`, holding `.options` of
 * `label.option`s, laid out in wrapping rows or in one column.
 */
export const choiceRowStyles = css`
  ${choiceBase}

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-1) var(--wt-space-4);
  }
`;

export const choiceStackStyles = css`
  ${choiceBase}

  .options {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
  }
`;
