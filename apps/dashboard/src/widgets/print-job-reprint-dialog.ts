import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi, PrintJobRow, Printer } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { fill, t } from "../i18n/t.js";

/** Asks which printer a print-queue job is reprinted on, from what its row already says. Its one
 * input starts chosen, so it holds no draft (as the Orders screen's reprint dialog). Sends a
 * bubbling, composed `reprinted` naming the printer once the server has it, and `reprint-close`
 * when the person closes it. */
@customElement("dashboard-print-job-reprint-dialog")
export class PrintJobReprintDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p {
        margin-block: var(--wt-space-3);
      }
      .rule {
        margin-block-end: 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];
  @property({ attribute: false }) api!: Pick<DashboardApi, "resendPrintJob">;
  @property({ attribute: false }) job: PrintJobRow | null = null;
  /** The screen's receipt printers. */
  @property({ attribute: false }) printers: Printer[] = [];
  @state() private printerId = "";
  @state() private sending = false;
  @state() private errorKey: string | null = null;
  /** Counts openings, so an answer for an earlier job never updates this one. */
  #opening = 0;

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("job")) return;
    this.#opening += 1;
    this.sending = false;
    this.errorKey = null;
    this.printerId = this.#original()?.id ?? "";
  }

  /** The job's own printer, offered while it is active and the job is not stuck on it. */
  #original(): Printer | undefined {
    const job = this.job;
    if (job === null || job.stuck) return undefined;
    return this.printers.find((printer) => printer.id === job.printerId && printer.active);
  }

  #offers(): Printer[] {
    const ids = new Set(this.job?.reprintPrinterIds ?? []);
    const others = this.printers
      .filter((printer) => ids.has(printer.id) && printer.id !== this.job?.printerId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const original = this.#original();
    return original ? [original, ...others] : others;
  }

  async #send(offers: Printer[]): Promise<void> {
    if (this.job === null || this.printerId === "" || this.sending) return;
    const opening = this.#opening;
    const printerId = this.printerId;
    const printerName = offers.find((printer) => printer.id === printerId)?.name ?? "";
    this.sending = true;
    this.errorKey = null;
    try {
      await this.api.resendPrintJob(this.job.id, printerId);
      if (opening !== this.#opening) return;
      this.dispatchEvent(
        new CustomEvent("reprinted", { detail: { printerName }, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (opening === this.#opening) this.errorKey = codeOf(error);
    } finally {
      if (opening === this.#opening) this.sending = false;
    }
  }

  #renderChoice(job: PrintJobRow, offers: Printer[]) {
    if (offers.length === 0)
      return html`<p data-test="reprint-nowhere">
        ${fill(
          job.reprintRule === "own" ? "printers.reprint_original_off" : "printers.reprint_none",
          {
            printer: job.printerName,
          },
        )}
      </p>`;
    const rule =
      job.reprintRule === "wide_enough"
        ? t("printers.reprint_wide_enough")
        : job.reprintRule === "own"
          ? t("printers.reprint_own_only")
          : "";
    return html`${
        job.stuck
          ? html`<p data-test="reprint-stuck">
              ${fill("printers.reprint_stuck", { printer: job.printerName })}
            </p>`
          : nothing
      }<wt-combobox
        name="printerId"
        search="auto"
        required
        label=${t("printers.reprint_printer")}
        .options=${offers.map((printer) => ({ value: printer.id, label: printer.name }))}
        .value=${this.printerId}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.printerId = event.detail.value;
          this.errorKey = null;
        }}
      ></wt-combobox
      >${rule === "" ? nothing : html`<p class="rule" data-test="reprint-rule">${rule}</p>`}`;
  }

  override render() {
    const job = this.job;
    const offers = this.#offers();
    const chosen = this.printerId !== "";
    return html`<wt-dialog
      .open=${job !== null}
      heading=${t("printers.resend_job")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget)
          this.dispatchEvent(new CustomEvent("reprint-close", { bubbles: true, composed: true }));
      }}
    >
      ${job === null ? nothing : this.#renderChoice(job, offers)}
      <wt-form-actions slot="footer" .error=${bottomMessage(refusal(this.errorKey))}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="reprint-cancel"
          @click=${() =>
            void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="reprint-send"
          variant=${chosen || this.sending ? "primary" : "secondary"}
          ?disabled=${!chosen}
          ?loading=${this.sending}
          @click=${() => void this.#send(offers)}
          >${t("printers.resend_job")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-print-job-reprint-dialog": PrintJobReprintDialog;
  }
}
