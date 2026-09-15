import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { Unit, UnitInput } from "../api/client.js";
import { t } from "../i18n/t.js";

type UnitField = "name" | "precision" | "abbreviation";

/** Reusable editor for a unit definition. It owns a copy of its draft, never its host's object. */
@customElement("dashboard-unit-form")
export class UnitForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) locales: string[] = [];
  @property({ attribute: false }) value: Unit | null = null;
  @property({ attribute: false }) fieldErrors: Partial<Record<UnitField, string>> = {};

  @state() private names: Record<string, string> = {};
  @state() private abbreviations: Record<string, string> = {};
  @state() private precision = "0";
  @state() private localErrors: Partial<Record<UnitField, string>> = {};

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    const needsDraft =
      changed.has("open") ||
      changed.has("value") ||
      (changed.has("locales") && Object.keys(this.names).length === 0);
    if (this.open && needsDraft) {
      this.names = {
        ...(this.value?.name ?? {}),
        ...Object.fromEntries(
          this.locales.map((locale) => [locale, this.value?.name[locale] ?? ""]),
        ),
      };
      this.abbreviations = {
        ...(this.value?.abbreviation ?? {}),
        ...Object.fromEntries(
          this.locales.map((locale) => [locale, this.value?.abbreviation[locale] ?? ""]),
        ),
      };
      this.precision = String(this.value?.precision ?? 0);
      this.localErrors = {};
    }
  }

  #changeName(locale: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.names = { ...this.names, [locale]: event.detail.value };
    this.localErrors = { ...this.localErrors, name: undefined };
  }

  #changeAbbreviation(locale: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.abbreviations = { ...this.abbreviations, [locale]: event.detail.value };
    this.localErrors = { ...this.localErrors, abbreviation: undefined };
  }

  #changePrecision(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.precision = event.detail.value;
    this.localErrors = { ...this.localErrors, precision: undefined };
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const defaultLocale = this.locales[0];
    const precision = Number(this.precision);
    const errors: Partial<Record<UnitField, string>> = {};
    if (!defaultLocale || this.names[defaultLocale]?.trim() === "") {
      errors.name = t("units.name_required");
    }
    if (!defaultLocale || this.abbreviations[defaultLocale]?.trim() === "") {
      errors.abbreviation = t("units.abbreviation_required");
    }
    if (
      this.precision.trim() === "" ||
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 3
    ) {
      errors.precision = t("units.precision_invalid");
    }
    this.localErrors = errors;
    if (Object.keys(errors).length > 0) return;

    const name = { ...this.names };
    for (const locale of this.locales) {
      const translation = this.names[locale]?.trim() ?? "";
      if (translation === "") delete name[locale];
      else name[locale] = translation;
    }
    const abbreviation = { ...this.abbreviations };
    for (const locale of this.locales) {
      const translation = this.abbreviations[locale]?.trim() ?? "";
      if (translation === "") delete abbreviation[locale];
      else abbreviation[locale] = translation;
    }
    const value: UnitInput = { name, abbreviation, precision };
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  override render() {
    const errors = { ...this.fieldErrors, ...this.localErrors };
    return html`
      <wt-modal
        heading=${this.value ? t("units.edit") : t("units.create")}
        .open=${this.open}
        @wt-close=${(event: Event) => this.#cancel(event)}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]"))}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${Object.values(errors).filter((message): message is string => Boolean(message))}
        ></wt-form-error-summary>
        ${this.locales.map(
          (locale, index) => html`
            <wt-input
              class="field"
              data-test=${`name-${locale}`}
              name=${`name-${locale}`}
              label=${`${t("units.name")} (${locale.toUpperCase()})`}
              ?required=${index === 0}
              error=${index === 0 ? (errors.name ?? "") : ""}
              .value=${this.names[locale] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeName(locale, event)}
            ></wt-input>
            <wt-input
              class="field"
              data-test=${`abbreviation-${locale}`}
              name=${`abbreviation-${locale}`}
              label=${`${t("units.abbreviation")} (${locale.toUpperCase()})`}
              ?required=${index === 0}
              error=${index === 0 ? (errors.abbreviation ?? "") : ""}
              .value=${this.abbreviations[locale] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) =>
                this.#changeAbbreviation(locale, event)}
            ></wt-input>
          `,
        )}
        <wt-input
          class="field"
          data-test="precision"
          name="precision"
          type="number"
          min="0"
          max="3"
          required
          label=${t("units.precision")}
          help=${t("units.precision_help")}
          error=${errors.precision ?? ""}
          .value=${this.precision}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changePrecision(event)}
        ></wt-input>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${this.#cancel}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="submit"
            variant="primary"
            ?disabled=${this.busy}
            @click=${this.#submit}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-unit-form": UnitForm;
  }
}
