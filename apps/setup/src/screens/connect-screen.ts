import { LitElement, type PropertyValues, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  focusFirstInvalid,
  submitOnEnter,
  baseStyles,
  leaveCoordinatorFor,
  type DraftScope,
} from "@waitron/ui";
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

export type ConnectField = "primaryUrl" | "personId" | "password" | "totp";
type ConnectForm = Record<ConnectField, string>;

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

  /** An adopt failure the shell routed back here that names no field this form shows. */
  @property() errorMessage?: string;

  /** A field the shell found an adopt refusal to be about. It never disables Connect. */
  @property() invalidField?: ConnectField;

  /**
   * The body the shell last sent, returned with a refusal so the operator's entries are kept — all
   * but the one-time code, left empty by owner decision (C87, 2026-09-30).
   */
  @property({ attribute: false }) request?: AdoptBody;

  @state() private values: ConnectForm = {
    primaryUrl: "",
    personId: "",
    password: "",
    totp: "",
  };

  @state() private attempted = false;

  /** Set when Connect is pressed after `errorMessage` arrived; the message is then not shown. */
  @state() private refusalDismissed = false;

  @state() private fieldRefusalDismissed = false;

  #baseline?: ConnectForm;
  #scope?: DraftScope<ConnectForm>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #registerScope(): void {
    if (!this.isConnected || !this.#baseline || this.#scope) return;
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => this.values,
      snapshot: (form) => ({ ...form }),
      equal: (a, b) =>
        a.primaryUrl.trim() === b.primaryUrl.trim() &&
        a.personId.trim() === b.personId.trim() &&
        a.password === b.password &&
        a.totp.trim() === b.totp.trim(),
      restore: (form) => {
        this.values = { ...form };
        this.attempted = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // A returned request is a refused submission, not a saved baseline.
    this.#baseline ??= { ...this.values };
    if (changed.has("errorMessage")) this.refusalDismissed = false;
    if (changed.has("invalidField")) this.fieldRefusalDismissed = false;
    if (changed.has("request") && this.request !== undefined) {
      const { primaryUrl, credential } = this.request;
      this.values = {
        primaryUrl,
        personId: credential.personId,
        password: credential.password,
        totp: "",
      };
      this.#scope?.changed();
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    this.#registerScope();
    if (changed.has("invalidField") && this.#refusedField() !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  #refusedField(): ConnectField | undefined {
    return this.fieldRefusalDismissed ? undefined : this.invalidField;
  }

  #errors(): Set<ConnectField> {
    if (!this.attempted) return new Set();
    return new Set(REQUIRED_FIELDS.filter((key) => this.values[key].trim() === ""));
  }

  #onField(key: ConnectField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
    this.#scope?.changed();
    if (key === this.invalidField) this.fieldRefusalDismissed = true;
  }

  #connect(): void {
    this.attempted = true;
    this.refusalDismissed = true;
    this.fieldRefusalDismissed = true;
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
    const refused = this.#refusedField();
    const field = (key: ConnectField, type?: string) =>
      this.#field(key, errors.has(key) || refused === key, type);
    const bottom = [
      ...(this.errorMessage === undefined || this.refusalDismissed ? [] : [this.errorMessage]),
      ...(errors.size > 0 || refused !== undefined ? [t("connect.fix_fields")] : []),
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
