import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-product-color-form")
export class ProductColorForm extends LitElement {
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
      .scope {
        margin: 0;
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
  @property() name = "";
  /** The product's own colour, or null when it takes its category's. */
  @property({ attribute: false }) color: string | null = null;
  /** What its category gives it: a colour, or null when the category has none. */
  @property({ attribute: false }) inherited: string | null = null;
  /** Refusals keyed `color`, or `_form` for one that concerns no field. */
  @property({ attribute: false }) errors: Record<string, string> = {};
  @state() private chosen: string | null = null;
  /** Refusal keys the person has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("open") && this.open) {
      this.chosen = this.color;
      this.dismissed = new Set();
    }
    if (changes.has("errors")) this.dismissed = new Set();
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("errors") && this.errors.color) void focusFirstInvalid(this.shadowRoot!);
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { color: string | null } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dismissed = new Set([...this.dismissed, ...Object.keys(this.errors)]);
    this.#emit(event, "wt-submit", { color: this.chosen });
  }
  override render() {
    const errors = Object.fromEntries(
      Object.entries(this.errors).filter(([key, message]) => message && !this.dismissed.has(key)),
    );
    const bottom = [
      ...Object.entries(errors)
        .filter(([key]) => key !== "color")
        .map(([, message]) => message),
      ...(errors.color ? [t("form.fix_fields")] : []),
    ].join(" ");
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      heading=${t("product_color.heading").replace("{name}", this.name)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        if (!this.busy && this.open) this.#emit(event, "wt-cancel", {});
        else event.stopPropagation();
      }}
    >
      <div ?inert=${this.busy} class="fields">
        <p class="scope" data-test="scope">${t("product_color.scope")}</p>
        ${colorField({
          color: this.chosen,
          noneLabel: t("editor.color_use_category"),
          inherited: this.inherited,
          busy: this.busy,
          error: errors.color ?? "",
          name: "product-color",
          errorId: "product-color-error",
          change: (color) => {
            this.chosen = color;
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
    "dashboard-product-color-form": ProductColorForm;
  }
}
