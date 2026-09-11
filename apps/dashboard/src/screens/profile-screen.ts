import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { toDataURL } from "qrcode";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

type Mode =
  | "view"
  | "details"
  | "password"
  | "pin"
  | "remove"
  | "totp"
  | "recovery"
  | "google"
  | "disable-totp"
  | "unlink-google"
  | "passkey"
  | "email"
  | "codes";
type Field =
  | "displayName"
  | "firstNames"
  | "lastNames"
  | "telephone"
  | "email"
  | "locale"
  | "currentPassword"
  | "password"
  | "confirmPassword"
  | "pin"
  | "confirmPin"
  | "totp"
  | "setupCode"
  | "passkeyName";
const emptyFields = (): Record<Field, string> => ({
  displayName: "",
  firstNames: "",
  lastNames: "",
  telephone: "",
  email: "",
  locale: "",
  currentPassword: "",
  password: "",
  confirmPassword: "",
  pin: "",
  confirmPin: "",
  totp: "",
  setupCode: "",
  passkeyName: "",
});

@customElement("dashboard-profile-screen")
export class ProfileScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .profile {
        max-width: 36rem;
        margin-inline: auto;
      }
      section {
        margin-block: var(--wt-space-6);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .passkey {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-3);
      }
      .hint,
      dt {
        color: var(--wt-color-text-muted);
      }
      dd {
        margin: 0 0 var(--wt-space-3);
        overflow-wrap: anywhere;
      }
      select {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        font: inherit;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      svg {
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }
      .authenticator-qr {
        display: block;
        width: min(15rem, 100%);
        height: auto;
        margin: var(--wt-space-4) auto;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.error = codeMessage(codeOf(error));
    },
  );
  @property({ attribute: false }) navigate: (url: string) => void = (url) =>
    window.location.assign(url);
  @state() private profile: OwnProfile | null = null;
  @state() private mode: Mode = "view";
  @state() private fields = emptyFields();
  @state() private errors: Partial<Record<Field, string>> = {};
  @state() private error = "";
  @state() private saved = false;
  @state() private busy = false;
  @state() private visible = new Set<Field>();
  @state() private locales: Array<{ code: string; label: string }> = [];
  private venueLocale = "";
  private removingId = "";
  @state() private totpSetup: { enrollmentId: string; secret: string; uri: string } | null = null;
  @state() private totpQr = "";
  @state() private recoveryCodes: string[] = [];
  @state() private googleConfigured = false;
  @state() private privacyNoticeUrl = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  async #load(): Promise<void> {
    try {
      await Promise.all([
        this.#queries.watch("getProfile", [], (value) => {
          this.profile = value;
        }),
        this.#queries.watch("getGoogleConfig", [], (value) => {
          this.googleConfigured = value.configured;
          this.privacyNoticeUrl = value.privacyNoticeUrl ?? "";
        }),
        this.api.getLocales().then((locales) => {
          if (!this.isConnected) return;
          this.locales = locales.locales;
          this.venueLocale = locales.venueDefault;
        }),
      ]);
    } catch (error) {
      this.error = codeMessage(codeOf(error));
    }
  }
  #edit(mode: Mode, id = ""): void {
    this.mode = mode;
    this.removingId = id;
    this.errors = {};
    this.error = "";
    this.saved = false;
    this.visible = new Set();
    this.totpSetup = null;
    this.totpQr = "";
    if (mode !== "codes") this.recoveryCodes = [];
    this.fields = {
      ...emptyFields(),
      displayName: this.profile!.displayName,
      firstNames: this.profile!.firstNames ?? "",
      lastNames: this.profile!.lastNames ?? "",
      telephone: this.profile!.telephone ?? "",
      email: this.profile!.email ?? "",
      locale: this.profile!.locale ?? this.venueLocale,
    };
  }
  private get needsCredentials(): boolean {
    return (
      this.mode === "password" ||
      this.mode === "pin" ||
      (this.mode === "totp" && this.totpSetup === null) ||
      this.mode === "recovery" ||
      this.mode === "google" ||
      this.mode === "disable-totp" ||
      this.mode === "unlink-google" ||
      this.mode === "passkey" ||
      this.mode === "remove" ||
      this.fields.email.trim().toLowerCase() !== this.profile?.email
    );
  }

  #changeLocale(event: Event): void {
    this.fields = { ...this.fields, locale: (event.target as HTMLSelectElement).value };
  }
  #input(
    field: Field,
    label: StringKey,
    type: "text" | "email" | "password" = "text",
    autocomplete = "",
    required = true,
  ): unknown {
    const revealed = this.visible.has(field);
    return html`<wt-input
      name=${field}
      label=${t(label)}
      ?required=${required}
      type=${type === "password" && revealed ? "text" : type}
      autocomplete=${autocomplete}
      .value=${this.fields[field]}
      error=${this.errors[field] ?? ""}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.fields = { ...this.fields, [field]: event.detail.value };
        this.errors = { ...this.errors, [field]: "" };
      }}
    >
      ${
        type === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              aria-label=${t(revealed ? "login.hide_password" : "login.show_password")}
              @click=${() => {
                const next = new Set(this.visible);
                if (revealed) next.delete(field);
                else next.add(field);
                this.visible = next;
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
                <circle cx="8" cy="8" r="2"></circle>
                ${revealed ? html`<path d="m2 2 12 12"></path>` : nothing}
              </svg>
            </wt-button>`
          : nothing
      }
    </wt-input>`;
  }
  async #save(): Promise<void> {
    if (this.busy) return;
    const f = this.fields;
    const errors: Partial<Record<Field, string>> = {};
    if (this.mode === "details") {
      if (!f.displayName.trim()) errors.displayName = t("form.name_required");
      if (!f.firstNames.trim()) errors.firstNames = t("form.first_names_required");
      if (!f.lastNames.trim()) errors.lastNames = t("form.last_names_required");
      if (!f.email.trim()) errors.email = t("form.email_required");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
        errors.email = codeMessage("person.email_invalid");
    }
    if (this.mode === "passkey" && f.passkeyName.trim().length > 80)
      errors.passkeyName = t("profile.passkey_name_too_long");
    if (this.needsCredentials) {
      if (!f.currentPassword) errors.currentPassword = t("form.password_required");
      if (this.profile!.hasTotp && !f.totp) errors.totp = t("profile.code_required");
    }
    if (this.mode === "password") {
      if (!f.password) errors.password = t("form.password_required");
      else if (f.password.length < 8) errors.password = codeMessage("password.too_short");
      if (!f.confirmPassword) errors.confirmPassword = t("form.confirm_password_required");
      else if (f.confirmPassword !== f.password)
        errors.confirmPassword = t("account.password_mismatch");
    }
    if (this.mode === "pin") {
      if (!f.pin) errors.pin = t("form.pin_required");
      else if (f.pin.length < 4) errors.pin = codeMessage("pin.too_short");
      if (!f.confirmPin) errors.confirmPin = t("form.pin_required");
      else if (f.confirmPin !== f.pin) errors.confirmPin = t("account.pin_mismatch");
    }
    if (
      ((this.mode === "totp" && this.totpSetup !== null) || this.mode === "email") &&
      !f.setupCode
    ) {
      errors.setupCode = t("profile.code_required");
    }
    this.errors = errors;
    this.error = "";
    if (Object.keys(errors).length) return;
    this.busy = true;
    const credentials = this.needsCredentials
      ? { currentPassword: f.currentPassword, ...(this.profile!.hasTotp ? { totp: f.totp } : {}) }
      : {};
    try {
      if (this.mode === "details")
        await this.api.saveProfile({
          displayName: f.displayName.trim(),
          firstNames: f.firstNames.trim(),
          lastNames: f.lastNames.trim(),
          telephone: f.telephone.trim() || null,
          email: f.email.trim(),
          locale: f.locale,
          ...credentials,
        });
      else if (this.mode === "password")
        await this.api.changePassword({ password: f.password, ...credentials });
      else if (this.mode === "pin") await this.api.changePin({ pin: f.pin, ...credentials });
      else if (this.mode === "remove") await this.api.removePasskey(this.removingId, credentials);
      else if (this.mode === "totp" && this.totpSetup === null) {
        const setup = await this.api.beginTotp(credentials);
        this.totpQr = await toDataURL(setup.uri, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 240,
        });
        this.totpSetup = setup;
        this.fields = { ...this.fields, currentPassword: "", totp: "" };
        return;
      } else if (this.mode === "totp") {
        const result = await this.api.finishTotp(this.totpSetup!.enrollmentId, f.setupCode);
        this.recoveryCodes = result.codes;
        this.mode = "codes";
        await this.#load();
        return;
      } else if (this.mode === "recovery") {
        const result = await this.api.regenerateRecoveryCodes(credentials);
        this.recoveryCodes = result.codes;
        this.mode = "codes";
        return;
      } else if (this.mode === "google") {
        const { authorizationUrl } = await this.api.beginGoogleLink(credentials);
        this.navigate(authorizationUrl);
        return;
      } else if (this.mode === "disable-totp") {
        await this.api.disableTotp(credentials);
      } else if (this.mode === "unlink-google") {
        await this.api.unlinkGoogle(credentials);
      } else if (this.mode === "passkey") {
        await this.#addPasskey(credentials);
      } else if (this.mode === "email") {
        await this.api.confirmProfileEmail(f.setupCode);
      }
      if (!this.isConnected) return;
      this.#edit("view");
      this.saved = true;
      await this.#load();
      this.dispatchEvent(new CustomEvent("profile-updated", { bubbles: true, composed: true }));
    } catch (error) {
      const code = codeOf(error);
      this.error = codeMessage(code);
      const field =
        code === "password.invalid"
          ? "currentPassword"
          : code === "totp.invalid"
            ? "totp"
            : code === "person.email_taken" || code === "person.email_invalid"
              ? "email"
              : code === "password.too_short"
                ? "password"
                : code === "pin.too_short"
                  ? "pin"
                  : undefined;
      if (field) this.errors = { [field]: this.error };
    } finally {
      this.busy = false;
    }
  }
  #downloadRecoveryCodes(): void {
    const blob = new Blob([`${this.recoveryCodes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "waitron-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }
  async #addPasskey(credentials: { currentPassword?: string; totp?: string }): Promise<void> {
    const { challengeHandle, options } = await this.api.passkeyRegisterOptions(credentials);
    const response = await startRegistration({
      optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    await this.api.passkeyRegisterVerify({
      challengeHandle,
      response,
      name: this.fields.passkeyName.trim(),
    });
  }
  override render() {
    const p = this.profile;
    return html`<div class="profile">
      <h1>${t("profile.title")}</h1>
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${[...new Set([...Object.values(this.errors), this.error].filter(Boolean))]}
      ></wt-form-error-summary>
      ${this.saved ? html`<p role="status">${t("profile.saved")}</p>` : nothing}
      ${
        p === null
          ? html`<wt-button @click=${() => void this.#load()}>${t("profile.reload")}</wt-button>`
          : this.mode === "view"
            ? html`
                <section>
                  <h2>${t("profile.details")}</h2>
                  <dl>
                    <dt>${t("profile.name")}</dt>
                    <dd>${p.displayName}</dd>
                    <dt>${t("person.first_names")}</dt>
                    <dd>${p.firstNames ?? "—"}</dd>
                    <dt>${t("person.last_names")}</dt>
                    <dd>${p.lastNames ?? "—"}</dd>
                    <dt>${t("person.telephone")}</dt>
                    <dd>
                      ${p.telephone ?? "—"} ${p.telephone ? t("profile.phone_unverified") : ""}
                    </dd>
                    <dt>${t("login.email")}</dt>
                    <dd>${p.email ?? "—"}</dd>
                    ${
                      p.pendingEmail === null
                        ? nothing
                        : html`<dt>${t("profile.pending_email")}</dt>
                            <dd>
                              ${p.pendingEmail}
                              <wt-button
                                data-test="confirm-email"
                                @click=${() => this.#edit("email")}
                                >${t("profile.confirm_email")}</wt-button
                              >
                            </dd>`
                    }
                    <dt>${t("profile.language")}</dt>
                    <dd>
                      ${this.locales.find((l) => l.code === (p.locale ?? this.venueLocale))?.label}
                    </dd>
                  </dl>
                  <wt-button
                    data-test="edit-details"
                    ?disabled=${this.busy}
                    @click=${() => this.#edit("details")}
                    >${t("action.edit")}</wt-button
                  >
                </section>
                <section>
                  <h2>${t("login.password")}</h2>
                  ${p.hasPassword ? html`<wt-button data-test="change-password" ?disabled=${this.busy} @click=${() => this.#edit("password")}>${t("profile.change_password")}</wt-button>` : html`<p>${t("profile.password_recovery")}</p>`}
                </section>
                <section>
                  <h2>${t("person.pin")}</h2>
                  <wt-button
                    data-test="change-pin"
                    ?disabled=${this.busy}
                    @click=${() => this.#edit("pin")}
                    >${t("profile.change_pin")}</wt-button
                  >
                </section>
                <section>
                  <h2>${t("profile.passkeys")}</h2>
                  ${
                    p.passkeys.length === 0
                      ? html`<p class="hint">${t("profile.no_passkeys")}</p>`
                      : p.passkeys.map(
                          (key, index) =>
                            html`<div class="passkey">
                              <span
                                >${key.name ?? t("profile.passkey_number").replace("{number}", String(index + 1))}
                                · ${new Date(key.createdAt).toLocaleDateString()}</span
                              >
                              ${p.hasPassword ? html`<wt-button data-test="remove-passkey" ?disabled=${this.busy} aria-label=${t("profile.remove_passkey_name").replace("{name}", key.name ?? t("profile.passkey_number").replace("{number}", String(index + 1)))} @click=${() => this.#edit("remove", key.id)}>${t("action.remove")}</wt-button>` : nothing}
                            </div>`,
                        )
                  }
                  <wt-button
                    data-test="add-passkey"
                    ?disabled=${this.busy}
                    @click=${() => this.#edit("passkey")}
                    >${t("staff.add_passkey")}</wt-button
                  >
                </section>
                <section>
                  <h2>${t("profile.authenticator")}</h2>
                  <p class="hint">
                    ${p.hasTotp ? t("profile.authenticator_enabled") : t("profile.authenticator_hint")}
                  </p>
                  ${
                    p.hasTotp
                      ? html`<wt-button
                            data-test="recovery-codes"
                            @click=${() => this.#edit("recovery")}
                            >${t("profile.replace_recovery_codes")}</wt-button
                          ><wt-button
                            data-test="disable-authenticator"
                            variant="danger"
                            @click=${() => this.#edit("disable-totp")}
                            >${t("profile.disable_authenticator")}</wt-button
                          >`
                      : html`<wt-button
                          data-test="setup-authenticator"
                          @click=${() => this.#edit("totp")}
                          >${t("profile.setup_authenticator")}</wt-button
                        >`
                  }
                </section>
                <section>
                  <h2>${t("profile.google_login")}</h2>
                  <p class="hint">
                    ${
                      p.hasGoogle
                        ? t("profile.google_linked")
                        : this.googleConfigured
                          ? t("profile.google_hint")
                          : t("profile.google_unavailable")
                    }
                  </p>
                  ${
                    p.hasGoogle
                      ? html`<wt-button
                          data-test="unlink-google"
                          variant="danger"
                          @click=${() => this.#edit("unlink-google")}
                          >${t("profile.unlink_google")}</wt-button
                        >`
                      : this.googleConfigured
                        ? html`<wt-button
                            data-test="setup-google"
                            ?disabled=${this.busy}
                            @click=${() => this.#edit("google")}
                            >${t("profile.setup_google")}</wt-button
                          >`
                        : nothing
                  }
                </section>
                ${
                  this.privacyNoticeUrl === ""
                    ? nothing
                    : html`<section>
                        <a
                          data-test="privacy-notice"
                          href=${this.privacyNoticeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          >${t("account.privacy_notice")}</a
                        >
                      </section>`
                }
              `
            : this.mode === "codes"
              ? html`<section>
                  <h2>${t("profile.recovery_codes")}</h2>
                  <p>${t("profile.recovery_codes_once")}</p>
                  <pre data-test="recovery-code-list">${this.recoveryCodes.join("\n")}</pre>
                  <wt-form-actions>
                    <wt-button slot="cancel" data-test="cancel" @click=${() => this.#edit("view")}
                      >${t("action.done")}</wt-button
                    >
                    <wt-button
                      variant="primary"
                      data-test="download-recovery-codes"
                      @click=${() => this.#downloadRecoveryCodes()}
                      >${t("action.download")}</wt-button
                    >
                  </wt-form-actions>
                </section>`
              : html`<section class="fields">
                  <h2>
                    ${t(this.mode === "details" ? "profile.details" : this.mode === "password" ? "profile.change_password" : this.mode === "pin" ? "profile.change_pin" : this.mode === "totp" ? "profile.setup_authenticator" : this.mode === "recovery" ? "profile.replace_recovery_codes" : this.mode === "google" ? "profile.google_login" : this.mode === "disable-totp" ? "profile.disable_authenticator" : this.mode === "unlink-google" ? "profile.unlink_google" : this.mode === "passkey" ? "staff.add_passkey" : this.mode === "email" ? "profile.confirm_email" : "profile.remove_passkey")}
                  </h2>
                  ${
                    this.mode === "details"
                      ? html`${this.#input("firstNames", "person.first_names", "text", "given-name")}${this.#input("lastNames", "person.last_names", "text", "family-name")}${this.#input("displayName", "profile.name", "text", "nickname")}${this.#input("email", "login.email", "email", "email")}${this.#input("telephone", "person.telephone", "text", "tel", false)}
                          <label
                            >${t("profile.language")} *<select
                              name="locale"
                              required
                              .value=${this.fields.locale}
                              @change=${(event: Event) => this.#changeLocale(event)}
                            >
                              ${this.locales.map((locale) => html`<option value=${locale.code} ?selected=${locale.code === this.fields.locale}>${locale.label}</option>`)}
                            </select></label
                          >`
                      : nothing
                  }
                  ${
                    this.needsCredentials
                      ? html`<p class="hint">${t("profile.confirm_identity")}</p>
                          ${this.#input("currentPassword", "profile.current_password", "password", "current-password")}${p.hasTotp ? this.#input("totp", "profile.totp", "text", "one-time-code") : nothing}`
                      : nothing
                  }
                  ${this.mode === "passkey" ? this.#input("passkeyName", "profile.passkey_name", "text", "off", false) : nothing}
                  ${this.mode === "password" ? html`${this.#input("password", "account.new_password", "password", "new-password")}${this.#input("confirmPassword", "account.confirm_password", "password", "new-password")}` : nothing}
                  ${this.mode === "pin" ? html`${this.#input("pin", "account.new_pin", "password", "off")}${this.#input("confirmPin", "account.confirm_pin", "password", "off")}` : nothing}
                  ${
                    this.mode === "email"
                      ? html`<p class="hint">${t("profile.email_code_hint")}</p>
                          ${this.#input("setupCode", "profile.email_code", "text", "one-time-code")}`
                      : nothing
                  }
                  ${
                    this.mode === "totp" && this.totpSetup !== null
                      ? html`
                          <p>${t("profile.authenticator_scan")}</p>
                          <img
                            class="authenticator-qr"
                            data-test="authenticator-qr"
                            src=${this.totpQr}
                            alt=${t("profile.authenticator_qr_alt")}
                          />
                          <details data-test="authenticator-key-fallback">
                            <summary>${t("profile.authenticator_cannot_scan")}</summary>
                            <p>
                              ${t("profile.authenticator_secret")}:
                              <code>${this.totpSetup.secret}</code>
                            </p>
                          </details>
                          ${this.#input("setupCode", "profile.totp", "text", "one-time-code")}
                        `
                      : nothing
                  }
                  <wt-form-actions
                    ><wt-button
                      slot="cancel"
                      data-test="cancel"
                      ?disabled=${this.busy}
                      @click=${() => this.#edit("view")}
                      >${t("action.cancel")}</wt-button
                    >
                    <wt-button
                      variant="primary"
                      data-test="save"
                      ?disabled=${this.busy}
                      @click=${() => void this.#save()}
                      >${t(this.mode === "remove" ? "action.remove" : "action.save")}</wt-button
                    >
                  </wt-form-actions>
                </section>`
      }
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-profile-screen": ProfileScreen;
  }
}
