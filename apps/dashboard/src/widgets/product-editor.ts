import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles, submitOnEnter } from "@waitron/ui";
import { resolveContentText } from "@waitron/shared";
import {
  DIETARY_LABELS,
  expandDietaryDeclarations,
} from "@waitron/catalogue/src/dietary-declarations.js";
import { VAT_CLASSES, resolveVatRate } from "@waitron/catalogue/src/pricing.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "./allergen-picker.js";
import "./image-upload.js";
import type { DashboardApi } from "../api/client.js";
import type {
  EditorChoice,
  ProductEditorDraft,
  DietaryLabel,
  ProductRoutingChoice,
} from "./product-editor-model.js";
import { t } from "../i18n/t.js";
import { vatClassName } from "../i18n/domain.js";

const dietaryLabels: readonly DietaryLabel[] = DIETARY_LABELS;
function emptyDraft(): ProductEditorDraft {
  return {
    name: {},
    description: null,
    kitchenName: null,
    image: null,
    unitId: "",
    unitPrice: "0.00",
    available: true,
    vatClass: "general",
    variants: [],
    categoryIds: [],
    primaryCategoryId: null,
    modifierIds: [],
    allergens: null,
    dietaryDeclarations: [],
  };
}

@customElement("dashboard-product-editor")
export class ProductEditor extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .cards,
      .fields,
      .selected {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      label {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .row > label {
        flex: 1;
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: calc(var(--wt-tap-min) * 2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }
      textarea:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .badge {
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        font-size: var(--wt-font-size-sm);
      }
      .variant {
        border-top: 1px solid var(--wt-color-border);
        padding-top: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) childOpen = false;
  @property({ attribute: false }) locales: string[] = [];
  @property({ attribute: false }) value: ProductEditorDraft | null = null;
  @property({ attribute: false }) units: EditorChoice[] = [];
  @property({ attribute: false }) categories: EditorChoice[] = [];
  @property({ attribute: false }) modifiers: EditorChoice[] = [];
  @property({ attribute: false }) stations: ProductRoutingChoice[] = [];
  @property({ attribute: false }) courses: ProductRoutingChoice[] = [];
  @property({ attribute: false }) taxChoices?: {
    id: ProductEditorDraft["vatClass"];
    rate: string;
    label: string;
  }[];
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @property({ attribute: false }) api?: DashboardApi;
  @property() defaultUnitId = "";
  @state() private draft: ProductEditorDraft = emptyDraft();
  @state() private errors: Record<string, string> = {};
  @state() private imageOpen = false;
  @state() private dietaryPickerOpen = false;
  @state() private dietarySearch = "";
  @state() private membershipPicker: "category" | "modifier" | null = null;
  @state() private membershipSearch = "";
  private submitted = false;
  private generation = 0;
  @state() private allergenOpen = false;

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("value") || (changed.has("open") && this.open)) {
      this.draft = this.value
        ? structuredClone(this.value)
        : { ...emptyDraft(), unitId: this.defaultUnitId };
      this.generation++;
      this.allergenOpen = false;
      this.imageOpen = false;
      this.errors = {};
      this.submitted = false;
      this.dietaryPickerOpen = false;
      this.membershipPicker = null;
      this.membershipSearch = "";
      this.dietarySearch = "";
    }
    if ((changed.has("busy") && !this.busy) || changed.has("fieldErrors")) this.submitted = false;
  }
  get currentValue(): ProductEditorDraft {
    return structuredClone(this.draft);
  }
  private get suspended() {
    return (
      this.busy ||
      this.childOpen ||
      this.imageOpen ||
      this.allergenOpen ||
      this.dietaryPickerOpen ||
      this.membershipPicker !== null
    );
  }
  private error(name: string) {
    return this.fieldErrors[name] ?? this.errors[name] ?? "";
  }
  private get taxes() {
    return (
      this.taxChoices ??
      VAT_CLASSES.map((id) => ({ id, rate: resolveVatRate(id), label: vatClassName(id) }))
    );
  }
  private label(choice: EditorChoice) {
    return resolveContentText(choice.name, this.locales[0] ?? "en", this.locales[0] ?? "en");
  }
  private change<K extends keyof ProductEditorDraft>(key: K, value: ProductEditorDraft[K]) {
    this.draft = { ...this.draft, [key]: value };
  }
  private textField(
    name: string,
    label: string,
    value: string,
    change: (value: string) => void,
    required = false,
  ) {
    return html`<wt-input
      name=${name}
      label=${label}
      .value=${value}
      .required=${required}
      .error=${this.fieldErrors[name] ?? this.errors[name] ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change(event.detail.value);
      }}
    ></wt-input>`;
  }
  private related(event: Event, kind: "unit" | "category" | "modifier") {
    event.stopPropagation();
    if (this.suspended) return;
    this.dispatchEvent(
      new CustomEvent("wt-create-related", { detail: { kind }, bubbles: true, composed: true }),
    );
  }
  /** A nested create returns through the composing screen, without reseeding the product. */
  selectRelated(kind: "unit" | "category" | "modifier", id: string): void {
    if (kind === "unit") this.change("unitId", id);
    if (kind === "category" && !this.draft.categoryIds.includes(id)) {
      this.draft = {
        ...this.draft,
        categoryIds: [...this.draft.categoryIds, id],
        primaryCategoryId: this.draft.primaryCategoryId ?? id,
      };
    }
    if (kind === "modifier" && !this.draft.modifierIds.includes(id))
      this.change("modifierIds", [...this.draft.modifierIds, id]);
  }
  returnRelatedFocus(kind: "unit" | "category" | "modifier"): void {
    this.shadowRoot!.querySelector<HTMLElement>(`[data-test=add-${kind}]`)?.focus();
  }
  private save(event: Event) {
    event.stopPropagation();
    if (this.suspended || this.submitted) return;
    const errors: Record<string, string> = {};
    const defaultLanguage = this.locales[0] ?? "en";
    if (!this.draft.name[defaultLanguage]?.trim())
      errors[`name-${defaultLanguage}`] = t("editor.name_required");
    if (!this.units.some((unit) => unit.id === this.draft.unitId))
      errors.unit = t("editor.unit_required");
    const price = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
    if (!price.test(this.draft.unitPrice)) errors["unit-price"] = t("editor.price_invalid");
    if (!this.taxes.some((tax) => tax.id === this.draft.vatClass))
      errors.tax = t("editor.tax_required");
    for (const [index, variant] of this.draft.variants.entries()) {
      if (!variant.name[defaultLanguage]?.trim())
        errors[`variant-${index}-name-${defaultLanguage}`] = t("editor.variant_name_required");
      if (!price.test(variant.unitPrice))
        errors[`variant-${index}-price`] = t("editor.price_invalid");
    }
    if (
      this.draft.categoryIds.length &&
      !this.draft.categoryIds.includes(this.draft.primaryCategoryId ?? "")
    )
      errors.primary = t("editor.reporting_category_required");
    this.errors = errors;
    if (Object.keys(errors).length) return;
    this.submitted = true;
    const value = this.currentValue;
    delete value.stationId;
    delete value.courseId;
    value.kitchenName = value.kitchenName?.trim() || null;
    if (!Object.values(value.description ?? {}).some((text) => text.trim()))
      value.description = null;
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  private cancel(event: Event) {
    event.stopPropagation();
    if (this.suspended) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }
  private orderButtons(
    prefix: string,
    label: string,
    index: number,
    length: number,
    move: (to: number) => void,
  ) {
    return html`<div class="row">
      ${([-1, 1] as const).map((direction) => {
        const action = direction === -1 ? "up" : "down";
        const to = index + direction;
        return html`<wt-button
          variant="secondary"
          data-test=${`${prefix}-${action}`}
          aria-label=${`${t(`action.move_${action}`)}: ${label}`}
          ?disabled=${to < 0 || to >= length}
          @click=${(event: Event) => {
            event.stopPropagation();
            if (to >= 0 && to < length) move(to);
          }}
          >${t(`action.move_${action}`)}</wt-button
        >`;
      })}
    </div>`;
  }
  private renderVariants() {
    return html`<wt-card
      ><h3 slot="header">${t("editor.variants")}</h3>
      <div class="fields">
        ${this.draft.variants.map(
          (variant, index) =>
            html`<div class="fields variant">
              ${this.locales.map((locale) =>
                this.textField(
                  `variant-${index}-name-${locale}`,
                  `${t("editor.name")} (${locale})`,
                  variant.name[locale] ?? "",
                  (value) => {
                    this.change(
                      "variants",
                      this.draft.variants.map((v, i) =>
                        i === index ? { ...v, name: { ...v.name, [locale]: value } } : v,
                      ),
                    );
                  },
                  locale === this.locales[0],
                ),
              )}
              ${this.textField(
                `variant-${index}-price`,
                t("editor.price"),
                variant.unitPrice,
                (value) =>
                  this.change(
                    "variants",
                    this.draft.variants.map((v, i) =>
                      i === index ? { ...v, unitPrice: value } : v,
                    ),
                  ),
                true,
              )}
              <wt-switch
                name=${`variant-${index}-available`}
                label=${t("editor.available")}
                .checked=${variant.available}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  event.stopPropagation();
                  this.change(
                    "variants",
                    this.draft.variants.map((v, i) =>
                      i === index ? { ...v, available: event.detail.checked } : v,
                    ),
                  );
                }}
              ></wt-switch>
              ${this.orderButtons(
                "variant",
                this.label({ id: variant.id ?? "", name: variant.name }),
                index,
                this.draft.variants.length,
                (to) => {
                  const variants = [...this.draft.variants];
                  [variants[index], variants[to]] = [variants[to]!, variants[index]!];
                  this.change("variants", variants);
                },
              )}
              <wt-button
                variant="secondary"
                aria-label=${`${t("action.remove")}: ${this.label({ id: variant.id ?? "", name: variant.name })}`}
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.change(
                    "variants",
                    this.draft.variants.filter((_, i) => i !== index),
                  );
                }}
                >${t("action.remove")}</wt-button
              >
            </div>`,
        )}
        <wt-button
          variant="secondary"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.change("variants", [
              ...this.draft.variants,
              { name: {}, unitPrice: "0.00", available: true },
            ]);
          }}
          >${t("editor.add_variant")}</wt-button
        >
      </div></wt-card
    >`;
  }
  private renderMemberships(kind: "category" | "modifier", choices: EditorChoice[]) {
    const selected = kind === "category" ? this.draft.categoryIds : this.draft.modifierIds;
    return html`<wt-card
      ><h3 slot="header">${t(kind === "category" ? "editor.categories" : "editor.modifiers")}</h3>
      <div class="fields">
        ${selected.map((id, index) => {
          const choice = choices.find((choice) => choice.id === id);
          const label = choice ? this.label(choice) : t("editor.missing_choice");
          return html`<div class="row" data-test=${`selected-${kind}`}>
            <span>${label}</span>
            ${
              kind === "modifier"
                ? this.orderButtons("modifier", label, index, selected.length, (to) => {
                    const ids = [...selected];
                    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
                    this.change("modifierIds", ids);
                  })
                : nothing
            }
            <wt-button
              variant="secondary"
              data-test=${`${kind}-remove`}
              aria-label=${`${t("action.remove")}: ${label}`}
              @click=${(event: Event) => {
                event.stopPropagation();
                const ids = selected.filter((value) => value !== id);
                if (kind === "category")
                  this.draft = {
                    ...this.draft,
                    categoryIds: ids,
                    primaryCategoryId:
                      this.draft.primaryCategoryId === id ? null : this.draft.primaryCategoryId,
                  };
                else this.change("modifierIds", ids);
              }}
              >${t("action.remove")}</wt-button
            >
          </div>`;
        })}
        ${
          kind === "category" && selected.length
            ? html`<label
                  >${t("editor.reporting_category")} *<select
                    name="reporting-category"
                    .value=${this.draft.primaryCategoryId ?? ""}
                    aria-required="true"
                    aria-invalid=${this.error("primary") ? "true" : "false"}
                    aria-describedby="primary-error"
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      this.change(
                        "primaryCategoryId",
                        (event.target as HTMLSelectElement).value || null,
                      );
                    }}
                  >
                    <option value="">${t("editor.choose")}</option>
                    ${this.categories.filter((c) => selected.includes(c.id)).map((c) => html`<option value=${c.id} .selected=${c.id === this.draft.primaryCategoryId}>${this.label(c)}</option>`)}
                  </select></label
                ><span class="error" id="primary-error">${this.error("primary")}</span>`
            : nothing
        }
        <wt-button
          variant="secondary"
          data-test=${`pick-${kind}`}
          ?disabled=${this.suspended && this.membershipPicker !== kind}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.membershipPicker = this.membershipPicker === kind ? null : kind;
            this.membershipSearch = "";
          }}
          >${this.membershipPicker === kind ? t("action.cancel") : t(kind === "category" ? "editor.choose_categories" : "editor.choose_modifiers")}</wt-button
        >
        ${
          this.membershipPicker === kind
            ? html`<div class="fields" @keydown=${(event: Event) => event.stopPropagation()}>
                ${this.textField(
                  "membership-search",
                  t("editor.search_choices"),
                  this.membershipSearch,
                  (value) => {
                    this.membershipSearch = value;
                  },
                )}
                ${choices
                  .filter(
                    (choice) =>
                      !selected.includes(choice.id) &&
                      this.label(choice)
                        .toLocaleLowerCase()
                        .includes(this.membershipSearch.toLocaleLowerCase()),
                  )
                  .map(
                    (choice) =>
                      html`<wt-button
                        variant="secondary"
                        data-test="membership-choice"
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          this.selectRelated(kind, choice.id);
                          this.membershipPicker = null;
                          this.shadowRoot!.querySelector<HTMLElement>(
                            `[data-test=pick-${kind}]`,
                          )?.focus();
                        }}
                        >${this.label(choice)}</wt-button
                      >`,
                  )}
              </div>`
            : nothing
        }
        <wt-button
          variant="secondary"
          data-test=${`add-${kind}`}
          ?disabled=${this.suspended}
          @click=${(event: Event) => this.related(event, kind)}
          >${t(kind === "category" ? "editor.add_category" : "editor.add_modifier")}</wt-button
        >
      </div></wt-card
    >`;
  }
  override render() {
    return html`<wt-modal
      .open=${this.open}
      heading=${t(this.value?.id ? "product.edit" : "product.new")}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
      @wt-close=${(event: Event) => {
        if (event.target === event.currentTarget) this.cancel(event);
      }}
    >
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${Object.values({ ...this.errors, ...this.fieldErrors })}
      ></wt-form-error-summary>
      <div class="cards">
        <wt-card
          ><h3 slot="header">${t("editor.content")}</h3>
          <div class="fields">
            ${this.locales.map((locale) => this.textField(`name-${locale}`, `${t("editor.name")} (${locale})`, this.draft.name[locale] ?? "", (value) => this.change("name", { ...this.draft.name, [locale]: value }), locale === this.locales[0]))}
            ${this.locales.map(
              (locale) =>
                html`<label
                  >${t("editor.description")} (${locale})<textarea
                    name=${`description-${locale}`}
                    .value=${this.draft.description?.[locale] ?? ""}
                    @input=${(event: Event) => {
                      event.stopPropagation();
                      this.change("description", {
                        ...this.draft.description,
                        [locale]: (event.target as HTMLTextAreaElement).value,
                      });
                    }}
                  ></textarea>
                </label>`,
            )}
            ${this.textField("kitchen-name", t("editor.kitchen_name"), this.draft.kitchenName ?? "", (value) => this.change("kitchenName", value))}
            ${
              this.api
                ? html`<dashboard-image-upload
                    .api=${this.api}
                    .image=${this.draft.image}
                    @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
                      event.stopPropagation();
                      this.change("image", event.detail.image);
                    }}
                    @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
                      event.stopPropagation();
                      this.imageOpen = event.detail.open;
                    }}
                  ></dashboard-image-upload>`
                : nothing
            }
          </div></wt-card
        >
        <wt-card
          ><h3 slot="header">${t("editor.selling")}</h3>
          <div class="fields">
            <label
              >${t("product.unit")} *<select
                name="unit"
                .value=${this.draft.unitId}
                aria-required="true"
                aria-invalid=${this.error("unit") ? "true" : "false"}
                aria-describedby="unit-error"
                @change=${(event: Event) => {
                  event.stopPropagation();
                  this.change("unitId", (event.target as HTMLSelectElement).value);
                }}
              >
                <option value="">${t("editor.choose")}</option>
                ${this.units.map((unit) => html`<option value=${unit.id} .selected=${unit.id === this.draft.unitId}>${this.label(unit)}</option>`)}
              </select></label
            ><span class="error" id="unit-error">${this.error("unit")}</span>
            <wt-button
              variant="secondary"
              data-test="add-unit"
              ?disabled=${this.suspended}
              @click=${(event: Event) => this.related(event, "unit")}
              >${t("editor.add_unit")}</wt-button
            >
            ${this.textField("unit-price", t("editor.price"), this.draft.unitPrice, (value) => this.change("unitPrice", value), true)}
            <label
              >${t("product.vat")} *<select
                name="tax"
                .value=${this.draft.vatClass}
                aria-required="true"
                aria-invalid=${this.error("tax") ? "true" : "false"}
                aria-describedby="tax-error"
                @change=${(event: Event) => {
                  event.stopPropagation();
                  this.change(
                    "vatClass",
                    (event.target as HTMLSelectElement).value as ProductEditorDraft["vatClass"],
                  );
                }}
              >
                <option value="">${t("editor.choose")}</option>
                ${this.taxes.map((tax) => html`<option value=${tax.id} .selected=${tax.id === this.draft.vatClass}>${tax.label} (${tax.rate.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)</option>`)}
              </select></label
            ><span class="error" id="tax-error">${this.error("tax")}</span>
            <wt-switch
              name="available"
              label=${t("editor.available")}
              .checked=${this.draft.available}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                event.stopPropagation();
                this.change("available", event.detail.checked);
              }}
            ></wt-switch>
            ${
              this.value?.id
                ? html`<label
                      >${t("product.station")}<select
                        name="product-station"
                        .value=${this.draft.stationId ?? ""}
                        @change=${(event: Event) => {
                          event.stopPropagation();
                          const stationId = (event.target as HTMLSelectElement).value || null;
                          this.change("stationId", stationId);
                          this.dispatchEvent(
                            new CustomEvent("wt-set-product-station", {
                              detail: { productId: this.value!.id, stationId },
                              bubbles: true,
                              composed: true,
                            }),
                          );
                        }}
                      >
                        <option value="">${t("product.no_station")}</option>
                        ${this.stations.map(
                          (station) =>
                            html`<option
                              value=${station.id}
                              .selected=${station.id === this.draft.stationId}
                            >
                              ${station.name}
                            </option>`,
                        )}
                      </select></label
                    ><label
                      >${t("product.course")}<select
                        name="product-course"
                        .value=${this.draft.courseId ?? ""}
                        @change=${(event: Event) => {
                          event.stopPropagation();
                          const courseId = (event.target as HTMLSelectElement).value || null;
                          this.change("courseId", courseId);
                          this.dispatchEvent(
                            new CustomEvent("wt-set-product-course", {
                              detail: { productId: this.value!.id, courseId },
                              bubbles: true,
                              composed: true,
                            }),
                          );
                        }}
                      >
                        <option value="">${t("product.no_course")}</option>
                        ${this.courses.map(
                          (course) =>
                            html`<option
                              value=${course.id}
                              .selected=${course.id === this.draft.courseId}
                            >
                              ${course.name}
                            </option>`,
                        )}
                      </select></label
                    >`
                : nothing
            }
          </div></wt-card
        >
        ${this.renderVariants()} ${this.renderMemberships("category", this.categories)}
        ${this.renderMemberships("modifier", this.modifiers)}
        <wt-card
          ><h3 slot="header">${t("editor.allergens")}</h3>
          ${keyed(
            this.generation,
            html`<dashboard-allergen-picker
              .declaration=${this.value?.allergens ?? null}
              @wt-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
                event.stopPropagation();
                this.allergenOpen = event.detail.open;
              }}
              @wt-allergens-change=${(
                event: CustomEvent<{ value: ProductEditorDraft["allergens"] }>,
              ) => {
                event.stopPropagation();
                this.change("allergens", event.detail.value);
              }}
            ></dashboard-allergen-picker>`,
          )}</wt-card
        >
        <wt-card
          ><h3 slot="header">${t("editor.dietary")}</h3>
          <div class="selected">
            ${this.draft.dietaryDeclarations.map(
              (label) =>
                html`<div class="row">
                  <span>${t(`editor.diet.${label}`)}</span
                  ><wt-button
                    variant="secondary"
                    aria-label=${`${t("action.remove")}: ${t(`editor.diet.${label}`)}`}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      this.change(
                        "dietaryDeclarations",
                        this.draft.dietaryDeclarations.filter((v) => v !== label),
                      );
                    }}
                    >${t("action.remove")}</wt-button
                  >
                </div>`,
            )}
            <div class="row">
              ${expandDietaryDeclarations(this.draft.dietaryDeclarations)
                .filter((label) => !this.draft.dietaryDeclarations.includes(label))
                .map(
                  (label) =>
                    html`<span class="badge" data-test="derived-diet" data-label=${label}
                      >${t(`editor.diet.${label}`)} · ${t("editor.inferred")}</span
                    >`,
                )}
            </div>
            <wt-button
              variant="secondary"
              ?disabled=${this.suspended && !this.dietaryPickerOpen}
              @click=${(event: Event) => {
                event.stopPropagation();
                this.dietaryPickerOpen = !this.dietaryPickerOpen;
                this.dietarySearch = "";
              }}
              >${this.dietaryPickerOpen ? t("action.cancel") : t("editor.add_diet")}</wt-button
            >
            ${
              this.dietaryPickerOpen
                ? html`${this.textField(
                    "diet-search",
                    t("editor.search_diets"),
                    this.dietarySearch,
                    (value) => {
                      this.dietarySearch = value;
                    },
                  )}
                  ${dietaryLabels
                    .filter(
                      (label) =>
                        !this.draft.dietaryDeclarations.includes(label) &&
                        t(`editor.diet.${label}`)
                          .toLocaleLowerCase()
                          .includes(this.dietarySearch.toLocaleLowerCase()),
                    )
                    .map(
                      (label) =>
                        html`<wt-button
                          variant="secondary"
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            this.change("dietaryDeclarations", [
                              ...this.draft.dietaryDeclarations,
                              label,
                            ]);
                            this.dietaryPickerOpen = false;
                          }}
                          >${t(`editor.diet.${label}`)}</wt-button
                        >`,
                    )}`
                : nothing
            }
          </div></wt-card
        >
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.suspended}
          @click=${this.cancel}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          .loading=${this.busy}
          ?disabled=${this.suspended}
          @click=${this.save}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
