import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { capitaliseFirst } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, type ComboboxOption } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi } from "../api/client.js";
import { lastEndedQuarter } from "../date-utils.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";

type Field = "year" | "period" | "declarationType";

const YEARS_OFFERED = 5;
/** AEAT's order, from packages/reporting/reference/DR303e26.xlsx. */
const DECLARATION_TYPES = ["C", "D", "G", "I", "N", "V"] as const;
const REFUSED: Record<Field, StringKey> = {
  year: "vat_return.year_refused",
  period: "vat_return.period_refused",
  declarationType: "vat_return.type_refused",
};

function isField(value: unknown): value is Field {
  return value === "year" || value === "period" || value === "declarationType";
}

function periodOptions(): ComboboxOption[] {
  const quarters = ([1, 2, 3, 4] as const).map((quarter) => ({
    value: `${quarter}T`,
    label: t(`vat_return.quarter_${quarter}`),
    group: t("vat_return.quarters"),
  }));
  const locale = currentLocale();
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const months = Array.from({ length: 12 }, (_, index) => {
    const token = String(index + 1).padStart(2, "0");
    const name = capitaliseFirst(monthName.format(Date.UTC(2000, index, 1)), locale);
    return { value: token, label: `${name} (${token})`, group: t("vat_return.months") };
  });
  return [...quarters, ...months];
}

/**
 * Downloads the DR303 file the server builds for one period. It files nothing and sends nothing to
 * AEAT: the operator uploads the file themselves.
 */
@customElement("dashboard-vat-return-screen")
export class VatReturnScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .intro {
        max-width: var(--wt-form-max-width);
        margin: 0 0 var(--wt-space-6);
        color: var(--wt-color-text-muted);
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        max-width: var(--wt-form-max-width);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  readonly #thisYear: number;
  @state() private year: string;
  @state() private period: string;
  @state() private declarationType = "";
  @state() private attempted = false;
  @state() private busy = false;
  /** A refusal's sentence under the field it names, until that field changes or the next press. */
  @state() private refused: Partial<Record<Field, string>> = {};
  /** A refusal that names no field shown here. */
  @state() private refusal = "";

  constructor() {
    super();
    const now = new Date();
    const last = lastEndedQuarter(now);
    this.#thisYear = now.getFullYear();
    this.year = String(last.year);
    this.period = `${last.quarter}T`;
  }

  get #typeMissing(): boolean {
    return this.attempted && this.declarationType === "";
  }

  #change(field: Field, value: string): void {
    this[field] = value;
    const refused = { ...this.refused };
    delete refused[field];
    this.refused = refused;
  }

  async #download(): Promise<void> {
    if (this.busy) return;
    this.attempted = true;
    this.refused = {};
    this.refusal = "";
    if (this.declarationType === "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    // The fields stay editable while the file is asked for.
    const sent = { year: this.year, period: this.period, declarationType: this.declarationType };
    this.busy = true;
    try {
      const file = await this.api.downloadVatReturnFile({ ...sent, year: Number(sent.year) });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `modelo-303-${sent.year}-${sent.period}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      this.attempted = false;
    } catch (error) {
      const code = codeOf(error);
      const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
      if (code === "management.request_invalid" && isField(field) && this[field] === sent[field]) {
        this.refused = { [field]: t(REFUSED[field]) };
        void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      } else this.refusal = codeMessage(code);
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const years = Array.from({ length: YEARS_OFFERED }, (_, index) => {
      const year = String(this.#thisYear - index);
      return { value: year, label: year };
    });
    const types = DECLARATION_TYPES.map((type) => ({
      value: type,
      label: t(`vat_return.type_${type}`),
    }));
    const typeError = this.#typeMissing
      ? t("vat_return.type_required")
      : (this.refused.declarationType ?? "");
    const marked = typeError !== "" || Object.keys(this.refused).length > 0;
    return html`<h1>${t("vat_return.title")}</h1>
      <p class="intro">${t("vat_return.intro")}</p>
      <div class="form">
        <wt-combobox
          name="year"
          label=${t("vat_return.year")}
          required
          search="never"
          .options=${years}
          .value=${this.year}
          error=${this.refused.year ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            this.#change("year", event.detail.value)}
        ></wt-combobox>
        <wt-combobox
          name="period"
          label=${t("vat_return.period")}
          required
          search="never"
          .options=${periodOptions()}
          .value=${this.period}
          error=${this.refused.period ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            this.#change("period", event.detail.value)}
        ></wt-combobox>
        <wt-combobox
          name="declarationType"
          label=${t("vat_return.declaration_type")}
          required
          search="never"
          placeholder=${t("vat_return.choose_type")}
          .options=${types}
          .value=${this.declarationType}
          error=${typeError}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            this.#change("declarationType", event.detail.value)}
        ></wt-combobox>
        <wt-form-actions .error=${marked ? t("form.fix_fields") : this.refusal}>
          <wt-button
            variant="primary"
            data-test="download"
            ?loading=${this.busy}
            ?disabled=${this.#typeMissing}
            @click=${() => void this.#download()}
            >${t("vat_return.download")}</wt-button
          >
        </wt-form-actions>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-vat-return-screen": VatReturnScreen;
  }
}
