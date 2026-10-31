import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { BoxClockConfirmed, PersonRole, StaffMember } from "../api/client.js";
import { clockDateTime, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";
import "./supervisor-override-dialog.js";
import { overrideErrorText, type OverrideConfirmDetail } from "./supervisor-override-dialog.js";

type Override = { personId: string; pin: string };

export interface BoxTimeApi {
  boxClockChallenge(override?: Override): Promise<{ challengeId: string; boxAt: string }>;
  boxClockConfirm(body: {
    challengeId: string;
    deviceAt: number;
    override?: Override;
  }): Promise<BoxClockConfirmed>;
  listAdjustmentApprovers(roles: PersonRole[]): Promise<StaffMember[]>;
}

/** How far this till's clock may be from the box's and still agree with it. */
const AGREES_MS = 60_000;

type View =
  | { kind: "loading" }
  | { kind: "ask"; boxAt: number; tillAt: number; sending: boolean }
  | { kind: "done"; text: string }
  | { kind: "refused"; text: string; checkAgain: boolean; admin: boolean };

const PIN_REFUSALS = new Set(["pin.invalid", "pin.throttled", "authorization.not_permitted"]);

/** The box's set and confirm refusals a person can act on, by reason. */
const REASONS: Record<string, { key: StringKey; checkAgain: boolean }> = {
  not_stopped: { key: "box_time.refused.not_stopped", checkAgain: false },
  not_start_up: { key: "box_time.refused.not_start_up", checkAgain: false },
  authority_pending: { key: "box_time.refused.authority_pending", checkAgain: true },
  witnessed: { key: "box_time.refused.witnessed", checkAgain: false },
  target_invalid: { key: "box_time.refused.target_invalid", checkAgain: true },
  synchronised: { key: "box_time.refused.synchronised", checkAgain: false },
  host_unavailable: { key: "box_time.refused.host_unavailable", checkAgain: false },
  stale: { key: "box_time.refused.stale", checkAgain: true },
  same_machine: { key: "box_time.refused.same_machine", checkAgain: false },
  contrary_proof: { key: "box_time.refused.contrary_proof", checkAgain: false },
  pending_disproofs: { key: "box_time.refused.pending_disproofs", checkAgain: true },
};

const OTHER = { key: "box_time.refused.other", checkAgain: true } as const;

function refusalOf(error: unknown): { key: StringKey; checkAgain: boolean } {
  const { code, reason } = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    reason?: unknown;
  };
  if (code === "clock.check_expired")
    return { key: "box_time.refused.check_expired", checkAgain: true };
  if (code === "device_profile.not_admitted")
    return { key: "box_time.refused.not_admitted", checkAgain: false };
  if (code === "clock.set_failed" && (reason === "refused" || reason === "unverified"))
    return { key: `box_time.refused.set_failed_${reason}`, checkAgain: true };
  if (
    (code === "clock.set_refused" || code === "clock.confirm_refused") &&
    typeof reason === "string" &&
    Object.hasOwn(REASONS, reason)
  )
    return REASONS[reason]!;
  return OTHER;
}

/** "Check the time" on a till: the box's time beside this till's, and the signed-in person's
 * confirmation of it or of this till's time. The till never asks anyone to type a time: it sends
 * its own. Emits `box-time-close` when it closes and `box-time-done` once the box took it. */
@customElement("till-box-time-dialog")
export class TillBoxTimeDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .words p {
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: BoxTimeApi;

  @state() private view: View = { kind: "loading" };
  @state() private admins: StaffMember[] | null = null;
  @state() private active = true;
  /** An administrator who signed in here: every later check carries their PIN. */
  #override?: Override;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#check();
  }

  async #check(): Promise<void> {
    this.view = { kind: "loading" };
    try {
      const { boxAt } = await this.api.boxClockChallenge(this.#override);
      this.view = { kind: "ask", boxAt: Date.parse(boxAt), tillAt: Date.now(), sending: false };
    } catch (error) {
      this.#refused(error);
    }
  }

  /** A fresh challenge, since one lives only a few seconds, then the confirm with this till's time. */
  async #send(): Promise<void> {
    if (this.view.kind !== "ask" || this.view.sending) return;
    const override = this.#override;
    this.view = { ...this.view, sending: true };
    try {
      const { challengeId } = await this.api.boxClockChallenge(override);
      const deviceAt = Date.now();
      const answer = await this.api.boxClockConfirm({
        challengeId,
        deviceAt,
        ...(override === undefined ? {} : { override }),
      });
      this.view = {
        kind: "done",
        text:
          answer.stepMs === 0
            ? t("box_time.confirmed")
            : t("box_time.set_to").replace("{after}", () =>
                clockDateTime(Date.parse(answer.confirmedAt)),
              ),
      };
      this.dispatchEvent(new CustomEvent("box-time-done", { bubbles: true, composed: true }));
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (override !== undefined && typeof code === "string" && PIN_REFUSALS.has(code)) {
        this.view = {
          kind: "refused",
          text: overrideErrorText(code),
          checkAgain: false,
          admin: true,
        };
        return;
      }
      this.#refused(error);
    }
  }

  #refused(error: unknown): void {
    const { key, checkAgain } = refusalOf(error);
    this.view = {
      kind: "refused",
      text: t(key).replace("{till}", () => clockDateTime(Date.now())),
      checkAgain,
      admin: key === "box_time.refused.not_start_up",
    };
  }

  async #askAdmin(): Promise<void> {
    try {
      this.admins = await this.api.listAdjustmentApprovers(["admin"]);
    } catch (error) {
      this.#refused(error);
    }
  }

  /** The PIN is checked only at the confirm, so the question with both times is shown first. */
  #signedIn(event: CustomEvent<OverrideConfirmDetail>): void {
    event.stopPropagation();
    if (this.admins === null) return;
    this.admins = null;
    this.#override = { personId: event.detail.personId, pin: event.detail.pin };
    void this.#check();
  }

  #close(): void {
    if (!this.active) return;
    this.active = false;
    this.dispatchEvent(new CustomEvent("box-time-close", { bubbles: true, composed: true }));
  }

  #button(name: string, label: StringKey, onClick: () => void, slot?: string): TemplateResult {
    return html`<wt-button
      slot=${slot ?? nothing}
      variant=${slot === "cancel" ? "secondary" : "primary"}
      data-box-time=${name}
      @click=${onClick}
      >${t(label)}</wt-button
    >`;
  }

  #body(): TemplateResult {
    const view = this.view;
    const close = () => this.#close();
    switch (view.kind) {
      case "loading":
        return html`<div class="words" data-box-time-words><p>${t("box_time.loading")}</p></div>
          <wt-form-actions
            >${this.#button("close", "box_time.close", close, "cancel")}</wt-form-actions
          >`;
      case "done":
        return html`<div class="words" data-box-time-words><p>${view.text}</p></div>
          <wt-form-actions
            >${this.#button("close", "box_time.close", close, "cancel")}</wt-form-actions
          >`;
      case "refused":
        return html`<wt-form-actions .error=${view.text}
          >${this.#button("close", "box_time.close", close, "cancel")}${
            view.checkAgain
              ? this.#button("check-again", "box_time.check_again", () => void this.#check())
              : nothing
          }${view.admin ? this.#button("admin", "box_time.admin", () => void this.#askAdmin()) : nothing}</wt-form-actions
        >`;
      case "ask": {
        const box = clockDateTime(view.boxAt);
        const differs = Math.abs(view.tillAt - view.boxAt) > AGREES_MS;
        return html`<div class="words" data-box-time-words>
            ${
              differs
                ? html`<p>
                      ${t("box_time.differs")
                        .replace("{box}", () => box)
                        .replace("{till}", () => clockDateTime(view.tillAt))}
                    </p>
                    <p>${t("box_time.differs_ask")}</p>
                    <p>${t("box_time.differs_wrong_till")}</p>`
                : html`<p>${t("box_time.agrees").replace("{box}", () => box)}</p>`
            }
          </div>
          <wt-form-actions
            ><wt-button
              slot="cancel"
              variant="secondary"
              data-box-time="not-now"
              .disabled=${view.sending}
              @click=${close}
              >${t("box_time.not_now")}</wt-button
            ><wt-button
              variant="primary"
              data-box-time="primary"
              .loading=${view.sending}
              .disabled=${view.sending}
              @click=${() => void this.#send()}
              >${t(differs ? "box_time.use_till" : "box_time.time_right")}</wt-button
            ></wt-form-actions
          >`;
      }
    }
  }

  override render(): TemplateResult {
    return html`<wt-dialog
        ${trackDialog()}
        .open=${this.active}
        .heading=${t("box_time.title")}
        .dismissible=${!(this.view.kind === "ask" && this.view.sending)}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) this.#close();
        }}
        >${this.#body()}</wt-dialog
      >${
        this.admins === null
          ? nothing
          : html`<till-supervisor-override-dialog
              .authorizers=${this.admins}
              .approverRole=${"admin"}
              @override-cancel=${(event: Event) => {
                event.stopPropagation();
                this.admins = null;
              }}
              @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) =>
                this.#signedIn(event)}
            ></till-supervisor-override-dialog>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-box-time-dialog": TillBoxTimeDialog;
  }
}
