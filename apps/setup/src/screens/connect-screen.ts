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
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

type ConnectField = "primaryUrl" | "personId" | "password" | "totp";

const REQUIRED_FIELDS: readonly ConnectField[] = ["primaryUrl", "personId", "password"];

interface FieldText {
  label: StringKey;
  error: StringKey;
  summary: StringKey;
  helpLabel: StringKey;
  help: StringKey;
}

const FIELD_TEXT: Record<ConnectField, FieldText> = {
  primaryUrl: {
    label: "connect.primary_url.label",
    error: "connect.primary_url.error",
    summary: "connect.primary_url.error",
    helpLabel: "connect.primary_url.help_label",
    help: "connect.primary_url.help",
  },
  personId: {
    label: "connect.person_id.label",
    error: "connect.person_id.error",
    summary: "connect.person_id.summary",
    helpLabel: "connect.person_id.help_label",
    help: "connect.person_id.help",
  },
  password: {
    label: "connect.password.label",
    error: "connect.password.error",
    summary: "connect.password.error",
    helpLabel: "connect.password.help_label",
    help: "connect.password.help",
  },
  totp: {
    label: "connect.totp.label",
    error: "connect.totp.error",
    summary: "connect.totp.summary",
    helpLabel: "connect.totp.help_label",
    help: "connect.totp.help",
  },
};

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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

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

  #field(key: ConnectField, type = "text"): TemplateResult {
    const text = FIELD_TEXT[key];
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]"))}
      class="field"
      label=${t(text.label)}
      name=${key}
      autocomplete=${key === "password" ? "current-password" : key === "personId" ? "username" : key === "totp" ? "one-time-code" : "off"}
      ?required=${key !== "totp"}
      error=${this.invalid.has(key) ? t(text.error) : ""}
      data-test=${key}
      type=${type}
      ?invalid=${this.invalid.has(key)}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      ><wt-help-tooltip slot="help" aria-label=${t(text.helpLabel)}
        >${t(text.help)}</wt-help-tooltip
      ></wt-input
    >`;
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("connect.heading")}</h1>
      <p>${t("connect.intro")}</p>
      ${this.#field("primaryUrl", "url")} ${this.#field("personId")}
      ${this.#field("password", "password")} ${this.#field("totp")}
      ${
        // One alert region: two `role="alert"` nodes double-announce to a screen reader. The
        // client-validation banner wins over a stale server-routed message.
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading=${t("connect.error_heading")}
              .errors=${[...this.invalid].map((key) => t(FIELD_TEXT[key].summary))}
            ></wt-form-error-summary>`
          : this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <wt-form-actions>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("connect.back")}</wt-button
        >
        <wt-button variant="primary" data-test="connect" @click=${() => this.#connect()}
          >${t("connect.connect")}</wt-button
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
