import { codeOf } from "../i18n/codes.js";
import type { DashboardApi } from "./client.js";

export const PAIRING_RENEW_MS = 60_000;
export type PairingHoldStatus = "idle" | "held" | "lapsed" | "failed";

/** Codes after which renewing again cannot succeed: the hold or the login is gone. */
const FINAL = new Set([
  "device.pairing_hold_lapsed",
  "management_session.required",
  "management_session.expired",
  "authorization.not_permitted",
  "person.suspended",
]);

/**
 * Holds the venue's join window open for as long as one dashboard dialog is open. `onChange` is told
 * of each status change; a change to `held` carries the taken hold's lapse, so a screen can show it
 * before its own read of the window answers.
 */
export class PairingHold {
  #holdId: string | null = null;
  #status: PairingHoldStatus = "idle";
  #epoch = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly api: () => DashboardApi,
    private readonly onChange: (
      status: PairingHoldStatus,
      errorCode: string | null,
      openUntil: string | null,
    ) => void,
    private readonly renewMs = PAIRING_RENEW_MS,
  ) {}

  get holdId(): string | null {
    return this.#holdId;
  }

  get status(): PairingHoldStatus {
    return this.#status;
  }

  async start(): Promise<void> {
    // A second start must not leak the first hold and its timer.
    if (this.#holdId !== null || this.#timer !== undefined) this.stop();
    const epoch = ++this.#epoch;
    try {
      const { holdId, openUntil } = await this.api().takePairingHold();
      if (epoch !== this.#epoch) {
        void this.api()
          .releasePairingHold(holdId)
          .catch(() => undefined);
        return;
      }
      this.#holdId = holdId;
      this.#set("held", null, openUntil);
      this.#timer = setInterval(() => void this.#renew(epoch), this.renewMs);
    } catch (error) {
      if (epoch === this.#epoch) this.#set("failed", codeOf(error));
    }
  }

  /** A failed release is ignored: the server lets an unrenewed hold lapse on its own. */
  stop(): void {
    this.#epoch++;
    clearInterval(this.#timer);
    this.#timer = undefined;
    const holdId = this.#holdId;
    this.#holdId = null;
    if (holdId !== null)
      void this.api()
        .releasePairingHold(holdId)
        .catch(() => undefined);
    if (this.#status !== "idle") this.#set("idle", null);
  }

  async #renew(epoch: number): Promise<void> {
    const holdId = this.#holdId;
    if (holdId === null) return;
    try {
      // Test stubs have no `background`; the real client always does.
      const api = this.api();
      await (api.background ?? api).renewPairingHold(holdId);
    } catch (error) {
      const code = codeOf(error);
      if (epoch !== this.#epoch || !FINAL.has(code)) return;
      clearInterval(this.#timer);
      this.#timer = undefined;
      this.#holdId = null;
      this.#set(code === "device.pairing_hold_lapsed" ? "lapsed" : "failed", code);
    }
  }

  #set(status: PairingHoldStatus, errorCode: string | null, openUntil: string | null = null): void {
    this.#status = status;
    this.onChange(status, errorCode, openUntil);
  }
}
