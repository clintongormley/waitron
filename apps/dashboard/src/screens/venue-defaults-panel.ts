import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { vatRateOn, localToday, type VatClass } from "@waitron/catalogue/src/vat-rates.js";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { vatClassName } from "../i18n/domain.js";
import { fill, t } from "../i18n/t.js";
import { receiptLanguageName, receiptLanguageWarning } from "../widgets/receipt-language.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";

export function vatClassLabel(value: VatClass): string {
  const rate = vatRateOn(value, localToday()).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
  return `${vatClassName(value)} (${rate}%)`;
}

@customElement("dashboard-venue-defaults-panel")
export class VenueDefaultsPanel extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      p {
        margin: var(--wt-space-3) 0 0;
      }
      .warning {
        padding: var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private model?: VenueDefaults;
  @state() private content?: ContentLanguages;
  @state() private readError = "";
  #generation = 0;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );
  readonly #contentQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.content = undefined;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    await Promise.all([
      this.#queries
        .watch("getVenueDefaults", [], (value) => {
          if (generation !== this.#generation) return;
          this.model = value;
          this.readError = "";
        })
        .catch(() => {}),
      this.#contentQueries
        .watch("getContentLanguages", [], (value) => {
          if (generation === this.#generation) this.content = value;
        })
        .catch(() => {}),
    ]);
  }
  override render() {
    const model = this.model;
    const fixed = model?.fixedReceiptLanguage;
    return html`${
      this.readError
        ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>
            <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
        : nothing
    }
    ${
      model
        ? settingsCard({
            id: "defaults-card",
            heading: t("venue_settings.card.defaults"),
            editing: false,
            action: html`<wt-button data-test="edit">${t("action.edit")}</wt-button>`,
            body: html`${settingsRows([
              {
                label: t("receipts.language"),
                value: receiptLanguageName(model.receiptLanguage),
                dataTest: "saved-receiptLanguage",
              },
              {
                label: t("catalogue_settings.default_vat"),
                value: vatClassLabel(model.defaultProductVatClass),
                dataTest: "saved-defaultProductVatClass",
              },
            ])}
            ${this.content ? receiptLanguageWarning(model.receiptLanguage, this.content) : nothing}
            ${
              fixed && fixed !== model.receiptLanguage
                ? html`<p class="warning" role="note" data-test="stored-differs">
                    ${fill("receipts.language_stored", {
                      stored: receiptLanguageName(model.receiptLanguage, false),
                      fixed: receiptLanguageName(fixed, false),
                    })}
                  </p>`
                : nothing
            }`,
          })
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-defaults-panel": VenueDefaultsPanel;
  }
}
