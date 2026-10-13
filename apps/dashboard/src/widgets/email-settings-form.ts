import { LitElement, css, html, nothing, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { DashboardApi, EmailSettingsDraft, EmailSettingsView } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type Field = keyof EmailSettingsDraft;
type Values = Record<Field, string> & { authenticate: boolean };
const fields = ["server", "port", "encryption", "user", "password", "from"] as const;
const same = (a: Values, b: Values): boolean =>
  a.authenticate === b.authenticate && fields.every((field) => a[field] === b[field]);

@customElement("dashboard-email-settings-form")
export class EmailSettingsForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        max-width: var(--wt-form-max-width);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .pair {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(min(100%, calc(var(--wt-tap-min) * 5)), 1fr)
        );
        gap: var(--wt-space-4);
      }
      .pair > * {
        flex: 1;
        min-width: 0;
      }
      [data-test="reveal"] svg {
        display: block;
        width: var(--wt-font-size-lg);
        height: var(--wt-font-size-lg);
        fill: none;
        stroke: currentColor;
      }
      .success {
        color: var(--wt-color-success);
      }
      wt-form-actions {
        margin-top: var(--wt-space-4);
      }
    `,
  ];
  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "saveEmailSettings" | "testEmailSettings"
  >;
  @property({ attribute: false }) settings: EmailSettingsView["settings"] = null;
  @state() private values: Values = {
    server: "",
    port: "587",
    encryption: "starttls",
    user: "",
    password: "",
    from: "",
    authenticate: false,
  };
  @state() private attempted = false;
  @state() private busy?: "save" | "test";
  @state() private refusal?: { code: string; field?: Field };
  @state() private accepted = false;
  @state() private passwordVisible = false;
  #seeded = false;
  #baseline?: Values;
  #scope?: DraftScope<Values>;
  #leave?: LeaveCoordinator;
  #generation = 0;
  #revision = 0;

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
    this.busy = undefined;
    this.accepted = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(): void {
    if (!this.#seeded) {
      this.#seeded = true;
      if (this.settings) {
        const { server, port, encryption, from } = this.settings;
        this.values = {
          server,
          port: String(port),
          encryption,
          from,
          user: "",
          password: "",
          authenticate: this.settings.hasAuthentication,
        };
      }
      this.#baseline = { ...this.values };
    }
    if (this.isConnected && !this.#scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: this,
        current: () => this.values,
        snapshot: (value) => ({ ...value }),
        equal: same,
        restore: (value) => {
          this.values = value;
          this.accepted = false;
          this.refusal = undefined;
          this.attempted = false;
          ++this.#revision;
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit(this.#baseline!);
    }
  }
  #change(field: Field, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected) return;
    this.values = { ...this.values, [field]: event.detail.value };
    ++this.#revision;
    this.accepted = false;
    if (!this.refusal?.field || this.refusal.field === field) this.refusal = undefined;
    this.#scope?.changed();
  }
  #errors(): Set<Field> {
    const v = this.values,
      errors = new Set<Field>();
    if (!v.server.trim() || /[\s/@?#]/.test(v.server.trim())) errors.add("server");
    if (!/^\d+$/.test(v.port) || Number(v.port) < 1 || Number(v.port) > 65535) errors.add("port");
    if (!["tls", "starttls"].includes(v.encryption)) errors.add("encryption");
    if ((!v.user && v.password) || (v.authenticate && !v.user)) errors.add("user");
    if ((v.user && !v.password) || (v.authenticate && !v.password)) errors.add("password");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.from)) errors.add("from");
    return errors;
  }
  #body(): EmailSettingsDraft {
    const { server, port, encryption, user, password, from } = this.values;
    return {
      server,
      port: Number(port),
      encryption: encryption as EmailSettingsDraft["encryption"],
      user,
      password,
      from,
    };
  }
  async #submit(kind: "save" | "test"): Promise<void> {
    if (
      !this.isConnected ||
      this.busy ||
      (kind === "save" && saveActionState(this.#scope).unchanged)
    )
      return;
    this.attempted = true;
    this.refusal = undefined;
    this.accepted = false;
    if (this.#errors().size) {
      await this.updateComplete;
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const generation = this.#generation,
      revision = this.#revision,
      submitted = { ...this.values };
    this.busy = kind;
    try {
      if (kind === "test") {
        const result = await this.api.testEmailSettings(this.#body());
        if (!this.isConnected || generation !== this.#generation || revision !== this.#revision)
          return;
        if (result.accepted) this.accepted = true;
        else this.refusal = { code: result.code };
      } else {
        await this.api.saveEmailSettings(this.#body());
        if (!this.isConnected || generation !== this.#generation) return;
        this.#baseline = submitted;
        this.#scope?.commit(submitted);
        this.dispatchEvent(
          new CustomEvent("email-saved", {
            detail: { close: same(submitted, this.values) },
            bubbles: true,
            composed: true,
          }),
        );
      }
    } catch (error) {
      if (!this.isConnected || generation !== this.#generation || revision !== this.#revision)
        return;
      const name = (error as { params?: { field?: string } }).params?.field;
      this.refusal = {
        code: codeOf(error),
        ...(codeOf(error) === "email.settings_invalid" && fields.some((field) => field === name)
          ? { field: name as Field }
          : {}),
      };
    } finally {
      if (generation === this.#generation) this.busy = undefined;
    }
  }
  async #cancel(): Promise<void> {
    if (!this.isConnected || this.busy) return;
    const generation = this.#generation;
    const proceed = (): void => {
      if (this.isConnected && generation === this.#generation)
        this.dispatchEvent(
          new CustomEvent("email-cancel", { detail: {}, bubbles: true, composed: true }),
        );
    };
    if (this.#leave) await this.#leave.request({ scopes: [this], reason: "cancel", proceed });
    else proceed();
  }
  #field(field: Exclude<Field, "encryption">, errors: Set<Field>): TemplateResult {
    const invalid = errors.has(field) || this.refusal?.field === field;
    return html`<wt-input
      name=${`smtp-${field}`}
      data-test=${field}
      label=${t(`email.settings.${field}`)}
      .value=${this.values[field]}
      type=${field === "password" ? (this.passwordVisible ? "text" : "password") : field === "from" ? "email" : "text"}
      inputmode=${field === "port" ? "numeric" : "text"}
      autocomplete="off"
      ?required=${["server", "port", "from"].includes(field) || (this.values.authenticate && ["user", "password"].includes(field))}
      ?disabled=${!!this.busy || (!this.values.authenticate && ["user", "password"].includes(field))}
      ?invalid=${invalid}
      error=${invalid ? t(`email.settings.${field}_error`) : ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
    >
      ${
        field === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              data-test="reveal"
              aria-label=${t(this.passwordVisible ? "email.settings.hide_password" : "email.settings.show_password")}
              @click=${() => {
                this.passwordVisible = !this.passwordVisible;
              }}
              ><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
                <circle cx="8" cy="8" r="2"></circle>
                ${this.passwordVisible ? svg`<path d="m2 2 12 12"></path>` : nothing}
              </svg></wt-button
            >`
          : nothing
      }
    </wt-input>`;
  }
  override render(): TemplateResult {
    const errors = this.attempted ? this.#errors() : new Set<Field>(),
      save = saveActionState(this.#scope);
    const marked = errors.size > 0 || !!this.refusal?.field;
    const error = [
      marked ? t("form.fix_fields") : "",
      this.refusal && !this.refusal.field ? codeMessage(this.refusal.code) : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`${this.settings?.hasAuthentication ? html`<p>${t("email.settings.fresh_authentication")}</p>` : nothing}
      <div class="fields">
        ${this.#field("server", errors)}
        <div class="pair">
          ${this.#field("port", errors)}<wt-combobox
            name="smtp-encryption"
            data-test="encryption"
            label=${t("email.settings.encryption")}
            required
            .value=${this.values.encryption}
            .options=${[
              { value: "starttls", label: "STARTTLS" },
              { value: "tls", label: "TLS" },
            ]}
            ?disabled=${!!this.busy}
            ?invalid=${errors.has("encryption") || this.refusal?.field === "encryption"}
            error=${errors.has("encryption") || this.refusal?.field === "encryption" ? t("email.settings.encryption_error") : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("encryption", event)}
          ></wt-combobox>
        </div>
        <wt-switch
          name="smtp-authentication"
          data-test="authentication"
          label=${t("email.settings.authentication")}
          .checked=${this.values.authenticate}
          ?disabled=${!!this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            if (!this.isConnected) return;
            this.values = {
              ...this.values,
              authenticate: event.detail.checked,
              user: "",
              password: "",
            };
            this.accepted = false;
            this.refusal = undefined;
            ++this.#revision;
            this.#scope?.changed();
          }}
        ></wt-switch>
        <div class="pair">${this.#field("user", errors)}${this.#field("password", errors)}</div>
        ${this.#field("from", errors)}
      </div>
      ${this.accepted ? html`<p class="success" role="status">${t("email.settings.accepted")}</p>` : nothing}
      <wt-form-actions error=${error}>
        <wt-button
          slot="cancel"
          data-test="cancel"
          variant="ghost"
          ?disabled=${!!this.busy}
          @click=${() => void this.#cancel()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          slot="secondary"
          data-test="test"
          variant=${this.#errors().size === 0 || this.busy === "test" ? "primary" : "secondary"}
          ?disabled=${!!this.busy || errors.size > 0}
          @click=${() => void this.#submit("test")}
          >${t(this.busy === "test" ? "email.settings.testing" : "email.settings.test")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${save.variant}
          ?disabled=${save.unchanged || !!this.busy || errors.size > 0}
          @click=${() => void this.#submit("save")}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-email-settings-form": EmailSettingsForm;
  }
}
