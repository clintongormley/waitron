import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { DeleteImpact, DeleteImpactItem, DeleteImpactRefusal } from "@waitron/shared";
import { baseStyles } from "../base-styles.js";
import type { WtModal } from "./wt-modal.js";
import type { WtButton } from "./wt-button.js";
import "./wt-modal.js";
import "./wt-button.js";
import "./wt-form-actions.js";
import "./wt-spinner.js";

type DeleteDialogWords = {
  heading: string;
  refusals: string;
  ends: string;
  cancel: string;
  confirm: string;
  retry: string;
  loading: string;
  refusal: (item: DeleteImpactRefusal) => string;
  alternative?: (impact: DeleteImpact) =>
    | {
        warning: string;
        heading: string;
        guidance: string;
        link?: { href: string; label: string };
        confirm: string;
        cancel: string;
      }
    | undefined;
};

export type DeleteDialogCopy = DeleteDialogWords & {
  removes: string;
  irreversible: string;
  item: (item: DeleteImpactItem) => string;
};

export type DeleteDialogSummaryCopy = DeleteDialogWords & {
  summary: (impact: DeleteImpact) => { sentence: string; ends: string[] };
};

@customElement("wt-delete-dialog")
export class WtDeleteDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .target {
        margin: 0 0 var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .summary {
        margin: 0 0 var(--wt-space-3);
        overflow-wrap: anywhere;
      }

      .group {
        margin: 0 0 var(--wt-space-3);
      }

      h3 {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .group[data-group="refusals"] h3 {
        color: var(--wt-color-danger);
      }

      ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }

      li {
        overflow-wrap: anywhere;
      }

      li + li {
        margin-top: var(--wt-space-1);
      }

      .status {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }

      .status:empty {
        margin: 0;
      }

      .guidance a {
        color: var(--wt-color-primary-text);
      }

      .irreversible {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) impact: DeleteImpact | null = null;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) submitting = false;
  @property() readError = "";
  @property() actionError = "";
  /** Until it is set nothing is drawn, so no unnamed dialog can open. */
  @property({ attribute: false }) copy?: DeleteDialogCopy | DeleteDialogSummaryCopy;
  @property({ attribute: false }) opener: HTMLElement | null = null;

  @query("wt-modal") private modal!: WtModal;
  @query('[data-test="delete-cancel"]') private cancelButton!: WtButton;

  private get ready(): boolean {
    return (
      this.impact !== null &&
      !this.loading &&
      this.readError === "" &&
      this.impact.refusals.length === 0
    );
  }

  private shown = false;

  override updated(): void {
    const shown = this.open && this.copy !== undefined;
    if (shown && !this.shown) void this.focusCancel();
    this.shown = shown;
  }

  private async focusCancel(): Promise<void> {
    await this.modal.updateComplete;
    await this.cancelButton.updateComplete;
    if (this.open && this.isConnected) this.cancelButton.focus();
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private onConfirm(event: Event): void {
    event.stopPropagation();
    if (this.submitting || !this.ready) return;
    this.emit("wt-delete-confirm", { id: this.impact!.target.id });
  }

  private onRetry(event: Event): void {
    event.stopPropagation();
    if (this.loading) return;
    this.emit("wt-delete-retry", {});
  }

  private onCancel(event: Event): void {
    event.stopPropagation();
    if (this.submitting) return;
    this.close();
  }

  /** The modal also reports a close the parent asked for, which is not passed on. */
  private onModalClose(event: Event): void {
    event.stopPropagation();
    this.close();
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit("wt-close", {});
  }

  private group(name: string, heading: string, lines: string[]) {
    if (lines.length === 0) return nothing;
    return html`<section class="group" data-group=${name}>
      <h3>${heading}</h3>
      <ul>
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </section>`;
  }

  private impactDetails(copy: DeleteDialogCopy | DeleteDialogSummaryCopy, impact: DeleteImpact) {
    if ("summary" in copy) {
      const { sentence, ends } = copy.summary(impact);
      return html`
        ${sentence ? html`<p class="summary">${sentence}</p>` : nothing}
        ${this.group("ends", copy.ends, ends)}
      `;
    }
    return html`
      ${this.group(
        "ends",
        copy.ends,
        impact.ends.map((item) => copy.item(item)),
      )}
      ${this.group(
        "removes",
        copy.removes,
        impact.removes.map((item) => copy.item(item)),
      )}
      <p class="irreversible" data-irreversible>${copy.irreversible}</p>
    `;
  }

  override render() {
    const { copy, impact } = this;
    if (!copy) return nothing;
    const ready = this.ready;
    const compact = "summary" in copy;
    const alternative = impact && copy.alternative?.(impact);
    const message = [this.readError, this.actionError].filter((each) => each !== "").join(" ");
    const status = this.loading
      ? html`<wt-spinner size="sm" decorative></wt-spinner>${copy.loading}`
      : nothing;
    return html`
      <wt-modal
        size="compact"
        .open=${this.open}
        .heading=${copy.heading}
        .opener=${this.opener}
        .dismissible=${!this.submitting}
        @wt-close=${this.onModalClose}
      >
        ${impact && !compact ? html`<p class="target" data-target>${impact.target.name}</p>` : nothing}
        <p class="status" role="status">${status}</p>
        ${
          impact
            ? html`
                ${this.group(
                  "refusals",
                  copy.refusals,
                  impact.refusals.map((each) => copy.refusal(each)),
                )}
                ${this.impactDetails(copy, impact)}
                ${
                  alternative
                    ? html`
                        <p>${alternative.warning}</p>
                        <div class="guidance" data-test="delete-guidance">
                          <h3>${alternative.heading}</h3>
                          ${alternative.guidance}
                          ${
                            alternative.link
                              ? html`<a href=${alternative.link.href}>${alternative.link.label}</a>`
                              : nothing
                          }
                        </div>
                      `
                    : nothing
                }
              `
            : nothing
        }
        <wt-form-actions slot="footer" .error=${message}>
          <wt-button
            slot="cancel"
            data-test="delete-cancel"
            variant="secondary"
            ?disabled=${this.submitting}
            @click=${this.onCancel}
            >${alternative?.cancel ?? copy.cancel}</wt-button
          >
          ${
            this.readError === ""
              ? nothing
              : html`<wt-button
                  slot="secondary"
                  data-test="delete-retry"
                  variant="secondary"
                  ?loading=${this.loading}
                  @click=${this.onRetry}
                  >${copy.retry}</wt-button
                >`
          }
          <wt-button
            data-test="delete-confirm"
            variant=${this.submitting || ready ? "danger" : "secondary"}
            ?disabled=${this.submitting || !ready}
            ?loading=${this.submitting}
            @click=${this.onConfirm}
            >${alternative?.confirm ?? copy.confirm}</wt-button
          >
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-delete-dialog": WtDeleteDialog;
  }
}
