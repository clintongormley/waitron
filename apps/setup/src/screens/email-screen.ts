import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { SetupApi, type EmailSettingsDraft } from "../api/client.js";
import { initialOwnerStrings } from "./initial-owner-strings.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import { t, format, currentLocale } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { passwordIcon } from "../password-icon.js";
import { fieldStyles, introStyles, pairStyles } from "../form-styles.js";

type Field = keyof EmailSettingsDraft;
const fields = ["server", "port", "encryption", "user", "password", "from"] as const;
type Values = Record<Field, string>;

@customElement("setup-email-screen")
export class SetupEmailScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    introStyles,
    pairStyles,
    css`
      :host {
        display: block;
      }
      .success {
        color: var(--wt-color-success);
      }
    `,
  ];
  @property({ attribute: false }) email?: EmailSettingsDraft;
  @property() errorMessage?: string;
  @property() adminEmail = "";
  @property() backScreen: "venue" | "fiscal-test" | "cert" | "first-owner" = "venue";
  @property({ type: Boolean }) publicationOnly = false;
  @property({ attribute: false }) api: Pick<SetupApi, "runEmailTest"> = new SetupApi();
  @state() private values: Values = {
    server: "",
    port: "587",
    encryption: "starttls",
    user: "",
    password: "",
    from: "",
  };
  @state() private passwordVisible = false;
  @state() private attempted = false;
  @state() private running = false;
  @state() private outcome?: "accepted" | "refused" | "timeout" | "failed";
  @state() private refusedField?: Field;
  #seeded = false;
  #generation = 0;
  #revision = 0;
  #accepted?: { revision: number; recipient: string };
  #baseline?: Values;
  #scope?: DraftScope<Values>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    ++this.#generation;
    this.running = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(): void {
    if (!this.#seeded) {
      this.#seeded = true;
      if (this.email) this.values = { ...this.email, port: String(this.email.port) };
      this.#baseline = { ...this.values };
    }
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.values,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => fields.every((key) => a[key] === b[key]),
        restore: (value) => {
          this.values = value;
          this.#invalidate();
          this.attempted = false;
        },
      }).scope;
      this.#scope.commit(this.#baseline!);
    }
  }
  #invalidate(): void {
    ++this.#revision;
    this.#accepted = undefined;
    this.outcome = undefined;
    this.refusedField = undefined;
  }
  #change(field: Field, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected) return;
    this.values = { ...this.values, [field]: event.detail.value };
    this.#invalidate();
    this.#scope?.changed();
  }
  #errors(): Set<Field> {
    const v = this.values,
      invalid = new Set<Field>();
    if (!v.server.trim() || /[\s/@?#]/.test(v.server.trim())) invalid.add("server");
    const port = Number(v.port);
    if (!/^\d+$/.test(v.port) || port < 1 || port > 65535) invalid.add("port");
    if (v.encryption !== "tls" && v.encryption !== "starttls") invalid.add("encryption");
    if (v.user === "" && v.password !== "") invalid.add("user");
    if (v.user !== "" && v.password === "") invalid.add("password");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.from)) invalid.add("from");
    return invalid;
  }
  #canContinue(): boolean {
    if (this.publicationOnly)
      return !this.running && (!this.attempted || this.#errors().size === 0);
    return (
      !this.running &&
      this.#errors().size === 0 &&
      this.#accepted?.revision === this.#revision &&
      this.#accepted.recipient === this.adminEmail
    );
  }
  async #test(): Promise<void> {
    if (this.running || !this.isConnected) return;
    this.attempted = true;
    this.errorMessage = undefined;
    this.#accepted = undefined;
    this.outcome = undefined;
    this.refusedField = undefined;
    if (this.#errors().size) {
      await this.updateComplete;
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const generation = ++this.#generation,
      revision = this.#revision,
      recipient = this.adminEmail;
    this.running = true;
    try {
      const result = await this.api.runEmailTest(this.#settings(), recipient);
      if (
        !this.isConnected ||
        generation !== this.#generation ||
        revision !== this.#revision ||
        recipient !== this.adminEmail
      )
        return;
      if (result.accepted) {
        this.#accepted = { revision, recipient };
        this.outcome = "accepted";
      } else this.outcome = result.code === "email.test_timeout" ? "timeout" : "refused";
    } catch (error) {
      if (
        !this.isConnected ||
        generation !== this.#generation ||
        revision !== this.#revision ||
        recipient !== this.adminEmail
      )
        return;
      const refusal = error as { code?: string; params?: { field?: string } };
      if (
        refusal.code === "email.settings_invalid" &&
        fields.some((field) => field === refusal.params?.field)
      )
        this.refusedField = refusal.params!.field as Field;
      else this.outcome = "failed";
    } finally {
      if (generation === this.#generation) this.running = false;
    }
  }
  #settings(): EmailSettingsDraft {
    return {
      ...this.values,
      port: Number(this.values.port),
      encryption: this.values.encryption as EmailSettingsDraft["encryption"],
    };
  }
  #next(): void {
    if (this.publicationOnly) this.attempted = true;
    if (!this.isConnected || !this.#canContinue()) {
      if (this.publicationOnly && this.isConnected)
        void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    dispatchSetupPatch(this, { email: this.#settings() });
    this.#baseline = { ...this.values };
    this.#scope?.commit(this.#baseline);
    dispatchSetupGoto(this, "review");
  }
  #field(field: Exclude<Field, "encryption">, errors: Set<Field>): TemplateResult {
    const invalid = errors.has(field) || this.refusedField === field;
    return html`<wt-input
      class="field"
      name=${`smtp-${field}`}
      data-test=${field}
      label=${t(`email.${field}.label`)}
      hint=${t(`email.${field}.hint`)}
      .value=${this.values[field]}
      type=${field === "password" ? (this.passwordVisible ? "text" : "password") : field === "from" ? "email" : "text"}
      inputmode=${field === "port" ? "numeric" : "text"}
      autocomplete="off"
      ?required=${["server", "port", "from"].includes(field)}
      ?invalid=${invalid}
      error=${invalid ? t(`email.${field}.error`) : ""}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>(this.publicationOnly ? "[data-test=next]" : "[data-test=test]"))}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
    >
      ${
        field === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              data-test="toggle-password"
              aria-label=${t(this.passwordVisible ? "email.hide_password" : "email.show_password")}
              @click=${() => {
                this.passwordVisible = !this.passwordVisible;
              }}
              >${passwordIcon(this.passwordVisible)}</wt-button
            >`
          : nothing
      }
    </wt-input>`;
  }
  override render(): TemplateResult {
    const errors = this.attempted ? this.#errors() : new Set<Field>();
    const error =
      errors.size || this.refusedField
        ? t("email.fix_fields")
        : this.outcome && this.outcome !== "accepted"
          ? t(`email.${this.outcome}`)
          : (this.errorMessage ?? "");
    return html`<h1>${t("email.heading")}</h1>
      <p class="intro">
        ${this.publicationOnly ? initialOwnerStrings[currentLocale().startsWith("es") ? "es" : "en"].finishEmail : format("email.intro", { recipient: this.adminEmail })}
      </p>
      ${this.#field("server", errors)}
      <div class="pair">
        ${this.#field("port", errors)}
        <wt-combobox
          class="field"
          name="smtp-encryption"
          data-test="encryption"
          label=${t("email.encryption.label")}
          required
          .value=${this.values.encryption}
          .options=${[
            { value: "starttls", label: "STARTTLS" },
            { value: "tls", label: "TLS" },
          ]}
          ?invalid=${errors.has("encryption") || this.refusedField === "encryption"}
          error=${errors.has("encryption") || this.refusedField === "encryption" ? t("email.encryption.error") : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("encryption", event)}
        ></wt-combobox>
      </div>
      <div class="pair">${this.#field("user", errors)}${this.#field("password", errors)}</div>
      ${this.#field("from", errors)}
      ${!this.publicationOnly && this.#canContinue() ? html`<p class="success" role="status">${t("email.accepted")}</p>` : nothing}
      <wt-form-actions error=${error}>
        <wt-button
          slot="cancel"
          variant="ghost"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, this.backScreen)}
          >${t("email.back")}</wt-button
        >
        ${
          this.publicationOnly
            ? nothing
            : html`<wt-button
                slot="secondary"
                variant=${this.attempted || !this.#errors().size ? "primary" : "secondary"}
                data-test="test"
                ?disabled=${this.running || errors.size > 0}
                @click=${() => void this.#test()}
                >${t(this.running ? "email.testing" : "email.test")}</wt-button
              >`
        }
        <wt-button
          data-test="next"
          variant=${this.#canContinue() ? "primary" : "secondary"}
          ?disabled=${!this.#canContinue()}
          @click=${() => this.#next()}
          >${t("email.next")}</wt-button
        >
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-email-screen": SetupEmailScreen;
  }
}
