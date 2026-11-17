import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, FormFeedback, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { fieldStyles, helpLinkStyles } from "../form-styles.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t, format, localTime } from "../i18n/t.js";

type Session = { displayName: string; expiresAt: string; copyExpiresAt: string };
type Field = "email" | "password" | "code";

@customElement("setup-emergency-start-screen")
export class EmergencyStartScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    helpLinkStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-form-max-width);
        margin: auto;
        padding: var(--wt-space-6);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
      }
      p {
        overflow-wrap: anywhere;
      }
      wt-button {
        max-width: 100%;
      }
    `,
  ];
  @property({ attribute: false }) transport: typeof fetch = (...args) => fetch(...args);
  @state() private context?: { accountUrl: string; copyExpiresAt: string };
  @state() private session?: Session;
  @state() private values = { email: "", password: "", code: "" };
  @state() private recovery = false;
  @state() private revealed = false;
  @state() private pending = true;
  @state() private error = "";
  private feedback = new FormFeedback(this);
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback() {
    super.connectedCallback();
    this.abort = new AbortController();
    void this.load();
  }
  override disconnectedCallback() {
    this.abort.abort();
    clearTimeout(this.timer);
    super.disconnectedCallback();
  }
  private async request(path: string, method?: string, body?: unknown) {
    const response = await this.transport(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: this.abort.signal,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw data.error;
    return data;
  }
  private refuse(error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    this.error =
      code === "password.invalid"
        ? t("emergency.invalid")
        : code === "authorization.not_permitted"
          ? t("emergency.permission")
          : code === "management_session.expired"
            ? t("emergency.expired")
            : code === "password.throttled"
              ? t("emergency.throttled")
              : t("emergency.unavailable");
  }
  private accept(session: Session) {
    this.session = session;
    this.values = { email: "", password: "", code: "" };
    this.revealed = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.session = undefined;
        this.error = t("emergency.expired");
      },
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
  }
  private async load() {
    this.pending = true;
    this.session = undefined;
    this.error = "";
    try {
      this.context = await this.request("/locked-api/context");
      try {
        this.accept(await this.request("/locked-api/session"));
      } catch (error) {
        if ((error as { code?: string })?.code !== "management_session.required")
          this.refuse(error);
      }
    } catch (error) {
      this.refuse(error);
    } finally {
      if (this.isConnected) this.pending = false;
    }
  }
  private invalid() {
    return new Set<Field>(
      this.feedback.attempted
        ? (["email", "password", "code"] as const).filter(
            (key) =>
              this.values[key].trim() === "" ||
              (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.values.email.trim())),
          )
        : [],
    );
  }
  private async signIn() {
    if (this.pending) return;
    this.feedback.press();
    this.error = "";
    if (this.invalid().size) {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    this.pending = true;
    try {
      this.accept(
        await this.request("/locked-api/session", "POST", {
          email: this.values.email.trim(),
          password: this.values.password,
          [this.recovery ? "recoveryCode" : "totp"]: this.values.code.trim(),
        }),
      );
    } catch (error) {
      this.refuse(error);
    } finally {
      this.pending = false;
    }
  }
  private async signOut() {
    if (this.pending) return;
    this.pending = true;
    try {
      await this.request("/locked-api/session", "DELETE");
      this.session = undefined;
      clearTimeout(this.timer);
      this.feedback.reset();
      this.error = "";
    } catch (error) {
      this.refuse(error);
    } finally {
      this.pending = false;
    }
  }
  private field(key: Field) {
    const invalid = this.invalid().has(key);
    const label = t(
      key === "email"
        ? "emergency.email"
        : key === "password"
          ? "emergency.password"
          : this.recovery
            ? "emergency.recovery_code"
            : "emergency.code",
    );
    return html`<wt-input
      class="field"
      name=${key}
      label=${label}
      required
      type=${key === "password" && !this.revealed ? "password" : key === "email" ? "email" : "text"}
      autocomplete=${key === "email" ? "username" : key === "password" ? "current-password" : "one-time-code"}
      inputmode=${key === "code" && !this.recovery ? "numeric" : "text"}
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      ?disabled=${this.pending}
      ?invalid=${invalid}
      error=${invalid ? t("emergency.required") : ""}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => {
        e.stopPropagation();
        this.values = { ...this.values, [key]: e.detail.value };
      }}
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector("[data-action=sign-in]"))}
      >${
        key === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              @click=${() => {
                this.revealed = !this.revealed;
              }}
              aria-label=${t(this.revealed ? "admin.hide_password" : "admin.show_password")}
              >${t(this.revealed ? "admin.hide_password" : "admin.show_password")}</wt-button
            >`
          : nothing
      }</wt-input
    >`;
  }
  override render() {
    return html`<main>
      <h1>${t("emergency.heading")}</h1>
      ${this.context ? html`<p>${t("emergency.stops")} <time data-copy-expiry datetime=${this.context.copyExpiresAt}>${localTime(this.context.copyExpiresAt)}</time>.</p>` : nothing}
      ${
        this.session
          ? html`<p role="status">
                ${format("emergency.actor", { name: this.session.displayName })}
              </p>
              <p>${t("emergency.not_started")}</p>
              <wt-form-actions .error=${this.error}
                ><wt-button
                  data-action="sign-out"
                  variant="secondary"
                  ?disabled=${this.pending}
                  @click=${() => void this.signOut()}
                  >${t("emergency.sign_out")}</wt-button
                ></wt-form-actions
              >`
          : this.context
            ? html`<form
                @submit=${(e: Event) => {
                  e.preventDefault();
                  void this.signIn();
                }}
              >
                ${this.field("email")}${this.field("password")}${this.field("code")}
                <wt-button
                  variant="ghost"
                  data-action="recovery"
                  ?disabled=${this.pending}
                  @click=${() => {
                    this.recovery = !this.recovery;
                    this.values = { ...this.values, code: "" };
                    this.feedback.reset();
                  }}
                  >${t(this.recovery ? "emergency.use_authenticator" : "emergency.use_recovery")}</wt-button
                >
                <p>${t("emergency.authenticator")}</p>
                <p>${t("emergency.no_passkeys")}</p>
                <wt-form-actions
                  .error=${this.feedback.message({ request: this.error }, this.invalid(), t("emergency.fix_fields"))}
                >
                  <wt-button
                    data-action="sign-in"
                    variant="primary"
                    ?disabled=${this.pending || this.invalid().size > 0}
                    .loading=${this.pending}
                    @click=${() => void this.signIn()}
                    >${t("emergency.sign_in")}</wt-button
                  >
                </wt-form-actions>
              </form>`
            : html`<p role="status">${this.pending ? t("emergency.loading") : this.error}</p>
                <wt-button ?disabled=${this.pending} @click=${() => void this.load()}
                  >${t("emergency.retry")}</wt-button
                >`
      }
      ${this.context ? html`<p><a href=${this.context.accountUrl}>${t("emergency.account")}</a></p>` : nothing}
    </main>`;
  }
}
