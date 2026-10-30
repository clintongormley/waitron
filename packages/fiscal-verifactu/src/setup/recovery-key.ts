import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import { MAX_RECOVERY_PDF, RecoveryPackWithoutKeyError } from "../recovery-document.js";
import { normaliseTypedCode } from "../paper-register-compact.js";
import { decodeRecoveryKey } from "../recovery-key-code.js";
import { WAITRON_ID_SISTEMA } from "../software.js";

import type { RecoveryKeySelection } from "@waitron/module/src/setup-contract.js";
interface Draft {
  value: string;
  file?: File;
}
const empty = (): Draft => ({ value: "" });
function keyElsewhere(error: RecoveryPackWithoutKeyError, en: boolean): string {
  const held = error.heldBy;
  if (held) {
    const day = new Intl.DateTimeFormat(en ? "en-GB" : "es-ES", {
      timeZone: "UTC",
      dateStyle: "long",
    }).format(new Date(`${held.madeOn}T00:00:00.000Z`));
    const where = en
      ? `This recovery pack does not hold the server key. It is on recovery pack ${held.number}, made on ${day}: choose that pack, or type the key from it.`
      : `Este paquete de recuperación no tiene la clave del servidor. Está en el paquete de recuperación ${held.number}, hecho el ${day}: elige ese paquete o introduce su clave.`;
    if (held.received) return where;
    return en
      ? `${where} When this pack was made, the box that made it had not been told that pack ${held.number} arrived: if you do not have it, the key cannot be read from any pack.`
      : `${where} Cuando se hizo este paquete, la caja que lo hizo no había recibido la confirmación de que el paquete ${held.number} había llegado: si no lo tienes, la clave no se puede leer de ningún paquete.`;
  }
  if (error.serverKeyName !== null)
    return en
      ? `This recovery pack does not hold the server key: choose the pack or sheet whose key name is ${error.serverKeyName}.`
      : `Este paquete de recuperación no tiene la clave del servidor: elige el paquete o la hoja cuyo nombre de clave es ${error.serverKeyName}.`;
  return en
    ? "This recovery pack does not hold the server key: choose the pack or sheet that holds it, or type the key from it."
    : "Este paquete de recuperación no tiene la clave del servidor: elige el paquete o la hoja que la tiene, o introduce su clave.";
}
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
  @property({ attribute: false }) selection?: RecoveryKeySelection;
  @property() errorMessage?: string;
  @property() locale: "en" | "es" = "en";
  @state() private draft = empty();
  @state() private invalid = false;
  @state() private pdfError?: "manual" | "invalid" | "mismatch" | RecoveryPackWithoutKeyError;
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
  async #edit(value: string, field: LitElement): Promise<void> {
    const input = field.shadowRoot?.querySelector<HTMLInputElement>("input");
    const start = input?.selectionStart,
      end = input?.selectionEnd;
    let caret: number[] | null = null;
    try {
      const position = (offset: number) => {
        const length = normaliseTypedCode(value.slice(0, offset)).length;
        return length + Math.max(0, Math.floor((length - 1) / 4));
      };
      caret = start != null && end != null ? [position(start), position(end)] : null;
      value =
        normaliseTypedCode(value)
          .match(/.{1,4}/g)
          ?.join(" ") ?? "";
      if (input && caret) {
        input.value = value;
        input.setSelectionRange(caret[0]!, caret[1]!);
      }
    } catch {
      // Keep malformed text visible so the field can explain the refusal.
    }
    this.draft = { value };
    this.pdfError = undefined;
    this.loaded = false;
    const picker = this.shadowRoot?.querySelector<HTMLInputElement>("input[type=file]");
    if (picker) picker.value = "";
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
      const secret = decodeRecoveryKey(this.draft.value);
      if (current()) this.#notify(secret);
    } catch {
      if (current()) this.invalid = true;
    }
    await this.updateComplete;
    await field.updateComplete;
    if (current() && input && caret) input.setSelectionRange(caret[0]!, caret[1]!);
  }
  async importFile(file?: File): Promise<void> {
    this.#clear(false);
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
      const { readRecoveryPdf } = await import("../recovery-reader.js");
      if (!current()) return;
      const { document } = await readRecoveryPdf(new Uint8Array(await file.arrayBuffer()));
      if (!current()) return;
      if (
        document.scope.softwareId !== WAITRON_ID_SISTEMA ||
        (this.selection !== undefined &&
          (document.scope.taxpayerNif !== this.selection.taxId ||
            document.scope.environment !== this.selection.environment ||
            document.nodeKey.nodeId !== this.selection.nodeId ||
            document.nodeKey.name !== this.selection.keyName))
      ) {
        this.pdfError = "mismatch";
        return;
      }
      this.loaded = true;
      this.#notify(document.nodeKey.secret);
    } catch (error) {
      if (current())
        this.pdfError =
          error instanceof RecoveryPackWithoutKeyError
            ? error
            : error instanceof Error &&
                error.message ===
                  "No recovery key attachment; enter the key from the sheet manually"
              ? "manual"
              : "invalid";
    }
  }
  override render() {
    const en = this.locale === "en";
    const error = this.invalid
      ? en
        ? "Check the key from your recovery sheet."
        : "Revisa la clave de tu hoja de recuperación."
      : (this.errorMessage ?? "");
    const pdfError =
      this.pdfError instanceof RecoveryPackWithoutKeyError
        ? keyElsewhere(this.pdfError, en)
        : this.pdfError === "manual"
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
        placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX X"
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
