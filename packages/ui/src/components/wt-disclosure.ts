import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface SummaryField {
  label: string;
  value: string;
  /** Drawn in italic, as a field's placeholder is: what a blank field will use, not its own value. */
  placeholder?: boolean;
}

const summaryPart = ({ label, value, placeholder }: SummaryField) =>
  html`<span class="summary-label">${label}:</span> ${
      placeholder ? html`<span class="summary-placeholder">${value}</span>` : value
    }`;

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
        padding-block: var(--wt-space-3);
      }

      /* The first row is the heading and chevron alone, so the summary line below it, shown only
         while closed, never moves either of them. */
      .header {
        display: grid;
        grid-template-columns: auto 1fr;
        grid-template-rows: minmax(var(--wt-tap-min), auto) auto;
        align-items: center;
        column-gap: var(--wt-space-3);
        width: 100%;
        padding: 0;
        border: 0;
        background: transparent;
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
        font-weight: var(--wt-font-weight-bold);
      }

      .summary {
        grid-column: 1 / -1;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .summary-label {
        font-weight: var(--wt-font-weight-bold);
      }

      .summary-placeholder {
        font-style: italic;
      }

      .summary-rows {
        display: flex;
        flex-direction: column;
      }

      .summary-row {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--summary-row-lines);
        overflow: hidden;
        overflow-wrap: anywhere;
      }

      /* Points down when collapsed; rotates to point up when open, matching the direction the body
         reveals in. */
      .chevron {
        grid-column: 2;
        grid-row: 1;
        justify-self: start;
        transition: transform 150ms ease;
      }

      :host([open]) .chevron {
        transform: rotate(180deg);
      }
    `,
  ];

  @property() heading = "";
  @property() summary = "";
  /** The closed line as named values, each after its bold name; used instead of `summary` when it
   * holds any. */
  @property({ attribute: false }) summaryFields: readonly SummaryField[] = [];
  /** The closed line as one row per named value, each cut with an ellipsis after its `lines`
   * lines; used instead of `summaryFields` and `summary` when it holds any. */
  @property({ attribute: false }) summaryRows: readonly (SummaryField & { lines: number })[] = [];
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

  private renderSummary() {
    if (this.summaryRows.length)
      return html`<span class="summary summary-rows"
        >${this.summaryRows.map(
          ({ lines, ...field }) =>
            html`<span
              class="summary-row"
              style=${styleMap({ "--summary-row-lines": String(lines) })}
              >${summaryPart(field)}</span
            >`,
        )}</span
      >`;
    if (this.summaryFields.length)
      return html`<span class="summary"
        >${this.summaryFields.map(
          (field, index) => html`${index ? " · " : nothing}${summaryPart(field)}`,
        )}</span
      >`;
    return this.summary ? html`<span class="summary">${this.summary}</span>` : nothing;
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
          ${this.open ? nothing : this.renderSummary()}
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
