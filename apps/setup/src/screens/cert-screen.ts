import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { focusFirstInvalid, submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { certificateExportHelp } from "../certificate-export-help.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { AeatCertDraft, ProvisionBody } from "../api/client.js";

/** The Spanish values are the server's contract (`isCertKind`). */
const CERT_KINDS: ReadonlyArray<{ value: AeatCertDraft["certKind"]; label: StringKey }> = [
  { value: "sello", label: "cert.kind.sello" },
  { value: "representante", label: "cert.kind.representante" },
];

/** Everything after the first comma of the data URL is the base64 payload: the base64 alphabet has
 * no comma. */
function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

@customElement("setup-cert-screen")
export class SetupCertScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      a {
        color: var(--wt-color-text);
      }
      details {
        margin-block: var(--wt-space-3);
      }
      summary {
        cursor: pointer;
      }
      :host {
        display: block;
      }

      .field.select > span,
      .field.file > span {
        display: block;
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      input[type="file"] {
        font: inherit;
        color: var(--wt-color-text);
        width: 100%;
      }

      .field.file[invalid] > span {
        color: var(--wt-color-danger);
      }

      .file-status {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  /** Never rendered: only its presence is shown. */
  @state() private pfxBase64 = "";

  @state() private fileName = "";

  @state() private passphrase = "";
  @state() private certKind: AeatCertDraft["certKind"] = "sello";
  @state() private passphraseVisible = false;

  @state() private attempted = false;

  @state() private fileReadFailed = false;

  #seeded = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
  }

  /** A file input cannot be re-populated programmatically, so a returning operator's file comes back
   * as the base64 an earlier Next saved in the draft. */
  #seedFromDraft(): void {
    const cert = this.draft.aeatCert;
    if (cert === undefined) return;
    this.pfxBase64 = cert.pfxBase64 ?? this.pfxBase64;
    this.passphrase = cert.passphrase ?? this.passphrase;
    this.certKind = cert.certKind ?? this.certKind;
  }

  async #onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.pfxBase64 = "";
      this.fileName = "";
      this.fileReadFailed = false;
      return;
    }
    this.fileReadFailed = false;
    this.fileName = file.name;
    try {
      this.pfxBase64 = await readFileAsBase64(file);
    } catch {
      // The @change binding discards this handler's promise, so a read failure caught nowhere else
      // would escape as an unhandled rejection.
      this.pfxBase64 = "";
      this.fileName = "";
      this.fileReadFailed = true;
    }
  }

  #onPassphrase(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.passphrase = event.detail.value;
  }

  #onCertKind(event: Event): void {
    event.stopPropagation();
    this.certKind = (event.target as HTMLSelectElement).value as AeatCertDraft["certKind"];
  }

  /** A failed read is the file field's error from the moment it happens, until another file is
   * chosen. */
  #errors(): Partial<Record<"pfx" | "passphrase", string>> {
    const errors: Partial<Record<"pfx" | "passphrase", string>> = {};
    if (this.fileReadFailed) errors.pfx = t("cert.file_unreadable");
    else if (this.attempted && this.pfxBase64 === "") errors.pfx = t("cert.file_required");
    if (this.attempted && this.passphrase.trim() === "") {
      errors.passphrase = t("cert.passphrase_required");
    }
    return errors;
  }

  #next(): void {
    this.attempted = true;
    if (this.pfxBase64 === "" || this.passphrase.trim() === "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    dispatchSetupPatch(this, {
      aeatCert: {
        pfxBase64: this.pfxBase64,
        passphrase: this.passphrase,
        certKind: this.certKind,
      },
    });
    dispatchSetupGoto(this, "fiscal-test");
  }

  #back(): void {
    dispatchSetupGoto(this, "venue");
  }

  override render(): TemplateResult {
    const errors = this.#errors();
    const hasFieldErrors = errors.pfx !== undefined || errors.passphrase !== undefined;
    return html`
      <h1>${t("cert.heading")}</h1>
      <p>${t("cert.intro")}</p>
      ${certificateExportHelp(navigator.userAgent)}
      <label class="field file" ?invalid=${errors.pfx !== undefined}>
        <span
          >${t("cert.file_label")} *
          <wt-help-tooltip aria-label=${t("cert.file_help_label")}
            >${t("cert.file_help")}</wt-help-tooltip
          ></span
        >
        <input
          name="certificate-file"
          type="file"
          accept=".pfx,.p12"
          required
          aria-invalid=${errors.pfx === undefined ? "false" : "true"}
          aria-describedby=${errors.pfx === undefined ? nothing : "certificate-file-error"}
          data-test="pfx"
          @change=${(e: Event) => void this.#onFileChange(e)}
        />
      </label>
      ${
        errors.pfx === undefined
          ? nothing
          : html`<p id="certificate-file-error" class="error" data-test="pfx-field-error">
              ${errors.pfx}
            </p>`
      }
      ${
        this.pfxBase64 !== ""
          ? html`<p class="file-status" data-test="file-status">
              ${this.fileName === "" ? t("cert.loaded") : format("cert.loaded_named", { name: this.fileName })}
            </p>`
          : nothing
      }
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
        class="field"
        label=${t("cert.passphrase_label")}
        name="certificate-passphrase"
        autocomplete="off"
        type=${this.passphraseVisible ? "text" : "password"}
        required
        data-test="passphrase"
        error=${errors.passphrase ?? ""}
        ?invalid=${errors.passphrase !== undefined}
        .value=${this.passphrase}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPassphrase(e)}
      >
        <wt-help-tooltip slot="help" aria-label=${t("cert.passphrase_help_label")}
          >${t("cert.passphrase_help")}</wt-help-tooltip
        >
        <wt-button
          slot="end"
          variant="ghost"
          data-test="toggle-passphrase"
          aria-label=${
            this.passphraseVisible ? t("cert.hide_passphrase") : t("cert.show_passphrase")
          }
          @click=${() => (this.passphraseVisible = !this.passphraseVisible)}
          >${passwordIcon(this.passphraseVisible)}</wt-button
        >
      </wt-input>
      ${
        errors.passphrase === undefined
          ? nothing
          : html`<p class="error" data-test="passphrase-field-error">${errors.passphrase}</p>`
      }
      <label class="field select">
        <span
          >${t("cert.kind_label")} *
          <wt-help-tooltip aria-label=${t("cert.kind_help_label")}
            >${t("cert.kind_help")}</wt-help-tooltip
          ></span
        >
        <select
          name="certificate-kind"
          required
          data-test="certKind"
          @change=${(e: Event) => this.#onCertKind(e)}
        >
          ${CERT_KINDS.map(
            (kind) =>
              html`<option value=${kind.value} .selected=${kind.value === this.certKind}>
                ${t(kind.label)}
              </option>`,
          )}
        </select>
      </label>
      <wt-form-actions .error=${hasFieldErrors ? t("cert.fix_fields") : ""}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("cert.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="next"
          ?disabled=${hasFieldErrors}
          @click=${() => this.#next()}
          >${t("cert.next")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-cert-screen": SetupCertScreen;
  }
}
