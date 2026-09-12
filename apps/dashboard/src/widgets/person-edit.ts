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

/** Edits account details, role and status. Credential resets and deactivate/reactivate live on the
 * row's own kebab menu (dashboard-staff-list.ts) — not duplicated here — since the confirmation
 * flow for those is already there. Resending a pending invitation stays as its own form action:
 * it isn't destructive enough to need a confirmation step either way. */
@customElement("dashboard-person-edit")
export class PersonEdit extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      /* Same field-list shape as the profile screen's "Your details" edit form: one grid gap for
         every field's spacing, rather than each field carrying its own margin. */
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      /* Matches wt-input's own label styling (packages/ui/src/components/wt-input.ts) — role and
         status are the only two fields here that aren't wt-input, so without this their label text
         read larger and darker than every field above them (default body text, not the small muted
         voice wt-input uses). */
      .field-label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      /* selectStyles (base-styles.ts) is the shared native-select look; this is the documented
         local extension point, matching wt-input's own height so a role/status select doesn't
         read shorter than the text fields above it. */
      select {
        min-height: var(--wt-tap-min);
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

  #statusOptions(person: PersonSummary): PersonSummary["status"][] {
    return person.status === "suspended" ? ["suspended"] : [person.status, "suspended"];
  }

  #input(testId: string, name: string, label: string, field: EditableField | "telephone") {
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
                <div class="fields">
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
                  <label>
                    <span class="field-label"
                      >${t("person.role")}<span class="required" aria-hidden="true">*</span></span
                    >
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
                  <label>
                    <span class="field-label"
                      >${t("person.status_label")}<span class="required" aria-hidden="true"
                        >*</span
                      ></span
                    >
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
