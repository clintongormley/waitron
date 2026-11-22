import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles } from "@waitron/ui";
import { menuOptionStyles } from "@waitron/ui/src/menu-popover.js";
import { t } from "../i18n/t.js";

/** Deliberately its OWN shape, not imported from `../api/client.js`, so this widget has no
 * server-shape dependency. */
export interface ReaderOption {
  id: string;
  name: string;
  provider: string;
}

@customElement("till-reader-picker")
export class TillReaderPicker extends LitElement {
  static override styles = [
    baseStyles,
    menuOptionStyles,
    css`
      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .option {
        display: flex;
        align-items: center;
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
      ${trackDialog()}
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
   * `wt-button` host. */
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
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-reader-picker": TillReaderPicker;
  }
}
