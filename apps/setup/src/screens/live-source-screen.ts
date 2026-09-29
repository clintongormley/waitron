import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { passwordIcon } from "../password-icon.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  dispatchConfigurationRequested,
  dispatchSetupGoto,
  dispatchSetupPatch,
} from "../events.js";

@customElement("setup-live-source-screen")
export class SetupLiveSourceScreen extends LitElement {
  static override styles = [
    baseStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .choices {
        display: grid;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property() errorMessage?: string;
  @state() private artifact?: File;
  @state() private passphrase = "";
  @state() private importing = false;
  @state() private showError = false;
  @state() private passphraseVisible = false;
  @state() private invalid = new Set<"artifact" | "passphrase">();

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #empty(): void {
    dispatchSetupPatch(this, { configurationImport: false });
    dispatchSetupGoto(this, "admin");
  }

  #import(): void {
    const artifact = this.artifact;
    const invalid = new Set<"artifact" | "passphrase">();
    if (artifact === undefined) invalid.add("artifact");
    if (this.passphrase.length < 12) invalid.add("passphrase");
    this.invalid = invalid;
    if (invalid.size > 0 || artifact === undefined) {
      this.showError = true;
      return;
    }
    this.showError = false;
    this.importing = true;
    dispatchConfigurationRequested(this, {
      artifact,
      passphrase: this.passphrase,
    });
  }

  override render(): TemplateResult {
    return html`<div class="choices">
      <wt-card raised>
        <h1>${t("live_source.heading")}</h1>
        <p>${t("live_source.intro")}</p>
        <label class="field">
          ${t("live_source.export")} <span aria-hidden="true">*</span>
          <wt-help-tooltip aria-label=${t("live_source.export_help_label")}
            >${t("live_source.export_help")}</wt-help-tooltip
          >
          <input
            name="configuration-export"
            type="file"
            required
            aria-invalid=${this.invalid.has("artifact") ? "true" : "false"}
            aria-describedby=${this.invalid.has("artifact") ? "configuration-export-error" : nothing}
            @change=${(event: Event) => {
              this.artifact = (event.currentTarget as HTMLInputElement).files?.[0];
              this.invalid = new Set([...this.invalid].filter((field) => field !== "artifact"));
            }}
          />
        </label>
        ${
          this.invalid.has("artifact")
            ? html`<p id="configuration-export-error" class="error" data-test="field-error">
                ${t("live_source.export_missing")}
              </p>`
            : nothing
        }
        <wt-input
          class="field"
          name="export-passphrase"
          label=${t("live_source.passphrase")}
          type=${this.passphraseVisible ? "text" : "password"}
          autocomplete="off"
          required
          error=${this.invalid.has("passphrase") ? t("live_source.passphrase_short") : ""}
          ?invalid=${this.invalid.has("passphrase")}
          .value=${this.passphrase}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.passphrase = event.detail.value;
            this.invalid = new Set([...this.invalid].filter((field) => field !== "passphrase"));
          }}
        >
          <wt-help-tooltip slot="help" aria-label=${t("live_source.passphrase_help_label")}
            >${t("live_source.passphrase_help")}</wt-help-tooltip
          >
          <wt-button
            slot="end"
            variant="ghost"
            data-test="toggle-passphrase"
            aria-label=${t(this.passphraseVisible ? "live_source.hide_passphrase" : "live_source.show_passphrase")}
            @click=${() => (this.passphraseVisible = !this.passphraseVisible)}
            >${passwordIcon(this.passphraseVisible)}</wt-button
          >
        </wt-input>
        ${
          this.invalid.has("passphrase")
            ? html`<p class="error" data-test="field-error">
                ${t("live_source.passphrase_short")}
              </p>`
            : nothing
        }
        ${
          this.showError
            ? html`<wt-form-error-summary
                heading=${t("live_source.error_heading")}
                .errors=${[...this.invalid].map((field) => t(field === "artifact" ? "live_source.export_missing" : "live_source.passphrase_short"))}
              ></wt-form-error-summary>`
            : this.errorMessage
              ? html`<p class="error" role="alert">${this.errorMessage}</p>`
              : nothing
        }
        <wt-button
          variant="primary"
          data-test="import"
          ?disabled=${this.importing}
          @click=${() => this.#import()}
          >${t("live_source.import")}</wt-button
        >
      </wt-card>
      <wt-card raised>
        <h2>${t("live_source.start_empty")}</h2>
        <p>${t("live_source.empty_intro")}</p>
        <wt-button variant="secondary" data-test="empty" @click=${() => this.#empty()}
          >${t("live_source.start_empty")}</wt-button
        >
      </wt-card>
      <div class="actions">
        <wt-button variant="ghost" @click=${() => dispatchSetupGoto(this, "mode")}
          >${t("live_source.back")}</wt-button
        >
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-live-source-screen": SetupLiveSourceScreen;
  }
}
