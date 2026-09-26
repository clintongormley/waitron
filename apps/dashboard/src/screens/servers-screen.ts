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

type Action = "remove" | "clear";

const ACTION_KEYS: Record<Action, { verb: StringKey; title: StringKey; explanation: StringKey }> = {
  remove: {
    verb: "servers.remove",
    title: "servers.remove_title",
    explanation: "servers.remove_explanation",
  },
  clear: {
    verb: "servers.clear",
    title: "servers.clear_title",
    explanation: "servers.clear_explanation",
  },
};

/** Which rows are `removable` or `canClear` is the server's judgement (`judgeRemoval`,
 * `judgeClearance`), never re-derived here. */
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
  @state() private target: { action: Action; row: ServerRow } | null = null;
  @state() private actionErrorKey: string | null = null;
  @state() private busy = false;
  /** A menu item's popover closes on the click, so the dialog has nothing visible to hand focus
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

  #open(action: Action, row: ServerRow, event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions");
    this.#focusTarget = menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null;
    this.actionErrorKey = null;
    this.target = { action, row };
  }

  #close(): void {
    if (this.busy) return;
    this.target = null;
    this.actionErrorKey = null;
    requestAnimationFrame(() => {
      if (this.#focusTarget?.isConnected) this.#focusTarget.focus();
      else this.renderRoot.querySelector<HTMLElement>("h1")?.focus();
    });
  }

  async #confirm(): Promise<void> {
    const target = this.target;
    if (target === null || this.busy) return;
    this.busy = true;
    this.actionErrorKey = null;
    try {
      if (target.action === "remove") await this.api.removeServer(target.row.nodeId);
      else await this.api.clearServer(target.row.nodeId);
    } catch (error) {
      this.actionErrorKey = codeOf(error);
      return;
    } finally {
      this.busy = false;
    }
    // A removed row loses its menu, a cleared one leaves the list, and the refresh below may land
    // after the dialog has closed.
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
        cell: (row) => {
          const actions = (["remove", "clear"] as const).filter((action) =>
            action === "remove" ? row.removable : row.canClear === true,
          );
          return actions.length === 0
            ? nothing
            : html`<wt-row-actions label=${`${t("servers.actions")}: ${this.#rowName(row)}`}
                >${actions.map(
                  (action) =>
                    html`<wt-button
                      align="start"
                      variant="ghost"
                      data-test=${`${action}-${row.nodeId}`}
                      @click=${(event: Event) => this.#open(action, row, event)}
                      >${t(ACTION_KEYS[action].verb)}</wt-button
                    >`,
                )}</wt-row-actions
              >`;
        },
      },
    ];
  }

  #renderDialog(action: Action): TemplateResult {
    const target = this.target?.action === action ? this.target.row : null;
    const keys = ACTION_KEYS[action];
    return html`<wt-dialog
      data-test=${`${action}-dialog`}
      heading=${t(keys.title)}
      .open=${target !== null}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#close()}
    >
      ${
        target === null
          ? nothing
          : html`<p class="target" data-test=${`${action}-address`}>${this.#address(target)}</p>
              <p class="machine" data-test=${`${action}-machine`}>
                ${t("servers.machine")} <span class="machine-id">${this.#shortId(target)}</span>
              </p>
              <p class="explanation">${t(keys.explanation)}</p>
              ${
                this.actionErrorKey === null
                  ? nothing
                  : html`<p class="error" role="alert">${codeMessage(this.actionErrorKey)}</p>`
              }`
      }
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test=${`cancel-${action}`}
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="danger"
          data-test=${`confirm-${action}`}
          .loading=${this.busy && target !== null}
          @click=${() => void this.#confirm()}
          >${t(keys.verb)}</wt-button
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
      ${this.#renderDialog("remove")} ${this.#renderDialog("clear")}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-servers-screen": ServersScreen;
  }
}
