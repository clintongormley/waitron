import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-icon.js";
import type { WtIconSize } from "./wt-icon.js";

@customElement("wt-row-actions")
export class WtRowActions extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }
      button {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
        position: relative;
      }
      ::slotted([slot="badge"]) {
        position: absolute;
        inset-block-start: 0;
        inset-inline-end: 0;
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
        /* Chromium maps the host's align="end" attribute to text-align, which the popup would inherit. */
        text-align: start;
        /* A fixed box with an automatic width shrinks with the room beside it, so placing it would
           resize it and the size observer would never settle. */
        width: max-content;
        max-width: calc(100vw - 2 * var(--wt-space-2));
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      ::slotted(wt-button) {
        width: 100%;
      }
      /* The same box as a slotted wt-button variant="secondary" align="start". */
      ::slotted(a[href]) {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: var(--wt-space-2);
        width: 100%;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-decoration: none;
      }
      ::slotted(a[href]:not([aria-disabled="true"]):hover) {
        border-color: var(--wt-color-primary-text);
      }
      ::slotted(a[href][aria-disabled="true"]) {
        ${disabledStyles}
      }
      ::slotted(a[href]:focus-visible) {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];

  @property() label = "";
  @property() icon = "kebab";
  @property() iconSize: WtIconSize = "md";
  /** The trigger edge the popup lines up with; "end" suits a menu at the trailing edge. */
  @property() align: "start" | "end" = "start";
  /** Opens the popup under the trigger and scrolls what does not fit, rather than moving it up over
   * the trigger, where a second tap would land on an action. */
  @property({ type: Boolean, attribute: "opens-below" }) opensBelow = false;
  @state() private expanded = false;
  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  // Observes the popup only while it is open.
  readonly #resize = new ResizeObserver(() => this.positionPopup());

  override disconnectedCallback(): void {
    this.expanded = false;
    this.#resize.disconnect();
    super.disconnectedCallback();
  }

  private onToggle(): void {
    this.expanded = this.popup.matches(":popover-open");
    if (!this.expanded) this.#resize.unobserve(this.popup);
  }

  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.popup.matches(":popover-open")) this.hide();
    else this.show();
  }

  /** Opens the menu. Positioned synchronously so its first paint is already in place. Does nothing
   * before the first render or while the host is off the page, where a popover cannot open. */
  show(): void {
    const popup = this.popup as HTMLElement | null;
    if (popup === null || !this.isConnected || popup.matches(":popover-open")) return;
    popup.showPopover();
    this.positionPopup();
    this.#resize.observe(popup);
  }

  hide(): void {
    const popup = this.popup as HTMLElement | null;
    if (popup?.matches(":popover-open")) popup.hidePopover();
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    if (!this.opensBelow) this.popup.style.maxHeight = "";
    const below = this.opensBelow && this.capBelow(innerHeight - anchor.bottom - 8);
    const popup = this.popup.getBoundingClientRect();
    const desiredLeft = this.align === "end" ? anchor.right - popup.width : anchor.left;
    this.popup.style.left = `${Math.max(8, Math.min(desiredLeft, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = below
      ? `${anchor.bottom}px`
      : `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
  }

  /** Caps the popup's height to `room`. A list cut short is cut through the middle of an action, so
   * the half that shows says the list goes on even where no scrollbar is drawn. False, capped to the
   * window less 8px above and below, when `room` cannot show one whole action and half of the next. */
  private capBelow(room: number): boolean {
    const popup = this.popup;
    popup.style.maxHeight = `${Math.max(0, room)}px`;
    if (popup.scrollHeight <= popup.clientHeight) return true;
    const rows = this.rows();
    if (rows.length === 0) return true;
    const contentTop = popup.getBoundingClientRect().top + popup.clientTop - popup.scrollTop;
    if (rows.at(-1)!.getBoundingClientRect().bottom - contentTop <= popup.clientHeight) return true;
    const middles = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2 - contentTop;
    });
    const shown = middles.filter((middle) => middle <= popup.clientHeight);
    if (shown.length < 2) {
      popup.style.maxHeight = `${Math.max(0, innerHeight - 16)}px`;
      return false;
    }
    popup.style.maxHeight = `${room - (popup.clientHeight - Math.max(...shown))}px`;
    return true;
  }

  /** The menu's drawn actions, slotted directly or inside a slotted group. */
  private rows(): Element[] {
    const selector = "button, a[href], wt-button";
    return this.popup
      .querySelector("slot")!
      .assignedElements({ flatten: true })
      .flatMap((element) =>
        element.matches(selector) ? [element] : [...element.querySelectorAll(selector)],
      )
      .filter((row) => row.getBoundingClientRect().height > 0);
  }

  // Judged while capturing, before the action's own listeners: a real click runs microtasks after
  // each listener, so an update its handler schedules can disable the action before the click bubbles to `onAction`.
  private readonly judgeAction = {
    capture: true,
    handleEvent: (event: MouseEvent) => {
      this.cancelDisabledLink(event);
      if (this.closesMenu(event)) this.closingClicks.add(event);
    },
  };
  // A middle-click opens a link in a new tab through `auxclick`, which fires no `click`.
  private readonly judgeAuxclick = {
    capture: true,
    handleEvent: (event: MouseEvent) => this.cancelDisabledLink(event),
  };
  private readonly closingClicks = new WeakSet<Event>();

  private closesMenu(event: MouseEvent): boolean {
    const path = event.composedPath();
    // Everything before the host is inside the menu, including a slotted element's shadow root.
    if (
      path
        .slice(0, path.indexOf(this))
        .some((node) => node instanceof HTMLElement && node.hasAttribute("data-keep-open"))
    )
      return false;
    const action = this.actionOf(event);
    return (
      action !== undefined &&
      !action.hasAttribute("disabled") &&
      action.getAttribute("aria-disabled") !== "true"
    );
  }

  private cancelDisabledLink(event: MouseEvent): void {
    if (this.actionOf(event)?.matches('a[href][aria-disabled="true"]')) event.preventDefault();
  }

  private actionOf(event: MouseEvent): HTMLElement | undefined {
    return event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.matches("button, a[href], wt-button"),
      );
  }

  private onAction(event: MouseEvent): void {
    if (this.closingClicks.has(event) && this.popup.matches(":popover-open"))
      this.popup.hidePopover();
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
      <button
        type="button"
        part="trigger"
        aria-label=${this.label}
        aria-expanded=${this.expanded}
        popovertarget="actions"
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <slot name="trigger"><wt-icon name=${this.icon} size=${this.iconSize}></wt-icon></slot>
        <slot name="badge"></slot>
      </button>
      <div id="actions" part="popup" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
        <div class="actions" @click=${this.judgeAction} @auxclick=${this.judgeAuxclick}>
          <slot @click=${this.onAction}></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-row-actions": WtRowActions;
  }
}
