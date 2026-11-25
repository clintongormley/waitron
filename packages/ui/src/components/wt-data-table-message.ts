import { html, nothing } from "lit";

export function tableMessage(message: string, action?: string) {
  return html`<div class="empty">
    <p class="message" role="status">${message}</p>
    ${action ? html`<slot name=${action}></slot>` : nothing}
  </div>`;
}
