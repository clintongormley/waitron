import { guideHref } from "../help-guide.js";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import { groupedJoinCode } from "@waitron/shared";
import { baseStyles, pageTitleStyles, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "../widgets/switch-label.js";
import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { spareDetails, spareLine, spareNeedsAttention } from "./box-status-rows.js";
import { formatRecentMinute } from "../date-utils.js";
import type {
  BoxJoinRequestRow,
  DashboardApi,
  ServerListing,
  ServerRow,
  SpareFollowView,
} from "../api/client.js";

/** How often the list is read again while it shows a box asking to join, which sends no event. */
const JOIN_POLL_MS = 5000;

/** Refusals after which the request no longer exists, so it cannot be added. */
const JOIN_ENDED = new Set(["mirror.join_not_found", "mirror.join_stopped_after_listing"]);

/** Codes whose shared words serve other screens too, so a join refusal words them here. */
const JOIN_WORDS: Partial<Record<string, StringKey>> = {
  "backup.recovery_key_missing": "servers.join_recovery_key_missing",
  "module.config_invalid": "servers.join_module_config_invalid",
};

function joinRefusal(error: unknown): string {
  const code = codeOf(error);
  const key = JOIN_WORDS[code];
  if (key !== undefined) return t(key);
  return codeMessage(
    code,
    undefined,
    (error as { params?: Record<string, unknown> } | null)?.params,
  );
}

const STANDING_KEY: Record<ServerRow["standing"], StringKey> = {
  "serving-primary": "servers.standing.primary",
  "serving-secondary": "servers.standing.standby",
  "sell-only": "servers.standing.sell_only",
  evicted: "servers.standing.removed",
};

const STANDING_ORDER: Record<ServerRow["standing"], number> = {
  "serving-primary": 0,
  "serving-secondary": 1,
  "sell-only": 2,
  evicted: 3,
};

function inStandingOrder(nodes: readonly ServerRow[]): ServerRow[] {
  return [...nodes].sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing]);
}

function webAddress(contactUrl: string): boolean {
  return /^https?:\/\//i.test(contactUrl) && URL.canParse(contactUrl);
}

type Action = "remove" | "clear" | "abandon";

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
  abandon: {
    verb: "servers.abandon",
    title: "servers.abandon_title",
    explanation: "servers.abandon_explanation",
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
      wt-data-table::part(server-link) {
        color: var(--wt-color-primary-text);
      }
      wt-data-table::part(server-link):focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      wt-data-table::part(server-link-address) {
        color: inherit;
      }
      wt-data-table::part(server-replaced) {
        display: block;
        margin-top: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
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
      a {
        color: var(--wt-color-primary-text);
      }
      .explanation {
        margin: 0;
        color: var(--wt-color-text);
      }
      .joins {
        list-style: none;
        margin: 0 0 var(--wt-space-4);
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        max-width: 70ch;
      }
      .joins-heading {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .join-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      .join-details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin-right: auto;
        overflow-wrap: anywhere;
      }
      .join-asking {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .join-meta {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .join-again {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-warning);
      }
      .join-list-error {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-danger);
      }
      .join-body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .join-body .target {
        margin: 0;
      }
      .join-code {
        margin: 0;
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
        letter-spacing: var(--wt-letter-spacing-wide);
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
  @state() private joinRequests: BoxJoinRequestRow[] = [];
  @state() private joinListError = "";
  /** The request whose Check dialog is open, with what Check answered. `waiting` is set while
   * Add as spare waits for the new box to choose Join. */
  @state() private join: {
    request: BoxJoinRequestRow;
    code: string | null;
    newConfirmed: boolean;
    waiting: boolean;
    error: string;
    ended: boolean;
    approved: boolean;
  } | null = null;
  @state() private joinBusy: "check" | "dismiss" | "approve" | null = null;
  /** Taken anew whenever the dialog closes or Check opens it, so an answer meant for an earlier
   * opening is not shown. */
  #joinOpening = 0;
  /** The request Add as spare is sent for once the live list shows it confirmed. */
  #addWhenConfirmed: { request: BoxJoinRequestRow; opening: number } | null = null;
  #joinPoll?: ReturnType<typeof setInterval>;
  #pollOut = false;
  /** Every read and live snapshot takes the next number; an answer numbered at or below the
   * newest applied one is older than what the screen shows, so it is dropped. */
  #readsBegun = 0;
  #newestApplied = 0;
  @state() private loading = true;
  @state() private loadErrorKey: string | null = null;
  @state() private target: { action: Action; row: ServerRow } | null = null;
  @state() private actionErrorKey: string | null = null;
  @state() private busy = false;
  @state() private declared = { switchedOff: false, noRecovery: false };
  /** Set when a Remove without the declarations was refused because the spare finished joining
   * after the list was read. */
  @state() private askDeclarations = false;
  /** The reset statement on Remove, or the confirmation on Will not return. */
  @state() private ticked = false;
  /** Set when a Remove was refused for want of the reset statement the listing did not ask for. */
  @state() private askResetStatement = false;
  /** A menu item's popover closes on the click, so the dialog has nothing visible to hand focus
   * back to; the row menu's trigger takes it instead, or the heading after a Remove or Clear. */
  #focusTarget: HTMLElement | null = null;

  @state() private handoverTarget: ServerRow | null = null;
  @state() private switchLabel: { address: string; opener: HTMLElement | null } | null = null;
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
    this.#syncJoinPoll(false);
    this.#dropPendingAdd();
    super.disconnectedCallback();
  }

  #applyListing(listing: ServerListing, read = ++this.#readsBegun): void {
    if (read <= this.#newestApplied) return;
    this.#newestApplied = read;
    this.servers = inStandingOrder(listing.nodes);
    this.spare = listing.spare ?? null;
    this.joinRequests = listing.joinRequests ?? [];
    this.loadErrorKey = null;
    this.#syncJoinPoll(this.joinRequests.length > 0);
    const gone = this.#goneJoin();
    if (gone !== null) {
      this.#addWhenConfirmed = null;
      this.join = {
        ...gone,
        code: null,
        waiting: false,
        ended: true,
        error: codeMessage("mirror.join_not_found"),
      };
      return;
    }
    const join = this.join;
    if (join !== null && !join.newConfirmed && this.#listedConfirmed(join.request.id))
      this.join = { ...join, newConfirmed: true };
    const pending = this.#addWhenConfirmed;
    if (
      pending !== null &&
      this.isConnected &&
      pending.opening === this.#joinOpening &&
      this.joinBusy === null &&
      this.#listedConfirmed(pending.request.id)
    ) {
      this.#addWhenConfirmed = null;
      void this.#approveJoin(pending.request, pending.opening, false);
    }
  }

  /** The open dialog, when it shows a code for a request the list no longer holds. An Add as spare
   * being sent is left to its own answer. */
  #goneJoin(): NonNullable<ServersScreen["join"]> | null {
    const join = this.join;
    if (join === null || join.code === null || this.joinBusy === "approve") return null;
    return this.joinRequests.some((row) => row.id === join.request.id) ? null : join;
  }

  #listedConfirmed(requestId: string): boolean {
    return this.joinRequests.some((row) => row.id === requestId && row.newConfirmed);
  }

  #syncJoinPoll(on: boolean): void {
    if (!on || !this.isConnected) {
      clearInterval(this.#joinPoll);
      this.#joinPoll = undefined;
      return;
    }
    this.#joinPoll ??= setInterval(() => void this.#poll(), JOIN_POLL_MS);
  }

  async #poll(): Promise<void> {
    if (this.#pollOut) return;
    this.#pollOut = true;
    try {
      await this.#reread(true);
    } finally {
      this.#pollOut = false;
    }
  }

  /** A read after an action supersedes every read begun before it, which may predate the change. */
  async #reread(passive = false): Promise<void> {
    if (!passive) this.#newestApplied = this.#readsBegun;
    const read = ++this.#readsBegun;
    try {
      this.#applyListing(
        await (passive ? (this.api.background ?? this.api) : this.api).listServers(),
        read,
      );
    } catch (error) {
      if (read > this.#newestApplied) this.loadErrorKey = codeOf(error);
    }
  }

  async #checkJoin(request: BoxJoinRequestRow): Promise<void> {
    if (this.joinBusy !== null) return;
    const opening = this.#newJoinOpening();
    this.join = {
      request,
      code: null,
      newConfirmed: false,
      waiting: false,
      error: "",
      ended: false,
      approved: false,
    };
    this.joinBusy = "check";
    let ended = false;
    try {
      const checked = await this.api.checkBoxJoin(request.id);
      if (this.#joinOpening !== opening || this.join === null) return;
      this.join = {
        ...this.join,
        code: checked.code,
        newConfirmed: checked.newConfirmed || this.#listedConfirmed(request.id),
      };
    } catch (error) {
      if (this.#joinOpening !== opening || this.join === null) return;
      ended = JOIN_ENDED.has(codeOf(error));
      this.join = { ...this.join, error: joinRefusal(error), ended };
    } finally {
      this.joinBusy = null;
    }
    if (ended) await this.#reread();
  }

  #addAsSpare(): void {
    const join = this.join;
    if (join === null || this.joinBusy !== null) return;
    if (join.newConfirmed) {
      void this.#approveJoin(join.request, this.#joinOpening, true);
      return;
    }
    this.join = { ...join, waiting: true, error: "" };
    this.#addWhenConfirmed = { request: join.request, opening: this.#joinOpening };
  }

  #dropPendingAdd(): void {
    this.#addWhenConfirmed = null;
    if (this.join?.waiting) this.join = { ...this.join, waiting: false };
  }

  /** The automatic send opens no sign-in prompt: one appearing unasked would surprise the person. */
  async #approveJoin(
    request: BoxJoinRequestRow,
    opening: number,
    askForSignIn: boolean,
  ): Promise<void> {
    if (this.joinBusy !== null || this.join === null) return;
    this.joinBusy = "approve";
    this.join = { ...this.join, waiting: false, error: "" };
    try {
      await (askForSignIn
        ? this.api.approveBoxJoin(request.id)
        : this.api.approveBoxJoin(request.id, { askForSignIn: false }));
      if (this.#joinOpening !== opening || this.join === null) return;
      this.join = { ...this.join, approved: true, code: null };
    } catch (error) {
      if (this.#joinOpening !== opening || this.join === null) return;
      const ended = JOIN_ENDED.has(codeOf(error));
      this.join = {
        ...this.join,
        error: joinRefusal(error),
        ended,
        code: ended ? null : this.join.code,
      };
      if (!ended) return;
    } finally {
      this.joinBusy = null;
    }
    await this.#reread();
  }

  async #dismissJoin(request: BoxJoinRequestRow): Promise<void> {
    if (this.joinBusy !== null) return;
    this.joinBusy = "dismiss";
    this.joinListError = "";
    if (this.join?.request.id === request.id) this.#dropPendingAdd();
    try {
      await this.api.dismissBoxJoin(request.id);
    } catch (error) {
      if (codeOf(error) !== "mirror.join_not_found") {
        if (this.join?.request.id === request.id)
          this.join = { ...this.join, error: joinRefusal(error) };
        else this.joinListError = joinRefusal(error);
        return;
      }
    } finally {
      this.joinBusy = null;
    }
    if (this.join?.request.id === request.id) this.#closeJoin();
    await this.#reread();
  }

  #closeJoin(): void {
    if (this.joinBusy === "approve") return;
    this.#newJoinOpening();
    this.join = null;
  }

  #newJoinOpening(): number {
    this.#addWhenConfirmed = null;
    return ++this.#joinOpening;
  }

  #renderJoinRequests(): TemplateResult | typeof nothing {
    if (this.joinRequests.length === 0) return nothing;
    return html`<section data-test="join-requests" aria-labelledby="joins-heading">
      <h2 class="joins-heading" id="joins-heading">${t("servers.joins_heading")}</h2>
      ${
        this.joinListError === ""
          ? nothing
          : html`<p class="join-list-error" role="alert" data-test="join-list-error">
              ${this.joinListError}
            </p>`
      }
      <ul class="joins">
        ${this.joinRequests.map((request) => {
          const asking = fill("servers.join_asking", { address: request.address });
          return html`<li data-test="join-row-${request.id}">
            <wt-card>
              <div class="join-row">
                <div class="join-details">
                  <span class="join-asking">${asking}</span>
                  <span class="join-meta">${formatRecentMinute(request.askedAt)}</span>
                  ${
                    request.startedAgain
                      ? html`<span class="join-again" data-test="join-started-again-${request.id}"
                          >${t("servers.join_started_again")}</span
                        >`
                      : nothing
                  }
                </div>
                <wt-button
                  variant="primary"
                  size="sm"
                  data-test="join-check-${request.id}"
                  aria-label=${`${t("servers.join_check")}: ${asking}`}
                  ?disabled=${this.joinBusy !== null}
                  @click=${() => void this.#checkJoin(request)}
                  >${t("servers.join_check")}</wt-button
                >
                <wt-button
                  variant="secondary"
                  size="sm"
                  data-test="join-dismiss-${request.id}"
                  aria-label=${`${t("servers.join_dismiss")}: ${asking}`}
                  ?disabled=${this.joinBusy !== null}
                  @click=${() => void this.#dismissJoin(request)}
                  >${t("servers.join_dismiss")}</wt-button
                >
              </div>
            </wt-card>
          </li>`;
        })}
      </ul>
    </section>`;
  }

  #renderJoinDialog(): TemplateResult {
    const join = this.join;
    const checking = this.joinBusy === "check";
    const sending = this.joinBusy === "approve";
    const asking = join !== null && join.code !== null;
    const canCheckAgain =
      join !== null && !checking && join.code === null && !join.approved && !join.ended;
    return html`<wt-dialog
      data-test="join-dialog"
      heading=${t("servers.join_dialog_title")}
      .open=${join !== null}
      .dismissible=${!sending}
      @wt-close=${() => this.#closeJoin()}
    >
      ${
        join === null
          ? nothing
          : html`<div class="join-body">
              <p class="target" data-test="join-dialog-address">
                ${fill("servers.join_asking", { address: join.request.address })}
              </p>
              ${
                join.request.startedAgain
                  ? html`<p class="explanation join-again">${t("servers.join_started_again")}</p>`
                  : nothing
              }
              ${checking ? html`<p class="explanation">${t("servers.join_checking")}</p>` : nothing}
              ${
                join.approved
                  ? html`<p class="explanation" role="status" data-test="join-approved">
                      ${t("servers.join_approved")}
                    </p>`
                  : nothing
              }
              ${
                join.code === null
                  ? nothing
                  : html`<p class="join-code" data-test="join-code">
                        ${groupedJoinCode(join.code)}
                      </p>
                      ${
                        join.waiting
                          ? html`<p class="target" role="status" data-test="join-waiting">
                              ${t("servers.join_waiting")}
                            </p>`
                          : html`<p class="target" data-test="join-question">
                              ${t("servers.join_match_prompt")}
                            </p>`
                      }`
              }
            </div>`
      }
      <wt-form-actions slot="footer" .error=${join?.error ?? ""}>
        ${
          asking && !join.waiting
            ? nothing
            : html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="join-close"
                @click=${() => this.#closeJoin()}
                >${t("action.close")}</wt-button
              >`
        }
        ${
          asking
            ? html`<wt-button
                slot="secondary"
                variant="secondary"
                data-test="join-no"
                ?disabled=${sending}
                @click=${() => void this.#dismissJoin(join.request)}
                >${t("servers.join_no")}</wt-button
              >`
            : nothing
        }
        ${
          asking && !join.waiting
            ? html`<wt-button
                variant="primary"
                data-test="join-add"
                ?loading=${sending}
                @click=${() => this.#addAsSpare()}
                >${t("servers.join_add")}</wt-button
              >`
            : nothing
        }
        ${
          canCheckAgain
            ? html`<wt-button
                variant="primary"
                data-test="join-check-again"
                @click=${() => void this.#checkJoin(join.request)}
                >${t("servers.join_check_again")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-dialog>`;
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
          const named = (error as { params?: { operationId?: unknown } } | null)?.params
            ?.operationId;
          if (
            ["handover.operation_in_progress", "handover.return_outstanding"].includes(
              codeOf(error),
            ) &&
            typeof named === "string" &&
            named !== operationId
          ) {
            this.#handoverSent = false;
            this.#operationId = crypto.randomUUID();
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
      await this.#queries.watch("listServers", [], (listing) => this.#applyListing(listing));
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
    this.ticked = false;
    this.askResetStatement = false;
  }

  #statingReset(action: Action, row: ServerRow): boolean {
    return action === "remove" && (row.needsResetStatement || this.askResetStatement);
  }

  #unticked(action: Action, row: ServerRow): boolean {
    return (action === "abandon" || this.#statingReset(action, row)) && !this.ticked;
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
    if (
      target === null ||
      this.busy ||
      this.#undeclared(target.action, target.row) ||
      this.#unticked(target.action, target.row)
    )
      return;
    this.busy = true;
    this.actionErrorKey = null;
    try {
      if (target.action === "clear") await this.api.clearServer(target.row.nodeId);
      else if (target.action === "abandon") await this.api.abandonServerReturn(target.row.nodeId);
      else if (this.#statingReset(target.action, target.row))
        await this.api.removeServer(target.row.nodeId, { resetStatement: true });
      else if (this.#declaring(target.action, target.row))
        await this.api.removeServer(target.row.nodeId, {
          spareSwitchedOff: true,
          noParallelRecovery: true,
        });
      else await this.api.removeServer(target.row.nodeId);
    } catch (error) {
      this.actionErrorKey = codeOf(error);
      if (this.actionErrorKey === "membership.standby_joined") this.askDeclarations = true;
      if (this.actionErrorKey === "membership.reset_statement_required")
        this.askResetStatement = true;
      return;
    } finally {
      this.busy = false;
    }
    // Focus goes to the heading: the row's menu changes (a removed row's offers Clear, a cleared row
    // leaves the list) and the refresh below may land after the dialog has closed.
    this.#focusTarget = null;
    this.target = null;
    await this.#reread();
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

  /** The dashboard does not know the venue's network name, so any https address is offered. */
  #hasSwitchPage(row: ServerRow): boolean {
    return (
      (row.standing === "serving-primary" || row.standing === "serving-secondary") &&
      row.contactUrl.startsWith("https://")
    );
  }

  #openSwitchLabel(row: ServerRow, event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions");
    this.switchLabel = {
      address: row.contactUrl,
      opener: menu?.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? null,
    };
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
              ${
                webAddress(row.contactUrl)
                  ? html`<a
                      part="server-link"
                      href=${row.contactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      ><span
                        part="server-address server-link-address"
                        data-test=${`address-${row.nodeId}`}
                        >${row.contactUrl}</span
                      ></a
                    >`
                  : html`<span
                      part=${row.contactUrl === "" ? "server-address server-no-address" : "server-address"}
                      data-test=${`address-${row.nodeId}`}
                      >${this.#address(row)}</span
                    >`
              }${
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
              row.returnOutstanding
                ? html`<div
                    part="server-progress server-warning"
                    data-test=${`return-${row.nodeId}`}
                  >
                    ${t("servers.return_waiting")}
                  </div>`
                : nothing
            }
            ${
              row.standing === "sell-only" && row.returnOutstanding
                ? html`<span part="server-replaced" data-test=${`replaced-note-${row.nodeId}`}
                    >${t("servers.replaced_note")}
                    <a
                      part="server-link"
                      href=${guideHref("servers.handed-over")}
                      target="_blank"
                      rel="noopener"
                      >${t("help.guide_link")}</a
                    ></span
                  >`
                : nothing
            }
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
          const actions = (["abandon", "remove", "clear"] as const).filter((action) =>
            action === "abandon"
              ? row.returnOutstanding
              : action === "remove"
                ? row.removable
                : row.canClear,
          );
          const handover =
            this.canPromote &&
            this.#onPrimary() &&
            !row.isSelf &&
            row.standing === "serving-secondary" &&
            row.contactUrl !== "";
          const switchLabel = this.#hasSwitchPage(row);
          return actions.length === 0 && !handover && !switchLabel
            ? nothing
            : html`<wt-row-actions label=${`${t("servers.actions")}: ${this.#rowName(row)}`}
                >${handover ? html`<wt-button data-test=${`handover-${row.nodeId}`} @click=${() => this.#openHandover(row)}>${t("servers.hand_over")}</wt-button>` : nothing}${switchLabel ? html`<wt-button data-test=${`switch-label-${row.nodeId}`} @click=${(event: Event) => this.#openSwitchLabel(row, event)}>${t("servers.switch_label")}</wt-button>` : nothing}${actions.map(
                  (action) =>
                    html`<wt-button
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
    const undeclared =
      target !== null && (this.#undeclared(action, target) || this.#unticked(action, target));
    const title =
      action === "remove" && target?.standing === "sell-only"
        ? "servers.remove_former_title"
        : keys.title;
    return html`<wt-dialog
      data-test=${`${action}-dialog`}
      heading=${t(title)}
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
              <p class="explanation" data-test=${`${action}-warning`}>${t(keys.explanation)}</p>
              ${this.#declaring(action, target) ? this.#renderDeclarations(target) : nothing}
              ${
                action === "abandon"
                  ? this.#renderTick("abandon-confirm", "willNotReturn", "servers.abandon_confirm")
                  : this.#statingReset(action, target)
                    ? this.#renderTick(
                        "reset-statement",
                        "resetConfirmed",
                        "servers.reset_statement",
                        html`<p class="explanation" data-test="reset-warning">
                          ${t("servers.reset_warning")}
                        </p>`,
                      )
                    : nothing
              }`
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

  #renderTick(
    test: string,
    name: string,
    label: StringKey,
    warning: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    return html`<div class="declarations">
      ${warning}
      <wt-switch
        data-test=${test}
        name=${name}
        label=${`${t(label)} *`}
        .checked=${this.ticked}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          this.ticked = event.detail.checked;
        }}
      ></wt-switch>
    </div>`;
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
      ${this.#renderJoinRequests()}
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
      ${this.#renderDialog("remove")} ${this.#renderDialog("clear")}
      ${this.#renderDialog("abandon")} ${this.#renderHandover()} ${this.#renderJoinDialog()}
      ${
        this.switchLabel === null
          ? nothing
          : html`<dashboard-switch-label
              .address=${this.switchLabel.address}
              .opener=${this.switchLabel.opener}
              @wt-close=${() => {
                this.switchLabel = null;
              }}
            ></dashboard-switch-label>`
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-servers-screen": ServersScreen;
  }
}
