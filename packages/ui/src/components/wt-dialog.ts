import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { uniqueId } from "../interactive.js";
import {
  type FormErrorEvent,
  formMessage,
  formMessageStyles,
  WtFormActions,
} from "./wt-form-actions.js";

@customElement("wt-dialog")
export class WtDialog extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
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

      .body > .form-message {
        margin: var(--wt-space-4) 0 0;
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

  /** Whether Escape may close this dialog. Off for a surface with nothing behind it — the setup
   * wizard is the whole page, so a dismissed dialog would strand the operator on an empty document.
   * An absent boolean attribute reads as false in Lit, so a caller turns this off with the property
   * binding `.dismissible=${false}`, never `?dismissible`.
   *
   * Off, the inner dialog carries `closedby="none"`: refusing `cancel` is not enough, because
   * Playwright's Chromium 153 and WebKit (Safari 26.6) builds both sent a second Escape's `cancel`
   * uncancelable and closed the dialog. A close the caller did not ask for while this is off — a
   * browser without `closedby`, or a `close()` from outside — shows the dialog again. */
  @property({ type: Boolean }) dismissible = true;

  // Shadows the native ARIAMixin accessor so a caller's aria-label reaches the inner <dialog> when
  // there is no `heading` to name it.
  @property({ attribute: "aria-label" }) override ariaLabel: string | null = null;

  private readonly headingId = uniqueId("wt-dialog-heading");

  /** The messages of the `wt-form-actions` rows in the footer, shown at the end of the body instead,
   * so they sit below the fields they are about rather than between the pinned buttons. */
  @state() private footerMessage = "";
  private footerActions: WtFormActions[] = [];

  /** True from a field's `input` event until the task it arrived in ends. A message that changes
   * within that task is taken to be the form re-checking the edit, and is not scrolled to: that would
   * carry the field out of sight. A refusal from a request arrives in a later task. */
  private editing = false;

  constructor() {
    super();
    // Captured, so this runs before the field's own listeners: the browser runs microtasks after
    // each listener it calls, so a form's re-check has rendered before a bubbling listener here
    // would run. wt-input also stops the event inside its own shadow root.
    this.addEventListener(
      "input",
      () => {
        this.editing = true;
        setTimeout(() => (this.editing = false));
      },
      { capture: true },
    );
  }

  @query("dialog") private dialog!: HTMLDialogElement;
  @query(".footer") private footerEl!: HTMLElement;
  @query('slot[name="footer"]') private footerSlot!: HTMLSlotElement;

  override willUpdate(): void {
    if (this.hasUpdated) return;
    // The footer slot does not exist until the first render, and a message read from it only then
    // costs a second update. The slot's own reading in firstUpdated stays the authority: a row
    // reached through a forwarded slot is found only there.
    this.footerActions = [...this.children].filter(
      (child): child is WtFormActions => child instanceof WtFormActions && child.slot === "footer",
    );
    this.readFooterMessage();
  }

  override firstUpdated(): void {
    this.updateHasFooter();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("open")) {
      if (this.open && !this.dialog.open) this.dialog.showModal();
      if (!this.open && this.dialog.open) this.dialog.close();
    }
    // A footer row's message set while the dialog was shut could not be scrolled to then, so
    // opening does it.
    if (changed.has("open") || (changed.has("footerMessage") && !this.editing)) {
      this.renderRoot.querySelector(".body > [data-error]")?.scrollIntoView({ block: "nearest" });
    }
  }

  private onClose(): void {
    // The browser reports a close a task after it happens, so a dialog shut and reopened in between
    // still gets the report; honouring it would shut the reopened dialog.
    if (this.dialog.open) return;
    if (this.open && !this.dismissible) {
      this.dialog.showModal();
      return;
    }
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  private onCancel(event: Event): void {
    if (!this.dismissible) event.preventDefault();
  }

  private updateHasFooter(): void {
    const assigned = this.footerSlot.assignedNodes({ flatten: true });
    // Toggled imperatively rather than through a reactive property, so a `slotchange` does not
    // schedule another Lit update just to flip a class.
    this.footerEl.classList.toggle("has-content", assigned.length > 0);
    const actions = assigned.filter((node) => node instanceof WtFormActions);
    for (const gone of this.footerActions) if (!actions.includes(gone)) gone.showError = true;
    for (const each of actions) each.showError = false;
    this.footerActions = actions;
    this.readFooterMessage();
  }

  /** Every footer row's message, so one row's change cannot hide or clear another's. */
  private readFooterMessage(): void {
    this.footerMessage = this.footerActions
      .map((each) => each.error)
      .filter((message) => message !== "")
      .join(" ");
  }

  /** A row in the body shows its own message, which may be below the scrolled-to part of a long
   * body. The row dispatches the event once it has rendered, so the message is already there. */
  private onBodyMessage(event: FormErrorEvent): void {
    const row = event.composedPath()[0];
    if (row instanceof WtFormActions && !this.editing) {
      row.shadowRoot!.querySelector("[data-error]")?.scrollIntoView({ block: "nearest" });
    }
  }

  override render() {
    return html`
      <dialog
        @close=${this.onClose}
        @cancel=${this.onCancel}
        closedby=${this.dismissible ? "closerequest" : "none"}
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
          <slot @wt-form-error=${this.onBodyMessage}></slot>
          ${formMessage(this.footerMessage)}
        </div>
        <div class="footer">
          <slot
            name="footer"
            @slotchange=${this.updateHasFooter}
            @wt-form-error=${this.readFooterMessage}
          ></slot>
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
