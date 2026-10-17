import { css, type LitElement, type ReactiveController } from "lit";

export interface MenuPopoverParts {
  trigger: () => HTMLElement;
  close: () => void;
}

/**
 * The rules for a `role="menu"` popover of `.option` buttons. In the top layer, so no positioned
 * content later in the page can paint over it. A manual popover, because the host's own
 * outside-press and Escape handling decide when it closes.
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

  .menu:popover-open {
    display: flex;
  }

  .option {
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

  .option:hover {
    background: var(--wt-color-surface-raised);
  }

  .option[aria-checked="true"] {
    border-color: var(--wt-color-border);
  }
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
    // A scroll event does not leave its shadow root, so each root between here and the document
    // is listened on as well as the window.
    this.#scrollTargets = [window];
    for (
      let root = this.#host.getRootNode();
      root instanceof ShadowRoot;
      root = root.host.getRootNode()
    ) {
      this.#scrollTargets.push(root);
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

  /** Below the trigger, trailing edges aligned, and 8px clear of both sides of the viewport. */
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
    menu.style.top = `${trigger.bottom}px`;
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
    const last = options.length - 1;
    let to: number;
    switch (event.key) {
      case "ArrowDown":
        to = at === last ? 0 : at + 1;
        break;
      case "ArrowUp":
        to = at === 0 ? last : at - 1;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = last;
        break;
      default:
        return;
    }
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
