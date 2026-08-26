import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/** One offered language: a BCP-47 code and its own-language display label (the `getLocales` element). */
interface Locale {
  code: string;
  label: string;
}

/**
 * The till's LANGUAGE CHOOSER: a collapsed trigger showing the current language which, on activation,
 * fetches the offered languages and shows them as a menu; picking one emits a composed, bubbling
 * `locale-selected` carrying only the chosen `code`.
 *
 * It is PRESENTATIONAL and lazy: it holds no store, calls no write API, and — crucially — invokes
 * NEITHER `setLocale` NOR the preference-write endpoint. The parent (a later task) owns what a pick
 * means, turning the event into a `setLocale` + a preference write. The list is fetched through the
 * injected `loadLocales` (the app adapts `TillApi.getLocales`), and ONCE: the first open caches it, so
 * re-opening never re-fetches. It reads {@link currentLocale} to mark the active option and carries a
 * {@link LocaleChangeController} so the trigger label follows a live switch made elsewhere.
 *
 * Until the list is fetched the trigger falls back to the raw active code (labels are unknown before
 * the first open); once loaded it reads the active locale's own-language label.
 *
 * Accessibility: the trigger (a `wt-button`) carries `aria-haspopup="menu"` + `aria-expanded`; the
 * options are NATIVE `<button role="menuitemradio">` elements — the real focusable nodes — as DIRECT
 * children of the `role="menu"` container, so the role + `aria-checked` state land on the element the
 * screen reader actually reaches (a `wt-button` forwards only `disabled`/`aria-label` to its inner
 * button, so role/state on a `wt-button` host would be lost). Keyboard nav beyond Tab (arrow keys,
 * Escape, click-away) is a later task's concern.
 */
@customElement("till-language-chooser")
export class LanguageChooser extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }

      .menu {
        position: absolute;
        z-index: 1;
        margin-top: var(--wt-space-1);
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

  /** Fetch the offered languages. The app injects an adapter over `TillApi.getLocales`; the widget
   * calls it at most once (see {@link locales}). */
  @property({ attribute: false }) loadLocales!: () => Promise<Locale[]>;

  /** Whether the options menu is showing. */
  @state() private open = false;

  /** The fetched list, cached after the first open (`undefined` = never fetched yet). */
  @state() private locales?: Locale[];

  constructor() {
    super();
    // Reflect a locale switch made elsewhere on the trigger label + the active mark, live.
    new LocaleChangeController(this);
  }

  /** Toggle the menu, fetching the list the first time it opens (and never again). */
  async #toggle(): Promise<void> {
    if (!this.open && this.locales === undefined) this.locales = await this.loadLocales();
    this.open = !this.open;
  }

  /** Close the menu and ask the parent to switch to `code` — the widget does not switch it itself. */
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

  /** The display label for `code`, or the bare code when the list is not yet fetched / lacks it. */
  #label(code: string): string {
    return this.locales?.find((l) => l.code === code)?.label ?? code;
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
