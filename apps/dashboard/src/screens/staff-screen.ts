import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { t } from "../i18n/t.js";
import { roleName, statusName } from "../i18n/domain.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-staff-list>` and `<dashboard-person-form>` are registered before this
// screen renders them.
import "../widgets/staff-list.js";
import "../widgets/person-form.js";
import "../widgets/person-edit.js";
import type { DashboardApi, PersonEditDetails, PersonRole, PersonSummary } from "../api/client.js";

/** Owns the staff list, editors and explicit credential/lifecycle actions. */
@customElement("dashboard-staff-screen")
export class StaffScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
        grid-template-columns: minmax(14rem, 1fr) repeat(2, minmax(10rem, auto));
        gap: var(--wt-space-3);
        align-items: end;
        margin-bottom: var(--wt-space-4);
      }
      .filter {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      .filter input {
        box-sizing: border-box;
        min-height: var(--wt-tap-min);
        padding: 0 var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
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
    (error) => {
      this.errorKey = codeOf(error);
    },
  );
  @property({ attribute: false }) currentPersonId: string | null = null;
  @state() private people: PersonSummary[] = [];
  @state() private formOpen = false;
  // The person the edit dialog is open for (null when closed), and its open flag. The screen is the
  // single owner of the edit-open state, exactly as it owns `formOpen` for the create form.
  @state() private editingPerson: PersonSummary | null = null;
  @state() private editOpen = false;
  @state() private errorKey: string | null = null;
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
    this.errorKey = null;
    this.invitationStatus = null;
    this.rowAction = { person, action: action as NonNullable<typeof this.rowAction>["action"] };
  }

  async #confirmRowAction(): Promise<void> {
    if (this.rowAction === null || this.rowBusy) return;
    const { person, action } = this.rowAction;
    if (action === "disable" && person.personId === this.currentPersonId) return;
    this.rowBusy = true;
    this.errorKey = null;
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
      this.errorKey = codeOf(error);
    } finally {
      this.rowBusy = false;
    }
  }

  // A re-entrancy guard, NOT @state (nothing renders off it): set synchronously at `#onCreatePerson`
  // entry so a double-clicked "Crear" (two `create-person` events) files at most one person —
  // `createPerson` is not server-idempotent. Mirrors apps/till's walk-up-sale `submitting` guard.
  #creating = false;

  // The same single-flight guard for the edit dialog's actions: a double-fired action runs the
  // mutation once. Separate from
  // `#creating` because create and edit are independent flows.
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

  /**
   * (Re)load the staff list. Called on connect and after a successful create. A rejection becomes
   * the `errorKey`-in-a-`role="alert"`-banner state rather than an unhandled rejection; a fresh
   * attempt clears any prior error first.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("listStaff", [], (value) => {
        this.people = value;
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * The add button opens the create form. Clear `errorKey` first so a banner left by a previous
   * action does not shadow the freshly opened form. Dismissal is not handled here: the form emits
   * `wt-close`, which the render's `@wt-close` tracks back into `formOpen` (see the class doc).
   */
  #openForm(): void {
    this.errorKey = null;
    this.invitationStatus = null;
    this.#closeEdit(); // the two dialogs are mutually exclusive (both are modal)
    this.formOpen = true;
  }

  /**
   * Close the edit dialog AND drop its target. Clearing `editingPerson` here (not only `editOpen`) is
   * what keeps the "`editingPerson` is null when the dialog is closed" invariant true: it stops a
   * closed dialog leaving a stale edit target that `#editWith` could still resolve, and keeps the
   * `.person`/`.open` the dialog receives consistent.
   */
  #closeEdit(): void {
    this.editOpen = false;
    this.editingPerson = null;
  }

  /**
   * The staff list asked to edit a person. Resolve the row from the list we already hold (the list is
   * OURS — it came from `listStaff` — so an unknown id can only be a stale event; drop it) and open the
   * edit dialog for it, closing the create form so at most one modal shows. `stopPropagation` keeps the
   * composed `edit-person` from leaking past this screen to the app shell, the house pattern the create
   * handler follows.
   */
  #onEditPerson(event: CustomEvent<{ personId: string }>): void {
    event.stopPropagation();
    const person = this.people.find((p) => p.personId === event.detail.personId);
    if (person === undefined) return;
    this.errorKey = null;
    this.invitationStatus = null;
    this.formOpen = false;
    this.editingPerson = person;
    this.editOpen = true;
  }

  /**
   * Run one edit-dialog action, then reload. The shared body of the handlers: single-flight (drop
   * a re-fire while one is in flight, since the mutations are not server-idempotent), clear any prior
   * error, await the mutation, reload the list, and RE-RESOLVE `editingPerson` from the reloaded list so
   * the still-open dialog's derived controls (the Suspender/Reactivar toggle, the role preset) reflect
   * the new state. A rejection becomes the `errorKey` banner and leaves the dialog open for a retry,
   * exactly as `#onCreatePerson` does — never an unhandled rejection (the handlers call this via `void`).
   */
  async #runEditAction(action: () => Promise<void>): Promise<void> {
    if (this.#editing) return;
    this.#editing = true;
    this.errorKey = null;
    try {
      await action();
      await this.#load();
      if (this.editingPerson) {
        const id = this.editingPerson.personId;
        this.editingPerson = this.people.find((p) => p.personId === id) ?? this.editingPerson;
      }
    } catch (error) {
      this.errorKey = codeOf(error);
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

  #onDeactivatePerson(event: Event): void {
    event.stopPropagation();
    const person = this.editingPerson;
    if (person === null || person.personId === this.currentPersonId) return;
    this.#editWith((id) => this.api.deactivatePerson(id));
  }

  #onResetPin(event: Event): void {
    event.stopPropagation();
    this.#editWith((id) => this.api.resetPin(id));
  }

  #onResetLogin(event: Event): void {
    event.stopPropagation();
    const id = this.editingPerson?.personId;
    if (id === undefined || this.#editing) return;
    this.#editing = true;
    this.errorKey = null;
    this.invitationStatus = null;
    void this.api
      .resetLogin(id)
      .then(async (result) => {
        this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
        this.#closeEdit();
        await this.#load();
      })
      .catch((error: unknown) => {
        this.errorKey = codeOf(error);
      })
      .finally(() => {
        this.#editing = false;
      });
  }

  #onReactivatePerson(event: Event): void {
    event.stopPropagation();
    const id = this.editingPerson?.personId;
    if (id === undefined || this.#editing) return;
    this.#editing = true;
    this.errorKey = null;
    this.invitationStatus = null;
    void this.api
      .reactivatePerson(id)
      .then(async (result) => {
        this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
        this.#closeEdit();
        await this.#load();
      })
      .catch((error: unknown) => {
        this.errorKey = codeOf(error);
      })
      .finally(() => {
        this.#editing = false;
      });
  }

  async #onResendInvitation(event: Event): Promise<void> {
    event.stopPropagation();
    const personId = this.editingPerson?.personId;
    if (personId === undefined || this.#editing) return;
    this.#editing = true;
    this.errorKey = null;
    this.invitationStatus = null;
    try {
      const result = await this.api.resendInvitation(personId);
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      this.#closeEdit();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#editing = false;
    }
  }

  /**
   * Resolve the open dialog's person id and run `action(id)` through the single-flight edit runner.
   * The shared head of the edit handlers, so the `editingPerson` null-narrowing lives in ONE
   * place. A no-op when no person is open — a type guard rather than a reachable UI path, since the
   * edit dialog only emits its action events while it is open for a person.
   */
  #editWith(action: (id: string) => Promise<void>): void {
    const id = this.editingPerson?.personId;
    if (id === undefined) return;
    void this.#runEditAction(() => action(id));
  }

  /**
   * The form asked to create a person. `stopPropagation` keeps its composed `create-person` inside
   * this screen (the house pattern — the form's own field handlers stop their composed events the
   * same way), so it is not seen a second time by the app shell above. On success reload the list
   * and close the form. A duplicate inactive address opens that existing record; other rejections set
   * `errorKey` and leave the form open with its values intact.
   */
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
    if (this.#creating) return; // single-flight: drop a double-click's second create-person
    this.#creating = true;
    this.errorKey = null;
    try {
      const result = await this.api.createPerson(event.detail);
      this.invitationStatus = result.invitationSent ? "sent" : "not_sent";
      this.formOpen = false;
      await this.#load();
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
        this.errorKey = code;
      }
    } finally {
      this.#creating = false;
    }
  }

  override render() {
    return html`
      <div class="header">
        <h1 class="title">${t("staff.title")}</h1>
        <div class="actions">
          <wt-button variant="primary" data-test="add" @click=${() => this.#openForm()}
            >${t("staff.add_user")}</wt-button
          >
        </div>
      </div>
      <div class="filters" aria-label=${t("staff.filters")}>
        <label class="filter">
          ${t("staff.search")}
          <input
            data-test="search"
            name="search"
            type="search"
            autocomplete="off"
            .value=${this.search}
            @input=${(event: InputEvent) =>
              (this.search = (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="filter">
          ${t("staff.filter_role")}
          <select
            data-test="role-filter"
            name="role-filter"
            @change=${(event: Event) =>
              (this.roleFilter = (event.target as HTMLSelectElement).value as PersonRole | "all")}
          >
            <option value="all">${t("staff.filter_all_roles")}</option>
            ${(["staff", "supervisor", "manager", "admin"] as const).map(
              (role) => html`<option value=${role}>${roleName(role)}</option>`,
            )}
          </select>
        </label>
        <label class="filter">
          ${t("staff.filter_status")}
          <select
            data-test="status-filter"
            name="status-filter"
            @change=${(event: Event) =>
              (this.statusFilter = (event.target as HTMLSelectElement)
                .value as typeof this.statusFilter)}
          >
            <option value="current">${t("staff.filter_current")}</option>
            <option value="active">${statusName("active")}</option>
            <option value="pending">${statusName("pending")}</option>
            <option value="suspended">${statusName("suspended")}</option>
            <option value="all">${t("staff.filter_all_statuses")}</option>
          </select>
        </label>
      </div>
      <dashboard-staff-list
        .people=${this.#filteredPeople()}
        .currentPersonId=${this.currentPersonId}
        @person-action=${(event: CustomEvent<{ personId: string; action: string }>) => this.#onRowAction(event)}
        @edit-person=${(e: CustomEvent<{ personId: string }>) => this.#onEditPerson(e)}
      ></dashboard-staff-list>
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
        ${this.rowAction && this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
        <wt-form-actions slot="footer">
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
        @save-person=${(e: CustomEvent<PersonEditDetails>) => this.#onSavePerson(e)}
        @deactivate-person=${(e: Event) => this.#onDeactivatePerson(e)}
        @reset-pin=${(e: Event) => this.#onResetPin(e)}
        @reset-login=${(e: Event) => this.#onResetLogin(e)}
        @reactivate-person=${(e: Event) => this.#onReactivatePerson(e)}
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
