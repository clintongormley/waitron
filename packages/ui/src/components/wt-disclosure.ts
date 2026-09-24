import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

/**
 * A section holding a validation error must not be hidden: while `has-error` is set the section is
 * forced open and the header click is inert.
 */
@customElement("wt-disclosure")
export class WtDisclosure extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .section {
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
      }

      :host([open]) .section {
        margin-top: calc(var(--wt-tap-min) / 2);
        border-color: var(--wt-color-border);
      }

      .header {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }

      :host([open]) .header {
        top: calc(var(--wt-tap-min) / -2);
        width: auto;
        max-width: calc(100% - var(--wt-space-6));
        margin-inline: var(--wt-space-3);
        padding-inline: var(--wt-space-2);
        background: var(--wt-color-surface);
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
        margin-top: calc(var(--wt-tap-min) / -2);
        padding: 0 var(--wt-space-4) var(--wt-space-4);
      }
    `,
  ];

  @property() heading = "";
  @property() summary = "";
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean, reflect: true, attribute: "has-error" }) hasError = false;

  private readonly bodyId = uniqueId("wt-disclosure-body");

  override willUpdate(changed: PropertyValues<this>): void {
    // A cleared error leaves the section open: collapsing it the moment the last error is fixed would
    // hide the field being typed into.
    if (changed.has("hasError") && this.hasError) this.open = true;
  }

  private onToggle(event: Event): void {
    if (this.hasError) return;
    event.stopPropagation();
    this.open = !this.open;
    this.dispatchEvent(
      new CustomEvent("wt-toggle", { detail: { open: this.open }, bubbles: true, composed: true }),
    );
  }

  override render() {
    return html`
      <div class="section">
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
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-disclosure": WtDisclosure;
  }
}
