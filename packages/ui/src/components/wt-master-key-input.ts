import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "@waitron/shared";
import { baseStyles, visuallyHiddenStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import type { DraftScope } from "@waitron/ui-core/unsaved-changes";
import { draftScopeFor } from "../leave-controller.js";
import "./wt-input.js";
import "./wt-button.js";

/** Every word the field shows, in the screen's language. */
export type MasterKeyInputCopy = {
  label: string;
  button: string;
  notPack: string;
  damaged: string;
  notWhole: string;
  wrongKey: (keyName: string) => string;
  /** A pack without the master key; `heldBy` is the number of the pack that holds it, when known. */
  elsewhere: (heldBy: number | null) => string;
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

/** `@waitron/recovery-pack`'s `RecoveryPackFileError`, recognised by its name and reason. */
function notAPack(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "RecoveryPackFileError" &&
    ["not_a_pack", "size"].includes((error as Error & { reason?: unknown }).reason as string)
  );
}

/**
 * A master key, typed or read from a recovery pack PDF. It fires `wt-master-key-change` on every
 * change, carrying the key as printed only while the field holds a whole one, and says in the
 * field's own line why a typed key or a chosen PDF gave none.
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
      .choose {
        margin-top: var(--wt-space-2);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
    `,
  ];

  @property() name = "master-key";
  /** The name of the key the field expects: a pack for another key is refused with it. */
  @property({ attribute: false }) keyName?: string;
  @property({ attribute: false }) readPack?: RecoveryPackReaderLoader;
  /** Until it is set nothing is drawn. */
  @property({ attribute: false }) copy?: MasterKeyInputCopy;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /**
   * Set by the host when the key it sent was refused as not the expected one. The field clears it
   * when the person types or chooses a PDF, on `clear()`, and when `keyName` changes unless the host
   * set it in that same update. A host binding it (`.wrongKey=${flag}`) clears its own flag on every
   * `wt-master-key-change` and sets it on each refusal: Lit writes a binding only when its value
   * changes, so a flag left set would hide the next refusal. A new `keyName` empties the field and
   * sends `wt-master-key-change` only if the field held a key, a PDF or an older refusal; a host that
   * sets a new name and the flag together calls `clear()` first, or that change clears its flag.
   */
  @property({ type: Boolean }) wrongKey = false;
  /** Set by the host once the person tried to carry on: a partly typed key is then not whole. */
  @property({ type: Boolean }) attempted = false;
  /** The host's own line, shown when the field has none of its own. */
  @property() error = "";

  @state() private value = "";
  @state() private problem?: Problem;
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
      current: () => ({ value: this.value, file: this.#file }),
      snapshot: (draft) => ({ ...draft }),
      equal: (a, b) => a.value === b.value && a.file === b.file,
      restore: () => this.clear(),
    }).scope;
    this.#scope.commit({ value: "" });
  }

  override disconnectedCallback(): void {
    this.clear();
    this.#scope!.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.hasUpdated || !changed.has("keyName")) return;
    const held = this.value !== "" || this.#file !== undefined;
    const refusedNow = changed.has("wrongKey") && this.wrongKey;
    const tell = held || (this.wrongKey && !refusedNow);
    this.#empty();
    if (!refusedNow) this.wrongKey = false;
    if (tell) this.#notify();
  }

  /**
   * The latest chosen PDF's read, settled once the field shows its result: the key filled in, or
   * its refusal line. `null` before any PDF is chosen; each new choice replaces it. It never
   * rejects.
   */
  get pdfRead(): Promise<void> | null {
    return this.#pdfRead;
  }

  /** Empties the field and forgets any chosen PDF and any refusal. */
  clear(): void {
    this.#empty();
    this.wrongKey = false;
    this.#notify();
  }

  #empty(): void {
    this.#reading = undefined;
    this.value = "";
    this.#file = undefined;
    this.problem = undefined;
    this.#scope?.commit({ value: "" });
  }

  #notify(masterKey?: string): void {
    this.dispatchEvent(
      new CustomEvent<MasterKeyChangeDetail>("wt-master-key-change", {
        detail: masterKey === undefined ? {} : { masterKey },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #start(): object {
    this.problem = undefined;
    this.wrongKey = false;
    return (this.#reading = {});
  }

  async #edit(typed: string, input: HTMLInputElement): Promise<void> {
    this.#start();
    const symbols = (offset: number | null) => {
      const length = normalise(typed.slice(0, offset ?? 0)).length;
      return length + Math.max(0, Math.floor((length - 1) / 4));
    };
    const caret = [symbols(input.selectionStart), symbols(input.selectionEnd)] as const;
    const symbolsTyped = normalise(typed);
    this.value = symbolsTyped.match(/.{1,4}/g)?.join(" ") ?? "";
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
    this.#file = file;
    this.#scope!.changed();
    this.#notify();
    let problem: Problem | undefined;
    let key: string | undefined;
    try {
      const read = await this.readPack!();
      const pack = await read(new Uint8Array(await file.arrayBuffer()));
      if (pack.masterKey === null) problem = { heldBy: pack.masterKeyHeldBy };
      else if (this.keyName !== undefined && pack.masterKeyName !== this.keyName)
        problem = "wrongKey";
      else if ((key = printed(pack.masterKey)) === undefined) problem = "damaged";
    } catch (error) {
      problem = notAPack(error) ? "notPack" : "damaged";
    }
    if (reading !== this.#reading) return;
    if (problem === undefined) {
      this.value = key!;
      this.#notify(key);
    } else this.problem = problem;
    await this.updateComplete;
    await this.renderRoot.querySelector("wt-input")?.updateComplete;
  }

  #line(copy: MasterKeyInputCopy): string {
    const { problem, value } = this;
    if (this.wrongKey || problem === "wrongKey")
      return this.keyName === undefined ? this.error : copy.wrongKey(this.keyName);
    if (typeof problem === "object") return copy.elsewhere(problem.heldBy);
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
        label=${copy.label}
        ?required=${this.required}
        ?disabled=${this.disabled}
        .value=${this.value}
        .error=${line}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const input = (event.currentTarget as LitElement).shadowRoot!.querySelector("input")!;
          void this.#edit(event.detail.value, input);
        }}
      ></wt-input>
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
      <p class="visually-hidden" role="status">${fromPack ? line : nothing}</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-master-key-input": WtMasterKeyInput;
  }
}
