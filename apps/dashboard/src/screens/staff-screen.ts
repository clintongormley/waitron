import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-staff-list>` and `<dashboard-person-form>` are registered before this
// screen renders them.
import "../widgets/staff-list.js";
import "../widgets/person-form.js";
import "../widgets/person-edit.js";
import type { DashboardApi, PersonRole, PersonSummary } from "../api/client.js";

/**
 * The management dashboard's STAFF SCREEN: the composition point that wires the pure-display
 * `<dashboard-staff-list>`, the `<dashboard-person-form>` create dialog and the
 * `<dashboard-person-edit>` edit dialog to the injected `DashboardApi`. It is the single owner of the
 * two dialogs' open state (`formOpen`, `editOpen`/`editingPerson`) and the list state.
 *
 * On connect it loads `api.listStaff()` into `people` and hands them down to the list. An "Añadir
 * usuario" button opens the create form (`formOpen = true`); on the form's `create-person` event it
 * calls `api.createPerson(detail)`, and on success reloads the list and closes the form — so the list
 * reflects the new person and the operator returns to it. A dismissal (Escape — `wt-dialog` has no
 * backdrop light-dismiss) reaches the
 * screen as the form's composed `wt-close`, which the render's `@wt-close` turns back into
 * `formOpen = false`, so the state the screen owns tracks the dialog the operator actually closed —
 * the fix for a form that could not be reopened after a dismiss (parent `formOpen` stuck `true`, so
 * the next "open" was a no-op that re-committed nothing to the child's `.open`).
 *
 * The staff list's per-row "Editar" emits `edit-person { personId }`, which `#onEditPerson` resolves
 * against the list already held and opens the edit dialog for. That dialog commits FOUR independent
 * mutations — role (`updatePerson`), status (`updatePerson`), PIN (`resetPin`), password
 * (`setPassword`) — each as its own event; `#runEditAction` is their shared body: single-flight,
 * reload, and re-resolve the open dialog's `editingPerson` from the reloaded list so its derived
 * controls track the new state. The two dialogs are mutually exclusive (both modal): opening either
 * closes the other.
 *
 * ERROR HANDLING, every async path, mirroring `login-screen.ts`'s `#loadRoster`/`#submit`:
 * - `#load()` is called via `void this.#load()` on connect, so a rejected `listStaff()` MUST be
 *   caught here — otherwise it is an unhandled promise rejection and the operator faces an empty
 *   list with no feedback. A rejection sets `errorKey` from the thrown `{ code }` (falling back to
 *   `server.internal`); the raw code stays in state and `codeMessage` maps it to localised copy at
 *   the render edge, so the `role="alert"` banner shows a sentence and never the raw wire code.
 * - a rejected `createPerson()` sets the same `errorKey` and DOES NOT reload or close the form, so
 *   the entered values survive and the operator can retry.
 * - a rejected edit action (`#runEditAction`) sets the same `errorKey` and leaves the edit dialog
 *   open for a retry. While the edit dialog is open the `errorKey` is passed DOWN into it
 *   (`.error`), so it renders in the modal's own top layer, and the page-level banner is suppressed
 *   (`errorKey && !editOpen`) — the create form's banner sits behind its backdrop, a known
 *   limitation this dialog does not repeat.
 */
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
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
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

  // A re-entrancy guard, NOT @state (nothing renders off it): set synchronously at `#onCreatePerson`
  // entry so a double-clicked "Crear" (two `create-person` events) files at most one person —
  // `createPerson` is not server-idempotent. Mirrors apps/till's walk-up-sale `submitting` guard.
  #creating = false;

  // The same single-flight guard for the edit dialog's four actions: a double-fired action runs the
  // mutation once (none of updatePerson/resetPin/setPassword is server-idempotent). Separate from
  // `#creating` because create and edit are independent flows.
  #editing = false;

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
    this.formOpen = false;
    this.editingPerson = person;
    this.editOpen = true;
  }

  /**
   * Run one edit-dialog action, then reload. The shared body of all four handlers: single-flight (drop
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

  #onUpdateRole(event: CustomEvent<{ role: PersonRole }>): void {
    event.stopPropagation();
    this.#editWith((id) => this.api.updatePerson(id, { role: event.detail.role }));
  }

  #onSetStatus(event: CustomEvent<{ status: "active" | "suspended" }>): void {
    event.stopPropagation();
    this.#editWith((id) => this.api.updatePerson(id, { status: event.detail.status }));
  }

  #onResetPin(event: CustomEvent<{ pin: string }>): void {
    event.stopPropagation();
    this.#editWith((id) => this.api.resetPin(id, event.detail.pin));
  }

  #onSetPassword(event: CustomEvent<{ password: string }>): void {
    event.stopPropagation();
    this.#editWith((id) => this.api.setPassword(id, event.detail.password));
  }

  /**
   * Resolve the open dialog's person id and run `action(id)` through the single-flight edit runner.
   * The shared head of the four edit handlers, so the `editingPerson` null-narrowing lives in ONE
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
   * and close the form; on rejection set `errorKey` and leave the form open with its values intact.
   */
  async #onCreatePerson(
    event: CustomEvent<{ displayName: string; role: PersonRole; pin: string }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.#creating) return; // single-flight: drop a double-click's second create-person
    this.#creating = true;
    this.errorKey = null;
    try {
      await this.api.createPerson(event.detail);
      this.formOpen = false;
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
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
      <dashboard-staff-list
        .people=${this.people}
        @edit-person=${(e: CustomEvent<{ personId: string }>) => this.#onEditPerson(e)}
      ></dashboard-staff-list>
      ${
        this.errorKey && !this.editOpen
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
      ${
        this.passkeyStatus
          ? html`<p class="status" role="status">${codeMessage(this.passkeyStatus)}</p>`
          : nothing
      }
      <dashboard-person-form
        .open=${this.formOpen}
        @create-person=${(e: CustomEvent<{ displayName: string; role: PersonRole; pin: string }>) =>
          void this.#onCreatePerson(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-person-form>
      <dashboard-person-edit
        .person=${this.editingPerson}
        .open=${this.editOpen}
        .error=${this.editOpen ? this.errorKey : null}
        @update-role=${(e: CustomEvent<{ role: PersonRole }>) => this.#onUpdateRole(e)}
        @set-status=${(e: CustomEvent<{ status: "active" | "suspended" }>) => this.#onSetStatus(e)}
        @reset-pin=${(e: CustomEvent<{ pin: string }>) => this.#onResetPin(e)}
        @set-password=${(e: CustomEvent<{ password: string }>) => this.#onSetPassword(e)}
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
