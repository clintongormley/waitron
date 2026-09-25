import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";

/**
 * Deliberately its OWN shape, not imported from `../api/client.js`, so this widget has no
 * server-shape dependency. `online` is optional because `GET /api/till` carries no per-reader
 * liveness signal. An offline reader stays SELECTABLE: a reader that looks offline may simply have
 * a stale liveness read.
 */
export interface ReaderOption {
  id: string;
  name: string;
  provider: string;
  online?: boolean;
}

@customElement("till-reader-picker")
export class TillReaderPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        text-align: start;
        cursor: pointer;
      }

      .option:hover {
        background: var(--wt-color-surface-raised);
      }

      .option[aria-checked="true"] {
        border-color: var(--wt-color-text);
      }

      .status {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-normal);
      }

      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) readers: ReaderOption[] = [];
  @property() selectedReaderId?: string;

  /** Does not close itself: the host owns whether a pick also tears the dialog down. */
  #choose(readerId: string): void {
    this.dispatchEvent(
      new CustomEvent<{ readerId: string }>("reader-chosen", {
        detail: { readerId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    this.dispatchEvent(new CustomEvent("reader-picker-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      .open=${true}
      .heading=${t("reader_picker.heading")}
      @wt-close=${() => this.#cancel()}
    >
      ${
        this.readers.length === 0
          ? html`<p class="empty">${t("reader_picker.empty")}</p>`
          : html`<div class="list" role="menu">
              ${this.readers.map((reader) => this.#renderOption(reader))}
            </div>`
      }
      <wt-button slot="footer" class="cancel" variant="secondary" @click=${() => this.#cancel()}>
        ${t("action.cancel")}
      </wt-button>
    </wt-dialog>`;
  }

  /** A native button, so the role and `aria-checked` land on the real focusable node rather than a
   * `wt-button` host. Offline is a text mark, never `disabled` — see `ReaderOption`. */
  #renderOption(reader: ReaderOption) {
    const checked = reader.id === this.selectedReaderId;
    return html`
      <button
        type="button"
        class="option"
        role="menuitemradio"
        aria-checked=${checked}
        data-test="reader-${reader.id}"
        @click=${() => this.#choose(reader.id)}
      >
        <span class="name">${reader.name}</span>
        ${
          reader.online === false
            ? html`<span class="status" data-test="reader-${reader.id}-offline"
                >${t("reader_picker.offline")}</span
              >`
            : nothing
        }
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-reader-picker": TillReaderPicker;
  }
}
