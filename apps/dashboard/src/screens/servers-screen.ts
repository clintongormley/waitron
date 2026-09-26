import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, ServerRow } from "../api/client.js";

const STANDING_KEY: Record<ServerRow["standing"], StringKey> = {
  "serving-primary": "servers.standing.primary",
  "serving-secondary": "servers.standing.standby",
  "sell-only": "servers.standing.sell_only",
  evicted: "servers.standing.removed",
};

/** Which rows are `removable` is the server's judgement (`judgeRemoval`), never re-derived here. */
@customElement("dashboard-servers-screen")
export class ServersScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .intro {
        max-width: 70ch;
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      /* The table sizes its columns to their content and scrolls sideways past the screen, so a
         long address has to be bounded to wrap and keep the row's menu on a phone's screen. */
      wt-data-table::part(server-cell) {
        max-width: max(16ch, 45vw);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(server-line) {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-2);
      }
      wt-data-table::part(server-address) {
        color: var(--wt-color-text);
      }
      wt-data-table::part(server-role) {
        display: block;
        margin-top: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
      }
      wt-data-table::part(server-no-address) {
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(server-self) {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
      wt-data-table::part(server-machine) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
      wt-data-table::part(server-machine-id),
      .machine-id {
        font-family: var(--wt-font-family-mono);
      }
      .target {
        margin: 0 0 var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      .machine {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
      .note {
        max-width: 70ch;
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      .explanation {
        margin: 0;
        color: var(--wt-color-text);
      }
      .error {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.loadErrorKey = codeOf(error);
    },
  );

  @state() private servers: ServerRow[] = [];
  @state() private loading = true;
  @state() private loadErrorKey: string | null = null;
  @state() private target: ServerRow | null = null;
  @state() private removeErrorKey: string | null = null;
  @state() private removing = false;
  /** The Remove item's popover closes on the click, so the dialog has nothing visible to hand focus
   * back to; the row menu's trigger takes it instead, or the heading once that menu is gone. */
  #focusTarget: HTMLElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      await this.#queries.watch("listServers", [], (listing) => {
        this.servers = listing.nodes;
        this.loadErrorKey = null;
      });
    } catch {
      // The query's error callback has already recorded the failure.
    } finally {
      this.loading = false;
    }
  }

  #openRemove(row: ServerRow, event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions");
    this.#focusTarget = menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null;
    this.removeErrorKey = null;
    this.target = row;
  }

  #closeRemove(): void {
    if (this.removing) return;
    this.target = null;
    this.removeErrorKey = null;
    requestAnimationFrame(() => {
      if (this.#focusTarget?.isConnected) this.#focusTarget.focus();
      else this.renderRoot.querySelector<HTMLElement>("h1")?.focus();
    });
  }

  async #confirmRemove(): Promise<void> {
    const target = this.target;
    if (target === null || this.removing) return;
    this.removing = true;
    this.removeErrorKey = null;
    try {
      await this.api.removeServer(target.nodeId);
    } catch (error) {
      this.removeErrorKey = codeOf(error);
      return;
    } finally {
      this.removing = false;
    }
    // A removed row loses its menu, and the refresh below may land after the dialog has closed.
    this.#focusTarget = null;
    this.target = null;
    try {
      this.servers = (await this.api.listServers()).nodes;
      this.loadErrorKey = null;
    } catch (error) {
      this.loadErrorKey = codeOf(error);
    }
  }

  #address(row: ServerRow): string {
    return row.contactUrl === "" ? t("servers.no_address") : row.contactUrl;
  }

  /** Distinguishes two machines that gave no address. */
  #shortId(row: ServerRow): string {
    return row.nodeId.slice(0, 8);
  }

  #rowName(row: ServerRow): string {
    return row.contactUrl === "" ? `${t("servers.machine")} ${this.#shortId(row)}` : row.contactUrl;
  }

  #onPrimary(): boolean {
    return this.servers.some((row) => row.isSelf && row.standing === "serving-primary");
  }

  #columns(): DataTableColumn<ServerRow>[] {
    return [
      {
        key: "server",
        label: t("servers.server"),
        cell: (row) =>
          html`<div part="server-cell">
            <div part="server-line">
              <span
                part=${row.contactUrl === "" ? "server-address server-no-address" : "server-address"}
                data-test=${`address-${row.nodeId}`}
                >${this.#address(row)}</span
              >${
                row.isSelf
                  ? html`<span part="server-self" data-test=${`self-${row.nodeId}`}
                      >${t("servers.this_server")}</span
                    >`
                  : nothing
              }<span part="server-machine" data-test=${`machine-${row.nodeId}`}
                >${t("servers.machine")}
                <span part="server-machine-id" data-test=${`machine-id-${row.nodeId}`}
                  >${this.#shortId(row)}</span
                ></span
              >
            </div>
            <span part="server-role" data-test=${`role-${row.nodeId}`}
              >${t(STANDING_KEY[row.standing])}</span
            >
          </div>`,
      },
      {
        key: "actions",
        label: t("servers.actions"),
        cell: (row) =>
          row.removable
            ? html`<wt-row-actions label=${`${t("servers.actions")}: ${this.#rowName(row)}`}
                ><wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`remove-${row.nodeId}`}
                  @click=${(event: Event) => this.#openRemove(row, event)}
                  >${t("servers.remove")}</wt-button
                ></wt-row-actions
              >`
            : nothing,
      },
    ];
  }

  #renderDialog(): TemplateResult {
    const target = this.target;
    return html`<wt-dialog
      data-test="remove-dialog"
      heading=${t("servers.remove_title")}
      .open=${target !== null}
      .dismissible=${!this.removing}
      @wt-close=${() => this.#closeRemove()}
    >
      ${
        target === null
          ? nothing
          : html`<p class="target" data-test="remove-address">${this.#address(target)}</p>
              <p class="machine" data-test="remove-machine">
                ${t("servers.machine")} <span class="machine-id">${this.#shortId(target)}</span>
              </p>
              <p class="explanation">${t("servers.remove_explanation")}</p>`
      }
      ${
        this.removeErrorKey === null
          ? nothing
          : html`<p class="error" role="alert">${codeMessage(this.removeErrorKey)}</p>`
      }
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-remove"
          ?disabled=${this.removing}
          @click=${() => this.#closeRemove()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="danger"
          data-test="confirm-remove"
          .loading=${this.removing}
          @click=${() => void this.#confirmRemove()}
          >${t("servers.remove")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title" tabindex="-1">${t("servers.title")}</h1>
      <p class="intro">${t("servers.intro")}</p>
      ${
        // An empty list comes back whenever no chart is held, primary or not, so it says nothing.
        this.loading || this.loadErrorKey !== null || this.servers.length === 0 || this.#onPrimary()
          ? nothing
          : html`<p class="note" data-test="not-primary">${t("servers.not_primary")}</p>`
      }
      <wt-data-table
        aria-label=${t("servers.title")}
        .rows=${this.servers}
        .columns=${this.#columns()}
        .rowKey=${(row: ServerRow) => row.nodeId}
        .loading=${this.loading}
        .loadingMessage=${t("servers.loading")}
        .emptyMessage=${t("servers.empty")}
        .errorMessage=${this.loadErrorKey === null ? "" : codeMessage(this.loadErrorKey)}
      ></wt-data-table>
      ${this.#renderDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-servers-screen": ServersScreen;
  }
}
