import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import type { PersonRole } from "../api/client.js";

/** The role options the create form offers, in the slice-1b staff API's own order. */
const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/**
 * The management dashboard's CREATE-PERSON form: a `wt-dialog` (heading "Nuevo usuario") holding a
 * display-name field (`wt-input`), a role picker (native `<select>` — there is no `wt-select`
 * primitive, exactly as the login screen's roster picker) and a PIN field (`wt-input`), plus a
 * primary confirm control in the footer.
 *
 * The app shell (a later task) drives it by setting `.open` — the same open-by-property contract
 * `wt-dialog` itself uses — and hears one event: on confirm the form dispatches `create-person`
 * carrying `{ displayName, role, pin }`, `bubbles`/`composed` so it crosses the shadow boundary to
 * the shell, which turns it into `DashboardApi.createPerson`. The form does NOT call the API itself
 * (like the pure-display staff list, unlike the login screen) and does NOT close itself on confirm —
 * the shell closes it once the create succeeds, so a rejected create leaves the entered values in
 * place.
 *
 * Dismissal is the one bit of open-state the form owns: `wt-dialog` emits `wt-close` when its native
 * dialog closes (Escape, the backdrop, `.close()`), and the form resets its own `open` to false in
 * response — otherwise a dismissed dialog would leave the form believing it is still showing.
 *
 * Roles render as their raw domain tokens (`staff`, `supervisor`, …); a later i18n task maps them to
 * Spanish copy, exactly as the login screen defers its error keys and the staff list its role/status.
 */
@customElement("dashboard-person-form")
export class PersonForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }

      /* Matches the login screen's roster <select>: a token-styled native control (no wt-select
         primitive exists). The 1px hairline is a literal, as wt-input/wt-card's own borders are. */
      select {
        font: inherit;
        width: 100%;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
    `,
  ];

  /** Whether the dialog is showing. The app sets this to open the form; the form clears it on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  // Named `selectedRole`, not `role`: `HTMLElement` already carries a public `role` ARIA property
  // (ARIAMixin), which a `private role` field would illegally narrow — the same collision the
  // `ha-*`/`wt-*` components hit with `ariaLabel`. The emitted event's detail key is still `role`.
  @state() private displayName = "";
  @state() private selectedRole: PersonRole = "staff";
  @state() private pin = "";

  /**
   * Capture the display-name field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what keeps it inside this form's shadow boundary rather than leaking to the
   * app shell — the house pattern the login screen's field handlers follow.
   */
  #onDisplayNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.displayName = event.detail.value;
  }

  /** Capture the picked role; `stopPropagation` keeps the native `change` inside this form. */
  #onRoleChange(event: Event): void {
    event.stopPropagation();
    this.selectedRole = (event.target as HTMLSelectElement).value as PersonRole;
  }

  /** Capture the PIN field's new value; stops the composed `wt-change` from leaking out. */
  #onPinChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
  }

  /**
   * Ask the app to create the person. `stopPropagation` keeps the confirm button's own composed
   * `click` inside this shadow boundary, so the shell hears the semantic `create-person` and not a
   * raw click too — then dispatch it `bubbles`+`composed` so it reaches the shell.
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ displayName: string; role: PersonRole; pin: string }>("create-person", {
        detail: { displayName: this.displayName, role: this.selectedRole, pin: this.pin },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The dialog was dismissed (Escape/backdrop/close) — drop our own open state to match. */
  #onClose(): void {
    this.open = false;
  }

  override render() {
    return html`
      <wt-dialog heading="Nuevo usuario" .open=${this.open} @wt-close=${() => this.#onClose()}>
        <wt-input
          class="field"
          data-test="display-name"
          label="Nombre"
          .value=${this.displayName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDisplayNameChange(e)}
        ></wt-input>
        <label class="field"
          >Rol
          <select .value=${this.selectedRole} @change=${(e: Event) => this.#onRoleChange(e)}>
            ${ROLES.map((role) => html`<option value=${role}>${role}</option>`)}
          </select>
        </label>
        <wt-input
          class="field"
          data-test="pin"
          label="PIN"
          .value=${this.pin}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPinChange(e)}
        ></wt-input>
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          @click=${(e: Event) => this.#confirm(e)}
          >Crear</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-person-form": PersonForm;
  }
}
