import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { sameValue } from "./product-editor-model.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { DashboardApi, Unit, UnitInput } from "../api/client.js";
import type { ExtraOfferUsage } from "@waitron/catalogue/src/extra-usage.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

type UnitField = "name" | "precision" | "abbreviation";
type TranslatedField = `${"name" | "abbreviation"}-${string}`;
type UnitDraft = Omit<UnitInput, "precision"> & { precision: number | string };
/** `name` and `abbreviation` mark the first locale's input; `_form`, and a translated field whose
 * language the form does not show, are shown in the bottom message alone. */
export type UnitFormErrors = Partial<Record<UnitField | TranslatedField | "_form", string>>;

/** A refused unit write, keyed by this form's fields. */
export function unitRefusalErrors(error: unknown): UnitFormErrors {
  const code = codeOf(error);
  const message = codeMessage(code);
  const params = (error as { params?: { field?: unknown; language?: unknown } }).params ?? {};
  if (code === "unit.precision_invalid") return { precision: message };
  if (
    code === "unit.translation_required" &&
    (params.field === "name" || params.field === "abbreviation") &&
    typeof params.language === "string"
  )
    return { [`${params.field}-${params.language}`]: message };
  if (
    code === "management.request_invalid" &&
    (params.field === "name" || params.field === "abbreviation" || params.field === "precision")
  )
    return { [params.field]: message };
  return { _form: message };
}

/** It owns a copy of its draft, never its host's object. */
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
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) fieldErrors: UnitFormErrors = {};
  @property({ attribute: false }) api?: Pick<DashboardApi, "getUnitExtraUsage">;

  @state() private names: Record<string, string> = {};
  @state() private abbreviations: Record<string, string> = {};
  @state() private precision = "0";
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  @state() private precisionUsage: ExtraOfferUsage[] = [];
  @state() private precisionUsageUnavailable = false;
  #usageGeneration = 0;
  #scope?: DraftScope<UnitDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    const needsDraft =
      changed.has("open") ||
      changed.has("value") ||
      (changed.has("locales") && Object.keys(this.names).length === 0);
    if (this.open && needsDraft) {
      this.#usageGeneration++;
      this.precisionUsage = [];
      this.precisionUsageUnavailable = false;
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
      this.attempted = false;
      this.#scope?.dispose();
      this.#scope = undefined;
    }
    if (changed.has("fieldErrors") || (this.open && needsDraft)) this.dismissed = new Set();
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (!this.#scope) {
      this.#leave = leaveCoordinatorFor(this);
      this.#scope = this.#leave?.register<UnitDraft>({
        id: this,
        parent: this.draftParent,
        current: () => this.#comparisonValue(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: (value) => {
          this.names = { ...value.name };
          this.abbreviations = { ...value.abbreviation };
          this.precision = String(value.precision);
        },
      });
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("fieldErrors") && this.#fieldKeys(this.fieldErrors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  #validate(): Partial<Record<UnitField, string>> {
    const defaultLocale = this.locales[0];
    const precision = Number(this.precision);
    const errors: Partial<Record<UnitField, string>> = {};
    if (!defaultLocale || (this.names[defaultLocale] ?? "").trim() === "") {
      errors.name = t("units.name_required");
    }
    if (!defaultLocale || (this.abbreviations[defaultLocale] ?? "").trim() === "") {
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
    return errors;
  }

  /** The keys of `errors` that a field this form shows displays. */
  #fieldKeys(errors: UnitFormErrors): string[] {
    const shown = new Set([
      "name",
      "abbreviation",
      "precision",
      ...this.locales.flatMap((locale) => [`name-${locale}`, `abbreviation-${locale}`]),
    ]);
    return Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && shown.has(key))
      .map(([key]) => key);
  }

  #errors(): UnitFormErrors {
    const refused = Object.fromEntries(
      Object.entries(this.fieldErrors).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...(this.attempted ? this.#validate() : {}) };
  }

  #changeName(locale: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.names = { ...this.names, [locale]: event.detail.value };
    this.#scope?.changed();
    this.#dismiss("name", `name-${locale}`);
  }

  #changeAbbreviation(locale: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.abbreviations = { ...this.abbreviations, [locale]: event.detail.value };
    this.#scope?.changed();
    this.#dismiss("abbreviation", `abbreviation-${locale}`);
  }

  #changePrecision(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.precision = event.detail.value;
    this.#scope?.changed();
    this.#dismiss("precision");
    void this.#readPrecisionUsage();
  }

  async #readPrecisionUsage(): Promise<void> {
    const generation = ++this.#usageGeneration;
    this.precisionUsage = [];
    this.precisionUsageUnavailable = false;
    const id = this.value?.id;
    if (!this.open || !id || !this.api || this.precision === String(this.value?.precision)) return;
    try {
      const usage = await this.api.getUnitExtraUsage(id);
      if (generation === this.#usageGeneration && this.open && this.value?.id === id)
        this.precisionUsage = usage;
    } catch {
      if (generation === this.#usageGeneration && this.open && this.value?.id === id)
        this.precisionUsageUnavailable = true;
    }
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.attempted = true;
    this.#dismiss(...Object.keys(this.fieldErrors));
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    const value = this.#submissionValue();
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  #submissionValue(): UnitInput {
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
    return { name, abbreviation, precision: Number(this.precision) };
  }

  #comparisonValue(): UnitDraft {
    const value = this.#submissionValue();
    return {
      ...value,
      precision: this.#validate().precision ? this.precision : value.precision,
    };
  }

  commitSaved(submitted: UnitInput): void {
    this.#scope?.commit(submitted);
  }

  closeSaved(submitted: UnitInput): void {
    this.commitSaved(submitted);
    this.open = false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.open) return;
    if (this.#scope) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.#reportCancel();
  }

  #reportCancel(): void {
    if (this.busy || !this.open) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  override render() {
    const errors = this.#errors();
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message!);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    return html`
      <wt-modal
        size="standard"
        heading=${this.value ? t("units.edit") : t("units.create")}
        .open=${this.open}
        .beforeClose=${this.#scope ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.#reportCancel();
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]"))}
      >
        ${this.locales.map(
          (locale, index) => html`
            <wt-input
              class="field"
              data-test=${`name-${locale}`}
              name=${`name-${locale}`}
              label=${`${t("units.name")} (${locale.toUpperCase()})`}
              ?required=${index === 0}
              error=${errors[`name-${locale}`] ?? (index === 0 ? (errors.name ?? "") : "")}
              .value=${this.names[locale] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeName(locale, event)}
            ></wt-input>
            <wt-input
              class="field"
              data-test=${`abbreviation-${locale}`}
              name=${`abbreviation-${locale}`}
              label=${`${t("units.abbreviation")} (${locale.toUpperCase()})`}
              ?required=${index === 0}
              error=${
                errors[`abbreviation-${locale}`] ?? (index === 0 ? (errors.abbreviation ?? "") : "")
              }
              .value=${this.abbreviations[locale] ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) =>
                this.#changeAbbreviation(locale, event)}
            ></wt-input>
          `,
        )}
        <wt-combobox
          class="field"
          data-test="precision"
          name="precision"
          label=${t("units.precision")}
          required
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          hint=${t("units.precision_help")}
          .options=${[0, 1, 2, 3].map((precision) => ({
            value: String(precision),
            label: String(precision),
          }))}
          .value=${this.precision}
          error=${errors.precision ?? ""}
          ?disabled=${this.busy}
          @wt-change=${this.#changePrecision}
        >
          <wt-help-tooltip slot="help" aria-label=${t("units.precision_help_label")}
            >${t("units.precision_help")}</wt-help-tooltip
          >
        </wt-combobox>
        ${
          this.precisionUsage.length
            ? html`<p data-test="precision-usage-warning">
                ${t("units.precision_usage_warning")}
                ${this.precisionUsage.map((product) =>
                  product.lists.map(
                    (list) =>
                      html`<span>${product.productName}: ${list.name}</span>${
                          list.menus.length
                            ? html` (${list.menus.map((menu) => menu.name).join(", ")})`
                            : nothing
                        } `,
                  ),
                )}
              </p>`
            : nothing
        }
        ${
          this.precisionUsageUnavailable
            ? html`<p data-test="precision-usage-unavailable">
                ${t("units.precision_usage_unavailable")}
              </p>`
            : nothing
        }
        <wt-form-actions slot="footer" .error=${bottom}>
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
            ?disabled=${this.busy || invalid}
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
