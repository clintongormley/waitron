import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, selectStyles, currentContentLanguages, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  DIETARY_ORIGINS,
  type Modifier,
  type ModifierInput,
  type ModifierEffects,
  type ModifierExtraChoice,
  type VatClass,
} from "../api/client.js";
import { ALLERGEN_CODES, allergenName, vatClassName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

type ChoiceDraft = ModifierEffects & {
  id: string;
  name: Record<string, string>;
  available: boolean;
  priceDelta: string;
  maxQuantity: string;
  defaultQuantity: string;
  vatClass?: VatClass | null;
};
const TYPES = ["text", "extras", "options", "yes-no"] as const;
const clean = (value: Record<string, string>) =>
  Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim()));

@customElement("dashboard-modifier-form")
export class ModifierForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .fields,
      fieldset,
      .choices {
        display: grid;
        gap: var(--wt-space-3);
      }
      fieldset {
        margin: var(--wt-space-3) 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      .actions,
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
  @property({ attribute: false }) value: Modifier | null = null;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private errors: Record<string, string> = {};
  @state() private serverErrors: Record<string, string> = {};
  @state() private name: Record<string, string> = {};
  @state() private type: ModifierInput["type"] = "text";
  @state() private available = true;
  @state() private required = false;
  @state() private cap = "";
  @state() private choices: ChoiceDraft[] = [];
  @state() private defaultChoiceId: string | null = null;
  @state() private yesLabel: Record<string, string> = {};
  @state() private noLabel: Record<string, string> = {};
  @state() private defaultValue = false;
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("fieldErrors")) {
      this.serverErrors = Object.fromEntries(
        Object.entries(this.fieldErrors).map(([key, message]) => {
          const match = /^choices\.(\d+)\.(.+)$/.exec(key);
          if (!match) return [key.replace(/^(name|yesLabel|noLabel)\./, "$1-"), message];
          const choice =
            this.choices[Number(match[1])] ??
            (this.value && "choices" in this.value
              ? this.value.choices[Number(match[1])]
              : undefined);
          if (!choice) return ["_form", message];
          const field = match[2]!;
          const mapped = field.startsWith("name.")
            ? `name-${choice.id}-${field.slice(5)}`
            : field === "id"
              ? `choice-${choice.id}`
              : `${field}-${choice.id}`;
          return [mapped, message];
        }),
      );
    }
    if (!(changed.has("open") && this.open) && !changed.has("value")) return;
    const value = this.value;
    this.name = { ...value?.name };
    this.type = value?.type ?? "text";
    this.available = value?.available ?? true;
    this.required = value?.type === "extras" && value.required;
    this.cap =
      value?.type === "extras" && value.maxTotalQuantity !== null
        ? String(value.maxTotalQuantity)
        : "";
    this.choices =
      value && (value.type === "extras" || value.type === "options")
        ? value.choices.map((choice) => ({
            ...structuredClone(choice),
            priceDelta: "priceDelta" in choice ? choice.priceDelta : "0.00",
            maxQuantity: "maxQuantity" in choice ? String(choice.maxQuantity) : "1",
            defaultQuantity: "defaultQuantity" in choice ? String(choice.defaultQuantity) : "0",
          }))
        : [];
    this.defaultChoiceId = value?.type === "options" ? value.defaultChoiceId : null;
    this.yesLabel = value?.type === "yes-no" ? { ...value.yesLabel } : {};
    this.noLabel = value?.type === "yes-no" ? { ...value.noLabel } : {};
    this.defaultValue = value?.type === "yes-no" ? value.defaultValue : false;
    this.errors = {};
  }
  #error(key: string): string {
    return this.errors[key] ?? this.serverErrors[key] ?? "";
  }
  #changeChoice(id: string, patch: Partial<ChoiceDraft>): void {
    this.choices = this.choices.map((choice) =>
      choice.id === id ? { ...choice, ...patch } : choice,
    );
    if (patch.available === false) {
      this.choices = this.choices.map((choice) =>
        choice.id === id ? { ...choice, defaultQuantity: "0" } : choice,
      );
      if (this.defaultChoiceId === id) this.defaultChoiceId = null;
    }
  }
  #switchType(type: ModifierInput["type"]): void {
    this.type = type;
    this.choices = [];
    this.required = false;
    this.cap = "";
    this.defaultChoiceId = null;
    this.yesLabel = {};
    this.noLabel = {};
    this.defaultValue = false;
    this.errors = {};
  }
  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }
  #save(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const errors: Record<string, string> = {};
    const language = currentContentLanguages().defaultLanguage;
    const name = (value: Record<string, string>, key: string) => {
      if (!value[language]?.trim()) errors[key] = t("modifiers.name_required");
    };
    name(this.name, "name");
    if (this.type === "yes-no") {
      name(this.yesLabel, "yesLabel");
      name(this.noLabel, "noLabel");
    }
    if (this.type === "extras" || this.type === "options") {
      if (
        this.available &&
        (this.type === "options" || this.required) &&
        !this.choices.some((choice) => choice.available)
      )
        errors.choices = t("modifiers.choices_required");
      for (const choice of this.choices) {
        name(choice.name, `name-${choice.id}`);
        if (this.type === "extras") {
          if (!/^\d+(?:\.\d{1,2})?$/.test(choice.priceDelta))
            errors[`priceDelta-${choice.id}`] = t("modifiers.price_invalid");
          if (
            !/^\d+$/.test(choice.maxQuantity) ||
            !Number.isSafeInteger(Number(choice.maxQuantity)) ||
            Number(choice.maxQuantity) < 1
          )
            errors[`maxQuantity-${choice.id}`] = t("modifiers.quantity_invalid");
          if (
            !/^\d+$/.test(choice.defaultQuantity) ||
            !Number.isSafeInteger(Number(choice.defaultQuantity)) ||
            Number(choice.defaultQuantity) > Number(choice.maxQuantity) ||
            (!choice.available && Number(choice.defaultQuantity) > 0)
          )
            errors[`defaultQuantity-${choice.id}`] = t("modifiers.quantity_invalid");
        }
      }
    }
    if (this.type === "extras" && this.cap !== "") {
      if (
        !/^\d+$/.test(this.cap) ||
        !Number.isSafeInteger(Number(this.cap)) ||
        Number(this.cap) < 1
      )
        errors.maxTotalQuantity = t("modifiers.quantity_invalid");
      else if (
        this.choices.reduce((sum, choice) => sum + Number(choice.defaultQuantity), 0) >
        Number(this.cap)
      )
        errors.maxTotalQuantity = t("modifiers.defaults_invalid");
    }
    this.errors = errors;
    if (Object.keys(errors).length) return;
    const common = { name: clean(this.name), available: this.available };
    const choices = this.choices.map((choice) => ({
      id: choice.id,
      name: clean(choice.name),
      available: choice.available,
      ...(choice.addAllergens === undefined ? {} : { addAllergens: choice.addAllergens }),
      ...(choice.removeAllergens === undefined ? {} : { removeAllergens: choice.removeAllergens }),
      ...(choice.addOrigins === undefined ? {} : { addOrigins: choice.addOrigins }),
      ...(choice.removeOrigins === undefined ? {} : { removeOrigins: choice.removeOrigins }),
    }));
    let value: ModifierInput;
    switch (this.type) {
      case "text":
        value = { ...common, type: "text" };
        break;
      case "yes-no":
        value = {
          ...common,
          type: "yes-no",
          yesLabel: clean(this.yesLabel),
          noLabel: clean(this.noLabel),
          defaultValue: this.defaultValue,
        };
        break;
      case "options":
        value = { ...common, type: "options", choices, defaultChoiceId: this.defaultChoiceId };
        break;
      case "extras":
        value = {
          ...common,
          type: "extras",
          required: this.required,
          maxTotalQuantity: this.cap === "" ? null : Number(this.cap),
          choices: choices.map((choice, index): ModifierExtraChoice => ({
            ...choice,
            priceDelta: this.choices[index]!.priceDelta,
            maxQuantity: Number(this.choices[index]!.maxQuantity),
            defaultQuantity: Number(this.choices[index]!.defaultQuantity),
            ...(this.choices[index]!.vatClass === undefined
              ? {}
              : { vatClass: this.choices[index]!.vatClass }),
          })),
        };
    }
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
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
  #move(id: string, delta: number): void {
    const index = this.choices.findIndex((choice) => choice.id === id);
    const next = [...this.choices];
    const [choice] = next.splice(index, 1);
    next.splice(index + delta, 0, choice!);
    this.choices = next;
  }
  #effectList(
    choice: ChoiceDraft,
    key: "removeAllergens" | "addOrigins" | "removeOrigins",
    label: string,
    options: readonly string[],
  ) {
    const selected = choice[key] ?? [];
    const display = (code: string) =>
      key === "removeAllergens"
        ? allergenName(code)
        : t(`origin.${code}` as `origin.${(typeof DIETARY_ORIGINS)[number]}`);
    return html`<label
        >${label}<select
          name=${`${key}-${choice.id}`}
          .disabled=${this.busy}
          @change=${(event: Event) => {
            event.stopPropagation();
            const select = event.target as HTMLSelectElement;
            if (select.value) this.#changeChoice(choice.id, { [key]: [...selected, select.value] });
            select.value = "";
          }}
        >
          <option value="">${t("modifiers.choose")}</option>
          ${options.filter((code) => !selected.includes(code)).map((code) => html`<option value=${code}>${display(code)}</option>`)}
        </select></label
      >${selected.map((code) => html`<div class="selected"><span>${display(code)}</span><wt-button variant="secondary" .disabled=${this.busy} aria-label=${`${t("action.remove")}: ${label} ${display(code)}`} @click=${() => this.#changeChoice(choice.id, { [key]: selected.filter((value) => value !== code) })}>${t("action.remove")}</wt-button></div>`)}`;
  }
  #effects(choice: ChoiceDraft) {
    const added = choice.addAllergens ?? {};
    return html`<details>
      <summary>${t("modifiers.effects")}</summary>
      <div class="fields">
        <label
          >${t("modifiers.add_allergen")}<select
            name=${`addAllergens-${choice.id}`}
            .disabled=${this.busy}
            @change=${(event: Event) => {
              event.stopPropagation();
              const select = event.target as HTMLSelectElement;
              if (select.value)
                this.#changeChoice(choice.id, {
                  addAllergens: { ...added, [select.value]: { presence: "contains" } },
                  removeAllergens: (choice.removeAllergens ?? []).filter(
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
                  name=${`presence-${choice.id}-${code}`}
                  .disabled=${this.busy}
                  @change=${(event: Event) => {
                    event.stopPropagation();
                    this.#changeChoice(choice.id, {
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
                  this.#changeChoice(choice.id, { addAllergens: next });
                }}
                >${t("action.remove")}</wt-button
              >
            </div>`,
        )}
        ${this.#effectList(
          choice,
          "removeAllergens",
          t("modifiers.remove_allergen"),
          ALLERGEN_CODES.filter((code) => !added[code]),
        )}
        ${this.#effectList(choice, "addOrigins", t("modifiers.add_food"), DIETARY_ORIGINS)}${this.#effectList(choice, "removeOrigins", t("modifiers.remove_food"), DIETARY_ORIGINS)}
      </div>
    </details>`;
  }
  #choice(choice: ChoiceDraft, index: number) {
    return html`<fieldset data-choice=${choice.id}>
      <legend>${t("modifiers.choice")} ${index + 1}</legend>
      ${this.#error(`choice-${choice.id}`) ? html`<p class="error">${this.#error(`choice-${choice.id}`)}</p>` : nothing}
      ${this.#names(`name-${choice.id}`, t("modifiers.name"), choice.name, (name) => this.#changeChoice(choice.id, { name }))}
      ${this.#toggle(`available-${choice.id}`, t("modifiers.available"), choice.available, (available) => this.#changeChoice(choice.id, { available }))}
      ${
        this.type === "extras"
          ? html`${this.#input(`priceDelta-${choice.id}`, t("modifiers.price"), choice.priceDelta, (priceDelta) => this.#changeChoice(choice.id, { priceDelta }), true)}${this.#input(`maxQuantity-${choice.id}`, t("modifiers.max_quantity"), choice.maxQuantity, (maxQuantity) => this.#changeChoice(choice.id, { maxQuantity }), true)}${this.#input(`defaultQuantity-${choice.id}`, t("modifiers.default_quantity"), choice.defaultQuantity, (defaultQuantity) => this.#changeChoice(choice.id, { defaultQuantity }), true)}<label
                >${t("modifiers.vat")}<select
                  name=${`vatClass-${choice.id}`}
                  .disabled=${this.busy}
                  @change=${(event: Event) => {
                    event.stopPropagation();
                    this.#changeChoice(choice.id, {
                      vatClass: ((event.target as HTMLSelectElement).value as VatClass) || null,
                    });
                  }}
                >
                  <option value="" ?selected=${!choice.vatClass}>
                    ${t("modifiers.inherit_vat")}
                  </option>
                  ${(["general", "reduced", "super_reduced", "zero"] as const).map((value) => html`<option value=${value} ?selected=${choice.vatClass === value}>${vatClassName(value)}</option>`)}
                </select></label
              >`
          : nothing
      }
      ${this.#effects(choice)}
      <div class="actions">
        <wt-button
          variant="secondary"
          data-test=${`up-${choice.id}`}
          .disabled=${this.busy || index === 0}
          aria-label=${`${t("modifiers.move_up")}: ${index + 1}`}
          @click=${() => this.#move(choice.id, -1)}
          >${t("modifiers.move_up")}</wt-button
        ><wt-button
          variant="secondary"
          data-test=${`down-${choice.id}`}
          .disabled=${this.busy || index === this.choices.length - 1}
          aria-label=${`${t("modifiers.move_down")}: ${index + 1}`}
          @click=${() => this.#move(choice.id, 1)}
          >${t("modifiers.move_down")}</wt-button
        ><wt-button
          variant="danger"
          data-test=${`remove-${choice.id}`}
          .disabled=${this.busy}
          aria-label=${`${t("action.remove")}: ${index + 1}`}
          @click=${() => {
            this.choices = this.choices.filter((value) => value.id !== choice.id);
            if (this.defaultChoiceId === choice.id) this.defaultChoiceId = null;
          }}
          >${t("action.remove")}</wt-button
        >
      </div>
    </fieldset>`;
  }
  override render() {
    return html`<wt-modal
      .open=${this.open}
      heading=${this.value ? t("modifiers.edit") : t("modifiers.new")}
      @wt-close=${(event: Event) => this.#cancel(event)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'));
      }}
    >
      ${Object.keys(this.errors).length || Object.keys(this.fieldErrors).length ? html`<p class="error" role="alert">${t("modifiers.problem")}</p>` : nothing}${this.#error("_form") ? html`<p class="error">${this.#error("_form")}</p>` : nothing}
      <div class="fields">
        ${this.#names("name", t("modifiers.name"), this.name, (name) => {
          this.name = name;
        })}<label
          >${t("modifiers.type")}<select
            name="type"
            .disabled=${this.busy}
            @change=${(event: Event) => {
              event.stopPropagation();
              this.#switchType((event.target as HTMLSelectElement).value as ModifierInput["type"]);
            }}
          >
            ${TYPES.map((type) => html`<option value=${type} ?selected=${this.type === type}>${t(`modifiers.${type}`)}</option>`)}
          </select></label
        >
        ${this.#toggle("available", t("modifiers.available"), this.available, (value) => {
          this.available = value;
        })}
        ${this.type === "text" ? html`<p>${t("modifiers.text_help")}</p>` : nothing}
        ${
          this.type === "yes-no"
            ? html`${this.#names("yesLabel", t("modifiers.yes_label"), this.yesLabel, (value) => {
                this.yesLabel = value;
              })}${this.#names("noLabel", t("modifiers.no_label"), this.noLabel, (value) => {
                this.noLabel = value;
              })}${this.#toggle(
                "defaultValue",
                t("modifiers.default_value"),
                this.defaultValue,
                (value) => {
                  this.defaultValue = value;
                },
              )}`
            : nothing
        }
        ${
          this.type === "extras"
            ? html`${this.#toggle("required", t("modifiers.required"), this.required, (value) => {
                this.required = value;
              })}${this.#input("maxTotalQuantity", t("modifiers.max_total"), this.cap, (value) => {
                this.cap = value;
              })}`
            : nothing
        }
        ${
          this.type === "extras" || this.type === "options"
            ? html`<div class="choices">
                  ${repeat(
                    this.choices,
                    (choice) => choice.id,
                    (choice, index) => this.#choice(choice, index),
                  )}
                </div>
                ${this.#error("choices") ? html`<p class="error">${this.#error("choices")}</p>` : nothing}<wt-button
                  data-test="add-choice"
                  variant="secondary"
                  .disabled=${this.busy}
                  @click=${() => {
                    this.choices = [
                      ...this.choices,
                      {
                        id: crypto.randomUUID(),
                        name: {},
                        available: true,
                        priceDelta: "0.00",
                        maxQuantity: "1",
                        defaultQuantity: "0",
                      },
                    ];
                  }}
                  >${t("modifiers.add_choice")}</wt-button
                >`
            : nothing
        }
        ${
          this.type === "options"
            ? html`<label
                >${t("modifiers.default_choice")}<select
                  name="defaultChoiceId"
                  .disabled=${this.busy}
                  @change=${(event: Event) => {
                    event.stopPropagation();
                    this.defaultChoiceId = (event.target as HTMLSelectElement).value || null;
                  }}
                >
                  <option value="" ?selected=${this.defaultChoiceId === null}>
                    ${t("modifiers.no_default")}
                  </option>
                  ${this.choices.filter((choice) => choice.available).map((choice) => html`<option value=${choice.id} ?selected=${choice.id === this.defaultChoiceId}>${choice.name[currentContentLanguages().defaultLanguage] || t("modifiers.choice")}</option>`)}
                </select></label
              >`
            : nothing
        }
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          data-test="cancel"
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="save"
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
    "dashboard-modifier-form": ModifierForm;
  }
}
