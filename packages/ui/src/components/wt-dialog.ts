import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";

@customElement("wt-dialog")
export class WtDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      dialog {
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        max-width: var(--wt-dialog-max-width);
      }

      dialog::backdrop {
        background: var(--wt-color-scrim);
      }

      .body {
        padding: var(--wt-space-5);
      }

      h2 {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-lg);
      }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wt-space-2);
      }

      /* The padding and divider only make sense once there is something to
         divide from the body — an empty footer slot must not leave a bare
         bar across the bottom of the dialog. */
      .footer.has-content {
        padding: var(--wt-space-3) var(--wt-space-5);
        border-top: 1px solid var(--wt-color-border);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = "";

  // Shadows the native ARIAMixin accessor (same pattern as wt-button) so a caller-supplied
  // aria-label reaches the inner shadow <dialog> when there is no `heading` to derive a name
  // from. When `heading` IS set, aria-labelledby (pointing at the <h2>) takes precedence — see
  // render() below.
  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;

  // Unique per instance so a page with multiple wt-dialog elements never collides the <h2> id
  // that aria-labelledby points at.
  private readonly headingId = uniqueId("wt-dialog-heading");

  @query("dialog") private dialog!: HTMLDialogElement;
  @query(".footer") private footerEl!: HTMLElement;
  @query('slot[name="footer"]') private footerSlot!: HTMLSlotElement;

  override firstUpdated(): void {
    this.updateHasFooter();
  }

  override updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (this.open && !this.dialog.open) this.dialog.showModal();
    if (!this.open && this.dialog.open) this.dialog.close();
  }

  private onClose(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  // Toggled imperatively (not via a reactive property) so that discovering
  // footer content — at first render and again on every later `slotchange` —
  // never schedules an extra Lit update cycle just to flip a CSS class. The
  // footer's padding/divider only apply once something is actually
  // projected into the "footer" slot; an empty footer must not leave a bare
  // bar across the bottom of the dialog.
  private updateHasFooter(): void {
    const hasFooter = this.footerSlot.assignedNodes({ flatten: true }).length > 0;
    this.footerEl.classList.toggle("has-content", hasFooter);
  }

  override render() {
    return html`
      <dialog
        @close=${this.onClose}
        role="dialog"
        aria-labelledby=${this.heading ? this.headingId : nothing}
        aria-label=${!this.heading && this.ariaLabel ? this.ariaLabel : nothing}
      >
        <!-- role="dialog" restates what a native <dialog> already implies once opened modally,
             but it is not purely decorative: axe-core's "aria-dialog-name" check (which is what
             actually verifies the accessible-name wiring above) only runs against elements with
             an *explicit* role="dialog"/"alertdialog" attribute — it does not infer the implicit
             role of a bare <dialog>. Confirmed empirically while wiring up a11y tests: stripping
             aria-labelledby/aria-label from a dialog with no explicit role produced zero axe
             violations, even fully nameless; adding role="dialog" made the same break get
             flagged. Removing this attribute would silently blind wt-dialog.a11y.test.ts. -->
        <div class="body">
          ${this.heading ? html`<h2 id=${this.headingId}>${this.heading}</h2>` : nothing}
          <slot></slot>
        </div>
        <div class="footer">
          <slot name="footer" @slotchange=${this.updateHasFooter}></slot>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-dialog": WtDialog;
  }
}
