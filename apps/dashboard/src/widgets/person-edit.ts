import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import type { PersonEditDetails, PersonRole, PersonSummary } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, statusName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];
type EditableField = "displayName" | "firstNames" | "lastNames" | "email";
type LifecycleAction = "reset-login" | "reset-pin" | "deactivate-person" | "reactivate-person";

/** Edits account details in one form and exposes credential/lifecycle resets as explicit actions. */
@customElement("dashboard-person-edit")
export class PersonEdit extends LitElement {
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
      .grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0 var(--wt-space-4);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-4);
        border-top: 1px solid var(--wt-color-border);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) person: PersonSummary | null = null;
  @property({ attribute: false }) currentPersonId: string | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() error: string | null = null;

  @state() private details: PersonEditDetails = {
    displayName: "",
    firstNames: "",
    lastNames: "",
    telephone: null,
    email: "",
    role: "staff",
    status: "pending",
  };
  @state() private fieldErrors: Partial<Record<EditableField, string>> = {};
  @state() private pendingAction: LifecycleAction | null = null;
  #personId: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("person") && this.person?.personId !== this.#personId) {
      this.#loadPerson();
    }
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
    this.fieldErrors = {};
    this.pendingAction = null;
  }

  #change(field: EditableField | "telephone", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const value = event.detail.value;
    this.details = {
      ...this.details,
      [field]: field === "telephone" ? value || null : value,
    };
    if (field !== "telephone") this.fieldErrors = { ...this.fieldErrors, [field]: undefined };
  }

  #validate(): boolean {
    const errors: Partial<Record<EditableField, string>> = {};
    if (this.details.firstNames.trim() === "") errors.firstNames = t("form.first_names_required");
    if (this.details.lastNames.trim() === "") errors.lastNames = t("form.last_names_required");
    if (this.details.displayName.trim() === "") {
      errors.displayName = t("form.display_name_required");
    }
    if (this.details.email.trim() === "") errors.email = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.details.email.trim())) {
      errors.email = codeMessage("person.email_invalid");
    }
    this.fieldErrors = errors;
    return Object.keys(errors).length === 0;
  }

  #save(event: Event): void {
    event.stopPropagation();
    if (this.pendingAction !== null) return;
    if (!this.#validate()) return;
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

  #confirmationCopy(action: LifecycleAction): string {
    return t(
      action === "reset-login"
        ? "person.confirm_reset_login"
        : action === "reset-pin"
          ? "person.confirm_reset_pin"
          : action === "deactivate-person"
            ? "person.confirm_mark_inactive"
            : "person.confirm_reactivate",
    );
  }

  #statusOptions(person: PersonSummary): PersonSummary["status"][] {
    return person.status === "suspended" ? ["suspended"] : [person.status, "suspended"];
  }

  #input(testId: string, name: string, label: string, field: EditableField | "telephone") {
    const value = this.details[field] ?? "";
    return html`
      <wt-input
        class="field"
        data-test=${testId}
        name=${name}
        autocomplete=${name === "telephone" ? "tel" : name}
        ?required=${field !== "telephone"}
        type=${field === "email" ? "email" : field === "telephone" ? "tel" : "text"}
        label=${label}
        .value=${value}
        error=${field === "telephone" ? "" : (this.fieldErrors[field] ?? "")}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      ></wt-input>
    `;
  }

  override render() {
    const person = this.person;
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
                <wt-form-error-summary
                  heading=${t("form.error_heading")}
                  .errors=${[
                    ...Object.values(this.fieldErrors).filter(
                      (message): message is string => message !== undefined,
                    ),
                    ...(this.error ? [codeMessage(this.error)] : []),
                  ]}
                ></wt-form-error-summary>
                <div class="grid">
                  ${this.#input(
                    "edit-first-names",
                    "given-name",
                    t("person.first_names"),
                    "firstNames",
                  )}
                  ${this.#input(
                    "edit-last-names",
                    "family-name",
                    t("person.last_names"),
                    "lastNames",
                  )}
                  ${this.#input(
                    "edit-display-name",
                    "nickname",
                    t("person.display_name"),
                    "displayName",
                  )}
                  ${this.#input("edit-email", "email", t("person.email"), "email")}
                  ${this.#input("edit-telephone", "telephone", t("person.telephone"), "telephone")}
                  <hr />
                  <label class="field">
                    ${t("person.role")}<span class="required" aria-hidden="true">*</span>
                    <select
                      data-test="edit-role"
                      name="role"
                      required
                      @change=${(event: Event) =>
                        (this.details = {
                          ...this.details,
                          role: (event.target as HTMLSelectElement).value as PersonRole,
                        })}
                    >
                      ${ROLES.map(
                        (role) =>
                          html`<option value=${role} .selected=${this.details.role === role}>
                            ${roleName(role)}
                          </option>`,
                      )}
                    </select>
                  </label>
                  <label class="field">
                    ${t("person.status_label")}<span class="required" aria-hidden="true">*</span>
                    <select
                      data-test="edit-status"
                      name="status"
                      required
                      ?disabled=${person.personId === this.currentPersonId}
                      @change=${(event: Event) =>
                        (this.details = {
                          ...this.details,
                          status: (event.target as HTMLSelectElement)
                            .value as PersonEditDetails["status"],
                        })}
                    >
                      ${this.#statusOptions(person).map(
                        (status) =>
                          html`<option value=${status} .selected=${this.details.status === status}>
                            ${statusName(status)}
                          </option>`,
                      )}
                    </select>
                  </label>
                </div>
                <div class="actions">
                  <wt-button
                    data-test="reset-login"
                    variant="secondary"
                    @click=${() => (this.pendingAction = "reset-login")}
                    >${t("person.reset_login")}</wt-button
                  >
                  <wt-button
                    data-test="reset-pin"
                    variant="secondary"
                    @click=${() => (this.pendingAction = "reset-pin")}
                    >${t("person.reset_pin")}</wt-button
                  >
                  ${
                    person.status === "suspended"
                      ? html`<wt-button
                          data-test="reactivate"
                          variant="secondary"
                          @click=${() => (this.pendingAction = "reactivate-person")}
                          >${t("person.reactivate_and_invite")}</wt-button
                        >`
                      : html`<wt-button
                          data-test="mark-inactive"
                          variant="secondary"
                          ?disabled=${person.personId === this.currentPersonId}
                          title=${
                            person.personId === this.currentPersonId
                              ? codeMessage("person.self_deactivation")
                              : ""
                          }
                          @click=${() => {
                            if (person.personId !== this.currentPersonId)
                              this.pendingAction = "deactivate-person";
                          }}
                          >${t("person.mark_inactive")}</wt-button
                        >`
                  }
                  ${
                    person.status === "pending"
                      ? html`<wt-button
                          data-test="resend-invitation"
                          variant="secondary"
                          @click=${() => this.#emit("resend-invitation")}
                          >${t("person.resend_invitation")}</wt-button
                        >`
                      : nothing
                  }
                </div>
                ${
                  this.pendingAction === null
                    ? nothing
                    : html`<div data-test="confirmation" role="alert">
                        <p>${this.#confirmationCopy(this.pendingAction)}</p>
                        <div class="actions">
                          <wt-button
                            data-test="cancel-action"
                            variant="secondary"
                            @click=${() => (this.pendingAction = null)}
                            >${t("action.cancel")}</wt-button
                          >
                          <wt-button
                            data-test="confirm-action"
                            variant="danger"
                            @click=${() => {
                              const action = this.pendingAction;
                              this.pendingAction = null;
                              if (action !== null) this.#emit(action);
                            }}
                            >${t("action.continue")}</wt-button
                          >
                        </div>
                      </div>`
                }
              `
            : nothing
        }
        <wt-form-actions slot="footer">
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
            ?disabled=${this.pendingAction !== null}
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
