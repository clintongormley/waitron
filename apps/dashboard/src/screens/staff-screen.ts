import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-staff-list>` and `<dashboard-person-form>` are registered before this
// screen renders them.
import "../widgets/staff-list.js";
import "../widgets/person-form.js";
import type { DashboardApi, PersonRole, PersonSummary } from "../api/client.js";

/**
 * The management dashboard's STAFF SCREEN: the composition point that wires the pure-display
 * `<dashboard-staff-list>` and the `<dashboard-person-form>` create dialog to the injected
 * `DashboardApi`. It is the single owner of the form-open state (`formOpen`) and the list state.
 *
 * On connect it loads `api.listStaff()` into `people` and hands them down to the list. An "Añadir
 * usuario" button opens the form (`formOpen = true`); on the form's `create-person` event it calls
 * `api.createPerson(detail)`, and on success reloads the list and closes the form — so the list
 * reflects the new person and the operator returns to it. A dismissal (Escape/backdrop) reaches the
 * screen as the form's composed `wt-close`, which the render's `@wt-close` turns back into
 * `formOpen = false`, so the state the screen owns tracks the dialog the operator actually closed —
 * the fix for a form that could not be reopened after a dismiss (parent `formOpen` stuck `true`, so
 * the next "open" was a no-op that re-committed nothing to the child's `.open`).
 *
 * ERROR HANDLING, both async paths, mirroring `login-screen.ts`'s `#loadRoster`/`#submit`:
 * - `#load()` is called via `void this.#load()` on connect, so a rejected `listStaff()` MUST be
 *   caught here — otherwise it is an unhandled promise rejection and the operator faces an empty
 *   list with no feedback. A rejection sets `errorKey` from the thrown `{ code }` (falling back to
 *   `server.internal`), rendered raw in a `role="alert"` banner (a later i18n task maps codes to
 *   Spanish copy, exactly as the login screen defers its error keys).
 * - a rejected `createPerson()` sets the same `errorKey` and DOES NOT reload or close the form, so
 *   the entered values survive and the operator can retry.
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
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private people: PersonSummary[] = [];
  @state() private formOpen = false;
  @state() private errorKey: string | null = null;

  // A re-entrancy guard, NOT @state (nothing renders off it): set synchronously at `#onCreatePerson`
  // entry so a double-clicked "Crear" (two `create-person` events) files at most one person —
  // `createPerson` is not server-idempotent. Mirrors apps/till's walk-up-sale `submitting` guard.
  #creating = false;

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
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /**
   * The add button opens the create form. Clear `errorKey` first so a banner left by a previous
   * action does not shadow the freshly opened form. Dismissal is not handled here: the form emits
   * `wt-close`, which the render's `@wt-close` tracks back into `formOpen` (see the class doc).
   */
  #openForm(): void {
    this.errorKey = null;
    this.formOpen = true;
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
      this.errorKey = (error as { code?: string }).code ?? "server.internal";
    } finally {
      this.#creating = false;
    }
  }

  override render() {
    return html`
      <div class="header">
        <h1 class="title">Usuarios</h1>
        <wt-button variant="primary" data-test="add" @click=${() => this.#openForm()}
          >Añadir usuario</wt-button
        >
      </div>
      <dashboard-staff-list .people=${this.people}></dashboard-staff-list>
      ${this.errorKey ? html`<p class="error" role="alert">${this.errorKey}</p>` : ""}
      <dashboard-person-form
        .open=${this.formOpen}
        @create-person=${(e: CustomEvent<{ displayName: string; role: PersonRole; pin: string }>) =>
          void this.#onCreatePerson(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-person-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-staff-screen": StaffScreen;
  }
}
