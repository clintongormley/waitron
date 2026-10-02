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
 * The language chooser for an app's top bar. It never changes the language itself: the parent
 * sets `active` and decides what a pick means.
 *
 * The trigger draws the full name (`part="name"`) and the short code (`part="code"`, hidden). An
 * app swaps them at phone width with its own `::part()` rules, because a primitive here may hold no
 * literal breakpoint and a media query cannot read a token.
 *
 * The options are NATIVE `<button role="menuitemradio">` elements as direct children of the
 * `role="menu"` container, so the role and `aria-checked` land on the element a screen reader
 * reaches (a `wt-button` does not forward a role or `aria-checked` to its inner button).
 */
@customElement("wt-language-chooser")
export class WtLanguageChooser extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }

      .chooser {
        position: relative;
        display: flex;
      }

      .code {
        display: none;
      }

      .menu {
        position: absolute;
        z-index: 1;
        top: calc(100% + var(--wt-space-1));
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

  #loading?: Promise<void>;

  /**
   * Set by a press while a load is pending; any close clears it, so an outside press or focus, or
   * Escape, stops the menu opening (and taking focus) when the load arrives.
   */
  #openWhenLoaded = false;

  #listening = false;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#close();
  }

  #toggle(): void {
    if (this.open || this.#openWhenLoaded) {
      this.#close();
      return;
    }
    if (this.locales !== undefined) {
      this.#show();
      return;
    }
    this.#openWhenLoaded = true;
    this.#listen();
    if (this.#loading !== undefined) return;
    this.#loading = this.#load().then(() => {
      this.#loading = undefined;
      if (!this.#openWhenLoaded) return;
      if (this.locales === undefined) this.#close();
      else this.#show();
    });
  }

  async #load(): Promise<void> {
    try {
      this.locales = await this.loadLocales();
    } catch {
      // Leaving `locales` unset makes the next open fetch again.
    }
  }

  #show(): void {
    this.#openWhenLoaded = false;
    this.open = true;
    this.#listen();
    void this.updateComplete.then(() => {
      const options = this.#options();
      (options.find((o) => o.getAttribute("aria-checked") === "true") ?? options[0])?.focus();
    });
  }

  #close(): void {
    this.open = false;
    this.#openWhenLoaded = false;
    if (!this.#listening) return;
    this.#listening = false;
    document.removeEventListener("pointerdown", this.#onOutside, true);
    document.removeEventListener("focusin", this.#onOutside);
  }

  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointerdown", this.#onOutside, true);
    document.addEventListener("focusin", this.#onOutside);
  }

  #onOutside = (event: Event): void => {
    if (!event.composedPath().includes(this)) this.#close();
  };

  #options(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  }

  #trigger(): HTMLElement {
    return this.renderRoot.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
  }

  #onKeydown(event: KeyboardEvent): void {
    if (!this.open && !this.#openWhenLoaded) return;
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.#close();
      this.#trigger().focus();
      return;
    }
    const options = this.#options();
    const at = options.indexOf(event.target as HTMLElement);
    if (at === -1) return;
    const last = options.length - 1;
    let to: number;
    switch (event.key) {
      case "ArrowDown":
        to = at === last ? 0 : at + 1;
        break;
      case "ArrowUp":
        to = at === 0 ? last : at - 1;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    options[to]!.focus();
  }

  #pick(event: Event, code: string): void {
    event.stopPropagation();
    this.#close();
    this.#trigger().focus();
    this.dispatchEvent(
      new CustomEvent<{ code: string }>("wt-locale-selected", {
        detail: { code },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #shortCode(code: string): string {
    return code.split("-")[0]!.toUpperCase();
  }

  #label(code: string): string {
    return (
      this.locales?.find((l) => l.code === code)?.label ??
      SUPPORTED_LOCALES.find((l) => l.code === code)?.label ??
      code
    );
  }

  override render() {
    const label = this.#label(this.active);
    return html`
      <div class="chooser" @keydown=${(event: KeyboardEvent) => this.#onKeydown(event)}>
        <wt-button
          variant="secondary"
          data-test="lang-trigger"
          aria-label=${label}
          aria-haspopup="menu"
          aria-expanded=${this.open}
          @click=${() => this.#toggle()}
        >
          <span class="name" part="name">${label}</span>
          <span class="code" part="code" aria-hidden="true">${this.#shortCode(this.active)}</span>
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-language-chooser": WtLanguageChooser;
  }
}
