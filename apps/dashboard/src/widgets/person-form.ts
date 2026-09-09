import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { baseStyles, selectStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import type { PersonRole } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

type Field = "firstNames" | "lastNames" | "displayName" | "email";

/** Collects the identity and contact details needed to invite a new user. */
@customElement("dashboard-person-form")
export class PersonForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      wt-dialog {
        --wt-dialog-max-width: min(90vw, 44rem);
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property() error: string | null = null;

  @state() private firstNames = "";
  @state() private lastNames = "";
  @state() private displayName = "";
  @state() private email = "";
  @state() private telephone = "";
  @state() private selectedRole: PersonRole = "staff";
  @state() private fieldErrors: Partial<Record<Field, string>> = {};

  #displayNameEdited = false;
  #roleSelect = createRef<HTMLSelectElement>();

  override updated(): void {
    if (this.#roleSelect.value) this.#roleSelect.value.value = this.selectedRole;
  }

  #change(field: Field | "telephone", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    if (field === "firstNames") {
      this.firstNames = value;
      if (!this.#displayNameEdited) this.displayName = value;
    } else if (field === "lastNames") this.lastNames = value;
    else if (field === "displayName") {
      this.displayName = value;
      this.#displayNameEdited = true;
    } else if (field === "email") this.email = value;
    else this.telephone = value;
    if (field !== "telephone") this.fieldErrors = { ...this.fieldErrors, [field]: undefined };
  }

  #validate(): boolean {
    const errors: Partial<Record<Field, string>> = {};
    if (this.firstNames.trim() === "") errors.firstNames = t("form.first_names_required");
    if (this.lastNames.trim() === "") errors.lastNames = t("form.last_names_required");
    if (this.displayName.trim() === "") errors.displayName = t("form.display_name_required");
    if (this.email.trim() === "") errors.email = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      errors.email = codeMessage("person.email_invalid");
    }
    this.fieldErrors = errors;
    return Object.keys(errors).length === 0;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (!this.#validate()) return;
    this.dispatchEvent(
      new CustomEvent("create-person", {
        detail: {
          firstNames: this.firstNames.trim(),
          lastNames: this.lastNames.trim(),
          displayName: this.displayName.trim(),
          email: this.email.trim(),
          telephone: this.telephone.trim() || null,
          role: this.selectedRole,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #reset(): void {
    this.open = false;
    this.firstNames = "";
    this.lastNames = "";
    this.displayName = "";
    this.email = "";
    this.telephone = "";
    this.selectedRole = "staff";
    this.fieldErrors = {};
    this.#displayNameEdited = false;
  }

  override render() {
    const errors = Object.values(this.fieldErrors).filter(
      (message): message is string => message !== undefined,
    );
    return html`
      <wt-dialog
        heading=${t("person.new")}
        .open=${this.open}
        @wt-close=${() => this.#reset()}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${[...errors, ...(this.error ? [codeMessage(this.error)] : [])]}
        ></wt-form-error-summary>
        ${this.#input("first-names", "given-name", t("person.first_names"), this.firstNames, true)}
        ${this.#input("last-names", "family-name", t("person.last_names"), this.lastNames, true)}
        ${this.#input("display-name", "nickname", t("person.display_name"), this.displayName, true)}
        <label class="field">
          ${t("person.role")}<span class="required" aria-hidden="true">*</span>
          <select
            name="role"
            required
            ${ref(this.#roleSelect)}
            @change=${(event: Event) => {
              event.stopPropagation();
              this.selectedRole = (event.target as HTMLSelectElement).value as PersonRole;
            }}
          >
            ${ROLES.map((role) => html`<option value=${role}>${roleName(role)}</option>`)}
          </select>
        </label>
        ${this.#input("email", "email", t("person.email"), this.email, true, "email")}
        ${this.#input("telephone", "tel", t("person.telephone"), this.telephone, false, "tel")}
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            @click=${(event: Event) => {
              event.stopPropagation();
              this.open = false;
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="confirm"
            @click=${(event: Event) => this.#confirm(event)}
            >${t("action.create")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }

  #input(
    testId: string,
    name: string,
    label: string,
    value: string,
    required: boolean,
    type = "text",
  ) {
    const field = testId.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as
      Field | "telephone";
    return html`
      <wt-input
        class="field"
        data-test=${testId}
        name=${name}
        autocomplete=${name}
        type=${type}
        ?required=${required}
        label=${label}
        error=${field === "telephone" ? "" : (this.fieldErrors[field] ?? "")}
        .value=${value}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      ></wt-input>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-person-form": PersonForm;
  }
}
