import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";

/**
 * The in-flight / failed provision surface. The shell drives it: on the review screen's
 * `provision-requested` it switches here and POSTs, mapping the outcome onto this screen's two props
 * (`apps/setup/src/setup-app.ts`). This screen renders state, it does not POST — a success takes the
 * shell to `done`, so the only thing shown here is progress or a mapped failure.
 *
 * - While the POST is IN FLIGHT (`message` is `undefined`): a plain, non-spinner "Provisioning…"
 *   status and a DISABLED provision control, so a second submit is impossible while one is running.
 * - On a FAILURE that stays here (`message` set): a `role="alert"` banner with the mapped message,
 *   plus — only when `canRetry` — a "Try again" control that re-emits `provision-requested` for the
 *   shell to retry. The fiscal double-provision refusals set `canRetry=false`: re-POSTing a box that
 *   is already set up is meaningless AND unrecoverable (CLAUDE.md §5), so no retry is offered.
 */
@customElement("setup-provisioning-screen")
export class SetupProvisioningScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .status {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }

      .error {
        color: var(--wt-color-danger);
        margin: var(--wt-space-3) 0 0;
      }

      .actions {
        display: flex;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
    `,
  ];

  /** The mapped failure message. `undefined` means the POST is in flight (no failure yet). */
  @property() message?: string;

  /** Whether a failed provision may be retried. Never true for the two fiscal 409 refusals. */
  @property({ type: Boolean }) canRetry = false;

  #retry(): void {
    this.dispatchEvent(new CustomEvent("provision-requested", { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    if (this.message !== undefined) {
      return html`
        <wt-card>
          <h1>Provisioning</h1>
          <p class="error" role="alert" data-test="error">${this.message}</p>
          ${
            this.canRetry
              ? html`<div class="actions">
                  <wt-button variant="primary" data-test="retry" @click=${() => this.#retry()}
                    >Try again</wt-button
                  >
                </div>`
              : nothing
          }
        </wt-card>
      `;
    }
    return html`
      <wt-card>
        <h1>Provisioning this box</h1>
        <p class="status" data-test="status">
          Provisioning… this can take a moment. Keep this page open.
        </p>
        <wt-button variant="primary" data-test="provision" ?disabled=${true}
          >Provisioning…</wt-button
        >
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-provisioning-screen": SetupProvisioningScreen;
  }
}
