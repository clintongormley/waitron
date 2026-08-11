import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import type { PropertyValues } from "lit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName, statusName } from "../i18n/domain.js";
import type { PersonRole, PersonSummary } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/** The role options the edit form offers, in the slice-1b staff API's own order (matches person-form). */
const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/**
 * The management dashboard's EDIT-PERSON form: a `wt-dialog` (heading "Editar <name>") that manages one
 * existing person through the four slice-1b staff mutations, each committed INDEPENDENTLY so changing a
 * role never forces the operator to retype a PIN. Sections:
 *
 * - **Rol** — a role picker (native `<select>`, as there is no `wt-select` primitive, matching the
 *   create form) preset to the person's current role, plus a "Guardar rol" button → emits
 *   `update-role { role }`.
 * - **Estado** — a single button whose label and effect derive straight from `person.status`:
 *   "Suspender" for an active person, "Reactivar" for a suspended one → emits `set-status { status }`
 *   with the OPPOSITE status. No local state — the button always reflects the person the screen handed
 *   down, so after a suspend + reload it flips to "Reactivar".
 * - **PIN** — a field (`wt-input`) + "Restablecer PIN" → emits `reset-pin { pin }`.
 * - **Contraseña** — a field (`wt-input`) + "Establecer contraseña" → emits `set-password { password }`.
 *
 * Like the pure-display staff list and the create form (and UNLIKE the login screen), it does NOT call
 * the API: the staff screen owns the injected `DashboardApi` and turns each domain event into the
 * matching call, then reloads. Every event is `bubbles`+`composed` so it crosses this widget's shadow
 * boundary to the screen. The staff screen is the single owner of the open state and drives it by
 * setting `.open` — the same open-by-property contract `wt-dialog` uses.
 *
 * The role `<select>` is reconciled to `selectedRole` imperatively in `updated()`, NOT by a template
 * binding, because neither binding is sufficient on a native select: a `.value` bound in the template
 * commits before the `<option>` children exist, so a non-default preset falls back to the first option
 * (the latent bug the create/login pickers carry, harmless there only because their default IS the
 * first option); and `?selected` sets each option's boolean `selected` CONTENT attribute, which only
 * seeds `defaultSelected` and is IGNORED once the user has dirtied the select — so after a user picks a
 * value, closes (which reverts `selectedRole`) and reopens the same person, a `?selected` picker keeps
 * the stale dirty pick while state says otherwise. Setting `.value` in `updated()` — after the options
 * are in the DOM, on every render — makes the picker a properly controlled component in all three
 * cases (initial preset, cross-person switch, and reopen-after-unsaved-revert). Server-side length
 * rules (`pin.too_short` / `password.too_short`) are NOT duplicated here: a short value is refused by
 * the server and surfaces as that code — inside this dialog when it is open (see the `error` property).
 *
 * Roles and status render through the i18n layer as localised display names (`roleName`/`statusName`
 * at the render edge); each role option's `<option value>` stays the raw domain token, since the
 * picker is reconciled to `selectedRole` (a raw token) by value. The in-dialog error banner maps its
 * raw code through `codeMessage`, so an operator never sees the wire code.
 */
@customElement("dashboard-person-edit")
export class PersonEdit extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      /* A label + its action button on one row: the field grows, the button hugs its content. */
      .action {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }
      .action > .grow {
        flex: 1;
        min-width: 0;
      }
      .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .status-label {
        color: var(--wt-color-text);
      }
      /* The in-dialog error banner — rendered in the modal's own top layer, unlike the screen's
         page-level banner which the backdrop would occlude. */
      .edit-error {
        color: var(--wt-color-danger);
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];

  /** The person being edited. The screen assigns it when opening; null before then (dialog stays empty). */
  @property({ attribute: false }) person: PersonSummary | null = null;

  /** Whether the dialog is showing. The screen sets this to open the form; the form clears it on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /**
   * An error to show INSIDE the open dialog. The screen passes the edit action's failure here as a
   * RAW code (e.g. `authorization.not_permitted` or `pin.too_short`), which `codeMessage` maps to
   * localised copy at the render edge — the code stays raw in this property, never shown verbatim. It
   * renders in the modal's own top layer; the screen's page-level banner sits BEHIND the modal
   * backdrop, where a sighted operator could not see it — the create dialog's known limitation, not
   * repeated for edit.
   */
  @property() error: string | null = null;

  // Named `selectedRole`, not `role`: `HTMLElement` already carries a public `role` ARIA property
  // (ARIAMixin), which a `private role` field would illegally narrow — the same collision person-form
  // documents. The emitted event's detail key is still `role`.
  @state() private selectedRole: PersonRole = "staff";
  @state() private pin = "";
  @state() private password = "";

  // The identity of the person the role picker was last initialised for. Reset `selectedRole` only when
  // the person IDENTITY changes, not on every `person` re-assignment: after an action the screen reloads
  // and hands down a fresh object for the SAME id, and clobbering the picker then would discard an
  // unsaved role selection made during the same open session.
  #rolePersonId: string | null = null;

  // A handle to the native role <select>, reconciled to `selectedRole` in `updated()` (see the class
  // doc for why a template binding cannot do this on a native select).
  #roleSelect = createRef<HTMLSelectElement>();

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("person") && this.person && this.person.personId !== this.#rolePersonId) {
      this.selectedRole = this.person.role;
      this.#rolePersonId = this.person.personId;
    }
  }

  override updated(): void {
    // Force the native <select>'s live value to match `selectedRole` after every render, once the
    // <option> children are in the DOM. This is the ONLY place the picker's displayed value is set —
    // it corrects both the before-options ordering (initial preset) and a user-dirtied select whose
    // state has since reverted (reopen-after-unsaved-change). No-op when the dialog has no person
    // (the select is not rendered). Setting `.value` imperatively does not trigger a reactive update,
    // so this does not loop.
    const select = this.#roleSelect.value;
    if (select) select.value = this.selectedRole;
  }

  /** Capture the picked role. A native `<select>` `change` is `composed: false`, so `stopPropagation`
   * here is defensive consistency with the composed `wt-change` handlers, not a boundary guard. */
  #onRoleChange(event: Event): void {
    event.stopPropagation();
    this.selectedRole = (event.target as HTMLSelectElement).value as PersonRole;
  }

  #onPinChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
  }

  #onPasswordChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.password = event.detail.value;
  }

  /** Dispatch a bubbling, composed action event so it reaches the staff screen across the shadow
   * boundary. `stopPropagation` on the button's own composed `click` keeps the screen from also
   * hearing a raw click — the house pattern person-form's confirm handler follows. */
  #emit(type: string, detail: Record<string, unknown>, buttonClick: Event): void {
    buttonClick.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /**
   * The dialog closed (Escape, or the screen setting `.open=false` — `wt-dialog` implements no
   * backdrop light-dismiss: it has a `::backdrop` STYLE but no click/pointer/`closedby` handler, so a
   * backdrop click does NOT close it; verified against `packages/ui/src/components/wt-dialog.ts` and a
   * real modal `<dialog>`). Drop our own `open` to stay self-consistent and — unlike the field
   * handlers — deliberately do NOT `stopPropagation`: the
   * composed `wt-close` must bubble on to the staff screen (the single owner of the open state) so its
   * edit-open flag tracks the close and the dialog can reopen (the same contract person-form documents).
   *
   * RESET the PIN and password: they are SECRETS and must not linger into the next person's edit — a
   * cross-person leak in an identity console. The role picker resets too, back to the current person's
   * role, so an unsaved role change is discarded on close.
   */
  #onClose(): void {
    this.open = false;
    this.pin = "";
    this.password = "";
    this.selectedRole = this.person?.role ?? "staff";
  }

  override render() {
    const person = this.person;
    return html`
      <wt-dialog
        heading=${person ? `${t("action.edit")} ${person.displayName}` : t("person.edit")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        ${
          person
            ? html`
                ${
                  this.error
                    ? html`<p class="edit-error" role="alert">${codeMessage(this.error)}</p>`
                    : nothing
                }
                <div class="action">
                  <label class="field grow"
                    >${t("person.role")}
                    <select
                      data-test="edit-role"
                      ${ref(this.#roleSelect)}
                      @change=${(e: Event) => this.#onRoleChange(e)}
                    >
                      ${ROLES.map((role) => html`<option value=${role}>${roleName(role)}</option>`)}
                    </select>
                  </label>
                  <wt-button
                    variant="secondary"
                    data-test="save-role"
                    @click=${(e: Event) => this.#emit("update-role", { role: this.selectedRole }, e)}
                    >${t("person.save_role")}</wt-button
                  >
                </div>

                <div class="status-row">
                  <span class="status-label"
                    >${t("person.status_label")}: ${statusName(person.status)}</span
                  >
                  <wt-button
                    variant="secondary"
                    data-test="toggle-status"
                    @click=${(e: Event) =>
                      this.#emit(
                        "set-status",
                        { status: person.status === "active" ? "suspended" : "active" },
                        e,
                      )}
                    >${
                      person.status === "active" ? t("person.suspend") : t("person.reactivate")
                    }</wt-button
                  >
                </div>

                <div class="action">
                  <wt-input
                    class="field grow"
                    data-test="edit-pin"
                    label=${t("person.pin")}
                    type="password"
                    .value=${this.pin}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPinChange(e)}
                  ></wt-input>
                  <wt-button
                    variant="secondary"
                    data-test="save-pin"
                    @click=${(e: Event) => this.#emit("reset-pin", { pin: this.pin }, e)}
                    >${t("person.reset_pin")}</wt-button
                  >
                </div>

                <div class="action">
                  <wt-input
                    class="field grow"
                    data-test="edit-password"
                    label=${t("person.password")}
                    type="password"
                    .value=${this.password}
                    @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPasswordChange(e)}
                  ></wt-input>
                  <wt-button
                    variant="secondary"
                    data-test="save-password"
                    @click=${(e: Event) => this.#emit("set-password", { password: this.password }, e)}
                    >${t("person.set_password")}</wt-button
                  >
                </div>
              `
            : nothing
        }
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-person-edit": PersonEdit;
  }
}
