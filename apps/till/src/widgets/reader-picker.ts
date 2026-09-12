import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";

/**
 * One reader the picker can offer. Deliberately its OWN shape, not imported from `../api/client.js`
 * — this widget stays mountable with no server-shape dependency at all (Task 17's brief: keep it
 * self-contained so slice 2's handheld NFC/QR link can mount the SAME element). `online` is optional
 * because today's `GET /api/till` (Task 12) carries no per-reader liveness signal, only `id`/`name`/
 * `provider` — a reader with `online` omitted renders with no status mark, the same as one explicitly
 * `true`; only `online === false` marks it offline. Either way the reader stays SELECTABLE: an
 * offline mark is informational only, never a lock (CLAUDE.md §5 — nothing may wedge a sale, and a
 * reader that looks offline may simply have a stale liveness read).
 */
export interface ReaderOption {
  id: string;
  name: string;
  provider: string;
  online?: boolean;
}

/**
 * The payment-time reader picker (Task 17): a small dialog listing the venue's active card readers,
 * marking any known-offline one, and letting the operator choose which reader the NEXT payment
 * collects on. PURE presentational — props in, one event out, no store, no API call — so
 * `tender-pay.ts`'s "use a different reader" control and slice 2's handheld link mount the exact
 * same element.
 *
 * Emits `reader-chosen` (composed, bubbling) with `{ readerId }` on a pick, and `reader-picker-cancel`
 * (same shape, no detail) on Cancel / Escape / a backdrop click. The host decides what either means —
 * `tender-pay.ts` closes the dialog either way and only remembers the id on a genuine pick.
 */
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

  /** The readers to offer, in the order supplied. `[]` renders an empty-state message rather than a
   * dead-looking blank list. */
  @property({ attribute: false }) readers: ReaderOption[] = [];
  /** The reader to show as the current pick (the pay-time default, or a prior choice this session),
   * or `undefined` when none is distinguished. */
  @property() selectedReaderId?: string;

  /** Emit the pick. Does not close itself — the host (`tender-pay.ts`) owns whether picking one also
   * tears the dialog down, matching `modifier-picker.ts`'s confirm/cancel split. */
  #choose(readerId: string): void {
    this.dispatchEvent(
      new CustomEvent<{ readerId: string }>("reader-chosen", {
        detail: { readerId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Emit the cancel — Cancel button, Escape, or a backdrop click (`wt-dialog`'s own `wt-close`), all
   * the same "the operator changed their mind" signal. */
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

  /** One reader row: a `role="menuitemradio"` button (the language-chooser's own pattern) so the
   * role and `aria-checked` land on the real focusable node rather than a `wt-button` host, which
   * only forwards `disabled`/`aria-label` into its shadow root. Offline is a text mark, never a
   * `disabled` state — see the class doc on why an offline reader stays selectable. */
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
