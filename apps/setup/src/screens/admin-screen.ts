import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

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
  @state() private visible = new Set<AdminField>();
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
    const fieldPurpose = {
      displayName: { name: "name", autocomplete: "name" },
      email: { name: "email", autocomplete: "username" },
      password: { name: "new-password", autocomplete: "new-password" },
      pin: { name: "pin", autocomplete: "off" },
    }[key];
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
      class="field"
      label=${label}
      data-test=${key}
      name=${fieldPurpose.name}
      autocomplete=${fieldPurpose.autocomplete}
      type=${this.visible.has(key) ? "text" : type}
      required
      error=${this.invalid.has(key) ? `Enter your ${label.toLowerCase()}.` : ""}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
    >
      <wt-help-tooltip slot="help" aria-label=${`Help with ${label.toLowerCase()}`}>
        ${{ displayName: "Use the name your colleagues will see in Waitron.", email: "Use your email to sign in to the dashboard and recover your account.", password: "Choose a password for signing in to the dashboard.", pin: "Choose a numeric PIN for quick sign-in at the till." }[key]}
      </wt-help-tooltip>
      ${
        type === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              data-test=${`toggle-${key}`}
              aria-label=${`${this.visible.has(key) ? "Hide" : "Show"} ${key === "pin" ? "PIN" : "password"}`}
              @click=${() => {
                const visible = new Set(this.visible);
                if (visible.has(key)) visible.delete(key);
                else visible.add(key);
                this.visible = visible;
              }}
              >${passwordIcon(this.visible.has(key))}</wt-button
            >`
          : nothing
      }
    </wt-input>`;
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
            ? html`<wt-form-error-summary
                data-test="error"
                heading="There is a problem with this form"
                .errors=${[...this.invalid].map((key) => `Enter your ${{ displayName: "display name", email: "email", password: "password", pin: "PIN" }[key]}.`)}
              ></wt-form-error-summary>`
            : nothing
        }
        <wt-form-actions>
          <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
            >Back</wt-button
          >
          <wt-button variant="primary" data-test="next" @click=${() => this.#next()}
            >Next</wt-button
          >
        </wt-form-actions>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-admin-screen": SetupAdminScreen;
  }
}
