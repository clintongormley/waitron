import { LitElement, css, html, nothing, type PropertyValues } from "lit";
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
    `,
  ];

  /** Without one the field is hidden: the form around it is its manual fields alone. */
  @property({ attribute: false }) provider?: AddressLookupProvider;
  @property({ attribute: "country-code" }) countryCode = "";
  @property() label = "";
  @property() name = "";
  @property() placeholder = "";
  @property({ attribute: "no-results-label" }) noResultsLabel = "";
  @property({ attribute: "unavailable-label" }) unavailableLabel = "";
  /** The form's own line under the field about the last choice, e.g. why it was not copied; a new
   * search hides it until the next choice or a new message. */
  @property() message = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** How long typing must pause, in milliseconds, before the provider is asked. */
  @property({ type: Number }) delay = 300;

  @state() private query = "";
  @state() private suggestions: readonly AddressLookupSuggestion[] = [];
  @state() private activeIndex = -1;
  @state() private notice: "" | "none" | "unavailable" = "";

  #generation = 0;
  /** The generation of the chosen suggestion being resolved, which leaving the field keeps. */
  #resolving?: number;
  #messageCurrent = true;
  #timer?: ReturnType<typeof setTimeout>;
  #session = sessionToken();
  private readonly inputId = uniqueId("wt-address-lookup");
  private readonly listId = uniqueId("wt-address-lookup-list");
  private readonly statusId = uniqueId("wt-address-lookup-status");

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.hidden = this.provider === undefined;
    if (changed.has("message")) this.#messageCurrent = true;
    if (changed.has("provider") || changed.has("countryCode") || changed.has("disabled"))
      this.cancelSearch();
  }

  /** Drops the open list and every answer still on its way, a chosen suggestion's included; the
   * typed text stays. */
  cancelSearch(): void {
    this.#forget();
    this.#close();
    this.notice = "";
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
    this.#messageCurrent = false;
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
    this.#resolving = generation;
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
    this.#messageCurrent = true;
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
    const count = this.suggestions.length;
    if (event.key === "Enter") {
      // A form that submits on Enter skips a handled key; Enter here chooses, never submits.
      event.preventDefault();
      if (this.activeIndex >= 0) {
        event.stopPropagation();
        void this.#choose(this.activeIndex);
      }
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
      (this.#messageCurrent && this.message) ||
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
        ${fieldLabel(this.inputId, this.label, false)}
        <input
          class="field-control"
          id=${this.inputId}
          name=${this.name || nothing}
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
          placeholder=${this.placeholder}
          ?disabled=${this.disabled}
          .value=${this.query}
          @input=${this.onInput}
          @keydown=${this.onKeydown}
          @blur=${this.onBlur}
        />
      </div>
      <ul
        id=${this.listId}
        class="list"
        role="listbox"
        aria-label=${this.label}
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
      ${line ? html`<p id=${this.statusId} class="status" role="status">${line}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-address-lookup": WtAddressLookup;
  }
}
