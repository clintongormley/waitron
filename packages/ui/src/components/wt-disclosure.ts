import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

/**
 * A collapsible section: a header button showing a heading and an optional one-line summary, over a
 * slotted body that hides when collapsed. The product editor folds its optional sections (Kitchen,
 * Descriptors, Nutritional info) behind these.
 *
 * `has-error` is the invariant that makes this more than a plain toggle: a section holding a
 * validation error must not be hidden, so while `has-error` is set the section is forced open and
 * the header click is inert — a person cannot collapse a section away from the error they still have
 * to fix.
 */
@customElement("wt-disclosure")
export class WtDisclosure extends LitElement {
  // Delegates .focus() on the host to the header button — the product editor focuses the section
  // that holds a reported error.
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .header {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      /* No collapse is possible while an error is showing, so the header stops presenting itself as
         a live control (see the has-error invariant in the class comment). */
      :host([has-error]) .header {
        cursor: default;
      }

      .heading {
        flex: 1;
        font-weight: var(--wt-font-weight-bold);
      }

      .summary {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Points down when collapsed; rotates to point up when open, matching the direction the body
         reveals in. */
      .chevron {
        flex: none;
        transition: transform 150ms ease;
      }

      :host([open]) .chevron {
        transform: rotate(180deg);
      }

      .body {
        padding: var(--wt-space-4);
      }
    `,
  ];

  @property() heading = "";
  @property() summary = "";
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean, reflect: true, attribute: "has-error" }) hasError = false;

  // Ties the header button to the body region it controls, so assistive technology announces the
  // relationship. Per-instance so several disclosures on one page never share an id.
  private readonly bodyId = uniqueId("wt-disclosure-body");

  override willUpdate(changed: PropertyValues<this>): void {
    // An error must never be hidden — surface it by opening the section as soon as has-error is set.
    // A cleared error leaves the section OPEN and only makes the header live again: collapsing it
    // the moment the last error in it is fixed would hide the field being typed into.
    if (changed.has("hasError") && this.hasError) this.open = true;
  }

  private onToggle(event: Event): void {
    // While has-error holds the section open, the header is inert — the person has to keep the error
    // in view until they resolve it.
    if (this.hasError) return;
    event.stopPropagation();
    this.open = !this.open;
    this.dispatchEvent(
      new CustomEvent("wt-toggle", { detail: { open: this.open }, bubbles: true, composed: true }),
    );
  }

  override render() {
    return html`
      <button
        type="button"
        class="header"
        aria-expanded=${this.open ? "true" : "false"}
        aria-controls=${this.bodyId}
        @click=${this.onToggle}
      >
        <span class="heading">${this.heading}</span>
        ${this.summary ? html`<span class="summary">${this.summary}</span>` : nothing}
        <wt-icon class="chevron" name="chevron-down"></wt-icon>
      </button>
      <div id=${this.bodyId} class="body" ?hidden=${!this.open}>
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-disclosure": WtDisclosure;
  }
}
