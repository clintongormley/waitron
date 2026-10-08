import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { t } from "../i18n/t.js";

/** The colour chooser for a category, or for All products' venue default. Choosing is the answer: there is no Save. */
@customElement("dashboard-category-color-form")
export class CategoryColorForm extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      .field-error {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-danger);
        text-align: start;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() heading = "";
  @property({ attribute: false }) color: string | null = null;
  /** Refusals keyed `color`, or any other key for one shown at the end of the body. */
  @property({ attribute: false }) errors: Record<string, string> = {};
  /** What the person last chose, shown while it saves and after a refusal. */
  @state() private chosen: string | null = null;
  /** Refusal keys the person has since chosen past. */
  @state() private dismissed = new Set<string>();

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("open") && this.open) this.chosen = this.color;
    if (changes.has("errors") || (changes.has("open") && this.open)) this.dismissed = new Set();
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("errors") && this.errors.color) void focusFirstInvalid(this.shadowRoot!);
  }
  #emit(type: "wt-choose" | "wt-cancel", detail: { color: string | null } | object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
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
      size="compact"
      .open=${this.open}
      heading=${this.heading}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy && this.open) this.#emit("wt-cancel", {});
      }}
    >
      <div ?inert=${this.busy} class="fields">
        ${colorField({
          color: this.chosen,
          busy: this.busy,
          error: errors.color ?? "",
          name: "category-color",
          errorId: "category-color-error",
          customEvent: "change",
          change: (color) => {
            if (this.busy) return;
            this.chosen = color;
            this.dismissed = new Set(Object.keys(this.errors));
            this.#emit("wt-choose", { color });
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
            event.stopPropagation();
            if (!this.busy) this.#emit("wt-cancel", {});
          }}
          >${t("action.cancel")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-color-form": CategoryColorForm;
  }
}
