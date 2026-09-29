import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { deriveDisplayName, isValidTelephone } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, selectStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import type { PersonRole } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, rolesByName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

type Field = "firstNames" | "lastNames" | "displayName" | "email" | "telephone";
const FIELDS: readonly string[] = ["firstNames", "lastNames", "displayName", "email", "telephone"];

/** The one refusal shown beside a field; every other code goes in the bottom message. */
const DISPLAY_NAME_TAKEN = "person.display_name_taken";

@customElement("dashboard-person-form")
export class PersonForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      hr {
        width: 100%;
        box-sizing: border-box;
        border: 0;
        border-top: 1px solid var(--wt-color-border);
        margin: 0 0 var(--wt-space-4);
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
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  #roleSelect = createRef<HTMLSelectElement>();

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("error")) this.dismissed = new Set();
    if (changed.has("open") && this.open) {
      this.attempted = false;
      this.dismissed = new Set();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (this.#roleSelect.value) this.#roleSelect.value.value = this.selectedRole;
    if (changed.has("error") && this.error === DISPLAY_NAME_TAKEN)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  #refused(): Record<string, string> {
    if (!this.error) return {};
    const refused =
      this.error === DISPLAY_NAME_TAKEN
        ? { displayName: codeMessage(DISPLAY_NAME_TAKEN) }
        : { _form: codeMessage(this.error) };
    return Object.fromEntries(Object.entries(refused).filter(([key]) => !this.dismissed.has(key)));
  }

  #errors(): Record<string, string> {
    return { ...this.#refused(), ...(this.attempted ? this.#validate() : {}) };
  }

  #change(field: Field, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    const prevDisplayName = this.displayName;
    if (field === "firstNames" || field === "lastNames") {
      const prevFirst = this.firstNames;
      const prevLast = this.lastNames;
      if (field === "firstNames") this.firstNames = value;
      else this.lastNames = value;
      // The shared rule auto-fills only while the display name still matches the generated form,
      // so it resumes generating after the field is cleared.
      this.displayName = deriveDisplayName(
        this.displayName,
        prevFirst,
        prevLast,
        this.firstNames,
        this.lastNames,
      );
    } else if (field === "displayName") this.displayName = value;
    else if (field === "email") this.email = value;
    else this.telephone = value;
    this.#dismiss(field, ...(this.displayName !== prevDisplayName ? ["displayName"] : []));
  }

  #validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (this.firstNames.trim() === "") errors.firstNames = t("form.first_names_required");
    if (this.lastNames.trim() === "") errors.lastNames = t("form.last_names_required");
    if (this.displayName.trim() === "") errors.displayName = t("form.display_name_required");
    if (this.email.trim() === "") errors.email = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      errors.email = codeMessage("person.email_invalid");
    }
    const tel = this.telephone.trim();
    if (tel && !isValidTelephone(tel)) errors.telephone = codeMessage("person.telephone_invalid");
    return errors;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    this.attempted = true;
    this.#dismiss("_form");
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
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
    this.attempted = false;
    this.dismissed = new Set();
  }

  override render() {
    const errors = this.#errors();
    const fieldKeys = new Set(FIELDS.filter((key) => Boolean(errors[key])));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
    return html`
      <wt-modal
        heading=${t("person.new")}
        .open=${this.open}
        @wt-close=${() => this.#reset()}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
      >
        ${this.#input("first-names", "given-name", t("person.first_names"), this.firstNames, true, errors)}
        ${this.#input("last-names", "family-name", t("person.last_names"), this.lastNames, true, errors)}
        ${this.#input("display-name", "nickname", t("person.display_name"), this.displayName, true, errors)}
        ${this.#input("email", "email", t("person.email"), this.email, true, errors, "email")}
        ${this.#input("telephone", "tel", t("person.telephone"), this.telephone, false, errors, "tel")}
        <hr />
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
            ${rolesByName().map((role) => html`<option value=${role}>${roleName(role)}</option>`)}
          </select>
        </label>
        <wt-form-actions slot="footer" .error=${bottom}>
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#reset();
              this.open = false;
              this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="confirm"
            ?disabled=${fieldKeys.size > 0}
            @click=${(event: Event) => this.#confirm(event)}
            >${t("action.create")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }

  #input(
    testId: string,
    name: string,
    label: string,
    value: string,
    required: boolean,
    errors: Record<string, string>,
    type = "text",
  ) {
    const field = testId.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as Field;
    return html`
      <wt-input
        class="field"
        data-test=${testId}
        name=${name}
        autocomplete=${name}
        type=${type}
        ?required=${required}
        label=${label}
        error=${errors[field] ?? ""}
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
