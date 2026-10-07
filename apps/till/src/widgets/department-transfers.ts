import { staffPresentationName } from "@waitron/catalogue/src/product-presentation.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import type {
  DepartmentTransfer,
  DepartmentTransferDetail,
  ServiceZoneSummary,
  TableState,
  TillApi,
} from "../api/client.js";
import type { TransferSnapshot } from "../state/department-transfer-monitor.js";
import { limited } from "../state/draft-sync.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-textarea.js";

const statusKeys = {
  pending: "department_transfer.pending",
  accepted: "department_transfer.accepted",
  declined: "department_transfer.declined",
  withdrawn: "department_transfer.withdrawn",
} as const;

@customElement("till-department-transfers")
export class TillDepartmentTransfers extends LitElement {
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
      .notices {
        padding: var(--wt-space-3) var(--wt-space-4);
        border-bottom: 1px solid var(--wt-color-border);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) 0;
      }
      .description {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      h3 {
        font-size: var(--wt-font-size-md);
        margin: var(--wt-space-4) 0 var(--wt-space-2);
      }
      p {
        margin: var(--wt-space-2) 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  @property({ attribute: false }) snapshot!: TransferSnapshot;
  @property({ attribute: false }) serviceZones: ServiceZoneSummary[] = [];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) currentTabId?: string;
  @property() currentTabLabel = "";
  @state() private selected?: string;
  @state() private detail?: DepartmentTransferDetail;
  @state() private loading = false;
  @state() private error = "";
  #read?: AbortController;
  @state() private action?: "accept" | "decline" | "request";
  @state() private destinationDepartmentId = "";
  @state() private requested?: DepartmentTransfer;
  @state() private destinations: { id: string; name: string }[] = [];
  @state() private zoneId = "";
  @state() private tableId = "";
  @state() private reason = "";
  @state() private tables: TableState[] = [];
  @state() private attempted = false;
  @state() private busy = false;
  @state() private fieldRefusal?: { field: string; message: string };
  @state() private actionError = "";
  #scope?: DraftScope<string[]>;
  #leave?: LeaveCoordinator;
  #write?: object;
  #saving = false;
  #tableRead?: AbortController;
  @state() private tableReadError = "";
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.#saving) return false;
    return (
      !this.#leave ||
      (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };

  #draft(): string[] {
    return [this.zoneId, this.tableId, this.reason.trim(), this.destinationDepartmentId];
  }

  #resetAction(): void {
    this.#tableRead?.abort();
    this.#tableRead = undefined;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#write = undefined;
    this.#saving = false;
    this.action = undefined;
    this.zoneId = "";
    this.destinationDepartmentId = "";
    this.destinations = [];
    this.tableId = "";
    this.reason = "";
    this.tables = [];
    this.attempted = false;
    this.busy = false;
    this.fieldRefusal = undefined;
    this.actionError = "";
    this.tableReadError = "";
  }

  #senderRows(): DepartmentTransfer[] {
    const rows = this.snapshot.sent;
    return this.requested && !rows.some((row) => row.id === this.requested!.id)
      ? [this.requested, ...rows]
      : rows;
  }

  #canRequest(): boolean {
    return (
      this.currentTabId !== undefined &&
      !this.#senderRows().some((row) => row.tabId === this.currentTabId && row.status === "pending")
    );
  }

  #begin(action: "accept" | "decline" | "request"): void {
    if (
      !this.isConnected ||
      this.busy ||
      !this.open ||
      (action === "request" ? !this.#canRequest() : !this.detail)
    )
      return;
    if (action === "request") this.#clearDetail();
    this.#resetAction();
    this.action = action;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<string[]>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => [...value],
      equal: (a, b) => a.every((value, index) => value === b[index]),
      restore: (value) => {
        [this.zoneId, this.tableId, this.reason, this.destinationDepartmentId] = value as [
          string,
          string,
          string,
          string,
        ];
      },
    });
    this.#scope?.commit(this.#draft());
    if (action !== "decline") void this.#loadChoices();
  }

  async #loadChoices(): Promise<void> {
    if (!this.isConnected || (this.action !== "accept" && this.action !== "request") || this.busy)
      return;
    const identity = {};
    this.#write = identity;
    this.busy = true;
    this.tableReadError = "";
    const read = new AbortController();
    this.#tableRead = read;
    const limit = limited(25_000, read.signal);
    let cancel = (): void => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Transfer choices cancelled", "AbortError"));
      limit.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      const choices = await Promise.race([
        this.action === "request"
          ? this.api.listDepartmentTransferDestinations({ signal: limit.signal })
          : this.api.getTablesState({ signal: limit.signal }),
        cancelled,
      ]);
      if (this.#write === identity) {
        if (Array.isArray(choices)) this.tables = choices;
        else this.destinations = choices.destinations;
      }
    } catch (error) {
      if (this.#write === identity) this.tableReadError = this.#message(error);
    } finally {
      limit.signal.removeEventListener("abort", cancel);
      limit.done();
      if (this.#write === identity) this.busy = false;
    }
  }

  #message(error: unknown): string {
    return codeMessage(
      error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : "server.internal",
    );
  }

  #validZone(): boolean {
    return this.serviceZones.some(
      (zone) =>
        zone.id === this.zoneId &&
        zone.departmentId === this.detail?.request.destinationDepartmentId,
    );
  }

  #invalid(): boolean {
    return this.action === "request"
      ? !this.destinations.some((row) => row.id === this.destinationDepartmentId)
      : this.action === "accept"
        ? !this.#validZone() || !this.#validTable()
        : !this.reason.trim();
  }

  #validTable(): boolean {
    return (
      this.tableId === "" ||
      this.tables.some((table) => table.id === this.tableId && table.zoneId === this.zoneId)
    );
  }

  #change(
    field: "zoneId" | "tableId" | "reason" | "destinationDepartmentId",
    event: CustomEvent<{ value: string }>,
  ): void {
    event.stopPropagation();
    if (!this.isConnected || !this.action || this.busy) return;
    this[field] = event.detail.value;
    if (field === "zoneId") this.tableId = "";
    if (this.fieldRefusal?.field === field) this.fieldRefusal = undefined;
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    if (
      !this.isConnected ||
      this.busy ||
      !this.action ||
      !this.open ||
      (this.action === "request" ? !this.#canRequest() : !this.detail)
    )
      return;
    this.attempted = true;
    this.fieldRefusal = undefined;
    this.actionError = "";
    if (this.#invalid()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const identity = {};
    this.#write = identity;
    this.busy = true;
    const detail = this.detail!;
    const tabId = this.currentTabId;
    this.#saving = true;
    try {
      let requestId: string;
      if (this.action === "request") {
        const request = await this.api.requestDepartmentTransfer(
          tabId!,
          this.destinationDepartmentId,
        );
        requestId = request.id;
        if (this.#write === identity) this.requested = request;
      } else {
        requestId = detail.request.id;
        if (this.action === "accept")
          await this.api.acceptDepartmentTransfer(detail.request.id, {
            revision: detail.tab.revision,
            zoneId: this.zoneId,
            tableId: this.tableId || null,
          });
        else await this.api.declineDepartmentTransfer(detail.request.id, this.reason.trim());
      }
      if (this.#write !== identity) return;
      this.#scope?.commit(this.#draft());
      this.#clearDetail();
      this.#emit("transfer-changed", { requestId });
    } catch (error) {
      if (this.#write !== identity) return;
      const message = this.#message(error);
      const field =
        this.action === "request" &&
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "department_transfer.desk_unavailable" &&
        "departmentId" in error &&
        error.departmentId === this.destinationDepartmentId
          ? "destinationDepartmentId"
          : error !== null && typeof error === "object" && "field" in error
            ? error.field
            : undefined;
      if (
        typeof field === "string" &&
        (this.action === "request"
          ? field === "destinationDepartmentId"
          : this.action === "accept"
            ? ["zoneId", "tableId"].includes(field)
            : field === "reason")
      )
        this.fieldRefusal = { field, message };
      else this.actionError = message;
    } finally {
      if (this.#write === identity) {
        this.busy = false;
        this.#saving = false;
      }
    }
  }

  async #cancelAction(): Promise<void> {
    if (await this.#beforeClose("cancel")) this.#resetAction();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("api")) this.requested = undefined;
    if (
      changed.has("api") ||
      (this.action === "request" && (changed.has("currentTabId") || !this.#canRequest())) ||
      (changed.has("open") && !this.open) ||
      (this.selected !== undefined && this.snapshot.receivingAllowed !== true) ||
      (this.selected !== undefined &&
        !this.snapshot.incoming.some((row) => row.id === this.selected))
    ) {
      this.#clearDetail();
    }
  }

  override disconnectedCallback(): void {
    this.requested = undefined;
    this.#clearDetail();
    super.disconnectedCallback();
  }

  #emit(type: string, detail?: { requestId: string }): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #clearDetail(): void {
    this.#resetAction();
    this.#read?.abort();
    this.#read = undefined;
    this.selected = undefined;
    this.detail = undefined;
    this.loading = false;
    this.error = "";
  }

  #close(): void {
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel");
  }

  async #view(requestId: string): Promise<void> {
    if (this.action && !(await this.#beforeClose("navigation"))) return;
    if (!this.isConnected || !this.open) return;
    this.#clearDetail();
    this.selected = requestId;
    this.loading = true;
    const read = new AbortController();
    this.#read = read;
    const limit = limited(25_000, read.signal);
    let cancel = (): void => {};
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Transfer read cancelled", "AbortError"));
      limit.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      const detail = await Promise.race([
        this.api.getDepartmentTransfer(requestId, { signal: limit.signal }),
        cancelled,
      ]);
      if (this.#read === read) this.detail = detail;
    } catch (error) {
      if (this.#read !== read) return;
      const code =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "server.internal";
      this.error = codeMessage(code);
    } finally {
      limit.signal.removeEventListener("abort", cancel);
      limit.done();
      if (this.#read === read) this.loading = false;
    }
  }

  async #withdraw(row: DepartmentTransfer): Promise<void> {
    if (
      !this.isConnected ||
      !this.open ||
      this.busy ||
      this.action ||
      !this.#senderRows().some((current) => current.id === row.id && current.status === "pending")
    )
      return;
    const identity = {};
    this.#write = identity;
    this.busy = true;
    this.#saving = true;
    this.actionError = "";
    try {
      const result = await this.api.withdrawDepartmentTransfer(row.id);
      if (this.#write === identity && this.requested?.id === row.id) this.requested = result;
      if (this.#write === identity) this.#emit("transfer-changed", { requestId: row.id });
    } catch (error) {
      if (this.#write === identity) this.actionError = this.#message(error);
    } finally {
      if (this.#write === identity) {
        this.busy = false;
        this.#saving = false;
      }
    }
  }

  #summary(row: DepartmentTransfer, incoming: boolean) {
    return html`<div class="description">
      <p>${incoming ? t("department_transfer.incoming_notice") : t(statusKeys[row.status])}</p>
      ${
        row.summary === undefined
          ? nothing
          : html`<p>
                ${t("department_transfer.tab").replace("{number}", String(row.summary.orderNumber))}${row.summary.tabLabel === null ? "" : ` — ${row.summary.tabLabel}`}
              </p>
              <p>${row.summary.sourceDepartmentName} → ${row.summary.destinationDepartmentName}</p>`
      }
      <time datetime=${row.createdAt}
        >${new Intl.DateTimeFormat(currentLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(row.createdAt))}</time
      >
      ${row.reason === null ? nothing : html`<p>${row.reason}</p>`}
    </div>`;
  }

  #currentTab() {
    if (this.selected === undefined) return nothing;
    const detail = this.detail;
    return html`<section>
      ${this.loading ? html`<p role="status">${t("login.loading")}</p>` : nothing}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      ${
        detail === undefined
          ? nothing
          : html`
              <h3 data-current-tab>
                ${t("department_transfer.tab").replace("{number}", String(detail.tab.orderNumber))}${detail.tab.label === null ? "" : ` — ${detail.tab.label}`}
              </h3>
              <h3>${t("department_transfer.lines")}</h3>
              <ul data-current-lines>
                ${detail.lines.map((line) => html`<li><div class="description">${line.quantity} × ${staffPresentationName(line)}${line.note === null ? nothing : html`<p>${line.note}</p>`}</div></li>`)}
              </ul>
              <h3>${t("department_transfer.work")}</h3>
              <ul data-current-work>
                ${detail.outstandingWork.map(
                  (work) =>
                    html`<li>
                      <div class="description">
                        ${(() => {
                          const line = detail.lines.find((line) => line.id === work.lineId);
                          return line === undefined
                            ? t("department_transfer.unrecorded_item")
                            : staffPresentationName(line);
                        })()}
                        · ${work.stationName ?? t("department_transfer.unrecorded_station")} ·
                        ${t(`station.state.${work.state}`)}${work.note === null ? nothing : html`<p>${work.note}</p>`}
                      </div>
                    </li>`,
                )}
              </ul>
              ${detail.outstandingWork.length === 0 ? html`<p>${t("department_transfer.no_work")}</p>` : nothing}
            `
      }
      ${detail === undefined ? nothing : this.action ? this.#actionForm() : html`<wt-button data-accept @click=${() => this.#begin("accept")}>${t("department_transfer.accept")}</wt-button><wt-button data-decline variant="secondary" @click=${() => this.#begin("decline")}>${t("department_transfer.decline")}</wt-button>`}
      ${
        this.action
          ? nothing
          : html`<wt-button
              data-refresh-detail
              variant="secondary"
              ?disabled=${this.loading}
              @click=${() => void this.#view(this.selected!)}
              >${t("department_transfer.refresh")}</wt-button
            >`
      }
    </section>`;
  }

  #actionForm() {
    const zoneError =
      this.attempted && !this.#validZone()
        ? t("department_transfer.choose_zone")
        : this.fieldRefusal?.field === "zoneId"
          ? this.fieldRefusal.message
          : "";
    const tableError =
      this.attempted && !this.#validTable()
        ? t("department_transfer.choose_table")
        : this.fieldRefusal?.field === "tableId"
          ? this.fieldRefusal.message
          : "";
    const reasonError =
      this.attempted && !this.reason.trim()
        ? t("department_transfer.reason_required")
        : this.fieldRefusal?.field === "reason"
          ? this.fieldRefusal.message
          : "";
    const destinationError =
      this.attempted && this.action === "request" && this.#invalid()
        ? t("department_transfer.choose_department")
        : this.fieldRefusal?.field === "destinationDepartmentId"
          ? this.fieldRefusal.message
          : "";
    const marked =
      this.action === "request"
        ? destinationError
        : this.action === "accept"
          ? zoneError || tableError
          : reasonError;
    return html`<div
      class="fields"
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-save-transfer]"))}
    >
      ${
        this.action === "request"
          ? html`<p>${this.currentTabLabel || t("department_transfer.current_tab")}</p>
              <p>${t("department_transfer.source_responsible")}</p>
              <wt-combobox
                name="destinationDepartmentId"
                required
                search="never"
                .label=${t("department_transfer.department")}
                .value=${this.destinationDepartmentId}
                .options=${this.destinations.map((row) => ({ value: row.id, label: row.name }))}
                .error=${destinationError}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("destinationDepartmentId", event)}
              ></wt-combobox>`
          : this.action === "accept"
            ? html`<wt-combobox
                  name="zoneId"
                  required
                  search="never"
                  .label=${t("department_transfer.zone")}
                  .value=${this.zoneId}
                  .options=${this.serviceZones.filter((zone) => zone.departmentId === this.detail!.request.destinationDepartmentId).map((zone) => ({ value: zone.id, label: zone.name }))}
                  .error=${zoneError}
                  ?disabled=${this.busy}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("zoneId", event)}
                ></wt-combobox>
                <wt-combobox
                  name="tableId"
                  search="never"
                  .label=${t("department_transfer.table")}
                  .value=${this.tableId}
                  .options=${[{ value: "", label: t("department_transfer.no_table") }, ...this.tables.filter((table) => table.zoneId === this.zoneId).map((table) => ({ value: table.id, label: table.label }))]}
                  .error=${tableError}
                  ?disabled=${this.busy || !this.#validZone()}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("tableId", event)}
                ></wt-combobox>`
            : html`<wt-textarea
                name="reason"
                required
                .label=${t("department_transfer.reason")}
                .value=${this.reason}
                .error=${reasonError}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change("reason", event)}
              ></wt-textarea>`
      }
      ${
        this.tableReadError
          ? html`<p class="error" role="alert">${this.tableReadError}</p>
              <wt-button
                data-retry-tables
                variant="secondary"
                ?disabled=${this.busy}
                @click=${() => void this.#loadChoices()}
                >${t(this.action === "request" ? "department_transfer.retry_destinations" : "department_transfer.retry_tables")}</wt-button
              >`
          : nothing
      }
      <wt-form-actions
        data-transfer-actions
        .error=${[marked ? t("form.fix_fields") : "", this.actionError].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          data-cancel-transfer
          variant="secondary"
          ?disabled=${this.#saving}
          @click=${() => void this.#cancelAction()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-save-transfer
          ?disabled=${this.busy || (this.attempted && this.#invalid())}
          @click=${() => void this.#save()}
          >${t("department_transfer.save")}</wt-button
        >
      </wt-form-actions>
    </div>`;
  }

  override render() {
    const snapshot = this.snapshot;
    if (snapshot === undefined) return nothing;
    return html`
      ${
        snapshot.notifications.length === 0
          ? nothing
          : html`<section class="notices" aria-label=${t("department_transfer.notifications")}>
              <ul aria-live="polite">
                ${snapshot.notifications.map(
                  (row) =>
                    html`<li data-notification=${row.id}>
                      ${this.#summary(
                        row,
                        snapshot.incoming.some((incoming) => incoming.id === row.id),
                      )}<wt-button
                        data-dismiss
                        variant="secondary"
                        @click=${() => this.#emit("dismiss-transfer", { requestId: row.id })}
                        >${t("department_transfer.dismiss")}</wt-button
                      >
                    </li>`,
                )}
              </ul>
            </section>`
      }
      ${
        this.open
          ? html`<wt-dialog
              ${trackDialog()}
              .open=${true}
              .beforeClose=${this.#beforeClose}
              .heading=${t("department_transfer.title")}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                this.#clearDetail();
                this.#emit("close-transfers");
              }}
            >
              ${snapshot.error === undefined ? nothing : html`<p role="alert" class="error">${t("department_transfer.read_failed")}</p>`}
              ${
                snapshot.receivingAllowed !== true
                  ? nothing
                  : html`<h3>${t("department_transfer.incoming")}</h3>
                      <ul>
                        ${snapshot.incoming.map((row) => html`<li data-incoming=${row.id}>${this.#summary(row, true)}<wt-button data-view variant="secondary" @click=${() => void this.#view(row.id)}>${t("department_transfer.view")}</wt-button></li>`)}
                      </ul>
                      ${snapshot.incoming.length === 0 ? html`<p>${t("department_transfer.empty")}</p>` : nothing}`
              }
              ${this.#currentTab()}
              ${
                this.action === "request"
                  ? this.#actionForm()
                  : this.action === undefined && this.#canRequest()
                    ? html`<p>${this.currentTabLabel || t("department_transfer.current_tab")}</p>
                        <wt-button
                          data-request-transfer
                          ?disabled=${this.busy}
                          @click=${() => this.#begin("request")}
                          >${t("department_transfer.request")}</wt-button
                        >`
                    : nothing
              }
              <h3>${t("department_transfer.sent")}</h3>
              <ul>
                ${this.#senderRows().map((row) => html`<li data-sent=${row.id}>${this.#summary(row, false)}${row.status === "pending" ? html`<wt-button data-withdraw-transfer variant="secondary" ?disabled=${this.busy || this.action !== undefined} @click=${() => void this.#withdraw(row)}>${t("department_transfer.withdraw")}</wt-button>` : nothing}</li>`)}
              </ul>
              ${this.#senderRows().length === 0 ? html`<p>${t("department_transfer.no_sent")}</p>` : nothing}
              ${this.action === undefined && this.actionError ? html`<p role="alert" class="error">${this.actionError}</p>` : nothing}
              <wt-form-actions slot="footer"
                ><wt-button
                  slot="cancel"
                  data-close-transfers
                  variant="secondary"
                  @click=${() => this.#close()}
                  >${t("department_transfer.close")}</wt-button
                ></wt-form-actions
              >
            </wt-dialog>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-department-transfers": TillDepartmentTransfers;
  }
}
