import {
  css,
  html,
  type CSSResult,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import { disabledStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-icon.js";
import { t } from "../i18n/t.js";

type ReorderHost = ReactiveControllerHost & { readonly shadowRoot: ShadowRoot | null };

export interface ReorderModel {
  /** Row ids in current display order, top to bottom. The tbody renders one `<tr>` per id in this
   * order — the invariant the pointer geometry relies on. */
  order(): readonly string[];
  move(id: string, to: number): void;
  label(id: string): string;
  busy(): boolean;
  readonly reorderLabel: string;
}

export class ReorderController implements ReactiveController {
  readonly #host: ReorderHost;
  readonly #model: ReorderModel;
  #drag: { id: string; pointerId: number } | null = null;
  /** Each row's id and vertical bounds, measured from the top of the table body so scrolling the
   * host does not move them. The id is a SCREEN SNAPSHOT taken at measurement time: the i-th `<tr>`
   * is `order()[i]` only while the rendered DOM matches the data, so binding the id here — rather
   * than re-reading `order()` at lookup time — keeps a mid-drag lookup on screen truth after a move
   * has advanced the data but before the next render. Null means measure again. */
  #rowBounds: { id: string; top: number; bottom: number }[] | null = null;
  #refocus: string | null = null;
  #announcement = "";

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
      cursor: grab;
      /* A touch that starts on the handle drags the row; without this the browser claims the
         gesture and scrolls the host instead. Not a themed value, so no token. */
      touch-action: none;
    }
    /* The handle is a bespoke button, so it needs the shared disabled treatment the primitives in
       the same row apply themselves. */
    .handle:disabled {
      ${disabledStyles}
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
   * `.table-wrap`. */
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
    /* The handle is a square button, so it centres rather than sitting at the top of a tall row. */
    td.handle-cell {
      vertical-align: middle;
    }
  `;

  constructor(host: ReorderHost, model: ReorderModel) {
    this.#host = host;
    this.#model = model;
    host.addController(this);
  }

  hostUpdated(): void {
    // A render can move rows, so the next move re-measures.
    this.#rowBounds = null;
    const id = this.#refocus;
    if (id === null) return;
    this.#refocus = null;
    this.#host.shadowRoot?.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)?.focus();
  }

  hostDisconnected(): void {
    this.#endDrag();
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
    this.#model.move(id, to);
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
    this.#announcement = t("action.reordered")
      .replace("{item}", this.#model.label(id))
      .replace("{index}", String(index + 1))
      .replace("{total}", String(order.length));
  }

  #startDrag(event: PointerEvent, id: string): void {
    if (this.#model.busy() || this.#drag !== null) return;
    // Keep the press from selecting the row's text or starting the browser's own drag.
    event.preventDefault();
    this.#drag = { id, pointerId: event.pointerId };
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerEnd);
    document.addEventListener("pointercancel", this.#onPointerEnd);
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const over = this.#rowAt(event.clientY);
    if (over === null || over === drag.id) return;
    this.#model.move(drag.id, this.#model.order().indexOf(over));
  };

  /** A cancelled pointer (the OS interrupting a touch) needs no separate handler: each crossed row
   * has already been committed, so there is nothing to commit here. */
  readonly #onPointerEnd = (event: PointerEvent): void => {
    if (this.#drag !== null && event.pointerId !== this.#drag.pointerId) return;
    this.#endDrag();
  };

  #endDrag(): void {
    this.#drag = null;
    this.#rowBounds = null;
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerEnd);
    document.removeEventListener("pointercancel", this.#onPointerEnd);
  }

  #rowAt(clientY: number): string | null {
    const body = this.#host.shadowRoot?.querySelector("tbody");
    if (!body) return null;
    const origin = body.getBoundingClientRect().top;
    const snapshot = this.#model.order();
    this.#rowBounds ??= [...body.querySelectorAll("tr")].map((row, index) => {
      const box = row.getBoundingClientRect();
      return { id: snapshot[index]!, top: box.top - origin, bottom: box.bottom - origin };
    });
    const y = clientY - origin;
    return this.#rowBounds.find((row) => y >= row.top && y <= row.bottom)?.id ?? null;
  }
}
