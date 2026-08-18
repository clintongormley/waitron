import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { roleName } from "../i18n/domain.js";
import type { PersonRole } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/** The role options the create form offers, in the slice-1b staff API's own order. */
const ROLES: readonly PersonRole[] = ["staff", "supervisor", "manager", "admin"];

/**
 * The management dashboard's CREATE-PERSON form: a `wt-dialog` (heading "Nuevo usuario") holding a
 * display-name field (`wt-input`), a role picker (native `<select>` — there is no `wt-select`
 * primitive, exactly as the login screen's roster picker) and a PIN field (`wt-input`), plus a
 * primary confirm control in the footer.
 *
 * The staff screen drives it by setting `.open` — the same open-by-property contract `wt-dialog`
 * itself uses — and hears one event: on confirm the form dispatches `create-person` carrying
 * `{ displayName, role, pin }`, `bubbles`/`composed` so it crosses the shadow boundary to the staff
 * screen, which turns it into `DashboardApi.createPerson`. The form does NOT call the API itself
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
  }

  override render() {
    return html`
      <wt-dialog heading=${t("person.new")} .open=${this.open} @wt-close=${() => this.#onClose()}>
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
          <select .value=${this.selectedRole} @change=${(e: Event) => this.#onRoleChange(e)}>
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
