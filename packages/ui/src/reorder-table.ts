import {
  css,
  html,
  type CSSResult,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import { disabledStyles } from "./base-styles.js";
import "./components/wt-icon.js";

type ReorderHost = ReactiveControllerHost & { readonly shadowRoot: ShadowRoot | null };

/** Set on the body while any drag is in progress. The body's own `cursor` loses to any element
 * with a cursor rule of its own, such as the handle; a custom property inherits into every shadow
 * root, so a rule that reads it follows the drag. */
const DRAG_CURSOR = "--reorder-drag-cursor";

/** Shared by every controller on the page, so overlapping drags (two tables, two fingers) hand the
 * page's own cursor back only when the last one ends. */
const pageDrag = { count: 0, cursor: "" };

export function holdPageCursor(): void {
  if (pageDrag.count++ > 0) return;
  pageDrag.cursor = document.body.style.cursor;
  document.body.style.cursor = "grabbing";
  document.body.style.setProperty(DRAG_CURSOR, "grabbing");
}

export function releasePageCursor(): void {
  if (--pageDrag.count > 0) return;
  document.body.style.cursor = pageDrag.cursor;
  document.body.style.removeProperty(DRAG_CURSOR);
}

/** Touch pointer capture keeps event targets at the press site; find the painted target instead. */
export function pointerElementsAt(x: number, y: number): Element[] {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const next = element.shadowRoot.elementFromPoint(x, y);
    if (!next || next === element) break;
    element = next;
  }
  const path: Element[] = [];
  while (element) {
    path.push(element);
    const parent: Node | null = element.parentNode;
    element =
      element.assignedSlot ??
      element.parentElement ??
      (parent instanceof ShadowRoot ? parent.host : null);
  }
  return path;
}

/** How far a transform currently draws the row from where it rests, mid-transition included. */
function offsetY(row: Element): number {
  return new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
}

export interface ReorderModel {
  /** Row ids in current display order, top to bottom. The tbody renders one `<tr>` per id in this
   * order — the invariant the pointer geometry relies on. */
  order(): readonly string[];
  /** `to` may be out of range (the pointer-drag path can pass -1); an implementation must ignore
   * it, as `reorder()` does. `via` says whether a key press or a pointer drag asked. */
  move(id: string, to: number, via: "key" | "pointer"): void;
  /** Called once when a pointer drag of `id` ends, whether released or cancelled. */
  drop?(id: string): void;
  label(id: string): string;
  busy(): boolean;
  readonly reorderLabel: string;
}

export class ReorderController implements ReactiveController {
  readonly #host: ReorderHost;
  readonly #model: ReorderModel;
  readonly #announceText: () => string;
  /** `grab` is how far below the row's top the pointer pressed; `y` is where the pointer is now. */
  #drag: { id: string; pointerId: number; grab: number; y: number } | null = null;
  /** Each row's id and vertical bounds, measured from the top of the table body so scrolling the
   * host does not move them. The id is a SCREEN SNAPSHOT taken at measurement time: the i-th `<tr>`
   * is `order()[i]` only while the rendered DOM matches the data, so binding the id here — rather
   * than re-reading `order()` at lookup time — keeps a mid-drag lookup on screen truth after a move
   * has advanced the data but before the next render. Null means measure again. */
  #rowBounds: { id: string; top: number; bottom: number }[] | null = null;
  #refocus: string | null = null;
  #announcement = "";
  /** Relies on the host keying its rows (`repeat` by id), so this element moves with the row. */
  #draggedRow: HTMLTableRowElement | null = null;
  /** Where each row was drawn and where it rested before a render during a drag; null when no slide
   * is waiting for its frame. */
  #before: Map<HTMLElement, { drawn: number; rest: number }> | null = null;
  #frame = 0;
  /** Everything a scroll listener was added to for the current drag. */
  #scrollTargets: EventTarget[] = [];

  static readonly styles: CSSResult = css`
    .handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--wt-tap-min);
      min-height: var(--wt-tap-min);
      padding: 0;
      border: 0;
      border-radius: var(--wt-radius-md);
      background: transparent;
      color: var(--wt-color-text);
      cursor: var(--reorder-drag-cursor, grab);
      /* A touch that starts on the handle drags the row; without this the browser claims the
         gesture and scrolls the host instead. Not a themed value, so no token. */
      touch-action: none;
    }
    /* The handle is a bespoke button, so it needs the shared disabled treatment the primitives in
       the same row apply themselves. */
    .handle:disabled {
      ${disabledStyles}
    }
    tr[data-sliding] {
      transition: transform var(--wt-duration-move) ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      tr[data-sliding] {
        transition: none;
      }
    }
    /* A lifted row, marked by the controller while a pointer drag is in progress. */
    tr[data-dragging] {
      position: relative;
      z-index: 1;
      background: var(--wt-color-surface-lifted);
      box-shadow: var(--wt-shadow-2);
    }
    /* Off screen but still announced: the live region below, and a header cell whose column holds
       only controls and so has no visible label of its own. */
    .reorder-status,
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `;

  /** A host adds this beside {@link ReorderController.styles} and wraps its `<table>` in
   * `.table-wrap`. Hosts give that wrapper `tabindex="0"` so a keyboard can reach its horizontal
   * scroll: with no rows yet there is no row control inside to tab into. */
  static readonly tableStyles: CSSResult = css`
    .table-wrap {
      overflow-x: auto;
    }
    .table-wrap:focus-visible {
      outline: var(--wt-focus-ring);
      outline-offset: var(--wt-focus-offset);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: var(--wt-space-2) var(--wt-space-1);
      text-align: start;
      vertical-align: top;
      border-bottom: 1px solid var(--wt-color-border);
    }
    /* A text line is shorter than the handle, so neither top nor middle alignment puts the handle
       on it; baseline alignment does, beside plain text. The Courses list's name button lined the
       grip up with the button's last line under this rule, so that host top-aligns and pads
       (course-list.ts). */
    tbody td {
      vertical-align: baseline;
    }
  `;

  constructor(host: ReorderHost, model: ReorderModel, options: { announce: () => string }) {
    this.#host = host;
    this.#model = model;
    this.#announceText = options.announce;
    host.addController(this);
  }

  hostUpdate(): void {
    if (this.#drag === null || this.#before !== null) return;
    this.#before = new Map();
    for (const row of this.#rows()) {
      const drawn = row.getBoundingClientRect().top;
      this.#before.set(row, { drawn, rest: drawn - offsetY(row) });
    }
    // The slide starts in the frame after the render, so a box read straight after an update is
    // where the row rests, which is the position the hit test uses.
    this.#frame = requestAnimationFrame(() => this.#slidePassedRows());
  }

  hostUpdated(): void {
    // A render can move rows, so the next move re-measures.
    this.#rowBounds = null;
    if (this.#drag !== null) this.#follow(this.#drag);
    const id = this.#refocus;
    if (id === null) return;
    this.#refocus = null;
    this.#host.shadowRoot?.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)?.focus();
  }

  hostDisconnected(): void {
    this.#endDrag();
    cancelAnimationFrame(this.#frame);
    this.#before = null;
  }

  /** Its `data-test` also anchors the post-move refocus. */
  handle(id: string): TemplateResult {
    const label = this.#model.label(id);
    return html`<button
      type="button"
      class="handle"
      data-test=${`drag-${id}`}
      aria-label=${`${this.#model.reorderLabel}: ${label}`}
      ?disabled=${this.#model.busy()}
      @keydown=${(event: KeyboardEvent) => this.#onKey(event, id)}
      @pointerdown=${(event: PointerEvent) => this.#startDrag(event, id)}
    >
      <wt-icon name="grip"></wt-icon>
    </button>`;
  }

  /** A host renders it exactly once, anywhere in its own template. The text sits flush against the
   * tags so `textContent` is exactly the announcement. */
  liveRegion(): TemplateResult {
    // prettier-ignore
    return html`<div role="status" aria-live="polite" class="reorder-status">${this.#announcement}</div>`;
  }

  #onKey(event: KeyboardEvent, id: string): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0 || this.#model.busy()) return;
    // Without this the arrow scrolls the host, carrying the row out from under the handle.
    event.preventDefault();
    const order = this.#model.order();
    const from = order.indexOf(id);
    const to = from + delta;
    // At an end there is nothing to move, announce or refocus — but the scroll is still suppressed.
    if (from < 0 || to < 0 || to >= order.length) return;
    this.#model.move(id, to, "key");
    this.#announce(id);
    // The move re-inserts the handle's DOM node, which drops focus; restore it after the update so
    // repeated presses keep moving the same row.
    this.#refocus = id;
    this.#host.requestUpdate();
  }

  #announce(id: string): void {
    const order = this.#model.order();
    const index = order.indexOf(id);
    if (index < 0) return;
    this.#announcement = this.#announceText()
      .replace("{item}", this.#model.label(id))
      .replace("{index}", String(index + 1))
      .replace("{total}", String(order.length));
  }

  #startDrag(event: PointerEvent, id: string): void {
    if (this.#model.busy() || this.#drag !== null) return;
    // Keep the press from selecting the row's text or starting the browser's own drag.
    event.preventDefault();
    const row = (event.currentTarget as HTMLElement).closest("tr")!;
    this.#draggedRow = row;
    const grab = event.clientY - row.getBoundingClientRect().top;
    this.#drag = { id, pointerId: event.pointerId, grab, y: event.clientY };
    this.#stopSlide(row);
    row.setAttribute("data-dragging", "");
    holdPageCursor();
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerEnd);
    document.addEventListener("pointercancel", this.#onPointerEnd);
    // A scroll of any ancestor moves the rows under a pointer that has not moved. An element's scroll
    // event does not bubble, and a capturing listener outside a shadow root does not hear one fired
    // inside it, so each ancestor in the flattened tree gets its own listener; the document's hears
    // the page itself.
    this.#scrollTargets = [document];
    let at: Element | null = row;
    while (at !== null) {
      const parent: Node | null = at.parentNode;
      at =
        at.assignedSlot ?? at.parentElement ?? (parent instanceof ShadowRoot ? parent.host : null);
      if (at !== null) this.#scrollTargets.push(at);
    }
    for (const target of this.#scrollTargets) {
      target.addEventListener("scroll", this.#onScroll, { passive: true });
    }
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    drag.y = event.clientY;
    this.#track(drag);
  };

  readonly #onScroll = (): void => {
    this.#track(this.#drag!);
  };

  #track(drag: { id: string; grab: number; y: number }): void {
    this.#follow(drag);
    const over = this.#rowAt(drag.y, drag.id);
    if (over === null || over === drag.id) return;
    this.#model.move(drag.id, this.#model.order().indexOf(over), "pointer");
  }

  /** A cancelled pointer (the OS interrupting a touch) ends the drag like a release: each crossed
   * row has already moved on screen. */
  readonly #onPointerEnd = (event: PointerEvent): void => {
    // Listening only between #startDrag and #endDrag, so a drag is always in progress here.
    const drag = this.#drag!;
    if (event.pointerId !== drag.pointerId) return;
    this.#endDrag();
    this.#model.drop?.(drag.id);
  };

  #endDrag(): void {
    if (this.#drag !== null) releasePageCursor();
    const row = this.#draggedRow;
    if (row !== null) {
      row.removeAttribute("data-dragging");
      // A slide still waiting for its frame would restart this one from before the last render.
      this.#before?.delete(row);
      this.#slideHome(row);
    }
    this.#draggedRow = null;
    this.#drag = null;
    this.#rowBounds = null;
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerEnd);
    document.removeEventListener("pointercancel", this.#onPointerEnd);
    for (const target of this.#scrollTargets) target.removeEventListener("scroll", this.#onScroll);
    this.#scrollTargets = [];
  }

  #rows(): NodeListOf<HTMLElement> {
    return this.#host.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr");
  }

  #slidePassedRows(): void {
    const before = this.#before!;
    this.#before = null;
    for (const row of this.#rows()) {
      const was = before.get(row);
      if (was === undefined || row === this.#draggedRow) continue;
      if (Math.abs(row.getBoundingClientRect().top - offsetY(row) - was.rest) < 0.5) continue;
      this.#stopSlide(row);
      row.style.transform = `translateY(${was.drawn - row.getBoundingClientRect().top}px)`;
      this.#slideHome(row);
    }
  }

  /** Removing the attribute alone does not stop a transition already running. */
  #stopSlide(row: HTMLElement): void {
    row.removeAttribute("data-sliding");
    for (const animation of row.getAnimations()) animation.cancel();
    row.style.removeProperty("transform");
  }

  /** Slides the row from where its transform draws it to where it rests. The transform must have
   * been through a style recalculation before it is cleared, or no transition starts. */
  #slideHome(row: HTMLElement): void {
    void row.offsetHeight;
    row.setAttribute("data-sliding", "");
    row.style.removeProperty("transform");
    row.addEventListener("transitionend", this.#onSlideEnd);
  }

  readonly #onSlideEnd = (event: Event): void => {
    (event.currentTarget as HTMLElement).removeAttribute("data-sliding");
  };

  #follow(drag: { grab: number; y: number }): void {
    const row = this.#draggedRow!;
    if (!row.isConnected) return;
    const box = row.getBoundingClientRect();
    const rest = box.top - offsetY(row);
    const body = row.parentElement!.getBoundingClientRect();
    const dy = Math.min(
      Math.max(drag.y - drag.grab - rest, body.top - rest),
      body.bottom - box.height - rest,
    );
    row.style.transform = `translateY(${dy}px)`;
  }

  /** The row the dragged one should take the place of, or null. Moving onto a row below, the pointer
   * must be within the dragged row's height of that row's bottom (onto a row above, of its top), so
   * a short row pushed into a tall one does not swap back and forth on every pixel. */
  #rowAt(clientY: number, draggedId: string): string | null {
    const body = this.#host.shadowRoot?.querySelector("tbody");
    if (!body) return null;
    const origin = body.getBoundingClientRect().top;
    const snapshot = this.#model.order();
    // Where each row RESTS, not where it is drawn: the dragged row is drawn under the pointer.
    this.#rowBounds ??= [...body.querySelectorAll("tr")].map((row, index) => {
      const box = row.getBoundingClientRect();
      const top = box.top - origin - offsetY(row);
      return { id: snapshot[index]!, top, bottom: top + box.height };
    });
    const y = clientY - origin;
    const over = this.#rowBounds.find((row) => y >= row.top && y <= row.bottom);
    if (over === undefined) return null;
    const dragged = this.#rowBounds.find((row) => row.id === draggedId);
    if (dragged === undefined) return over.id;
    const height = dragged.bottom - dragged.top;
    const crossed = over.top > dragged.top ? y >= over.bottom - height : y <= over.top + height;
    return crossed ? over.id : null;
  }
}
