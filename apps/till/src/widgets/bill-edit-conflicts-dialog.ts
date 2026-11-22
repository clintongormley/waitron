import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { named, t } from "../i18n/t.js";
import type { BillEditConflict } from "../state/bill-edit-conflicts.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { draftHolderRow, draftHolderStyles } from "./draft-holder-row.js";
import { trackDialog } from "./track-dialog.js";

export interface BillEditConflictsPrompt {
  rows: readonly BillEditConflict[];
  resume?: "dishes" | "table";
  takeOver: (row: BillEditConflict) => Promise<string | TemplateResult | null>;
  close: (review: boolean) => void;
}

@customElement("till-bill-edit-conflicts-dialog")
export class BillEditConflictsDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    draftHolderStyles,
    css`
      p {
        margin: 0;
      }
      ul {
        display: grid;
        gap: var(--wt-space-3);
        padding: 0;
        list-style: none;
      }
      li {
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) prompt!: BillEditConflictsPrompt;
  @state() private selected: BillEditConflict | null = null;
  @state() private busy = false;
  @state() private refusal: string | TemplateResult = "";
  @state() private taken: ReadonlySet<BillEditConflict> = new Set();
  #review = false;

  async #takeOver(): Promise<void> {
    const row = this.selected;
    const prompt = this.prompt;
    if (row === null || this.busy) return;
    this.busy = true;
    this.refusal = "";
    const refusal = await prompt.takeOver(row);
    if (!this.isConnected || this.prompt !== prompt) return;
    this.busy = false;
    if (refusal !== null) this.refusal = refusal;
    else {
      this.taken = new Set([...this.taken, row]);
      await this.#showRows();
    }
  }

  async #select(row: BillEditConflict): Promise<void> {
    this.selected = row;
    this.refusal = "";
    await this.updateComplete;
    if (this.selected === row)
      this.renderRoot.querySelector<HTMLElement>("[data-back-to-conflicts]")?.focus();
  }

  async #showRows(focusBill?: string): Promise<void> {
    this.selected = null;
    this.refusal = "";
    await this.updateComplete;
    if (!this.isConnected || this.selected !== null) return;
    const selector =
      focusBill === undefined
        ? "[data-split-take-over], [data-finish-conflicts]"
        : `[data-split-take-over="${CSS.escape(focusBill)}"]`;
    const button =
      this.renderRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(selector) ??
      this.renderRoot.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-cancel-conflicts]");
    await button?.updateComplete;
    if (this.isConnected && this.selected === null) button?.focus();
  }

  #close(review: boolean): void {
    if (this.busy) return;
    this.#review = review;
    void this.renderRoot.querySelector("wt-dialog")?.requestClose("navigation");
  }

  override render() {
    const { prompt, selected } = this;
    const name = selected?.ownerName ?? "";
    const remaining = prompt.rows.filter((row) => !this.taken.has(row));
    const hasReview = prompt.resume === "dishes";
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .dismissible=${!this.busy}
      .heading=${
        selected === null
          ? t("table.edit_conflicts_title")
          : named(name, t("table.take_over_title"), t("table.take_over_title_unnamed"))
      }
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        prompt.close(this.#review);
      }}
    >
      ${
        selected === null
          ? remaining.length === 0
            ? hasReview
              ? nothing
              : html`<p>${t("table.try_action_again")}</p>`
            : html`<p>${t(hasReview ? "table.move_dish_conflicts" : "table.edit_conflicts")}</p>
                <ul>
                  ${remaining.map(
                    (row) =>
                      html`<li>
                        <strong>${row.label}</strong>
                        ${draftHolderRow({
                          billId: row.edit.billId,
                          label: row.label,
                          ownerName: row.ownerName,
                          takeOver:
                            row.edit.draftId !== null && row.edit.draftRevision !== null
                              ? () => void this.#select(row)
                              : undefined,
                        })}
                        ${
                          row.edit.draftId === null || row.edit.draftRevision === null
                            ? html`<p>${t("table.conflict_review_bill")}</p>`
                            : nothing
                        }
                      </li>`,
                  )}
                </ul>`
          : html`<p>
              ${named(name, t("table.take_over_body"), t("table.take_over_body_unnamed"))}
            </p>`
      }
      <div slot="footer">
        ${this.refusal ? html`<p role="alert">${this.refusal}</p>` : nothing}
        <wt-form-actions>
          ${
            selected === null
              ? remaining.length === 0 && !hasReview
                ? nothing
                : html`<wt-button
                    slot="cancel"
                    data-cancel-conflicts
                    variant="secondary"
                    @click=${() => this.#close(false)}
                    >${t("action.cancel")}</wt-button
                  >`
              : html`<wt-button
                  slot="cancel"
                  data-back-to-conflicts
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => void this.#showRows(selected.edit.billId)}
                  >${t("action.back")}</wt-button
                >`
          }
          ${
            selected !== null
              ? html`<wt-button
                  data-confirm-take-over
                  variant="primary"
                  ?disabled=${this.busy}
                  @click=${() => void this.#takeOver()}
                  >${t("table.take_over_confirm")}</wt-button
                >`
              : remaining.length === 0
                ? html`<wt-button
                    data-finish-conflicts
                    variant="primary"
                    @click=${() => this.#close(prompt.resume !== undefined)}
                    >${t(hasReview ? "table.review_after_take_over" : "table.submitted_close")}</wt-button
                  >`
                : nothing
          }
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-bill-edit-conflicts-dialog": BillEditConflictsDialog;
  }
}
