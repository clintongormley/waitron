import { css } from "lit";

export const billPayDialogStyles = css`
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-4);
  }

  p {
    margin: 0;
  }

  .balance {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--wt-space-2) var(--wt-space-4);
    margin: 0;
    padding: var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }

  .balance div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .balance dt {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .balance dd {
    margin: 0;
    font-weight: var(--wt-font-weight-bold);
  }

  .deferred {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    margin: 0 0 var(--wt-space-3);
  }

  .deferred p,
  .way-reason {
    margin: 0;
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .way-reason {
    margin-block-start: var(--wt-space-2);
  }

  /* Wraps within the width the window's choices and amounts set, never widening it. */
  .credited,
  .scope,
  .own-bill {
    contain: inline-size;
  }

  .scope,
  .taken {
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
  }

  [data-pay-way] .options {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--wt-space-2);
  }

  [data-pay-way] .option {
    min-width: 0;
    flex-direction: column;
    gap: var(--wt-space-1);
    text-align: center;
    overflow-wrap: normal;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
  }

  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2) var(--wt-space-4);
  }

  .units {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
  }

  .units-count {
    min-width: var(--wt-space-6);
    text-align: center;
    font-weight: var(--wt-font-weight-bold);
  }

  .required,
  .field-error {
    color: var(--wt-color-danger);
  }

  .required {
    margin-inline-start: var(--wt-space-1);
  }

  .field-error {
    margin: var(--wt-space-1) 0 0;
    font-size: var(--wt-font-size-sm);
  }

  .muted {
    color: var(--wt-color-text-muted);
  }

  .allocation {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    margin: 0;
  }

  .allocation div {
    display: flex;
    justify-content: space-between;
    gap: var(--wt-space-4);
  }

  .allocation dd {
    margin: 0;
    font-weight: var(--wt-font-weight-bold);
  }

  .allocation .headline {
    font-size: var(--wt-font-size-lg);
  }

  [data-pay-tip] dt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
  }

  .payments {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
  }

  .payments h3 {
    margin: 0;
    font-size: var(--wt-font-size-md);
  }

  .payments ol {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .payment {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--wt-space-2) var(--wt-space-4);
    padding: var(--wt-space-2) var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }

  .payment-text {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .payment-head {
    font-weight: var(--wt-font-weight-bold);
  }

  .payment-text p {
    font-size: var(--wt-font-size-sm);
  }

  .nowrap {
    white-space: nowrap;
  }

  .taken-block {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    padding: var(--wt-space-3);
    border: 1px solid var(--wt-color-success);
    border-radius: var(--wt-radius-md);
  }

  .taken-block .taken {
    color: var(--wt-color-success);
  }

  .taken-block p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .tone {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
    padding: var(--wt-space-3);
    border: 1px solid var(--wt-color-warning);
    border-radius: var(--wt-radius-md);
  }

  .tone-title {
    color: var(--wt-color-warning);
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
  }

  .ask-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--wt-space-2);
    margin-top: var(--wt-space-2);
  }

  .tone-body {
    overflow-wrap: anywhere;
  }
`;
