import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { optionalTextFields, switchField, textField, type FieldContext } from "./form-fields.js";
import { sameValue } from "./product-editor-model.js";
import { t } from "../i18n/t.js";

export interface DraftLabel {
  id: string;
  name: string;
  customerName: Record<string, string>;
  kitchenName: string;
  available: boolean;
}

/** One option of an options list, edited on its own. Nothing is sent from here: the list form holds
 * the draft and sends the whole list when the list itself is saved. */
@customElement("dashboard-option-label-form")
export class OptionLabelForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .fields,
      .names {
        display: grid;
        gap: var(--wt-space-4);
      }
      .names {
        gap: var(--wt-space-3);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend {
        margin-bottom: var(--wt-space-2);
        padding: 0;
      }
      .group-label {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) draftParent?: object;
  @property({ type: Boolean }) busy = false;
  /** The option to edit; null adds a new one. */
  @property({ attribute: false }) value: DraftLabel | null = null;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  /** Messages keyed by the input's `name` (`label-name`, `label-customer-name-<lang>`,
   * `label-kitchen-name`); any other key names no input here and is shown above Save alone. The
   * list form builds a new object on every render, so only a change of contents counts. */
  @property({
    attribute: false,
    hasChanged: (next: Record<string, string>, previous?: Record<string, string>) =>
      !sameValue(next, previous),
  })
  errors: Record<string, string> = {};
  @state() private name = "";
  @state() private customerName: Record<string, string> = {};
  @state() private kitchenName = "";
  @state() private available = true;
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  #scope?: DraftScope<Omit<DraftLabel, "id">>;
  /** Opened showing a refusal, so Save starts active: a refusal never disables it (owner, A410). */
  #refusedAtOpen = false;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #registerDraft(): void {
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (this.isConnected && !this.#scope) {
      const { coordinator, scope } = draftScopeFor<Omit<DraftLabel, "id">>(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.#comparisonValue(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: (value) => this.#restoreDraft(value),
      });
      this.#leave = coordinator;
      this.#scope = scope;
    }
  }

  /** Also waits for the dialog, whose native close moves focus, so a caller can place focus after it. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const result = await super.getUpdateComplete();
    await this.renderRoot.querySelector("wt-modal")?.updateComplete;
    return result;
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as DraftLabel | null | undefined)?.id)
    ) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#reseed();
    }
    if (changes.has("errors")) this.dismissed = new Set();
    this.#registerDraft();
  }

  protected override updated(changes: PropertyValues<this>): void {
    if (
      (changes.has("errors") || (changes.has("open") && this.open)) &&
      this.#fieldKeys(this.#errors()).length > 0
    )
      void focusFirstInvalid(this.shadowRoot!);
  }

  #reseed(): void {
    const value = this.value;
    this.name = value?.name ?? "";
    this.customerName = { ...value?.customerName };
    this.kitchenName = value?.kitchenName ?? "";
    this.available = value?.available ?? true;
    this.attempted = false;
    this.dismissed = new Set();
    this.#refusedAtOpen = Object.values(this.errors).some(Boolean);
  }

  #edit(change: () => void, ...keys: string[]): void {
    change();
    this.#scope?.changed();
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  #validate(): Record<string, string> {
    return this.name.trim() ? {} : { "label-name": t("options.label_name_required") };
  }

  /** The keys of `errors` that an input this form shows displays. */
  #fieldKeys(errors: Record<string, string>): string[] {
    const shown = new Set([
      "label-name",
      "label-kitchen-name",
      ...this.languages.languages.map((locale) => `label-customer-name-${locale}`),
    ]);
    return Object.keys(errors).filter((key) => errors[key] && shown.has(key));
  }

  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { value: DraftLabel } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    if (this.#saveAction().unchanged) return;
    this.attempted = true;
    this.dismissed = new Set(Object.keys(this.errors));
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.#emit(event, "wt-submit", {
      value: {
        // A new option gets its id here, not from the server: the list may name it as its default
        // in the same save, and `parseOptionListInput` refuses a default naming no submitted label.
        id: this.value?.id ?? crypto.randomUUID(),
        name: this.name,
        customerName: { ...this.customerName },
        kitchenName: this.kitchenName,
        available: this.available,
      },
    });
  }

  #saveAction() {
    return saveActionState(this.#scope, { savableAtOpen: this.#refusedAtOpen });
  }

  #comparisonValue(): Omit<DraftLabel, "id"> {
    return {
      name: this.name,
      customerName: { ...this.customerName },
      kitchenName: this.kitchenName,
      available: this.available,
    };
  }
  #restoreDraft(value: Omit<DraftLabel, "id">): void {
    this.name = value.name;
    this.customerName = { ...value.customerName };
    this.kitchenName = value.kitchenName;
    this.available = value.available;
  }
  closeSaved(submitted: DraftLabel): void {
    const { name, customerName, kitchenName, available } = submitted;
    this.#scope?.commit({ name, customerName, kitchenName, available });
    this.open = false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.open) return;
    if (this.#leave) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.#reportCancel();
  }

  #reportCancel(): void {
    if (this.busy || !this.open) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  #errors(): Record<string, string> {
    const refused = Object.fromEntries(
      Object.entries(this.errors).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...(this.attempted ? this.#validate() : {}) };
  }

  #fields(errors: Record<string, string>): FieldContext {
    return {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key) => errors[key] ?? "",
    };
  }

  #customerNames(errors: Record<string, string>) {
    const locales = this.languages.languages;
    return html`<fieldset class="names">
      <legend class="group-label" data-test="customer-names-heading">
        ${t("options.customer_names")}
      </legend>
      ${optionalTextFields(
        this.#fields(errors),
        "label-customer-name",
        t("options.customer_name"),
        this.customerName,
        (customerName) =>
          this.#edit(
            () => (this.customerName = customerName),
            ...locales
              .filter((locale) => customerName[locale] !== this.customerName[locale])
              .map((locale) => `label-customer-name-${locale}`),
          ),
        this.name,
        this.languages.defaultLanguage,
      )}
    </fieldset>`;
  }

  override render() {
    const errors = this.#errors();
    const fields = this.#fields(errors);
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    const saveAction = this.#saveAction();
    const bottom = [
      ...Object.entries(errors)
        .filter(([key, message]) => message && !fieldKeys.has(key))
        .map(([, message]) => message),
      ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      heading=${t(this.value ? "options.edit_option" : "options.add_option")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#reportCancel();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        ${textField(
          fields,
          "label-name",
          t("options.name"),
          this.name,
          (name) => this.#edit(() => (this.name = name), "label-name"),
          true,
        )}
        ${textField(
          fields,
          "label-kitchen-name",
          t("options.kitchen_name"),
          this.kitchenName,
          (kitchenName) => this.#edit(() => (this.kitchenName = kitchenName), "label-kitchen-name"),
          false,
          this.name,
        )}
        ${this.#customerNames(errors)}
        ${switchField(
          fields,
          "label-available",
          t("options.available"),
          this.available,
          (available) => this.#edit(() => (this.available = available)),
        )}
      </div>
      <wt-form-actions slot="footer" .error=${bottom}
        ><wt-button
          slot="cancel"
          data-test="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${saveAction.variant}
          .disabled=${saveAction.unchanged || this.busy || invalid}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-option-label-form": OptionLabelForm;
  }
}
