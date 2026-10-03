import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi, DemoPrinterJob } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { PrintPaper, paperStyles } from "../widgets/print-paper.js";

@customElement("dashboard-demo-printer-screen")
export class DemoPrinterScreen extends LitElement {
  static override styles = [
    baseStyles,
    paperStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin-top: 0;
        font-size: var(--wt-font-size-lg);
      }
      .jobs {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-4);
        padding: 0;
        list-style: none;
      }
      .job {
        box-sizing: border-box;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        padding: var(--wt-space-4);
      }
      .paper-viewport {
        overflow: auto;
        max-width: 100%;
      }
      time {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private jobs: DemoPrinterJob[] = [];
  @state() private errorKey: string | null = null;
  readonly #papers = new Map<string, PrintPaper>();
  #timer?: ReturnType<typeof setInterval>;
  #loading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    this.#timer = setInterval(() => void this.#load(), 2_000);
  }

  override disconnectedCallback(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    if (this.#loading) return;
    this.#loading = true;
    try {
      const jobs = await (this.api.background ?? this.api).listDemoPrinterJobs();
      if (!this.isConnected) return;
      const currentIds = new Set(jobs.map((job) => job.id));
      for (const id of this.#papers.keys()) {
        if (!currentIds.has(id)) this.#papers.delete(id);
      }
      for (const job of jobs) {
        if (!this.#papers.has(job.id)) this.#papers.set(job.id, new PrintPaper());
      }
      this.jobs = jobs;
      this.errorKey = null;
    } catch (error) {
      if (this.isConnected) this.errorKey = codeOf(error);
    } finally {
      this.#loading = false;
    }
  }

  override render() {
    return html`
      <h1>${t("demo_printer.title")}</h1>
      <p>${t("demo_printer.explanation")}</p>
      <wt-button variant="secondary" @click=${() => void this.#load()}
        >${t("demo_printer.refresh")}</wt-button
      >
      ${
        this.errorKey === null
          ? nothing
          : html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
      }
      ${this.jobs.length === 0 ? html`<p>${t("demo_printer.empty")}</p>` : nothing}
      <ol class="jobs">
        ${this.jobs.map((job) => {
          const paper = this.#papers.get(job.id)!;
          return html`<li class="job" data-test="printed-job">
            <time datetime=${job.createdAt}>${new Date(job.createdAt).toLocaleString()}</time>
            ${
              job.kind === "drawer"
                ? html`<p>${t("demo_printer.drawer_opened")}</p>`
                : job.preview === null
                  ? nothing
                  : html`<div
                      class="paper-viewport"
                      role="region"
                      aria-label=${t("printers.preview_paper")}
                    >
                      ${paper.render(job.preview)}
                    </div>`
            }
          </li>`;
        })}
      </ol>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-demo-printer-screen": DemoPrinterScreen;
  }
}
