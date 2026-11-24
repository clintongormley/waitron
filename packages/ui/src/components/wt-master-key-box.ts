import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import "./wt-button.js";

/** Every word the box shows, in the screen's language. `name` writes the whole line above the key. */
export type MasterKeyBoxCopy = {
  name: (name: string) => string;
  download: string;
  print: string;
  copy: string;
  copied: string;
  copyFailed: string;
  printFailed: string;
};

export type MasterKeyAction = "download" | "print" | "copy";

export interface MasterKeyUsedDetail {
  action: MasterKeyAction;
}

/**
 * A master key shown once: its name above the key as printed, and Download and Print for its pack's
 * PDF (when there is one) and Copy for the key. It fires `wt-master-key-used` only for a press that
 * worked; a Copy the browser refused or a Print it blocked is said in an alert instead. The screen
 * decides which presses let the person carry on.
 */
@customElement("wt-master-key-box")
export class WtMasterKeyBox extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .master-key {
        margin: var(--wt-space-3) 0;
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .master-key-name {
        margin: 0 0 var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      code {
        display: block;
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin: var(--wt-space-3) 0;
      }
      .copied {
        margin: 0;
        color: var(--wt-color-success);
        font-weight: var(--wt-font-weight-bold);
      }
      .failed {
        margin: 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) masterKey?: string;
  @property({ attribute: false }) keyName?: string;
  /** The pack's PDF; without one only Copy is offered. */
  @property({ attribute: false }) pdfUrl?: string;
  @property() fileName = "waitron-recovery-pack.pdf";
  /** Until it is set nothing is drawn. */
  @property({ attribute: false }) copy?: MasterKeyBoxCopy;

  @state() private copied = false;
  /** The latest press that did not work, until one does. */
  @state() private failed?: "copy" | "print";

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("masterKey")) return;
    this.copied = false;
    this.failed = undefined;
  }

  #used(action: MasterKeyAction): void {
    this.failed = undefined;
    this.dispatchEvent(
      new CustomEvent<MasterKeyUsedDetail>("wt-master-key-used", {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #download(event: Event, url: string): void {
    event.stopPropagation();
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = this.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    this.#used("download");
  }

  #print(event: Event, url: string): void {
    event.stopPropagation();
    if (window.open(url, "_blank") === null) {
      this.failed = "print";
      return;
    }
    this.#used("print");
  }

  async #copyKey(event: Event, key: string): Promise<void> {
    event.stopPropagation();
    let refused = false;
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      refused = true;
    }
    if (key !== this.masterKey) return;
    this.copied = !refused;
    if (refused) this.failed = "copy";
    else this.#used("copy");
  }

  override render() {
    const { copy, masterKey: key, pdfUrl: url } = this;
    if (copy === undefined || key === undefined) return nothing;
    return html`<div class="master-key">
        ${
          this.keyName === undefined
            ? nothing
            : html`<p class="master-key-name" data-test="master-key-name">
                ${copy.name(this.keyName)}
              </p>`
        }
        <code data-test="master-key">${key}</code>
      </div>
      ${
        this.failed === undefined
          ? nothing
          : html`<p class="failed" data-test=${`${this.failed}-failed`} role="alert">
              ${this.failed === "copy" ? copy.copyFailed : copy.printFailed}
            </p>`
      }
      <div class="actions">
        ${
          url === undefined
            ? nothing
            : html`<wt-button
                  data-test="download"
                  variant="secondary"
                  @click=${(event: Event) => this.#download(event, url)}
                  >${copy.download}</wt-button
                >
                <wt-button
                  data-test="print"
                  variant="secondary"
                  @click=${(event: Event) => this.#print(event, url)}
                  >${copy.print}</wt-button
                >`
        }
        <wt-button
          data-test="copy"
          variant="secondary"
          @click=${(event: Event) => void this.#copyKey(event, key)}
          >${copy.copy}</wt-button
        >
        ${
          this.copied
            ? html`<p class="copied" data-test="copied" role="status">${copy.copied}</p>`
            : nothing
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-master-key-box": WtMasterKeyBox;
  }
}
