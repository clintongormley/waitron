import { css, html, nothing, type TemplateResult } from "lit";
import { formatDecimalInput } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";
import type { OrderPreviewItem } from "../api/client.js";

export const orderPreviewStyles = css`
  button.summary {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
    padding: var(--wt-space-2);
    border-radius: var(--wt-radius-sm);
    min-height: var(--wt-tap-min);
  }
  button.summary:hover {
    background: var(--wt-color-surface-lifted);
  }
  button.summary:focus-visible {
    outline: var(--wt-focus-ring);
  }
  .order-preview {
    flex-basis: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .order-preview ul {
    margin: 0;
    padding-inline-start: var(--wt-space-5);
  }
  .order-preview li {
    padding-block: var(--wt-space-1);
  }
  .order-preview .preview-note {
    white-space: pre-wrap;
    color: var(--wt-color-text-muted);
  }
  .order-preview .preview-quantity {
    font-variant-numeric: tabular-nums;
  }
`;

export function orderPreview(items: readonly OrderPreviewItem[]): TemplateResult | typeof nothing {
  if (items.length === 0) return nothing;
  return html`<ul>
    ${items.map(
      (item) =>
        html`<li data-preview-dish>
          <span class="preview-quantity"
            >${formatDecimalInput(item.quantity, currentLocale())} × </span
          >${item.name}
          ${
            item.extras.length === 0
              ? nothing
              : html`<ul>
                  ${item.extras.map((extra) => html`<li data-preview-extra><span class="preview-quantity">${formatDecimalInput(extra.quantity, currentLocale())} × </span>${extra.name}</li>`)}
                </ul>`
          }
          ${item.note === null || item.note === "" ? nothing : html`<div class="preview-note">${item.note}</div>`}
        </li>`,
    )}
  </ul>`;
}
