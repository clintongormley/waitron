import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  focusFirstInvalid,
  draftScopeFor,
  LeaveController,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import {
  CONFLICT_RECOVERY_STRINGS,
  type ConflictRecoveryString,
} from "./conflict-recovery-strings.js";
import { ConflictRecoveryClient } from "./conflict-recovery-client.js";
import type { ActiveConflict, ConflictRef } from "../conflict-evidence.js";
import {
  parseConflictRequest,
  type ConflictCommand,
  type ConflictResult,
  type ConflictPreparationResult,
} from "../conflict-recovery-contract.js";
import type { ActivationResult } from "../schema/allocations.js";

@customElement("vf-conflict-recovery")
export class ConflictRecovery extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        color: var(--wt-color-text);
      }
      main {
        display: grid;
        gap: var(--wt-space-4);
        margin: auto;
        padding: var(--wt-space-5);
        max-width: var(--wt-modal-standard-width);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
        margin: 0;
      }
      h2 {
        font-size: var(--wt-font-size-lg);
        margin: 0;
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      section {
        display: grid;
        gap: var(--wt-space-3);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) request!: DashboardRequest;
  @property() locale: "en" | "es" = "en";
  @state() private key = "";
  @state() private attempted = false;
  @state() private busy = false;
  @state() private refusal = "";
  @state() private active: readonly ActiveConflict[] | null = null;
  @state() private offline = false;
  @state() private noParallel = false;
  @state() private isolationAttempted = false;
  @state() private selection: Extract<ConflictPreparationResult, { status: "selected" }> | null =
    null;
  @state() private completed: ActivationResult | null = null;
  @state() private uncertain = false;
  @state() private restart = false;
  @state() private activating = false;
  @state() private waiting: { remainingMs: number; measuredAt: number } | null = null;
  @state() private remainingSeconds = 0;
  readonly #leave = new LeaveController(this);
  #scope?: DraftScope<{ hasKey: boolean; offline: boolean; parallel: boolean }>;
  #poll?: ReturnType<typeof setTimeout>;
  #tick?: ReturnType<typeof setInterval>;
  #generation = 0;
  #abort = new AbortController();
  #eventId: string = crypto.randomUUID();
  #conflict: ConflictRef | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => ({
        hasKey: this.key.length > 0,
        offline: this.offline,
        parallel: this.noParallel,
      }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) =>
        a.hasKey === b.hasKey && a.offline === b.offline && a.parallel === b.parallel,
      restore: () => this.stop(),
    }).scope;
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem("vf-conflict-attempt") ?? "null");
      if (
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 2 &&
        "eventId" in value &&
        "conflict" in value
      ) {
        const parsed = parseConflictRequest({
          recoveryKey: "",
          eventId: value.eventId,
          conflict: value.conflict,
          oldMachineOffline: false,
          noParallelRecovery: false,
          command: { kind: "status" },
        });
        if (parsed !== null) {
          this.#eventId = parsed.eventId;
          this.#conflict = parsed.conflict;
        }
      }
    } catch {
      /* Storage availability does not grant recovery authority. */
    }
  }
  private remember(): void {
    try {
      sessionStorage.setItem(
        "vf-conflict-attempt",
        JSON.stringify({ eventId: this.#eventId, conflict: this.#conflict }),
      );
    } catch {
      /* The active flow keeps its nonsecret binding in memory. */
    }
  }
  private forget(): void {
    try {
      sessionStorage.removeItem("vf-conflict-attempt");
    } catch {
      /* Storage is optional. */
    }
  }
  private cancelWait(): void {
    clearTimeout(this.#poll);
    clearInterval(this.#tick);
    this.waiting = null;
  }

  private t(key: ConflictRecoveryString): string {
    return CONFLICT_RECOVERY_STRINGS[this.locale][key];
  }
  private stop(): void {
    this.#generation++;
    this.#abort.abort();
    this.#abort = new AbortController();
    this.cancelWait();
    this.key = "";
    this.busy = false;
    this.attempted = false;
    this.refusal = "";
    this.active = null;
    this.offline = false;
    this.noParallel = false;
    this.isolationAttempted = false;
    this.selection = null;
    this.activating = false;
    this.#scope?.commit({ hasKey: false, offline: false, parallel: false });
  }
  override disconnectedCallback(): void {
    this.stop();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }
  private async within(
    run: (send: (command: ConflictCommand) => Promise<ConflictResult>) => Promise<void>,
  ): Promise<void> {
    if (this.busy) return;
    this.attempted = true;
    if (!this.key.trim()) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const generation = this.#generation;
    this.busy = true;
    this.refusal = "";
    const send = async (command: ConflictCommand): Promise<ConflictResult> => {
      if (generation !== this.#generation) throw { code: "connection.cancelled" };
      const result = await new ConflictRecoveryClient(this.request).send(
        {
          recoveryKey: this.key,
          eventId: this.#eventId,
          ...(this.#conflict === undefined ? {} : { conflict: this.#conflict }),
          oldMachineOffline: this.offline,
          noParallelRecovery: this.noParallel,
          command,
        },
        this.#abort.signal,
      );
      if (generation !== this.#generation) throw { code: "connection.cancelled" };
      return result;
    };
    try {
      await run(send);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.cancelWait();
      const code = codeOf(error);
      const reason = (error as { params?: { reason?: unknown } } | null)?.params?.reason;
      if (code === "promotion.break_glass_invalid") {
        this.offline = false;
        this.noParallel = false;
        this.key = "";
        this.active = null;
        this.selection = null;
        this.refusal = this.t("conflict_recovery.key_refused");
      } else if (code === "sif.allocation_invalid" && reason === "uncertain_prior_activation") {
        this.selection = null;
        this.uncertain = true;
        this.refusal = this.t("conflict_recovery.uncertain");
      } else if (
        code === "sif.allocation_invalid" &&
        (reason === "old_machine_active" || reason === "parallel_recovery")
      ) {
        this.offline = false;
        this.noParallel = false;
        this.selection = null;
        this.refusal = this.t("conflict_recovery.confirm");
      } else
        this.refusal = this.t(
          code === "authorization.not_permitted"
            ? "conflict_recovery.connection_refused"
            : code === "node.read_only"
              ? "conflict_recovery.not_primary"
              : code === "recovery.rate_limited"
                ? "conflict_recovery.limited"
                : "conflict_recovery.failed",
        );
    } finally {
      if (generation === this.#generation) {
        this.busy = false;
        this.activating = false;
      }
    }
  }
  private acceptStatus(result: ConflictResult): void {
    if (result.kind !== "status") throw { code: "connection.failed" };
    if (result.event.kind === "committed") {
      this.complete(result.event.result);
      return;
    }
    this.active = result.active;
    this.restart = result.event.kind === "restart-required" || this.uncertain;
    this.uncertain = false;
    const first = result.active[0];
    if (this.#conflict === undefined && first !== undefined) {
      this.#conflict = { registroId: first.registroId, caseId: first.caseId, sifId: first.sifId };
      this.remember();
    }
  }
  private inspect(): Promise<void> {
    return this.within(async (send) => this.acceptStatus(await send({ kind: "status" })));
  }
  private compare(): Promise<void> {
    this.isolationAttempted = true;
    if (!this.offline || !this.noParallel || this.#conflict === undefined) return Promise.resolve();
    this.cancelWait();
    return this.within(async (send) => {
      const challenge = await send({ kind: "prepare", proposal: { action: "clock-challenge" } });
      if (challenge.kind !== "prepared" || !("boxInstantMs" in challenge.value))
        throw { code: "connection.failed" };
      const compared = await send({
        kind: "prepare",
        proposal: {
          action: "compare-clocks",
          browser: { challengeId: challenge.value.id, instantMs: Date.now() },
        },
      });
      if (compared.kind !== "prepared" || !("clock" in compared.value))
        throw { code: "connection.failed" };
      const clock = compared.value.clock;
      if (clock.disagreement || !clock.secondClock || clock.releaseBlocked || clock.rangeBlocked) {
        this.refusal = this.t(
          clock.disagreement
            ? "conflict_recovery.clock_disagrees"
            : "conflict_recovery.clock_missing",
        );
        return;
      }
      const selected = await send({
        kind: "prepare",
        proposal: { action: "select", comparisonId: compared.value.id },
      });
      if (selected.kind !== "prepared" || !("status" in selected.value))
        throw { code: "connection.failed" };
      if (selected.value.status === "waiting") {
        this.wait(selected.value.remainingMs);
        return;
      }
      if (selected.value.status !== "selected") throw { code: "connection.failed" };
      const input = selected.value.input;
      const operator = input.approval.operatorId;
      if (
        input.approval.eventId !== this.#eventId ||
        input.allocation.allocationId !== `hour/${this.#eventId}` ||
        input.allocation.installationIdentity !== selected.value.identity ||
        input.approval.sourceId !==
          JSON.stringify([
            "conflict",
            this.#conflict!.sifId,
            this.#conflict!.registroId,
            this.#conflict!.caseId,
          ]) ||
        typeof operator === "string" ||
        operator.eventId !== this.#eventId ||
        operator.nodeId !== input.approval.targetNodeId ||
        !input.approval.oldMachineOffline ||
        !input.approval.noParallelRecovery ||
        input.approval.oldMachineAbsent
      )
        throw { code: "connection.failed" };
      this.selection = selected.value;
    });
  }
  private wait(remainingMs: number): void {
    this.cancelWait();
    this.waiting = { remainingMs, measuredAt: performance.now() };
    this.remainingSeconds = Math.ceil(remainingMs / 1000);
    this.#tick = setInterval(() => {
      const waiting = this.waiting;
      if (waiting !== null)
        this.remainingSeconds = Math.max(
          0,
          Math.ceil((waiting.remainingMs - (performance.now() - waiting.measuredAt)) / 1000),
        );
    }, 1000);
    this.#poll = setTimeout(() => {
      void this.within(async (send) => {
        const answer = await send({ kind: "prepare", proposal: { action: "preview" } });
        this.cancelWait();
        if (answer.kind !== "prepared" || !("status" in answer.value))
          throw { code: "connection.failed" };
        if (answer.value.status === "waiting") this.wait(answer.value.remainingMs);
        else if (answer.value.status !== "preview") throw { code: "connection.failed" };
      });
    }, 5000);
  }
  private switchIdentity(): Promise<void> {
    const selection = this.selection;
    if (selection === null || !this.offline || !this.noParallel || this.uncertain)
      return Promise.resolve();
    return this.within(async (send) => {
      this.uncertain = true;
      this.activating = true;
      this.selection = null;
      try {
        const answer = await send({ kind: "activate", input: selection.input });
        if (answer.kind !== "committed") throw { code: "connection.failed" };
        this.complete(answer.result);
      } catch (error) {
        if (
          codeOf(error) === "promotion.break_glass_invalid" ||
          codeOf(error) === "connection.cancelled"
        )
          throw error;
        this.acceptStatus(await send({ kind: "status" }));
      }
    });
  }
  private complete(result: ActivationResult): void {
    if (result.activationEventId !== this.#eventId) throw { code: "connection.failed" };
    this.stop();
    this.forget();
    this.uncertain = false;
    this.restart = false;
    this.completed = result;
  }
  private again(): void {
    this.stop();
    this.forget();
    this.#eventId = crypto.randomUUID();
    this.#conflict = undefined;
    this.restart = false;
    this.uncertain = false;
  }
  override render() {
    const invalid = this.attempted && !this.key.trim();
    const isolationInvalid = this.isolationAttempted && (!this.offline || !this.noParallel);
    return html`<main>
        <h1>${this.t("conflict_recovery.title")}</h1>
        <p>${this.t("conflict_recovery.preserved")}</p>
        ${
          this.completed !== null
            ? html`<section data-complete>
                <h2>${this.t("conflict_recovery.complete")}</h2>
                ${this.completed.series.map((series) => html`<p>${series.code}</p>`)}
              </section>`
            : html` <wt-input
                  name="recoveryKey"
                  .label=${this.t("conflict_recovery.key")}
                  type="password"
                  autocomplete="off"
                  required
                  .value=${this.key}
                  .disabled=${this.busy}
                  .error=${invalid ? this.t("conflict_recovery.key_required") : ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    this.key = event.detail.value;
                    this.#scope?.changed();
                  }}
                ></wt-input>
                ${
                  this.active !== null && this.active.length > 0
                    ? html`<section>
                        <p>${this.t("conflict_recovery.explanation")}</p>
                        ${this.active.map((conflict) => html`<p data-conflict>${conflict.installationIdentity} · ${conflict.invoiceIdentity}</p>`)}
                        <wt-switch
                          name="oldMachineOffline"
                          .label=${this.t("conflict_recovery.offline")}
                          .checked=${this.offline}
                          .disabled=${this.busy || this.selection !== null || this.uncertain || this.restart}
                          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                            this.offline = e.detail.checked;
                          }}
                        ></wt-switch>
                        <wt-switch
                          name="noParallelRecovery"
                          .label=${this.t("conflict_recovery.parallel")}
                          .checked=${this.noParallel}
                          .disabled=${this.busy || this.selection !== null || this.uncertain || this.restart}
                          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => {
                            this.noParallel = e.detail.checked;
                          }}
                        ></wt-switch>
                        ${isolationInvalid ? html`<p class="error">${this.t("conflict_recovery.confirm")}</p>` : nothing}
                      </section>`
                    : nothing
                }
                ${this.active?.length === 0 ? html`<p>${this.t("conflict_recovery.no_conflict")}</p>` : nothing}
                ${this.selection === null ? nothing : html`<p data-identity>${this.selection.identity}</p>`}
                ${this.waiting === null ? nothing : html`<p data-wait role="status">${this.t("conflict_recovery.wait").replace("{seconds}", String(this.remainingSeconds))}</p>`}
                ${this.uncertain ? html`<p role="status">${this.t("conflict_recovery.uncertain")}</p>` : nothing}
                ${this.restart ? html`<p role="status">${this.t("conflict_recovery.restart")}</p>` : nothing}
                <wt-form-actions
                  .error=${[invalid || isolationInvalid ? this.t("conflict_recovery.invalid") : "", this.refusal].filter(Boolean).join(" ")}
                >
                  <wt-button
                    slot="cancel"
                    data-action="stop"
                    variant="secondary"
                    @click=${this.stop}
                    >${this.t("conflict_recovery.stop")}</wt-button
                  >
                  ${this.restart ? html`<wt-button data-action="again" variant="primary" @click=${this.again}>${this.t("conflict_recovery.again")}</wt-button>` : this.selection !== null || this.activating ? html`<wt-button data-action="switch" variant="primary" .disabled=${this.busy || invalid} .loading=${this.busy} @click=${this.switchIdentity}>${this.t("conflict_recovery.switch")}</wt-button>` : this.#conflict !== undefined && this.active !== null && !this.uncertain ? html`<wt-button data-action="compare" .variant=${this.busy || (this.offline && this.noParallel && !invalid && !isolationInvalid && this.waiting === null) ? "primary" : "secondary"} .disabled=${this.busy || invalid || isolationInvalid || this.waiting !== null} .loading=${this.busy} @click=${this.compare}>${this.t("conflict_recovery.compare")}</wt-button>` : html`<wt-button data-action="inspect" .variant=${this.busy || this.key.trim().length > 0 ? "primary" : "secondary"} .disabled=${this.busy || invalid} .loading=${this.busy} @click=${this.inspect}>${this.t("conflict_recovery.inspect")}</wt-button>`}
                </wt-form-actions>`
        }
      </main>
      ${this.#leave.render({ heading: this.t("conflict_recovery.leave_title"), message: this.t("conflict_recovery.leave_message"), keepLabel: this.t("conflict_recovery.keep"), discardLabel: this.t("conflict_recovery.discard") })}`;
  }
}
