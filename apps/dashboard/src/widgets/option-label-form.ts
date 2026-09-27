import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { optionalTextFields, switchField, textField, type FieldContext } from "./form-fields.js";
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
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  /** The option to edit; null adds a new one. */
  @property({ attribute: false }) value: DraftLabel | null = null;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  /** Messages keyed by the input's `name` (`label-name`, `label-customer-name-<lang>`,
   * `label-kitchen-name`). */
  @property({ attribute: false }) errors: Record<string, string> = {};
  @state() private name = "";
  @state() private customerName: Record<string, string> = {};
  @state() private kitchenName = "";
  @state() private available = true;
  @state() private validation: Record<string, string> = {};

  /** Also waits for the dialog, whose native close moves focus, so a caller can place focus after it. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const result = await super.getUpdateComplete();
    await this.renderRoot.querySelector("wt-modal")?.updateComplete;
    return result;
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if ((changes.has("open") && this.open) || changes.has("value")) this.#reseed();
  }

  #reseed(): void {
    const value = this.value;
    this.name = value?.name ?? "";
    this.customerName = { ...value?.customerName };
    this.kitchenName = value?.kitchenName ?? "";
    this.available = value?.available ?? true;
    this.validation = {};
  }

  #edit(change: () => void): void {
    change();
    this.validation = {};
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
    if (!this.name.trim()) {
      this.validation = { "label-name": t("options.label_name_required") };
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

  #cancel(event: Event): void {
    // The dialog also reports a close it was told to make, a task later; by then the list form has
    // already closed this editor and a second cancel would be about nothing.
    if (this.busy || !this.open) {
      event.stopPropagation();
      return;
    }
    this.#emit(event, "wt-cancel", {});
  }

  #errors(): Record<string, string> {
    return { ...this.errors, ...this.validation };
  }

  #fields(errors: Record<string, string>): FieldContext {
    return {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key) => errors[key] ?? "",
    };
  }

  #namesSection(errors: Record<string, string>) {
    const locales = this.languages.languages;
    const filled =
      locales.filter((locale) => (this.customerName[locale] ?? "").trim()).length +
      (this.kitchenName.trim() ? 1 : 0);
    const hasError =
      !!errors["label-kitchen-name"] ||
      locales.some((locale) => !!errors[`label-customer-name-${locale}`]);
    return html`<wt-disclosure
      data-test="names-section"
      heading=${t("options.names_section")}
      summary=${t("options.names_summary")
        .replace("{filled}", String(filled))
        .replace("{total}", String(locales.length + 1))}
      .hasError=${hasError}
    >
      <div class="names">
        ${optionalTextFields(
          this.#fields(errors),
          "label-customer-name",
          t("options.customer_name"),
          this.customerName,
          (customerName) => this.#edit(() => (this.customerName = customerName)),
          this.name,
        )}
        ${textField(
          this.#fields(errors),
          "label-kitchen-name",
          t("options.kitchen_name"),
          this.kitchenName,
          (kitchenName) => this.#edit(() => (this.kitchenName = kitchenName)),
          false,
          this.name,
        )}
      </div>
    </wt-disclosure>`;
  }

  override render() {
    const errors = this.#errors();
    const fields = this.#fields(errors);
    return html`<wt-modal
      .open=${this.open}
      heading=${t(this.value ? "options.edit_option" : "options.add_option")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => this.#cancel(event)}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${Object.values(errors)}
        ></wt-form-error-summary>
        ${textField(
          fields,
          "label-name",
          t("options.name"),
          this.name,
          (name) => this.#edit(() => (this.name = name)),
          true,
        )}
        ${this.#namesSection(errors)}
        ${switchField(
          fields,
          "label-available",
          t("options.available"),
          this.available,
          (available) => this.#edit(() => (this.available = available)),
        )}
      </div>
      <wt-form-actions slot="footer"
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
          variant="primary"
          .disabled=${this.busy}
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
