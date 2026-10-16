import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { placePopover } from "./painter.js";

export interface DayBoxRow {
  name: string;
  text: string;
  strong?: boolean;
}

/** One day in words, floating below the day that opened it. Presentational: the host formats
 *  every word, and its buttons go in the default slot. Sends `calendar-day-box-close` when it closes. */
@customElement("calendar-day-box")
export class CalendarDayBox extends LitElement {
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
        max-width: min(var(--wt-modal-compact-width), calc(100vw - 2 * var(--wt-space-2)));
        max-height: calc(100vh - 2 * var(--wt-space-2));
        overflow: auto;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        overflow-wrap: anywhere;
      }
      h2 {
        display: inline;
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      h2:focus {
        outline: none;
      }
      .name {
        margin-inline-start: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .line,
      .message {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-1) var(--wt-space-3);
        margin: var(--wt-space-2) 0 0;
      }
      dt {
        color: var(--wt-color-text-muted);
      }
      dt.strong {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
      }
      dd {
        margin: 0;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-3);
      }
      .actions[hidden] {
        display: none;
      }
    `,
  ];

  @property() heading = "";
  @property() name = "";
  @property() nameKind: "special" | "holiday" | "" = "";
  @property() line = "";
  @property({ attribute: false }) rows: readonly DayBoxRow[] = [];
  @property() message = "";
  /** A failed read, drawn as an alert beside the rows it leaves shown, if any. */
  @property() error = "";

  @query("[popover]") private popup!: HTMLElement;
  @query("h2") private headingEl!: HTMLElement;

  @state() private hasActions = false;

  #anchor: HTMLElement | undefined;
  #focusWasInside = false;
  #scrollTargets: EventTarget[] = [];

  /** Opens below `anchor`, or above it when only there it fits, kept on screen; called again after
   *  the content changes, it places the box again without moving focus. While open, on each
   *  window resize and each scroll the window or a shadow root above `anchor` sees, it places
   *  itself again, or closes when no part of `anchor` is left inside the window and every box that
   *  clips it. */
  show(anchor: HTMLElement): void {
    this.#anchor = anchor;
    const opening = !this.popup.matches(":popover-open");
    this.#place();
    this.#follow(anchor);
    if (opening) this.headingEl.focus();
  }

  #place(): void {
    placePopover(this.popup, this.#anchor!, false, true);
  }

  #follow(anchor: HTMLElement): void {
    this.#stopFollowing();
    // A scroll does not bubble or leave its shadow root, so the capture phase is heard on the
    // window and on the shadow root of every box the anchor is drawn inside, slots included.
    const targets = new Set<EventTarget>([window]);
    for (let at: Element | null = anchor; at !== null; at = flatParent(at)) {
      const root = at.getRootNode();
      if (root instanceof ShadowRoot) targets.add(root);
    }
    this.#scrollTargets = [...targets];
    for (const target of this.#scrollTargets)
      target.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    window.addEventListener("resize", this.#onResize, { passive: true });
  }

  #stopFollowing(): void {
    for (const target of this.#scrollTargets.splice(0))
      target.removeEventListener("scroll", this.#onScroll, { capture: true });
    window.removeEventListener("resize", this.#onResize);
  }

  // Held on screen, a box whose date has gone would sit beside some other day.
  readonly #onScroll = (): void => {
    if (this.#anchorInView()) this.#place();
    else this.hide();
  };

  readonly #onResize = this.#onScroll;

  /** Whether any of the anchor is inside the window and inside every box that clips it, up the
   *  flattened tree across shadow roots and slots. */
  #anchorInView(): boolean {
    const date = this.#anchor!.getBoundingClientRect();
    let top = Math.max(date.top, 0);
    let left = Math.max(date.left, 0);
    let bottom = Math.min(date.bottom, innerHeight);
    let right = Math.min(date.right, innerWidth);
    // The window bounds already stand for the root element's own scrolling.
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

  get shown(): boolean {
    return this.popup.matches(":popover-open");
  }

  hide(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
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
    if (this.#focusWasInside) this.#anchor?.focus({ preventScroll: true });
    this.dispatchEvent(
      new CustomEvent("calendar-day-box-close", { bubbles: true, composed: true }),
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
      ${
        this.name
          ? html`<span class="name" data-test="name" data-kind=${this.nameKind}>${this.name}</span>`
          : nothing
      }
      ${this.line ? html`<p class="line" data-test="line">${this.line}</p>` : nothing}
      ${this.error ? html`<p class="error" data-test="error" role="alert">${this.error}</p>` : nothing}
      ${
        this.message
          ? html`<p class="message" data-test="message" role="status">${this.message}</p>`
          : this.rows.length === 0
            ? nothing
            : html`<dl>
                ${this.rows.map(
                  (row) =>
                    html`<dt class=${row.strong ? "strong" : ""}>${row.name}</dt>
                      <dd>${row.text}</dd>`,
                )}
              </dl>`
      }
      <div class="actions" ?hidden=${!this.hasActions}>
        <slot
          @slotchange=${(event: Event) =>
            (this.hasActions = (event.target as HTMLSlotElement).assignedElements().length > 0)}
        ></slot>
      </div>
    </div>`;
  }
}

function flatParent(at: Element): Element | null {
  const parent = at.parentNode;
  return at.assignedSlot ?? at.parentElement ?? (parent instanceof ShadowRoot ? parent.host : null);
}

declare global {
  interface HTMLElementTagNameMap {
    "calendar-day-box": CalendarDayBox;
  }
}
