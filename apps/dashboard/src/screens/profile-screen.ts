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
import "@waitron/ui/src/components/wt-card.js";
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
      section {
        margin-block: var(--wt-space-6);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .group {
        margin-bottom: var(--wt-space-5);
      }
      .group-label {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--wt-color-text-muted);
      }
      .button-group {
        display: flex;
        gap: var(--wt-space-2);
      }
      /* Each passkey is a member of the "Passkeys" row above it, not a setting in its own right —
         inset and in the muted/normal-weight voice (vs. the bold field-value every other row here
         uses) so the list reads as subordinate detail, one line per key. */
      .passkey-item {
        padding-left: var(--wt-space-5);
      }
      .passkey-text {
        font-weight: var(--wt-font-weight-normal);
        color: var(--wt-color-text-muted);
      }
      .row,
      .action-row {
        padding-block: var(--wt-space-3);
      }
      .action-row:not(:first-child) {
        border-top: 1px solid var(--wt-color-border);
      }
      /* Between individual keys the divider is inset to align with .passkey-item's own indent
         (a plain border-top would span the full row, edge to edge, like every other divider in
         this card) — a pseudo-element rather than padding/margin so the row itself stays full
         width for its flex layout and the right-aligned Remove button. */
      .passkey-item + .passkey-item {
        position: relative;
        border-top: none;
      }
      .passkey-item + .passkey-item::before {
        content: "";
        position: absolute;
        top: 0;
        left: var(--wt-space-5);
        right: 0;
        border-top: 1px solid var(--wt-color-border);
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .action-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-4);
      }
      .action-row .text {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      .field-label {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .field-value {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .field-meta {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        color: var(--wt-color-text-muted);
      }
      .card-footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--wt-space-2);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }
      /* A card action stays visually calm (the shared secondary look) until you interact with it —
         width-driven, so ch is the right unit (same reasoning as dashboard-app.ts's own
         --dashboard-sidebar-width). 12ch comfortably clears "Disable"/"Replace"/"Confirm", the
         longest labels here, so EVERY action clamps to the same width regardless of its own text —
         8ch used to just barely fit the longest ones, so they still set their own (wider) width
         instead of sharing one. The colour appears only via wt-button's exposed button part on
         hover, never at rest, so a row of these reads as one calm, evenly-sized set of actions. */
      .card-action {
        min-width: 12ch;
      }
      .card-action.accent-primary::part(button):hover {
        border-color: var(--wt-color-primary);
        color: var(--wt-color-primary);
      }
      .card-action.accent-danger::part(button):hover {
        border-color: var(--wt-color-danger);
        color: var(--wt-color-danger);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
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
  #initialDetailsChecked = false;

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
      if (!this.#initialDetailsChecked && this.profile !== null && this.isConnected) {
        this.#initialDetailsChecked = true;
        if (
          this.mode === "view" &&
          [
            this.profile.displayName,
            this.profile.firstNames,
            this.profile.lastNames,
            this.profile.email,
          ].some((value) => !value?.trim())
        ) {
          this.#edit("details");
          this.errors = this.#detailsErrors();
        }
      }
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
  // A native <dialog>'s "close" event lands asynchronously relative to the property change that
  // triggers it — Cancel or a successful Save call #closeModal() here, which sets this flag before
  // switching back to view; if a NEW #edit() (opening a different mode) runs before that pending
  // "close" event actually arrives, the flag — not any timing assumption — is what tells the
  // @wt-close handler this specific close was already applied, so it must not stomp the newer mode.
  // Reproduced by tracing #edit() call order under real load: "remove" mode was correctly entered,
  // then a delayed close from the PRIOR "save and return to view" reset it straight back to "view".
  #closingModal = false;
  #closeModal(): void {
    this.#closingModal = true;
    this.#edit("view");
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
  #detailsErrors(): Partial<Record<Field, string>> {
    const f = this.fields;
    const errors: Partial<Record<Field, string>> = {};
    if (!f.displayName.trim()) errors.displayName = t("form.name_required");
    if (!f.firstNames.trim()) errors.firstNames = t("form.first_names_required");
    if (!f.lastNames.trim()) errors.lastNames = t("form.last_names_required");
    if (!f.email.trim()) errors.email = t("form.email_required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
      errors.email = codeMessage("person.email_invalid");
    return errors;
  }

  async #save(): Promise<void> {
    if (this.busy) return;
    const f = this.fields;
    const errors: Partial<Record<Field, string>> = {};
    if (this.mode === "details") Object.assign(errors, this.#detailsErrors());

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
      this.#closeModal();
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
  #modalHeading(): string {
    switch (this.mode) {
      case "view":
        return "";
      case "codes":
        return t("profile.recovery_codes");
      case "details":
        return t("profile.details");
      case "password":
        return t("profile.change_password");
      case "pin":
        return t("profile.change_pin");
      case "totp":
        return t("profile.setup_authenticator");
      case "recovery":
        return t("profile.replace_recovery_codes");
      case "google":
        return t("profile.google_login");
      case "disable-totp":
        return t("profile.disable_authenticator");
      case "unlink-google":
        return t("profile.unlink_google");
      case "passkey":
        return t("staff.add_passkey");
      case "email":
        return t("profile.confirm_email");
      case "remove":
        return t("profile.remove_passkey");
    }
  }
  #renderDetails(p: OwnProfile) {
    return html`
      <div class="group">
        <h2 class="group-label">${t("profile.details")}</h2>
        <wt-card raised>
          <div class="row">
            <span class="field-label">${t("profile.name")}</span>
            <span class="field-value">${p.displayName}</span>
          </div>
          <div class="row">
            <span class="field-label">${t("person.first_names")}</span>
            <span class="field-value">${p.firstNames ?? "—"}</span>
          </div>
          <div class="row">
            <span class="field-label">${t("person.last_names")}</span>
            <span class="field-value">${p.lastNames ?? "—"}</span>
          </div>
          <div class="row">
            <span class="field-label">${t("person.telephone")}</span>
            <span class="field-value"
              >${p.telephone ?? "—"} ${p.telephone ? t("profile.phone_unverified") : ""}</span
            >
          </div>
          <div class="row">
            <span class="field-label">${t("login.email")}</span>
            <span class="field-value">${p.email ?? "—"}</span>
          </div>
          ${
            p.pendingEmail === null
              ? nothing
              : html`<div class="action-row">
                  <div class="text">
                    <span class="field-label">${t("profile.pending_email")}</span>
                    <span class="field-value">${p.pendingEmail}</span>
                  </div>
                  <wt-button
                    data-test="confirm-email"
                    class="card-action accent-primary"
                    @click=${() => this.#edit("email")}
                    >${t("action.confirm")}</wt-button
                  >
                </div>`
          }
          <div class="row">
            <span class="field-label">${t("profile.language")}</span>
            <span class="field-value"
              >${this.locales.find((l) => l.code === (p.locale ?? this.venueLocale))?.label}</span
            >
          </div>
          <div class="card-footer">
            <wt-button
              data-test="edit-details"
              class="card-action accent-primary"
              ?disabled=${this.busy}
              @click=${() => this.#edit("details")}
              >${t("action.edit")}</wt-button
            >
          </div>
        </wt-card>
      </div>
      <div class="group">
        <h2 class="group-label">${t("profile.security")}</h2>
        <wt-card raised>
          <div class="action-row">
            <div class="text">
              <span class="field-value">${t("login.password")}</span>
              ${p.hasPassword ? nothing : html`<span class="field-meta">${t("profile.password_recovery")}</span>`}
            </div>
            ${
              p.hasPassword
                ? html`<wt-button
                    data-test="change-password"
                    class="card-action accent-primary"
                    aria-label=${t("profile.change_password")}
                    ?disabled=${this.busy}
                    @click=${() => this.#edit("password")}
                    >${t("action.change")}</wt-button
                  >`
                : nothing
            }
          </div>
          <div class="action-row">
            <span class="field-value">${t("person.pin")}</span>
            <wt-button
              data-test="change-pin"
              class="card-action accent-primary"
              aria-label=${t("profile.change_pin")}
              ?disabled=${this.busy}
              @click=${() => this.#edit("pin")}
              >${t("action.change")}</wt-button
            >
          </div>

          <div class="action-row">
            <span class="field-value">${t("profile.passkeys")}</span>
            <wt-button
              data-test="add-passkey"
              class="card-action accent-primary"
              ?disabled=${this.busy}
              @click=${() => this.#edit("passkey")}
              >${t("action.add")}</wt-button
            >
          </div>
          ${
            p.passkeys.length === 0
              ? html`<p class="hint">${t("profile.no_passkeys")}</p>`
              : p.passkeys.map((key, index) => {
                  const name =
                    key.name ?? t("profile.passkey_number").replace("{number}", String(index + 1));
                  return html`<div class="action-row passkey-item">
                    <span class="passkey-text"
                      >${name} · ${new Date(key.createdAt).toLocaleDateString()}</span
                    >
                    ${
                      p.hasPassword
                        ? html`<wt-button
                            data-test="remove-passkey"
                            class="card-action accent-danger"
                            ?disabled=${this.busy}
                            aria-label=${t("profile.remove_passkey_name").replace("{name}", name)}
                            @click=${() => this.#edit("remove", key.id)}
                            >${t("action.remove")}</wt-button
                          >`
                        : nothing
                    }
                  </div>`;
                })
          }

          <div class="action-row">
            <div class="text">
              <span class="field-value">${t("profile.authenticator")}</span>
              <span class="field-meta"
                >${p.hasTotp ? t("profile.authenticator_enabled") : t("profile.authenticator_hint")}</span
              >
            </div>
            ${
              p.hasTotp
                ? html`<div class="button-group">
                    <wt-button
                      data-test="recovery-codes"
                      class="card-action"
                      aria-label=${t("profile.replace_recovery_codes")}
                      @click=${() => this.#edit("recovery")}
                      >${t("action.replace")}</wt-button
                    >
                    <wt-button
                      data-test="disable-authenticator"
                      class="card-action accent-danger"
                      @click=${() => this.#edit("disable-totp")}
                      >${t("action.disable")}</wt-button
                    >
                  </div>`
                : html`<wt-button
                    data-test="setup-authenticator"
                    class="card-action accent-primary"
                    aria-label=${t("profile.setup_authenticator")}
                    @click=${() => this.#edit("totp")}
                    >${t("action.setup")}</wt-button
                  >`
            }
          </div>

          <div class="action-row">
            <div class="text">
              <span class="field-value">${t("profile.google_login")}</span>
              <span class="field-meta"
                >${
                  p.hasGoogle
                    ? t("profile.google_linked")
                    : this.googleConfigured
                      ? t("profile.google_hint")
                      : t("profile.google_unavailable")
                }</span
              >
            </div>
            ${
              p.hasGoogle
                ? html`<wt-button
                    data-test="unlink-google"
                    class="card-action accent-danger"
                    @click=${() => this.#edit("unlink-google")}
                    >${t("action.remove")}</wt-button
                  >`
                : this.googleConfigured
                  ? html`<wt-button
                      data-test="setup-google"
                      class="card-action accent-primary"
                      aria-label=${t("profile.setup_google")}
                      ?disabled=${this.busy}
                      @click=${() => this.#edit("google")}
                      >${t("action.setup")}</wt-button
                    >`
                  : nothing
            }
          </div>
        </wt-card>
      </div>
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
    `;
  }
  #renderCodesBody() {
    return html`
      <p>${t("profile.recovery_codes_once")}</p>
      <pre data-test="recovery-code-list">${this.recoveryCodes.join("\n")}</pre>
    `;
  }
  #renderEditBody(p: OwnProfile) {
    return html`
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
                <p>${t("profile.authenticator_secret")}: <code>${this.totpSetup.secret}</code></p>
              </details>
              ${this.#input("setupCode", "profile.totp", "text", "one-time-code")}
            `
          : nothing
      }
    `;
  }
  #renderModal(p: OwnProfile) {
    return html`
      <wt-modal
        heading=${this.#modalHeading()}
        .open=${this.mode !== "view"}
        @wt-close=${(e: Event) => {
          // wt-close is composed+bubbling; this modal has no nested modal of its own today, but
          // guarding target===currentTarget keeps it correct if one is ever added inside it — see
          // the matching guard on dashboard-app.ts's outer profile modal, added after exactly this
          // bug: closing the INNER modal was also closing the outer one it bubbled through.
          if (e.target !== e.currentTarget) return;
          if (this.#closingModal) {
            this.#closingModal = false;
            return;
          }
          this.#edit("view");
        }}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${[...new Set([...Object.values(this.errors), this.error].filter(Boolean))]}
        ></wt-form-error-summary>
        <div class="fields">
          ${this.mode === "codes" ? this.#renderCodesBody() : this.mode === "view" ? nothing : this.#renderEditBody(p)}
        </div>
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            data-test="cancel"
            ?disabled=${this.busy}
            @click=${() => this.#closeModal()}
            >${this.mode === "codes" ? t("action.done") : t("action.cancel")}</wt-button
          >
          ${
            this.mode === "codes"
              ? html`<wt-button
                  variant="primary"
                  data-test="download-recovery-codes"
                  @click=${() => this.#downloadRecoveryCodes()}
                  >${t("action.download")}</wt-button
                >`
              : html`<wt-button
                  variant="primary"
                  data-test="save"
                  ?disabled=${this.busy}
                  @click=${() => void this.#save()}
                  >${t(this.mode === "remove" ? "action.remove" : "action.save")}</wt-button
                >`
          }
        </wt-form-actions>
      </wt-modal>
    `;
  }
  override render() {
    const p = this.profile;
    return html`<div class="profile">
      ${this.saved ? html`<p role="status">${t("profile.saved")}</p>` : nothing}
      ${
        p === null
          ? html`<wt-button @click=${() => void this.#load()}>${t("profile.reload")}</wt-button>`
          : html`${this.#renderDetails(p)}${this.#renderModal(p)}`
      }
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-profile-screen": ProfileScreen;
  }
}
