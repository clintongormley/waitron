import { css, html, nothing } from "lit";

export function tableMessage(message: string, action?: string) {
  return html`<div class="empty">
    <p class="message" role="status">${message}</p>
    ${action ? html`<slot name=${action}></slot>` : nothing}
  </div>`;
}

export const tableMessageStyles = css`
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--wt-space-4);
    padding: var(--wt-space-6);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-surface);
    text-align: center;
  }
`;
