import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

/** The look of a form's one message about a failed submission, for any shadow root that shows it. */
export const formMessageStyles = css`
  .form-message {
    display: block;
    width: 100%;
    max-width: var(--wt-field-max-width);
    margin: 0 0 var(--wt-space-2);
    color: var(--wt-color-danger);
    font-size: var(--wt-font-size-sm);
    text-align: start;
  }
`;

/** A form's one message about a failed submission, on its own line; nothing when it is empty.
 * Its shadow root must include `formMessageStyles`. */
export function formMessage(message: string) {
  return message === ""
    ? nothing
    : html`<p class="form-message" role="alert" data-error>${message}</p>`;
}

export type FormErrorEvent = CustomEvent<{ message: string }>;

/** `node`'s parent in the tree the browser lays out: a slotted element's slot, a shadow root's host. */
function flatParent(node: Node): Node | null {
  if (node instanceof Element && node.assignedSlot) return node.assignedSlot;
  return node instanceof ShadowRoot ? node.host : node.parentNode;
}

@customElement("wt-form-actions")
export class WtFormActions extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
        width: 100%;
        position: sticky;
        bottom: 0;
        z-index: 1;
        padding-bottom: var(--wt-space-2);
        background: var(--wt-form-actions-surface, var(--wt-color-surface));
        container-type: scroll-state;
      }

      :host(:state(empty)) {
        display: none;
      }

      /* On the wrapper rather than the host, so the line drawn while held is the row's top edge.
         The border is always there, unpainted until held, so being held keeps the row's height. */
      .bar {
        padding-top: var(--wt-space-2);
        border-top: 1px solid transparent;
      }

      /* The scroller's bottom padding, which a held row stops above and content would show
         through. */
      .below {
        display: none;
        position: absolute;
        inset-inline: 0;
        top: 100%;
        height: var(--wt-form-actions-scroller-padding, 0px);
        background: var(--wt-form-actions-surface, var(--wt-color-surface));
      }

      @container scroll-state(stuck: bottom) {
        .bar {
          border-top-color: var(--wt-color-border);
        }

        .below {
          display: block;
        }
      }

      /* Set by a container that keeps the row in view itself (wt-dialog's footer), or that places
         it on a line with other content rather than below a form. */
      @container style(--wt-form-actions-in-place: true) {
        :host {
          position: static;
          padding-bottom: 0;
          background: none;
        }

        .bar {
          padding-top: 0;
          border-top: 0;
        }
      }

      .actions {
        display: flex;
        align-items: center;
        width: 100%;
        gap: var(--wt-space-2);
      }

      .cancel {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        align-self: flex-end;
      }

      .primary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        margin-inline-start: auto;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The form's one message about a failed submission, shown on its own line above the actions. */
  @property() error = "";

  /** Off while a container shows `error` instead — `wt-dialog` does, above its footer's content. */
  @property({ attribute: false }) showError = true;

  private readonly internals = this.attachInternals();
  private watched!: Node;

  override connectedCallback(): void {
    super.connectedCallback();
    this.watched = this.parentNode!;
    this.watched.addEventListener("focusin", this.onFocusIn);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.watched.removeEventListener("focusin", this.onFocusIn);
  }

  /** Keeps a field that focus reaches under the held row in view above it (WCAG 2.4.11). A frame
   * later, so the browser's own scroll to the field has happened. */
  private readonly onFocusIn = (event: Event): void => {
    const field = event.composedPath()[0];
    if (!(field instanceof HTMLElement) || event.composedPath().includes(this)) return;
    for (let at = flatParent(this); at; at = flatParent(at)) if (at === field) return;
    requestAnimationFrame(() => {
      const row = this.getBoundingClientRect();
      const covered = Math.max(
        row.bottom,
        this.renderRoot.querySelector(".below")!.getBoundingClientRect().bottom,
      );
      const box = field.getBoundingClientRect();
      if (box.bottom <= row.top || box.top >= covered) return;
      this.scroller().scrollBy({ top: box.bottom - row.top });
    });
  };

  /** What scrolls under the row: the nearest ancestor that can scroll, else the page. */
  private scroller(): Element {
    for (let at = flatParent(this); at; at = flatParent(at)) {
      if (!(at instanceof Element) || at.scrollHeight <= at.clientHeight) continue;
      if (getComputedStyle(at).overflowY !== "visible") return at;
    }
    return document.documentElement;
  }

  /** With no buttons and no message shown, the row takes no room and covers nothing. */
  private syncEmpty(): void {
    const filled =
      (this.showError && this.error !== "") ||
      [...this.renderRoot.querySelectorAll("slot")].some(
        (slot) => slot.assignedElements({ flatten: true }).length > 0,
      );
    if (filled) this.internals.states.delete("empty");
    else this.internals.states.add("empty");
  }

  override updated(changed: Map<string, unknown>): void {
    this.syncEmpty();
    if (!changed.has("error")) return;
    this.dispatchEvent(
      new CustomEvent("wt-form-error", {
        detail: { message: this.error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="bar" data-bar>
        ${this.showError ? formMessage(this.error) : nothing}
        <div class="actions" data-actions>
          <div class="cancel"><slot name="cancel" @slotchange=${this.syncEmpty}></slot></div>
          <div class="primary">
            <slot name="secondary" @slotchange=${this.syncEmpty}></slot
            ><slot @slotchange=${this.syncEmpty}></slot>
          </div>
        </div>
      </div>
      <div class="below"></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-form-actions": WtFormActions;
  }
  interface HTMLElementEventMap {
    "wt-form-error": FormErrorEvent;
  }
}
