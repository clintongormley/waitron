import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { DepartmentTransfer, DepartmentTransferDetail, TillApi } from "../api/client.js";
import type { TransferSnapshot } from "../state/department-transfer-monitor.js";
import { limited } from "../state/draft-sync.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trackDialog } from "./track-dialog.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

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
        color: var(--wt-color-danger-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  @property({ attribute: false }) snapshot!: TransferSnapshot;
  @property({ type: Boolean }) open = false;
  @state() private selected?: string;
  @state() private detail?: DepartmentTransferDetail;
  @state() private loading = false;
  @state() private error = "";
  #read?: AbortController;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (
      changed.has("api") ||
      (changed.has("open") && !this.open) ||
      (this.selected !== undefined &&
        !this.snapshot.incoming.some((row) => row.id === this.selected))
    ) {
      this.#clearDetail();
    }
  }

  override disconnectedCallback(): void {
    this.#clearDetail();
    super.disconnectedCallback();
  }

  #emit(type: string, detail?: { requestId: string }): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #clearDetail(): void {
    this.#read?.abort();
    this.#read = undefined;
    this.selected = undefined;
    this.detail = undefined;
    this.loading = false;
    this.error = "";
  }

  #close(): void {
    this.#clearDetail();
    this.#emit("close-transfers");
  }

  async #view(requestId: string): Promise<void> {
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

  #summary(row: DepartmentTransfer, incoming: boolean) {
    return html`<div class="description">
      <p>${incoming ? t("department_transfer.incoming_notice") : t(statusKeys[row.status])}</p>
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
                ${detail.lines.map((line) => html`<li><div class="description">${line.quantity} × ${line.name}${line.variantName === null ? "" : ` · ${line.variantName}`}${line.note === null ? nothing : html`<p>${line.note}</p>`}</div></li>`)}
              </ul>
              <h3>${t("department_transfer.work")}</h3>
              <ul data-current-work>
                ${detail.outstandingWork.map((work) => html`<li><div class="description">${detail.lines.find((line) => line.id === work.lineId)?.name ?? t("department_transfer.unrecorded_item")} · ${t(`station.state.${work.state}`)}${work.note === null ? nothing : html`<p>${work.note}</p>`}</div></li>`)}
              </ul>
              ${detail.outstandingWork.length === 0 ? html`<p>${t("department_transfer.no_work")}</p>` : nothing}
            `
      }
      <wt-button
        data-refresh-detail
        variant="secondary"
        ?disabled=${this.loading}
        @click=${() => void this.#view(this.selected!)}
        >${t("department_transfer.refresh")}</wt-button
      >
    </section>`;
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
              .heading=${t("department_transfer.title")}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                this.#close();
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
              <h3>${t("department_transfer.sent")}</h3>
              <ul>
                ${snapshot.sent.map((row) => html`<li data-sent=${row.id}>${this.#summary(row, false)}</li>`)}
              </ul>
              ${snapshot.sent.length === 0 ? html`<p>${t("department_transfer.no_sent")}</p>` : nothing}
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
