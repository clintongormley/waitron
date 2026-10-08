import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { deriveDisplayName, isValidTelephone } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
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
import type { DashboardApi, PersonRole } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, rolesByName } from "../i18n/domain.js";
import { t } from "../i18n/t.js";

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

  @state() private firstNames = "";
  @state() private lastNames = "";
  @state() private displayName = "";
  @state() private email = "";
  @state() private telephone = "";
  @state() private selectedRole: PersonRole = "staff";
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  #scope?: DraftScope<PersonInput>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("error")) this.dismissed = new Set();
    if (changed.has("open") && this.open) {
      this.attempted = false;
      this.dismissed = new Set();
    }
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (!this.#scope) {
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
          this.selectedRole = value.role;
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
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
    if (this.busy || saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.#dismiss("_form");
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
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
      role: this.selectedRole,
    };
  }

  commitSaved(submitted: PersonInput): void {
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
    const s = saveActionState(this.#scope);
    const fieldKeys = new Set(FIELDS.filter((key) => Boolean(errors[key])));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
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
          label=${t("person.role")}
          required
          ?disabled=${this.busy}
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${rolesByName().map((role) => ({ value: role, label: roleName(role) }))}
          .value=${this.selectedRole}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.selectedRole = event.detail.value as PersonRole;
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
              (this.attempted && Object.keys(this.#validate()).length > 0)
            }
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
