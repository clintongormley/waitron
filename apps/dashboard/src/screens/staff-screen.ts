import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { fill, t } from "../i18n/t.js";
import { roleName, rolesByName, statusName } from "../i18n/domain.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "../widgets/staff-list.js";
import "../widgets/person-form.js";
import "../widgets/person-edit.js";
import type { DashboardApi, PersonEditDetails, PersonRole, PersonSummary } from "../api/client.js";

@customElement("dashboard-staff-screen")
export class StaffScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .status {
        color: var(--wt-color-text);
        margin-top: var(--wt-space-3);
      }
      .download-error {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .download-error p {
        margin: 0;
      }
      .filters {
        display: grid;
        grid-template-columns: minmax(calc(var(--wt-space-6) * 7), 1fr) repeat(
            2,
            minmax(calc(var(--wt-space-6) * 5), auto)
          );
        gap: var(--wt-space-3);
        align-items: start;
        margin-bottom: var(--wt-space-4);
      }
      @media (max-width: 42rem) {
        .filters {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );
  @property({ attribute: false }) currentPersonId: string | null = null;
  @property({ type: Boolean }) canAdminister = false;
  @property({ type: Boolean }) canExportPersonalData = false;
  @state() private people: PersonSummary[] = [];
  @state() private formOpen = false;
  @state() private editingPerson: PersonSummary | null = null;
  @state() private editOpen = false;
  @state() private errorKey: string | null = null;
  /** The refusal's `params.field`, read by the add and edit forms beside `errorKey`. */
  @state() private errorField: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  @state() private invitationStatus: "sent" | "not_sent" | null = null;
  @state() private search = "";
  @state() private roleFilter: PersonRole | "all" = "all";
  @state() private statusFilter: "current" | "pending" | "active" | "suspended" | "all" = "current";

  @state() private rowAction: {
    person: PersonSummary;
    action: "reset-login" | "reset-pin" | "disable" | "reactivate" | "resend-invitation";
  } | null = null;
  @state() private rowBusy = false;

  @state() private downloadingPerson: PersonSummary | null = null;
  /** Kept apart from `errorKey`, which the edit and create dialogs' feet read. */
  @state() private downloadFailure: { code: string; name: string } | null = null;
  #download = 0;

  async #onDownloadPersonData(event: CustomEvent<{ personId: string }>): Promise<void> {
    event.stopPropagation();
    if (this.downloadingPerson !== null || !this.canExportPersonalData) return;
    const person = this.people.find((person) => person.personId === event.detail.personId);
    if (person === undefined) return;
    const download = ++this.#download;
    this.downloadingPerson = person;
    this.downloadFailure = null;
    try {
      const file = await this.api.downloadPersonalData(person.personId);
      if (this.#download !== download) return;
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName ?? "personal-data.zip";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (this.#download !== download) return;
      const code = codeOf(error);
      this.downloadFailure = { code, name: person.displayName };
      if (code === "person.not_found") await this.#load();
    } finally {
      if (this.#download === download) this.downloadingPerson = null;
    }
  }

  #renderDownloadLines() {
    if (this.downloadingPerson !== null)
      return html`<p class="status" role="status" data-test="download-data-status">
        ${fill("staff.data_copy_busy", { name: this.downloadingPerson.displayName })}
      </p>`;
    const failure = this.downloadFailure;
    if (failure === null) return nothing;
    const text =
      failure.code === "authorization.not_permitted"
        ? fill("staff.data_copy_not_permitted", { name: failure.name })
        : failure.code === "person.not_found"
          ? fill("staff.data_copy_not_found", { name: failure.name })
          : codeMessage(failure.code);
    return html`<div class="error download-error" role="alert" data-test="download-data-error">
      <p data-test="download-data-error-text">${text}</p>
      ${
        failure.code === "authorization.not_permitted"
          ? html`<wt-button
              data-test="admin-sign-in"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("admin-sign-in", { bubbles: true, composed: true }),
                )}
              >${t("staff.sign_in_as_admin")}</wt-button
            >`
          : nothing
      }
    </div>`;
  }

  #onRowAction(event: CustomEvent<{ personId: string; action: string }>): void {
    event.stopPropagation();
    if (this.rowBusy || !this.canAdminister) return;
    const person = this.people.find((person) => person.personId === event.detail.personId);
    const action = event.detail.action;
    if (
      !person ||
      !["reset-login", "reset-pin", "disable", "reactivate", "resend-invitation"].includes(action)
    )
      return;
    if (action === "disable" && person.personId === this.currentPersonId) return;
    this.#closeEdit();
    this.formOpen = false;
    this.#showError(null);
    this.invitationStatus = null;
    this.rowAction = { person, action: action as NonNullable<typeof this.rowAction>["action"] };
  }

  async #confirmRowAction(): Promise<void> {
    if (this.rowAction === null || this.rowBusy || !this.canAdminister) return;
    const { person, action } = this.rowAction;
    if (action === "disable" && person.personId === this.currentPersonId) return;
    this.rowBusy = true;
    this.#showError(null);
    try {
      const result = await (action === "reset-login"
        ? this.api.resetLogin(person.personId)
        : action === "reset-pin"
          ? this.api.resetPin(person.personId)
          : action === "disable"
            ? this.api.deactivatePerson(person.personId)
            : action === "reactivate"
              ? this.api.reactivatePerson(person.personId)
              : this.api.resendInvitation(person.personId));
      if (result) this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      this.rowAction = null;
      await this.#load();
    } catch (error) {
      this.#fail(error);
    } finally {
      this.rowBusy = false;
    }
  }

  // Not @state, since nothing renders off it. Set synchronously on entry, so a double-clicked Crear
  // files at most one person.
  #creating = false;

  #editing = false;

  #filtered?: { inputs: readonly unknown[]; people: PersonSummary[] };

  /** The same array while the roster and filters are unchanged, so a typed search does not make
   * the table fold every row again. */
  #filteredPeople(): PersonSummary[] {
    const inputs = [this.people, this.roleFilter, this.statusFilter];
    if (this.#filtered?.inputs.every((input, index) => input === inputs[index]))
      return this.#filtered.people;
    const people = this.people.filter((person) => {
      if (this.roleFilter !== "all" && person.role !== this.roleFilter) return false;
      if (this.statusFilter === "current" && person.status === "suspended") return false;
      return (
        this.statusFilter === "current" ||
        this.statusFilter === "all" ||
        person.status === this.statusFilter
      );
    });
    this.#filtered = { inputs, people };
    return people;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#showError(null);
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#download++;
    this.downloadingPerson = null;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    if (this.#readErrorShown) this.#showError(null);
    try {
      await this.#queries.watch("listStaff", [], (value) => {
        this.people = value;
      });
    } catch (error) {
      this.#showReadError(error);
    }
  }

  #showError(code: string | null, field: string | null = null, fromRead = false): void {
    this.errorKey = code;
    this.errorField = field;
    this.#readErrorShown = fromRead;
  }

  #fail(error: unknown, fromRead = false): void {
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    this.#showError(codeOf(error), typeof field === "string" ? field : null, fromRead);
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#fail(error, true);
  }

  /** The add button that opened the create form, which the closing dialog hands focus back to. */
  #addOpener: HTMLElement | null = null;

  #openForm(): void {
    if (!this.canAdminister) return;
    this.rowAction = null;
    this.#showError(null);
    this.invitationStatus = null;
    this.#closeEdit(); // the two dialogs are mutually exclusive (both are modal)
    this.formOpen = true;
  }

  /** Clears `editingPerson` too, so a closed dialog leaves no stale target for `#editWith`. */
  #closeEdit(): void {
    this.editOpen = false;
    this.editingPerson = null;
  }

  #onEditPerson(event: CustomEvent<{ personId: string }>): void {
    event.stopPropagation();
    const person = this.people.find((p) => p.personId === event.detail.personId);
    if (person === undefined) return;
    this.rowAction = null;
    this.#showError(null);
    this.invitationStatus = null;
    this.formOpen = false;
    this.editingPerson = person;
    this.editOpen = true;
  }

  async #runEditAction(id: string, action: () => Promise<void>): Promise<void> {
    if (this.#editing) return;
    this.#editing = true;
    this.requestUpdate();
    this.#showError(null);
    try {
      await action();
      await this.#load();
      if (this.editingPerson) {
        const id = this.editingPerson.personId;
        this.editingPerson = this.people.find((p) => p.personId === id) ?? this.editingPerson;
      }
    } catch (error) {
      if (this.editingPerson?.personId === id) this.#fail(error);
    } finally {
      this.#editing = false;
      this.requestUpdate();
    }
  }

  #onSavePerson(event: CustomEvent<PersonEditDetails>): void {
    event.stopPropagation();
    this.#editWith(async (id) => {
      await this.api.savePerson(id, event.detail);
      if (this.editingPerson?.personId === id)
        this.shadowRoot!.querySelector("dashboard-person-edit")!.closeSaved(event.detail);
    });
  }

  async #onResendInvitation(event: Event): Promise<void> {
    event.stopPropagation();
    const personId = this.editingPerson?.personId;
    if (personId === undefined || this.#editing) return;
    this.#editing = true;
    this.requestUpdate();
    this.#showError(null);
    this.invitationStatus = null;
    try {
      const result = await this.api.resendInvitation(personId);
      if (this.editingPerson?.personId !== personId) return;
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      this.shadowRoot!.querySelector("dashboard-person-edit")!.closeIfUnchanged();
    } catch (error) {
      if (this.editingPerson?.personId === personId) this.#fail(error);
    } finally {
      this.#editing = false;
      this.requestUpdate();
    }
  }

  #editWith(action: (id: string) => Promise<void>): void {
    const id = this.editingPerson?.personId;
    if (id === undefined) return;
    void this.#runEditAction(id, () => action(id));
  }

  async #onCreatePerson(
    event: CustomEvent<{
      displayName: string;
      firstNames: string;
      lastNames: string;
      telephone: string | null;
      role: PersonRole;
      email: string;
    }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.#creating) return;
    this.#creating = true;
    this.requestUpdate();
    this.#showError(null);
    try {
      const result = await this.api.createPerson(event.detail);
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      const closed = this.shadowRoot!.querySelector("dashboard-person-form")!.closeSaved(
        event.detail,
      );
      const opener = this.#addOpener;
      if (closed) this.formOpen = false;
      await this.#load();
      await this.updateComplete;
      // The empty table's add button is gone once the person it made is listed.
      if (closed && opener?.isConnected === false)
        this.renderRoot.querySelector<HTMLElement>(".header [data-test=add]")?.focus();
    } catch (error) {
      const code = codeOf(error);
      const email = event.detail.email.trim().toLocaleLowerCase();
      const inactive =
        code === "person.email_taken"
          ? this.people.find(
              (person) =>
                person.status === "suspended" && person.email?.toLocaleLowerCase() === email,
            )
          : undefined;
      if (inactive) {
        this.formOpen = false;
        this.editingPerson = inactive;
        this.editOpen = true;
      } else {
        this.#fail(error);
      }
    } finally {
      this.#creating = false;
      this.requestUpdate();
    }
  }

  #renderAdd(slot?: "empty-action") {
    if (!this.canAdminister) return nothing;
    return html`<wt-button
      variant="primary"
      data-test="add"
      slot=${ifDefined(slot)}
      @click=${(event: Event) => {
        this.#addOpener = event.currentTarget as HTMLElement;
        this.#openForm();
      }}
      >${t("staff.add_user")}</wt-button
    >`;
  }

  override render() {
    return html`
      <div class="header">
        <h1 class="title">${t("staff.title")}</h1>
        <div class="actions">${this.#renderAdd()}</div>
      </div>
      <div class="filters" aria-label=${t("staff.filters")}>
        <wt-input
          data-test="search"
          name="search"
          type="search"
          autocomplete="off"
          label=${t("staff.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            (this.search = event.detail.value)}
        ></wt-input>
        <wt-combobox
          data-test="role-filter"
          name="role-filter"
          label=${t("staff.filter_role")}
          search="auto"
          .options=${[
            { value: "all", label: t("staff.filter_all_roles") },
            ...rolesByName().map((role) => ({ value: role, label: roleName(role) })),
          ]}
          .value=${this.roleFilter}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            (this.roleFilter = event.detail.value as PersonRole | "all")}
        ></wt-combobox>
        <wt-combobox
          data-test="status-filter"
          name="status-filter"
          label=${t("staff.filter_status")}
          search="auto"
          .options=${[
            { value: "current", label: t("staff.filter_current") },
            { value: "active", label: statusName("active") },
            { value: "pending", label: statusName("pending") },
            { value: "suspended", label: statusName("suspended") },
            { value: "all", label: t("staff.filter_all_statuses") },
          ]}
          .value=${this.statusFilter}
          @wt-change=${(event: CustomEvent<{ value: string }>) =>
            (this.statusFilter = event.detail.value as typeof this.statusFilter)}
        >
          <wt-help-tooltip
            slot="help"
            mode="help-mode"
            data-test="status-filter-help"
            aria-label=${t("staff.filter_current_help_label")}
            >${t("staff.filter_current_help")}</wt-help-tooltip
          >
        </wt-combobox>
      </div>
      <dashboard-staff-list
        .people=${this.#filteredPeople()}
        .searchTerm=${this.search}
        .emptyMessage=${this.people.length === 0 ? t("staff.empty") : tableNoMatches()}
        .currentPersonId=${this.currentPersonId}
        .canAdminister=${this.canAdminister}
        .canExportPersonalData=${this.canExportPersonalData}
        .downloadingPersonId=${this.downloadingPerson?.personId ?? null}
        @download-person-data=${(event: CustomEvent<{ personId: string }>) =>
          void this.#onDownloadPersonData(event)}
        @person-action=${(event: CustomEvent<{ personId: string; action: string }>) => this.#onRowAction(event)}
        @edit-person=${(e: CustomEvent<{ personId: string }>) => this.#onEditPerson(e)}
        >${this.people.length === 0 ? this.#renderAdd("empty-action") : nothing}</dashboard-staff-list
      >
      ${
        this.errorKey && !this.editOpen && !this.formOpen && this.rowAction === null
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${this.#renderDownloadLines()}
      ${
        this.invitationStatus
          ? html`<p class="status" role="status" data-test="invitation-status">
              ${t(`staff.invitation_${this.invitationStatus}`)}
            </p>`
          : nothing
      }
      <wt-dialog
        heading=${this.rowAction?.person.displayName ?? ""}
        .open=${this.rowAction !== null}
        @wt-close=${() => {
          this.rowAction = null;
        }}
      >
        ${
          this.rowAction
            ? html`<p>
                ${t(
                  this.rowAction.action === "reset-login"
                    ? "person.confirm_reset_login"
                    : this.rowAction.action === "reset-pin"
                      ? "person.confirm_reset_pin"
                      : this.rowAction.action === "disable"
                        ? "person.confirm_disable"
                        : this.rowAction.action === "reactivate"
                          ? "person.confirm_enable"
                          : "person.resend_invitation",
                )}
              </p>`
            : nothing
        }
        <wt-form-actions
          slot="footer"
          .error=${this.rowAction && this.errorKey ? codeMessage(this.errorKey) : ""}
        >
          <wt-button
            slot="cancel"
            ?disabled=${this.rowBusy}
            @click=${() => {
              this.rowAction = null;
            }}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-test="confirm-row-action"
            variant="primary"
            .loading=${this.rowBusy}
            @click=${() => void this.#confirmRowAction()}
            >${t("action.continue")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
      <dashboard-person-form
        .busy=${this.#creating}
        .open=${this.formOpen}
        .error=${this.formOpen ? this.errorKey : null}
        .errorField=${this.errorField}
        @create-person=${(
          e: CustomEvent<{
            displayName: string;
            firstNames: string;
            lastNames: string;
            telephone: string | null;
            role: PersonRole;
            email: string;
          }>,
        ) => void this.#onCreatePerson(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-person-form>
      <dashboard-person-edit
        .busy=${this.#editing}
        .person=${this.editingPerson}
        .currentPersonId=${this.currentPersonId}
        .canAdminister=${this.canAdminister}
        .open=${this.editOpen}
        .error=${this.editOpen ? this.errorKey : null}
        .errorField=${this.errorField}
        @save-person=${(e: CustomEvent<PersonEditDetails>) => this.#onSavePerson(e)}
        @resend-invitation=${(e: Event) => void this.#onResendInvitation(e)}
        @wt-close=${() => this.#closeEdit()}
      ></dashboard-person-edit>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-screen": StaffScreen;
  }
}
