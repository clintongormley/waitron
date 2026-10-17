import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import { placePopover } from "@waitron/venue-service/painter";

/** `POPOVER_MARGIN` in venue-service's `paint-grid-parts.ts`, which its exports do not list. */
const MARGIN = 8;

// Copied from venue-service's `flat-tree.ts`, which its exports do not list.
function flatParent(at: Element): Element | null {
  const parent = at.parentNode;
  return at.assignedSlot ?? at.parentElement ?? (parent instanceof ShadowRoot ? parent.host : null);
}

// Copied from venue-service's `flat-tree.ts`. A scroll does not bubble or leave its shadow root,
// so it is heard on the window and on the shadow root of every box `at` is drawn inside.
function scrollTargets(at: Element): EventTarget[] {
  const targets = new Set<EventTarget>([window]);
  for (let box: Element | null = at; box !== null; box = flatParent(box)) {
    const root = box.getRootNode();
    if (root instanceof ShadowRoot) targets.add(root);
  }
  return [...targets];
}

/** A rota menu beside the button that opened it; its content is its default slot. Sends
 *  `rota-popup-close` when it closes for any reason. */
@customElement("rota-popup")
export class RotaPopup extends LitElement {
  static override styles = [
    baseStyles,
    css`
      [popover] {
        position: fixed;
        inset: auto;
        left: 0;
        top: 0;
        margin: 0;
        box-sizing: border-box;
        width: max-content;
        max-width: calc(100vw - 2 * var(--wt-space-2));
        max-height: calc(100vh - 2 * var(--wt-space-2));
        overflow: auto;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      :host([sheet]) [popover] {
        inset: auto 0 0 0;
        width: 100%;
        max-width: none;
        max-height: 70vh;
        overflow-y: auto;
        border-width: 1px 0 0;
        border-radius: var(--wt-radius-lg) var(--wt-radius-lg) 0 0;
      }
      :host([sheet]) [popover]::backdrop {
        background: var(--wt-color-scrim);
      }
      h2 {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  /** Drawn as a sheet at the foot of the window on a phone. */
  @property({ type: Boolean, reflect: true }) sheet = false;
  /** Read by screen readers, and focused on open. */
  @property() heading = "";

  @query("[popover]") private popup!: HTMLElement;
  @query("h2") private headingEl!: HTMLElement;

  #anchor: HTMLElement | undefined;
  #focusWasInside = false;
  #scrollTargets: EventTarget[] = [];
  /** The frame a scroll or window resize asked for, so a burst of them places once per frame. */
  #frame = 0;
  // A show() while it is closing follows again, so what it follows can fire once it has closed.
  readonly #resized = new ResizeObserver(() => {
    if (this.shown) this.#place();
  });

  /** Opens beside `anchor`, or below it when neither side has room, and follows it while open:
   *  on each change of its own size, and at most once per frame after a window resize or a scroll
   *  of the page or of a box `anchor` is drawn inside, it places itself again, or closes once no part of
   *  `anchor` is left in view. A sheet sits at the foot of the window and does not follow. Called
   *  again after the content changes, it places again without moving focus. */
  show(anchor: HTMLElement): void {
    this.#anchor = anchor;
    const opening = !this.popup.matches(":popover-open");
    if (this.sheet) {
      this.#stopFollowing();
      this.popup.style.left = this.popup.style.top = "";
      if (opening) this.popup.showPopover({ source: anchor });
    } else {
      this.#place();
      this.#follow(anchor);
    }
    if (opening) this.headingEl.focus();
  }

  hide(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }

  get shown(): boolean {
    return this.popup.matches(":popover-open");
  }

  #place(): void {
    const popup = this.popup;
    const anchor = this.#anchor!;
    if (!popup.matches(":popover-open")) popup.showPopover({ source: anchor });
    const at = anchor.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    const end = at.right + box.width <= innerWidth - MARGIN;
    if (!end && at.left - box.width < MARGIN) {
      placePopover(popup, anchor, false, true);
      return;
    }
    const top = Math.max(MARGIN, Math.min(at.top, innerHeight - box.height - MARGIN));
    popup.style.left = `${end ? at.right : at.left - box.width}px`;
    popup.style.top = `${top}px`;
  }

  #follow(anchor: HTMLElement): void {
    this.#stopFollowing();
    this.#scrollTargets = scrollTargets(anchor);
    for (const target of this.#scrollTargets)
      target.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    window.addEventListener("resize", this.#onScroll, { passive: true });
    this.#resized.observe(this.popup);
  }

  #stopFollowing(): void {
    for (const target of this.#scrollTargets.splice(0))
      target.removeEventListener("scroll", this.#onScroll, { capture: true });
    window.removeEventListener("resize", this.#onScroll);
    this.#resized.disconnect();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  // Held on screen, a menu whose anchor has gone would sit beside some other slot.
  readonly #onScroll = (): void => {
    if (!this.shown || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (!this.shown) return;
      if (this.#anchorInView()) this.#place();
      else this.hide();
    });
  };

  // Mirrors `calendar-day-box.ts`'s check: the window and every ancestor that clips.
  #anchorInView(): boolean {
    const rect = this.#anchor!.getBoundingClientRect();
    let top = Math.max(rect.top, 0);
    let left = Math.max(rect.left, 0);
    let bottom = Math.min(rect.bottom, innerHeight);
    let right = Math.min(rect.right, innerWidth);
    for (
      let at = flatParent(this.#anchor!);
      at !== null && at !== document.documentElement;
      at = flatParent(at)
    ) {
      const style = getComputedStyle(at);
      const clipsY = style.overflowY !== "visible";
      const clipsX = style.overflowX !== "visible";
      if (!clipsX && !clipsY) continue;
      const clip = at.getBoundingClientRect();
      if (clipsY) {
        top = Math.max(top, clip.top + at.clientTop);
        bottom = Math.min(bottom, clip.top + at.clientTop + at.clientHeight);
      }
      if (clipsX) {
        left = Math.max(left, clip.left + at.clientLeft);
        right = Math.min(right, clip.left + at.clientLeft + at.clientWidth);
      }
    }
    return top < bottom && left < right;
  }

  override disconnectedCallback(): void {
    this.#stopFollowing();
    super.disconnectedCallback();
  }

  #beforeToggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    this.#stopFollowing();
    this.#focusWasInside =
      this.shadowRoot!.activeElement !== null ||
      this.contains((this.getRootNode() as Document | ShadowRoot).activeElement);
  }

  #toggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    if (this.#focusWasInside) this.#anchor!.focus({ preventScroll: true });
    this.dispatchEvent(
      new CustomEvent("rota-popup-close", { detail: {}, bubbles: true, composed: true }),
    );
  }

  protected override render() {
    return html`<div
      popover="auto"
      role="dialog"
      aria-labelledby="heading"
      @beforetoggle=${this.#beforeToggle}
      @toggle=${this.#toggle}
    >
      <h2 id="heading" tabindex="-1">${this.heading}</h2>
      <slot></slot>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rota-popup": RotaPopup;
  }
}
