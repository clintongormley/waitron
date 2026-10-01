import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { MadeHereItem } from "../api/client.js";
import { dishLine } from "./dish-format.js";
import { optionAnswers } from "./option-snapshot.js";

@customElement("till-make-now")
export class TillMakeNow extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        margin: var(--wt-space-3);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--wt-space-3);
      }
      li {
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }
      .detail {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      button {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
    `,
  ];

  @property({ attribute: false }) items: MadeHereItem[] = [];

  override render() {
    if (this.items.length === 0) return nothing;
    return html`<section role="region" aria-labelledby="make-now-heading">
      <h2 id="make-now-heading" aria-live="polite">${t("make_now.title")}</h2>
      <ul>
        ${this.items.map(
          (item) =>
            html`<li>
              <strong>${dishLine(item, item.name)}</strong>
              ${optionAnswers(item.optionSnapshots, { reads: "staff" }).map(
                (answer) => html`<span class="detail">${answer}</span>`,
              )}
              ${item.extras.map((extra) => html`<span class="detail">+ ${extra}</span>`)}
              ${item.note ? html`<span class="detail">${item.note}</span>` : nothing}
            </li>`,
        )}
      </ul>
      <button
        type="button"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent("dismiss", {
              bubbles: true,
              composed: true,
            }),
          )}
      >
        ${t("make_now.dismiss")}
      </button>
    </section>`;
  }
}
