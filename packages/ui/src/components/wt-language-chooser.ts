import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { MenuPopover, menuPopoverStyles } from "../menu-popover.js";
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
 *
 * `layout="group"` draws the languages as a labelled row of pressed-state buttons instead, for a
 * menu that already holds it; it loads them as soon as it joins the page, and shows only the
 * active language until they arrive.
 */
@customElement("wt-language-chooser")
export class WtLanguageChooser extends LitElement {
  static override styles = [
    baseStyles,
    menuPopoverStyles,
    css`
      :host {
        display: inline-block;
      }

      .chooser {
        display: flex;
      }

      .code {
        display: none;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }

      :host([layout="group"]) {
        display: block;
      }

      .group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
        padding-inline-start: var(--wt-space-4);
      }

      .group-label {
        flex: 1;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .choice {
        box-sizing: border-box;
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .choice:hover {
        border-color: var(--wt-color-primary-text);
      }
      .choice[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      .choice:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  /** The code of the language the page is shown in. */
  @property() active = "";

  /** `menu`: a trigger and a pop-up. `group`: the choices in a row, for inside another menu. */
  @property({ reflect: true }) layout: "menu" | "group" = "menu";

  /** The group's visible name, in `group` layout. */
  @property() label = "";

  @property({ attribute: false }) loadLocales: () => Promise<WtLocaleOption[]> = async () => [
    ...SUPPORTED_LOCALES,
  ];

  @state() private open = false;

  @state() private locales?: WtLocaleOption[];

  #loading?: Promise<void>;

  #groupLoading = false;

  /**
   * Set by a press while a load is pending; any close clears it, so an outside press or focus, or
   * Escape, stops the menu opening (and taking focus) when the load arrives.
   */
  #openWhenLoaded = false;

  readonly #menuPopover = new MenuPopover(this, {
    trigger: () => this.#trigger(),
    close: () => this.#close(),
  });

  override connectedCallback(): void {
    super.connectedCallback();
    this.#loadGroup();
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("layout")) this.#loadGroup();
  }

  #loadGroup(): void {
    if (this.layout !== "group") return;
    if (this.locales !== undefined || this.#groupLoading) return;
    this.#groupLoading = true;
    void this.#load().then(() => {
      this.#groupLoading = false;
    });
  }

  #choose(code: string): void {
    this.dispatchEvent(
      new CustomEvent<{ code: string }>("wt-locale-selected", {
        detail: { code },
        bubbles: true,
        composed: true,
      }),
    );
  }

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
    this.#menuPopover.listen();
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
    this.#menuPopover.listen();
    void this.updateComplete.then(() => this.#menuPopover.focusChecked());
  }

  #close(): void {
    this.open = false;
    this.#openWhenLoaded = false;
    this.#menuPopover.unlisten();
  }

  #trigger(): HTMLElement {
    return this.renderRoot.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
  }

  #onKeydown(event: KeyboardEvent): void {
    if (!this.open && !this.#openWhenLoaded) return;
    this.#menuPopover.keydown(event);
  }

  #pick(event: Event, code: string): void {
    event.stopPropagation();
    this.#close();
    this.#trigger().focus();
    this.#choose(code);
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

  #renderGroup() {
    const choices = this.locales ?? [{ code: this.active, label: this.#label(this.active) }];
    return html`<div class="group" role="group" aria-labelledby="group-label">
      <span id="group-label" class="group-label">${this.label}</span>
      ${choices.map(
        (l) =>
          html`<button
            type="button"
            class="choice"
            aria-pressed=${String(l.code === this.active)}
            data-test=${`lang-${l.code}`}
            @click=${() => this.#choose(l.code)}
          >
            ${l.label}
          </button>`,
      )}
    </div>`;
  }

  override render() {
    if (this.layout === "group") return this.#renderGroup();
    const label = this.#label(this.active);
    // The full name sits inside the code part as visually hidden text, so it is read only while the
    // code is drawn and the drawn code stays in the name (WCAG 2.5.3).
    return html`
      <div class="chooser" @keydown=${(event: KeyboardEvent) => this.#onKeydown(event)}>
        <wt-button
          variant="secondary"
          data-test="lang-trigger"
          aria-haspopup="menu"
          aria-expanded=${this.open}
          @click=${() => this.#toggle()}
        >
          <span class="name" part="name">${label}</span>
          <span class="code" part="code"
            ><span class="code-text">${this.#shortCode(this.active)}</span
            ><span class="visually-hidden"> ${label}</span></span
          >
        </wt-button>
        ${
          this.open && this.locales
            ? html`<div class="menu" role="menu" popover="manual">
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
