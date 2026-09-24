import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchAdoptRequested, dispatchSetupGoto } from "../events.js";
import type { AdoptBody } from "../api/client.js";

type ConnectField = "primaryUrl" | "personId" | "password" | "totp";

const REQUIRED_FIELDS: readonly ConnectField[] = ["primaryUrl", "personId", "password"];

/**
 * The mirror path's connect step. It posts to this box's OWN `/setup-api/adopt`, which fetches the
 * primary's bundle server-side (`fetchBundle`, `apps/server/src/adopt.ts`), so the admin credential
 * never goes from the browser to the primary.
 */
@customElement("setup-connect-screen")
export class SetupConnectScreen extends LitElement {
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

  /** An adopt failure the shell routed back here. */
  @property() errorMessage?: string;

  @state() private values: Record<ConnectField, string> = {
    primaryUrl: "",
    personId: "",
    password: "",
    totp: "",
  };

  @state() private invalid = new Set<ConnectField>();

  @state() private showError = false;

  #onField(key: ConnectField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  #connect(): void {
    const invalid = new Set<ConnectField>();
    for (const key of REQUIRED_FIELDS) {
      if (this.values[key].trim() === "") invalid.add(key);
    }
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;

    const totp = this.values.totp.trim();
    // `password` is not trimmed: whitespace can be intentional in a secret.
    const body: AdoptBody = {
      primaryUrl: this.values.primaryUrl.trim(),
      credential: {
        personId: this.values.personId.trim(),
        password: this.values.password,
        ...(totp === "" ? {} : { totp }),
      },
    };
    dispatchAdoptRequested(this, body);
  }

  #back(): void {
    dispatchSetupGoto(this, "role");
  }

  #field(label: string, key: ConnectField, type = "text"): TemplateResult {
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]"))}
      class="field"
      label=${label}
      name=${key}
      autocomplete=${key === "password" ? "current-password" : key === "personId" ? "username" : key === "totp" ? "one-time-code" : "off"}
      ?required=${key !== "totp"}
      error=${this.invalid.has(key) ? `Check the ${label.toLowerCase()}.` : ""}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      ><wt-help-tooltip slot="help" aria-label=${`Help with ${label.toLowerCase()}`}
        >${
          {
            primaryUrl:
              "Enter the full HTTPS address of the primary server this server would join.",
            personId: "Enter an admin's person ID from the primary server.",
            password: "Enter that admin's dashboard password on the primary server.",
            totp: "If this admin uses an authenticator, enter its current one-time code.",
          }[key]
        }</wt-help-tooltip
      ></wt-input
    >`;
  }

  override render(): TemplateResult {
    return html`
      <h1>Connect to the primary</h1>
      <p>
        Point this server at the restaurant's primary and sign in with an admin login for it. This
        does not work in this version: the server signs in and restarts, then stops part-way through
        joining, and it will not get any further however many times you restart it. It ends up
        holding none of the restaurant's information, with no dashboard and no till, and it cannot
        sell or file anything. This setup wizard does not open on this server again afterwards.
      </p>
      ${this.#field("Primary server address", "primaryUrl", "url")}
      ${this.#field("Admin login (person ID)", "personId")}
      ${this.#field("Admin password", "password", "password")}
      ${this.#field("Authenticator code (if required)", "totp")}
      ${
        // One alert region: two `role="alert"` nodes double-announce to a screen reader. The
        // client-validation banner wins over a stale server-routed message.
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${[...this.invalid].map((key) => `Check the ${{ primaryUrl: "primary server address", personId: "admin person ID", password: "admin password", totp: "authenticator code" }[key]}.`)}
            ></wt-form-error-summary>`
          : this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <wt-form-actions>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="connect" @click=${() => this.#connect()}
          >Connect</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connect-screen": SetupConnectScreen;
  }
}
