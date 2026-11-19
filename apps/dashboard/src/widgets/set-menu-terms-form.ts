import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import {
  MAX_SET_MENU_AMOUNT_CENTS,
  VAT_CLASSES,
  centsToDecimal,
  stringToCents,
  type ContentLanguages,
  type VatClass,
} from "@waitron/shared";
import { isProductPrice } from "@waitron/menu/src/modifier-limits.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi, SetMenuDetails } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { vatClassLabel } from "../i18n/domain.js";
import { fill, t } from "../i18n/t.js";
import { optionalTextFields, priceField, textField } from "./form-fields.js";
import { sameValue } from "./product-editor-model.js";

type Value = Pick<
  SetMenuDetails,
  "id" | "name" | "names" | "price" | "vatClass" | "takeawayVatClass"
>;
type Draft = {
  name: string;
  names: Record<string, string>;
  setPrice: string;
  setVatClass: VatClass;
  setTakeawayVatClass: VatClass | null;
};

@customElement("dashboard-set-menu-terms-form")
export class SetMenuTermsForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      form,
      fieldset {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      form {
        --wt-form-actions-in-place: true;
        max-width: var(--wt-form-max-width);
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) value: Value | null = null;
  @property({ attribute: false }) defaultVatClass: VatClass = "general";
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @state() private draft: Draft = {
    name: "",
    names: {},
    setPrice: "",
    setVatClass: "general",
    setTakeawayVatClass: null,
  };
  @state() private saving = false;
  @state() private refusal: Record<string, string> = {};

  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<Draft>;
  #baseline?: Draft;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.#submitted(),
      snapshot: (value) => structuredClone(value),
      equal: sameValue,
      restore: (value) => {
        this.draft = value;
        this.refusal = {};
        this.#feedback.reset();
      },
    }).scope;
    if (this.#baseline) this.#scope.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("value") && this.draft) return;
    const value = this.value;
    this.draft = {
      name: value?.name ?? "",
      names: value?.names ?? {},
      setPrice: value?.price ?? "",
      setVatClass: value?.vatClass ?? this.defaultVatClass,
      setTakeawayVatClass: value?.takeawayVatClass ?? null,
    };
    this.#baseline = this.#submitted();
    this.#scope?.commit(this.#baseline);
    this.refusal = {};
    this.#feedback.reset();
  }

  #submitted(): Draft {
    return {
      ...this.draft,
      name: this.draft.name.trim(),
      setPrice: isProductPrice(this.draft.setPrice)
        ? centsToDecimal(stringToCents(this.draft.setPrice)).toString()
        : this.draft.setPrice,
      names: Object.fromEntries(
        Object.entries(this.draft.names)
          .map(([language, name]) => [language, name.trim()])
          .filter(([, name]) => name),
      ),
    };
  }

  #change<K extends keyof Draft>(key: K, value: Draft[K], ...fields: string[]): void {
    this.draft = { ...this.draft, [key]: value };
    this.#feedback.dismiss(key, ...fields);
    this.#scope?.changed();
  }

  #validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.draft.name.trim()) errors.name = t("menus.name_required");
    const price = this.draft.setPrice;
    if (!isProductPrice(price) || stringToCents(price) > MAX_SET_MENU_AMOUNT_CENTS)
      errors.setPrice = codeMessage("set_menu.invalid", undefined, { field: "setPrice" });
    return errors;
  }

  async #save(event: Event): Promise<void> {
    event.preventDefault();
    const menuId = this.value?.id;
    const baseline = this.#baseline;
    if (!menuId || !baseline || this.saving || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press(...Object.keys(this.refusal));
    if (Object.keys(this.#validate()).length) {
      void this.#feedback.focus(this.shadowRoot!);
      return;
    }
    const submitted = this.#submitted();
    const { name: internalName, ...terms } = Object.fromEntries(
      (Object.keys(submitted) as (keyof Draft)[])
        .filter((key) => !sameValue(baseline[key], submitted[key]))
        .map((key) => [key, submitted[key]]),
    ) as Partial<Draft>;
    this.saving = true;
    this.refusal = {};
    try {
      await this.api.updateMenuDetails(menuId, {
        ...(internalName === undefined ? {} : { internalName }),
        ...terms,
      });
      this.#baseline = submitted;
      this.#scope?.commit(submitted);
      this.dispatchEvent(
        new CustomEvent("set-menu-terms-saved", {
          detail: { menuId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      const field = fieldOf(error);
      this.#feedback.newRefusal();
      this.refusal = { [field]: codeMessage(codeOf(error), undefined, { field }) };
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
    } finally {
      this.saving = false;
    }
  }

  #vatField(
    key: "setVatClass" | "setTakeawayVatClass",
    label: string,
    value: VatClass | null,
    options: { value: string; label: string }[],
    errors: Record<string, string>,
  ) {
    return html`<wt-combobox
      name=${key}
      label=${label}
      .required=${key === "setVatClass"}
      .options=${options}
      .placeholder=${key === "setTakeawayVatClass" ? options[0]!.label : ""}
      .value=${value ?? ""}
      .disabled=${this.saving}
      .error=${errors[key] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: VatClass | "" }>) => {
        event.stopPropagation();
        const value = event.detail.value;
        if (key === "setTakeawayVatClass") this.#change(key, value || null);
        else if (value !== "") this.#change(key, value);
      }}
    ></wt-combobox>`;
  }

  override render() {
    const validation = this.#feedback.attempted ? this.#validate() : {};
    const errors = { ...this.#feedback.remaining(this.refusal), ...validation };
    const context = {
      busy: this.saving,
      locales: this.languages.languages,
      error: (key: string) => errors[key] ?? "",
    };
    const fieldKeys = new Set(
      [
        "name",
        "setPrice",
        "setVatClass",
        "setTakeawayVatClass",
        ...this.languages.languages.map((language) => `names-${language}`),
      ].filter((key) => errors[key]),
    );
    const action = saveActionState(this.#scope);
    const taxes = VAT_CLASSES.map((value) => ({ value, label: vatClassLabel(value) }));
    const same = fill("editor.takeaway_vat_same", { tax: vatClassLabel(this.draft.setVatClass) });
    return html`<form
      novalidate
      @submit=${this.#save}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector('[data-test="save"]'))}
    >
      ${textField(context, "name", t("menus.name"), this.draft.name, (name) => this.#change("name", name), true)}
      <fieldset>
        <legend>${t("sections.customer_names")}</legend>
        ${optionalTextFields(
          context,
          "names",
          t("sections.customer_name"),
          this.draft.names,
          (names) => {
            const edited = this.languages.languages.filter(
              (key) => names[key] !== this.draft.names[key],
            );
            this.#change("names", names, ...edited.map((key) => `names-${key}`));
          },
          this.draft.name,
          this.languages.defaultLanguage,
        )}
      </fieldset>
      ${priceField(context, "setPrice", t("menus.set_menu_price"), this.draft.setPrice, (price) => this.#change("setPrice", price), true)}
      ${this.#vatField("setVatClass", t("menus.set_menu_eat_in_vat"), this.draft.setVatClass, taxes, errors)}
      ${this.#vatField("setTakeawayVatClass", t("editor.takeaway_vat"), this.draft.setTakeawayVatClass, [{ value: "", label: same }, ...taxes], errors)}
      <wt-form-actions .error=${this.#feedback.message(errors, fieldKeys, t("form.fix_fields"))}>
        <slot name="cancel" slot="start"></slot>
        <wt-button
          data-test="save"
          variant=${action.variant}
          .disabled=${action.unchanged || this.saving || Object.keys(validation).length > 0}
          .loading=${this.saving}
          @click=${this.#save}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </form>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-terms-form": SetMenuTermsForm;
  }
}
