import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles, disabledStyles } from "../base-styles.js";
import { popupIndex, popupPlacement } from "../popup-helpers.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-icon.js";
import type { WtIconSize } from "./wt-icon.js";

const actionRowStyles = css`
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: start;
  text-align: start;
  gap: var(--wt-space-3);
  width: 100%;
  min-width: var(--wt-tap-min);
  min-height: var(--wt-tap-min);
  padding: var(--wt-space-1) var(--wt-space-4) var(--wt-space-1) var(--wt-space-3);
  border: 0 solid transparent;
  border-radius: var(--wt-radius-sm);
  background: transparent;
  color: var(--wt-color-text);
  font: inherit;
  font-size: var(--wt-font-size-md);
  font-weight: var(--wt-font-weight-normal);
  text-decoration: none;
  cursor: pointer;
`;

export const actionDividerStyles = css`
  align-self: stretch;
  margin: var(--wt-space-1) 0;
  border: 0;
  border-block-start: var(--wt-field-line-width) solid var(--wt-color-border);
`;

export function rowActionTail(
  ordinary: boolean,
  tail: readonly (TemplateResult | typeof nothing)[],
) {
  if (tail.every((action) => action === nothing)) return nothing;
  return html`${ordinary ? html`<hr part="menu-divider" />` : nothing}${tail}`;
}

export const actionChoiceStyles = css`
  [data-row-choice] {
    ${actionRowStyles}
  }
  [data-row-choice][aria-checked="true"] {
    background: var(--wt-color-surface-lifted);
  }
  [data-row-choice]:not([aria-disabled="true"]):is(:hover, :active) {
    background: var(--wt-color-field-fill);
  }
  [data-row-choice][aria-disabled="true"] {
    color: var(--wt-color-text-muted);
    cursor: not-allowed;
  }
  [data-row-choice] wt-icon {
    flex: none;
    color: var(--wt-color-text-muted);
  }
  [aria-checked="false"] > [data-row-check] {
    visibility: hidden;
  }
`;

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
        padding: var(--wt-space-1);
        min-width: min(var(--wt-row-menu-min-width), calc(100vw - 2 * var(--wt-space-2)));
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
        max-height: calc(100vh - 2 * var(--wt-space-2));
        overflow-y: auto;
      }
      :host([panel]) [popover] {
        padding: var(--wt-space-2);
        min-width: 0;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      :host(:not([panel])) .actions {
        gap: 0;
        --wt-button-justify: start;
        --wt-action-gap: var(--wt-space-3);
        --wt-action-padding: var(--wt-space-1) var(--wt-space-4) var(--wt-space-1) var(--wt-space-3);
        --wt-action-border: 0 solid transparent;
        --wt-action-border-color: transparent;
        --wt-action-radius: var(--wt-radius-sm);
        --wt-action-background: transparent;
        --wt-action-text: var(--wt-color-text);
        --wt-action-danger-text: var(--wt-color-danger);
        --wt-action-hover: var(--wt-color-field-fill);
        --wt-action-icon-color: var(--wt-color-text-muted);
        --wt-action-disabled-opacity: var(--wt-opacity-disabled);
        --wt-action-weight: var(--wt-font-weight-normal);
        --wt-action-font-size: var(--wt-font-size-md);
        --wt-action-text-align: start;
      }
      ::slotted(wt-button) {
        width: 100%;
      }
      ::slotted(hr) {
        ${actionDividerStyles}
      }
      ::slotted(:is(button, a[href])) {
        --wt-action-icon-flex: none;
        --wt-action-native-icon-color: var(--wt-color-text-muted);
        ${actionRowStyles}
      }
      ::slotted(:is(button, a[href]):not(:disabled, [aria-disabled="true"]):is(:hover, :active)) {
        background: var(--wt-color-field-fill);
      }
      ::slotted(:is(button, a[href]):is(:disabled, [aria-disabled="true"])) {
        ${disabledStyles}
      }
      ::slotted(:is(button, a[href]):focus-visible) {
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
  @state() private isMenu = false;
  @state() private directDelete: HTMLElement | null = null;
  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  // Observes the popup only while it is open.
  readonly #resize = new ResizeObserver(() => this.positionPopup());

  override disconnectedCallback(): void {
    this.#setExpanded(false);
    this.removeAttribute("data-fallback-popover-open");
    this.#resize.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    super.disconnectedCallback();
  }

  #setExpanded(open: boolean): void {
    if (this.expanded === open) return;
    this.expanded = open;
    this.dispatchEvent(
      new CustomEvent("wt-row-actions-toggle", { bubbles: true, composed: true, detail: { open } }),
    );
  }

  private onToggle(event: Event): void {
    event.stopPropagation();
    this.#setExpanded(this.popup.matches(":popover-open"));
    this.toggleAttribute(
      "data-fallback-popover-open",
      this.popup.classList.contains(":popover-open"),
    );
    if (!this.expanded) {
      this.#resize.unobserve(this.popup);
      window.removeEventListener("resize", this.onWindowResize);
    }
  }

  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.directDelete) {
      event.stopPropagation();
      const action = this.directDelete;
      (action.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? action).click();
      return;
    }
    if (this.popup.matches(":popover-open")) this.hide();
    else this.show();
  }

  /** Opens the menu. Positioned synchronously so its first paint is already in place. Does nothing
   * before the first render or while the host is off the page, where a popover cannot open. */
  show(): void {
    const popup = this.popup as HTMLElement | null;
    if (this.directDelete || popup === null || !this.isConnected || popup.matches(":popover-open"))
      return;
    popup.showPopover();
    // A sibling can render before the browser's queued toggle event reaches this menu.
    this.#setExpanded(popup.matches(":popover-open"));
    this.positionPopup();
    this.#resize.observe(popup);
    window.addEventListener("resize", this.onWindowResize);
    const options = this.menuRows();
    (options.find((row) => row.getAttribute("aria-checked") === "true") ?? options[0])?.focus();
  }

  hide(): void {
    const popup = this.popup as HTMLElement | null;
    if (popup?.matches(":popover-open")) popup.hidePopover();
  }

  /** Places an open popup again against the trigger's current position, for a host that moves the
   * trigger without changing the popup's size or the window's. Does nothing while it is closed or
   * before the first render. */
  reposition(): void {
    if ((this.popup as HTMLElement | null) !== null) this.positionPopup();
  }

  private readonly onWindowResize = (): void => this.positionPopup();

  private positionPopup(): void {
    if (!this.popup.matches(":popover-open")) return;
    const anchor = this.trigger.getBoundingClientRect();
    const style = getComputedStyle(this.popup);
    const border = this.popup.offsetHeight - this.popup.clientHeight;
    const height =
      this.popup.querySelector(".actions")!.getBoundingClientRect().height +
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      border;
    const room = Math.max(0, innerHeight - anchor.bottom - 8);
    let cap = room;
    let below = this.opensBelow;
    if (below && height > room) {
      const rows = this.rows();
      const contentTop =
        this.popup.getBoundingClientRect().top + this.popup.clientTop - this.popup.scrollTop;
      if (
        rows.length > 0 &&
        rows.at(-1)!.getBoundingClientRect().bottom - contentTop > room - border
      ) {
        const middles = rows
          .map((row) => {
            const box = row.getBoundingClientRect();
            return box.top + box.height / 2 - contentTop;
          })
          .filter((middle) => middle <= room - border);
        below = middles.length >= 2;
        // A half-visible next row signals that more actions can be scrolled into view.
        if (below) cap = Math.max(...middles) + border;
      }
    }
    const placement = popupPlacement(anchor, height, innerHeight, below ? "below" : "above");
    const scrollTop = this.popup.scrollTop;
    this.popup.style.maxHeight = this.opensBelow
      ? `${below ? cap : placement.maxHeight}px`
      : height > placement.maxHeight
        ? `${placement.maxHeight}px`
        : "";
    const popup = this.popup.getBoundingClientRect();
    const desiredLeft = this.align === "end" ? anchor.right - popup.width : anchor.left;
    this.popup.style.left = `${Math.max(8, Math.min(desiredLeft, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = `${popupPlacement(anchor, popup.height, innerHeight, below ? "below" : "above").top}px`;
    this.popup.scrollTop = scrollTop;
    this.rows()
      .find((row) => row.matches(":focus-within"))
      ?.scrollIntoView({ block: "nearest" });
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
      if (this.closesMenu(event)) {
        this.closingClicks.add(event);
        this.trigger.focus();
      }
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

  private menuContent(): Element | undefined {
    return this.popup
      .querySelector("slot")!
      .assignedElements({ flatten: true })
      .flatMap((element) =>
        element.matches('[role="menu"]')
          ? [element]
          : [...element.querySelectorAll('[role="menu"]')],
      )[0];
  }

  private menuRows(): HTMLElement[] {
    return [
      ...(this.menuContent()?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ) ?? []),
    ].filter(
      (row) =>
        !row.matches(':disabled, [disabled], [aria-disabled="true"]') &&
        row.getClientRects().length > 0 &&
        getComputedStyle(row).visibility !== "hidden",
    );
  }

  private onSlotChange(): void {
    this.isMenu = this.menuContent() !== undefined;
    const actions = this.popup.querySelector("slot")!.assignedElements({ flatten: true });
    this.directDelete =
      actions.length === 1 &&
      actions[0]!.matches('wt-button[data-action="delete"], button[data-action="delete"]')
        ? (actions[0] as HTMLElement)
        : null;
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !this.popup.matches(":popover-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      this.trigger.focus();
      return;
    }
    if (this.menuContent() === undefined) return;
    if (event.key === "Tab") {
      this.hide();
      this.trigger.focus();
      return;
    }
    const rows = this.menuRows();
    const at = rows.findIndex((row) => event.composedPath().includes(row));
    const next = popupIndex(event.key, at, rows.length);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    rows[next]?.focus();
  }

  override render() {
    return html`
      <button
        type="button"
        part="trigger"
        aria-label=${this.directDelete?.getAttribute("aria-label") ?? this.label}
        aria-expanded=${this.directDelete ? nothing : this.expanded}
        aria-haspopup=${!this.directDelete && this.isMenu ? "menu" : nothing}
        popovertarget=${this.directDelete ? nothing : "actions"}
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <slot name="trigger"
          ><wt-icon name=${this.directDelete ? "bin" : this.icon} size=${this.iconSize}></wt-icon
        ></slot>
        <slot name="badge"></slot>
      </button>
      <div id="actions" part="popup" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
        <div class="actions" @click=${this.judgeAction} @auxclick=${this.judgeAuxclick}>
          <slot @slotchange=${this.onSlotChange} @click=${this.onAction}></slot>
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
