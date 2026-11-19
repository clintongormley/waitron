import {
  agreeingDeviceCount,
  agreeingDeviceGroup,
  type ClockWitness,
  type FutureDateRefusal,
} from "@waitron/fiscal";
import type { ClockServiceStatus } from "./box-host-client.js";
import { answersSynchronised, clockServiceAnswerOf } from "./clock-service-reading.js";

/** How close two devices' clocks must be to the box's, and to each other, to confirm a start. */
export const START_CLOCK_MARGIN_MS = 5_000;

/** The waiting notice's count of devices agreeing so far, at most 1: a group of two confirms at
 * the watch's next look, so "2 of 2" would show while the box still waits. */
export function startClockAgreed(witnesses: readonly ClockWitness[]): number {
  return Math.min(1, agreeingDeviceCount(witnesses, START_CLOCK_MARGIN_MS));
}

export type StartClockConfirmation = "by_devices" | "by_person" | "by_internet";
export type StartClockStatus = "waiting" | StartClockConfirmation;
export type StartClockCause = "start" | "future_date_refused" | "clock_jumped";
/** Each chain's node and its highest record position, as `recordHeads` reads them. */
export type ChainHeads = Readonly<Record<string, number>>;

/** Held in memory for one process. Only `backToWaiting` moves a box off `by_internet`. */
export interface StartClockState {
  readonly status: StartClockStatus;
  /** Why the box waits; null while it does not. */
  readonly cause: StartClockCause | null;
  /** The chain heads at the latest confirmation, or null before the first. */
  readonly mark: ChainHeads | null;
  /** The issue date of the sale AEAT refused as dated in the future, while waiting for that. */
  readonly refusedOn: string | null;
  /** False while the latest look could not hear from the host's time service. */
  readonly hostAnswers: boolean;
  unconfirmed(): boolean;
  /** Grows by one each time a wait begins, the start's included. */
  waitsBegun(): number;
  confirm(by: StartClockConfirmation, heads: ChainHeads): void;
  /** Moves any status to waiting, `by_internet` included: the caller decides by the reading. A
   * box waiting because AEAT refused a sale as dated in the future keeps that cause. */
  backToWaiting(cause: StartClockCause, refusedOn?: string): void;
  /** While waiting, confirms by devices when two or more agree within `START_CLOCK_MARGIN_MS`,
   * and answers their readings; otherwise answers none, changes nothing and reads no heads.
   * Devices never end a wait caused by AEAT refusing a sale as dated in the future. */
  confirmDevices(
    witnesses: readonly ClockWitness[],
    heads: () => Promise<ChainHeads>,
  ): Promise<ClockWitness[]>;
  noteHost(answers: boolean): void;
}

/** `onConfirmed` runs each time a wait ends by a confirmation. */
export function startClockState(onConfirmed: () => void = () => {}): StartClockState {
  let status: StartClockStatus = "waiting";
  let cause: StartClockCause | null = "start";
  let mark: ChainHeads | null = null;
  let refusedOn: string | null = null;
  let hostAnswers = true;
  let waits = 1;
  const current = (): StartClockStatus => status;

  const confirm = (by: StartClockConfirmation, heads: ChainHeads) => {
    if (status === "by_internet") return;
    const ended = status === "waiting";
    status = by;
    cause = null;
    refusedOn = null;
    mark = { ...heads };
    if (ended) onConfirmed();
  };

  return {
    get status() {
      return status;
    },
    get cause() {
      return cause;
    },
    get mark() {
      return mark;
    },
    get refusedOn() {
      return refusedOn;
    },
    get hostAnswers() {
      return hostAnswers;
    },
    unconfirmed: () => status === "waiting",
    waitsBegun: () => waits,
    confirm,
    backToWaiting(next, refusedDate) {
      if (status === "waiting" && cause === "future_date_refused") return;
      if (status !== "waiting") waits++;
      status = "waiting";
      cause = next;
      refusedOn = next === "future_date_refused" ? (refusedDate ?? null) : null;
    },
    async confirmDevices(witnesses, heads) {
      if (status !== "waiting" || cause === "future_date_refused") return [];
      const group = agreeingDeviceGroup(witnesses, START_CLOCK_MARGIN_MS);
      if (group.length === 0) return [];
      const at = await heads();
      // A person or the internet may have confirmed while the heads were read.
      if (current() !== "waiting") return [];
      confirm("by_devices", at);
      return group;
    },
    noteHost(answers) {
      hostAnswers = answers;
    },
  };
}

export interface StartClockCheckDeps {
  readonly state: StartClockState;
  clockStatus(): Promise<ClockServiceStatus>;
  heads(): Promise<ChainHeads>;
}

/** Sends the box back to waiting unless the time service answers synchronised; a host that
 * throws or does not answer counts as not synchronised. Answers whether it moved. */
export async function backToWaitingUnlessSynchronised(
  deps: Pick<StartClockCheckDeps, "state" | "clockStatus">,
  cause: StartClockCause,
): Promise<boolean> {
  const answer = await clockServiceAnswerOf(deps.clockStatus);
  deps.state.noteHost(answer.available);
  if (answersSynchronised(answer)) return false;
  deps.state.backToWaiting(cause);
  return true;
}

/** Whether AEAT's future-date refusal at `position` on `nodeId`'s chain is of a sale recorded
 * since the latest confirmation; never before the first. */
function refusedSinceConfirmed(state: StartClockState, nodeId: string, position: number): boolean {
  return state.mark !== null && position > (state.mark[nodeId] ?? 0);
}

function waitingForRefusal(state: StartClockState): boolean {
  return state.status === "waiting" && state.cause === "future_date_refused";
}

/** Sends the box back to waiting because AEAT refused, as dated in the future, a sale recorded
 * since the latest confirmation, unless the time service is synchronised; a host that throws or
 * does not answer counts as not synchronised. */
export async function backToWaitingForRefusal(
  deps: Pick<StartClockCheckDeps, "state" | "clockStatus">,
  nodeId: string,
  refusal: FutureDateRefusal,
): Promise<"moved" | "synchronised" | "unchanged"> {
  const applies = () =>
    refusedSinceConfirmed(deps.state, nodeId, refusal.position) && !waitingForRefusal(deps.state);
  if (!applies()) return "unchanged";
  const answer = await clockServiceAnswerOf(deps.clockStatus);
  deps.state.noteHost(answer.available);
  if (answersSynchronised(answer)) return "synchronised";
  // A person may have confirmed while the time service was read.
  if (!applies()) return "unchanged";
  deps.state.backToWaiting("future_date_refused", refusal.issuedOn);
  return "moved";
}

/** One look at the time service: a synchronised answer confirms by the internet. A host that
 * throws or does not answer counts as not synchronised. Once by the internet it asks nothing. */
export async function lookAtClockService(deps: StartClockCheckDeps): Promise<void> {
  if (deps.state.status === "by_internet") return;
  const answer = await clockServiceAnswerOf(deps.clockStatus);
  deps.state.noteHost(answer.available);
  if (answersSynchronised(answer)) deps.state.confirm("by_internet", await deps.heads());
}

/** The start's own look, on the state the process has just made. */
export async function startClockCheck(
  deps: StartClockCheckDeps,
): Promise<"by_internet" | "waiting"> {
  await lookAtClockService(deps);
  return deps.state.status === "by_internet" ? "by_internet" : "waiting";
}
