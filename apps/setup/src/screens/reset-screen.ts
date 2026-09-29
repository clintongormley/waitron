import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
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

  /** The server refused the person ID and password as a pair, so both fields are marked until
   * either changes, and the reset waits for that change. */
  @property({ type: Boolean }) credentialsRejected = false;

  /** A refusal the operator cannot correct in the fields; it never disables the reset. */
  @property() errorMessage?: string;

  /** Set once the reset is staged or cannot run; the form is replaced by it. */
  @property({ attribute: false }) outcome?: ResetScreenOutcome;

  @property({ attribute: false }) reload: () => void = location.reload.bind(location);

  @state() private values: Record<ResetField, string> = { personId: "", password: "" };

  @state() private attempted = false;

  @state() private rejectionDismissed = false;

  @state() private refusalDismissed = false;

  @state() private passwordVisible = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("credentialsRejected")) this.rejectionDismissed = false;
    if (changed.has("errorMessage")) this.refusalDismissed = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("credentialsRejected") && this.#rejected()) this.#focusFirstInvalid();
  }

  #focusFirstInvalid(): void {
    void this.updateComplete.then(() => {
      if (this.isConnected) void focusFirstInvalid(this.shadowRoot!);
    });
  }

  #rejected(): boolean {
    return this.credentialsRejected && !this.rejectionDismissed;
  }

  #missing(): Set<ResetField> {
    if (!this.attempted) return new Set();
    return new Set(FIELDS.filter((key) => this.values[key].trim() === ""));
  }

  #onField(key: ResetField, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.values = { ...this.values, [key]: event.detail.value };
    this.rejectionDismissed = true;
  }

  #reset(): void {
    if (this.busy || this.#rejected()) return;
    this.attempted = true;
    this.refusalDismissed = true;
    if (this.#missing().size > 0) {
      this.#focusFirstInvalid();
      return;
    }
    // `password` is not trimmed: whitespace can be intentional in a secret.
    dispatchResetRequested(this, {
      personId: this.values.personId.trim(),
      password: this.values.password,
    });
  }

  #field(label: string, key: ResetField, missing: Set<ResetField>): TemplateResult {
    const error = missing.has(key) ? t(MISSING[key]) : this.#rejected() ? t(CHECK[key]) : "";
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
    const missing = this.#missing();
    const rejected = this.#rejected();
    const bottom = [
      ...(this.errorMessage === undefined || this.refusalDismissed ? [] : [this.errorMessage]),
      ...(rejected ? [t("reset.rejected")] : []),
      ...(missing.size > 0 ? [t("reset.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("reset.heading")}</h1>
      <p>${t("reset.explanation")}</p>
      <p>${t("reset.prompt")}</p>
      ${this.#field(t("reset.person_id_label"), "personId", missing)}
      ${this.#field(t("reset.password_label"), "password", missing)}
      <wt-form-actions .error=${bottom}>
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
          ?disabled=${this.busy || rejected || missing.size > 0}
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
