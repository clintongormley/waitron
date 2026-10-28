import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";

export interface AddressLookupSuggestion {
  readonly id: string;
  readonly label: string;
  readonly secondaryLabel?: string;
}

export interface AddressLookupResult {
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

const MIN_QUERY = 3;

/** `crypto.randomUUID` needs a secure context; a box reached over plain http has none. */
function sessionToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

@customElement("wt-address-lookup")
export class WtAddressLookup extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }

      /* Important, so a form that sets its fields' display cannot show an empty box. */
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
        min-height: var(--wt-tap-min);
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

      .secondary {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  /** Without one the field is hidden: the form around it is its manual fields alone. */
  @property({ attribute: false }) provider?: AddressLookupProvider;
  @property({ attribute: "country-code" }) countryCode = "";
  @property() label = "";
  @property() placeholder = "";
  @property({ attribute: "no-results-label" }) noResultsLabel = "";
  @property({ attribute: "unavailable-label" }) unavailableLabel = "";
  /** The form's own line under the field, e.g. why a chosen address was not copied. */
  @property() message = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** How long typing must pause, in milliseconds, before the provider is asked. */
  @property({ type: Number }) delay = 300;

  @state() private query = "";
  @state() private suggestions: readonly AddressLookupSuggestion[] = [];
  @state() private activeIndex = -1;
  @state() private notice: "" | "none" | "unavailable" = "";

  #generation = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #session = sessionToken();
  private readonly inputId = uniqueId("wt-address-lookup");
  private readonly listId = uniqueId("wt-address-lookup-list");
  private readonly statusId = uniqueId("wt-address-lookup-status");

  protected override willUpdate(): void {
    this.hidden = this.provider === undefined;
  }

  override disconnectedCallback(): void {
    this.#forget();
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

  private onInput(event: Event): void {
    event.stopPropagation();
    this.query = (event.target as HTMLInputElement).value;
    this.#forget();
    this.#close();
    this.notice = "";
    if (this.disabled || this.query.trim().length < MIN_QUERY) return;
    const generation = this.#generation;
    this.#timer = setTimeout(() => void this.#ask(generation), this.delay);
  }

  async #ask(generation: number): Promise<void> {
    const provider = this.provider;
    if (provider === undefined) return;
    let found: readonly AddressLookupSuggestion[];
    try {
      found = await provider.suggest({
        query: this.query.trim(),
        countryCode: this.countryCode,
        sessionToken: this.#session,
      });
    } catch {
      if (generation === this.#generation) this.notice = "unavailable";
      return;
    }
    if (generation !== this.#generation) return;
    this.suggestions = found;
    this.activeIndex = -1;
    this.notice = found.length === 0 ? "none" : "";
  }

  async #choose(index: number): Promise<void> {
    const provider = this.provider;
    const suggestion = this.suggestions[index];
    if (provider === undefined || suggestion === undefined) return;
    this.#forget();
    const generation = this.#generation;
    const session = this.#session;
    this.#close();
    let address: AddressLookupResult;
    try {
      address = await provider.resolve({ suggestionId: suggestion.id, sessionToken: session });
    } catch {
      if (generation === this.#generation) this.notice = "unavailable";
      return;
    }
    if (generation !== this.#generation) return;
    this.#session = sessionToken();
    this.query = "";
    this.notice = "";
    this.dispatchEvent(
      new CustomEvent<AddressChosenDetail>("wt-address-chosen", {
        detail: { address },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onKeydown(event: KeyboardEvent): void {
    const count = this.suggestions.length;
    if (event.key === "Enter") {
      // A form that submits on Enter skips a handled key; Enter here chooses, never submits.
      event.preventDefault();
      if (this.activeIndex >= 0) void this.#choose(this.activeIndex);
      return;
    }
    if (count === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.activeIndex =
        this.activeIndex < 0 && step < 0 ? count - 1 : (this.activeIndex + step + count) % count;
    } else if (event.key === "Escape") {
      // Stopped so an Escape that closes the list does not also close a dialog around the field.
      event.preventDefault();
      event.stopPropagation();
      this.#close();
    }
  }

  override render() {
    const open = this.suggestions.length > 0;
    const line =
      this.message ||
      (this.notice === "none"
        ? this.noResultsLabel
        : this.notice === "unavailable"
          ? this.unavailableLabel
          : "");
    return html`
      <div
        class="field"
        part="field"
        data-label=${fieldLabelState({
          value: this.query,
          hint: "",
          placeholder: this.placeholder,
          type: "text",
        })}
        ?data-disabled=${this.disabled}
      >
        ${this.label ? fieldLabel(this.inputId, this.label, false) : nothing}
        <input
          class="field-control"
          id=${this.inputId}
          name="address-search"
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded=${open ? "true" : "false"}
          aria-controls=${this.listId}
          aria-activedescendant=${
            this.activeIndex >= 0 ? `${this.listId}-${this.activeIndex}` : nothing
          }
          aria-describedby=${line ? this.statusId : nothing}
          placeholder=${this.placeholder || nothing}
          ?disabled=${this.disabled}
          .value=${this.query}
          @input=${this.onInput}
          @keydown=${this.onKeydown}
          @blur=${() => this.#close()}
        />
      </div>
      <ul
        id=${this.listId}
        class="list"
        role="listbox"
        aria-label=${this.label || nothing}
        ?hidden=${!open}
        @pointerdown=${(event: PointerEvent) => event.preventDefault()}
      >
        ${this.suggestions.map(
          (suggestion, index) =>
            html`<li
              id=${`${this.listId}-${index}`}
              class=${index === this.activeIndex ? "option active" : "option"}
              role="option"
              aria-selected=${index === this.activeIndex ? "true" : "false"}
              @click=${() => void this.#choose(index)}
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
      ${line ? html`<p id=${this.statusId} class="hint" role="status">${line}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-address-lookup": WtAddressLookup;
  }
}
