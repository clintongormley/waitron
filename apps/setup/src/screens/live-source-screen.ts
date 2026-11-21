import { LitElement, type PropertyValues, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, pageTitleStyles, focusFirstInvalid, leaveCoordinatorFor, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-file-input.js";
import { passwordIcon } from "../password-icon.js";
import { currentLocale, t } from "../i18n/t.js";
import { fileInputCopy } from "../file-input-copy.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { actionsStyles, fieldStyles } from "../form-styles.js";
import {
  dispatchConfigurationRequested,
  dispatchSetupGoto,
  dispatchSetupPatch,
  type ConfigurationRequestDetail,
} from "../events.js";

@customElement("setup-live-source-screen")
export class SetupLiveSourceScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    fieldStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .choices {
        display: grid;
        gap: var(--wt-space-4);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
    `,
  ];

  @property() errorMessage?: string;
  @property() errorCode?: string;
  /** The request `errorMessage` refuses: each refusal brings a new one, a translation does not. */
  @property({ attribute: false }) refusedRequest?: ConfigurationRequestDetail;
  @property({ attribute: false }) beforeEmpty?: (proceed: () => void, signal: AbortSignal) => void;

  #baseline?: { artifact?: File; passphrase: string };
  #scope?: DraftScope<{ artifact?: File; passphrase: string }>;
  #choiceAbort = new AbortController();
  #sent?: ConfigurationRequestDetail;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.#choiceAbort.signal.aborted) this.#choiceAbort = new AbortController();
    this.#baseline ??= { artifact: this.artifact, passphrase: this.passphrase };
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => ({ artifact: this.artifact, passphrase: this.passphrase }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.artifact === b.artifact && a.passphrase === b.passphrase,
      restore: (value) => {
        this.artifact = value.artifact;
        this.passphrase = value.passphrase;
        this.attempted = false;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#choiceAbort.abort();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  @state() private artifact?: File;
  @state() private passphrase = "";
  @state() private importing = false;
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  @state() private passphraseVisible = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusedRequest") && this.refusedRequest) {
      // The shell routes a failed import back here; the operator must be able to try again.
      this.importing = false;
      this.refusalDismissed = this.#changedSince(this.refusedRequest);
    }
  }

  #changedSince(sent: ConfigurationRequestDetail): boolean {
    if (sent !== this.#sent) return false;
    if (this.errorCode === "setup.configuration_unreadable") return this.artifact !== sent.artifact;
    if (this.errorCode === "recovery.passphrase_invalid")
      return this.passphrase !== sent.passphrase;
    return false;
  }

  get #passphraseRefused(): boolean {
    return this.errorCode === "recovery.passphrase_invalid" && !this.refusalDismissed;
  }

  get #artifactRefused(): boolean {
    return this.errorCode === "setup.configuration_unreadable" && !this.refusalDismissed;
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("refusedRequest") && (this.#passphraseRefused || this.#artifactRefused))
      void focusFirstInvalid(
        this.shadowRoot!.querySelector<HTMLElement>("[data-test=import-form]")!,
      );
  }

  get #artifactMissing(): boolean {
    return this.attempted && this.artifact === undefined;
  }

  get #passphraseShort(): boolean {
    return this.attempted && this.passphrase.length < 12;
  }

  #empty(): void {
    if (!this.isConnected) return;
    const proceed = () => {
      if (!this.isConnected) return;
      dispatchSetupPatch(this, { configurationImport: false });
      dispatchSetupGoto(this, "admin");
    };
    if (this.beforeEmpty) this.beforeEmpty(proceed, this.#choiceAbort.signal);
    else proceed();
  }

  acceptImport(submitted: ConfigurationRequestDetail): void {
    this.#baseline = { ...submitted };
    this.#scope?.commit(this.#baseline);
    this.importing = false;
  }

  #import(): void {
    const artifact = this.artifact;
    this.attempted = true;
    this.refusalDismissed = true;
    if (artifact === undefined || this.#passphraseShort) {
      const form = this.shadowRoot!.querySelector<HTMLElement>("[data-test=import-form]")!;
      void this.updateComplete.then(() => focusFirstInvalid(form));
      return;
    }
    this.importing = true;
    this.#sent = { artifact, passphrase: this.passphrase };
    dispatchConfigurationRequested(this, this.#sent);
  }

  override render(): TemplateResult {
    const fieldsInvalid = this.#artifactMissing || this.#passphraseShort;
    const fieldRefused = this.#passphraseRefused || this.#artifactRefused;
    const bottom = [
      ...(this.errorMessage && !this.refusalDismissed && !fieldRefused ? [this.errorMessage] : []),
      ...(fieldsInvalid || fieldRefused ? [t("live_source.fix_fields")] : []),
    ].join(" ");
    return html`<div class="choices">
      <wt-card raised data-test="import-form">
        <h1>${t("live_source.heading")}</h1>
        <p>${t("live_source.intro")}</p>
        <wt-file-input
          class="field"
          name="configuration-export"
          label=${t("live_source.export")}
          required
          .files=${this.artifact ? [this.artifact] : []}
          .copy=${fileInputCopy()}
          .locale=${currentLocale()}
          .error=${
            this.#artifactMissing
              ? t("live_source.export_missing")
              : this.#artifactRefused
                ? (this.errorMessage ?? "")
                : ""
          }
          ?invalid=${this.#artifactMissing || this.#artifactRefused}
          @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
            event.stopPropagation();
            if (!this.isConnected) return;
            this.artifact = event.detail.files[0];
            if (this.#artifactRefused) this.refusalDismissed = true;
            this.#scope?.changed();
          }}
        >
          <wt-help-tooltip slot="help" aria-label=${t("live_source.export_help_label")}
            >${t("live_source.export_help")}</wt-help-tooltip
          >
        </wt-file-input>
        <wt-input
          class="field"
          name="export-passphrase"
          hint=${t("live_source.passphrase_hint")}
          label=${t("live_source.passphrase")}
          type=${this.passphraseVisible ? "text" : "password"}
          autocomplete="off"
          required
          error=${this.#passphraseShort ? t("live_source.passphrase_short") : this.#passphraseRefused ? this.errorMessage : ""}
          ?invalid=${this.#passphraseShort}
          .value=${this.passphrase}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (!this.isConnected) return;
            this.passphrase = event.detail.value;
            if (this.#passphraseRefused) this.refusalDismissed = true;
            this.#scope?.changed();
          }}
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
        <wt-form-actions .error=${bottom}>
          <wt-button
            variant="primary"
            data-test="import"
            ?disabled=${this.importing || fieldsInvalid}
            @click=${() => this.#import()}
            >${t("live_source.import")}</wt-button
          >
        </wt-form-actions>
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
