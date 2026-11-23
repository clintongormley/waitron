import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { cardFrameStyles, cardRaisedStyles } from "@waitron/ui-core/components/wt-card";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";
import "./wt-icon.js";

export interface SummaryField {
  label: string;
  value: string;
  /** Drawn in italic, as a field's placeholder is: what a blank field will use, not its own value. */
  placeholder?: boolean;
  /** Drawn in the warning colour, for a value that needs someone's attention. */
  warning?: boolean;
}

export interface SummaryRow {
  fields: readonly SummaryField[];
  /** The row is cut with an ellipsis after this many lines. */
  lines: number;
}

const summaryPart = ({ label, value, placeholder, warning }: SummaryField) => {
  const shown = warning ? html`<span class="summary-warning">${value}</span>` : value;
  return html`<span class="summary-label">${label}:</span> ${
      placeholder ? html`<span class="summary-placeholder">${shown}</span>` : shown
    }`;
};

const summaryParts = (fields: readonly SummaryField[]) =>
  fields.map((field, index) => html`${index ? " · " : nothing}${summaryPart(field)}`);

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
        /* At least half a help badge's target, so the heading's badge stays inside the section. */
        padding-block-start: max(var(--wt-space-3), calc(var(--wt-help-badge-target) / 2));
      }

      .head {
        position: relative;
        display: flex;
      }

      .head > .header {
        flex: 1;
        min-width: 0;
      }

      .body {
        transition: height var(--wt-duration-disclosure) ease;
      }

      .body.animating {
        overflow: hidden;
      }

      @media (prefers-reduced-motion: reduce) {
        .body {
          transition: none;
        }
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

      .summary-placeholder {
        font-style: italic;
      }

      .summary-warning {
        color: var(--wt-color-warning);
      }

      .summary-rows {
        display: flex;
        flex-direction: column;
      }

      .summary-slot {
        grid-column: 1 / -1;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .summary-row {
        /* A hanging indent: a row that wraps sets its later lines in from its first. */
        padding-inline-start: var(--wt-space-4);
        text-indent: calc(-1 * var(--wt-space-4));
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
        width: var(--wt-font-size-sm);
        height: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        transition: transform 150ms ease;
      }

      @media (prefers-reduced-motion: reduce) {
        .chevron {
          transition: none;
        }
      }

      :host([open]) .chevron {
        transform: rotate(180deg);
      }

      .summary-slot.fade-in {
        animation: wt-disclosure-summary-in var(--wt-duration-disclosure) ease;
      }

      @keyframes wt-disclosure-summary-in {
        from {
          opacity: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .summary-slot.fade-in {
          animation: none;
        }
      }

      :host([card]) .section {
        ${cardFrameStyles}
        ${cardRaisedStyles}
      }
    `,
  ];

  @property() heading = "";
  @property() summary = "";
  /** The closed line as named values, each after its name; used instead of `summary` when it
   * holds any. */
  @property({ attribute: false }) summaryFields: readonly SummaryField[] = [];
  /** The closed line as rows of named values, each row cut with an ellipsis after its `lines`
   * lines; used instead of `summaryFields` and `summary` when it holds any. */
  @property({ attribute: false }) summaryRows: readonly SummaryRow[] = [];
  /** Drawn as a raised card, as `<wt-card raised>` is. */
  @property({ type: Boolean, reflect: true }) card = false;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean, reflect: true, attribute: "has-error" }) hasError = false;

  private readonly bodyId = uniqueId("wt-disclosure-body");
  private bodyHidden = true;
  private openingFromHidden = false;
  /** While a close animates, the summary waits, so it never shows over the shrinking body. */
  private closing = false;
  /** Set by a close, so a summary already showing when the section first draws does not fade. */
  private summaryFades = false;
  private firstRender = true;
  private animationFrame = 0;
  private animationGeneration = 0;
  private motionQuery?: MediaQueryList;
  private contentObserver?: ResizeObserver;
  private readonly settlement = new Set<() => void>();

  async whenSettled(): Promise<void> {
    await this.updateComplete;
    if (this.isConnected && this.shadowRoot?.querySelector(".body.animating"))
      await new Promise<void>((resolve) => this.settlement.add(resolve));
  }

  private finishAnimation(body?: HTMLElement): void {
    cancelAnimationFrame(this.animationFrame);
    this.contentObserver?.disconnect();
    this.contentObserver = undefined;
    if (body) {
      body.style.height = "";
      body.classList.remove("animating");
      this.bodyHidden = !this.open;
      body.hidden = this.bodyHidden;
    }
    if (this.closing) {
      this.closing = false;
      this.requestUpdate();
    }
    for (const resolve of this.settlement) resolve();
    this.settlement.clear();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    this.motionQuery.addEventListener?.("change", this.onMotionChange);
  }

  override disconnectedCallback(): void {
    this.motionQuery?.removeEventListener?.("change", this.onMotionChange);
    ++this.animationGeneration;
    this.finishAnimation(this.shadowRoot?.querySelector<HTMLElement>(".body") ?? undefined);
    super.disconnectedCallback();
  }

  private onMotionChange = (event: MediaQueryListEvent): void => {
    if (!event.matches || !this.hasUpdated) return;
    const body = this.shadowRoot?.querySelector<HTMLElement>(".body");
    if (!body?.classList.contains("animating")) return;
    ++this.animationGeneration;
    this.finishAnimation(body);
  };

  override willUpdate(changed: PropertyValues<this>): void {
    // A cleared error leaves the section open: collapsing it the moment the last error is fixed would
    // hide the field being typed into.
    if (changed.has("hasError") && this.hasError) this.open = true;
    if (this.open) {
      this.openingFromHidden = this.bodyHidden;
      this.bodyHidden = false;
      this.closing = false;
    } else {
      this.openingFromHidden = false;
      if (changed.has("open") && this.hasUpdated) this.summaryFades = true;
      // The same tests `updated` uses to skip the animation, so a close that will not animate
      // shows its summary in this render.
      if (changed.has("open") && this.hasUpdated && !this.hasError && !this.motionQuery?.matches)
        this.closing =
          (this.shadowRoot?.querySelector(".body")?.getBoundingClientRect().height ?? 0) > 0;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (this.firstRender) {
      this.firstRender = false;
      return;
    }
    if (!changed.has("open")) return;
    const body = this.shadowRoot!.querySelector<HTMLElement>(".body")!;
    body.hidden = false;
    const generation = ++this.animationGeneration;
    cancelAnimationFrame(this.animationFrame);
    this.contentObserver?.disconnect();
    this.contentObserver = undefined;
    const height = this.openingFromHidden ? 0 : body.getBoundingClientRect().height;
    let targetHeight = this.open ? body.scrollHeight : 0;
    if (this.hasError || this.motionQuery?.matches || height === targetHeight) {
      this.finishAnimation(body);
      return;
    }
    body.classList.add("animating");
    body.style.height = `${height}px`;
    void body.offsetHeight;
    this.animationFrame = requestAnimationFrame(() => {
      if (generation !== this.animationGeneration) return;
      body.style.height = `${targetHeight}px`;
      // A body that stopped being drawn starts no transition, so no event would ever settle it.
      if (!this.heightTransitionRunning(body)) this.finishAnimation(body);
    });
    if (this.open) {
      this.contentObserver = new ResizeObserver(() => {
        if (generation !== this.animationGeneration || !body.classList.contains("animating"))
          return;
        const nextHeight = body.scrollHeight;
        if (nextHeight === targetHeight) return;
        targetHeight = nextHeight;
        body.style.height = `${targetHeight}px`;
      });
      // The body has a fixed animation height; its assigned content reports nested growth.
      for (const content of body.querySelector("slot")!.assignedElements())
        this.contentObserver.observe(content);
    }
  }

  private onBodyTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== "height" || event.target !== event.currentTarget) return;
    this.finishAnimation(event.currentTarget as HTMLElement);
  }

  private heightTransitionRunning(body: HTMLElement): boolean {
    return body
      .getAnimations()
      .some(
        (animation) =>
          animation instanceof CSSTransition && animation.transitionProperty === "height",
      );
  }

  /** A transition is cancelled when a parent stops being drawn, and also when a newer toggle or a
   * content resize retargets it; only the first leaves no height transition running. */
  private onBodyTransitionCancel(event: TransitionEvent): void {
    if (event.propertyName !== "height" || event.target !== event.currentTarget) return;
    const body = event.currentTarget as HTMLElement;
    if (!body.classList.contains("animating")) return;
    if (this.heightTransitionRunning(body)) return;
    this.finishAnimation(body);
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
          ({ fields, lines }) =>
            html`<span
              class="summary-row"
              style=${styleMap({ "--summary-row-lines": String(lines) })}
              >${summaryParts(fields)}</span
            >`,
        )}</span
      >`;
    if (this.summaryFields.length)
      return html`<span class="summary">${summaryParts(this.summaryFields)}</span>`;
    return this.summary ? html`<span class="summary">${this.summary}</span>` : nothing;
  }

  override render() {
    return html`
      <div class="section" part="section">
        <div class="head">
          <button
            type="button"
            class="header"
            part="header"
            aria-expanded=${this.open ? "true" : "false"}
            aria-controls=${this.bodyId}
            @click=${this.onToggle}
          >
            <span class="heading">${this.heading}</span
            ><wt-icon class="chevron" name="chevron-down"></wt-icon>
            ${this.open || this.closing ? nothing : html`<span class=${this.summaryFades ? "summary-slot fade-in" : "summary-slot"} part="summary"><slot name="summary">${this.renderSummary()}</slot></span>`}
          </button>
          <slot name="help"></slot>
        </div>
        <div
          id=${this.bodyId}
          class="body"
          ?hidden=${this.bodyHidden}
          ?inert=${!this.open}
          aria-hidden=${this.open ? "false" : "true"}
          @transitionend=${this.onBodyTransitionEnd}
          @transitioncancel=${this.onBodyTransitionCancel}
        >
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
