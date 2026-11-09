import { html, nothing, type ReactiveController, type ReactiveControllerHost } from "lit";
import type { TemplateResult } from "lit";
import type { DashboardApi, PagePrinterRow, PageTestPage } from "../api/client.js";
import { holdReason } from "../i18n/a4-holds.js";
import { codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

const TEST_PAGE_REASON: Record<NonNullable<PageTestPage["failureCode"]>, StringKey> = {
  printer_refused: "printers.test_page_reason_refused",
  printer_unreachable: "printers.test_page_reason_unreachable",
  document_unavailable: "printers.test_page_reason_document",
  printer_disabled: "printers.test_page_reason_disabled",
  not_claimed: "printers.test_page_reason_not_claimed",
  printer_aborted: "printers.test_page_reason_aborted",
  timeout: "printers.test_page_reason_timeout",
};

const isOut = (page: PageTestPage | null | undefined): boolean =>
  page?.status === "waiting" || page?.status === "printing";

export type PageTestPagesApi = Pick<DashboardApi, "printPagePrinterTestPage"> & {
  background: Pick<DashboardApi, "readPagePrinterTestPage">;
};

/**
 * Each A4 printer's last test page, followed by passive reads while it is out. Polls stop while the
 * host is off the page and resume when it is put back. `readError` holds the last failed read —
 * a test page's, or a list read passed through `reread` — and `actionError` the last refusal.
 */
export class PageTestPages implements ReactiveController {
  /** Each printer's last test page, by printer id. */
  testPages = new Map<string, PageTestPage>();
  sending = new Set<string>();
  actionError: string | null = null;
  /** The printer whose test page `actionError` refused; null when another action set it. */
  actionErrorFrom: string | null = null;
  readError: string | null = null;

  /** The printer whose failed test-page read last set `readError`; another printer's successful read leaves it. */
  #readErrorFrom: string | null = null;
  /** One poll per printer; a read that returns after its poll was replaced is dropped. */
  readonly #polls = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #viewers = new Set<ReactiveControllerHost>();
  readonly #api: () => PageTestPagesApi | undefined;
  readonly #pollMs: () => number;

  constructor(
    host: ReactiveControllerHost & HTMLElement,
    options: { api: () => PageTestPagesApi | undefined; pollMs: () => number },
  ) {
    this.#host = host;
    this.#api = options.api;
    this.#pollMs = options.pollMs;
    host.addController(this);
  }

  /** Another element drawing this state, redrawn with the host. Returns the way to stop. */
  watch(viewer: ReactiveControllerHost): () => void {
    this.#viewers.add(viewer);
    return () => this.#viewers.delete(viewer);
  }

  hostConnected(): void {
    for (const [id, page] of this.testPages) if (isOut(page)) this.#poll(id);
  }

  hostDisconnected(): void {
    for (const { timer } of this.#polls.values()) clearTimeout(timer);
    this.#polls.clear();
  }

  #changed(): void {
    this.#host.requestUpdate();
    for (const viewer of this.#viewers) viewer.requestUpdate();
  }

  /** Whether the row's Print test page is unavailable: disabled, being sent, or its page still out. */
  unavailable(row: PagePrinterRow): boolean {
    return !row.active || this.sending.has(row.id) || isOut(this.testPages.get(row.id));
  }

  setActionError(code: string | null): void {
    this.actionError = code;
    this.actionErrorFrom = null;
    this.#changed();
  }

  clearReadError(): void {
    this.readError = null;
    this.#changed();
  }

  /** A list read: its failure replaces `readError`, its success clears it. */
  async reread(reload: () => Promise<void>): Promise<void> {
    try {
      await reload();
      this.readError = null;
    } catch (error) {
      this.readError = codeOf(error);
    }
    this.#readErrorFrom = null;
    this.#changed();
  }

  #setTestPage(id: string, page: PageTestPage | null): void {
    const pages = new Map(this.testPages);
    if (page === null) pages.delete(id);
    else pages.set(id, page);
    this.testPages = pages;
  }

  async print(row: PagePrinterRow): Promise<void> {
    if (this.unavailable(row)) return;
    this.actionError = null;
    this.actionErrorFrom = null;
    this.sending = new Set([...this.sending, row.id]);
    this.#changed();
    let page: PageTestPage;
    try {
      page = await this.#api()!.printPagePrinterTestPage(row.id);
    } catch (error) {
      this.actionError = codeOf(error);
      this.actionErrorFrom = row.id;
      return;
    } finally {
      this.sending = new Set([...this.sending].filter((id) => id !== row.id));
      this.#changed();
    }
    this.#setTestPage(row.id, page);
    this.#changed();
    if (isOut(page)) this.#poll(row.id);
  }

  #poll(id: string): void {
    if (this.#polls.has(id) || !this.#host.isConnected) return;
    const poll = {
      timer: setTimeout(() => void this.#read(id, poll), this.#pollMs()),
    };
    this.#polls.set(id, poll);
  }

  async #read(id: string, poll: object): Promise<void> {
    let page: PageTestPage | null | undefined;
    let failure: string | null = null;
    try {
      page = await this.#api()!.background.readPagePrinterTestPage(id);
    } catch (error) {
      failure = codeOf(error);
    }
    if (this.#polls.get(id) !== poll) return;
    this.#polls.delete(id);
    if (failure !== null) {
      this.readError = failure;
      this.#readErrorFrom = id;
    } else {
      if (this.#readErrorFrom === id) {
        this.readError = null;
        this.#readErrorFrom = null;
      }
      this.#setTestPage(id, page!);
    }
    this.#changed();
    if (isOut(this.testPages.get(id))) this.#poll(id);
  }

  #printingNote(hold: PageTestPage["hold"]): string {
    if (hold === undefined) return t("printers.test_page_printing");
    const reason = holdReason(hold);
    return reason === undefined
      ? t("printers.test_page_held_no_reason")
      : fill("printers.test_page_held", { reason });
  }

  /** The row's last test page in words, or nothing before one is sent. */
  noteFor(row: PagePrinterRow): TemplateResult | typeof nothing {
    const page = this.testPages.get(row.id);
    if (page === undefined) return nothing;
    const reason = page.failureCode === undefined ? "" : t(TEST_PAGE_REASON[page.failureCode]);
    const note = {
      waiting: t("printers.test_page_waiting"),
      printing: this.#printingNote(page.hold),
      sent: t("printers.test_page_printed"),
      failed: fill("printers.test_page_failed", { reason }),
      unknown: fill("printers.test_page_unknown", { reason }),
    }[page.status];
    return html`<span
      part="page-printer-test-page"
      role="status"
      data-test=${`page-printer-test-page-${row.id}`}
      >${note}</span
    >`;
  }
}
