import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
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

      .option.active {
        outline: var(--wt-focus-ring);
        outline-offset: calc(-1 * var(--wt-focus-offset));
      }

      .empty {
        padding: var(--wt-space-2) var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property() label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ attribute: false }) options: ComboboxOption[] = [];
  @property() noResultsLabel = "No results";
  @property() searchPlaceholder = "Search";

  @state() private expanded = false;
  @state() private search = "";
  @state() private activeIndex = -1;

  @query(".trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;
  @query(".search") private searchInput!: HTMLInputElement;

  private readonly labelId = uniqueId("wt-combobox-label");
  private readonly listboxId = uniqueId("wt-combobox-listbox");

  private get filteredOptions(): ComboboxOption[] {
    const query = this.search.trim().toLowerCase();
    if (!query) return this.options;
    return this.options.filter((option) => option.label.toLowerCase().includes(query));
  }

  private get rowCount(): number {
    return this.filteredOptions.length;
  }

  private onSearchInput(event: Event): void {
    this.search = (event.target as HTMLInputElement).value;
    this.activeIndex = this.rowCount > 0 ? 0 : -1;
  }

  private onSearchKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.rowCount - 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        return;
      case "Home":
        event.preventDefault();
        this.activeIndex = 0;
        return;
      case "End":
        event.preventDefault();
        this.activeIndex = this.rowCount - 1;
        return;
      default:
        return;
    }
  }

  private onTriggerClick(event: MouseEvent): void {
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
      this.positionPopup();
      this.searchInput.focus();
    }
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    // Left-aligned with the trigger, pulled left only far enough to keep the panel inside the
    // viewport's 8px right gutter — never pushed RIGHT of its trigger. (wt-row-actions floors this
    // at 8px instead, because its popup is RIGHT-aligned and so can compute a negative left.)
    const maxLeft = Math.max(0, innerWidth - popup.width - 8);
    this.popup.style.left = `${Math.max(0, Math.min(anchor.left, maxLeft))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
    this.popup.style.width = `${anchor.width}px`;
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
    return html`
      ${
        this.label
          ? html`<div class="label-row"><label id=${this.labelId}>${this.label}</label></div>`
          : nothing
      }
      <button
        type="button"
        class="trigger"
        aria-haspopup="listbox"
        aria-expanded=${this.expanded}
        aria-labelledby=${this.label ? this.labelId : nothing}
        popovertarget="panel"
        ?disabled=${this.disabled}
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <span class="value"></span>
        <wt-icon class="chevron" name="chevron-down"></wt-icon>
      </button>
      <div id="panel" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
        <input
          class="search"
          type="text"
          role="combobox"
          aria-expanded="true"
          placeholder=${this.searchPlaceholder}
          aria-label=${this.label || this.searchPlaceholder}
          aria-controls=${this.listboxId}
          aria-activedescendant=${
            this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : nothing
          }
          .value=${this.search}
          @input=${this.onSearchInput}
          @keydown=${this.onSearchKeydown}
        />
        <ul id=${this.listboxId} class="list" role="listbox">
          ${this.filteredOptions.map(
            (option, index) => html`
              <li
                id=${`${this.listboxId}-${index}`}
                class=${index === this.activeIndex ? "option active" : "option"}
                role="option"
                aria-selected="false"
              >
                ${option.label}
              </li>
            `,
          )}
          ${
            this.filteredOptions.length === 0
              ? html`<li class="empty" role="presentation">${this.noResultsLabel}</li>`
              : nothing
          }
        </ul>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-combobox": WtCombobox;
  }
}
