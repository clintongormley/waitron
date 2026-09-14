import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface ComboboxOption {
  value: string;
  label: string;
}

@customElement("wt-combobox")
export class WtCombobox extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .label-row {
        display: flex;
        align-items: center;
        margin-bottom: var(--wt-space-1);
      }

      label {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      .trigger:disabled {
        ${disabledStyles}
      }

      /* nowrap comes from text-wrap here because no-hardcoded-chrome.test.ts's keyword-colour scan
         rejects the older shorthand, whose property name begins with a colour keyword. */
      .value {
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
      }

      .value.placeholder {
        color: var(--wt-color-text-muted);
      }

      .chevron {
        flex: none;
      }

      [popover] {
        position: fixed;
        margin: 0;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }

      .search {
        width: 100%;
        min-height: var(--wt-tap-min);
        margin-bottom: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font: inherit;
      }

      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: min(60vh, calc(var(--wt-tap-min) * 6));
        overflow-y: auto;
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        cursor: pointer;
      }

      /* --wt-color-bg, not --wt-color-surface-raised: raised equals the panel's own surface in the
         light theme, so it would be invisible. --wt-color-bg is the tone the search box already
         sits on, distinct in both themes. Hover adds background; .active adds an outline — the two
         compose. */
      .option:hover {
        background: var(--wt-color-bg);
      }

      .option.active {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      /* A picture of the row's own aria-selected, never a control: an interactive checkbox inside
         role="option" is an axe nested-interactive violation, which aria-hidden does not neutralise. */
      .check {
        flex: none;
        width: var(--wt-font-size-md);
        height: var(--wt-font-size-md);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
      }

      .check.checked {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
      }

      .check.checked::after {
        content: "";
        display: block;
        width: 30%;
        height: 55%;
        margin: 8% auto;
        border-inline-end: 1px solid var(--wt-color-on-primary);
        border-block-end: 1px solid var(--wt-color-on-primary);
        transform: rotate(45deg);
      }

      .empty {
        padding: var(--wt-space-2) var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .add {
        padding: var(--wt-space-2) var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }

      .trigger[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }

      .required,
      .error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property() label = "";
  /** The trigger's DOM `id` and `name`, exactly as `wt-input` uses theirs, so a named field gets a
      stable semantic id instead of a generated one. It is NOT a native form association — no
      primitive in this design system has one (design-system.md → Forms). */
  @property() name = "";
  // wt-button and wt-dialog forward the host's own aria-label the same way: it is the accessible
  // name whenever there is no visible `label` to point aria-labelledby at.
  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @property() error = "";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ attribute: false }) options: ComboboxOption[] = [];
  @property() noResultsLabel = "No results";
  @property() searchPlaceholder = "Search";
  @property({ type: Boolean, reflect: true }) multiple = false;
  @property() value = "";
  @property({ attribute: false }) values: string[] = [];
  @property() placeholder = "";
  @property({ attribute: false }) countLabel: (count: number) => string = (count) =>
    `${count} selected`;
  @property({ type: Boolean, reflect: true, attribute: "allow-add" }) allowAdd = false;
  @property({ attribute: false }) addLabel: (text: string) => string = (text) => `Add '${text}'`;

  @state() private expanded = false;
  @state() private search = "";
  @state() private activeIndex = -1;

  @query(".trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;
  @query(".search") private searchInput!: HTMLInputElement;

  // An unnamed combobox has no semantic id to give its trigger, so the label's `for` points at a
  // generated one instead.
  private readonly generatedTriggerId = uniqueId("wt-combobox-trigger");
  private readonly labelId = uniqueId("wt-combobox-label");
  private readonly listboxId = uniqueId("wt-combobox-listbox");
  private readonly errorId = uniqueId("wt-combobox-error");

  private get filteredOptions(): ComboboxOption[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.options;
    return this.options.filter((option) => option.label.toLowerCase().includes(query));
  }

  private get trimmedSearch(): string {
    return this.search.trim();
  }

  /** The add row offers only what no existing option already is, matched on the whole label. */
  private get showAddRow(): boolean {
    if (!this.allowAdd || !this.trimmedSearch) return false;
    const query = this.trimmedSearch.toLowerCase();
    return !this.options.some((option) => option.label.toLowerCase() === query);
  }

  /** Keyboard navigation counts the add row as the last row, after the filtered options. */
  private get rowCount(): number {
    return this.filteredOptions.length + (this.showAddRow ? 1 : 0);
  }

  private isSelected(optionValue: string): boolean {
    return this.multiple ? this.values.includes(optionValue) : this.value === optionValue;
  }

  /** The closed-state trigger text: the chosen label, or a count once more than one is chosen. */
  private get selectedText(): string {
    if (this.multiple) {
      if (this.values.length === 0) return "";
      if (this.values.length === 1) {
        return this.options.find((o) => o.value === this.values[0])?.label ?? "";
      }
      return this.countLabel(this.values.length);
    }
    // An empty value means nothing is selected, so an option whose own value is "" never displaces
    // the placeholder.
    if (this.value === "") return "";
    return this.options.find((o) => o.value === this.value)?.label ?? "";
  }

  // Hiding the panel does NOT move focus out of the search box. Measured in Chromium 2026-09-13:
  // after hidePopover() has set display: none, shadowRoot.activeElement is still .search, and the
  // next keydown is delivered there before the browser reconciles focus. So closing the panel in
  // updated() does not by itself stop a disabled control being changed by keyboard — this guard
  // does, and the "disabling an open panel" test goes red without it.
  private commitSelection(optionValue: string, sourceEvent: Event): void {
    if (this.disabled) return;
    if (this.multiple) {
      this.values = this.values.includes(optionValue)
        ? this.values.filter((v) => v !== optionValue)
        : [...this.values, optionValue];
      dispatchWtChange(this, sourceEvent, { values: this.values });
    } else {
      this.value = optionValue;
      dispatchWtChange(this, sourceEvent, { value: this.value });
      this.closeAndReturnFocus();
    }
  }

  /** Announces the typed text; creating the option is the consumer's, never this component's. */
  // Guarded for the same measured reason as commitSelection: the hidden panel keeps keyboard focus.
  private addNew(sourceEvent: Event): void {
    if (this.disabled) return;
    sourceEvent.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-combobox-add", {
        detail: { text: this.trimmedSearch },
        bubbles: true,
        composed: true,
      }),
    );
    if (!this.multiple) this.closeAndReturnFocus();
  }

  private closeAndReturnFocus(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
    this.trigger.focus();
  }

  private onSearchInput(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
    this.activeIndex = this.rowCount > 0 ? 0 : -1;
  }

  /** The list scrolls, so a moved active row has to be brought back into view once Lit has drawn it. */
  private async scrollActiveIntoView(): Promise<void> {
    await this.updateComplete;
    if (this.activeIndex < 0) return;
    this.shadowRoot
      ?.getElementById(`${this.listboxId}-${this.activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  private async onSearchKeydown(event: KeyboardEvent): Promise<void> {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.rowCount - 1);
        await this.scrollActiveIntoView();
        return;
      case "ArrowUp":
        event.preventDefault();
        this.activeIndex = this.rowCount > 0 ? Math.max(this.activeIndex - 1, 0) : -1;
        await this.scrollActiveIntoView();
        return;
      case "Home":
        event.preventDefault();
        this.activeIndex = this.rowCount > 0 ? 0 : -1;
        await this.scrollActiveIntoView();
        return;
      case "End":
        event.preventDefault();
        this.activeIndex = this.rowCount - 1;
        await this.scrollActiveIntoView();
        return;
      case "Enter": {
        event.preventDefault();
        const options = this.filteredOptions;
        if (this.activeIndex >= 0 && this.activeIndex < options.length) {
          this.commitSelection(options[this.activeIndex].value, event);
        } else if (this.activeIndex === options.length && this.showAddRow) {
          this.addNew(event);
        }
        return;
      }
      default:
        return;
    }
  }

  private async onTriggerClick(event: MouseEvent): Promise<void> {
    event.preventDefault();
    if (this.disabled) return;
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
    } else {
      this.search = "";
      // No row is active until the user navigates, so a reopened panel neither announces a stale
      // row through aria-activedescendant nor makes the first arrow press skip the first option.
      this.activeIndex = -1;
      // Opening synchronously makes its dimensions available before the first paint.
      this.popup.showPopover();
      this.searchInput.focus();
      // Clearing the search changes which rows the panel holds, so it has to be measured against
      // the rendered list rather than the one the previous filter left behind. The await resolves
      // on a microtask, still ahead of the frame this click paints — pinned by the test named
      // "positions the popup against the trigger before the first painted frame".
      await this.updateComplete;
      this.positionPopup();
    }
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    // The width is applied before the panel is measured: it changes how the labels wrap, and so the
    // height the vertical clamp below depends on.
    this.popup.style.width = `${anchor.width}px`;
    const popup = this.popup.getBoundingClientRect();
    // Left-aligned with the trigger, pulled left only far enough to keep the panel inside the
    // viewport's 8px right gutter — never pushed RIGHT of its trigger. (wt-row-actions floors this
    // at 8px instead, because its popup is RIGHT-aligned and so can compute a negative left.)
    const maxLeft = Math.max(0, innerWidth - popup.width - 8);
    this.popup.style.left = `${Math.max(0, Math.min(anchor.left, maxLeft))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
  }

  override updated(changed: PropertyValues<this>): void {
    // Disabling only stops the trigger, so a panel already open stays on screen and usable. Closing
    // it here takes the whole interaction away at once; commitSelection and addNew refuse
    // separately, because hiding the panel leaves keyboard focus behind in it (see their comment).
    if (changed.has("disabled") && this.disabled && this.popup?.matches(":popover-open")) {
      this.popup.hidePopover();
    }
  }

  private onToggle(event: ToggleEvent): void {
    this.expanded = event.newState === "open";
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || !this.popup.matches(":popover-open"))
      return;
    event.preventDefault();
    event.stopPropagation();
    this.popup.hidePopover();
    this.trigger.focus();
  }

  override render() {
    const triggerId = this.name || this.generatedTriggerId;
    return html`
      ${
        this.label
          ? html`<div class="label-row">
              <label id=${this.labelId} for=${triggerId}
                >${this.label}${
                  this.required
                    ? html`<span class="required" data-required aria-hidden="true">*</span>`
                    : nothing
                }</label
              >
            </div>`
          : nothing
      }
      <button
        type="button"
        id=${triggerId}
        name=${this.name || nothing}
        class="trigger"
        aria-haspopup="listbox"
        aria-expanded=${this.expanded}
        aria-labelledby=${this.label ? this.labelId : nothing}
        aria-label=${!this.label && this.ariaLabel ? this.ariaLabel : nothing}
        aria-invalid=${this.invalid || this.error !== ""}
        aria-describedby=${this.error !== "" ? this.errorId : nothing}
        popovertarget="panel"
        ?disabled=${this.disabled}
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <span class=${this.selectedText ? "value" : "value placeholder"}>
          ${this.selectedText || this.placeholder}
        </span>
        <wt-icon class="chevron" name="chevron-down"></wt-icon>
      </button>
      <div id="panel" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
        <input
          class="search"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-required=${this.required}
          placeholder=${this.searchPlaceholder}
          aria-label=${this.label || this.ariaLabel || this.searchPlaceholder}
          aria-controls=${this.listboxId}
          aria-activedescendant=${
            this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : nothing
          }
          .value=${this.search}
          @input=${this.onSearchInput}
          @keydown=${this.onSearchKeydown}
        />
        <ul id=${this.listboxId} class="list" role="listbox" aria-multiselectable=${this.multiple}>
          ${this.filteredOptions.map(
            (option, index) => html`
              <li
                id=${`${this.listboxId}-${index}`}
                class=${index === this.activeIndex ? "option active" : "option"}
                role="option"
                aria-selected=${this.isSelected(option.value)}
                @click=${(event: MouseEvent) => {
                  this.activeIndex = index;
                  this.commitSelection(option.value, event);
                }}
              >
                ${
                  this.multiple
                    ? html`<span
                        class=${this.isSelected(option.value) ? "check checked" : "check"}
                        aria-hidden="true"
                      ></span>`
                    : nothing
                }
                <span>${option.label}</span>
              </li>
            `,
          )}
          ${
            this.showAddRow
              ? html`
                  <li
                    id=${`${this.listboxId}-${this.filteredOptions.length}`}
                    class=${
                      this.filteredOptions.length === this.activeIndex
                        ? "option add active"
                        : "option add"
                    }
                    role="option"
                    aria-selected="false"
                    @click=${(event: MouseEvent) => {
                      this.activeIndex = this.filteredOptions.length;
                      this.addNew(event);
                    }}
                  >
                    ${this.addLabel(this.trimmedSearch)}
                  </li>
                `
              : nothing
          }
        </ul>
        ${
          // Outside the listbox, not a row inside it: a role="presentation" child is not one of the
          // children role="listbox" requires, which axe reports as aria-required-children.
          this.filteredOptions.length === 0 && !this.showAddRow
            ? html`<div class="empty">${this.noResultsLabel}</div>`
            : nothing
        }
      </div>
      ${
        this.error !== ""
          ? html`<p id=${this.errorId} class="error" data-error>${this.error}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-combobox": WtCombobox;
  }
}
