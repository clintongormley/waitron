import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles, errorStyles, statusStyles } from "../form-styles.js";

/**
 * The in-flight / failed provision surface. The shell drives it: on the review screen's
 * `provision-requested` it switches here and POSTs, mapping the outcome onto this screen's two props
 * (`apps/setup/src/setup-app.ts`). This screen renders state, it does not POST — a success takes the
 * shell to `done`, so the only thing shown here is progress or a mapped failure.
 *
 * - While the POST is IN FLIGHT (`message` is `undefined`): a plain, non-spinner "Provisioning…"
 *   status and a DISABLED provision control, so a second submit is impossible while one is running.
 * - On a RETRYABLE failure (`message` set, `canRetry`): a `role="alert"` banner with the mapped
 *   message, plus a "Try again" control that re-emits `provision-requested` for the shell to retry.
 * - On a TERMINAL failure (`message` set, `canRetry=false`, `reloadLabel` set): the same banner, but
 *   its action is a RELOAD ({@link SetupProvisioningScreen.reload}, the real `location.reload`), not a
 *   retry — re-POSTing a box that is already set up is meaningless AND unrecoverable (CLAUDE.md §5), so
 *   the operator is pointed onward (into the till, or to re-read status) rather than left on a dead-end
 *   alert. The shell picks the label per code (`apps/setup/src/setup-app.ts`): "Reload to open the
 *   till" for the already-provisioned box, "Reload" for a provision already in progress.
 */
@customElement("setup-provisioning-screen")
export class SetupProvisioningScreen extends LitElement {
  static override styles = [
    baseStyles,
    statusStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** The mapped failure message. `undefined` means the POST is in flight (no failure yet). */
  @property() message?: string;

  /** Whether a failed provision may be retried. Never true for the terminal 409 refusals. */
  @property({ type: Boolean }) canRetry = false;

  /**
   * The label for a TERMINAL failure's reload action ("Reload to open the till" / "Reload"), set by the
   * shell for the double-provision 409s. `undefined` for the in-flight and retryable states — its
   * presence is what renders the reload control, and it never coexists with `canRetry`.
   */
  @property() reloadLabel?: string;

  /** How to reload the page — the real `location.reload` by default, injectable so a test can spy it
   * without navigating the runner (mirrors `done-screen.ts`). A bound native, not authored code. */
  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

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
              : this.reloadLabel === undefined
                ? nothing
                : html`<div class="actions">
                    <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
                      >${this.reloadLabel}</wt-button
                    >
                  </div>`
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
