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
    `,
  ];

  @property() label = "";
  @property({ type: Boolean, reflect: true }) disabled = false;

  @state() private expanded = false;

  @query(".trigger") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  private readonly labelId = uniqueId("wt-combobox-label");

  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.disabled) return;
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
    } else {
      // Opening synchronously makes its dimensions available before the first paint.
      this.popup.showPopover();
      this.positionPopup();
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
      <div id="panel" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-combobox": WtCombobox;
  }
}
