import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { TableState } from "../api/client.js";
import { t } from "../i18n/t.js";
import { tableTarget, tableTargetStyles } from "./table-targets.js";
import { trackDialog } from "./track-dialog.js";

export interface JoinWithPickDetail {
  tableId: string;
  targetId: string;
}

/**
 * Join with…: the tables `table` may be joined to, each acting at once. A pick sends
 * `join-with-pick` then `join-with-close`; Cancel and Escape send `join-with-close`.
 */
@customElement("till-join-with-dialog")
export class TillJoinWithDialog extends LitElement {
  static override styles = [
    baseStyles,
    tableTargetStyles,
    css`
      .targets {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** `null` keeps the dialog closed. */
  @property({ attribute: false }) table: TableState | null = null;
  /** Each group's first member, labelled as the map names the group. */
  @property({ attribute: false }) targets: TableState[] = [];
  @property() heading = "";

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #pick(table: TableState, target: TableState): void {
    this.#emit("join-with-pick", {
      tableId: table.id,
      targetId: target.id,
    } satisfies JoinWithPickDetail);
    this.#emit("join-with-close");
  }

  #body(table: TableState) {
    return html`${
        this.targets.length === 0
          ? html`<p class="empty" data-no-targets>${t("table.no_other_tables")}</p>`
          : html`<div class="targets">
              ${this.targets.map((target) =>
                tableTarget(target, table.party?.id, () => this.#pick(table, target)),
              )}
            </div>`
      }
      <wt-button
        slot="footer"
        data-join-with-cancel
        variant="secondary"
        @click=${() => this.#emit("join-with-close")}
      >
        ${t("action.cancel")}
      </wt-button>`;
  }

  override render() {
    const table = this.table;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${table !== null}
      .heading=${this.heading}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.table !== null) this.#emit("join-with-close");
      }}
    >
      ${table === null ? nothing : this.#body(table)}
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-join-with-dialog": TillJoinWithDialog;
  }
}
