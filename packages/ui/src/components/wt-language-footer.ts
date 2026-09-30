import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
import "./wt-button.js";

export interface WtLocaleOption {
  code: string;
  label: string;
}

/**
 * A page footer holding the language chooser. It sits in the page's flow, so it can never cover
 * content. It never changes the language itself: the parent sets `active` and decides what a pick
 * means.
 *
 * The options are NATIVE `<button role="menuitemradio">` elements as direct children of the
 * `role="menu"` container, so the role and `aria-checked` land on the element a screen reader
 * reaches (a `wt-button` does not forward a role or `aria-checked` to its inner button).
 */
@customElement("wt-language-footer")
export class WtLanguageFooter extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      footer {
        display: flex;
        justify-content: flex-end;
        padding-block: var(--wt-space-3) max(var(--wt-space-3), env(safe-area-inset-bottom));
        padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
      }

      .chooser {
        position: relative;
      }

      .menu {
        position: absolute;
        z-index: 1;
        bottom: calc(100% + var(--wt-space-1));
        inset-inline-end: 0;
        max-width: calc(100vw - 2 * var(--wt-space-3));
        min-width: 100%;
        padding: var(--wt-space-1);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .option {
        display: block;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-align: start;
        cursor: pointer;
      }

      .option:hover {
        background: var(--wt-color-surface-raised);
      }

      .option[aria-checked="true"] {
        border-color: var(--wt-color-border);
      }
    `,
  ];

  /** The code of the language the page is shown in. */
  @property() active = "";

  @property({ attribute: false }) loadLocales: () => Promise<WtLocaleOption[]> = async () => [
    ...SUPPORTED_LOCALES,
  ];

  @state() private open = false;

  @state() private locales?: WtLocaleOption[];

  async #toggle(): Promise<void> {
    if (!this.open && this.locales === undefined) {
      try {
        this.locales = await this.loadLocales();
      } catch {
        // Leaving `locales` unset makes the next open fetch again.
        return;
      }
    }
    this.open = !this.open;
  }

  #pick(event: Event, code: string): void {
    event.stopPropagation();
    this.open = false;
    this.dispatchEvent(
      new CustomEvent<{ code: string }>("wt-locale-selected", {
        detail: { code },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #label(code: string): string {
    return (
      this.locales?.find((l) => l.code === code)?.label ??
      SUPPORTED_LOCALES.find((l) => l.code === code)?.label ??
      code
    );
  }

  override render() {
    return html`
      <footer>
        <div class="chooser">
          <wt-button
            variant="secondary"
            data-test="lang-trigger"
            aria-haspopup="menu"
            aria-expanded=${this.open}
            @click=${() => void this.#toggle()}
          >
            ${this.#label(this.active)}
          </wt-button>
          ${
            this.open && this.locales
              ? html`<div class="menu" role="menu">
                  ${this.locales.map(
                    (l) => html`
                      <button
                        type="button"
                        class="option"
                        role="menuitemradio"
                        aria-checked=${l.code === this.active}
                        data-test=${`lang-${l.code}`}
                        @click=${(event: Event) => this.#pick(event, l.code)}
                      >
                        ${l.label}
                      </button>
                    `,
                  )}
                </div>`
              : nothing
          }
        </div>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-language-footer": WtLanguageFooter;
  }
}
