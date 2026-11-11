import { agreeingDeviceCount, agreeingDeviceGroup, type ClockWitness } from "@waitron/fiscal";
import type { ClockServiceStatus } from "./box-host-client.js";

/** How close two devices' clocks must be to the box's, and to each other, to confirm a start. */
export const START_CLOCK_MARGIN_MS = 5_000;

/** The waiting notice's count of devices agreeing so far, at most 1: a group of two confirms at
 * the watch's next look, so "2 of 2" would show while the box still waits. */
export function startClockAgreed(witnesses: readonly ClockWitness[]): number {
  return Math.min(1, agreeingDeviceCount(witnesses, START_CLOCK_MARGIN_MS));
}

export type StartClockConfirmation = "by_devices" | "by_person" | "by_internet";
export type StartClockStatus = "waiting" | StartClockConfirmation;
export type StartClockCause = "start" | "future_date_refused";
/** Each chain's node and its highest record position, as `recordHeads` reads them. */
export type ChainHeads = Readonly<Record<string, number>>;

/** Held in memory for one process. `by_internet` is final: nothing moves it. */
export interface StartClockState {
  readonly status: StartClockStatus;
  /** Why the box waits; null while it does not. */
  readonly cause: StartClockCause | null;
  /** The chain heads at the latest confirmation, or null before the first. */
  readonly mark: ChainHeads | null;
  /** False while the latest look could not hear from the host's time service. */
  readonly hostAnswers: boolean;
  unconfirmed(): boolean;
  confirm(by: StartClockConfirmation, heads: ChainHeads): void;
  backToWaiting(cause: StartClockCause): void;
  /** While waiting, confirms by devices when two or more agree within `START_CLOCK_MARGIN_MS`,
   * and answers their readings; otherwise answers none, changes nothing and reads no heads. */
  confirmDevices(
    witnesses: readonly ClockWitness[],
    heads: () => Promise<ChainHeads>,
  ): Promise<ClockWitness[]>;
  noteHost(answers: boolean): void;
}

export function startClockState(): StartClockState {
  let status: StartClockStatus = "waiting";
  let cause: StartClockCause | null = "start";
  let mark: ChainHeads | null = null;
  let hostAnswers = true;
  const current = (): StartClockStatus => status;

  const confirm = (by: StartClockConfirmation, heads: ChainHeads) => {
    if (status === "by_internet") return;
    status = by;
    cause = null;
    mark = { ...heads };
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
    get hostAnswers() {
      return hostAnswers;
    },
    unconfirmed: () => status === "waiting",
    confirm,
    backToWaiting(next) {
      if (status === "by_internet") return;
      status = "waiting";
      cause = next;
    },
    async confirmDevices(witnesses, heads) {
      if (status !== "waiting") return [];
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

/** One look at the time service: a synchronised answer confirms by the internet. A host that
 * throws or does not answer counts as not synchronised. Once by the internet it asks nothing. */
export async function lookAtClockService(deps: StartClockCheckDeps): Promise<void> {
  if (deps.state.status === "by_internet") return;
  let answer: ClockServiceStatus;
  try {
    answer = await deps.clockStatus();
  } catch {
    answer = { available: false, reason: "lost" };
  }
  deps.state.noteHost(answer.available);
  if (answer.available && answer.synchronised)
    deps.state.confirm("by_internet", await deps.heads());
}

/** The start's own look, on the state the process has just made. */
export async function startClockCheck(
  deps: StartClockCheckDeps,
): Promise<"by_internet" | "waiting"> {
  await lookAtClockService(deps);
  return deps.state.status === "by_internet" ? "by_internet" : "waiting";
}
