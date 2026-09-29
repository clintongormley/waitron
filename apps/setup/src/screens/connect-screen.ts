import { LitElement, type PropertyValues, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, fieldStyles } from "../form-styles.js";
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
  helpLabel: StringKey;
  help: StringKey;
}

const FIELD_TEXT: Record<ConnectField, FieldText> = {
  primaryUrl: {
    label: "connect.primary_url.label",
    error: "connect.primary_url.error",
    helpLabel: "connect.primary_url.help_label",
    help: "connect.primary_url.help",
  },
  personId: {
    label: "connect.person_id.label",
    error: "connect.person_id.error",
    helpLabel: "connect.person_id.help_label",
    help: "connect.person_id.help",
  },
  password: {
    label: "connect.password.label",
    error: "connect.password.error",
    helpLabel: "connect.password.help_label",
    help: "connect.password.help",
  },
  totp: {
    label: "connect.totp.label",
    error: "connect.totp.error",
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
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  /** An adopt failure the shell routed back here. It names no field, so it never disables Connect. */
  @property() errorMessage?: string;

  @state() private values: Record<ConnectField, string> = {
    primaryUrl: "",
    personId: "",
    password: "",
    totp: "",
  };

  @state() private attempted = false;

  /** Set when Connect is pressed after `errorMessage` arrived; the message is then not shown. */
  @state() private refusalDismissed = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage")) this.refusalDismissed = false;
  }

  #errors(): Set<ConnectField> {
    if (!this.attempted) return new Set();
    return new Set(REQUIRED_FIELDS.filter((key) => this.values[key].trim() === ""));
  }

  #onField(key: ConnectField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  #connect(): void {
    this.attempted = true;
    this.refusalDismissed = true;
    if (this.#errors().size > 0) {
      void this.updateComplete.then(() => {
        if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
      });
      return;
    }

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

  #field(key: ConnectField, invalid: boolean, type = "text"): TemplateResult {
    const text = FIELD_TEXT[key];
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]"))}
      class="field"
      label=${t(text.label)}
      name=${key}
      autocomplete=${key === "password" ? "current-password" : key === "personId" ? "username" : key === "totp" ? "one-time-code" : "off"}
      ?required=${key !== "totp"}
      error=${invalid ? t(text.error) : ""}
      data-test=${key}
      type=${type}
      ?invalid=${invalid}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      ><wt-help-tooltip slot="help" aria-label=${t(text.helpLabel)}
        >${t(text.help)}</wt-help-tooltip
      ></wt-input
    >`;
  }

  override render(): TemplateResult {
    const errors = this.#errors();
    const field = (key: ConnectField, type?: string) => this.#field(key, errors.has(key), type);
    const bottom = [
      ...(this.errorMessage === undefined || this.refusalDismissed ? [] : [this.errorMessage]),
      ...(errors.size > 0 ? [t("connect.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("connect.heading")}</h1>
      <p>${t("connect.intro")}</p>
      ${field("primaryUrl", "url")} ${field("personId")} ${field("password", "password")}
      ${field("totp")}
      <wt-form-actions .error=${bottom}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("connect.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="connect"
          ?disabled=${errors.size > 0}
          @click=${() => this.#connect()}
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
