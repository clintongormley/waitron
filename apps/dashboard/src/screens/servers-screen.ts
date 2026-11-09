import { guideHref } from "../help-guide.js";
import type { FreshSignIn, SignInWays } from "../widgets/fresh-sign-in.js";
import "../widgets/fresh-sign-in.js";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  baseStyles,
  focusFirstInvalid,
  breakAfterColons,
  draftScopeFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type DataTableColumn,
} from "@waitron/ui";
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
      .fingerprint {
        max-width: 70ch;
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      .fingerprint-value {
        font-family: var(--wt-font-family-mono);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .explanation {
        margin: 0;
        color: var(--wt-color-text);
      }
    `,
  ];

  @property({ type: Boolean }) canPromote = false;
  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.loadErrorKey = codeOf(error);
    },
  );

  @state() private servers: ServerRow[] = [];
  @state() private authorityFingerprint: string | null = null;
  @state() private loading = true;
  @state() private loadErrorKey: string | null = null;
  @state() private target: { action: Action; row: ServerRow } | null = null;
  @state() private actionErrorKey: string | null = null;
  @state() private busy = false;
  /** A menu item's popover closes on the click, so the dialog has nothing visible to hand focus
   * back to; the row menu's trigger takes it instead, or the heading after a Remove or Clear. */
  #focusTarget: HTMLElement | null = null;

  @state() private handoverTarget: ServerRow | null = null;
  @state() private handoverWays: SignInWays | null = null;
  @state() private handoverError = "";
  @state() private handoverBusy = false;
  #operationId = "";
  #handoverSent = false;
  #handoverScope?: DraftScope<boolean>;
  #handoverLeave?: LeaveCoordinator;
  #signIn(): FreshSignIn | null {
    return this.renderRoot.querySelector("dashboard-fresh-sign-in");
  }
  #openHandover(row: ServerRow): void {
    this.handoverTarget = row;
    this.#operationId = crypto.randomUUID();
    this.#handoverSent = false;
    this.handoverWays = null;
    this.handoverError = "";
    const { scope, coordinator } = draftScopeFor<boolean>(this, {
      id: {},
      current: () => this.#signIn()?.typed ?? false,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: () => this.#signIn()?.clear(),
    });
    this.#handoverScope = scope;
    this.#handoverLeave = coordinator;
    scope.commit(false);
  }
  #closeHandover(): void {
    this.#signIn()?.clear();
    this.#handoverScope?.dispose();
    this.#handoverScope = undefined;
    this.#handoverLeave = undefined;
    this.handoverTarget = null;
    this.handoverBusy = false;
  }
  override disconnectedCallback(): void {
    this.#closeHandover();
    super.disconnectedCallback();
  }
  readonly #handoverBeforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#handoverScope ||
    !this.#handoverLeave ||
    (await this.#handoverLeave.request({
      scopes: [this.#handoverScope.id],
      reason,
      proceed() {},
    })) === "proceeded";
  #openHandoverPage(url: string): void {
    this.#handoverScope?.commit(false);
    this.#closeHandover();
    this.dispatchEvent(
      new CustomEvent("handover-open", { detail: { url }, bubbles: true, composed: true }),
    );
  }
  async #startHandover(): Promise<void> {
    const target = this.handoverTarget;
    const widget = this.#signIn();
    if (!target || !widget || this.handoverBusy || !this.canPromote) return;
    this.handoverError = "";
    if (!this.handoverWays?.password) {
      this.handoverError = t("servers.handover_password");
      return;
    }
    const operationId = this.#operationId;
    let refused: unknown;
    this.handoverBusy = true;
    try {
      if (!this.#handoverSent) {
        const signIn = await widget.signIn("password");
        if (!signIn) {
          this.handoverError = widget.notice;
          this.handoverBusy = false;
          await this.updateComplete;
          await widget.updateComplete;
          await focusFirstInvalid(widget.shadowRoot!);
          return;
        }
        if (signIn.method !== "password" || signIn.recoveryCode !== undefined) {
          this.handoverError = t("servers.handover_password");
          return;
        }
        this.#handoverSent = true;
        try {
          const answer = await this.api.startHandover({
            operationId,
            destinationNodeId: target.nodeId,
            signIn,
          });
          if (this.handoverTarget !== target) return;
          if (answer.handoverPage) {
            this.#openHandoverPage(answer.handoverPage);
            return;
          }
        } catch (error) {
          if (this.handoverTarget !== target) return;
          refused = error;
          if (
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            [400, 401, 403, 429].includes(Number(error.status))
          ) {
            this.#handoverSent = false;
            this.handoverError = codeMessage(codeOf(error));
            return;
          }
        }
      }
      try {
        const status = await this.api.handoverStatus(operationId);
        if (this.handoverTarget !== target) return;
        if (status.handoverPage) {
          this.#openHandoverPage(status.handoverPage);
          return;
        }
        if (status.state === "abandoned") {
          this.#handoverSent = false;
          this.#operationId = crypto.randomUUID();
          this.handoverError = codeMessage(codeOf(refused, "handover.restarted_before_stepdown"));
          return;
        }
      } catch {
        /* The next press reads the same public operation. */
      }
      this.handoverError = t("servers.handover_reconnect");
    } finally {
      this.handoverBusy = false;
    }
  }
  #renderHandover(): TemplateResult {
    return html`<wt-dialog
      data-test="handover-dialog"
      heading=${t("servers.hand_over")}
      .open=${this.handoverTarget !== null}
      .dismissible=${!this.handoverBusy}
      .beforeClose=${this.#handoverBeforeClose}
      @wt-close=${() => this.#closeHandover()}
    >
      ${
        this.handoverTarget
          ? html`<p class="target">${this.#address(this.handoverTarget)}</p>
              <p>${t("servers.handover_intro")}</p>
              <p>${t("servers.handover_password")}</p>
              <p>
                <a href=${guideHref("servers.handover")} target="_blank" rel="noopener"
                  >${t("help.guide_link")}</a
                >
              </p>
              <dashboard-fresh-sign-in
                .api=${this.api.background}
                .disabled=${this.handoverBusy || this.#handoverSent}
                @sign-in-ways=${(event: CustomEvent<SignInWays>) => {
                  this.handoverWays = event.detail;
                }}
                @sign-in-change=${() => {
                  this.#handoverScope?.changed();
                  this.handoverError = "";
                }}
                @sign-in-passkey=${() => {
                  this.handoverError = t("servers.handover_password");
                }}
              ></dashboard-fresh-sign-in>`
          : nothing
      }
      <wt-form-actions
        slot="footer"
        data-test="handover-actions"
        .error=${[this.handoverError, this.#signIn()?.marked ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.handoverBusy}
          data-test="stop-handover"
          @click=${() => void this.renderRoot.querySelector<HTMLElement & { requestClose(reason: string): Promise<void> }>('[data-test="handover-dialog"]')?.requestClose("cancel")}
          >${t("servers.handover_stop")}</wt-button
        >
        <wt-button
          data-test="confirm-handover"
          .loading=${this.handoverBusy}
          .disabled=${this.handoverBusy || this.handoverWays === null || !this.handoverWays.password || (this.#signIn()?.invalid ?? false)}
          @click=${() => void this.#startHandover()}
          >${t(this.#handoverSent ? "servers.handover_check" : "servers.hand_over")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      await this.#queries.watch("listServers", [], (listing) => {
        this.servers = listing.nodes;
        this.authorityFingerprint = listing.authorityFingerprint;
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
    // Focus goes to the heading: the row's menu changes (a removed row's offers Clear, a cleared row
    // leaves the list) and the refresh below may land after the dialog has closed.
    this.#focusTarget = null;
    this.target = null;
    try {
      const listing = await this.api.listServers();
      this.servers = listing.nodes;
      this.authorityFingerprint = listing.authorityFingerprint;
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
        pinned: "end",
        cell: (row) => {
          const actions = (["remove", "clear"] as const).filter((action) =>
            action === "remove" ? row.removable : row.canClear,
          );
          const handover =
            this.canPromote &&
            this.#onPrimary() &&
            !row.isSelf &&
            row.standing === "serving-secondary" &&
            row.contactUrl !== "";
          return actions.length === 0 && !handover
            ? nothing
            : html`<wt-row-actions label=${`${t("servers.actions")}: ${this.#rowName(row)}`}
                >${handover ? html`<wt-button align="start" variant="ghost" data-test=${`handover-${row.nodeId}`} @click=${() => this.#openHandover(row)}>${t("servers.hand_over")}</wt-button>` : nothing}${actions.map(
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
      @wt-close=${() => {
        // The browser reports a close a task later, by when the other dialog may have opened.
        if (this.target === null || this.target.action === action) this.#close();
      }}
    >
      ${
        target === null
          ? nothing
          : html`<p class="target" data-test=${`${action}-address`}>${this.#address(target)}</p>
              <p class="machine" data-test=${`${action}-machine`}>
                ${t("servers.machine")} <span class="machine-id">${this.#shortId(target)}</span>
              </p>
              <p class="explanation">${t(keys.explanation)}</p>`
      }
      <wt-form-actions
        slot="footer"
        .error=${
          target === null || this.actionErrorKey === null ? "" : codeMessage(this.actionErrorKey)
        }
      >
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
        this.authorityFingerprint === null
          ? nothing
          : html`<p class="fingerprint" data-test="authority-fingerprint">
              ${t("servers.fingerprint")}:
              <span class="fingerprint-value" data-test="fingerprint-value"
                >${breakAfterColons(this.authorityFingerprint)}</span
              >
            </p>`
      }
      ${
        // An empty list comes back whenever no chart is held, primary or not, so it says nothing.
        this.loading || this.loadErrorKey !== null || this.servers.length === 0 || this.#onPrimary()
          ? nothing
          : html`<p class="note" data-test="not-primary">${t("servers.not_primary")}</p>`
      }
      <wt-data-table
        noMatchesMessage=${tableNoMatches()}
        aria-label=${t("servers.title")}
        .rows=${this.servers}
        .columns=${this.#columns()}
        .rowKey=${(row: ServerRow) => row.nodeId}
        .loading=${this.loading}
        .loadingMessage=${t("servers.loading")}
        .emptyMessage=${t("servers.empty")}
        .errorMessage=${this.loadErrorKey === null ? "" : codeMessage(this.loadErrorKey)}
      ></wt-data-table>
      ${this.#renderDialog("remove")} ${this.#renderDialog("clear")} ${this.#renderHandover()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-servers-screen": ServersScreen;
  }
}
