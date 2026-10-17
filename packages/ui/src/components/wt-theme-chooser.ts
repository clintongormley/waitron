import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { MenuPopover, menuPopoverStyles } from "../menu-popover.js";
import {
  THEME_CHOICES,
  THEME_SELECTED_EVENT,
  isThemeChoice,
  type ThemeChoice,
} from "../theme-choice.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-button.js";

registerIcons({
  "theme-light":
    "M8 5a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z M7.25 .5h1.5V3h-1.5Z M7.25 13h1.5v2.5h-1.5Z M.5 7.25H3v1.5H.5Z M13 7.25h2.5v1.5H13Z M11.78 10.72 13.27 12.21 12.21 13.27 10.72 11.78Z M4.22 5.28 2.73 3.79 3.79 2.73 5.28 4.22Z M11.78 5.28 13.27 3.79 12.21 2.73 10.72 4.22Z M4.22 10.72 2.73 12.21 3.79 13.27 5.28 11.78Z",
  "theme-dark": "M6.82 1.61A6.5 6.5 0 1 0 14.39 9.18A5.5 5.5 0 0 1 6.82 1.61Z",
  "theme-device":
    "M8 1a7 7 0 1 1 0 14A7 7 0 1 1 8 1Z M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z M8 2.5v11a5.5 5.5 0 0 1 0-11Z",
});

export interface WtThemeLabels {
  theme: string;
  light: string;
  dark: string;
  device: string;
}

/**
 * The theme chooser for an app's top bar. It never changes the theme itself: the parent sets
 * `active` and decides what a pick means.
 */
@customElement("wt-theme-chooser")
export class WtThemeChooser extends LitElement {
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

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** Any value other than a known choice draws as Follow device. */
  @property() active: ThemeChoice = "device";

  @property({ attribute: false }) labels: WtThemeLabels = {
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    device: "Follow device",
  };

  @state() private open = false;

  readonly #menuPopover = new MenuPopover(this, {
    trigger: () => this.#trigger(),
    close: () => this.#close(),
  });

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#close();
  }

  #toggle(): void {
    if (this.open) {
      this.#close();
      return;
    }
    this.open = true;
    this.#menuPopover.listen();
    void this.updateComplete.then(() => this.#menuPopover.focusChecked());
  }

  #close(): void {
    this.open = false;
    this.#menuPopover.unlisten();
  }

  #trigger(): HTMLElement {
    return this.renderRoot.querySelector<HTMLElement>('[data-test="theme-trigger"]')!;
  }

  #onKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    this.#menuPopover.keydown(event);
  }

  #pick(event: Event, choice: ThemeChoice): void {
    event.stopPropagation();
    this.#close();
    this.#trigger().focus();
    this.dispatchEvent(
      new CustomEvent<{ choice: ThemeChoice }>(THEME_SELECTED_EVENT, {
        detail: { choice },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const active: ThemeChoice = isThemeChoice(this.active) ? this.active : "device";
    return html`
      <div class="chooser" @keydown=${(event: KeyboardEvent) => this.#onKeydown(event)}>
        <wt-button
          variant="secondary"
          data-test="theme-trigger"
          aria-haspopup="menu"
          aria-expanded=${this.open}
          aria-label=${`${this.labels.theme}: ${this.labels[active]}`}
          @click=${() => this.#toggle()}
        >
          <wt-icon name=${`theme-${active}`} size="lg"></wt-icon>
        </wt-button>
        ${
          this.open
            ? html`<div class="menu" role="menu" popover="manual">
                ${THEME_CHOICES.map(
                  (choice) => html`
                    <button
                      type="button"
                      class="option"
                      role="menuitemradio"
                      aria-checked=${choice === active}
                      data-test=${`theme-${choice}`}
                      @click=${(event: Event) => this.#pick(event, choice)}
                    >
                      <wt-icon name=${`theme-${choice}`}></wt-icon>${this.labels[choice]}
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
    "wt-theme-chooser": WtThemeChooser;
  }
}
