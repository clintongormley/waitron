import { guideHref } from "../help-guide.js";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { baseStyles, pageTitleStyles, breakAfterColons, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { spareDetails, spareLine, spareNeedsAttention } from "./box-status-rows.js";
import type { DashboardApi, ServerRow, SpareFollowView } from "../api/client.js";

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
    pageTitleStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
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
      wt-data-table::part(server-progress) {
        margin-top: var(--wt-space-2);
      }
      wt-data-table::part(server-warning) {
        color: var(--wt-color-warning);
      }
      wt-data-table::part(server-current) {
        color: var(--wt-color-success);
      }
      wt-data-table::part(server-copy-detail) {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        margin-top: var(--wt-space-1);
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
      .declarations {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
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
  @state() private spare: SpareFollowView | null = null;
  @state() private authorityFingerprint: string | null = null;
  @state() private loading = true;
  @state() private loadErrorKey: string | null = null;
  @state() private target: { action: Action; row: ServerRow } | null = null;
  @state() private actionErrorKey: string | null = null;
  @state() private busy = false;
  @state() private declared = { switchedOff: false, noRecovery: false };
  /** Set when a Remove without the declarations was refused because the spare finished joining
   * after the list was read. */
  @state() private askDeclarations = false;
  /** A menu item's popover closes on the click, so the dialog has nothing visible to hand focus
   * back to; the row menu's trigger takes it instead, or the heading after a Remove or Clear. */
  #focusTarget: HTMLElement | null = null;

  @state() private handoverTarget: ServerRow | null = null;
  @state() private handoverHasPassword: boolean | null = null;
  @state() private handoverProfileFailed = false;
  @state() private handoverError = "";
  @state() private handoverBusy = false;
  #operationId = "";
  #handoverSent = false;
  #startRefusal: unknown;
  #openHandover(row: ServerRow): void {
    this.handoverTarget = row;
    this.#operationId = crypto.randomUUID();
    this.#handoverSent = false;
    this.#startRefusal = undefined;
    this.handoverHasPassword = null;
    this.handoverProfileFailed = false;
    this.handoverError = "";
    void this.#readHandoverProfile(row);
  }
  async #readHandoverProfile(target: ServerRow): Promise<void> {
    this.handoverProfileFailed = false;
    this.handoverError = "";
    try {
      const profile = await this.api.background.getProfile();
      if (this.handoverTarget !== target) return;
      this.handoverHasPassword = profile.hasPassword;
      if (!profile.hasPassword)
        this.handoverError = `${t("servers.handover_no_password")} ${t("profile.password_recovery")}`;
    } catch (error) {
      if (this.handoverTarget !== target) return;
      this.handoverProfileFailed = true;
      this.handoverError = codeMessage(codeOf(error));
    }
  }
  #closeHandover(): void {
    this.handoverTarget = null;
    this.handoverBusy = false;
  }
  override disconnectedCallback(): void {
    this.#closeHandover();
    super.disconnectedCallback();
  }
  #openHandoverPage(url: string): void {
    this.#closeHandover();
    this.dispatchEvent(
      new CustomEvent("handover-open", { detail: { url }, bubbles: true, composed: true }),
    );
  }
  async #startHandover(): Promise<void> {
    const target = this.handoverTarget;
    if (!target || this.handoverBusy || !this.canPromote) return;
    this.handoverError = "";
    if (!this.handoverHasPassword) {
      this.handoverError = `${t("servers.handover_no_password")} ${t("profile.password_recovery")}`;
      return;
    }
    const operationId = this.#operationId;
    this.handoverBusy = true;
    try {
      if (!this.#handoverSent) {
        this.#handoverSent = true;
        this.#startRefusal = undefined;
        try {
          const answer = await this.api.startHandover({
            operationId,
            destinationNodeId: target.nodeId,
          });
          if (this.handoverTarget !== target) return;
          if (answer.handoverPage) {
            this.#openHandoverPage(answer.handoverPage);
            return;
          }
        } catch (error) {
          if (this.handoverTarget !== target) return;
          this.#startRefusal = error;
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
          this.handoverError = codeMessage(
            codeOf(this.#startRefusal, "handover.restarted_before_stepdown"),
          );
          return;
        }
      } catch (error) {
        if (
          codeOf(error) === "handover.operation_unknown" &&
          typeof this.#startRefusal === "object" &&
          this.#startRefusal !== null &&
          "status" in this.#startRefusal &&
          this.#startRefusal.status === 409
        ) {
          this.#handoverSent = false;
          this.#operationId = crypto.randomUUID();
          this.handoverError = codeMessage(codeOf(this.#startRefusal));
          return;
        }
      }
      this.handoverError =
        this.#startRefusal && codeOf(this.#startRefusal) !== "connection.failed"
          ? `${codeMessage(codeOf(this.#startRefusal))} ${t("servers.handover_reconnect")}`
          : t("servers.handover_reconnect");
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
      @wt-close=${() => this.#closeHandover()}
    >
      ${
        this.handoverTarget
          ? html`<p class="target">${this.#address(this.handoverTarget)}</p>
              <p>${t("servers.handover_intro")}</p>
              ${this.#handoverSent ? html`<p>${t("servers.handover_sent")}</p>` : nothing}
              <p>${t("servers.handover_password")}</p>
              <p>
                <a href=${guideHref("servers.handover")} target="_blank" rel="noopener"
                  >${t("help.guide_link")}</a
                >
              </p>
              ${
                this.handoverProfileFailed
                  ? html`<wt-button
                      data-test="retry-handover-profile"
                      variant="secondary"
                      @click=${() => void this.#readHandoverProfile(this.handoverTarget!)}
                      >${t("fresh_sign_in.retry")}</wt-button
                    >`
                  : nothing
              }`
          : nothing
      }
      <wt-form-actions slot="footer" data-test="handover-actions" .error=${this.handoverError}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.handoverBusy}
          data-test="stop-handover"
          @click=${() => void this.renderRoot.querySelector<HTMLElement & { requestClose(reason: string): Promise<void> }>('[data-test="handover-dialog"]')?.requestClose("cancel")}
          >${t(this.#handoverSent ? "action.close" : "servers.handover_stop")}</wt-button
        >
        <wt-button
          data-test="confirm-handover"
          variant=${this.handoverHasPassword ? "primary" : "secondary"}
          .loading=${this.handoverBusy}
          .disabled=${this.handoverBusy || !this.handoverHasPassword}
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
        this.spare = listing.spare ?? null;
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
    this.#forgetDeclarations();
    this.target = { action, row };
  }

  #forgetDeclarations(): void {
    this.declared = { switchedOff: false, noRecovery: false };
    this.askDeclarations = false;
  }

  #declaring(action: Action, row: ServerRow): boolean {
    return action === "remove" && (row.requiresRetirementConfirmation || this.askDeclarations);
  }

  #undeclared(action: Action, row: ServerRow): boolean {
    return this.#declaring(action, row) && !(this.declared.switchedOff && this.declared.noRecovery);
  }

  #close(): void {
    if (this.busy) return;
    this.target = null;
    this.actionErrorKey = null;
    this.#forgetDeclarations();
    requestAnimationFrame(() => {
      if (this.#focusTarget?.isConnected) this.#focusTarget.focus();
      else this.renderRoot.querySelector<HTMLElement>("h1")?.focus();
    });
  }

  async #confirm(): Promise<void> {
    const target = this.target;
    if (target === null || this.busy || this.#undeclared(target.action, target.row)) return;
    this.busy = true;
    this.actionErrorKey = null;
    try {
      if (target.action === "clear") await this.api.clearServer(target.row.nodeId);
      else if (this.#declaring(target.action, target.row))
        await this.api.removeServer(target.row.nodeId, {
          spareSwitchedOff: true,
          noParallelRecovery: true,
        });
      else await this.api.removeServer(target.row.nodeId);
    } catch (error) {
      this.actionErrorKey = codeOf(error);
      if (this.actionErrorKey === "membership.standby_joined") this.askDeclarations = true;
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
      this.spare = listing.spare ?? null;
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
            ${
              this.spare?.peerNodeId === row.nodeId
                ? html`<div
                    part="server-progress"
                    data-test=${`follow-${row.nodeId}`}
                    data-state=${spareNeedsAttention(this.spare) ? "attention" : "ok"}
                  >
                    <span
                      part=${spareNeedsAttention(this.spare) ? "server-warning" : "server-current"}
                      >${spareLine(this.spare)}</span
                    >
                    ${spareDetails(this.spare).map((line) => html`<div part="server-copy-detail">${line}</div>`)}
                  </div>`
                : nothing
            }
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
    const undeclared = target !== null && this.#undeclared(action, target);
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
              <p class="explanation">${t(keys.explanation)}</p>
              ${this.#declaring(action, target) ? this.#renderDeclarations(target) : nothing}`
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
          variant=${undeclared ? "secondary" : "danger"}
          data-test=${`confirm-${action}`}
          .disabled=${undeclared}
          .loading=${this.busy && target !== null}
          @click=${() => void this.#confirm()}
          >${t(keys.verb)}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  /** The listing's flag explains the declarations here; after a stale listing's refusal, the
   * refusal's own sentence, which says the same, explains them. */
  #renderDeclarations(row: ServerRow): TemplateResult {
    const declaration = (key: "switchedOff" | "noRecovery", test: string, label: StringKey) =>
      html`<wt-switch
        data-test=${test}
        name=${key}
        label=${`${t(label)} *`}
        .checked=${this.declared[key]}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          this.declared = { ...this.declared, [key]: event.detail.checked };
        }}
      ></wt-switch>`;
    return html`<div class="declarations">
      ${
        row.requiresRetirementConfirmation
          ? html`<p class="explanation" data-test="declare-explanation">
              ${t("servers.declare_explanation")}
            </p>`
          : nothing
      }
      ${declaration("switchedOff", "declare-switched-off", "servers.declare_switched_off")}
      ${declaration("noRecovery", "declare-no-recovery", "servers.declare_no_recovery")}
    </div>`;
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
