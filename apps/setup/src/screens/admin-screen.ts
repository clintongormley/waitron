import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import { deriveDisplayName } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { ProvisionBody } from "../api/client.js";

type AdminField = "firstNames" | "lastNames" | "displayName" | "email" | "password" | "pin";

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

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  @state() private values: Record<AdminField, string> = {
    firstNames: "",
    lastNames: "",
    displayName: "",
    email: "",
    password: "",
    pin: "",
  };
  @state() private visible = new Set<AdminField>();
  @state() private invalid = new Set<AdminField>();

  @state() private showError = false;

  #seeded = false;

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
  }

  #seedFromDraft(): void {
    const admin = this.draft.venue?.admin ?? {};
    this.values = {
      firstNames: admin.firstNames ?? this.values.firstNames,
      lastNames: admin.lastNames ?? this.values.lastNames,
      displayName: admin.displayName ?? this.values.displayName,
      email: admin.email ?? this.values.email,
      password: admin.password ?? this.values.password,
      pin: admin.pin ?? this.values.pin,
    };
  }

  #onField(key: AdminField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const prev = this.values;
    const values = { ...prev, [key]: event.detail.value };
    if (key === "firstNames" || key === "lastNames") {
      values.displayName = deriveDisplayName(
        prev.displayName,
        prev.firstNames,
        prev.lastNames,
        values.firstNames,
        values.lastNames,
      );
    }
    this.values = values;
  }

  #next(): void {
    const invalid = new Set<AdminField>();
    for (const key of [
      "firstNames",
      "lastNames",
      "displayName",
      "email",
      "password",
      "pin",
    ] as const) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;
    dispatchSetupPatch(this, {
      venue: {
        admin: {
          firstNames: this.values.firstNames,
          lastNames: this.values.lastNames,
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

  #field(label: string, key: AdminField, type = "text"): TemplateResult {
    const fieldPurpose = {
      firstNames: { name: "given-name", autocomplete: "given-name" },
      lastNames: { name: "family-name", autocomplete: "family-name" },
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
        ${{ firstNames: "Your first name, or names, as they appear on your ID.", lastNames: "Your surname, or surnames, as they appear on your ID.", displayName: "Use the name your colleagues will see in Waitron.", email: "Use your email to sign in to the dashboard and recover your account.", password: "Choose a password for signing in to the dashboard.", pin: "Choose a numeric PIN for quick sign-in at the till." }[key]}
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
      <h1>Your account</h1>
      <p>Create the account that manages this server. You can add more people later.</p>
      ${this.#field("First name(s)", "firstNames")} ${this.#field("Last name(s)", "lastNames")}
      ${this.#field("Display name", "displayName")} ${this.#field("Email", "email", "email")}
      ${this.#field("Password", "password", "password")} ${this.#field("PIN", "pin", "password")}
      ${
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${[...this.invalid].map((key) => `Enter your ${{ firstNames: "first name", lastNames: "last name", displayName: "display name", email: "email", password: "password", pin: "PIN" }[key]}.`)}
            ></wt-form-error-summary>`
          : nothing
      }
      <wt-form-actions>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="next" @click=${() => this.#next()}>Next</wt-button>
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-admin-screen": SetupAdminScreen;
  }
}
