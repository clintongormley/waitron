import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { certificateExportHelp } from "../certificate-export-help.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { AeatCertDraft, ProvisionBody } from "../api/client.js";

/** The Spanish values are the server's contract (`isCertKind`); the labels gloss them in English. */
const CERT_KINDS: ReadonlyArray<{ value: AeatCertDraft["certKind"]; label: string }> = [
  { value: "sello", label: "Company seal (sello)" },
  { value: "representante", label: "Representative (representante)" },
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

  @state() private invalid = new Set<"pfx" | "passphrase">();

  @state() private showError = false;

  @state() private fileReadFailed = false;

  #seeded = false;

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
    this.invalid = new Set([...this.invalid].filter((field) => field !== "pfx"));
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
    this.invalid = new Set([...this.invalid].filter((field) => field !== "passphrase"));
  }

  #onCertKind(event: Event): void {
    event.stopPropagation();
    this.certKind = (event.target as HTMLSelectElement).value as AeatCertDraft["certKind"];
  }

  #next(): void {
    const invalid = new Set<"pfx" | "passphrase">();
    if (this.pfxBase64 === "") invalid.add("pfx");
    if (this.passphrase.trim() === "") invalid.add("passphrase");
    this.invalid = invalid;
    if (invalid.size > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;
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
    return html`
      <h1>AEAT certificate</h1>
      <p>
        A live Spanish venue files invoices to AEAT with a certificate. Upload the certificate file
        and enter its passphrase.
      </p>
      ${certificateExportHelp(navigator.userAgent)}
      <label class="field file" ?invalid=${this.invalid.has("pfx")}>
        <span
          >Certificate file (.pfx or .p12) *
          <wt-help-tooltip aria-label="Help with certificate file"
            >Choose the exported signing certificate, including its private key, so this server can
            sign fiscal records.</wt-help-tooltip
          ></span
        >
        <input
          name="certificate-file"
          type="file"
          accept=".pfx,.p12"
          required
          aria-invalid=${this.invalid.has("pfx") ? "true" : "false"}
          aria-describedby=${this.invalid.has("pfx") ? "certificate-file-error" : nothing}
          data-test="pfx"
          @change=${(e: Event) => void this.#onFileChange(e)}
        />
      </label>
      ${
        this.invalid.has("pfx")
          ? html`<p id="certificate-file-error" class="error" data-test="pfx-field-error">
              Choose the certificate file.
            </p>`
          : nothing
      }
      ${
        this.pfxBase64 !== ""
          ? html`<p class="file-status" data-test="file-status">
              Certificate loaded${this.fileName === "" ? nothing : html` — ${this.fileName}`}.
            </p>`
          : nothing
      }
      <wt-input
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=next]"))}
        class="field"
        label="Certificate passphrase"
        name="certificate-passphrase"
        autocomplete="off"
        type=${this.passphraseVisible ? "text" : "password"}
        required
        data-test="passphrase"
        error=${this.invalid.has("passphrase") ? "Enter the certificate passphrase." : ""}
        ?invalid=${this.invalid.has("passphrase")}
        .value=${this.passphrase}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPassphrase(e)}
      >
        <wt-help-tooltip slot="help" aria-label="Help with certificate passphrase"
          >Enter the password you chose when exporting this certificate file.</wt-help-tooltip
        >
        <wt-button
          slot="end"
          variant="ghost"
          data-test="toggle-passphrase"
          aria-label=${
            this.passphraseVisible ? "Hide certificate passphrase" : "Show certificate passphrase"
          }
          @click=${() => (this.passphraseVisible = !this.passphraseVisible)}
          >${passwordIcon(this.passphraseVisible)}</wt-button
        >
      </wt-input>
      ${
        this.invalid.has("passphrase")
          ? html`<p class="error" data-test="passphrase-field-error">
              Enter the certificate passphrase.
            </p>`
          : nothing
      }
      <label class="field select">
        <span
          >Certificate type *
          <wt-help-tooltip aria-label="Help with certificate type"
            >Select whether this is a company seal or representative certificate, matching the
            certificate you exported.</wt-help-tooltip
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
                ${kind.label}
              </option>`,
          )}
        </select>
      </label>
      ${
        this.showError || this.fileReadFailed
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${this.fileReadFailed ? ["We couldn't read that file. Please choose the certificate file again."] : [...this.invalid].map((field) => (field === "pfx" ? "Choose the certificate file." : "Enter the certificate passphrase."))}
            ></wt-form-error-summary>`
          : nothing
      }
      <wt-form-actions>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="next" @click=${() => this.#next()}>Next</wt-button>
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-cert-screen": SetupCertScreen;
  }
}
