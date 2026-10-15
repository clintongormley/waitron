import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtModal,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "./row-actions.js";
import type { DashboardApi, PagePrinterRow, PageTestPage } from "../api/client.js";
import { holdReason } from "../i18n/a4-holds.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";

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

/**
 * The location's office printers (A4 printers), with rename, disable and a test page. `reload` reads
 * the list again after a write and rejects when that read fails; the rows come back through `rows`.
 */
@customElement("dashboard-page-printers-panel")
export class PagePrintersPanel extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      section {
        display: grid;
        gap: var(--wt-space-4);
        margin-top: var(--wt-space-6);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      wt-data-table::part(page-printer-hint) {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .error {
        margin: 0;
        color: var(--wt-color-danger);
      }
      wt-data-table::part(page-printer-test-page) {
        display: block;
        font-size: var(--wt-font-size-sm);
        max-width: calc(2 * var(--wt-cell-name-max-width));
        white-space: normal;
      }
    `,
  ];

  @property({ attribute: false }) api?: Pick<
    DashboardApi,
    "updatePagePrinter" | "printPagePrinterTestPage"
  > & { background: Pick<DashboardApi, "readPagePrinterTestPage"> };
  @property({ attribute: false }) rows: PagePrinterRow[] = [];
  @property({ type: Boolean }) canManage = false;
  @property({ attribute: false }) reload!: () => Promise<void>;
  /** How long to wait between reads of a test page that is still out. */
  @property({ attribute: false }) testPagePollMs = 2_000;

  @state() private disabling = new Set<string>();
  @state() private testPageSending = new Set<string>();
  /** Each printer's last test page, by printer id. */
  @state() private testPages = new Map<string, PageTestPage>();
  @state() private actionError: string | null = null;
  @state() private readError: string | null = null;
  @state() private renaming: PagePrinterRow | null = null;
  @state() private renameName = "";
  @state() private renameAttempted = false;
  @state() private renameSending = false;
  @state() private renameRefused: { code: string; field: boolean } | null = null;

  /** One poll per printer; a read that returns after its poll was replaced is dropped. */
  /** The printer whose failed test-page read last set `readError`; another printer's successful read leaves it. */
  #readErrorFrom: string | null = null;
  readonly #testPagePolls = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
  readonly #renameId = {};
  #renameScope?: DraftScope<string>;
  #renameLeave?: LeaveCoordinator;
  #renameBaseline = "";
  readonly #beforeRenameClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.renameSending &&
    (!this.#renameLeave ||
      (await this.#renameLeave.request({ scopes: [this.#renameId], reason, proceed() {} })) ===
        "proceeded");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
    for (const [id, page] of this.testPages) if (isOut(page)) this.#pollTestPage(id);
  }

  override disconnectedCallback(): void {
    for (const { timer } of this.#testPagePolls.values()) clearTimeout(timer);
    this.#testPagePolls.clear();
    this.#renameScope?.dispose();
    this.#renameScope = undefined;
    this.#renameLeave = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("canManage") && !this.canManage) this.#closedRename();
    if (changes.has("rows")) this.readError = null;
    if (this.renaming !== null && this.isConnected && !this.#renameScope) {
      const { coordinator, scope } = draftScopeFor<string>(this, {
        id: this.#renameId,
        current: () => this.renameName,
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          this.renameName = value;
        },
      });
      this.#renameLeave = coordinator;
      this.#renameScope = scope;
      scope.commit(this.#renameBaseline);
    }
  }

  async #reread(): Promise<void> {
    try {
      await this.reload();
      this.readError = null;
    } catch (error) {
      this.readError = codeOf(error);
    }
    this.#readErrorFrom = null;
  }

  async #disable(row: PagePrinterRow): Promise<void> {
    if (!row.active || this.disabling.has(row.id)) return;
    this.actionError = null;
    this.disabling = new Set([...this.disabling, row.id]);
    try {
      await this.api!.updatePagePrinter(row.id, { active: false });
    } catch (error) {
      this.actionError = codeOf(error);
      return;
    } finally {
      this.disabling = new Set([...this.disabling].filter((id) => id !== row.id));
    }
    await this.#reread();
  }

  #setTestPage(id: string, page: PageTestPage | null): void {
    const pages = new Map(this.testPages);
    if (page === null) pages.delete(id);
    else pages.set(id, page);
    this.testPages = pages;
  }

  async #printTestPage(row: PagePrinterRow): Promise<void> {
    if (!row.active || this.testPageSending.has(row.id) || isOut(this.testPages.get(row.id)))
      return;
    this.actionError = null;
    this.testPageSending = new Set([...this.testPageSending, row.id]);
    let page: PageTestPage;
    try {
      page = await this.api!.printPagePrinterTestPage(row.id);
    } catch (error) {
      this.actionError = codeOf(error);
      return;
    } finally {
      this.testPageSending = new Set([...this.testPageSending].filter((id) => id !== row.id));
    }
    this.#setTestPage(row.id, page);
    if (isOut(page)) this.#pollTestPage(row.id);
  }

  #pollTestPage(id: string): void {
    if (this.#testPagePolls.has(id) || !this.isConnected) return;
    const poll = {
      timer: setTimeout(() => void this.#readTestPage(id, poll), this.testPagePollMs),
    };
    this.#testPagePolls.set(id, poll);
  }

  async #readTestPage(id: string, poll: object): Promise<void> {
    let page: PageTestPage | null | undefined;
    let failure: string | null = null;
    try {
      page = await this.api!.background.readPagePrinterTestPage(id);
    } catch (error) {
      failure = codeOf(error);
    }
    if (this.#testPagePolls.get(id) !== poll) return;
    this.#testPagePolls.delete(id);
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
    if (isOut(this.testPages.get(id))) this.#pollTestPage(id);
  }

  #printingNote(hold: PageTestPage["hold"]): string {
    if (hold === undefined) return t("printers.test_page_printing");
    const reason = holdReason(hold);
    return reason === undefined
      ? t("printers.test_page_held_no_reason")
      : fill("printers.test_page_held", { reason });
  }

  #testPageNote(row: PagePrinterRow): TemplateResult | typeof nothing {
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

  #openRename(row: PagePrinterRow): void {
    this.#renameScope?.dispose();
    this.#renameScope = undefined;
    this.#renameBaseline = row.name;
    this.renameName = row.name;
    this.renameAttempted = false;
    this.renameRefused = null;
    this.renaming = row;
  }

  #closedRename(): void {
    this.#renameScope?.dispose();
    this.#renameScope = undefined;
    this.#renameLeave = undefined;
    this.renaming = null;
  }

  #renameError(): string {
    if (this.renameAttempted && this.renameName.trim() === "") return t("form.name_required");
    return this.renameRefused?.field ? codeMessage(this.renameRefused.code) : "";
  }

  async #rename(): Promise<void> {
    const target = this.renaming;
    if (target === null || this.renameSending || saveActionState(this.#renameScope).unchanged)
      return;
    this.renameAttempted = true;
    this.renameRefused = null;
    const modal = this.shadowRoot!.querySelector<WtModal>("[data-test=rename-page-printer-modal]")!;
    const name = this.renameName.trim();
    if (name === "") {
      await this.updateComplete;
      void focusFirstInvalid(modal);
      return;
    }
    this.actionError = null;
    this.renameSending = true;
    try {
      await this.api!.updatePagePrinter(target.id, { name });
    } catch (error) {
      const field = (error as { params?: { field?: unknown } }).params?.field;
      this.renameRefused = {
        code: codeOf(error),
        field: codeOf(error) === "management.request_invalid" && field === "name",
      };
      return;
    } finally {
      this.renameSending = false;
    }
    this.#renameBaseline = this.renameName;
    this.#renameScope?.commit(this.renameName);
    modal.closeAfter("saved");
    await this.#reread();
  }

  #columns(): DataTableColumn<PagePrinterRow>[] {
    const columns: DataTableColumn<PagePrinterRow>[] = [
      {
        key: "name",
        label: t("printers.name"),
        cell: (row) =>
          html`<span data-test=${`page-printer-name-${row.id}`}>${row.name}</span
            >${this.#testPageNote(row)}`,
      },
      {
        key: "agent",
        label: t("printers.invoice_printer_agent"),
        cell: (row) =>
          html`<span data-test=${`page-printer-agent-${row.id}`}
            >${row.agentName ?? t("printers.invoice_printer_agent_gone")}</span
          >`,
      },
      {
        key: "address",
        label: t("printers.address"),
        cell: (row) =>
          html`<span data-test=${`page-printer-address-${row.id}`}
            >${row.host}:${row.port}${row.resourcePath}</span
          >`,
      },
      {
        key: "paper",
        label: t("printers.invoice_printer_paper"),
        cell: (row) =>
          html`<span data-test=${`page-printer-paper-${row.id}`}
            >${
              row.media === "iso_a4_210x297mm"
                ? t("printers.invoice_printer_a4")
                : t("printers.invoice_printer_letter")
            }</span
          >`,
      },
      {
        key: "status",
        label: t("printers.status"),
        cell: (row) =>
          html`<span data-test=${`page-printer-status-${row.id}`}
            >${row.active ? t("printers.status_active") : t("printers.status_disabled")}${
              row.active
                ? nothing
                : html`<span
                    part="page-printer-hint"
                    data-test=${`page-printer-rediscover-${row.id}`}
                    >${t("printers.invoice_printer_rediscover")}</span
                  >`
            }</span
          >`,
      },
    ];
    if (!this.canManage) return columns;
    return [
      ...columns,
      {
        key: "actions",
        label: t("printers.actions"),
        pinned: "end",
        cell: (row) => this.#actions(row),
      },
    ];
  }

  #actions(row: PagePrinterRow): TemplateResult {
    return html`<dashboard-row-actions .label=${fill("printers.row_actions", { name: row.name })}>
      <wt-button data-test=${`rename-page-printer-${row.id}`} @click=${() => this.#openRename(row)}
        >${t("printers.invoice_printer_rename")}</wt-button
      >
      <wt-button
        variant=${row.active ? "danger" : "secondary"}
        data-test=${`disable-page-printer-${row.id}`}
        ?disabled=${!row.active}
        ?loading=${this.disabling.has(row.id)}
        @click=${() => void this.#disable(row)}
        >${t("printers.disable")}</wt-button
      >
      <wt-button
        data-test=${`print-test-page-${row.id}`}
        ?disabled=${
          !row.active || this.testPageSending.has(row.id) || isOut(this.testPages.get(row.id))
        }
        ?loading=${this.testPageSending.has(row.id)}
        @click=${() => void this.#printTestPage(row)}
        >${t("printers.print_test_page")}</wt-button
      >
    </dashboard-row-actions>`;
  }

  #renderRename(): TemplateResult | typeof nothing {
    if (!this.canManage) return nothing;
    const target = this.renaming;
    const nameError = this.#renameError();
    const action = saveActionState(this.#renameScope);
    const refused =
      this.renameRefused !== null && !this.renameRefused.field ? this.renameRefused.code : null;
    return html`<wt-modal
      size="compact"
      data-test="rename-page-printer-modal"
      heading=${
        target === null
          ? ""
          : fill("printers.invoice_printer_rename_heading", { name: target.name })
      }
      .open=${target !== null}
      .beforeClose=${this.#beforeRenameClose}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector("[data-test=confirm-rename-page-printer]"),
        )}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closedRename();
      }}
    >
      <wt-input
        required
        name="name"
        autocomplete="off"
        label=${t("printers.name")}
        .value=${this.renameName}
        .invalid=${nameError !== ""}
        .error=${nameError}
        ?disabled=${this.renameSending}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.renameName = event.detail.value;
          if (this.renameRefused?.field) this.renameRefused = null;
          this.#renameScope?.changed();
        }}
      ></wt-input>
      <wt-form-actions
        slot="footer"
        data-test="rename-page-printer-actions"
        .error=${bottomMessage(refusal(refused), nameError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-rename-page-printer"
          ?disabled=${this.renameSending}
          @click=${() =>
            void this.shadowRoot!.querySelector<WtModal>(
              "[data-test=rename-page-printer-modal]",
            )!.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="confirm-rename-page-printer"
          variant=${action.variant}
          ?loading=${this.renameSending}
          ?disabled=${action.unchanged || nameError !== ""}
          @click=${() => void this.#rename()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }

  override render() {
    if (this.rows.length === 0) return nothing;
    return html`<section data-test="page-printers-panel">
        <h2>${t("printers.invoice_printers_title")}</h2>
        <wt-data-table
          data-test="page-printers-table"
          aria-label=${t("printers.invoice_printers_title")}
          .rows=${this.rows}
          .columns=${this.#columns()}
          .rowKey=${(row: PagePrinterRow) => row.id}
        ></wt-data-table>
        ${
          this.actionError === null
            ? nothing
            : html`<p class="error" role="alert" data-test="page-printers-action-error">
                ${codeMessage(this.actionError)}
              </p>`
        }
        ${
          this.readError === null
            ? nothing
            : html`<p class="error" role="alert" data-test="page-printers-read-error">
                ${t("printers.refresh_failed")} ${codeMessage(this.readError)}
              </p>`
        }
      </section>
      ${this.#renderRename()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-page-printers-panel": PagePrintersPanel;
  }
}
