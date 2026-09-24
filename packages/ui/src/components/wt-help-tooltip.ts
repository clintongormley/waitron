import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

@customElement("wt-help-tooltip")
export class WtHelpTooltip extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        vertical-align: middle;
      }

      button {
        display: inline-grid;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text-muted);
        cursor: pointer;
        place-items: center;
      }

      button:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .icon {
        display: inline-grid;
        width: calc(var(--wt-space-6) - var(--wt-space-2));
        height: calc(var(--wt-space-6) - var(--wt-space-2));
        border: 1px solid currentColor;
        border-radius: var(--wt-radius-full);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        place-items: center;
      }

      /* Fixed, because positionTooltip writes viewport coordinates onto it. */
      [popover] {
        position: fixed;
        margin: 0;
        max-width: var(--wt-dialog-max-width);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
    `,
  ];

  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;
  @state() private open = false;

  private readonly tooltipId = uniqueId("wt-help-tooltip");

  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  private onToggle(event: ToggleEvent): void {
    this.open = event.newState === "open";
    if (this.open) {
      document.addEventListener("keydown", this.onDocumentKeydown, { capture: true });
    } else {
      document.removeEventListener("keydown", this.onDocumentKeydown, { capture: true });
    }
  }

  override disconnectedCallback(): void {
    document.removeEventListener("keydown", this.onDocumentKeydown, { capture: true });
    super.disconnectedCallback();
  }

  private onTriggerClick(event: MouseEvent): void {
    // `popovertarget` makes this button the declared invoker, which exempts it from light-dismiss;
    // otherwise a trusted click closes the popover before this handler runs, and it reopens it. Being
    // an invoker also gives the click a native toggle of its own, suppressed here.
    event.preventDefault();
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
      return;
    }
    // Show synchronously so the box has real dimensions to position against before the first paint.
    this.popup.showPopover();
    this.positionTooltip();
  }

  /** Escape closes only this tooltip, never an enclosing dismissible dialog too. A popover opened
   * without a real click on its trigger never has focus inside this component, so only a
   * capture-phase document listener sees the key (wt-help-tooltip.guard.test.ts). */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.popup.hidePopover();
    this.trigger.focus();
  };

  /** Pixel margins live here rather than in CSS because the arithmetic is viewport-relative. */
  private positionTooltip(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    const centred = anchor.left + anchor.width / 2 - popup.width / 2;
    this.popup.style.left = `${Math.max(8, Math.min(centred, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, innerHeight - popup.height - 8))}px`;
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${this.ariaLabel ?? nothing}
        aria-expanded=${this.open}
        aria-describedby=${this.open ? this.tooltipId : nothing}
        popovertarget=${this.tooltipId}
        @click=${this.onTriggerClick}
      >
        <span class="icon" aria-hidden="true">?</span>
      </button>
      <div id=${this.tooltipId} popover role="tooltip" @toggle=${this.onToggle}>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-help-tooltip": WtHelpTooltip;
  }
}
