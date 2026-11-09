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
import type { DashboardApi, PagePrinterRow } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { PageTestPages } from "./page-test-pages.js";

/**
 * The venue's office printers (A4 printers), with rename, disable and a test page. `reload` reads
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
  /** The screen's test pages, so the panel and the details follow one page; the panel's own without. */
  @property({ attribute: false }) testPages?: PageTestPages;

  @state() private disabling = new Set<string>();
  @state() private renaming: PagePrinterRow | null = null;
  @state() private renameName = "";
  @state() private renameAttempted = false;
  @state() private renameSending = false;
  @state() private renameRefused: { code: string; field: boolean } | null = null;

  readonly #ownPages = new PageTestPages(this, {
    api: () => this.api,
    pollMs: () => this.testPagePollMs,
  });
  #unwatchPages?: () => void;
  get #pages(): PageTestPages {
    return this.testPages ?? this.#ownPages;
  }
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
    if (this.testPages) this.#unwatchPages = this.testPages.watch(this);
  }

  override disconnectedCallback(): void {
    this.#unwatchPages?.();
    this.#unwatchPages = undefined;
    this.#renameScope?.dispose();
    this.#renameScope = undefined;
    this.#renameLeave = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("canManage") && !this.canManage) this.#closedRename();
    if (changes.has("testPages") && this.isConnected) {
      this.#unwatchPages?.();
      this.#unwatchPages = this.testPages?.watch(this);
    }
    if (changes.has("rows")) this.#pages.readError = null;
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

  #reread(): Promise<void> {
    return this.#pages.reread(this.reload);
  }

  async #disable(row: PagePrinterRow): Promise<void> {
    if (!row.active || this.disabling.has(row.id)) return;
    this.#pages.setActionError(null);
    this.disabling = new Set([...this.disabling, row.id]);
    try {
      await this.api!.updatePagePrinter(row.id, { active: false });
    } catch (error) {
      this.#pages.setActionError(codeOf(error));
      return;
    } finally {
      this.disabling = new Set([...this.disabling].filter((id) => id !== row.id));
    }
    await this.#reread();
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
    this.#pages.setActionError(null);
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
            >${this.#pages.noteFor(row)}`,
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
        ?disabled=${this.#pages.unavailable(row)}
        ?loading=${this.#pages.sending.has(row.id)}
        @click=${() => void this.#pages.print(row)}
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
          this.#pages.actionError === null
            ? nothing
            : html`<p class="error" role="alert" data-test="page-printers-action-error">
                ${codeMessage(this.#pages.actionError)}
              </p>`
        }
        ${
          this.#pages.readError === null
            ? nothing
            : html`<p class="error" role="alert" data-test="page-printers-read-error">
                ${t("printers.refresh_failed")} ${codeMessage(this.#pages.readError)}
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
