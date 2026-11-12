import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { BoxClockConfirmed, PersonRole, StaffMember } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { clockDateTime, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { trackDialog } from "./track-dialog.js";
import "./supervisor-override-dialog.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";

type Override = { personId: string; pin: string };

export interface BoxTimeApi {
  boxClockChallenge(
    override?: Override,
  ): Promise<{ challengeId: string; boxAt: string; keepOffered?: true }>;
  boxClockConfirm(body: {
    challengeId: string;
    deviceAt: number;
    keep?: true;
    override?: Override;
  }): Promise<BoxClockConfirmed>;
  listAdjustmentApprovers(roles: PersonRole[]): Promise<StaffMember[]>;
}

/** How far this till's clock may be from the box's and still agree with it. */
const AGREES_MS = 60_000;

type Choice = "server" | "device" | "yes";

type View =
  | { kind: "loading" }
  | {
      kind: "ask";
      boxAt: number;
      tillAt: number;
      keepOffered: boolean;
      sending: Choice | null;
      /** Asked to correct this device's own time instead of choosing. */
      correcting: boolean;
    }
  | { kind: "done"; text: string }
  | { kind: "refused"; text: string; checkAgain: boolean; admin: boolean };

/** An administrator's PIN refused at the confirm, by code. */
const PIN_REFUSALS: Record<string, StringKey> = {
  "pin.invalid": "box_time.admin_refused.pin_invalid",
  "pin.throttled": "box_time.admin_refused.pin_throttled",
  "authorization.not_permitted": "box_time.admin_refused.not_permitted",
};

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
  stopped: { key: "box_time.refused.stopped", checkAgain: true },
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
 * choice of which is correct. The till never asks anyone to type a time: it sends
 * its own. Emits `box-time-close` when it closes and `box-time-done` once the box took it. */
@customElement("till-box-time-dialog")
export class TillBoxTimeDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .words p {
        margin: 0 0 var(--wt-space-3);
      }
      .clocks {
        margin: 0 0 var(--wt-space-3);
      }
      .clocks div {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        column-gap: var(--wt-space-3);
        margin-block-end: var(--wt-space-2);
      }
      .clocks dd {
        margin: 0;
        font-weight: var(--wt-font-weight-medium);
        white-space: nowrap;
      }
      .words p.question {
        margin: 0 0 var(--wt-space-2);
      }
      wt-button[slot="cancel"] {
        white-space: nowrap;
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
      const { boxAt, keepOffered } = await this.api.boxClockChallenge(this.#override);
      this.view = {
        kind: "ask",
        boxAt: Date.parse(boxAt),
        tillAt: Date.now(),
        keepOffered: keepOffered === true,
        sending: null,
        correcting: false,
      };
    } catch (error) {
      this.#refused(error);
    }
  }

  /** A fresh challenge, since one lives only a few seconds, then the confirm with this till's time;
   * for `"server"`, the confirm asks the box to keep its own time whatever this till's says. */
  async #send(choice: Choice): Promise<void> {
    if (this.view.kind !== "ask" || this.view.sending !== null) return;
    const keep = choice === "server";
    const override = this.#override;
    this.view = { ...this.view, sending: choice };
    try {
      const { challengeId } = await this.api.boxClockChallenge(override);
      const deviceAt = Date.now();
      const answer = await this.api.boxClockConfirm({
        challengeId,
        deviceAt,
        ...(keep ? { keep: true as const } : {}),
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
      if (override !== undefined && typeof code === "string" && Object.hasOwn(PIN_REFUSALS, code)) {
        this.view = {
          kind: "refused",
          text: t(PIN_REFUSALS[code]!),
          checkAgain: false,
          admin: true,
        };
        return;
      }
      this.#refused(error);
    }
  }

  #refused(error: unknown): void {
    if ((error as { code?: unknown } | null)?.code === "device.unauthorized") {
      this.view = {
        kind: "refused",
        text: codeMessage("device.unauthorized"),
        checkAgain: false,
        admin: false,
      };
      return;
    }
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

  /** "The server" asks the box to keep its own time only when the box offers it (`keepOffered`);
   * otherwise it asks the same as "Both times are wrong". */
  #correctDevice(): void {
    if (this.view.kind !== "ask" || this.view.sending !== null) return;
    this.view = { ...this.view, correcting: true };
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
        const differs = Math.abs(view.tillAt - view.boxAt) > AGREES_MS;
        const choice = (
          name: string,
          label: StringKey,
          variant: "primary" | "secondary",
          onClick: () => void,
          sends?: Choice,
        ) =>
          html`<wt-button
            variant=${variant}
            data-box-time=${name}
            .loading=${sends !== undefined && view.sending === sends}
            .disabled=${view.sending !== null}
            @click=${onClick}
            >${t(label)}</wt-button
          >`;
        const correct = () => this.#correctDevice();
        return html`<div class="words" data-box-time-words>
            <p>${t("box_time.important")}</p>
            <dl class="clocks">
              <div>
                <dt>${t("box_time.server_says")}</dt>
                <dd>${clockDateTime(view.boxAt)}</dd>
              </div>
              <div>
                <dt>${t("box_time.device_says")}</dt>
                <dd>${clockDateTime(view.tillAt)}</dd>
              </div>
            </dl>
            <p class="question">
              ${t(
                view.correcting
                  ? "box_time.correct_device"
                  : differs
                    ? "box_time.which_correct"
                    : "box_time.is_correct",
              )}
            </p>
          </div>
          <wt-form-actions
            >${
              view.correcting
                ? this.#button("close", "box_time.close", close, "cancel")
                : differs
                  ? html`${choice(
                      "server",
                      "box_time.server",
                      "primary",
                      view.keepOffered ? () => void this.#send("server") : correct,
                      view.keepOffered ? "server" : undefined,
                    )}${choice(
                      "device",
                      "box_time.device",
                      "primary",
                      () => void this.#send("device"),
                      "device",
                    )}${choice("both-wrong", "box_time.both_wrong", "secondary", correct)}`
                  : html`${choice("no", "box_time.no", "secondary", correct)}${choice(
                      "yes",
                      "box_time.yes",
                      "primary",
                      () => void this.#send("yes"),
                      "yes",
                    )}`
            }</wt-form-actions
          >`;
      }
    }
  }

  override render(): TemplateResult {
    return html`<wt-dialog
        ${trackDialog()}
        .open=${this.active}
        .heading=${t("box_time.title")}
        .dismissible=${!(this.view.kind === "ask" && this.view.sending !== null)}
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
