import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles, errorStyles } from "../form-styles.js";
import { dispatchProvisionRequested, dispatchSetupGoto } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

/**
 * The wizard's confirm step: a read-only summary of everything collected, and a `Provision` button
 * that fires the whole thing off.
 *
 * It renders ONLY non-secret values. The PIN, password, certificate passphrase and PFX bytes are
 * never shown — for the operator and the certificate it shows whether each is present, not its value
 * (fiscal §5 / brief: never render the secrets). The provision itself is the shell's job: this screen
 * emits a composed/bubbling `provision-requested` and the shell (a later task) drives the POST. `Back`
 * returns to the collecting step via the shared `setup-goto`.
 */
@customElement("setup-review-screen")
export class SetupReviewScreen extends LitElement {
  static override styles = [
    baseStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin: var(--wt-space-3) 0 0;
      }

      dt {
        color: var(--wt-color-text-muted);
      }

      dd {
        margin: 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  /** The accumulated draft, passed down from the shell. Rendered read-only; secrets are never shown. */
  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  /** A mapped server error routed back here — set by the shell when the POST was rejected with
   * `setup.request_invalid`, so the operator sees why before re-provisioning. `undefined` normally. */
  @property() errorMessage?: string;

  #provision(): void {
    dispatchProvisionRequested(this);
  }

  #back(): void {
    dispatchSetupGoto(this, "venue");
  }

  override render(): TemplateResult {
    const venue = this.draft.venue;
    const location = venue?.location;
    // Present iff a PFX has actually been read in — never the value, only whether it is attached.
    const certAttached = Boolean(this.draft.aeatCert?.pfxBase64);
    return html`
      <wt-card>
        <h1>Review and provision</h1>
        <p>Check the details below, then provision this box.</p>
        <dl>
          <dt>Mode</dt>
          <dd data-test="summary-mode">${this.draft.mode ?? "—"}</dd>
          <dt>Country</dt>
          <dd data-test="summary-country">${venue?.country ?? "—"}</dd>
          <dt>Tax ID</dt>
          <dd data-test="summary-taxId">${venue?.taxId ?? "—"}</dd>
          <dt>Legal name</dt>
          <dd data-test="summary-legalName">${venue?.legalName ?? "—"}</dd>
          <dt>Location</dt>
          <dd data-test="summary-location">${location?.name ?? "—"}</dd>
          <dt>Invoice series</dt>
          <dd data-test="summary-seriesCode">${venue?.seriesCode ?? "—"}</dd>
          <dt>Rectificative series</dt>
          <dd data-test="summary-rectificativeSeriesCode">
            ${venue?.rectificativeSeriesCode ?? "—"}
          </dd>
          <dt>Operator</dt>
          <dd data-test="summary-admin">${venue?.admin?.displayName ?? "—"}</dd>
          <dt>Operator email</dt>
          <dd data-test="summary-admin-email">${venue?.admin?.email ?? "—"}</dd>
          <dt>AEAT certificate</dt>
          <dd data-test="summary-cert">${certAttached ? "attached" : "not attached"}</dd>
        </dl>
        ${
          this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="error">${this.errorMessage}</p>`
        }
      </wt-card>
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
        <wt-button variant="primary" data-test="provision" @click=${() => this.#provision()}
          >Provision this box</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-review-screen": SetupReviewScreen;
  }
}
