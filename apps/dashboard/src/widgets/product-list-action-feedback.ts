import { css, html, nothing } from "lit";

export function productListActionFeedback(message: string, announce: boolean) {
  return message
    ? html`<p
        slot="toolbar-bottom"
        class="error"
        data-test="list-action-error"
        role=${announce ? "alert" : nothing}
      >
        ${message}
      </p>`
    : nothing;
}

export const productAvailabilityFeedbackStyles = css`
  .availability-error {
    position: sticky;
    inset-block-start: 0;
    z-index: 4;
    margin: 0;
    padding: var(--wt-space-2) var(--wt-space-3);
    background: var(--wt-color-surface);
    color: var(--wt-color-danger);
    overflow-wrap: anywhere;
  }
`;

export function productAvailabilityFeedback(message: string) {
  return message ? html`<p class="availability-error" role="alert">${message}</p>` : nothing;
}
