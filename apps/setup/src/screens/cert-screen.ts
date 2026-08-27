import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-input.js";
import { selectStyles } from "../select-styles.js";
import type { DeepPartial } from "../setup-app.js";
import type { AeatCertDraft, ProvisionBody } from "../api/client.js";

/**
 * The AEAT-certificate step, reached ONLY for a live ES-common venue (the venue screen routes here
 * only then, `apps/setup/src/screens/venue-screen.ts`). It collects the three things a `parseCert`
 * boundary needs (`apps/server/src/setup-api.ts`): the PFX bundle (as canonical base64), its
 * passphrase, and the certificate kind (`sello` / `representante`).
 *
 * The PFX is read from a chosen file to base64 IN THE BROWSER via `FileReader.readAsDataURL`, whose
 * result is a `data:<mediatype>;base64,<data>` URL; the `data:…;base64,` prefix is stripped so only
 * the canonical base64 the server validates reaches `pfxBase64`. The bytes are never rendered or
 * logged — only whether a file has been loaded (fiscal §5 / brief: never surface a secret).
 *
 * On `Next` it client-validates (a file loaded + a non-empty passphrase) — a failure shows a
 * `role="alert"` banner and marks the offending fields, and nothing is emitted — then emits the
 * `aeatCert` slice as a `setup-patch` and advances to `review`. `Back` returns to `venue`. Both nav
 * events are the composed/bubbling pair the shell listens for. Following
 * `apps/setup/src/screens/venue-screen.ts` for the field/`wt-change`/banner + seed-once idiom.
 */

/** The certificate kinds the server accepts (`isCertKind`, `apps/server/src/aeat-credential.ts`);
 * the Spanish terms are the API contract values, shown with an English gloss. */
const CERT_KINDS: ReadonlyArray<{ value: AeatCertDraft["certKind"]; label: string }> = [
  { value: "sello", label: "Company seal (sello)" },
  { value: "representante", label: "Representative (representante)" },
];

/**
 * Read a chosen file to canonical base64 in the browser. `FileReader.readAsDataURL` yields a
 * `data:<mediatype>;base64,<data>` URL; the base64 payload is everything after the FIRST comma (the
 * base64 alphabet never contains a comma, so this split is exact), stripping the `data:…;base64,`
 * prefix the server would reject.
 */
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
    css`
      :host {
        display: block;
      }

      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
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

      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }

      .actions {
        display: flex;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
    `,
  ];

  /** The accumulated draft, passed down from the shell. Read ONCE on mount to seed the local fields. */
  @property({ attribute: false }) draft: DeepPartial<ProvisionBody> = {};

  /** The PFX bundle as canonical base64. NEVER rendered — only its presence drives the loaded status. */
  @state() private pfxBase64 = "";

  /** The chosen file's name, shown as confirmation. Not a secret (the bytes are `pfxBase64`). */
  @state() private fileName = "";

  @state() private passphrase = "";
  @state() private certKind: AeatCertDraft["certKind"] = "sello";

  /** The fields a `Next` rejected — `pfx` (no file loaded) and/or `passphrase` (blank). */
  @state() private invalid = new Set<"pfx" | "passphrase">();

  /** True once a `Next` was rejected — drives the `role="alert"` banner. */
  @state() private showError = false;

  /** Guards {@link SetupCertScreen.#seedFromDraft} to run only on the first update. */
  #seeded = false;

  override willUpdate(): void {
    if (this.#seeded) return;
    this.#seeded = true;
    this.#seedFromDraft();
  }

  /**
   * Overlay whatever certificate the shell's draft already holds, so Back-then-forward is
   * non-destructive on the passphrase and kind. The file input itself cannot be re-populated
   * programmatically (a browser security rule), but the base64 already read survives, so the loaded
   * status and the emitted patch both stay correct without re-choosing the file.
   */
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
      return;
    }
    this.fileName = file.name;
    this.pfxBase64 = await readFileAsBase64(file);
  }

  #onPassphrase(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.passphrase = event.detail.value;
  }

  #onCertKind(event: Event): void {
    event.stopPropagation();
    this.certKind = (event.target as HTMLSelectElement).value as AeatCertDraft["certKind"];
  }

  /**
   * Validate, then emit. A missing file or a blank passphrase blocks the emit, shows the banner, and
   * marks the offending field(s). The guard is proven by deletion: drop the `invalid.size` check and a
   * "no file does not advance" test flips red.
   */
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
    this.dispatchEvent(
      new CustomEvent("setup-patch", {
        detail: {
          patch: {
            aeatCert: {
              pfxBase64: this.pfxBase64,
              passphrase: this.passphrase,
              certKind: this.certKind,
            },
          },
        },
        bubbles: true,
        composed: true,
      }),
    );
    this.dispatchEvent(
      new CustomEvent("setup-goto", {
        detail: { screen: "review" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #back(): void {
    this.dispatchEvent(
      new CustomEvent("setup-goto", { detail: { screen: "venue" }, bubbles: true, composed: true }),
    );
  }

  override render(): TemplateResult {
    return html`
      <wt-card>
        <h1>AEAT certificate</h1>
        <p>
          A live Spanish venue files invoices to AEAT with a certificate. Upload the certificate
          file and enter its passphrase.
        </p>
        <label class="field file" ?invalid=${this.invalid.has("pfx")}>
          <span>Certificate file (.pfx or .p12)</span>
          <input
            type="file"
            accept=".pfx,.p12"
            data-test="pfx"
            @change=${(e: Event) => void this.#onFileChange(e)}
          />
        </label>
        ${
          this.pfxBase64 !== ""
            ? html`<p class="file-status" data-test="file-status">
                Certificate loaded${this.fileName === "" ? nothing : html` — ${this.fileName}`}.
              </p>`
            : nothing
        }
        <wt-input
          class="field"
          label="Certificate passphrase"
          type="password"
          data-test="passphrase"
          ?invalid=${this.invalid.has("passphrase")}
          .value=${this.passphrase}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onPassphrase(e)}
        ></wt-input>
        <label class="field select">
          <span>Certificate type</span>
          <select data-test="certKind" @change=${(e: Event) => this.#onCertKind(e)}>
            ${CERT_KINDS.map(
              (kind) =>
                html`<option value=${kind.value} .selected=${kind.value === this.certKind}>
                  ${kind.label}
                </option>`,
            )}
          </select>
        </label>
        ${
          this.showError
            ? html`<p class="error" role="alert" data-test="error">
                Choose the certificate file and enter its passphrase.
              </p>`
            : nothing
        }
        <div class="actions">
          <wt-button variant="ghost" data-test="back" @click=${() => this.#back()}>Back</wt-button>
          <wt-button variant="primary" data-test="next" @click=${() => this.#next()}
            >Next</wt-button
          >
        </div>
      </wt-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-cert-screen": SetupCertScreen;
  }
}
