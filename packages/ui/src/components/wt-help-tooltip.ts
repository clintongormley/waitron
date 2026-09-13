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
    // Listens only while this popover is open: added here, removed below or in disconnectedCallback.
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
    // popovertarget below makes this button the popover's declared invoker, which is what exempts
    // it from light-dismiss — without that, the browser closes the popover between pointerdown and
    // click on every trusted click (proven with three real userEvent.click calls: open stayed true
    // throughout instead of toggling), so this handler always saw it already closed and reopened
    // it. Being an invoker also gives the click a native show/hide default action of its own, which
    // this suppresses so only the logic below runs.
    event.preventDefault();
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
      return;
    }
    // Show synchronously so the box has real dimensions to position against before the first paint.
    this.popup.showPopover();
    this.positionTooltip();
  }

  /** Escape closes only this tooltip, never an enclosing dismissible dialog too. A REAL click on
   * this button grants user activation, and with that the browser's own popover Escape-dismiss
   * already stays scoped to just the topmost popover on its own — a dismissible <wt-dialog> around
   * a real-click-opened tooltip stays open on Escape even with this listener removed entirely (see
   * wt-help-tooltip.test.ts's real-click nested-dialog test). What actually needs this listener is
   * a popover shown WITHOUT a real click on its own trigger — e.g. a synthetic click driven by
   * another component, or a direct showPopover() call — where focus never lands inside this
   * component at all, so a keydown bound to the button or the popup (as wt-row-actions binds its
   * own equivalent guard) never sees the key: a bare Escape there closes both the popover and the
   * enclosing dialog in one press (that file's guard test proves this by deletion). This has to be
   * a CAPTURE-phase document listener rather than a per-element one for exactly that reason; it is
   * attached only while the popover is open (see onToggle). */
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.popup.hidePopover();
    this.trigger.focus();
  };

  /** Centre under the trigger, then clamp to the viewport so an edge-anchored tooltip stays readable.
   * Pixel margins live here rather than in CSS because the arithmetic is viewport-relative; this is
   * the same shape as wt-row-actions. */
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
