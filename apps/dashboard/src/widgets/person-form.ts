import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { deriveDisplayName, isValidEmail, isValidTelephone } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  FormFeedback,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { sameValue } from "./product-editor-model.js";
import type { AccessRole, DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { accessRoleName } from "../i18n/domain.js";
import { currentLocale, fill, t } from "../i18n/t.js";

type PersonInput = Parameters<DashboardApi["createPerson"]>[0];

type Field = "firstNames" | "lastNames" | "displayName" | "email" | "telephone";
const FIELDS: readonly string[] = ["firstNames", "lastNames", "displayName", "email", "telephone"];

const CODE_FIELDS: Readonly<Record<string, Field>> = {
  "person.display_name_taken": "displayName",
  "person.email_taken": "email",
  "person.email_invalid": "email",
  "person.telephone_invalid": "telephone",
};

/** The field of the add or edit person form a refusal belongs under, or undefined for the bottom
 * message. */
export function refusedField(code: string | null, paramsField: string | null): string | undefined {
  if (code === null) return undefined;
  if (paramsField !== null && FIELDS.includes(paramsField)) return paramsField;
  return CODE_FIELDS[code];
}

@customElement("dashboard-person-form")
export class PersonForm extends LitElement {
  static override styles = [
    baseStyles,
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
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() error: string | null = null;
  /** The refused request's `params.field`, when it named one. */
  @property({ attribute: false }) errorField: string | null = null;

  @property({ attribute: false }) accessRoles: AccessRole[] = [];
  @property({ attribute: false }) viewerPermissions: string[] = [];
  @property({ type: Boolean }) viewerAdmin = false;

  @state() private firstNames = "";
  @state() private lastNames = "";
  @state() private displayName = "";
  @state() private email = "";
  @state() private telephone = "";
  @state() private selectedRoleIds: string[] = [];
  readonly #feedback = new FormFeedback(this);

  #scope?: DraftScope<PersonInput>;
  #leave?: LeaveCoordinator;
  #baseline?: PersonInput;
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

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("error")) this.#feedback.newRefusal();
    if (changed.has("open") && this.open) {
      this.#feedback.reset();
      const staff = this.#grantableRoles().find((role) => role.builtInKey === "staff");
      this.selectedRoleIds = staff ? [staff.id] : [];
    }
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.#baseline = undefined;
    } else if (this.isConnected && !this.#scope) {
      this.#baseline ??= this.#submissionValue();
      const { coordinator, scope } = draftScopeFor<PersonInput>(this, {
        id: this,
        current: () => this.#submissionValue(),
        snapshot: (value) => ({ ...value }),
        equal: sameValue,
        restore: (value) => {
          this.firstNames = value.firstNames;
          this.lastNames = value.lastNames;
          this.displayName = value.displayName;
          this.email = value.email;
          this.telephone = value.telephone ?? "";
          this.selectedRoleIds = [...value.roleIds];
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("error") && refusedField(this.error, this.errorField) !== undefined)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #refused(): Record<string, string> {
    if (!this.error) return {};
    const refused = {
      [refusedField(this.error, this.errorField) ?? "_form"]: codeMessage(this.error),
    };
    return this.#feedback.remaining(refused);
  }

  #errors(): Record<string, string> {
    return { ...this.#refused(), ...(this.#feedback.attempted ? this.#validate() : {}) };
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
    this.#scope?.changed();
    this.#feedback.dismiss(field, ...(this.displayName !== prevDisplayName ? ["displayName"] : []));
  }

  #validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (this.firstNames.trim() === "") errors.firstNames = t("form.first_names_required");
    if (this.lastNames.trim() === "") errors.lastNames = t("form.last_names_required");
    if (this.displayName.trim() === "") errors.displayName = t("form.display_name_required");
    if (this.email.trim() === "") errors.email = t("form.email_required");
    else if (!isValidEmail(this.email.trim())) {
      errors.email = codeMessage("person.email_invalid");
    }
    const tel = this.telephone.trim();
    if (tel && !isValidTelephone(tel)) errors.telephone = codeMessage("person.telephone_invalid");
    return errors;
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press("_form");
    if (Object.keys(this.#validate()).length > 0) {
      void this.#feedback.focus(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent("create-person", {
        detail: this.#submissionValue(),
        bubbles: true,
        composed: true,
      }),
    );
  }

  #submissionValue(): PersonInput {
    return {
      firstNames: this.firstNames.trim(),
      lastNames: this.lastNames.trim(),
      displayName: this.displayName.trim(),
      email: this.email.trim(),
      telephone: this.telephone.trim() || null,
      roleIds: [...new Set(this.selectedRoleIds)].sort(),
    };
  }

  commitSaved(submitted: PersonInput): void {
    this.#baseline = { ...submitted };
    this.#scope?.commit(submitted);
  }

  closeSaved(submitted: PersonInput): boolean {
    this.commitSaved(submitted);
    if (this.#scope?.isDirty()) return false;
    this.#reset();
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
    return true;
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.open) return;
    if (this.#leave) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.#reportClose();
  }

  #reportClose(): void {
    if (!this.open) return;
    this.#reset();
    this.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  }

  #reset(): void {
    this.open = false;
    this.#baseline = undefined;
    this.firstNames = "";
    this.lastNames = "";
    this.displayName = "";
    this.email = "";
    this.telephone = "";
    this.selectedRoleIds = [];
    this.#feedback.reset();
  }

  #grantableRoles(): AccessRole[] {
    return this.accessRoles.filter(
      (role) =>
        this.viewerAdmin ||
        (role.builtInKey !== "admin" &&
          role.permissions.every((permission) => this.viewerPermissions.includes(permission))),
    );
  }

  override render() {
    const errors = this.#errors();
    const s = saveActionState(this.#scope);
    const fieldKeys = new Set(FIELDS.filter((key) => Boolean(errors[key])));
    const bottom = this.#feedback.message(errors, fieldKeys, t("form.fix_fields"));
    return html`
      <wt-modal
        size="standard"
        heading=${t("person.new")}
        .open=${this.open}
        .dismissible=${!this.busy}
        .beforeClose=${this.#leave ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.#reportClose();
        }}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
      >
        ${this.#input("first-names", "given-name", t("person.first_names"), this.firstNames, true, errors)}
        ${this.#input("last-names", "family-name", t("person.last_names"), this.lastNames, true, errors)}
        ${this.#input("display-name", "nickname", t("person.display_name"), this.displayName, true, errors)}
        ${this.#input("email", "email", t("person.email"), this.email, true, errors, "email")}
        ${this.#input("telephone", "tel", t("person.telephone"), this.telephone, false, errors, "tel")}
        <hr />
        <wt-combobox
          class="field"
          name="role"
          label=${t("person.access_roles")}
          multiple
          placeholder=${t("person.no_access_role")}
          .countLabel=${(count: number) => fill("person.access_roles_selected", { count: String(count) })}
          ?disabled=${this.busy}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#grantableRoles()
            .map((role) => ({ value: role.id, label: accessRoleName(role) }))
            .sort((a, b) => a.label.localeCompare(b.label, currentLocale()))}
          .values=${this.selectedRoleIds}
          @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
            event.stopPropagation();
            this.selectedRoleIds = [...event.detail.values];
            this.#scope?.changed();
          }}
        ></wt-combobox>
        <wt-form-actions slot="footer" .error=${bottom}>
          <wt-button
            slot="cancel"
            data-test="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${this.#cancel}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            variant=${s.variant}
            data-test="confirm"
            ?disabled=${
              s.unchanged ||
              this.busy ||
              (this.#feedback.attempted && Object.keys(this.#validate()).length > 0)
            }
            @click=${(event: Event) => this.#confirm(event)}
            >${t("action.save")}</wt-button
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
        ?disabled=${this.busy}
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
