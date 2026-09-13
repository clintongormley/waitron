import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles, currentContentLanguages, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  DIETARY_LABELS,
  type AllergenDeclaration,
  type DietaryLabel,
  type ModifierEffects,
  type VatClass,
} from "../api/client.js";
import { ALLERGEN_CODES, allergenName, vatClassName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

/**
 * One modifier choice as this modal edits it: the shared fields (name, availability) plus, for an
 * extra, its price, maximum quantity, tax class and allergen/dietary effects. The consumer (the
 * modifier form) mirrors `available` inline in its table too — one value edited in two places, not
 * two values. `priceDelta`/`maxQuantity`/`vatClass` are absent for an options choice.
 */
export type ChoiceDraft = ModifierEffects & {
  id: string;
  name: Record<string, string>;
  available: boolean;
  priceDelta?: string;
  maxQuantity?: number;
  vatClass?: VatClass | null;
};

const clean = (value: Record<string, string>) =>
  Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim()));

@customElement("dashboard-choice-form")
export class ChoiceForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      .selected {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      summary {
        cursor: pointer;
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) locales: string[] = [];
  @property() kind: "extras" | "options" = "extras";
  @property({ attribute: false }) value: ChoiceDraft | null = null;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private errors: Record<string, string> = {};
  @state() private serverErrors: Record<string, string> = {};
  @state() private name: Record<string, string> = {};
  @state() private available = true;
  @state() private priceDelta = "0.00";
  @state() private maxQuantity = "1";
  @state() private vatClass?: VatClass | null;
  @state() private effects: ModifierEffects = {};
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("fieldErrors")) {
      this.serverErrors = Object.fromEntries(
        Object.entries(this.fieldErrors).map(([key, message]) => [
          key.replace(/^name\./, "name-"),
          message,
        ]),
      );
    }
    if (!(changed.has("open") && this.open) && !changed.has("value")) return;
    const value = this.value;
    this.#choiceId = value?.id ?? crypto.randomUUID();
    this.name = { ...value?.name };
    this.available = value?.available ?? true;
    this.priceDelta = value?.priceDelta ?? "0.00";
    this.maxQuantity = value?.maxQuantity !== undefined ? String(value.maxQuantity) : "1";
    this.vatClass = value?.vatClass;
    this.effects = value
      ? {
          ...(value.addAllergens === undefined ? {} : { addAllergens: value.addAllergens }),
          ...(value.removeAllergens === undefined
            ? {}
            : { removeAllergens: value.removeAllergens }),
          ...(value.addOrigins === undefined ? {} : { addOrigins: value.addOrigins }),
          ...(value.removeOrigins === undefined ? {} : { removeOrigins: value.removeOrigins }),
          ...(value.dietaryEffect === undefined ? {} : { dietaryEffect: value.dietaryEffect }),
        }
      : {};
    this.errors = {};
  }
  #choiceId = "";
  #error(key: string): string {
    return this.errors[key] ?? this.serverErrors[key] ?? "";
  }
  #patch(patch: Partial<ModifierEffects>): void {
    this.effects = { ...this.effects, ...patch };
  }
  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent("wt-choice-cancel", { detail: {}, bubbles: true, composed: true }),
    );
  }
  #save(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const errors: Record<string, string> = {};
    const language = currentContentLanguages().defaultLanguage;
    if (!this.name[language]?.trim()) errors.name = t("modifiers.name_required");
    if (this.kind === "extras") {
      if (!/^\d+(?:\.\d{1,2})?$/.test(this.priceDelta))
        errors.priceDelta = t("modifiers.price_invalid");
      if (
        !/^\d+$/.test(this.maxQuantity) ||
        !Number.isSafeInteger(Number(this.maxQuantity)) ||
        Number(this.maxQuantity) < 1
      )
        errors.maxQuantity = t("modifiers.quantity_invalid");
    }
    this.errors = errors;
    if (Object.keys(errors).length) return;
    const value: ChoiceDraft = {
      id: this.#choiceId,
      name: clean(this.name),
      available: this.available,
      ...this.effects,
      ...(this.kind === "extras"
        ? {
            priceDelta: this.priceDelta,
            maxQuantity: Number(this.maxQuantity),
            ...(this.vatClass === undefined ? {} : { vatClass: this.vatClass }),
          }
        : {}),
    };
    this.dispatchEvent(
      new CustomEvent("wt-choice-save", { detail: { value }, bubbles: true, composed: true }),
    );
  }
  #input(
    key: string,
    label: string,
    value: string,
    change: (value: string) => void,
    required = false,
  ) {
    return html`<wt-input
      name=${key}
      label=${label}
      .value=${value}
      .required=${required}
      .disabled=${this.busy}
      .error=${this.#error(key)}
      .invalid=${!!this.#error(key)}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change(event.detail.value);
      }}
    ></wt-input>`;
  }
  #names(
    key: string,
    label: string,
    value: Record<string, string>,
    change: (value: Record<string, string>) => void,
  ) {
    return this.locales.map((locale) => {
      const required = locale === currentContentLanguages().defaultLanguage;
      const error = this.#error(`${key}-${locale}`) || (required ? this.#error(key) : "");
      return html`<wt-input
        name=${`${key}-${locale}`}
        label=${`${label} (${locale})`}
        .value=${value[locale] ?? ""}
        .required=${required}
        .disabled=${this.busy}
        .error=${error}
        .invalid=${!!error}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          change({ ...value, [locale]: event.detail.value });
        }}
      ></wt-input>`;
    });
  }
  #toggle(key: string, label: string, checked: boolean, change: (checked: boolean) => void) {
    return html`<wt-switch
      name=${key}
      label=${label}
      .checked=${checked}
      .disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
        event.stopPropagation();
        change(event.detail.checked);
      }}
    ></wt-switch>`;
  }
  #effectList(key: "removeAllergens", label: string, options: readonly string[]) {
    const selected = this.effects[key] ?? [];
    const display = (code: string) => allergenName(code);
    return html`<label
        >${label}<select
          name=${key}
          .disabled=${this.busy}
          @change=${(event: Event) => {
            event.stopPropagation();
            const select = event.target as HTMLSelectElement;
            if (select.value) this.#patch({ [key]: [...selected, select.value] });
            select.value = "";
          }}
        >
          <option value="">${t("modifiers.choose")}</option>
          ${options.filter((code) => !selected.includes(code)).map((code) => html`<option value=${code}>${display(code)}</option>`)}
        </select></label
      >${selected.map((code) => html`<div class="selected"><span>${display(code)}</span><wt-button variant="secondary" .disabled=${this.busy} aria-label=${`${t("action.remove")}: ${label} ${display(code)}`} @click=${() => this.#patch({ [key]: selected.filter((value) => value !== code) })}>${t("action.remove")}</wt-button></div>`)}`;
  }
  #dietaryEffect() {
    const reviewed =
      this.effects.dietaryEffect !== undefined && this.effects.dietaryEffect !== null;
    const selected = this.effects.dietaryEffect?.invalidates ?? [];
    return html`${this.#toggle(
      "dietary-reviewed",
      t("modifiers.dietary_reviewed"),
      reviewed,
      (checked) => this.#patch({ dietaryEffect: checked ? { invalidates: [] } : null }),
    )}${
      reviewed
        ? html`<label
              >${t("modifiers.invalidates_dietary")}
              <select
                name="dietaryEffect"
                .disabled=${this.busy}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  const select = event.target as HTMLSelectElement;
                  if (select.value)
                    this.#patch({
                      dietaryEffect: {
                        invalidates: [...selected, select.value as DietaryLabel],
                      },
                    });
                  select.value = "";
                }}
              >
                <option value="">${t("modifiers.choose")}</option>
                ${DIETARY_LABELS.filter((label) => !selected.includes(label)).map(
                  (label) => html`<option value=${label}>${t(`editor.diet.${label}`)}</option>`,
                )}
              </select></label
            >
            ${selected.map(
              (label) =>
                html`<div class="selected">
                  <span>${t(`editor.diet.${label}`)}</span
                  ><wt-button
                    variant="secondary"
                    .disabled=${this.busy}
                    @click=${() =>
                      this.#patch({
                        dietaryEffect: { invalidates: selected.filter((value) => value !== label) },
                      })}
                    >${t("action.remove")}</wt-button
                  >
                </div>`,
            )}`
        : nothing
    }`;
  }
  #effects() {
    const added: NonNullable<AllergenDeclaration> = this.effects.addAllergens ?? {};
    return html`<details>
      <summary>${t("modifiers.effects")}</summary>
      <div class="fields">
        <label
          >${t("modifiers.add_allergen")}<select
            name="addAllergens"
            .disabled=${this.busy}
            @change=${(event: Event) => {
              event.stopPropagation();
              const select = event.target as HTMLSelectElement;
              if (select.value)
                this.#patch({
                  addAllergens: { ...added, [select.value]: { presence: "contains" } },
                  removeAllergens: (this.effects.removeAllergens ?? []).filter(
                    (code) => code !== select.value,
                  ),
                });
              select.value = "";
            }}
          >
            <option value="">${t("modifiers.choose")}</option>
            ${ALLERGEN_CODES.filter((code) => !added[code]).map((code) => html`<option value=${code}>${allergenName(code)}</option>`)}
          </select></label
        >
        ${Object.entries(added).map(
          ([code, entry]) =>
            html`<div class="selected">
              <label
                >${allergenName(code)}<select
                  name=${`presence-${code}`}
                  .disabled=${this.busy}
                  @change=${(event: Event) => {
                    event.stopPropagation();
                    this.#patch({
                      addAllergens: {
                        ...added,
                        [code]: {
                          ...entry,
                          presence: (event.target as HTMLSelectElement).value as
                            "contains" | "may_contain",
                        },
                      },
                    });
                  }}
                >
                  <option value="contains" ?selected=${entry.presence === "contains"}>
                    ${t("modifiers.contains")}
                  </option>
                  <option value="may_contain" ?selected=${entry.presence === "may_contain"}>
                    ${t("modifiers.may_contain")}
                  </option>
                </select></label
              ><wt-button
                variant="secondary"
                .disabled=${this.busy}
                aria-label=${`${t("action.remove")}: ${allergenName(code)}`}
                @click=${() => {
                  const next = { ...added };
                  delete next[code];
                  this.#patch({ addAllergens: next });
                }}
                >${t("action.remove")}</wt-button
              >
            </div>`,
        )}
        ${this.#effectList(
          "removeAllergens",
          t("modifiers.remove_allergen"),
          ALLERGEN_CODES.filter((code) => !added[code]),
        )}
        ${this.#dietaryEffect()}
      </div>
    </details>`;
  }
  override render() {
    return html`<wt-modal
      .open=${this.open}
      heading=${this.name[currentContentLanguages().defaultLanguage] || t("modifiers.choice")}
      @wt-close=${(event: Event) => this.#cancel(event)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>('[data-test="choice-save"]'),
        );
      }}
    >
      ${Object.keys(this.errors).length || Object.keys(this.fieldErrors).length ? html`<p class="error" role="alert">${t("modifiers.problem")}</p>` : nothing}
      <div class="fields">
        ${this.#names("name", t("modifiers.name"), this.name, (name) => {
          this.name = name;
        })}
        ${this.#toggle("available", t("modifiers.available"), this.available, (available) => {
          this.available = available;
        })}
        ${
          this.kind === "extras"
            ? html`${this.#input(
                  "priceDelta",
                  t("modifiers.price"),
                  this.priceDelta,
                  (priceDelta) => {
                    this.priceDelta = priceDelta;
                  },
                  true,
                )}${this.#input(
                  "maxQuantity",
                  t("modifiers.max_quantity"),
                  this.maxQuantity,
                  (maxQuantity) => {
                    this.maxQuantity = maxQuantity;
                  },
                  true,
                )}<label
                  >${t("modifiers.vat")}<select
                    name="vatClass"
                    .disabled=${this.busy}
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      this.vatClass =
                        ((event.target as HTMLSelectElement).value as VatClass) || null;
                    }}
                  >
                    <option value="" ?selected=${!this.vatClass}>
                      ${t("modifiers.inherit_vat")}
                    </option>
                    ${(["general", "reduced", "super_reduced", "zero"] as const).map((value) => html`<option value=${value} ?selected=${this.vatClass === value}>${vatClassName(value)}</option>`)}
                  </select></label
                >`
            : nothing
        }
        ${this.#effects()}
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          data-test="choice-cancel"
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="choice-save"
          variant="primary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#save(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      ></wt-modal
    >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-choice-form": ChoiceForm;
  }
}
