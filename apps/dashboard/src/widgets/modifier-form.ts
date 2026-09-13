import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  selectStyles,
  disabledStyles,
  currentContentLanguages,
  submitOnEnter,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "./choice-form.js";
import type { ChoiceDraft } from "./choice-form.js";
import { reorder } from "./reorder.js";
import { type Modifier, type ModifierInput, type ModifierExtraChoice } from "../api/client.js";
import { t } from "../i18n/t.js";

/** A choice as the modifier form holds it while editing: the modal's `ChoiceDraft` (name,
 * availability, and — for an extra — price, quantity, tax and effects) plus `preselected`, which
 * the table owns because it is edited inline, not in the modal. For an options choice `preselected`
 * is unused; the single options default is tracked separately as `defaultChoiceId`. */
type FormChoice = ChoiceDraft & { preselected: boolean };
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
        max-width: 140px;
      }
      .handle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        cursor: grab;
        /* A touch that starts on the handle drags the row; without this the browser claims the
           gesture and scrolls the modal instead. Not a themed value, so no token. */
        touch-action: none;
      }
      /* The handle is a bespoke button, so it needs the shared disabled treatment the primitives in
         the same row apply themselves. */
      .handle:disabled {
        ${disabledStyles}
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
  @state() private available = true;
  @state() private required = false;
  @state() private cap = "";
  @state() private choices: FormChoice[] = [];
  @state() private defaultChoiceId: string | null = null;
  @state() private defaultValue = false;
  @state() private choiceOpen = false;
  @state() private editingChoice: FormChoice | null = null;
  /** The live pointer drag: the choice being dragged and the pointer that owns the gesture. */
  #drag: { id: string; pointerId: number } | null = null;
  /** Set by a keyboard move so the next update can return focus to the handle that moved. */
  #refocus: string | null = null;
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
            preselected: "preselected" in choice ? choice.preselected : false,
          }))
        : [];
    this.defaultChoiceId = value?.type === "options" ? value.defaultChoiceId : null;
    this.defaultValue = value?.type === "yes-no" ? value.defaultValue : false;
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
  #changeChoice(id: string, patch: Partial<FormChoice>): void {
    this.choices = this.choices.map((choice) =>
      choice.id === id ? { ...choice, ...patch } : choice,
    );
    // Turning a choice off must not leave it preselected or the single default, and the till reads
    // both — so clear them here, where availability changes, whether toggled from the row or resaved
    // from the modal as unavailable.
    if (patch.available === false) {
      this.choices = this.choices.map((choice) =>
        choice.id === id ? { ...choice, preselected: false } : choice,
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
    this.defaultValue = false;
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
    const merged: FormChoice = { ...value, preselected: existing?.preselected ?? false };
    if (!merged.available) {
      merged.preselected = false;
      if (this.defaultChoiceId === merged.id) this.defaultChoiceId = null;
    }
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
  #reorderKey(event: KeyboardEvent, id: string): void {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (delta === 0 || this.busy) return;
    // Without this the arrow scrolls the modal, carrying the row out from under the handle.
    event.preventDefault();
    this.#moveChoice(id, this.#indexOfChoice(id) + delta);
    // The move re-inserts the handle's DOM node, which drops focus; restore it after the update so
    // repeated presses keep moving the same choice.
    this.#refocus = id;
  }
  #startDrag(event: PointerEvent, id: string): void {
    if (this.busy || this.#drag !== null) return;
    // Keep the press from selecting the row's text or starting the browser's own drag.
    event.preventDefault();
    this.#drag = { id, pointerId: event.pointerId };
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerEnd);
    document.addEventListener("pointercancel", this.#onPointerEnd);
  }
  readonly #onPointerMove = (event: PointerEvent): void => {
    const drag = this.#drag;
    // Ignore a stray second pointer: only the one that started the gesture moves the row.
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const over = this.#choiceAt(event.clientY);
    if (over === null || over === drag.id) return;
    this.#moveChoice(drag.id, this.#indexOfChoice(over));
  };
  /** Ends the gesture. A cancelled pointer (the OS interrupting a touch) needs no separate handler:
   * each crossed row has already been committed to `choices`, so there is nothing to commit here. */
  readonly #onPointerEnd = (event: PointerEvent): void => {
    if (this.#drag !== null && event.pointerId !== this.#drag.pointerId) return;
    this.#endDrag();
  };
  #endDrag(): void {
    this.#drag = null;
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerEnd);
    document.removeEventListener("pointercancel", this.#onPointerEnd);
  }
  /** The choice whose row box contains `clientY`, or null when `clientY` is outside every row. */
  #choiceAt(clientY: number): string | null {
    for (const row of this.shadowRoot!.querySelectorAll("tbody tr")) {
      const box = row.getBoundingClientRect();
      if (clientY >= box.top && clientY <= box.bottom) return row.getAttribute("data-choice");
    }
    return null;
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#endDrag();
  }
  override updated(): void {
    const id = this.#refocus;
    if (id === null) return;
    this.#refocus = null;
    this.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)?.focus();
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
      this.available &&
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
        const quantity = choice.maxQuantity ?? 1;
        return (
          !/^\d+(?:\.\d{1,2})?$/.test(choice.priceDelta ?? "0.00") ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1
        );
      });
      if (broken !== undefined) errors.choices = this.#choiceProblem(broken);
    }
    if (this.type === "extras" && this.cap !== "") {
      if (
        !/^\d+$/.test(this.cap) ||
        !Number.isSafeInteger(Number(this.cap)) ||
        Number(this.cap) < 1
      )
        errors.maxTotalQuantity = t("modifiers.quantity_invalid");
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
    const common = { name: clean(this.name), available: this.available };
    const choices = this.choices.map((choice) => ({
      id: choice.id,
      name: clean(choice.name),
      available: choice.available,
      ...(choice.addAllergens === undefined ? {} : { addAllergens: choice.addAllergens }),
      ...(choice.removeAllergens === undefined ? {} : { removeAllergens: choice.removeAllergens }),
      ...(choice.dietaryEffect === undefined ? {} : { dietaryEffect: choice.dietaryEffect }),
    }));
    let value: ModifierInput;
    switch (this.type) {
      case "text":
        value = { ...common, type: "text" };
        break;
      case "yes-no":
        value = { ...common, type: "yes-no", defaultValue: this.defaultValue };
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
  #choiceRow(choice: FormChoice, language: string, extras: boolean) {
    const label = choice.name[language] || t("modifiers.choice");
    return html`<tr data-choice=${choice.id}>
      <td>
        <button
          type="button"
          class="handle"
          data-test=${`drag-${choice.id}`}
          aria-label=${`${t("modifiers.reorder")}: ${label}`}
          ?disabled=${this.busy}
          @keydown=${(event: KeyboardEvent) => this.#reorderKey(event, choice.id)}
          @pointerdown=${(event: PointerEvent) => this.#startDrag(event, choice.id)}
        >
          <wt-icon name="grip"></wt-icon>
        </button>
      </td>
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
        <wt-row-actions label=${`${t("modifiers.edit_choice")}: ${label}`}
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
    return html`<div class="choices-wrap">${this.#choicesTable()}</div>
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
      ${Object.keys(this.errors).length || Object.keys(this.fieldErrors).length ? html`<p class="error" role="alert">${t("modifiers.problem")}</p>` : nothing}
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
            ? this.#toggle(
                "defaultValue",
                t("modifiers.default_value"),
                this.defaultValue,
                (value) => {
                  this.defaultValue = value;
                },
              )
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
