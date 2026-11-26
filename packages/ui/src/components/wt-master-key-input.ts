import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import type { DraftScope } from "@waitron/ui-core/unsaved-changes";
import { draftScopeFor } from "../leave-controller.js";
import type { WtInput } from "./wt-input.js";
import "./wt-input.js";
import "./wt-button.js";
import "./wt-qr-scanner.js";

/** Every word the field shows, in the screen's language. */
export type MasterKeyInputCopy = {
  label: string;
  button: string;
  /** The show/hide button's names, and what is said once it is pressed. */
  visibility: { show: string; hide: string; shown: string; hidden: string };
  /** Said to screen readers once a chosen PDF or a scan filled the field; never the key itself. */
  loaded: string;
  notPack: string;
  damaged: string;
  /** Said for a damaged pack instead of `damaged` where `scan` is not shown. */
  damagedNoScan: string;
  notWhole: string;
  wrongKey: (keyName: string) => string;
  /** A pack without the master key; `heldBy` is the number of the pack that holds it, when known. */
  elsewhere: (heldBy: number | null) => string;
  /** The camera button, shown only where the browser can film. */
  scan: string;
  /** Shown under the camera while it films. */
  scanning: string;
  /** Shown under the camera after a QR code that is not a whole master key. */
  notKeyCode: string;
  cameraFailed: string;
  /** The camera picture's accessible name. */
  camera: string;
  stopScan: string;
};

/** What `@waitron/recovery-pack`'s `readRecoveryPackPdf` answers that the field reads. */
export type RecoveryPackReading = {
  masterKey: string | null;
  masterKeyName: string | null;
  masterKeyHeldBy: number | null;
};

/** Loads the reader; called only once a PDF is chosen, so a page that never reads one never loads it. */
export type RecoveryPackReaderLoader = () => Promise<
  (bytes: Uint8Array) => Promise<RecoveryPackReading>
>;

/** `masterKey` is the key as printed, present only while the field holds a whole key. */
export interface MasterKeyChangeDetail {
  masterKey?: string;
}

type Problem = "notWhole" | "notPack" | "damaged" | "wrongKey" | { heldBy: number | null };

const SYMBOLS = 28;

// Upper-cases ASCII only: `toUpperCase` turns some other letters (such as `ſ`) into key symbols,
// which the decoder refuses as typed.
function normalise(value: string): string {
  return value.replace(/[ \t\r\n-]/g, "").replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function printed(text: string): string | undefined {
  try {
    return encodeMasterKeyCode(decodeMasterKeyCode(text));
  } catch {
    return undefined;
  }
}

function canFilm(): boolean {
  return (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia !== undefined;
}

/** `@waitron/recovery-pack`'s `RecoveryPackFileError`, recognised by its name and reason. */
function notAPack(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "RecoveryPackFileError" &&
    ["not_a_pack", "size"].includes((error as Error & { reason?: unknown }).reason as string)
  );
}

/**
 * A master key, typed, scanned from a recovery pack's QR code or read from a recovery pack PDF. It
 * fires `wt-change` on every change, carrying the key as printed only while the field holds a whole
 * one, and says in the field's own line why a typed key or a chosen PDF gave none.
 */
@customElement("wt-master-key-input")
export class WtMasterKeyInput extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      wt-input {
        min-width: var(--wt-tap-min);
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-2);
      }
      .choose,
      .scan,
      wt-qr-scanner,
      .camera-failed {
        margin-top: var(--wt-space-2);
      }
      .camera-failed {
        margin-bottom: 0;
        color: var(--wt-color-text);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property() name = "master-key";
  /** The host's draft scope, read when the field connects, so a partly typed key counts as the host's draft. */
  @property({ attribute: false }) draftParent?: object;
  /** The name of the key the field expects: a pack for another key is refused with it. */
  @property({ attribute: false }) keyName?: string;
  @property({ attribute: false }) readPack?: RecoveryPackReaderLoader;
  /**
   * The largest PDF the field reads (`@waitron/recovery-pack`'s `MAX_PACK_PDF`); a larger one is
   * refused as not a pack before it is read. Until it is set every PDF is refused that way.
   */
  @property({ attribute: false }) maxPdfBytes?: number;
  /** Until it is set nothing is drawn. */
  @property({ attribute: false }) copy?: MasterKeyInputCopy;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Set by the host once the person tried to carry on: a partly typed key is then not whole. */
  @property({ type: Boolean }) attempted = false;
  /** The host's own line, such as the server's refusal, shown when the field has none of its own. */
  @property() error = "";

  @state() private value = "";
  @state() private problem?: Problem;
  /** The key in the field came from a chosen PDF or a scan and has not been changed since. */
  @state() private loaded = false;
  @state() private scanning = false;
  @state() private cameraFailed = false;
  /** A QR code that is not the master key was the latest one read. */
  @state() private otherCode = false;
  @query('input[type="file"]') private chooser!: HTMLInputElement;

  #file?: File;
  #pdfRead: Promise<void> | null = null;
  /** The PDF read in progress; anything that changes the field replaces it, so a late answer is dropped. */
  #reading?: object;
  #scope?: DraftScope<{ value: string; file?: File }>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      parent: this.draftParent,
      current: () => ({ value: this.value, file: this.#file }),
      snapshot: (draft) => ({ ...draft }),
      equal: (a, b) => a.value === b.value && a.file === b.file,
      restore: () => this.clear(),
    }).scope;
    this.#scope.commit({ value: "" });
  }

  override disconnectedCallback(): void {
    // Taken out now, not at the next render, so a field put back on the page does not film again.
    this.shadowRoot?.querySelector("wt-qr-scanner")?.remove();
    this.clear();
    this.#scope!.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("disabled") && this.disabled) this.scanning = false;
    if (!this.hasUpdated || !changed.has("keyName")) return;
    const held = this.value !== "" || this.#file !== undefined;
    this.#empty();
    if (held) this.#notify();
  }

  /**
   * The latest chosen PDF's read, settled once the field shows its result: the key filled in, or
   * its refusal line. `null` before any PDF is chosen; each new choice replaces it. It never
   * rejects.
   */
  get pdfRead(): Promise<void> | null {
    return this.#pdfRead;
  }

  /** Empties the field and forgets any chosen PDF. */
  clear(): void {
    this.#empty();
    this.#notify();
  }

  #empty(): void {
    this.scanning = false;
    this.#reading = undefined;
    this.value = "";
    this.#file = undefined;
    this.problem = undefined;
    this.loaded = false;
    this.#mask();
    this.#scope?.commit({ value: "" });
  }

  #mask(): void {
    this.shadowRoot?.querySelector("wt-input")?.maskPassword();
  }

  #notify(masterKey?: string): void {
    this.dispatchEvent(
      new CustomEvent<MasterKeyChangeDetail>("wt-change", {
        detail: masterKey === undefined ? {} : { masterKey },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #start(): object {
    this.scanning = false;
    this.problem = undefined;
    this.loaded = false;
    this.cameraFailed = false;
    return (this.#reading = {});
  }

  async #edit(typed: string, field: WtInput): Promise<void> {
    const input = field.shadowRoot!.querySelector("input")!;
    this.#start();
    const symbols = (offset: number | null) => {
      const length = normalise(typed.slice(0, offset ?? 0)).length;
      return length + Math.max(0, Math.floor((length - 1) / 4));
    };
    const caret = [symbols(input.selectionStart), symbols(input.selectionEnd)] as const;
    const symbolsTyped = normalise(typed);
    this.value = symbolsTyped.match(/.{1,4}/g)?.join(" ") ?? "";
    // Set while `wt-change` is handled, so a shown key stays shown.
    field.value = this.value;
    input.value = this.value;
    this.#file = undefined;
    this.#scope!.changed();
    const key = printed(this.value);
    if (key === undefined && symbolsTyped.length >= SYMBOLS) this.problem = "notWhole";
    this.#notify(key);
    await this.updateComplete;
    input.setSelectionRange(...caret);
  }

  async #choose(file: File): Promise<void> {
    const reading = this.#start();
    this.value = "";
    this.#mask();
    this.#file = file;
    this.#scope!.changed();
    this.#notify();
    let problem: Problem | undefined;
    let key: string | undefined;
    try {
      if (this.maxPdfBytes === undefined || file.size > this.maxPdfBytes) problem = "notPack";
      else {
        const read = await this.readPack!();
        const pack = await read(new Uint8Array(await file.arrayBuffer()));
        if (pack.masterKey === null) problem = { heldBy: pack.masterKeyHeldBy };
        else if (this.keyName !== undefined && pack.masterKeyName !== this.keyName)
          problem = "wrongKey";
        else if ((key = printed(pack.masterKey)) === undefined) problem = "damaged";
      }
    } catch (error) {
      problem = notAPack(error) ? "notPack" : "damaged";
    }
    if (reading !== this.#reading) return;
    if (problem === undefined) {
      this.value = key!;
      this.loaded = true;
      this.#notify(key);
    } else this.problem = problem;
    await this.updateComplete;
    await this.renderRoot.querySelector("wt-input")?.updateComplete;
  }

  #startScan(): void {
    if (this.disabled) return;
    this.cameraFailed = false;
    this.otherCode = false;
    this.scanning = true;
  }

  #read(text: string): void {
    const key = printed(text);
    if (key === undefined) {
      this.otherCode = true;
      return;
    }
    this.#start();
    this.#mask();
    this.value = key;
    this.#file = undefined;
    this.loaded = true;
    this.#scope!.changed();
    this.#notify(key);
  }

  #scanner(copy: MasterKeyInputCopy) {
    if (this.scanning)
      return html`<wt-qr-scanner
        label=${copy.camera}
        hint=${copy.scanning}
        .message=${this.otherCode ? copy.notKeyCode : ""}
        unavailable=${copy.cameraFailed}
        @wt-qr-read=${(event: CustomEvent<{ text: string }>) => {
          event.stopPropagation();
          this.#read(event.detail.text);
        }}
        @wt-qr-unavailable=${(event: Event) => {
          event.stopPropagation();
          this.scanning = false;
          this.cameraFailed = true;
        }}
      ></wt-qr-scanner>`;
    if (this.cameraFailed)
      return html`<p class="camera-failed" data-camera-failed>${copy.cameraFailed}</p>`;
    return nothing;
  }

  #line(copy: MasterKeyInputCopy): string {
    const { problem, value } = this;
    // A pack is refused as another key's only while `keyName` is set, and a new one empties the field.
    if (problem === "wrongKey") return copy.wrongKey(this.keyName!);
    if (typeof problem === "object") return copy.elsewhere(problem.heldBy);
    if (problem === "damaged" && !canFilm()) return copy.damagedNoScan;
    if (problem !== undefined) return copy[problem];
    if (this.attempted && value !== "" && printed(value) === undefined) return copy.notWhole;
    return this.error;
  }

  override render() {
    const { copy } = this;
    if (copy === undefined) return nothing;
    const line = this.#line(copy);
    const fromPack = this.problem !== undefined && this.problem !== "notWhole";
    return html`<wt-input
        name=${this.name}
        type="password"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        .passwordVisibility=${copy.visibility}
        label=${copy.label}
        ?required=${this.required}
        ?disabled=${this.disabled}
        .value=${this.value}
        .error=${line}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          void this.#edit(event.detail.value, event.currentTarget as WtInput);
        }}
        ><slot name="help" slot="help"></slot
      ></wt-input>
      <div class="controls">
        ${
          canFilm()
            ? html`<wt-button
                class="scan"
                variant="secondary"
                ?disabled=${this.disabled}
                @click=${(event: Event) => {
                  event.stopPropagation();
                  if (this.scanning) this.scanning = false;
                  else this.#startScan();
                }}
                >${this.scanning ? copy.stopScan : copy.scan}</wt-button
              >`
            : nothing
        }
        <wt-button
          class="choose"
          variant="secondary"
          ?disabled=${this.disabled}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.chooser.click();
          }}
          >${copy.button}</wt-button
        >
      </div>
      ${this.#scanner(copy)}
      <input
        type="file"
        accept="application/pdf,.pdf"
        hidden
        ?disabled=${this.disabled}
        @click=${(event: Event) => event.stopPropagation()}
        @input=${(event: Event) => event.stopPropagation()}
        @change=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          const file = input.files![0];
          input.value = "";
          if (file !== undefined) this.#pdfRead = this.#choose(file);
        }}
      />
      <p class="visually-hidden" role="status">
        ${
          this.cameraFailed
            ? copy.cameraFailed
            : fromPack
              ? line
              : this.loaded
                ? copy.loaded
                : nothing
        }
      </p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-master-key-input": WtMasterKeyInput;
  }
}
