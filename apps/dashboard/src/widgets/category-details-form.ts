import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { textField } from "./form-fields.js";
import type { CategorySummary } from "../api/client.js";
import { t } from "../i18n/t.js";

const FIELD_KEYS = new Set(["name", "color"]);

@customElement("dashboard-category-details-form")
export class CategoryDetailsForm extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .field-error {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-danger);
        text-align: start;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) value: CategorySummary | null = null;
  /** Refusals keyed `name`, `color`, or `_form` for one that concerns neither field. */
  @property({ attribute: false }) errors: Record<string, string> = {};
  @state() private name = "";
  @state() private color: string | null = null;
  @state() private attempted = false;
  /** Refusal keys the person has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as CategorySummary | null | undefined)?.id)
    ) {
      this.name = this.value?.name ?? "";
      this.color = this.value?.color ?? null;
      this.attempted = false;
      this.dismissed = new Set();
    }
    if (changes.has("errors")) this.dismissed = new Set();
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("errors") && this.#fieldKeys(this.errors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }
  #validate(): Record<string, string> {
    return this.name.trim() ? {} : { name: t("folders.name_required") };
  }
  #fieldKeys(errors: Record<string, string>): string[] {
    return Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && FIELD_KEYS.has(key))
      .map(([key]) => key);
  }
  #errors(): Record<string, string> {
    const refused = Object.fromEntries(
      Object.entries(this.errors).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...(this.attempted ? this.#validate() : {}) };
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { name: string; color: string | null } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.attempted = true;
    this.dismissed = new Set([...this.dismissed, ...Object.keys(this.errors)]);
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.#emit(event, "wt-submit", { name: this.name.trim(), color: this.color });
  }
  override render() {
    const errors = this.#errors();
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const bottom = [
      ...Object.entries(errors)
        .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
        .map(([, message]) => message),
      ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      heading=${t("folders.edit_heading")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        if (!this.busy && this.open) this.#emit(event, "wt-cancel", {});
        else event.stopPropagation();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        ${textField(
          { busy: this.busy, locales: [], error: () => errors.name ?? "" },
          "category-name",
          t("folders.name"),
          this.name,
          (value) => {
            this.name = value;
            this.dismissed = new Set([...this.dismissed, "name"]);
          },
          true,
        )}
        ${colorField({
          color: this.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "category-color",
          errorId: "category-color-error",
          change: (color) => {
            this.color = color;
            this.dismissed = new Set([...this.dismissed, "color"]);
          },
        })}
      </div>
      <p class="field-error" role="alert" data-test="form-error">
        ${this.open ? bottom || nothing : nothing}
      </p>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => {
            if (!this.busy) this.#emit(event, "wt-cancel", {});
            else event.stopPropagation();
          }}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant="primary"
          .disabled=${this.busy || invalid}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-details-form": CategoryDetailsForm;
  }
}
