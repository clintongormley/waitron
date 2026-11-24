import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, visuallyHiddenStyles, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-file-input.js";
import { fileInputCopy } from "../file-input-copy.js";
import { MAX_RECOVERY_PDF } from "../recovery-document.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";

import type { RecoveryKeySelection } from "@waitron/module/src/setup-contract.js";
interface Draft {
  value: string;
  file?: File;
}
const empty = (): Draft => ({ value: "" });
export function masterKeyElsewhere(heldBy: number | null, en: boolean): string {
  if (heldBy !== null)
    return en
      ? `This recovery pack does not hold the master key. It is on recovery pack ${heldBy}: choose that pack, or type the key from it.`
      : `Este paquete de recuperación no tiene la clave maestra. Está en el paquete de recuperación ${heldBy}: elige ese paquete o introduce su clave.`;
  return en
    ? "This recovery pack does not hold the master key: choose the pack that holds it, or type the key from it."
    : "Este paquete de recuperación no tiene la clave maestra: elige el paquete que la tiene o introduce su clave.";
}
// Upper-cases ASCII only: `toUpperCase` turns some other letters (such as `ſ`) into key symbols,
// which the decoder refuses as typed.
function normaliseTyped(value: string): string {
  return value.replace(/[ \t\r\n-]/g, "").replace(/[a-z]+/g, (letters) => letters.toUpperCase());
}
@customElement("vf-recovery-key")
export class RecoveryKeyEntry extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      wt-input,
      wt-file-input {
        display: block;
        margin-block: var(--wt-space-3);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];
  @property({ attribute: false }) selection?: RecoveryKeySelection;
  @property() errorMessage?: string;
  @property() locale: "en" | "es" = "en";
  @state() private draft = empty();
  @state() private invalid = false;
  @state() private pdfError?: "invalid" | "mismatch" | { heldBy: number | null };
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
        equal: (a, b) => a.value === b.value && a.file === b.file,
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
  #clear(): void {
    ++this.#generation;
    this.draft = empty();
    this.invalid = false;
    this.pdfError = undefined;
    this.loaded = false;
    this.#scope?.commit(empty());
    this.#notify();
  }
  async #edit(value: string, field: LitElement): Promise<void> {
    const input = field.shadowRoot?.querySelector<HTMLInputElement>("input");
    const start = input?.selectionStart,
      end = input?.selectionEnd;
    const position = (offset: number) => {
      const length = normaliseTyped(value.slice(0, offset)).length;
      return length + Math.max(0, Math.floor((length - 1) / 4));
    };
    const caret = start != null && end != null ? [position(start), position(end)] : null;
    value =
      normaliseTyped(value)
        .match(/.{1,4}/g)
        ?.join(" ") ?? "";
    if (input && caret) {
      input.value = value;
      input.setSelectionRange(caret[0]!, caret[1]!);
    }
    this.draft = { value };
    this.pdfError = undefined;
    this.loaded = false;
    this.#scope?.changed();
    const generation = ++this.#generation;
    const selection = this.selection && { ...this.selection };
    this.invalid = false;
    this.#notify();
    if (!this.draft.value) return;
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      selection?.taxId === this.selection?.taxId &&
      selection?.environment === this.selection?.environment &&
      selection?.nodeId === this.selection?.nodeId &&
      selection?.keyName === this.selection?.keyName;
    try {
      const secret = encodeMasterKeyCode(decodeMasterKeyCode(this.draft.value));
      if (current()) this.#notify(secret);
    } catch {
      if (current()) this.invalid = true;
    }
    await this.updateComplete;
    await field.updateComplete;
    if (current() && input && caret) input.setSelectionRange(caret[0]!, caret[1]!);
  }
  async importFile(file?: File): Promise<void> {
    this.#clear();
    if (!file) return;
    this.draft = { ...empty(), file };
    this.#scope?.changed();
    const generation = this.#generation;
    const selection = this.selection && { ...this.selection };
    const current = () =>
      this.isConnected &&
      generation === this.#generation &&
      selection?.taxId === this.selection?.taxId &&
      selection?.environment === this.selection?.environment &&
      selection?.nodeId === this.selection?.nodeId &&
      selection?.keyName === this.selection?.keyName;
    try {
      if (file.size > MAX_RECOVERY_PDF) throw new Error("oversized");
      const { readRecoveryPackPdf } = await import("@waitron/recovery-pack/src/read-pack-pdf.js");
      if (!current()) return;
      const pack = await readRecoveryPackPdf(new Uint8Array(await file.arrayBuffer()));
      if (!current()) return;
      if (
        this.selection !== undefined &&
        pack.masterKeyName !== null &&
        pack.masterKeyName !== this.selection.keyName
      ) {
        this.pdfError = "mismatch";
        return;
      }
      if (pack.masterKey === null) {
        this.pdfError = { heldBy: pack.masterKeyHeldBy };
        return;
      }
      this.loaded = true;
      this.#notify(pack.masterKey);
    } catch {
      if (current()) this.pdfError = "invalid";
    }
  }
  override render() {
    const en = this.locale === "en";
    const error = this.invalid
      ? en
        ? "Check the key from your recovery pack."
        : "Revisa la clave de tu paquete de recuperación."
      : (this.errorMessage ?? "");
    const pdfError =
      typeof this.pdfError === "object"
        ? masterKeyElsewhere(this.pdfError.heldBy, en)
        : this.pdfError === "mismatch"
          ? en
            ? "Choose the recovery PDF for this backup's named key."
            : "Elige el PDF de la clave indicada en esta copia."
          : this.pdfError === "invalid"
            ? en
              ? "Choose a valid recovery PDF, or enter the key below."
              : "Elige un PDF de recuperación válido, o introduce la clave abajo."
            : "";
    return html` <wt-file-input
        name="recovery-pdf"
        accept="application/pdf,.pdf"
        label=${en ? "Recovery PDF" : "PDF de recuperación"}
        .locale=${this.locale}
        .copy=${fileInputCopy[this.locale]}
        .files=${this.draft.file ? [this.draft.file] : []}
        .error=${pdfError}
        @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
          event.stopPropagation();
          void this.importFile(event.detail.files[0]);
        }}
      ></wt-file-input>
      <p role="status">
        ${this.loaded ? (en ? "Key loaded" : "Clave cargada") : nothing}
        ${pdfError ? html`<span class="visually-hidden">${pdfError}</span>` : nothing}
      </p>
      <wt-input
        name="printed-recovery-key"
        type="password"
        autocomplete="off"
        ?required=${!this.loaded}
        label=${en ? "Box key" : "Clave del servidor"}
        placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XXXX"
        .value=${this.draft.value}
        .error=${error}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          void this.#edit(event.detail.value, event.currentTarget as LitElement);
        }}
      ></wt-input>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "vf-recovery-key": RecoveryKeyEntry;
  }
}
