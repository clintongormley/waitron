import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { deriveDisplayName, isValidTelephone } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  FormFeedback,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type {
  DashboardApi,
  JobRole,
  PersonEditDetails,
  AccessRole,
  PersonSummary,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { accessRoleName, statusName } from "../i18n/domain.js";
import { fill, t } from "../i18n/t.js";
import { refusedField } from "./person-form.js";
import { sameValue } from "./product-editor-model.js";

type EditableField = "displayName" | "firstNames" | "lastNames" | "email";
const FIELDS: readonly string[] = ["firstNames", "lastNames", "displayName", "email", "telephone"];

@customElement("dashboard-person-edit")
export class PersonEdit extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .access-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      [data-access-role] {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
      }
      .job-roles {
        padding-top: var(--wt-space-4);
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
  @property({ type: Boolean }) canAdminister = false;
  @property({ attribute: false }) viewerPermissions: string[] = [];
  @property({ type: Boolean }) viewerAdmin = false;
  @property({ type: Boolean }) canChangeEmail = false;
  @property({ type: Boolean }) canManageSchedule = false;
  @property({ attribute: false }) api?: DashboardApi;
  @state() private jobRoles: JobRole[] = [];
  @state() private jobRoleIds: string[] = [];
  @state() private jobRolesLoaded = false;
  @state() private jobRolesBusy = false;
  @state() private jobRolesError: string | null = null;
  #expectedJobRoleIds: string[] = [];
  #jobScope?: DraftScope<string[]>;
  readonly #jobScopeId = {};
  #jobRead = 0;
  @state() private accessRoles: AccessRole[] = [];
  @state() private accessRoleIds: string[] = [];
  @state() private accessRolesLoaded = false;
  @state() private accessRolesBusy = false;
  @state() private accessRolesError: string | null = null;
  #expectedAccessRoleIds: string[] = [];
  #accessScope?: DraftScope<string[]>;
  readonly #accessScopeId = {};
  #accessRead = 0;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: Boolean }) busy = false;
  @property() error: string | null = null;
  /** The refused request's `params.field`, when it named one. */
  @property({ attribute: false }) errorField: string | null = null;

  @state() private details: PersonEditDetails = {
    displayName: "",
    firstNames: "",
    lastNames: "",
    telephone: null,
    email: "",
    status: "pending",
  };
  readonly #feedback = new FormFeedback(this);
  #personId: string | null = null;
  #scope?: DraftScope<PersonEditDetails>;
  #leave?: LeaveCoordinator;
  #baseline?: PersonEditDetails;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    !this.jobRolesBusy &&
    !this.accessRolesBusy &&
    (await this.#leave!.request({
      scopes: [this, this.#jobScopeId, this.#accessScopeId],
      reason,
      proceed() {},
    })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#disposeJobRoles();
    this.#disposeAccessRoles();
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const personChanged = changed.has("person") && this.person?.personId !== this.#personId;
    if (personChanged) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#loadPerson();
    }
    if (!this.open || !this.person || !this.canManageSchedule) this.#disposeJobRoles();
    else if (
      this.api &&
      (personChanged ||
        changed.has("open") ||
        changed.has("api") ||
        changed.has("canManageSchedule"))
    )
      void this.#loadJobRoles();
    if (!this.open || !this.person || !this.canAdminister) this.#disposeAccessRoles();
    else if (
      this.api &&
      (personChanged || changed.has("open") || changed.has("api") || changed.has("canAdminister"))
    )
      void this.#loadAccessRoles();
    if (changed.has("error")) this.#feedback.newRefusal();
    if (changed.has("open") && this.open) {
      this.#feedback.reset();
    }
    if (!this.open || !this.person) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
      this.#baseline = undefined;
    } else if (this.isConnected && !this.#scope) {
      this.#baseline ??= this.#submissionValue();
      const { coordinator, scope } = draftScopeFor<PersonEditDetails>(this, {
        id: this,
        current: () => this.#submissionValue(),
        snapshot: (value) => ({ ...value }),
        equal: sameValue,
        restore: (value) => {
          this.details = { ...value };
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

  #loadPerson(): void {
    const person = this.person;
    this.#personId = person?.personId ?? null;
    this.#baseline = undefined;
    this.details = {
      displayName: person?.displayName ?? "",
      firstNames: person?.firstNames ?? "",
      lastNames: person?.lastNames ?? "",
      telephone: person?.telephone ?? null,
      email: person?.email ?? "",
      status: person?.status ?? "pending",
    };
    this.#feedback.reset();
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
    this.#feedback.dismiss(
      field,
      ...(this.details.displayName !== prevDisplayName ? ["displayName"] : []),
    );
    this.#scope?.changed();
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
    if (this.busy || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press("_form");
    if (Object.keys(this.#validate()).length > 0) {
      void this.#feedback.focus(this.shadowRoot!);
      return;
    }
    this.#emit("save-person", { ...this.#submissionValue() });
  }

  #submissionValue(): PersonEditDetails {
    return {
      displayName: this.details.displayName.trim(),
      firstNames: this.details.firstNames.trim(),
      lastNames: this.details.lastNames.trim(),
      telephone: this.details.telephone?.trim() || null,
      email: this.details.email.trim(),
      status: this.details.status,
    };
  }

  closeSaved(submitted: PersonEditDetails): boolean {
    this.#baseline = { ...submitted };
    this.#scope?.commit(submitted);
    return this.closeIfUnchanged();
  }

  closeIfUnchanged(): boolean {
    if (this.#scope?.isDirty() || this.#jobScope?.isDirty() || this.#accessScope?.isDirty())
      return false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
    this.#reportClose();
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
    this.open = false;
    this.#loadPerson();
    this.#emit("wt-close");
  }

  #emit(type: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #disposeJobRoles(): void {
    this.#jobRead++;
    this.#jobScope?.dispose();
    this.#jobScope = undefined;
    this.jobRolesLoaded = false;
  }

  async #loadJobRoles(): Promise<void> {
    const read = ++this.#jobRead;
    this.jobRolesLoaded = false;
    this.jobRolesError = null;
    try {
      const roles = await this.api!.listJobRoles();
      if (read !== this.#jobRead) return;
      this.jobRoles = roles;
      this.jobRoleIds = roles
        .filter((r) => r.holderIds.includes(this.person!.personId))
        .map((r) => r.id)
        .sort();
      this.#expectedJobRoleIds = [...this.jobRoleIds];
      this.#jobScope?.dispose();
      const { scope } = draftScopeFor<string[]>(this, {
        id: this.#jobScopeId,
        current: () => this.jobRoleIds,
        snapshot: (value) => [...value],
        equal: (a, b) => sameValue([...a].sort(), [...b].sort()),
        restore: (value) => {
          this.jobRoleIds = [...value];
        },
      });
      this.#jobScope = scope;
      scope.commit(this.jobRoleIds);
      this.jobRolesLoaded = true;
    } catch (error) {
      if (read === this.#jobRead) this.jobRolesError = codeOf(error);
    }
  }

  async #saveJobRoles(event: Event): Promise<void> {
    event.stopPropagation();
    if (
      !this.jobRolesLoaded ||
      this.jobRolesBusy ||
      this.busy ||
      saveActionState(this.#jobScope).unchanged
    )
      return;
    const submitted = [...this.jobRoleIds];
    this.jobRolesBusy = true;
    this.jobRolesError = null;
    try {
      const { staffRoleIds } = await this.api!.setPersonJobRoles(
        this.person!.personId,
        submitted,
        this.#expectedJobRoleIds,
      );
      this.#expectedJobRoleIds = [...staffRoleIds];
      this.jobRoleIds = [...staffRoleIds];
      this.#jobScope?.commit(staffRoleIds);
    } catch (error) {
      this.jobRolesError = codeOf(error);
    } finally {
      this.jobRolesBusy = false;
    }
  }

  #jobRolesEditor() {
    if (!this.canManageSchedule) return nothing;
    const save = saveActionState(this.#jobScope);
    return html`<section
      class="fields job-roles"
      data-test="job-roles"
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save-job-roles]"))}
    >
      <wt-combobox
        multiple
        name="jobRoles"
        label=${t("person.job_roles")}
        hint=${t("person.job_roles_hint")}
        .values=${this.jobRoleIds}
        .options=${this.jobRoles.map((r) => ({ value: r.id, label: r.name }))}
        ?disabled=${!this.jobRolesLoaded || this.busy || this.jobRolesBusy}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          this.jobRoleIds = [...event.detail.values].sort();
          this.#jobScope?.changed();
        }}
      ></wt-combobox>
      <wt-form-actions
        data-test="job-role-actions"
        .error=${this.jobRolesError ? codeMessage(this.jobRolesError) : ""}
      >
        ${this.jobRolesError ? html`<wt-button slot="cancel" data-test="reload-job-roles" variant="secondary" ?disabled=${this.jobRolesBusy} @click=${() => void this.#loadJobRoles()}>${t("person.reload_job_roles")}</wt-button>` : nothing}
        <wt-button
          data-test="save-job-roles"
          variant=${save.variant}
          ?disabled=${!this.jobRolesLoaded || save.unchanged || this.busy || this.jobRolesBusy}
          @click=${(event: Event) => void this.#saveJobRoles(event)}
          >${t("person.save_job_roles")}</wt-button
        >
      </wt-form-actions>
    </section>`;
  }

  #canGrant(role: AccessRole): boolean {
    return (
      this.viewerAdmin ||
      (role.builtInKey !== "admin" &&
        role.permissions.every((permission) => this.viewerPermissions.includes(permission)))
    );
  }

  #disposeAccessRoles(): void {
    this.#accessRead++;
    this.#accessScope?.dispose();
    this.#accessScope = undefined;
    this.accessRolesLoaded = false;
  }

  async #loadAccessRoles(reload = false): Promise<void> {
    const read = ++this.#accessRead;
    this.accessRolesLoaded = false;
    this.accessRolesError = null;
    try {
      const [roles, people] = await Promise.all([
        this.api!.listAccessRoles(),
        reload ? this.api!.listStaff() : Promise.resolve(null),
      ]);
      if (read !== this.#accessRead) return;
      this.accessRoles = roles;
      this.accessRoleIds = [
        ...(people?.find((p) => p.personId === this.person!.personId)?.roleIds ??
          this.person!.roleIds),
      ].sort();
      this.#expectedAccessRoleIds = [...this.accessRoleIds];
      this.#accessScope?.dispose();
      const { scope } = draftScopeFor<string[]>(this, {
        id: this.#accessScopeId,
        current: () => this.accessRoleIds,
        snapshot: (value) => [...value],
        equal: (a, b) => sameValue([...a].sort(), [...b].sort()),
        restore: (value) => {
          this.accessRoleIds = [...value];
        },
      });
      this.#accessScope = scope;
      scope.commit(this.accessRoleIds);
      this.accessRolesLoaded = true;
    } catch (error) {
      if (read === this.#accessRead) this.accessRolesError = codeOf(error);
    }
  }

  async #saveAccessRoles(event: Event): Promise<void> {
    event.stopPropagation();
    if (
      !this.accessRolesLoaded ||
      this.accessRolesBusy ||
      this.busy ||
      saveActionState(this.#accessScope).unchanged
    )
      return;
    const submitted = [...this.accessRoleIds];
    this.accessRolesBusy = true;
    this.accessRolesError = null;
    try {
      const { roleIds } = await this.api!.setPersonAccessRoles(
        this.person!.personId,
        submitted,
        this.#expectedAccessRoleIds,
      );
      this.#expectedAccessRoleIds = [...roleIds];
      if (sameValue(this.accessRoleIds, submitted)) this.accessRoleIds = [...roleIds];
      this.#accessScope?.commit(roleIds);
      this.person = { ...this.person!, roleIds: [...roleIds] };
      this.#emit("access-roles-saved", { personId: this.person.personId, roleIds: [...roleIds] });
    } catch (error) {
      this.accessRolesError = codeOf(error);
    } finally {
      this.accessRolesBusy = false;
    }
  }

  #accessRolesEditor() {
    if (!this.canAdminister) return nothing;
    const save = saveActionState(this.#accessScope);
    return html`<section
      class="fields access-roles"
      data-test="access-roles"
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save-access-roles]"))}
    >
      <div class="access-tags">
        ${
          this.accessRoleIds.length
            ? this.accessRoleIds.map((id) => {
                const role = this.accessRoles.find((r) => r.id === id);
                return html`<span data-access-role=${id}
                  >${role ? accessRoleName(role) : id}${
                    role && this.#canGrant(role)
                      ? html`<wt-button
                          variant="secondary"
                          aria-label=${`${t("action.remove")} ${accessRoleName(role)}`}
                          ?disabled=${this.busy || this.accessRolesBusy}
                          @click=${(event: Event) => {
                            event.stopPropagation();
                            this.accessRoleIds = this.accessRoleIds.filter((value) => value !== id);
                            this.#accessScope?.changed();
                          }}
                          >${t("action.remove")}</wt-button
                        >`
                      : nothing
                  }</span
                >`;
              })
            : html`<span>${t("person.no_access_role")}</span>`
        }
      </div>
      <wt-combobox
        multiple
        name="accessRoles"
        .countLabel=${(count: number) => fill("person.access_roles_selected", { count: String(count) })}
        label=${t("person.access_roles")}
        .values=${this.accessRoleIds.filter((id) => this.accessRoles.some((r) => r.id === id && this.#canGrant(r)))}
        .options=${this.accessRoles.filter((r) => this.#canGrant(r)).map((r) => ({ value: r.id, label: accessRoleName(r) }))}
        ?disabled=${!this.accessRolesLoaded || this.busy || this.accessRolesBusy}
        @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
          event.stopPropagation();
          const locked = this.accessRoleIds.filter(
            (id) => !this.accessRoles.some((r) => r.id === id && this.#canGrant(r)),
          );
          this.accessRoleIds = [...new Set([...locked, ...event.detail.values])].sort();
          this.#accessScope?.changed();
        }}
      ></wt-combobox>
      <wt-form-actions
        data-test="access-role-actions"
        .error=${this.accessRolesError ? codeMessage(this.accessRolesError) : ""}
      >
        ${this.accessRolesError ? html`<wt-button slot="cancel" data-test="reload-access-roles" variant="secondary" ?disabled=${this.accessRolesBusy} @click=${() => void this.#loadAccessRoles(true)}>${t("person.reload_access_roles")}</wt-button>` : nothing}
        <wt-button
          data-test="save-access-roles"
          variant=${save.variant}
          ?disabled=${!this.accessRolesLoaded || save.unchanged || this.busy || this.accessRolesBusy}
          @click=${(event: Event) => void this.#saveAccessRoles(event)}
          >${t("person.save_access_roles")}</wt-button
        >
      </wt-form-actions>
    </section>`;
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
        ?disabled=${this.busy}
        ?readonly=${field === "email" && !this.canChangeEmail && this.person?.personId !== this.currentPersonId}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      ></wt-input>
    `;
  }

  override render() {
    const person = this.person;
    const errors = this.#errors();
    const s = saveActionState(this.#scope);
    const fieldKeys = new Set(FIELDS.filter((key) => Boolean(errors[key])));
    const bottom = this.#feedback.message(errors, fieldKeys, t("form.fix_fields"));
    return html`
      <wt-modal
        size="standard"
        heading=${person ? `${t("action.edit")} ${person.displayName}` : t("person.edit")}
        .open=${this.open}
        .dismissible=${!this.busy && !this.jobRolesBusy && !this.accessRolesBusy}
        .beforeClose=${this.#leave ? this.#beforeClose : undefined}
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.#reportClose();
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
                    ?preserve-order=${true /* Preserve account lifecycle. */}
                    data-test="edit-status"
                    name="status"
                    label=${t("person.status_label")}
                    required
                    search="auto"
                    searchPlaceholder=${t("categories.combobox_search")}
                    noResultsLabel=${t("categories.combobox_no_results")}
                    ?disabled=${this.busy || !this.canAdminister || person.personId === this.currentPersonId}
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
                      this.#scope?.changed();
                    }}
                  ></wt-combobox>
                </div>
                ${this.#accessRolesEditor()} ${this.#jobRolesEditor()}
                ${
                  person.status === "pending" && this.canAdminister
                    ? html`<div class="actions">
                        <wt-button
                          data-test="resend-invitation"
                          variant="secondary"
                          ?disabled=${this.busy}
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
            ?disabled=${this.busy}
            @click=${(event: Event) => this.#cancel(event)}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="save"
            variant=${s.variant}
            ?disabled=${
              s.unchanged ||
              this.busy ||
              (this.#feedback.attempted && Object.keys(this.#validate()).length > 0)
            }
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
