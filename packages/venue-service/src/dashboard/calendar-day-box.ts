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

  @query("[popover]") private popup!: HTMLElement;
  @query("h2") private headingEl!: HTMLElement;

  @state() private hasActions = false;

  #anchor: HTMLElement | undefined;
  #focusWasInside = false;

  /** Opens below `anchor`, or above it when only there it fits, kept on screen; called again after
   *  the content changes, it places the box again without moving focus. */
  show(anchor: HTMLElement): void {
    this.#anchor = anchor;
    const opening = !this.popup.matches(":popover-open");
    placePopover(this.popup, anchor, false);
    const below = anchor.getBoundingClientRect();
    const height = this.popup.getBoundingClientRect().height;
    // It never covers the day it explains while it fits above it.
    if (below.bottom + height > innerHeight - 8 && below.top - height >= 8)
      this.popup.style.top = `${below.top - height}px`;
    if (opening) this.headingEl.focus();
  }

  get shown(): boolean {
    return this.popup.matches(":popover-open");
  }

  hide(): void {
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }

  #beforeToggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    this.#focusWasInside =
      this.shadowRoot!.activeElement !== null ||
      this.contains((this.getRootNode() as Document | ShadowRoot).activeElement);
  }

  #toggle(event: ToggleEvent): void {
    if (event.newState !== "closed") return;
    if (this.#focusWasInside) this.#anchor?.focus();
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

declare global {
  interface HTMLElementTagNameMap {
    "calendar-day-box": CalendarDayBox;
  }
}
