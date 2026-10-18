import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import { MAX_RECOVERY_PDF } from "../recovery-document.js";
import { decodeNodeKey } from "../paper-register-compact.js";
import { WAITRON_ID_SISTEMA } from "../software.js";

import type { RecoveryKeySelection } from "@waitron/module/src/setup-contract.js";
interface Draft {
  value: string;
  check: string;
  file?: File;
}
const empty = (): Draft => ({ value: "", check: "" });
@customElement("vf-recovery-key")
export class RecoveryKeyEntry extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      wt-input {
        display: block;
        margin-block: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
      }
      input[type="file"] {
        max-width: 100%;
        min-height: var(--wt-tap-min);
        font: inherit;
        color: var(--wt-color-text);
      }
    `,
  ];
  @property({ attribute: false }) selection!: RecoveryKeySelection;
  @property() errorMessage?: string;
  @property() locale: "en" | "es" = "en";
  @state() private draft = empty();
  @state() private invalid = false;
  @state() private pdfError?: "manual" | "invalid" | "mismatch";
  @state() private loaded = false;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("selection")) this.#clear();
    this.#registerScope();
  }
  #registerScope(): void {
    if (this.isConnected && !this.#scope) {
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.value === b.value && a.check === b.check && a.file === b.file,
        restore: () => this.#clear(),
      }).scope;
      this.#scope.commit(empty());
    }
  }
  override disconnectedCallback(): void {
    this.#clear();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  #notify(secret?: string): void {
    this.dispatchEvent(
      new CustomEvent("recovery-key-change", {
        detail: secret === undefined ? {} : { secret },
        bubbles: true,
        composed: true,
      }),
    );
  }
  clear(): void {
    this.#clear();
  }
  #clear(clearPicker = true): void {
    const picker = this.shadowRoot?.querySelector<HTMLInputElement>("input[type=file]");
    if (clearPicker && picker) picker.value = "";
    ++this.#generation;
    this.draft = empty();
    this.invalid = false;
    this.pdfError = undefined;
    this.loaded = false;
    this.#scope?.commit(empty());
    this.#notify();
  }
  async #edit(key: "value" | "check", value: string): Promise<void> {
    this.draft = { value: this.draft.value, check: this.draft.check, [key]: value };
    this.pdfError = undefined;
    this.loaded = false;
    const picker = this.shadowRoot?.querySelector<HTMLInputElement>("input[type=file]");
    if (picker) picker.value = "";
    this.#scope?.changed();
    const generation = ++this.#generation;
    const selection = { ...this.selection };
    this.invalid = false;
    this.#notify();
    if (!this.draft.value || !this.draft.check) return;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      selection.taxId === this.selection.taxId &&
      selection.environment === this.selection.environment &&
      selection.nodeId === this.selection.nodeId &&
      selection.keyName === this.selection.keyName;
    try {
      const secret = await decodeNodeKey(
        { encoding: "raw192", ...this.draft },
        {
          taxpayerNif: this.selection.taxId,
          softwareId: WAITRON_ID_SISTEMA,
          environment: this.selection.environment,
        },
        this.selection.nodeId,
        this.selection.keyName,
      );
      if (current()) this.#notify(secret);
    } catch {
      if (current()) this.invalid = true;
    }
  }
  async importFile(file?: File): Promise<void> {
    this.#clear(false);
    if (!file) return;
    this.draft = { ...empty(), file };
    this.#scope?.changed();
    const generation = this.#generation;
    const selection = { ...this.selection };
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      selection.taxId === this.selection.taxId &&
      selection.environment === this.selection.environment &&
      selection.nodeId === this.selection.nodeId &&
      selection.keyName === this.selection.keyName;
    try {
      if (file.size > MAX_RECOVERY_PDF) throw new Error("oversized");
      const { readRecoveryPdf } = await import("../recovery-reader.js");
      if (!current()) return;
      const { document } = await readRecoveryPdf(new Uint8Array(await file.arrayBuffer()));
      if (!current()) return;
      if (
        document.scope.taxpayerNif !== this.selection.taxId ||
        document.scope.softwareId !== WAITRON_ID_SISTEMA ||
        document.scope.environment !== this.selection.environment ||
        document.nodeKey.nodeId !== this.selection.nodeId ||
        document.nodeKey.name !== this.selection.keyName
      ) {
        this.pdfError = "mismatch";
        return;
      }
      this.loaded = true;
      this.#notify(document.nodeKey.secret);
    } catch (error) {
      if (current())
        this.pdfError =
          error instanceof Error &&
          error.message === "No recovery key attachment; enter the key from the sheet manually"
            ? "manual"
            : "invalid";
    }
  }
  override render() {
    const en = this.locale === "en";
    const error = this.invalid
      ? en
        ? "Check the key and check code for this backup."
        : "Revisa la clave y el control de esta copia."
      : (this.errorMessage ?? "");
    const pdfError =
      this.pdfError === "manual"
        ? en
          ? "Enter the key from the sheet below."
          : "Introduce abajo la clave de la hoja."
        : this.pdfError === "mismatch"
          ? en
            ? "Choose the recovery PDF for this backup's named key."
            : "Elige el PDF de la clave indicada en esta copia."
          : this.pdfError === "invalid"
            ? en
              ? "Choose a valid recovery PDF, or enter the key below."
              : "Elige un PDF de recuperación válido, o introduce la clave abajo."
            : "";
    return html` <label for="recovery-pdf">${en ? "Recovery PDF" : "PDF de recuperación"}</label>
      <input
        id="recovery-pdf"
        name="recovery-pdf"
        type="file"
        accept="application/pdf,.pdf"
        aria-invalid=${pdfError ? "true" : "false"}
        aria-describedby="pdf-error"
        @change=${(event: Event) => {
          void this.importFile((event.currentTarget as HTMLInputElement).files?.[0]);
        }}
      />
      <p id="pdf-error" class="error" role="status">${pdfError}</p>
      <p role="status">${this.loaded ? (en ? "Key loaded" : "Clave cargada") : ""}</p>
      <wt-input
        name="printed-recovery-key"
        type="password"
        autocomplete="off"
        ?required=${!this.loaded}
        label=${en ? "Recovery key" : "Clave de recuperación"}
        placeholder=${en ? "Key from your recovery sheet" : "Clave de tu hoja de recuperación"}
        .value=${this.draft.value}
        .error=${error}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          void this.#edit("value", event.detail.value);
        }}
      ></wt-input>
      <wt-input
        name="printed-recovery-check"
        autocomplete="off"
        ?required=${!this.loaded}
        label=${en ? "Check" : "Control"}
        placeholder="XXXX XXXX"
        .value=${this.draft.check}
        .error=${error}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          void this.#edit("check", event.detail.value);
        }}
      ></wt-input>
      <p class="error" role="status">${error}</p>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-recovery-key": RecoveryKeyEntry;
  }
}
