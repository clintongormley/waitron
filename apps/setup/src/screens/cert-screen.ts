import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  FormFeedback,
  submitOnEnter,
  baseStyles,
  pageTitleStyles,
  leaveCoordinatorFor,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-file-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { passwordIcon } from "../password-icon.js";
import { currentLocale, format, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { fileInputCopy } from "../file-input-copy.js";
import { certificateExportHelp } from "../certificate-export-help.js";
import { actionsStyles, fieldStyles } from "../form-styles.js";
import { dispatchSetupGoto, dispatchSetupPatch } from "../events.js";
import type { DeepPartial } from "../setup-app.js";
import type { AeatCertDraft, ApiError, ProvisionBody } from "../api/client.js";

type CertKindChoice = "sello" | "representante";
const CERT_KINDS: ReadonlyArray<{ value: CertKindChoice; label: StringKey }> = [
  { value: "sello", label: "cert.kind.sello" },
  { value: "representante", label: "cert.kind.representante" },
];

export interface CertificateRefusal {
  field: "pfxBase64" | "passphrase" | "body";
  reason: string;
  certificateTaxId?: string;
  taxId?: string;
}

const REFUSAL_MESSAGES: Readonly<Record<string, StringKey>> = {
  too_large: "cert.refusal.too_large",
  unavailable: "cert.refusal.unavailable",
  busy: "cert.refusal.busy",
  passphrase_wrong: "cert.refusal.passphrase_wrong",
  unreadable: "cert.refusal.unreadable",
  old_encryption: "cert.refusal.old_encryption",
  no_private_key: "cert.refusal.no_private_key",
  expired: "cert.refusal.expired",
  invalid_tax_id: "cert.refusal.invalid_tax_id",
  not_yet_valid: "cert.refusal.not_yet_valid",
  other_taxpayer: "cert.refusal.other_taxpayer",
};

interface CertificateForm {
  pfxBase64: string;
  fileName: string;
  passphrase: string;
  certKind: CertKindChoice;
  selectedFile: File | null;
  pendingFile: File | null;
  fileReadFailed: boolean;
}

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
    pageTitleStyles,
    fieldStyles,
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

      .file-status {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      h2 {
        font-size: var(--wt-font-size-lg);
      }
    `,
  ];

  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};
  @property({ attribute: false }) refusal?: CertificateRefusal;
  @property({ attribute: false }) inspect?: (
    cert: AeatCertDraft,
    current: () => boolean,
  ) => Promise<boolean>;
  @state() private inspecting = false;
  @state() private inspectionRefusal?: CertificateRefusal;
  #inspectionGeneration = 0;
  private readonly feedback = new FormFeedback(this);

  get #activeRefusal(): CertificateRefusal | undefined {
    return this.inspectionRefusal ?? this.refusal;
  }

  #invalidateInspection(): void {
    ++this.#inspectionGeneration;
    this.inspecting = false;
    this.inspectionRefusal = undefined;
  }

  /** Never rendered: only its presence is shown. */
  @state() private pfxBase64 = "";

  @state() private fileName = "";

  @state() private passphrase = "";
  @state() private certKind: CertKindChoice = "sello";
  @state() private passphraseVisible = false;

  @state() private fileReadFailed = false;

  #seeded = false;
  #baseline?: CertificateForm;
  #scope?: DraftScope<CertificateForm>;
  #selectedFile: File | null = null;
  #pendingFile: File | null = null;
  #fileGeneration = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }

  override disconnectedCallback(): void {
    ++this.#fileGeneration;
    this.#invalidateInspection();
    this.#pendingFile = null;
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #current(): CertificateForm {
    return {
      pfxBase64: this.pfxBase64,
      fileName: this.fileName,
      passphrase: this.passphrase,
      certKind: this.certKind,
      selectedFile: this.#selectedFile,
      pendingFile: this.#pendingFile,
      fileReadFailed: this.fileReadFailed,
    };
  }

  #registerScope(): void {
    if (!this.isConnected || !this.#baseline || this.#scope) return;
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => this.#current(),
      snapshot: (form) => ({ ...form }),
      equal: (a, b) =>
        a.pfxBase64 === b.pfxBase64 &&
        a.passphrase === b.passphrase &&
        a.certKind === b.certKind &&
        a.pendingFile === b.pendingFile &&
        a.fileReadFailed === b.fileReadFailed &&
        (a.pfxBase64 !== "" || a.selectedFile === b.selectedFile),
      restore: (form) => {
        ++this.#fileGeneration;
        this.#invalidateInspection();
        this.pfxBase64 = form.pfxBase64;
        this.fileName = form.fileName;
        this.passphrase = form.passphrase;
        this.certKind = form.certKind;
        this.#selectedFile = form.selectedFile;
        this.#pendingFile = form.pendingFile;
        this.fileReadFailed = form.fileReadFailed;
        this.feedback.attempted = false;
        this.requestUpdate();
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.feedback.newRefusal();
    if (!this.#seeded) {
      this.#seeded = true;
      this.#seedFromDraft();
    }
    this.#baseline ??= this.#current();
  }

  override updated(): void {
    this.#registerScope();
  }

  #seedFromDraft(): void {
    const cert = this.draft.aeatCert;
    if (cert === undefined) return;
    this.pfxBase64 = cert.pfxBase64 ?? this.pfxBase64;
    this.passphrase = cert.passphrase ?? this.passphrase;
  }

  async #onFileChange(event: CustomEvent<{ files: File[] }>): Promise<void> {
    event.stopPropagation();
    this.#invalidateInspection();
    if (this.refusal?.field === "pfxBase64") this.feedback.dismiss("refusal");
    const file = event.detail.files[0];
    const generation = ++this.#fileGeneration;
    this.#selectedFile = file ?? null;
    this.#pendingFile = file ?? null;
    this.pfxBase64 = "";
    if (!file) {
      this.fileName = "";
      this.fileReadFailed = false;
      this.#scope?.changed();
      return;
    }
    this.fileReadFailed = false;
    this.fileName = file.name;
    this.#scope?.changed();
    try {
      const base64 = await readFileAsBase64(file);
      if (!this.isConnected || generation !== this.#fileGeneration) return;
      this.#pendingFile = null;
      this.pfxBase64 = base64;
      this.#scope?.changed();
    } catch {
      if (!this.isConnected || generation !== this.#fileGeneration) return;
      this.#pendingFile = null;
      this.pfxBase64 = "";
      this.fileName = "";
      this.fileReadFailed = true;
      this.#scope?.changed();
    }
  }

  #onPassphrase(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#invalidateInspection();
    this.passphrase = event.detail.value;
    if (this.refusal?.field === "passphrase") this.feedback.dismiss("refusal");
    this.#scope?.changed();
  }

  #onCertKind(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.#invalidateInspection();
    this.certKind = event.detail.value as CertKindChoice;
    this.#scope?.changed();
  }

  #errors(): Partial<Record<"pfx" | "passphrase" | "request", string>> {
    const errors: Partial<Record<"pfx" | "passphrase" | "request", string>> = {};
    if (this.feedback.attempted && this.pfxBase64 === "") {
      errors.pfx = this.fileReadFailed ? t("cert.file_unreadable") : t("cert.file_required");
    }
    if (this.feedback.attempted && this.passphrase.trim() === "")
      errors.passphrase = t("cert.passphrase_required");
    const refusal = this.#activeRefusal;
    if (refusal && this.feedback.shows("refusal")) {
      const field =
        refusal.field === "body"
          ? "request"
          : refusal.field === "passphrase"
            ? "passphrase"
            : "pfx";
      errors[field] ??= format(REFUSAL_MESSAGES[refusal.reason] ?? "cert.refusal.unreadable", {
        certificateTaxId: refusal.certificateTaxId ?? "",
        taxId: refusal.taxId ?? "",
      });
    }
    return errors;
  }

  async #next(): Promise<void> {
    if (this.inspecting) return;
    this.feedback.dismiss("refusal");
    this.feedback.press();
    if (this.pfxBase64 === "" || this.passphrase.trim() === "") {
      void this.feedback.focus(this.shadowRoot!);
      return;
    }
    const submitted = this.#current();
    const aeatCert = {
      pfxBase64: submitted.pfxBase64,
      passphrase: submitted.passphrase,
    };
    const inspect = this.inspect;
    if (inspect) {
      const generation = ++this.#inspectionGeneration;
      const current = () => this.isConnected && generation === this.#inspectionGeneration;
      this.inspecting = true;
      try {
        if (!(await inspect(aeatCert, current)) || !current()) return;
      } catch (error) {
        if (!current()) return;
        const { code, params } = (error ?? {}) as Partial<ApiError>;
        this.inspectionRefusal =
          code === "setup.certificate_refused" && typeof params?.reason === "string"
            ? {
                field:
                  params.field === "passphrase" || params.field === "pfxBase64"
                    ? params.field
                    : "body",
                reason: params.reason,
              }
            : { field: "body", reason: "unavailable" };
        this.feedback.newRefusal();
        void this.feedback.focus(this.shadowRoot!);
        return;
      } finally {
        if (current()) this.inspecting = false;
      }
    }
    dispatchSetupPatch(this, { aeatCert });
    this.#baseline = submitted;
    this.#scope?.commit(this.#baseline);
    dispatchSetupGoto(this, inspect ? "venue" : "fiscal-test");
  }

  #back(): void {
    dispatchSetupGoto(this, this.inspect ? "admin" : "venue");
  }

  override render(): TemplateResult {
    const errors = this.#errors();
    const fieldKeys = new Set(Object.keys(errors).filter((key) => key !== "request"));
    return html`
      <h1>${t("cert.heading")}</h1>
      <p>${t(this.inspect ? "cert.before_venue" : "cert.intro")}</p>
      ${certificateExportHelp(navigator.userAgent)}
      <p>
        <a
          data-test="certificate-guide"
          href=${`/help/${currentLocale().startsWith("es") ? "es" : "en"}/aeat-certificate${this.inspect ? "#venue-details" : "#refusals"}`}
          target="_blank"
          rel="noopener"
          >${t("cert.guide")}</a
        >
      </p>
      <wt-file-input
        class="field"
        name="certificate-file"
        label=${t("cert.file_label")}
        accept=".pfx,.p12"
        required
        data-test="pfx"
        .files=${this.#selectedFile ? [this.#selectedFile] : []}
        .copy=${fileInputCopy()}
        .locale=${currentLocale()}
        .error=${errors.pfx ?? ""}
        ?invalid=${errors.pfx !== undefined}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => void this.#onFileChange(event)}
      >
        <wt-help-tooltip slot="help" aria-label=${t("cert.file_help_label")}
          >${t("cert.file_help")}</wt-help-tooltip
        >
      </wt-file-input>
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
        hint=${t("cert.passphrase_hint")}
        autocomplete="off"
        type=${this.passphraseVisible ? "text" : "password"}
        required
        data-test="passphrase"
        error=${errors.passphrase ?? ""}
        ?invalid=${errors.passphrase !== undefined}
        .value=${this.passphrase}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPassphrase(e)}
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
      <wt-combobox
        class="field"
        name="certificate-kind"
        label=${t("cert.kind_label")}
        required
        search="auto"
        data-test="certKind"
        .options=${CERT_KINDS.map((kind) => ({ value: kind.value, label: t(kind.label) }))}
        .value=${this.certKind}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onCertKind(e)}
      >
        <wt-help-tooltip slot="help" aria-label=${t("cert.kind_help_label")}
          >${t("cert.kind_help")}</wt-help-tooltip
        >
      </wt-combobox>
      ${this.inspecting ? html`<p role="status" class="file-status">${t("cert.checking")}</p>` : nothing}
      <wt-form-actions .error=${this.feedback.message(errors, fieldKeys, t("cert.fix_fields"))}>
        <wt-button variant="ghost" slot="cancel" data-test="back" @click=${() => this.#back()}
          >${t("cert.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="next"
          ?disabled=${this.inspecting || (this.feedback.attempted && (this.pfxBase64 === "" || this.passphrase.trim() === ""))}
          @click=${() => void this.#next()}
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
