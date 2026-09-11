import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

export interface TabItem {
  key: string;
  label: string;
}

@customElement("wt-tabs")
export class WtTabs extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      [role="tablist"] {
        display: flex;
        overflow-x: auto;
        border-bottom: 1px solid var(--wt-color-border);
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
      }
      button {
        flex: 0 0 auto;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 0;
        border-bottom: var(--wt-space-1) solid transparent;
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        cursor: pointer;
      }
      button[aria-selected="true"] {
        color: var(--wt-color-text);
        border-bottom-color: var(--wt-color-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      button:hover {
        background: var(--wt-color-surface);
      }
      [role="tabpanel"] {
        padding-block: var(--wt-space-3);
      }
      [hidden] {
        display: none;
      }
    `,
  ];
  @property({ attribute: false }) items: readonly TabItem[] = [];
  @property() value = "";
  @property() label = "";
  readonly #id = uniqueId("wt-tabs");

  get #selected(): string | undefined {
    return this.items.find((item) => item.key === this.value)?.key ?? this.items[0]?.key;
  }

  #select(event: Event, key: string): void {
    if (key === this.#selected) return;
    this.value = key;
    dispatchWtChange(this, event, { value: key });
  }

  #keydown(event: KeyboardEvent, index: number): void {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = (index + this.items.length - 1) % this.items.length;
        break;
      case "ArrowRight":
        next = (index + 1) % this.items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = this.items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.#select(event, this.items[next]!.key);
    const button = this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]!;
    button.focus();
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  override render() {
    if (this.items.length === 0) return nothing;
    return html`
      <div role="tablist" aria-label=${this.label}>
        ${repeat(
          this.items,
          (item) => item.key,
          (item, index) =>
            html`<button
              type="button"
              role="tab"
              data-key=${item.key}
              id=${`${this.#id}-tab-${index}`}
              aria-selected=${item.key === this.#selected}
              aria-controls=${`${this.#id}-panel-${index}`}
              tabindex=${item.key === this.#selected ? 0 : -1}
              @click=${(event: MouseEvent) => this.#select(event, item.key)}
              @keydown=${(event: KeyboardEvent) => this.#keydown(event, index)}
            >
              ${item.label}
            </button>`,
        )}
      </div>
      ${repeat(
        this.items,
        (item) => item.key,
        (item, index) =>
          html`<div
            role="tabpanel"
            id=${`${this.#id}-panel-${index}`}
            aria-labelledby=${`${this.#id}-tab-${index}`}
            tabindex="0"
            ?hidden=${item.key !== this.#selected}
          >
            <slot name=${item.key}></slot>
          </div>`,
      )}
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "wt-tabs": WtTabs;
  }
}
