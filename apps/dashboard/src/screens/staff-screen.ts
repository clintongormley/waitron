import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
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

/**
 * The management dashboard's STAFF SCREEN: the composition point that wires the pure-display
 * `<dashboard-staff-list>`, the `<dashboard-person-form>` create dialog and the
 * `<dashboard-person-edit>` edit dialog to the injected `DashboardApi`. It is the single owner of the
 * two dialogs' open state (`formOpen`, `editOpen`/`editingPerson`) and the list state.
 *
 * On connect it loads `api.listStaff()` into `people` and hands them down to the list. An "Añadir
 * usuario" button opens the create form (`formOpen = true`); on the form's `create-person` event it
 * calls `api.createPerson(detail)`, and on success reloads the list and closes the form — so the list
 * reflects the new person and the operator returns to it. When the address belongs to an inactive
 * person, it opens that person's edit dialog so the manager can inspect or reactivate the existing
 * record. A dismissal (Escape — `wt-dialog` has no
 * backdrop light-dismiss) reaches the
 * screen as the form's composed `wt-close`, which the render's `@wt-close` turns back into
 * `formOpen = false`, so the state the screen owns tracks the dialog the operator actually closed —
 * the fix for a form that could not be reopened after a dismiss (parent `formOpen` stuck `true`, so
 * the next "open" was a no-op that re-committed nothing to the child's `.open`).
 *
 * The staff list's per-row "Editar" emits `edit-person { personId }`, which `#onEditPerson` resolves
 * against the list already held and opens the edit dialog for. The dialog saves its editable fields
 * atomically; reset login, reset PIN, invitation and lifecycle actions remain explicit operations.
 * `#runEditAction` supplies single-flight execution, reload and re-resolution of the open person.
 * The two dialogs are mutually exclusive (both modal): opening either closes the other.
 *
 * ERROR HANDLING, every async path, mirroring `login-screen.ts`'s `#loadRoster`/`#submit`:
 * - `#load()` is called via `void this.#load()` on connect, so a rejected `listStaff()` MUST be
 *   caught here — otherwise it is an unhandled promise rejection and the operator faces an empty
 *   list with no feedback. A rejection sets `errorKey` from the thrown `{ code }` (falling back to
 *   `server.internal`); the raw code stays in state and `codeMessage` maps it to localised copy at
 *   the render edge, so the `role="alert"` banner shows a sentence and never the raw wire code.
 * - a rejected `createPerson()` sets the same `errorKey` and DOES NOT reload or close the form, so
 *   the entered values survive and the operator can retry. While the create form is open the
 *   `errorKey` is passed DOWN into it (`.error`), so it renders in the modal's own top layer, and the
 *   page-level banner is suppressed (`errorKey && !editOpen && !formOpen`).
 * - a rejected edit action (`#runEditAction`) sets the same `errorKey` and leaves the edit dialog
 *   open for a retry. While the edit dialog is open the `errorKey` is passed DOWN into it
 *   (`.error`), so it renders in the modal's own top layer, and the page-level banner is suppressed
 *   (`errorKey && !editOpen && !formOpen`) — both dialogs carry their own `error` for the same
 *   reason: the page-level banner sits behind an open dialog's backdrop, where a sighted operator
 *   could not see it.
 */
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
        min-height: 2.75rem;
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
  @property({ attribute: false }) currentPersonId: string | null = null;
  @state() private people: PersonSummary[] = [];
  @state() private formOpen = false;
  // The person the edit dialog is open for (null when closed), and its open flag. The screen is the
  // single owner of the edit-open state, exactly as it owns `formOpen` for the create form.
  @state() private editingPerson: PersonSummary | null = null;
  @state() private editOpen = false;
  @state() private errorKey: string | null = null;
  // A minimal success confirmation for #addPasskey: the raw status code is kept here and mapped to
  // localised copy by `codeMessage` at the render edge (`passkey.registered` → "Passkey añadida").
  // The WebAuthn ceremony has no visible surface of its own once the browser dialog closes, so
  // without this the operator gets no feedback.
  @state() private passkeyStatus: string | null = null;
  @state() private invitationStatus: "sent" | "not_sent" | null = null;
  @state() private search = "";
  @state() private roleFilter: PersonRole | "all" = "all";
  @state() private statusFilter: "current" | "pending" | "active" | "suspended" | "all" = "current";

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
      this.people = await this.api.listStaff();
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
    this.passkeyStatus = null;
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
    this.passkeyStatus = null;
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
    this.#editWith((id) => this.api.savePerson(id, event.detail));
  }

  #onDeactivatePerson(event: Event): void {
    event.stopPropagation();
    const person = this.editingPerson;
    if (person === null || person.personId === this.currentPersonId) return;
    this.#editWith((id) =>
      this.api.savePerson(id, {
        displayName: person.displayName,
        firstNames: person.firstNames ?? person.displayName,
        lastNames: person.lastNames ?? "—",
        telephone: person.telephone ?? null,
        email: person.email ?? "",
        role: person.role,
        status: "suspended",
      }),
    );
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
   * Enroll a passkey for the signed-in operator — the symmetric parallel of the login screen's
   * `#passkeyLogin`, run from where the logged-in manager already is. `passkeyRegisterOptions()` is
   * GATED (the route resolves the person from the session) and returns the creation options plus a
   * challenge handle; `startRegistration` runs the browser attestation ceremony; `passkeyRegisterVerify`
   * echoes the handle with the signed response to finish enrollment. Success sets a brief
   * `passkeyStatus` banner (the ceremony leaves no visible trace once the browser dialog closes).
   *
   * `startRegistration` takes `{ optionsJSON }` in `@simplewebauthn/browser` v13 — the options blob is
   * nested under that key, not passed bare. The blob is the server's
   * `PublicKeyCredentialCreationOptionsJSON`; the client types it as an opaque `PasskeyOptions`
   * (`Record<string, unknown>`), which has no structural overlap with the concrete interface, so the
   * cast re-narrows it via `unknown` at this one call site — validated there, exactly as the
   * `PasskeyOptions` note in `api/client.ts` intends.
   *
   * Any failure becomes the same `errorKey`-in-a-`role="alert"` banner the other async paths use,
   * falling back to `passkey.verification_failed` (the code the server itself throws on a failed
   * verify) when the rejection names none. Caught here because the click handler calls this via
   * `void`, so an uncaught rejection would strand the operator with no feedback.
   */
  async #addPasskey(): Promise<void> {
    this.errorKey = null;
    this.passkeyStatus = null;
    try {
      const { challengeHandle, options } = await this.api.passkeyRegisterOptions();
      const response = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      await this.api.passkeyRegisterVerify({ challengeHandle, response });
      this.passkeyStatus = "passkey.registered";
    } catch (error) {
      this.errorKey = codeOf(error, "passkey.verification_failed");
    }
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
          <wt-button
            variant="secondary"
            data-test="add-passkey"
            @click=${() => void this.#addPasskey()}
            >${t("staff.add_passkey")}</wt-button
          >
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
        @edit-person=${(e: CustomEvent<{ personId: string }>) => this.#onEditPerson(e)}
      ></dashboard-staff-list>
      ${
        this.errorKey && !this.editOpen && !this.formOpen
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${
        this.passkeyStatus
          ? html`<p class="status" role="status">${codeMessage(this.passkeyStatus)}</p>`
          : nothing
      }
      ${
        this.invitationStatus
          ? html`<p class="status" role="status" data-test="invitation-status">
              ${t(`staff.invitation_${this.invitationStatus}`)}
            </p>`
          : nothing
      }
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
