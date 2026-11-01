import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
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
import { SetupApi, type AdoptBody, type PrimaryCertificate } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

export type ConnectField = "primaryUrl" | "personId" | "password" | "totp";
type ConnectForm = Record<ConnectField, string>;

/**
 * The address comes first and its certificate is compared before the login is asked for, so no
 * password is typed for a machine the person has not recognised.
 */
type Step = "address" | "compare" | "stopped" | "login";

const REQUIRED_FIELDS: Record<"address" | "login", readonly ConnectField[]> = {
  address: ["primaryUrl"],
  login: ["personId", "password"],
};

/** Only plain http needs no comparison, and the server allows it to this machine alone. */
const isPlainHttp = (url: string): boolean => /^http:/i.test(url.trim());

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
 * never goes from the browser to the primary. The certificate is read the same way, through
 * `/setup-api/primary-certificate`.
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
      .fingerprint-label {
        margin: var(--wt-space-4) 0 var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .fingerprint {
        margin: 0 0 var(--wt-space-4);
        font-family: var(--wt-font-family-mono);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) api: Pick<SetupApi, "primaryCertificate"> = new SetupApi();

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

  @state() private step: Step = "address";

  /** The certificate read for the address, shown on the compare step. */
  @state() private certificate?: PrimaryCertificate;

  /** Set once the person says the fingerprint matches; the adopt request then trusts only it. */
  @state() private confirmedCaPem?: string;

  @state() private reading = false;

  /** The certificate read's own refusal of the address, cleared when the address is edited. */
  @state() private addressRefused = false;

  @state() private readFailed = false;

  #readGeneration = 0;

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
      const { primaryUrl, credential, confirmedCaPem } = this.request;
      this.values = {
        primaryUrl,
        personId: credential.personId,
        password: credential.password,
        totp: "",
      };
      this.confirmedCaPem = confirmedCaPem;
      const checked = confirmedCaPem !== undefined || isPlainHttp(primaryUrl);
      this.#show(checked && this.invalidField !== "primaryUrl" ? "login" : "address");
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
    if (this.addressRefused) return "primaryUrl";
    return this.fieldRefusalDismissed ? undefined : this.invalidField;
  }

  #errors(): Set<ConnectField> {
    if (!this.attempted || (this.step !== "address" && this.step !== "login")) return new Set();
    return new Set(REQUIRED_FIELDS[this.step].filter((key) => this.values[key].trim() === ""));
  }

  #show(step: Step): void {
    this.step = step;
    this.attempted = false;
  }

  #onField(key: ConnectField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
    this.#scope?.changed();
    if (key === this.invalidField) this.fieldRefusalDismissed = true;
    if (key === "primaryUrl") {
      this.addressRefused = false;
      this.readFailed = false;
    }
  }

  /** Marks a blank required field of this step and moves focus to it; true when one was blank. */
  #blocked(): boolean {
    this.attempted = true;
    this.refusalDismissed = true;
    this.fieldRefusalDismissed = true;
    if (this.#errors().size === 0) return false;
    void this.updateComplete.then(() => {
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
    });
    return true;
  }

  async #continue(): Promise<void> {
    if (this.reading) return;
    this.addressRefused = false;
    this.readFailed = false;
    if (this.#blocked()) return;
    const generation = ++this.#readGeneration;
    this.reading = true;
    try {
      const certificate = await this.api.primaryCertificate(this.values.primaryUrl.trim());
      if (generation !== this.#readGeneration || !this.isConnected) return;
      this.certificate = certificate ?? undefined;
      this.confirmedCaPem = undefined;
      this.#show(certificate === null ? "login" : "compare");
    } catch (error) {
      if (generation !== this.#readGeneration || !this.isConnected) return;
      const { code, params } = (error ?? {}) as { code?: unknown; params?: { field?: unknown } };
      if (
        code === "mirror.primary_url_invalid" ||
        (code === "setup.request_invalid" && params?.field === "primaryUrl")
      ) {
        this.addressRefused = true;
        void this.updateComplete.then(() => {
          if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
        });
      } else {
        this.readFailed = true;
      }
    } finally {
      if (generation === this.#readGeneration) this.reading = false;
    }
  }

  #matches(): void {
    this.confirmedCaPem = this.certificate?.pem;
    this.certificate = undefined;
    this.#show("login");
  }

  #mismatch(): void {
    this.certificate = undefined;
    this.#show("stopped");
  }

  #connect(): void {
    if (this.#blocked()) return;

    const totp = this.values.totp.trim();
    // `password` is not trimmed: whitespace can be intentional in a secret.
    const body: AdoptBody = {
      primaryUrl: this.values.primaryUrl.trim(),
      credential: {
        personId: this.values.personId.trim(),
        password: this.values.password,
        ...(totp === "" ? {} : { totp }),
      },
      ...(this.confirmedCaPem === undefined ? {} : { confirmedCaPem: this.confirmedCaPem }),
    };
    dispatchAdoptRequested(this, body);
  }

  #back(): void {
    dispatchSetupGoto(this, "role");
  }

  #field(key: ConnectField, invalid: boolean, type = "text"): TemplateResult {
    const text = FIELD_TEXT[key];
    const readonly = key === "primaryUrl" && this.step !== "address";
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) =>
        submitOnEnter(
          e,
          this.shadowRoot!.querySelector<HTMLElement>(
            this.step === "address" ? "[data-test=continue]" : "[data-test=connect]",
          ),
        )}
      class="field"
      ?readonly=${readonly}
      label=${t(text.label)}
      name=${key}
      autocomplete=${key === "password" ? "current-password" : key === "personId" ? "username" : key === "totp" ? "one-time-code" : "off"}
      ?required=${key !== "totp" && !readonly}
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

  #actions(blocked: boolean): TemplateResult {
    switch (this.step) {
      case "address":
        return html`<wt-button
          variant="primary"
          data-test="continue"
          ?disabled=${blocked}
          .loading=${this.reading}
          @click=${() => void this.#continue()}
          >${t("connect.continue")}</wt-button
        >`;
      case "compare":
        return html`<wt-button
            variant="secondary"
            slot="secondary"
            data-test="mismatch"
            @click=${() => this.#mismatch()}
            >${t("connect.compare.mismatch")}</wt-button
          ><wt-button variant="primary" data-test="matches" @click=${() => this.#matches()}
            >${t("connect.compare.matches")}</wt-button
          >`;
      case "stopped":
        return html`<wt-button
          variant="primary"
          data-test="check-address"
          @click=${() => this.#show("address")}
          >${t("connect.check_address")}</wt-button
        >`;
      case "login":
        return html`<wt-button
          variant="primary"
          data-test="connect"
          ?disabled=${blocked}
          @click=${() => this.#connect()}
          >${t("connect.connect")}</wt-button
        >`;
    }
  }

  #body(
    field: (key: ConnectField, type?: string) => TemplateResult,
  ): TemplateResult | typeof nothing {
    switch (this.step) {
      case "address":
        return nothing;
      case "compare":
        return html`<p data-test="compare">${t("connect.compare.intro")}</p>
          <p class="fingerprint-label">${t("connect.compare.label")}</p>
          <p class="fingerprint" data-test="fingerprint">${this.certificate?.fingerprint256}</p>`;
      case "stopped":
        return html`<p role="alert" data-test="stopped">${t("connect.stopped")}</p>`;
      case "login":
        return html`${field("personId")} ${field("password", "password")} ${field("totp")}`;
    }
  }

  override render(): TemplateResult {
    const errors = this.#errors();
    const refused = this.#refusedField();
    const field = (key: ConnectField, type?: string) =>
      this.#field(key, errors.has(key) || refused === key, type);
    const bottom = [
      ...(this.errorMessage === undefined || this.refusalDismissed ? [] : [this.errorMessage]),
      ...(this.readFailed ? [t("connect.certificate_failed")] : []),
      ...(errors.size > 0 || refused !== undefined ? [t("connect.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("connect.heading")}</h1>
      ${this.step === "address" ? html`<p>${t("connect.intro")}</p>` : nothing}
      ${field("primaryUrl", "url")} ${this.#body(field)}
      <wt-form-actions .error=${bottom}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("connect.back")}</wt-button
        >
        ${this.#actions(errors.size > 0)}
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connect-screen": SetupConnectScreen;
  }
}
