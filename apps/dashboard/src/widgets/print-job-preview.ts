import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, registerIcons } from "@waitron/ui";
import { columnsFor } from "@waitron/printing/src/layout.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-icon-button.js";
import type { A4PrintJobPreview, PrintJobPreview, PrintJobRow } from "../api/printing-api.js";
import { formatIsoMinute } from "../date-utils.js";
import { codeMessage } from "../i18n/codes.js";
import { jobStatusName } from "../i18n/domain.js";
import { jobErrorMessage, jobStatus, jobWaitMessage } from "./printer-job-status.js";
import { fill, t } from "../i18n/t.js";
import { PrintPaper, paperStyles } from "./print-paper.js";

registerIcons({
  "preview-left": "M7 3 2 8l5 5 1.05-1.05L4.85 8.75H14v-1.5H4.85L8.05 4.05Z",
  "preview-right": "M9 3l5 5-5 5-1.05-1.05 3.2-3.2H2v-1.5h9.15l-3.2-3.2Z",
});

@customElement("dashboard-print-job-preview")
export class PrintJobPreviewDialog extends LitElement {
  static override styles = [
    baseStyles,
    paperStyles,
    css`
      :host {
        display: block;
      }
      .summary {
        display: grid;
        gap: var(--wt-space-1);
        padding-bottom: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .summary p {
        margin: 0;
      }
      .printer-name {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .job-meta,
      .arrows {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-2);
      }
      time,
      .reason {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .job-status::before {
        content: "";
        display: inline-block;
        vertical-align: middle;
        margin-inline-end: var(--wt-space-2);
        inline-size: var(--wt-space-2);
        block-size: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--status-dot, var(--wt-color-text-muted));
      }
      [data-status="done"] {
        --status-dot: var(--wt-color-success);
      }
      [data-status="failed"] {
        --status-dot: var(--wt-color-danger);
      }
      [data-status="held"],
      [data-status="unknown"] {
        --status-dot: var(--wt-color-warning);
      }
      [data-status="printing"] {
        --status-dot: var(--wt-color-primary);
      }
      .paper-viewport {
        /* One millimetre on paper takes three quarters of a CSS millimetre. */
        --preview-mm: 0.75mm;
        overflow-x: auto;
        margin-top: var(--wt-space-4);
        padding: 1px;
      }
      .paper-viewport:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .paper {
        font-size: 2mm;
        padding-inline: max(
          0px,
          calc((var(--roll-mm) * var(--preview-mm) - var(--columns) * 1ch) / 2)
        );
        margin-inline: auto;
      }
      .invoice-page {
        inline-size: calc(210 * var(--preview-mm));
        max-width: none;
        outline: 1px solid var(--wt-color-border);
        margin-inline: auto;
      }
      .invoice-page + .invoice-page {
        margin-top: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
      }
      .qr-data {
        overflow-wrap: anywhere;
      }
    `,
  ];

  readonly #paper = new PrintPaper();

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) preview: PrintJobPreview | A4PrintJobPreview | null = null;

  @property({ attribute: false }) job: PrintJobRow | null = null;
  @property() printerName = "";
  @property({ type: Boolean }) loading = false;
  @property() error: string | null = null;
  @property() reprintError: string | null = null;
  @property({ type: Boolean }) previous = false;
  @property({ type: Boolean }) next = false;
  @property({ type: Boolean }) canReprint = false;
  @property({ type: Boolean }) sending = false;

  #focusClose(): void {
    this.renderRoot.querySelector<HTMLElement>("[data-test=preview-close]")?.focus();
  }

  focusAfterReprint(id: string): void {
    if (!this.open || this.job?.id !== id) return;
    const reprint = this.renderRoot.querySelector<HTMLElement>("[data-test=preview-reprint]");
    if (reprint) reprint.focus();
    else this.#focusClose();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.open || !this.shadowRoot) return;
    const focused = this.shadowRoot.activeElement;
    if (
      (!this.previous && focused?.matches("[data-test=preview-previous]")) ||
      (!this.next && focused?.matches("[data-test=preview-next]")) ||
      (!this.canReprint && focused?.matches("[data-test=preview-reprint]")) ||
      (changed.has("job") && focused?.matches(".paper-viewport") && this.loading)
    )
      this.#focusClose();
  }

  #step(direction: -1 | 1): void {
    if (!(direction === -1 ? this.previous : this.next)) return;
    this.dispatchEvent(new CustomEvent("preview-step", { detail: direction }));
  }

  #arrowKey(event: KeyboardEvent): void {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      target.matches(".paper-viewport") &&
      target.scrollWidth > target.clientWidth
    )
      return;
    event.preventDefault();
    if (!event.repeat) this.#step(event.key === "ArrowLeft" ? -1 : 1);
  }

  #summary(job: PrintJobRow) {
    const status = jobStatus(job);
    const time = job.deliveredAt ?? job.createdAt;
    return html`<div class="summary" aria-live="polite">
      <p class="printer-name" data-test="preview-printer">
        ${this.printerName}${job.kind === "a4" ? html` · ${t("printers.job_a4_invoice")}` : nothing}
      </p>
      <p class="job-meta">
        <span class="job-status" data-test="preview-status" data-status=${status}
          >${jobStatusName(status)}</span
        >
        <time datetime=${time} data-test="preview-time"
          >${t(job.deliveredAt === null ? "printers.queued_at" : "printers.delivered_at")}
          ${formatIsoMinute(time)}</time
        >
      </p>
      ${[jobErrorMessage(job), jobWaitMessage(job)].map((reason) =>
        reason === undefined
          ? nothing
          : html`<p class="reason" data-test="preview-reason">${reason}</p>`,
      )}
    </div>`;
  }

  #close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("preview-close", { bubbles: true, composed: true }));
  }

  override render() {
    const preview = this.preview;
    return html`
      <wt-modal
        size="standard"
        .open=${this.open}
        heading=${t("printers.preview_title")}
        @wt-close=${this.#close}
        @keydown=${this.#arrowKey}
      >
        ${this.job ? this.#summary(this.job) : nothing}
        <slot></slot>
        ${this.reprintError ? html`<p class="error" role="alert">${codeMessage(this.reprintError)}</p>` : nothing}
        ${this.loading ? html`<p role="status">${t("printers.preview_loading")}</p>` : nothing}
        ${this.error ? html`<p class="error" role="alert" data-test="preview-error">${codeMessage(this.error)}</p>` : nothing}
        ${
          preview?.kind === "a4"
            ? html`<div
                class="paper-viewport"
                tabindex="0"
                role="region"
                aria-label=${t("printers.preview_invoice_paper")}
              >
                ${preview.pages.map(
                  ({ data, width, height }, index) =>
                    html` <img
                      class="invoice-page"
                      src=${`data:image/png;base64,${data}`}
                      width=${width}
                      height=${height}
                      alt=${fill("printers.preview_invoice_page", { page: String(index + 1) })}
                    />`,
                )}
              </div>`
            : preview
              ? html`
                  ${preview.omittedGraphics ? html`<p>${t("printers.preview_graphics_omitted")}</p>` : nothing}
                  ${preview.truncated || preview.unsupported ? html`<p>${t("printers.preview_incomplete")}</p>` : nothing}
                  ${
                    preview.blocks.length
                      ? html`<div
                          class="paper-viewport"
                          tabindex="0"
                          role="region"
                          aria-label=${t("printers.preview_paper")}
                          style=${`--columns:${preview.columns};--roll-mm:${preview.columns <= columnsFor("58mm") ? 58 : 80}`}
                        >
                          ${this.#paper.render(preview)}
                        </div>`
                      : nothing
                  }
                  ${preview.qrData.map(
                    (data) =>
                      html`<section>
                        <h3>${t("printers.preview_qr_data")}</h3>
                        <p class="qr-data">${data}</p>
                      </section>`,
                  )}
                  ${preview.blocks.length === 0 && preview.qrData.length === 0 ? html`<p>${t("printers.preview_empty")}</p>` : nothing}
                `
              : nothing
        }
        <wt-form-actions slot="footer">
          <div slot="cancel" class="arrows">
            <wt-icon-button
              data-test="preview-previous"
              label=${t("printers.preview_previous")}
              icon="preview-left"
              ?disabled=${!this.previous}
              @click=${() => this.#step(-1)}
            ></wt-icon-button>
            <wt-icon-button
              data-test="preview-next"
              label=${t("printers.preview_next")}
              icon="preview-right"
              ?disabled=${!this.next}
              @click=${() => this.#step(1)}
            ></wt-icon-button>
          </div>
          <wt-button slot="secondary" data-test="preview-close" @click=${this.#close}
            >${t("action.close")}</wt-button
          >
          ${
            this.canReprint
              ? html`<wt-button
                  variant="primary"
                  data-test="preview-reprint"
                  ?loading=${this.sending}
                  @click=${() => this.dispatchEvent(new Event("preview-reprint"))}
                  >${t("printers.resend_job")}</wt-button
                >`
              : nothing
          }
        </wt-form-actions>
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-print-job-preview": PrintJobPreviewDialog;
  }
}
