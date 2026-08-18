import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { absenceKindName } from "../i18n/domain.js";
import type { DashboardApi, PendingAbsence, PendingSwap } from "../api/client.js";
import { personNameMap, resolvePersonName } from "../person-utils.js";

/**
 * The management dashboard's APPROVALS SCREEN (design §3g): the two manager approve/reject queues —
 * ACCEPTED shift swaps and REQUESTED absences — side by side, each row carrying Approve and Reject
 * buttons. Person ids render as names via `listStaff`. Every async path is `try/catch`ed into an
 * `errorKey` banner (the roster/catalogue-screen pattern); a single-flight `busy` gate drops a
 * double-fired decide. On a decide it calls the API then reloads the queues.
 */
@customElement("dashboard-approvals-screen")
export class ApprovalsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      h2 {
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .queues {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-5);
      }
      .queue {
        flex: 1 1 20rem;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
        color: var(--wt-color-text);
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  @state() private swaps: PendingSwap[] = [];
  @state() private absences: PendingAbsence[] = [];
  @state() private errorKey: string | null = null;
  @state() private busy = false;
  // A personId → displayName lookup rebuilt whenever the staff list loads (in #load), so #name is
  // O(1) per rendered row rather than a per-row scan of the staff list.
  #names = new Map<string, string>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** The INITIAL load: the staff list (for name resolution) then both queues — mirrors
   * roster-screen's `#load` (static data) vs `#loadRoster` (the reloadable part) split. A rejection
   * anywhere becomes the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      this.#names = personNameMap(await this.api.listStaff());
      await this.#loadQueues();
    } catch (error) {
      this.#fail(error);
    }
  }

  /** Reload just the two pending queues. A decide moves a row out of a queue but cannot change the
   * staff roster, so the staff list is fetched once (in `#load`) and never refetched here. Throws to
   * its caller's catch. */
  async #loadQueues(): Promise<void> {
    const [swaps, absences] = await Promise.all([
      this.api.listPendingSwaps(),
      this.api.listPendingAbsences(),
    ]);
    this.swaps = swaps;
    this.absences = absences;
  }

  /** Surface a rejection as the `errorKey` banner — the thrown domain `{ code }`, or `server.internal`
   * when the value carries none (a bare Error / network fault). The one place the fallback lives. */
  #fail(error: unknown): void {
    this.errorKey = codeOf(error);
  }

  /** A person's display name, or the raw id when it is not in the loaded staff list. Backed by the
   * `#names` map built when the staff list loaded, so it is O(1) per rendered row. */
  #name(personId: string): string {
    return resolvePersonName(this.#names, personId);
  }

  async #decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.decideSwap(swapId, decision);
      await this.#loadQueues();
    } catch (error) {
      this.#fail(error);
    } finally {
      this.busy = false;
    }
  }

  async #decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.decideAbsence(absenceId, decision);
      await this.#loadQueues();
    } catch (error) {
      this.#fail(error);
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("approvals.title")}</h1>
      <div class="queues">
        <section class="queue" aria-labelledby="swaps-h">
          <h2 id="swaps-h">${t("approvals.swaps_title")}</h2>
          ${
            this.swaps.length === 0
              ? html`<p class="muted" data-test="no-swaps">${t("approvals.none_swaps")}</p>`
              : html`<ul>
                  ${this.swaps.map(
                    (s) =>
                      html`<li data-test=${`swap-${s.id}`}>
                        <span
                          >${this.#name(s.requestedByPersonId)} → ${this.#name(s.toPersonId)}</span
                        >
                        <span class="actions">
                          <wt-button
                            variant="primary"
                            data-test=${`approve-swap-${s.id}`}
                            ?disabled=${this.busy}
                            @click=${() => void this.#decideSwap(s.id, "approved")}
                            >${t("approvals.approve")}</wt-button
                          >
                          <wt-button
                            variant="secondary"
                            data-test=${`reject-swap-${s.id}`}
                            ?disabled=${this.busy}
                            @click=${() => void this.#decideSwap(s.id, "rejected")}
                            >${t("approvals.reject")}</wt-button
                          >
                        </span>
                      </li>`,
                  )}
                </ul>`
          }
        </section>
        <section class="queue" aria-labelledby="absences-h">
          <h2 id="absences-h">${t("approvals.absences_title")}</h2>
          ${
            this.absences.length === 0
              ? html`<p class="muted" data-test="no-absences">${t("approvals.none_absences")}</p>`
              : html`<ul>
                  ${this.absences.map(
                    (a) =>
                      html`<li data-test=${`absence-${a.id}`}>
                        <span
                          >${this.#name(a.personId)} · ${absenceKindName(a.kind)} ·
                          ${a.startsOn}–${a.endsOn}</span
                        >
                        <span class="actions">
                          <wt-button
                            variant="primary"
                            data-test=${`approve-absence-${a.id}`}
                            ?disabled=${this.busy}
                            @click=${() => void this.#decideAbsence(a.id, "approved")}
                            >${t("approvals.approve")}</wt-button
                          >
                          <wt-button
                            variant="secondary"
                            data-test=${`reject-absence-${a.id}`}
                            ?disabled=${this.busy}
                            @click=${() => void this.#decideAbsence(a.id, "rejected")}
                            >${t("approvals.reject")}</wt-button
                          >
                        </span>
                      </li>`,
                  )}
                </ul>`
          }
        </section>
      </div>
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-approvals-screen": ApprovalsScreen;
  }
}
