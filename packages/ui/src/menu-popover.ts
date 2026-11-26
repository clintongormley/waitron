import { css, type LitElement, type ReactiveController } from "lit";
import { popupIndex, popupPlacement } from "./popup-helpers.js";

export interface MenuPopoverParts {
  trigger: () => HTMLElement;
  close: () => void;
  verticalPlacement?: () => "below" | "above";
}

export const menuOptionStyles = css`
  :where([role="menu"]) > .option {
    display: block;
    width: 100%;
    min-height: var(--wt-tap-min);
    padding: var(--wt-space-2) var(--wt-space-4);
    border: 1px solid transparent;
    border-radius: var(--wt-radius-md);
    background: transparent;
    color: var(--wt-color-text);
    font: inherit;
    font-weight: var(--wt-font-weight-bold);
    text-align: start;
    cursor: pointer;
  }

  :where([role="menu"]) > .option:hover {
    background: var(--wt-color-bg);
  }

  :where([role="menu"]) > .option[aria-checked="true"] {
    border-color: var(--wt-color-border);
    background: var(--wt-color-surface-lifted);
  }

  :where([role="menu"]) > .option:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
  :where([role="menu"]) > .option[aria-disabled="true"] {
    color: var(--wt-color-text-muted);
    background: transparent;
    cursor: not-allowed;
  }
`;

/**
 * A manual popover because the host's outside-press and Escape handling decide when it closes.
 */
export const menuPopoverStyles = css`
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    margin-block-start: var(--wt-space-1);
    padding: var(--wt-space-1);
    flex-direction: column;
    gap: var(--wt-space-1);
    background: var(--wt-color-surface);
    color: var(--wt-color-text);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    box-shadow: var(--wt-shadow-2);
  }

  .menu:is(:popover-open, .\\:popover-open) {
    display: flex;
  }

  ${menuOptionStyles}
`;

/**
 * Placement, outside-press dismissal and arrow keys for a host that renders a `role="menu"`
 * popover of `role="menuitemradio"` options. The host owns whether the menu is open.
 */
export class MenuPopover implements ReactiveController {
  readonly #host: LitElement;

  readonly #parts: MenuPopoverParts;

  #listening = false;

  #scrollTargets: EventTarget[] = [];

  constructor(host: LitElement, parts: MenuPopoverParts) {
    this.#host = host;
    this.#parts = parts;
    host.addController(this);
  }

  /** Shown and placed in the same update that draws the menu: placed any later, its first frame is not. */
  hostUpdated(): void {
    const menu = this.#menu();
    if (menu === null) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    this.place();
  }

  listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointerdown", this.#onOutside, true);
    document.addEventListener("focusin", this.#onOutside);
    // Scroll events stop at a shadow root, including the root of a slot the host is drawn in.
    this.#scrollTargets = [window];
    for (let node: Node | null = this.#host; node !== null;) {
      if (node instanceof ShadowRoot) {
        this.#scrollTargets.push(node);
        node = node.host;
      } else {
        node = (node instanceof Element ? node.assignedSlot : null) ?? node.parentNode;
      }
    }
    for (const target of this.#scrollTargets) target.addEventListener("scroll", this.place, true);
    window.addEventListener("resize", this.place);
  }

  unlisten(): void {
    if (!this.#listening) return;
    this.#listening = false;
    document.removeEventListener("pointerdown", this.#onOutside, true);
    document.removeEventListener("focusin", this.#onOutside);
    for (const target of this.#scrollTargets.splice(0)) {
      target.removeEventListener("scroll", this.place, true);
    }
    window.removeEventListener("resize", this.place);
  }

  /** Aligns the trailing edges and keeps the popup 8px clear of the viewport sides. */
  place = (): void => {
    const menu = this.#menu();
    if (menu === null) return;
    const trigger = this.#parts.trigger().getBoundingClientRect();
    // A popover's default fit-content width would be measured against the left written by the
    // previous placement, so after a resize the labels would wrap into the room that left allows.
    menu.style.width = "max-content";
    menu.style.minWidth = `${trigger.width}px`;
    // From clientWidth rather than 100vw, which counts a scrollbar the clamp below must not.
    const room = document.documentElement.clientWidth;
    menu.style.maxWidth = `${room - 16}px`;
    const verticalPlacement = this.#parts.verticalPlacement?.();
    if (verticalPlacement !== undefined) {
      const style = getComputedStyle(menu);
      const gap = parseFloat(style.marginBlockStart);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const height = menu.scrollHeight + border;
      const anchor = { top: trigger.top - gap, bottom: trigger.bottom + gap };
      const placement = popupPlacement(anchor, height, innerHeight, verticalPlacement);
      menu.style.maxHeight = `${placement.maxHeight}px`;
      menu.style.top = `${placement.top - gap}px`;
    } else {
      menu.style.top = `${trigger.bottom}px`;
    }
    const width = menu.getBoundingClientRect().width;
    const wanted =
      getComputedStyle(this.#host).direction === "rtl" ? trigger.left : trigger.right - width;
    menu.style.left = `${Math.max(8, Math.min(wanted, room - width - 8))}px`;
  };

  /** For a keydown while the menu is open; the host checks that first. */
  keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.#parts.close();
      this.#parts.trigger().focus();
      return;
    }
    const options = this.#options();
    const at = options.indexOf(event.target as HTMLElement);
    if (at === -1) return;
    const to = popupIndex(event.key, at, options.length);
    if (to === undefined) return;
    event.preventDefault();
    options[to]!.focus();
  }

  focusChecked(): void {
    const options = this.#options();
    (options.find((o) => o.getAttribute("aria-checked") === "true") ?? options[0])?.focus();
  }

  #menu(): HTMLElement | null {
    return this.#host.renderRoot.querySelector<HTMLElement>('[role="menu"]');
  }

  #options(): HTMLElement[] {
    return [...this.#host.renderRoot.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  }

  #onOutside = (event: Event): void => {
    if (!event.composedPath().includes(this.#host)) this.#parts.close();
  };
}
