import { popupIndex } from "../popup-helpers.js";
import { css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { belongsToComposition } from "@waitron/ui-core/submit-on-enter";
import { WtInput } from "@waitron/ui-core/components/wt-input";
import { uniqueId } from "../interactive.js";

export interface AddressLookupSuggestion {
  readonly id: string;
  readonly label: string;
  readonly secondaryLabel?: string;
}

export interface AddressLookupResult {
  readonly attribution?: string;
  readonly lines: readonly string[];
  readonly locality: string;
  readonly administrativeAreaCode?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

/** The shape of `AddressAutocompleteProvider` in `@waitron/country`, declared here because this
 * package does not depend on that one; the setup app's type test holds the two together. */
export interface AddressLookupProvider {
  suggest(input: {
    readonly query: string;
    readonly countryCode: string;
    readonly sessionToken: string;
  }): Promise<readonly AddressLookupSuggestion[]>;
  resolve(input: {
    readonly suggestionId: string;
    readonly sessionToken: string;
  }): Promise<AddressLookupResult>;
}

export interface AddressChosenDetail {
  readonly address: AddressLookupResult;
}

const MIN_QUERY = 4;
const AUTOMATIC_SEARCH_LIMIT = 5;

/** `crypto.randomUUID` needs a secure context; a box reached over plain http has none. */
function sessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

@customElement("wt-address-lookup")
export class WtAddressLookup extends WtInput {
  static override styles = [
    ...WtInput.styles,
    css`
      :host([hidden]) {
        display: none !important;
      }

      .list {
        list-style: none;
        margin: var(--wt-space-1) 0 0;
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-1);
      }

      .option {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-height: var(--wt-dropdown-row-height);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        cursor: pointer;
      }

      .option:hover {
        background: var(--wt-color-bg);
      }

      .option.active {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      .secondary,
      .status {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .status {
        margin: var(--wt-space-1) 0 0;
      }

      .status:empty {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) provider?: AddressLookupProvider;
  @property({ attribute: false }) appliedAttribution?: string;
  @property({ attribute: "country-code" }) countryCode = "";
  @property({ attribute: "unavailable-label" }) unavailableLabel = "";
  /** The form's own line under the field about the last choice, e.g. why it was not copied; a new
   * search hides it until the next choice or a new message. */
  @property() message = "";
  /** How long typing must pause, in milliseconds, before the provider is asked. */
  @property({ type: Number }) delay = 600;

  @state() private suggestions: readonly AddressLookupSuggestion[] = [];
  @state() private activeIndex = -1;
  @state() private resolveFailed = false;
  @state() private messageCurrent = true;

  #generation = 0;
  /** The generation of the chosen suggestion being resolved, which leaving the field keeps. */
  #resolving?: number;
  #timer?: ReturnType<typeof setTimeout>;
  #automaticSearches = 0;
  #session = sessionToken();
  private readonly listId = uniqueId("wt-address-lookup-list");
  private readonly statusId = uniqueId("wt-address-lookup-status");

  override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (changed.has("message")) this.messageCurrent = true;
    if (
      changed.has("provider") ||
      changed.has("countryCode") ||
      changed.has("disabled") ||
      changed.has("hidden")
    )
      this.cancelSearch();
  }

  /** Drops the open list and every answer still on its way, a chosen suggestion's included; the
   * typed text stays. */
  cancelSearch(): void {
    this.#forget();
    this.#close();
    this.resolveFailed = false;
  }

  override disconnectedCallback(): void {
    this.cancelSearch();
    super.disconnectedCallback();
  }

  /** Drops any pending ask and any answer still on its way. */
  #forget(): void {
    clearTimeout(this.#timer);
    this.#generation += 1;
  }

  #close(): void {
    this.suggestions = [];
    this.activeIndex = -1;
  }

  protected override afterInput(): void {
    this.messageCurrent = false;
    this.cancelSearch();
    const query = this.value.trim();
    if (
      this.disabled ||
      this.hidden ||
      this.readonly ||
      this.provider === undefined ||
      query.length < MIN_QUERY ||
      this.#automaticSearches >= AUTOMATIC_SEARCH_LIMIT
    )
      return;
    const generation = this.#generation;
    this.#timer = setTimeout(() => {
      this.#automaticSearches += 1;
      void this.#ask(query, generation);
    }, this.delay);
  }

  async #ask(query: string, generation: number): Promise<void> {
    const provider = this.provider;
    if (provider === undefined) return;
    try {
      const found = await provider.suggest({
        query,
        countryCode: this.countryCode,
        sessionToken: this.#session,
      });
      if (generation === this.#generation && query === this.value.trim()) this.suggestions = found;
    } catch {
      // A suggestion is optional while the person types the address.
    }
  }

  async #choose(index: number): Promise<void> {
    const provider = this.provider;
    const suggestion = this.suggestions[index];
    if (provider === undefined || suggestion === undefined) return;
    this.#forget();
    const generation = this.#generation;
    const session = this.#session;
    this.#close();
    this.#resolving = generation;
    let address: AddressLookupResult;
    try {
      address = await provider.resolve({ suggestionId: suggestion.id, sessionToken: session });
    } catch {
      if (generation === this.#generation) this.resolveFailed = true;
      return;
    } finally {
      if (this.#resolving === generation) this.#resolving = undefined;
    }
    if (generation !== this.#generation) return;
    this.#session = sessionToken();
    this.resolveFailed = false;
    this.messageCurrent = true;
    this.dispatchEvent(
      new CustomEvent<AddressChosenDetail>("wt-address-chosen", {
        detail: { address },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onBlur(): void {
    if (this.#resolving !== this.#generation) this.#forget();
    this.#close();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (belongsToComposition(event)) return;
    const count = this.suggestions.length;
    if (event.key === "Enter" && this.activeIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      void this.#choose(this.activeIndex);
      return;
    }
    if (count === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = popupIndex(event.key, this.activeIndex, count)!;
    } else if (event.key === "Escape") {
      // Stopped so an Escape that closes the list does not also close a dialog around the field.
      event.preventDefault();
      event.stopPropagation();
      this.#close();
    }
  }

  private get statusLine(): string {
    return this.provider
      ? (this.messageCurrent && this.message) || (this.resolveFailed ? this.unavailableLabel : "")
      : "";
  }

  protected override get fieldDecoration() {
    if (this.provider === undefined) return undefined;
    return {
      autocomplete: "off",
      extraDescriptionIds: this.statusLine ? [this.statusId] : [],
      listbox: {
        id: this.listId,
        expanded: this.suggestions.length > 0,
        activeId: this.activeIndex >= 0 ? `${this.listId}-${this.activeIndex}` : undefined,
        onKeydown: this.onKeydown,
        onBlur: this.onBlur,
      },
    };
  }

  override render() {
    const credit = this.appliedAttribution
      ? html`<p class="status" part="attribution" role="status">${this.appliedAttribution}</p>`
      : nothing;
    return html`
      ${super.render()}
      <ul
        id=${this.listId}
        class="list"
        role="listbox"
        aria-label=${this.label}
        ?hidden=${this.suggestions.length === 0}
        @pointerdown=${(event: PointerEvent) => event.preventDefault()}
      >
        ${this.suggestions.map(
          (suggestion, index) =>
            html`<li
              id=${`${this.listId}-${index}`}
              class=${index === this.activeIndex ? "option active" : "option"}
              role="option"
              aria-selected=${index === this.activeIndex ? "true" : "false"}
              @click=${(event: MouseEvent) => {
                event.stopPropagation();
                void this.#choose(index);
              }}
            >
              <span>${suggestion.label}</span>
              ${
                suggestion.secondaryLabel
                  ? html`<span class="secondary">${suggestion.secondaryLabel}</span>`
                  : nothing
              }
            </li>`,
        )}
      </ul>
      <p id=${this.statusId} class="status" role="status">${this.statusLine || nothing}</p>
      ${credit}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-address-lookup": WtAddressLookup;
  }
}
