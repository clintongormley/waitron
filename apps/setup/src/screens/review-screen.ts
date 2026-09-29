import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { actionsStyles, errorStyles } from "../form-styles.js";
import { dispatchProvisionRequested, dispatchSetupGoto } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import { countryName } from "../country-name.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import type { ProvisionBody } from "../api/client.js";

const MODE_KEYS = {
  demo: "review.mode_value.demo",
  prepare: "review.mode_value.prepare",
  live: "review.mode_value.live",
} as const satisfies Record<ProvisionBody["mode"], StringKey>;

function modeName(mode: string | undefined): string {
  if (mode === undefined) return "—";
  return Object.hasOwn(MODE_KEYS, mode) ? t(MODE_KEYS[mode as keyof typeof MODE_KEYS]) : mode;
}

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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

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
      <h1>${t("review.heading")}</h1>
      <p>${t("review.intro")}</p>
      ${this.draft.mode === "demo" ? html`<p data-test="demo-defaults">${t("review.demo_defaults")}</p>` : nothing}
      <dl>
        <dt>${t("review.mode")}</dt>
        <dd data-test="summary-mode">${modeName(this.draft.mode)}</dd>
        <dt>${t("review.country")}</dt>
        <dd data-test="summary-country">
          ${venue?.country === undefined ? "—" : countryName(venue.country, currentLocale())}
        </dd>
        <dt>${t("review.tax_id")}</dt>
        <dd data-test="summary-taxId">${venue?.taxId ?? "—"}</dd>
        <dt>${t("review.legal_name")}</dt>
        <dd data-test="summary-legalName">${venue?.legalName ?? "—"}</dd>
        <dt>${t("review.location")}</dt>
        <dd data-test="summary-location">${location?.name ?? "—"}</dd>
        <dt>${t("review.address")}</dt>
        <dd data-test="summary-address">
          ${[location?.addressLine1, location?.addressLine2, location?.postalCode, location?.city, location?.province].filter(Boolean).join(", ") || "—"}
        </dd>
        <dt>${t("review.invoice_locales")}</dt>
        <dd data-test="summary-invoiceLocales">${location?.invoiceLocales?.join(", ") ?? "—"}</dd>
        <dt>${t("review.operation_description")}</dt>
        <dd data-test="summary-operationDescription">${location?.operationDescription ?? "—"}</dd>
        <dt>${t("review.day_cutover")}</dt>
        <dd data-test="summary-dayCutover">${location?.dayCutover ?? "—"}</dd>
        <dt>${t("review.till")}</dt>
        <dd data-test="summary-tillName">${venue?.tillName ?? "—"}</dd>
        <dt>${t("review.series")}</dt>
        <dd data-test="summary-seriesCode">${venue?.seriesCode ?? "—"}</dd>
        <dt>${t("review.rectificative_series")}</dt>
        <dd data-test="summary-rectificativeSeriesCode">
          ${venue?.rectificativeSeriesCode ?? "—"}
        </dd>
        <dt>${t("review.operator")}</dt>
        <dd data-test="summary-admin-name">
          ${[venue?.admin?.firstNames, venue?.admin?.lastNames].filter(Boolean).join(" ") || "—"}
        </dd>
        <dt>${t("review.operator_display_name")}</dt>
        <dd data-test="summary-admin">${venue?.admin?.displayName ?? "—"}</dd>
        <dt>${t("review.operator_email")}</dt>
        <dd data-test="summary-admin-email">${venue?.admin?.email ?? "—"}</dd>
        <dt>${t("review.cert")}</dt>
        <dd data-test="summary-cert">
          ${certAttached ? t("review.cert_attached") : t("review.cert_not_attached")}
        </dd>
      </dl>
      ${
        this.errorMessage === undefined
          ? nothing
          : html`<p class="error" role="alert" data-test="error">${this.errorMessage}</p>`
      }
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}
          >${t("review.back")}</wt-button
        >
        <wt-button variant="primary" data-test="provision" @click=${() => this.#provision()}
          >${t("review.provision")}</wt-button
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
