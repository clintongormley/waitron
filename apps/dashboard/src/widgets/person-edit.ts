import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { deriveDisplayName, isValidTelephone } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { PersonEditDetails, PersonRole, PersonSummary } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, rolesByName, statusName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";
import { refusedField } from "./person-form.js";

type EditableField = "displayName" | "firstNames" | "lastNames" | "email";
const FIELDS: readonly string[] = ["firstNames", "lastNames", "displayName", "email", "telephone"];

@customElement("dashboard-person-edit")
export class PersonEdit extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Same field-list shape as the profile screen's "Your details" edit form: one grid gap for
         every field's spacing, rather than each field carrying its own margin. */
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-4);
        border-top: 1px solid var(--wt-color-border);
      }
    `,
  ];

  @property({ attribute: false }) person: PersonSummary | null = null;
  @property({ attribute: false }) currentPersonId: string | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() error: string | null = null;
  /** The refused request's `params.field`, when it named one. */
  @property({ attribute: false }) errorField: string | null = null;

  @state() private details: PersonEditDetails = {
    displayName: "",
    firstNames: "",
    lastNames: "",
    telephone: null,
    email: "",
    role: "staff",
    status: "pending",
  };
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  #personId: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("person") && this.person?.personId !== this.#personId) {
      this.#loadPerson();
    }
    if (changed.has("error")) this.dismissed = new Set();
    if (changed.has("open") && this.open) {
      this.attempted = false;
      this.dismissed = new Set();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("error") && refusedField(this.error, this.errorField) !== undefined)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  #refused(): Record<string, string> {
    if (!this.error) return {};
    const refused = {
      [refusedField(this.error, this.errorField) ?? "_form"]: codeMessage(this.error),
    };
    return Object.fromEntries(Object.entries(refused).filter(([key]) => !this.dismissed.has(key)));
  }

  #errors(): Record<string, string> {
    return { ...this.#refused(), ...(this.attempted ? this.#validate() : {}) };
  }

  #loadPerson(): void {
    const person = this.person;
    this.#personId = person?.personId ?? null;
    this.details = {
      displayName: person?.displayName ?? "",
      firstNames: person?.firstNames ?? "",
      lastNames: person?.lastNames ?? "",
      telephone: person?.telephone ?? null,
      email: person?.email ?? "",
      role: person?.role ?? "staff",
      status: person?.status ?? "pending",
    };
    this.attempted = false;
    this.dismissed = new Set();
  }

  #change(field: EditableField | "telephone", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    const prevDisplayName = this.details.displayName;
    if (field === "firstNames" || field === "lastNames") {
      const next = { ...this.details, [field]: value };
      // Auto-fill the display name only while it still matches the generated form, so it resumes
      // generating after the field is cleared.
      next.displayName = deriveDisplayName(
        this.details.displayName,
        this.details.firstNames,
        this.details.lastNames,
        next.firstNames,
        next.lastNames,
      );
      this.details = next;
    } else {
      this.details = { ...this.details, [field]: field === "telephone" ? value || null : value };
    }
    this.#dismiss(field, ...(this.details.displayName !== prevDisplayName ? ["displayName"] : []));
  }

  #validate(): Partial<Record<EditableField | "telephone", string>> {
    const errors: Partial<Record<EditableField | "telephone", string>> = {};
    if (this.details.firstNames.trim() === "") errors.firstNames = t("form.first_names_required");
    if (this.details.lastNames.trim() === "") errors.lastNames = t("form.last_names_required");
    if (this.details.displayName.trim() === "") {
      errors.displayName = t("form.display_name_required");
    }
    if (this.details.email.trim() === "") errors.email = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.details.email.trim())) {
      errors.email = codeMessage("person.email_invalid");
    }
    const tel = this.details.telephone?.trim() ?? "";
    if (tel && !isValidTelephone(tel)) errors.telephone = codeMessage("person.telephone_invalid");
    return errors;
  }

  #save(event: Event): void {
    event.stopPropagation();
    this.attempted = true;
    this.#dismiss("_form");
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.#emit("save-person", {
      displayName: this.details.displayName.trim(),
      firstNames: this.details.firstNames.trim(),
      lastNames: this.details.lastNames.trim(),
      telephone: this.details.telephone?.trim() || null,
      email: this.details.email.trim(),
      role: this.details.role,
      status: this.details.status,
    });
  }

  #emit(type: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #statusOptions(person: PersonSummary): PersonSummary["status"][] {
    return person.status === "suspended" ? ["suspended"] : [person.status, "suspended"];
  }

  #input(
    testId: string,
    name: string,
    label: string,
    field: EditableField | "telephone",
    errors: Record<string, string>,
  ) {
    const value = this.details[field] ?? "";
    return html`
      <wt-input
        data-test=${testId}
        name=${name}
        autocomplete=${name === "telephone" ? "tel" : name}
        ?required=${field !== "telephone"}
        type=${field === "email" ? "email" : field === "telephone" ? "tel" : "text"}
        label=${label}
        .value=${value}
        error=${errors[field] ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      ></wt-input>
    `;
  }

  override render() {
    const person = this.person;
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
        heading=${person ? `${t("action.edit")} ${person.displayName}` : t("person.edit")}
        .open=${this.open}
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        @wt-close=${() => {
          this.open = false;
          this.#loadPerson();
        }}
      >
        ${
          person
            ? html`
                <div class="fields">
                  ${this.#input(
                    "edit-first-names",
                    "given-name",
                    t("person.first_names"),
                    "firstNames",
                    errors,
                  )}
                  ${this.#input(
                    "edit-last-names",
                    "family-name",
                    t("person.last_names"),
                    "lastNames",
                    errors,
                  )}
                  ${this.#input(
                    "edit-display-name",
                    "nickname",
                    t("person.display_name"),
                    "displayName",
                    errors,
                  )}
                  ${this.#input("edit-email", "email", t("person.email"), "email", errors)}
                  ${this.#input("edit-telephone", "telephone", t("person.telephone"), "telephone", errors)}
                  <wt-combobox
                    data-test="edit-role"
                    name="role"
                    label=${t("person.role")}
                    required
                    search="auto"
                    searchPlaceholder=${t("categories.combobox_search")}
                    noResultsLabel=${t("categories.combobox_no_results")}
                    .options=${rolesByName().map((role) => ({ value: role, label: roleName(role) }))}
                    .value=${this.details.role}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.details = { ...this.details, role: event.detail.value as PersonRole };
                    }}
                  ></wt-combobox>
                  <wt-combobox
                    data-test="edit-status"
                    name="status"
                    label=${t("person.status_label")}
                    required
                    search="auto"
                    searchPlaceholder=${t("categories.combobox_search")}
                    noResultsLabel=${t("categories.combobox_no_results")}
                    ?disabled=${person.personId === this.currentPersonId}
                    .options=${this.#statusOptions(person).map((status) => ({
                      value: status,
                      label: statusName(status),
                    }))}
                    .value=${this.details.status}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      this.details = {
                        ...this.details,
                        status: event.detail.value as PersonEditDetails["status"],
                      };
                    }}
                  ></wt-combobox>
                </div>
                ${
                  person.status === "pending"
                    ? html`<div class="actions">
                        <wt-button
                          data-test="resend-invitation"
                          variant="secondary"
                          @click=${() => this.#emit("resend-invitation")}
                          >${t("person.resend_invitation")}</wt-button
                        >
                      </div>`
                    : nothing
                }
              `
            : nothing
        }
        <wt-form-actions slot="footer" .error=${person ? bottom : ""}>
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#loadPerson();
              this.open = false;
              this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="save"
            variant="primary"
            ?disabled=${this.attempted && Object.keys(this.#validate()).length > 0}
            @click=${(event: Event) => this.#save(event)}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-person-edit": PersonEdit;
  }
}
