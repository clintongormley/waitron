import type { DeleteImpact } from "@waitron/shared";
import { html, type ReactiveControllerHost, type TemplateResult } from "lit";
import { type DeleteDialogCopy } from "@waitron/ui";
import "@waitron/ui/src/components/wt-delete-dialog.js";
import type { DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

type ImpactQuery =
  | "getDeviceDeleteImpact"
  | "getReaderDeleteImpact"
  | "getPrinterDeleteImpact"
  | "getPagePrinterDeleteImpact";

interface HardwareDeleteActions {
  notFound: readonly string[];
  send(id: string, impact: DeleteImpact | null): Promise<unknown>;
  onGone(id: string, source: "read" | "send"): void | Promise<void>;
  beforeDeleted?(id: string): Promise<unknown> | undefined;
  onDeleted(id: string): void | Promise<void>;
  retryCode?: string;
}

export class HardwareDeleteDialog {
  readonly #queries: DashboardQueries;
  #opening: { id: string; query: ImpactQuery } | null = null;
  #opener: HTMLElement | null = null;
  #impact: DeleteImpact | null = null;
  #loading = false;
  #submitting = false;
  #readError = "";
  #actionError = "";

  constructor(
    private readonly host: ReactiveControllerHost,
    api: () => DashboardApi,
    private readonly actions: HardwareDeleteActions,
  ) {
    this.#queries = new DashboardQueries(host, api, (error) => this.#impactFailed(error));
  }

  get target(): string | null {
    return this.#opening?.id ?? null;
  }

  get submitting(): boolean {
    return this.#submitting;
  }

  open(id: string, opener: HTMLElement | null, query: ImpactQuery): void {
    this.close();
    this.#opening = { id, query };
    this.#opener = opener;
    this.retryImpact();
  }

  close(focusTo?: HTMLElement | null): void {
    if (!this.#opening) return;
    this.#queries.release(this.#opening.query);
    this.#opening = null;
    this.#opener = focusTo ?? this.#opener;
    this.#impact = null;
    this.#loading = false;
    this.#submitting = false;
    this.#readError = "";
    this.#actionError = "";
    this.host.requestUpdate();
  }

  retryImpact(): void {
    const opening = this.#opening;
    if (!opening || this.#submitting) return;
    this.#loading = true;
    this.#readError = "";
    this.host.requestUpdate();
    void this.#queries
      .watch(opening.query, [opening.id], (impact) => {
        this.#impact = impact;
        this.#loading = false;
        this.#readError = "";
        this.host.requestUpdate();
      })
      .catch(() => undefined);
  }

  #impactFailed(error: unknown): void {
    const opening = this.#opening;
    if (!opening) return;
    const code = codeOf(error);
    if (this.actions.notFound.includes(code)) {
      // The send in flight may be what removed the row; its own answer decides what to show.
      if (!this.#submitting) void this.actions.onGone(opening.id, "read");
      return;
    }
    this.#loading = false;
    this.#readError = codeMessage(code);
    this.host.requestUpdate();
  }

  async #confirm(id: string): Promise<void> {
    const opening = this.#opening;
    if (opening?.id !== id || this.#submitting) return;
    this.#submitting = true;
    this.#actionError = "";
    this.host.requestUpdate();
    try {
      await this.actions.send(id, this.#impact);
    } catch (error) {
      if (this.#opening !== opening) return;
      this.#submitting = false;
      this.host.requestUpdate();
      const code = codeOf(error);
      if (this.actions.notFound.includes(code)) {
        await this.actions.onGone(id, "send");
      } else if (code === this.actions.retryCode) {
        this.retryImpact();
      } else {
        this.#actionError = codeMessage(code);
      }
      return;
    }
    if (this.#opening !== opening) return;
    const redraw = this.actions.beforeDeleted?.(id);
    if (redraw) await redraw;
    if (this.#opening !== opening) return;
    await this.actions.onDeleted(id);
  }

  render(testId: string, copy: DeleteDialogCopy): TemplateResult {
    return html`<wt-delete-dialog
      data-test=${testId}
      .open=${this.#opening !== null}
      .impact=${this.#impact}
      .loading=${this.#loading}
      .submitting=${this.#submitting}
      .readError=${this.#readError}
      .actionError=${this.#actionError}
      .copy=${copy}
      .opener=${this.#opener}
      @wt-delete-confirm=${(event: CustomEvent<{ id: string }>) =>
        void this.#confirm(event.detail.id)}
      @wt-delete-retry=${() => this.retryImpact()}
      @wt-close=${() => this.close()}
    ></wt-delete-dialog>`;
  }
}
