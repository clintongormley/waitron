import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

/**
 * The wizard's second step: the first operator's credentials — a display name, a login email, a login
 * password, and a numeric PIN. All four are required (the email is the admin's dashboard-login
 * credential); the server hashes `pin`/`password` at the boundary (`apps/server/src/setup-api.ts`), so
 * they travel plaintext and the wizard never hashes.
 *
 * On `Next` it client-validates that none is blank — a blank one shows a `role="alert"` banner and
 * marks the offending field(s) `invalid`, and nothing is emitted — then emits the admin slice as a
 * `setup-patch` and navigates to `venue`. `Back` returns to `mode`. Both nav events are the composed/
 * bubbling pair the shell listens for. Following `apps/dashboard/src/screens/login-screen.ts` for the
 * field/`wt-change`/error idiom.
 *
 * The form seeds its local state from the shell's `draft` ONCE on mount, so stepping `venue`→Back→
 * `admin`→forward restores the operator's typed credentials rather than blanking them (the shell
 * reassigns `draft` on every merge, so the seed must be guarded to the first update). Mirrors the
 * `#seeded`/`#seedFromDraft` idiom in `apps/setup/src/screens/venue-screen.ts`.
 */

/** The four credential fields, each a `wt-input`. */
type AdminField = "displayName" | "email" | "password" | "pin";

@customElement("setup-admin-screen")
export class SetupAdminScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** The accumulated draft, passed down from the shell. Read ONCE on mount to seed the local fields. */
  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  /** The editable credential fields. Seeding overlays whatever the draft already holds. */
  @state() private values: Record<AdminField, string> = {
    displayName: "",
    email: "",
    password: "",
    pin: "",
  };
  @state() private invalid = new Set<AdminField>();

  /** True once a `Next` with a blank field has been rejected — drives the `role="alert"` banner. */
  @state() private showError = false;

  /** Guards {@link SetupAdminScreen.#seedFromDraft} to run only on the first update. */
  #seeded = false;

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
  }

  /**
   * Overlay whatever admin credentials the shell's draft already holds onto the local field state, so
   * Back-then-forward restores every value the operator entered. `??` keeps the local default ("") when
   * a field is absent.
   */
  #seedFromDraft(): void {
    const admin = this.draft.venue?.admin ?? {};
    this.values = {
      displayName: admin.displayName ?? this.values.displayName,
      email: admin.email ?? this.values.email,
      password: admin.password ?? this.values.password,
      pin: admin.pin ?? this.values.pin,
    };
  }

  #onField(key: AdminField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  /**
   * Validate non-empty, then emit. A blank field blocks the emit, shows the banner, and marks the
   * blank field(s) `invalid`; the guard is proven by deletion (drop the `invalid.size` check and a
   * "blank fields do not advance" test flips red).
   */
  #next(): void {
    const invalid = new Set<AdminField>();
    if (this.values.displayName.trim() === "") invalid.add("displayName");
    if (this.values.email.trim() === "") invalid.add("email");
    if (this.values.password.trim() === "") invalid.add("password");
    if (this.values.pin.trim() === "") invalid.add("pin");
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;
    dispatchSetupPatch(this, {
      venue: {
        admin: {
          displayName: this.values.displayName,
          email: this.values.email,
          pin: this.values.pin,
          password: this.values.password,
        },
      },
    });
    dispatchSetupGoto(this, "venue");
  }

  #back(): void {
    dispatchSetupGoto(this, "mode");
  }

  /** Renders one credential field as a `wt-input`, bound to `this.values[key]` and its `invalid` state. */
  #field(label: string, key: AdminField, type = "text"): TemplateResult {
    return html`<wt-input
      class="field"
      label=${label}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    ></wt-input>`;
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>The first operator</h1>
        <p>Create the account that manages this box. You can add more people later.</p>
        ${this.#field("Display name", "displayName")} ${this.#field("Email", "email", "email")}
        ${this.#field("Password", "password", "password")} ${this.#field("PIN", "pin", "password")}
        ${
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Enter a display name, email, password and PIN for the first operator.
              </p>`
            : nothing
        }
        <div class="actions">
          <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
          <wt-button variant="primary" data-test="next" @click=${() => this.#next()}
            >Next</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-admin-screen": SetupAdminScreen;
  }
}
