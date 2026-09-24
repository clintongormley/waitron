import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, errorStyles } from "../form-styles.js";
import { dispatchProvisionRequested, dispatchSetupGoto } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

/** Never renders a secret: no PIN, password, certificate passphrase or PFX bytes — the certificate
 * appears only as attached or not. */
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

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

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
    const certAttached = Boolean(this.draft.aeatCert?.pfxBase64);
    return html`
      <h1>Review and provision</h1>
      <p>Check the details below, then provision this server.</p>
      ${this.draft.mode === "demo" ? html`<p data-test="demo-defaults">Waitron generated a demo tax ID and supplied the business and invoice defaults below. Demo does not submit invoices to the tax agency.</p>` : nothing}
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
        <dt>Address</dt>
        <dd data-test="summary-address">
          ${[location?.addressLine1, location?.addressLine2, location?.postalCode, location?.city, location?.province].filter(Boolean).join(", ") || "—"}
        </dd>
        <dt>Invoice languages</dt>
        <dd data-test="summary-invoiceLocales">${location?.invoiceLocales?.join(", ") ?? "—"}</dd>
        <dt>Invoice operation description</dt>
        <dd data-test="summary-operationDescription">${location?.operationDescription ?? "—"}</dd>
        <dt>Business day cutover</dt>
        <dd data-test="summary-dayCutover">${location?.dayCutover ?? "—"}</dd>
        <dt>Till</dt>
        <dd data-test="summary-tillName">${venue?.tillName ?? "—"}</dd>
        <dt>Invoice series</dt>
        <dd data-test="summary-seriesCode">${venue?.seriesCode ?? "—"}</dd>
        <dt>Rectificative series</dt>
        <dd data-test="summary-rectificativeSeriesCode">
          ${venue?.rectificativeSeriesCode ?? "—"}
        </dd>
        <dt>Operator</dt>
        <dd data-test="summary-admin-name">
          ${[venue?.admin?.firstNames, venue?.admin?.lastNames].filter(Boolean).join(" ") || "—"}
        </dd>
        <dt>Operator display name</dt>
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
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
        <wt-button variant="primary" data-test="provision" @click=${() => this.#provision()}
          >Provision this server</wt-button
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
