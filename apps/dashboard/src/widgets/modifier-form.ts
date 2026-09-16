import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, selectStyles, currentContentLanguages, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "./choice-form.js";
import type { ChoiceDraft } from "./choice-form.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { type Modifier, type ModifierInput, type ModifierExtraChoice } from "../api/client.js";
import { isModifierPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { t } from "../i18n/t.js";
import {
  isModifierQuantity,
  nameFields,
  nonBlankNames,
  switchField,
  textField,
  type FieldContext,
} from "./form-fields.js";

/** A choice as the modifier form holds it while editing: the modal's `ChoiceDraft` (name,
 * availability, and — for an extra — price, quantity, tax and effects) plus `preselected`, which
 * the table owns because it is edited inline, not in the modal. For an options choice `preselected`
 * is unused; the single options default is tracked separately as `defaultChoiceId`. */
type FormChoice = ChoiceDraft & { preselected: boolean };
const TYPES = ["text", "extras", "options"] as const;

@customElement("dashboard-modifier-form")
export class ModifierForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    ReorderController.styles,
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
      .choice-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
      /* The table is the one element allowed to be wider than the modal; its own scroller keeps the
         dialog from scrolling sideways at phone width. */
      .choices-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        text-align: start;
        vertical-align: middle;
        border-bottom: 1px solid var(--wt-color-border);
      }
      /* The name is the widest cell; let it wrap and cap it so the switch, default control and menu
         stay on screen at phone width instead of pushing the row into a horizontal scroll. */
      td:nth-child(2) {
        max-width: var(--wt-cell-name-max-width);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
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
  @state() private required = false;
  @state() private cap = "";
  @state() private choices: FormChoice[] = [];
  @state() private defaultChoiceId: string | null = null;
  @state() private choiceOpen = false;
  @state() private editingChoice: FormChoice | null = null;
  /** The drag-and-keyboard reorder table, shared with the product editor's variants table. It owns
   * the gesture, the row geometry, refocus and the live region; this form owns the choices array a
   * move rewrites and how a row is labelled. */
  readonly #reorder = new ReorderController(this, {
    order: () => this.choices.map((choice) => choice.id),
    move: (id, to) => this.#moveChoice(id, to),
    label: (id) => {
      const language = currentContentLanguages().defaultLanguage;
      return (
        this.choices.find((choice) => choice.id === id)?.name[language] || t("modifiers.choice")
      );
    },
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("modifiers.reorder");
    },
  } satisfies ReorderModel);
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("fieldErrors")) {
      const errors: Record<string, string> = {};
      for (const [key, message] of Object.entries(this.fieldErrors)) {
        // The server names a bad choice field by the choice's POSITION in the array it was sent, so
        // turn that position into the choice's own label; nothing shows a key the table cannot
        // place, and the array may have changed shape since the request went out.
        const position = /^choices\.(\d+)\./.exec(key)?.[1];
        const choice = position === undefined ? undefined : this.choices[Number(position)];
        if (choice === undefined) errors[key.replace(/^name\./, "name-")] = message;
        else errors.choices ??= this.#choiceProblem(choice);
      }
      this.serverErrors = errors;
    }
    if (!(changed.has("open") && this.open) && !changed.has("value")) return;
    const value = this.value;
    this.name = { ...value?.name };
    this.type = value?.type ?? "text";
    this.required = value?.type === "extras" && value.required;
    this.cap =
      value?.type === "extras" && value.maxTotalQuantity !== null
        ? String(value.maxTotalQuantity)
        : "";
    this.choices =
      value && (value.type === "extras" || value.type === "options")
        ? value.choices.map((choice) => ({
            ...structuredClone(choice),
            preselected: "preselected" in choice ? choice.preselected : false,
          }))
        : [];
    this.defaultChoiceId = value?.type === "options" ? value.defaultChoiceId : null;
    this.choiceOpen = false;
    this.editingChoice = null;
    this.errors = {};
  }
  #error(key: string): string {
    return this.errors[key] ?? this.serverErrors[key] ?? "";
  }
  /** A message under the choices table naming the choice it is about, as its row labels do. */
  #choiceProblem(choice: FormChoice): string {
    const language = currentContentLanguages().defaultLanguage;
    return `${t("modifiers.choice_problem")} ${choice.name[language] || t("modifiers.choice")}`;
  }
  /** An unavailable choice is neither preselected nor the single default, because the till reads
   * both. A row edit and a modal save pass through here. */
  #clearSelectionIfUnavailable(choice: FormChoice): FormChoice {
    if (choice.available) return choice;
    if (this.defaultChoiceId === choice.id) this.defaultChoiceId = null;
    return { ...choice, preselected: false };
  }
  #changeChoice(id: string, patch: Partial<FormChoice>): void {
    this.choices = this.choices.map((choice) =>
      choice.id === id ? this.#clearSelectionIfUnavailable({ ...choice, ...patch }) : choice,
    );
  }
  #switchType(type: ModifierInput["type"]): void {
    this.type = type;
    this.choices = [];
    this.required = false;
    this.cap = "";
    this.defaultChoiceId = null;
    this.choiceOpen = false;
    this.editingChoice = null;
    this.errors = {};
  }
  #openChoice(choice: FormChoice | null): void {
    this.editingChoice = choice;
    this.choiceOpen = true;
  }
  #choiceSaved(event: CustomEvent<{ value: ChoiceDraft }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    const existing = this.choices.find((choice) => choice.id === value.id);
    const merged = this.#clearSelectionIfUnavailable({
      ...value,
      preselected: existing?.preselected ?? false,
    });
    this.choices = existing
      ? this.choices.map((choice) => (choice.id === value.id ? merged : choice))
      : [...this.choices, merged];
    this.choiceOpen = false;
    this.editingChoice = null;
  }
  #choiceCancelled(event: Event): void {
    event.stopPropagation();
    this.choiceOpen = false;
    this.editingChoice = null;
  }
  #removeChoice(id: string): void {
    this.choices = this.choices.filter((choice) => choice.id !== id);
    if (this.defaultChoiceId === id) this.defaultChoiceId = null;
  }
  #indexOfChoice(id: string): number {
    return this.choices.findIndex((choice) => choice.id === id);
  }
  /** The choices array order IS the saved order, so a move rewrites the array rather than a rank. */
  #moveChoice(id: string, to: number): void {
    const from = this.#indexOfChoice(id);
    if (from < 0) return;
    this.choices = reorder(this.choices, from, to);
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
    if (!this.name[language]?.trim()) errors.name = t("modifiers.name_required");
    if (
      (this.type === "extras" || this.type === "options") &&
      (this.type === "options" || this.required) &&
      !this.choices.some((choice) => choice.available)
    )
      errors.choices = t("modifiers.choices_required");
    // Every choice is checked, not just one the modal happens to have open: the modal validates what
    // it saves, but a choice can also reach the table already broken — from an earlier save, or from
    // a field this form edits inline.
    if (!errors.choices) {
      const extras = this.type === "extras";
      const broken = this.choices.find((choice) => {
        if (!choice.name[language]?.trim()) return true;
        if (!extras) return false;
        // The defaults mirror what #save submits for an absent value, so this checks the number the
        // server will actually receive.
        return (
          !isModifierPrice(choice.priceDelta ?? "0.00") ||
          !isModifierQuantity(String(choice.maxQuantity ?? 1))
        );
      });
      if (broken !== undefined) errors.choices = this.#choiceProblem(broken);
    }
    if (this.type === "extras" && this.cap !== "") {
      if (!isModifierQuantity(this.cap)) errors.maxTotalQuantity = t("modifiers.quantity_invalid");
      // A well-formed cap that the preselections exceed is not a bad cap: say which side to change,
      // beside the choices that are the problem.
      else if (
        !errors.choices &&
        this.choices.filter((choice) => choice.preselected).length > Number(this.cap)
      )
        errors.choices = t("modifiers.too_many_preselected");
    }
    this.errors = errors;
    if (Object.keys(errors).length) return;
    const common = {
      name: nonBlankNames(this.name),
      available: true,
    };
    const choices = this.choices.map((choice) => ({
      id: choice.id,
      name: nonBlankNames(choice.name),
      available: choice.available,
      ...(choice.addAllergens === undefined ? {} : { addAllergens: choice.addAllergens }),
      ...(choice.suitableFor === undefined ? {} : { suitableFor: choice.suitableFor }),
    }));
    let value: ModifierInput;
    switch (this.type) {
      case "text":
        value = { ...common, type: "text" };
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
            priceDelta: this.choices[index]!.priceDelta ?? "0.00",
            maxQuantity: this.choices[index]!.maxQuantity ?? 1,
            preselected: this.choices[index]!.preselected,
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
  #fields(): FieldContext {
    return { busy: this.busy, locales: this.locales, error: (key) => this.#error(key) };
  }
  #choiceRow(choice: FormChoice, language: string, extras: boolean) {
    const label = choice.name[language] || t("modifiers.choice");
    return html`<tr data-choice=${choice.id}>
      <td>${this.#reorder.handle(choice.id)}</td>
      <td>${label}</td>
      ${extras ? html`<td>${choice.priceDelta ?? "0.00"}</td>` : nothing}
      <td>
        <wt-switch
          name=${`available-${choice.id}`}
          data-test=${`available-${choice.id}`}
          label=${t("modifiers.available")}
          .checked=${choice.available}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#changeChoice(choice.id, { available: event.detail.checked });
          }}
        ></wt-switch>
      </td>
      <td>
        ${
          extras
            ? html`<input
                type="checkbox"
                name=${`preselect-${choice.id}`}
                data-test=${`preselect-${choice.id}`}
                aria-label=${`${t("modifiers.preselected")}: ${label}`}
                .checked=${choice.preselected}
                ?disabled=${!choice.available || this.busy}
                @change=${(event: Event) =>
                  this.#changeChoice(choice.id, {
                    preselected: (event.target as HTMLInputElement).checked,
                  })}
              />`
            : html`<input
                type="radio"
                name="default"
                data-test=${`default-${choice.id}`}
                aria-label=${`${t("modifiers.default")}: ${label}`}
                .checked=${this.defaultChoiceId === choice.id}
                ?disabled=${!choice.available || this.busy}
                @change=${() => {
                  this.defaultChoiceId = choice.id;
                }}
              />`
        }
      </td>
      <td>
        <wt-row-actions align="end" label=${`${t("modifiers.edit_choice")}: ${label}`}
          ><wt-button
            align="start"
            variant="secondary"
            data-test=${`edit-${choice.id}`}
            .disabled=${this.busy}
            @click=${() => this.#openChoice(choice)}
            >${t("action.edit")}</wt-button
          ><wt-button
            align="start"
            variant="danger"
            data-test=${`remove-${choice.id}`}
            .disabled=${this.busy}
            @click=${() => this.#removeChoice(choice.id)}
            >${t("action.remove")}</wt-button
          ></wt-row-actions
        >
      </td>
    </tr>`;
  }
  #choicesTable() {
    const language = currentContentLanguages().defaultLanguage;
    const extras = this.type === "extras";
    return html`<table>
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">${t("modifiers.reorder")}</span></th>
          <th scope="col">${t("modifiers.name")}</th>
          ${extras ? html`<th scope="col">${t("modifiers.price")}</th>` : nothing}
          <th scope="col">${t("modifiers.available")}</th>
          <th scope="col">${extras ? t("modifiers.preselected") : t("modifiers.default")}</th>
          <th scope="col"><span class="visually-hidden">${t("action.edit")}</span></th>
        </tr>
      </thead>
      <tbody>
        ${repeat(
          this.choices,
          (choice) => choice.id,
          (choice) => this.#choiceRow(choice, language, extras),
        )}
      </tbody>
    </table>`;
  }
  #choicesSection() {
    return html`${this.#reorder.liveRegion()}
      <div class="choices-wrap">${this.#choicesTable()}</div>
      ${this.#error("choices") ? html`<p class="error">${this.#error("choices")}</p>` : nothing}
      <div class="choice-actions">
        <wt-button
          data-test="add-choice"
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => this.#openChoice(null)}
          >${t("modifiers.add_choice")}</wt-button
        >${
          this.type === "options" && this.defaultChoiceId !== null
            ? html`<wt-button
                data-test="clear-default"
                variant="ghost"
                .disabled=${this.busy}
                @click=${() => {
                  this.defaultChoiceId = null;
                }}
                >${t("modifiers.clear_default")}</wt-button
              >`
            : nothing
        }
      </div>
      <dashboard-choice-form
        ?open=${this.choiceOpen}
        .busy=${this.busy}
        .locales=${this.locales}
        kind=${this.type === "extras" ? "extras" : "options"}
        .value=${this.editingChoice}
        @wt-choice-save=${(event: CustomEvent<{ value: ChoiceDraft }>) => this.#choiceSaved(event)}
        @wt-choice-cancel=${(event: Event) => this.#choiceCancelled(event)}
        @keydown=${(event: Event) => event.stopPropagation()}
      ></dashboard-choice-form>`;
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
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${Object.values({ ...this.serverErrors, ...this.errors })}
      ></wt-form-error-summary>
      <div class="fields">
        ${nameFields(this.#fields(), "name", t("modifiers.name"), this.name, (name) => {
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
        ${this.type === "text" ? html`<p>${t("modifiers.text_help")}</p>` : nothing}
        ${
          this.type === "extras"
            ? html`${switchField(
                this.#fields(),
                "required",
                t("modifiers.required"),
                this.required,
                (value) => {
                  this.required = value;
                },
              )}${textField(
                this.#fields(),
                "maxTotalQuantity",
                t("modifiers.max_total"),
                this.cap,
                (value) => {
                  this.cap = value;
                },
              )}`
            : nothing
        }
        ${this.type === "extras" || this.type === "options" ? this.#choicesSection() : nothing}
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
