import { vi } from "vitest";
import { prepareFirstSetupCommand } from "../src/first-setup-command.js";
import type { ProvisioningIo } from "../src/io.js";

/**
 * Moves Vitest's faked `Date` and `performance` together to 1 ms past `targetMs`. The suite must
 * fake both.
 */
export function moveFakeClockPast(targetMs: number) {
  vi.advanceTimersByTime(Math.max(0, targetMs + 1 - Date.now()));
}

/** Waits by moving Vitest's faked `Date` and `performance`, as a real timer lets real time pass. */
export async function moveFakeClock(ms: number) {
  vi.advanceTimersByTime(ms);
}

/** Stands in for the operator stopping the command while it waits. */
export const STOPPED_DURING_WAIT = new Error("test: stopped during the wait");
export async function stopDuringWait(): Promise<void> {
  throw STOPPED_DURING_WAIT;
}

/** Runs the command's preparation, letting it wait out its settle wait on the faked clock. */
export function prepareCommandPastWaits(
  runtime: Parameters<typeof prepareFirstSetupCommand>[0],
  owner: Parameters<typeof prepareFirstSetupCommand>[1],
  io: ProvisioningIo,
): ReturnType<typeof prepareFirstSetupCommand> {
  return prepareFirstSetupCommand(runtime, owner, io, moveFakeClock);
}
