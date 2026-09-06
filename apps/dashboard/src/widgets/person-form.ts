import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
import type { PersonRole } from "../api/client.js";

/** The role options the create form offers, in the slice-1b staff API's own order. */
const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/**
 * The management dashboard's CREATE-PERSON form: a `wt-dialog` (heading "Nuevo usuario") holding a
 * display-name field (`wt-input`), a role picker (native `<select>` — there is no `wt-select`
 * primitive), a PIN field (the till credential) and a
 * dashboard sign-in email field (`wt-input[type=email]`), plus a primary confirm control in the footer.
 *
 * The staff screen drives it by setting `.open` — the same open-by-property contract `wt-dialog`
 * itself uses — and hears one event: on confirm the form dispatches `create-person` carrying
 * `{ displayName, role, pin }` plus `email` WHEN one was typed (a blank email is omitted, never sent
 * as ""), `bubbles`/`composed` so it crosses the shadow boundary to the staff screen, which turns it
 * into `DashboardApi.createPerson`. The form does NOT call the API itself
 * (like the pure-display staff list, unlike the login screen) and does NOT close itself on confirm —
 * the staff screen closes it once the create succeeds, so a rejected create leaves the entered
 * values in place.
 *
 * The staff screen is the single owner of the open state. On dismissal `wt-dialog` emits `wt-close`
 * when its native dialog closes (Escape, the backdrop, `.close()`); the form resets its own `open`
 * to false to stay self-consistent AND — crucially — does NOT stop that composed `wt-close`, so it
 * bubbles on to the staff screen, which clears the `formOpen` it owns. Swallowing it here would
 * leave the parent's `formOpen` stuck `true`, and the next open would be a no-op the operator sees
 * as a dialog that will not reopen.
 *
 * Each role option's visible TEXT renders through the i18n layer as its localised name (`roleName`),
 * while its `<option value>` stays the raw domain token (`staff`, `supervisor`, …) — that wire value
 * is what the emitted `create-person` detail's `role` reads back.
 */
@customElement("dashboard-person-form")
export class PersonForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      /* The in-dialog error banner — rendered in the modal's own top layer, unlike the screen's
         page-level banner which the backdrop would occlude. */
      .create-error {
        color: var(--wt-color-danger);
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];

  /** Whether the dialog is showing. The app sets this to open the form; the form clears it on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /**
   * An error to show INSIDE the open dialog. The staff screen passes a rejected `createPerson`
   * failure here as a RAW code (e.g. `pin.too_short`), which `codeMessage` maps to localised copy at
   * the render edge — the code stays raw in this property, never shown verbatim. It renders in the
   * modal's own top layer; the screen's page-level banner sits BEHIND the modal backdrop, where a
   * sighted operator could not see it — the same reason the edit dialog carries its own `error`.
   */
  @property() error: string | null = null;

  @state() private displayName = "";
  // Named `selectedRole`, not `role`: `HTMLElement` already carries a public `role` ARIA property
  // (ARIAMixin), which a `private role` field would illegally narrow — the same collision the
  // `ha-*`/`wt-*` components hit with `ariaLabel`. The emitted event's detail key is still `role`.
  @state() private selectedRole: PersonRole = "staff";
  @state() private pin = "";
  // The dashboard sign-in email (grouped with a password on the edit form; the PIN is the till
  // credential). Optional on create — a blank field is OMITTED from the emitted detail, so a create
  // with no email never sends an empty string the server would reject as `person.email_invalid`.
  @state() private email = "";

  // A handle to the native role <select>, reconciled to `selectedRole` in `updated()` (see that
  // method for why a template binding cannot do this on a native select).
  #roleSelect = createRef<HTMLSelectElement>();

  /**
   * Reconcile the native role <select>'s live value to `selectedRole` after every render, once its
   * <option> children are in the DOM. A `.value` bound in the template commits BEFORE the options
   * exist, so a preset that is not the first option would fall back to the first (the latent picker
   * bug #73 fixed in the edit dialog). Today `selectedRole` starts at "staff" — the first option — so
   * a template binding renders right only by luck; setting `.value` here keeps the picker correct for
   * any preset. Setting `.value` imperatively does not trigger a reactive update, so this does not loop.
   *
   * The ref is normally live (the `<select>` renders unconditionally, unlike the edit dialog's, which is
   * gated on `person?`). The one case it is NOT: when the shell re-keys the staff screen around this form
   * to repaint it in a new language (`dashboard-app`'s `keyed(currentLocale(), …)`), a pending update can flush
   * on the OUTGOING element after Lit has cleared its refs on disconnect. So GUARD the access — no live
   * `<select>` means nothing to reconcile — rather than assert it: without the guard that flush throws an
   * unhandled `Cannot set properties of undefined` the pristine-output rule forbids.
   */
  override updated(): void {
    if (this.#roleSelect.value) this.#roleSelect.value.value = this.selectedRole;
  }

  /**
   * Capture the display-name field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` is what keeps it inside this form's shadow boundary rather than leaking to the
   * app shell — the house pattern the login screen's field handlers follow.
   */
  #onDisplayNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.displayName = event.detail.value;
  }

  /**
   * Capture the picked role. A native `<select>` `change` is `composed: false`, so it cannot cross
   * this form's shadow boundary anyway — the `stopPropagation` here is defensive consistency with the
   * composed `wt-change` handlers above, not a boundary guard.
   */
  #onRoleChange(event: Event): void {
    event.stopPropagation();
    this.selectedRole = (event.target as HTMLSelectElement).value as PersonRole;
  }

  /** Capture the PIN field's new value; stops the composed `wt-change` from leaking out. */
  #onPinChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.pin = event.detail.value;
  }

  /** Capture the email field's new value; stops the composed `wt-change` from leaking out. */
  #onEmailChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.email = event.detail.value;
  }

  /**
   * Ask the app to create the person. `stopPropagation` keeps the confirm button's own composed
   * `click` inside this shadow boundary, so the shell hears the semantic `create-person` and not a
   * raw click too — then dispatch it `bubbles`+`composed` so it reaches the shell.
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    // A blank OR whitespace-only email is OMITTED, never sent: an empty address is not "no email" to
    // the server — it fails `isValidEmail` as `person.email_invalid`. Trim first so "   " counts as
    // blank, and emit the trimmed value; the key is present only when a real address was typed.
    const detail: { displayName: string; role: PersonRole; pin: string; email?: string } = {
      displayName: this.displayName,
      role: this.selectedRole,
      pin: this.pin,
    };
    const email = this.email.trim();
    if (email !== "") detail.email = email;
    this.dispatchEvent(new CustomEvent("create-person", { detail, bubbles: true, composed: true }));
  }

  /**
   * The dialog closed. Drop our own `open` to stay self-consistent, and — unlike the field handlers
   * above — deliberately do NOT `stopPropagation`: the composed `wt-close` must bubble on to the staff
   * screen (the single owner of the open state) so its `formOpen` tracks the close and the form can be
   * reopened. See the class doc.
   *
   * Also RESET the fields so the next open starts blank. `#onClose` runs whenever the dialog actually
   * closes — a SUCCESSFUL create (the staff screen sets `.open=false`, and `wt-dialog` fires `wt-close`
   * on that programmatic close just as on a dismiss) or an Escape/backdrop dismiss — but NEVER on a
   * FAILED create, which keeps the dialog open so the operator retries with the values intact. Without
   * this, the previous person's name/role/PIN would linger into the next create — a duplicate-person /
   * reused-PIN hazard in an identity console.
   */
  #onClose(): void {
    this.open = false;
    this.displayName = "";
    this.selectedRole = "staff";
    this.pin = "";
    this.email = "";
  }

  override render() {
    return html`
      <wt-dialog
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
        heading=${t("person.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        ${
          this.error
            ? html`<p class="create-error" role="alert">${codeMessage(this.error)}</p>`
            : nothing
        }
        <wt-input
          class="field"
          data-test="display-name"
          label=${t("person.name")}
          .value=${this.displayName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onDisplayNameChange(e)}
        ></wt-input>
        <label class="field"
          >${t("person.role")}
          <select ${ref(this.#roleSelect)} @change=${(e: Event) => this.#onRoleChange(e)}>
            ${ROLES.map((role) => html`<option value=${role}>${roleName(role)}</option>`)}
          </select>
        </label>
        <wt-input
          class="field"
          data-test="pin"
          label=${t("person.pin")}
          .value=${this.pin}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPinChange(e)}
        ></wt-input>
        <!-- Dashboard sign-in credential (the PIN above is the till credential): the login email.
             Optional on create — a blank field is omitted from the emitted detail (see #confirm). -->
        <wt-input
          class="field"
          data-test="email"
          type="email"
          label=${t("person.email")}
          .value=${this.email}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onEmailChange(e)}
        ></wt-input>
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          @click=${(e: Event) => this.#confirm(e)}
          >${t("action.create")}</wt-button
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
