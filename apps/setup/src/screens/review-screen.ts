import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { errorStyles } from "../form-styles.js";
import { modePill, modePillStyles } from "../mode-pill.js";
import { dispatchProvisionRequested, dispatchSetupGoto } from "../events.js";
import type { DeepPartial, Screen } from "../setup-app.js";
import { countryName } from "../country-name.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { RECEIPT_LANGUAGES } from "../receipt-languages.js";
import type { ProvisionBody } from "../api/client.js";

/** Never renders a secret: no PIN, password, certificate passphrase or PFX bytes — the certificate
 * appears only as attached or not. */
@customElement("setup-review-screen")
export class SetupReviewScreen extends LitElement {
  static override styles = [
    baseStyles,
    errorStyles,
    modePillStyles,
    css`
      :host {
        display: block;
      }
      .mode {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin: var(--wt-space-4) 0;
      }
      .mode p {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .groups {
        display: grid;
        gap: var(--wt-space-4);
        margin: var(--wt-space-4) 0;
      }
      .group {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3) var(--wt-space-4);
        background: var(--wt-color-surface);
        min-width: 0;
      }
      .group-header {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .group-help {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
      }
      .group-header wt-button {
        margin-inline-start: auto;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
        gap: var(--wt-space-2) var(--wt-space-4);
        margin: var(--wt-space-3) 0 0;
      }
      dt {
        color: var(--wt-color-text-muted);
        display: flex;
        align-items: center;
      }
      dd {
        margin: 0;
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
        align-self: center;
      }
      .row-edit {
        margin-inline-start: var(--wt-space-2);
      }
      @media (max-width: 540px) {
        dl {
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
        }
        dd {
          margin-block-end: var(--wt-space-2);
        }
      }
    `,
  ];

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};
  @property() errorMessage?: string;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #row(label: StringKey, value: unknown, testId: string): TemplateResult {
    return html`<dt>${t(label)}</dt>
      <dd data-test=${testId}>${value ?? "—"}</dd>`;
  }

  #group(
    id: string,
    title: StringKey,
    help: StringKey,
    edit: Screen,
    rows: TemplateResult,
  ): TemplateResult {
    return html`<section class="group" data-group=${id} aria-labelledby=${`group-${id}`}>
      <div class="group-header">
        <h2 id=${`group-${id}`}>${t(title)}</h2>
        <wt-button
          variant="ghost"
          data-test="edit"
          aria-label=${`${t("review.edit")} ${t(title)}`}
          @click=${() => dispatchSetupGoto(this, edit)}
          >${t("review.edit")}</wt-button
        >
      </div>
      <p class="group-help">${t(help)}</p>
      <dl>${rows}</dl>
    </section>`;
  }

  override render(): TemplateResult {
    const venue = this.draft.venue;
    const location = venue?.location;
    const certAttached = Boolean(this.draft.aeatCert?.pfxBase64);
    const accountName = [venue?.admin?.firstNames, venue?.admin?.lastNames]
      .filter(Boolean)
      .join(" ");
    const displayName = venue?.admin?.displayName;
    const mode = this.draft.mode;
    return html`
      <h1>${t("review.heading")}</h1>
      <p>${t("review.intro")}</p>
      <div class="mode">
        ${modePill(mode, "mode-badge")}
        ${mode === "demo" ? html`<p data-test="demo-defaults">${t("review.demo_defaults")}</p>` : nothing}
      </div>
      <div class="groups">
        ${this.#group(
          "business",
          "review.group.business",
          "review.help.business",
          "venue",
          html`
            ${this.#row("review.legal_name", venue?.legalName, "summary-legalName")}
            ${this.#row("review.tax_id", venue?.taxId, "summary-taxId")}
            ${this.#row("review.country", venue?.country === undefined ? "—" : countryName(venue.country, currentLocale()), "summary-country")}
          `,
        )}
        ${this.#group(
          "location",
          "review.group.location",
          "review.help.location",
          "venue",
          html`
            ${this.#row("review.location", location?.name, "summary-location")}
            ${this.#row("review.address", [location?.addressLine1, location?.addressLine2, location?.postalCode, location?.city, location?.province].filter(Boolean).join(", ") || "—", "summary-address")}
            ${this.#row("review.invoice_locales", location?.invoiceLocales?.map((locale) => RECEIPT_LANGUAGES[locale]?.nativeName ?? locale).join(", "), "summary-invoiceLocales")}
            ${this.#row("review.day_cutover", location?.dayCutover, "summary-dayCutover")}
          `,
        )}
        ${this.#group(
          "invoicing",
          "review.group.invoicing",
          "review.help.invoicing",
          "venue",
          html`
            ${this.#row("review.till", venue?.tillName, "summary-tillName")}
            ${this.#row("review.series", venue?.seriesCode, "summary-seriesCode")}
            ${this.#row("review.rectificative_series", venue?.rectificativeSeriesCode, "summary-rectificativeSeriesCode")}
            ${this.#row("review.operation_description", location?.operationDescription, "summary-operationDescription")}
            ${
              mode === "demo"
                ? nothing
                : html`<dt>${t("review.cert")}</dt>
                    <dd>
                      <span data-test="summary-cert"
                        >${certAttached ? t("review.cert_attached") : t("review.cert_not_attached")}</span
                      ><wt-button
                        class="row-edit"
                        variant="ghost"
                        data-test="edit-cert"
                        @click=${() => dispatchSetupGoto(this, "cert")}
                        >${t("review.edit")}</wt-button
                      >
                    </dd>`
            }
          `,
        )}
        ${this.#group(
          "account",
          "review.group.account",
          "review.help.account",
          "admin",
          html`
            ${this.#row("review.operator", accountName || "—", "summary-admin-name")}
            ${displayName && displayName !== accountName ? this.#row("review.operator_display_name", displayName, "summary-admin") : nothing}
            ${this.#row("review.operator_email", venue?.admin?.email, "summary-admin-email")}
          `,
        )}
      </div>
      ${this.errorMessage === undefined ? nothing : html`<p class="error" role="alert" data-test="error">${this.errorMessage}</p>`}
      <wt-form-actions>
        <wt-button
          slot="cancel"
          variant="ghost"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "venue")}
          >${t("review.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="provision"
          @click=${() => dispatchProvisionRequested(this)}
          >${t("review.provision")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-review-screen": SetupReviewScreen;
  }
}
