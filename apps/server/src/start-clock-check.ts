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
export type StartClockCause = "start" | "future_date_refused" | "clock_jumped" | "identity_change";
/** Each chain's node and its highest record position, as `recordHeads` reads them. */
export type ChainHeads = Readonly<Record<string, number>>;

/** A confirmation kept while a new fiscal installation waits to be opened. A person's carries
 * whether it still stands: it is the one held, and the box's clock has not moved since. */
export type HeldConfirmation =
  | { readonly by: "by_internet"; readonly heads: ChainHeads }
  | { readonly by: "by_person"; readonly heads: ChainHeads; readonly standing: () => boolean };

export interface PersonHold {
  /** Reads the box's clock as a person confirms it, and answers whether it still stands so. */
  readonly standing: () => () => boolean;
  /** Runs as a person's confirmation is held, possibly inside the request's transaction. */
  readonly onHeld: () => void;
}

/** Held in memory for one process. Only `backToWaiting` moves a box off `by_internet`. */
export interface StartClockState {
  readonly status: StartClockStatus;
  /** Why the box waits; null while it does not. `identity_change` while it holds for one, whatever
   * else it waits for. */
  readonly cause: StartClockCause | null;
  /** The chain heads at the latest confirmation, or null before the first. */
  readonly mark: ChainHeads | null;
  /** The issue date of the sale AEAT refused as dated in the future, while waiting for that. */
  readonly refusedOn: string | null;
  /** False while the latest look could not hear from the host's time service. */
  readonly hostAnswers: boolean;
  /** Whether a person's confirmation has ended a wait, or been given outside one, at any point in
   * this process, whatever since. One that is only held does not count. */
  readonly confirmedByPerson: boolean;
  unconfirmed(): boolean;
  /** Grows by one each time a wait begins, the start's included. */
  waitsBegun(): number;
  /** Answers false when the box, holding for an identity change, stays waiting: the internet's
   * confirmation is then held in place of any other, a person's in place of an earlier person's,
   * and any other changes nothing. */
  confirm(by: StartClockConfirmation, heads: ChainHeads): boolean;
  /** Moves any status to waiting, `by_internet` included: the caller decides by the reading. A
   * box waiting because AEAT refused a sale as dated in the future keeps that cause. A held
   * confirmation is dropped. */
  backToWaiting(cause: StartClockCause, refusedOn?: string): void;
  /** While waiting, confirms by devices when two or more agree within `START_CLOCK_MARGIN_MS`,
   * and answers their readings; otherwise answers none, changes nothing and reads no heads.
   * Devices never end a wait caused by AEAT refusing a sale as dated in the future, nor one that
   * holds for an identity change. */
  confirmDevices(
    witnesses: readonly ClockWitness[],
    heads: () => Promise<ChainHeads>,
  ): Promise<ClockWitness[]>;
  noteHost(answers: boolean): void;
  /** Keeps a waiting box waiting until `releaseIdentityChange`. */
  holdForIdentityChange(person: PersonHold): void;
  /** The confirmation that ends the wait at `releaseIdentityChange`; null without one. */
  readonly heldConfirmation: HeldConfirmation | null;
  dropHeldConfirmation(): void;
  /** Ends the hold and applies the held confirmation; without one the box waits on as before it. */
  releaseIdentityChange(): void;
}

/** `onConfirmed` runs each time a wait ends by a confirmation. */
export function startClockState(onConfirmed: () => void = () => {}): StartClockState {
  let status: StartClockStatus = "waiting";
  let cause: StartClockCause | null = "start";
  let mark: ChainHeads | null = null;
  let refusedOn: string | null = null;
  let hostAnswers = true;
  let waits = 1;
  let confirmedByPerson = false;
  let hold: PersonHold | null = null;
  let held: HeldConfirmation | null = null;
  const current = (): StartClockStatus => status;

  const confirm = (by: StartClockConfirmation, heads: ChainHeads): boolean => {
    if (hold !== null) {
      if (by === "by_internet") held = { by, heads: { ...heads } };
      if (by === "by_person" && held?.by !== "by_internet") {
        const stands = hold.standing();
        const own: HeldConfirmation = {
          by,
          heads: { ...heads },
          standing: () => held === own && stands(),
        };
        held = own;
        hold.onHeld();
      }
      return false;
    }
    if (by === "by_person") confirmedByPerson = true;
    if (status === "by_internet") return true;
    const ended = status === "waiting";
    status = by;
    cause = null;
    refusedOn = null;
    mark = { ...heads };
    if (ended) onConfirmed();
    return true;
  };

  return {
    get status() {
      return status;
    },
    get cause() {
      return hold !== null ? "identity_change" : cause;
    },
    get mark() {
      return mark;
    },
    get refusedOn() {
      return hold !== null ? null : refusedOn;
    },
    get hostAnswers() {
      return hostAnswers;
    },
    get confirmedByPerson() {
      return confirmedByPerson;
    },
    unconfirmed: () => status === "waiting",
    waitsBegun: () => waits,
    confirm,
    backToWaiting(next, refusedDate) {
      held = null;
      if (status === "waiting" && cause === "future_date_refused") return;
      if (status !== "waiting") waits++;
      status = "waiting";
      cause = next;
      refusedOn = next === "future_date_refused" ? (refusedDate ?? null) : null;
    },
    async confirmDevices(witnesses, heads) {
      if (hold !== null || status !== "waiting" || cause === "future_date_refused") return [];
      const group = agreeingDeviceGroup(witnesses, START_CLOCK_MARGIN_MS);
      if (group.length === 0) return [];
      const at = await heads();
      // A person or the internet may have confirmed while the heads were read.
      if (current() !== "waiting") return [];
      return confirm("by_devices", at) ? group : [];
    },
    noteHost(answers) {
      hostAnswers = answers;
    },
    holdForIdentityChange(person) {
      hold = person;
    },
    get heldConfirmation() {
      return held;
    },
    dropHeldConfirmation() {
      held = null;
    },
    releaseIdentityChange() {
      const kept = held;
      hold = null;
      held = null;
      if (kept !== null) confirm(kept.by, kept.heads);
    },
  };
}

/** A person's confirmation, and what became of it: it ended the wait or was given outside one, it
 * is held for an identity change, or it changed nothing. */
export function confirmByPerson(
  state: Pick<StartClockState, "confirm" | "heldConfirmation">,
  heads: ChainHeads,
): "confirmed" | "held" | "unused" {
  if (state.confirm("by_person", heads)) return "confirmed";
  return state.heldConfirmation?.by === "by_person" ? "held" : "unused";
}

/** The log line of each of `confirmByPerson`'s answers. */
export const PERSON_CONFIRMATION_EVENTS = {
  confirmed: "clock_start.confirmed",
  held: "clock_start.confirmation_held",
  unused: "clock_start.confirmation_unused",
} as const;

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
