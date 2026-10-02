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
        display: flex;
      }

      .code {
        display: none;
      }

      /* In the top layer, so no positioned content later in the page can paint over it. A manual
         popover, because the chooser's own outside-press and Escape handling decide when it closes. */
      .menu {
        position: fixed;
        inset: auto;
        margin: 0;
        margin-block-start: var(--wt-space-1);
        padding: var(--wt-space-1);
        flex-direction: column;
        gap: var(--wt-space-1);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        box-shadow: var(--wt-shadow-2);
      }

      .menu:popover-open {
        display: flex;
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

  #scrollTargets: EventTarget[] = [];

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#close();
  }

  /** Shown and placed in the same update that draws the menu: placed any later, its first frame is not. */
  override updated(): void {
    const menu = this.#menu();
    if (menu === null) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    this.#place();
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
    for (const target of this.#scrollTargets.splice(0)) {
      target.removeEventListener("scroll", this.#place, true);
    }
    window.removeEventListener("resize", this.#place);
  }

  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointerdown", this.#onOutside, true);
    document.addEventListener("focusin", this.#onOutside);
    // A scroll event does not leave its shadow root, so each root between here and the document
    // is listened on as well as the window.
    this.#scrollTargets = [window];
    for (
      let root = this.getRootNode();
      root instanceof ShadowRoot;
      root = root.host.getRootNode()
    ) {
      this.#scrollTargets.push(root);
    }
    for (const target of this.#scrollTargets) target.addEventListener("scroll", this.#place, true);
    window.addEventListener("resize", this.#place);
  }

  /** Below the trigger, trailing edges aligned, and 8px clear of both sides of the viewport. */
  #place = (): void => {
    const menu = this.#menu();
    if (menu === null) return;
    const trigger = this.#trigger().getBoundingClientRect();
    // A popover's default fit-content width would be measured against the left written by the
    // previous placement, so after a resize the labels would wrap into the room that left allows.
    menu.style.width = "max-content";
    menu.style.minWidth = `${trigger.width}px`;
    // From clientWidth rather than 100vw, which counts a scrollbar the clamp below must not.
    const room = document.documentElement.clientWidth;
    menu.style.maxWidth = `${room - 16}px`;
    menu.style.top = `${trigger.bottom}px`;
    const width = menu.getBoundingClientRect().width;
    const wanted =
      getComputedStyle(this).direction === "rtl" ? trigger.left : trigger.right - width;
    menu.style.left = `${Math.max(8, Math.min(wanted, room - width - 8))}px`;
  };

  #menu(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('[role="menu"]');
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
