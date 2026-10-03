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
import { t } from "../i18n/t.js";
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

  #onRowAction(event: CustomEvent<{ personId: string; action: string }>): void {
    event.stopPropagation();
    if (this.rowBusy) return;
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
    if (this.rowAction === null || this.rowBusy) return;
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

  #filteredPeople(): PersonSummary[] {
    const query = this.search.trim().toLocaleLowerCase();
    return this.people.filter((person) => {
      if (this.roleFilter !== "all" && person.role !== this.roleFilter) return false;
      if (this.statusFilter === "current" && person.status === "suspended") return false;
      if (
        this.statusFilter !== "current" &&
        this.statusFilter !== "all" &&
        person.status !== this.statusFilter
      ) {
        return false;
      }
      if (query === "") return true;
      return [
        person.displayName,
        person.firstNames,
        person.lastNames,
        person.email,
        person.telephone,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#showError(null);
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

  /** Re-reads `editingPerson` from the reloaded list, so a still-open dialog shows the new state. */
  async #runEditAction(action: () => Promise<void>): Promise<void> {
    if (this.#editing) return;
    this.#editing = true;
    this.#showError(null);
    try {
      await action();
      await this.#load();
      if (this.editingPerson) {
        const id = this.editingPerson.personId;
        this.editingPerson = this.people.find((p) => p.personId === id) ?? this.editingPerson;
      }
    } catch (error) {
      this.#fail(error);
    } finally {
      this.#editing = false;
    }
  }

  #onSavePerson(event: CustomEvent<PersonEditDetails>): void {
    event.stopPropagation();
    this.#editWith(async (id) => {
      await this.api.savePerson(id, event.detail);
      this.#closeEdit();
    });
  }

  async #onResendInvitation(event: Event): Promise<void> {
    event.stopPropagation();
    const personId = this.editingPerson?.personId;
    if (personId === undefined || this.#editing) return;
    this.#editing = true;
    this.#showError(null);
    this.invitationStatus = null;
    try {
      const result = await this.api.resendInvitation(personId);
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      this.#closeEdit();
    } catch (error) {
      this.#fail(error);
    } finally {
      this.#editing = false;
    }
  }

  #editWith(action: (id: string) => Promise<void>): void {
    const id = this.editingPerson?.personId;
    if (id === undefined) return;
    void this.#runEditAction(() => action(id));
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
    this.#showError(null);
    try {
      const result = await this.api.createPerson(event.detail);
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      const opener = this.#addOpener;
      this.formOpen = false;
      await this.#load();
      await this.updateComplete;
      // The empty table's add button is gone once the person it made is listed.
      if (opener?.isConnected === false)
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
    }
  }

  #renderAdd(slot?: "empty-action") {
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
            data-test="status-filter-help"
            aria-label=${t("staff.filter_current_help_label")}
            >${t("staff.filter_current_help")}</wt-help-tooltip
          >
        </wt-combobox>
      </div>
      <dashboard-staff-list
        .people=${this.#filteredPeople()}
        .emptyMessage=${this.people.length === 0 ? t("staff.empty") : tableNoMatches()}
        .currentPersonId=${this.currentPersonId}
        @person-action=${(event: CustomEvent<{ personId: string; action: string }>) => this.#onRowAction(event)}
        @edit-person=${(e: CustomEvent<{ personId: string }>) => this.#onEditPerson(e)}
        >${this.people.length === 0 ? this.#renderAdd("empty-action") : nothing}</dashboard-staff-list
      >
      ${
        this.errorKey && !this.editOpen && !this.formOpen && this.rowAction === null
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
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
                        ? "person.confirm_mark_inactive"
                        : this.rowAction.action === "reactivate"
                          ? "person.confirm_reactivate"
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
        .person=${this.editingPerson}
        .currentPersonId=${this.currentPersonId}
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
