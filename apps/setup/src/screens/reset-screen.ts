import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { actionsStyles, errorStyles, fieldStyles, statusStyles } from "../form-styles.js";
import { dispatchResetRequested, dispatchSetupGoto } from "../events.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

type ResetField = "personId" | "password";

const FIELDS: readonly ResetField[] = ["personId", "password"];

const MISSING: Record<ResetField, StringKey> = {
  personId: "reset.missing.person_id",
  password: "reset.missing.password",
};

const CHECK: Record<ResetField, StringKey> = {
  personId: "reset.check.person_id",
  password: "reset.check.password",
};

export interface ResetScreenOutcome {
  kind: "resetting" | "refused";
  message: string;
}

/**
 * Clears a join that stopped partway. The shell does the POST
 * (`apps/setup/src/setup-app.ts`) and maps its answer onto these properties.
 */
@customElement("setup-reset-screen")
export class SetupResetScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    statusStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ type: Boolean }) busy = false;

  /** The server refused the person ID and password, so both fields are marked. */
  @property({ type: Boolean }) credentialsRejected = false;

  /** A refusal the operator cannot correct in the fields. */
  @property() errorMessage?: string;

  /** Set once the reset is staged or cannot run; the form is replaced by it. */
  @property({ attribute: false }) outcome?: ResetScreenOutcome;

  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  @state() private values: Record<ResetField, string> = { personId: "", password: "" };

  @state() private missing = new Set<ResetField>();

  @state() private passwordVisible = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #onField(key: ResetField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
  }

  #reset(): void {
    if (this.busy) return;
    this.missing = new Set(FIELDS.filter((key) => this.values[key].trim() === ""));
    if (this.missing.size > 0) return;
    // `password` is not trimmed: whitespace can be intentional in a secret.
    dispatchResetRequested(this, {
      personId: this.values.personId.trim(),
      password: this.values.password,
    });
  }

  #fieldError(key: ResetField): string {
    if (this.missing.has(key)) return t(MISSING[key]);
    return this.missing.size === 0 && this.credentialsRejected ? t(CHECK[key]) : "";
  }

  #field(label: string, key: ResetField): TemplateResult {
    const error = this.#fieldError(key);
    return html`<wt-input
      @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=reset]"))}
      class="field"
      label=${label}
      name=${key}
      autocomplete=${key === "password" ? "current-password" : "username"}
      required
      error=${error}
      ?invalid=${error !== ""}
      data-test=${key}
      type=${key === "password" && !this.passwordVisible ? "password" : "text"}
      .value=${this.values[key]}
      @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(key, e)}
      >${
        key === "password"
          ? html`<wt-button
              slot="end"
              variant="ghost"
              data-test="toggle-password"
              aria-label=${t(this.passwordVisible ? "reset.hide_password" : "reset.show_password")}
              @click=${() => (this.passwordVisible = !this.passwordVisible)}
              >${passwordIcon(this.passwordVisible)}</wt-button
            >`
          : nothing
      }</wt-input
    >`;
  }

  #alert(): TemplateResult | typeof nothing {
    // One alert region: two `role="alert"` nodes double-announce to a screen reader. The
    // client-validation summary wins over a stale answer from the server.
    const errors =
      this.missing.size > 0
        ? [...this.missing].map((key) => t(MISSING[key]))
        : this.credentialsRejected
          ? [t("reset.rejected")]
          : [];
    if (errors.length > 0)
      return html`<wt-form-error-summary
        data-test="error"
        heading=${t("reset.error_heading")}
        .errors=${errors}
      ></wt-form-error-summary>`;
    return this.errorMessage === undefined
      ? nothing
      : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`;
  }

  override render(): TemplateResult {
    if (this.outcome !== undefined) {
      const resetting = this.outcome.kind === "resetting";
      return html`
        <h1>${t(resetting ? "reset.heading_resetting" : "reset.heading")}</h1>
        <p
          class=${resetting ? "status" : "error"}
          role=${resetting ? "status" : "alert"}
          data-test="outcome"
        >
          ${this.outcome.message}
        </p>
        <div class="actions">
          <wt-button variant="primary" data-test="reload" @click=${() => this.reload()}
            >${t("reset.reload")}</wt-button
          >
        </div>
      `;
    }
    return html`
      <h1>${t("reset.heading")}</h1>
      <p>${t("reset.explanation")}</p>
      <p>${t("reset.prompt")}</p>
      ${this.#field(t("reset.person_id_label"), "personId")}
      ${this.#field(t("reset.password_label"), "password")} ${this.#alert()}
      <wt-form-actions>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "provisioning")}
          >${t("reset.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="reset"
          ?disabled=${this.busy}
          @click=${() => this.#reset()}
          >${t(this.busy ? "reset.busy" : "reset.submit")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-reset-screen": SetupResetScreen;
  }
}
