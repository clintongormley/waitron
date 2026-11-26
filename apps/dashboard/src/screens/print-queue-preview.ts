import { html, nothing } from "lit";
import type { DashboardApi } from "../api/client.js";
import type { PrintJobRow } from "../api/printing-api.js";
import { fill } from "../i18n/t.js";
import { codeOf } from "../i18n/codes.js";
import "../widgets/print-job-preview.js";

export const canViewPrintout = (job: PrintJobRow): boolean =>
  job.kind !== "drawer" && (job.kind !== "a4" || job.pageDocument === "invoice");

type PreviewStep = -1 | 1;
type Paper = Awaited<ReturnType<DashboardApi["getPrintJobPreview"]>>;

export class PrintQueuePreview {
  #order: readonly string[] = [];
  #read = 0;
  job: PrintJobRow | null = null;
  paper: Paper | null = null;
  loading = false;
  error: string | null = null;
  reprintError: string | null = null;

  constructor(private readonly changed: () => void) {}

  refresh(rows: PrintJobRow[]): void {
    if (this.job) this.job = rows.find((row) => row.id === this.job?.id) ?? this.job;
  }

  close(): void {
    ++this.#read;
    this.job = this.paper = this.error = null;
    this.loading = false;
    this.changed();
  }

  #neighbour(step: PreviewStep, rows: PrintJobRow[]): PrintJobRow | undefined {
    if (!this.job) return undefined;
    for (
      let index = this.#order.indexOf(this.job.id) + step;
      index >= 0 && index < this.#order.length;
      index += step
    ) {
      const row = rows.find(({ id }) => id === this.#order[index]);
      if (row && canViewPrintout(row)) return row;
    }
    return undefined;
  }

  async show(job: PrintJobRow, api: DashboardApi, openingOrder?: string[]): Promise<void> {
    const read = ++this.#read;
    if (openingOrder === undefined) {
      this.job = job;
      this.paper = this.error = null;
      this.loading = true;
      this.changed();
    }
    try {
      const paper = await api.getPrintJobPreview(job.id);
      if (read !== this.#read) return;
      if (openingOrder !== undefined) {
        this.#order = openingOrder;
        this.job = job;
      }
      this.paper = paper;
    } catch (error) {
      if (read !== this.#read) return;
      if (openingOrder !== undefined) throw error;
      this.error = codeOf(error);
    } finally {
      if (read === this.#read) {
        this.loading = false;
        this.changed();
      }
    }
  }

  render(
    rows: PrintJobRow[],
    api: DashboardApi,
    printerName: string,
    reprint: (job: PrintJobRow) => void,
    sending: ReadonlySet<string>,
    confirmation: ReturnType<typeof html> | typeof nothing,
  ) {
    const job = this.job;
    const previous = this.#neighbour(-1, rows);
    const next = this.#neighbour(1, rows);
    return html`<dashboard-print-job-preview
      .open=${job !== null}
      .preview=${this.paper}
      .job=${job}
      .printerName=${printerName}
      .loading=${this.loading}
      .error=${this.error}
      .reprintError=${this.reprintError}
      .previous=${previous !== undefined}
      .next=${next !== undefined}
      .canReprint=${job !== null && canViewPrintout(job) && job.canResend}
      .sending=${job !== null && sending.has(job.id)}
      @preview-close=${() => this.close()}
      @preview-step=${({ detail }: CustomEvent<PreviewStep>) => {
        const target = detail === -1 ? previous : next;
        if (target) void this.show(target, api);
      }}
      @preview-reprint=${() => {
        if (job) reprint(job);
      }}
      >${confirmation}</dashboard-print-job-preview
    >`;
  }
}

export function reprintNotice(printer: string | null, duration: number, gone: () => void) {
  if (printer === null) return nothing;
  return html`<wt-notice
    class="sent"
    data-test="reprint-sent"
    .duration=${duration}
    @wt-notice-gone=${gone}
    >${fill("printers.reprint_sent", { printer })}</wt-notice
  >`;
}
