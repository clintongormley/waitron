import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import { currentLocale } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

interface Locale {
  code: string;
  label: string;
}

/**
 * PRESENTATIONAL: it invokes NEITHER `setLocale` NOR the preference-write endpoint; the parent owns what
 * a pick means. The options are NATIVE `<button role="menuitemradio">` elements, not `wt-button`s, so
 * the role and `aria-checked` land on the element the screen reader reaches: `wt-button` forwards
 * neither to its inner button.
 */
@customElement("till-language-chooser")
export class LanguageChooser extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
        position: fixed;
        right: max(var(--wt-space-3), env(safe-area-inset-right));
        bottom: max(var(--wt-space-3), env(safe-area-inset-bottom));
        z-index: 10;
      }

      .menu {
        position: absolute;
        z-index: 1;
        bottom: calc(100% + var(--wt-space-1));
        right: 0;
        max-width: calc(100vw - 2 * var(--wt-space-3));
        padding: var(--wt-space-1);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 100%;
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

  @property({ attribute: false }) loadLocales!: () => Promise<Locale[]>;

  @state() private open = false;

  @state() private locales?: Locale[];

  constructor() {
    super();
    // Reflect a locale switch made elsewhere on the trigger label + the active mark, live.
    new LocaleChangeController(this);
  }

  /** A failed fetch is caught, not left as an unhandled rejection (the click handler fires `void
   * #toggle()`): the list stays unset and the menu closed, so a later open retries. */
  async #toggle(): Promise<void> {
    if (!this.open && this.locales === undefined) {
      try {
        this.locales = await this.loadLocales();
      } catch {
        return;
      }
    }
    this.open = !this.open;
  }

  #pick(code: string): void {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent<{ code: string }>("locale-selected", {
        detail: { code },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Fetched labels override the bundled names; unknown codes remain identifiable. */
  #label(code: string): string {
    return (
      this.locales?.find((l) => l.code === code)?.label ??
      SUPPORTED_LOCALES.find((l) => l.code === code)?.label ??
      code
    );
  }

  override render() {
    const active = currentLocale();
    return html`
      <wt-button
        variant="secondary"
        data-test="lang-trigger"
        aria-haspopup="menu"
        aria-expanded=${this.open}
        @click=${() => void this.#toggle()}
      >
        ${this.#label(active)}
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
                    aria-checked=${l.code === active}
                    data-test=${`lang-${l.code}`}
                    @click=${() => this.#pick(l.code)}
                  >
                    ${l.label}
                  </button>
                `,
              )}
            </div>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-language-chooser": LanguageChooser;
  }
}
