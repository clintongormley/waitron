import { vi } from "vitest";
import { prepareFirstSetupCommand } from "../src/first-setup-command.js";
import type { ProvisioningIo } from "../src/io.js";

const CONTINUES = /^Continues at (\S+); run the command again/;

/** The target of the last settle wait the terminal printed, or undefined when it printed none. */
export function printedWaitTarget(lines: readonly string[]): number | undefined {
  for (const line of [...lines].reverse()) {
    const match = CONTINUES.exec(line);
    if (match !== null) return Date.parse(match[1]!);
  }
  return undefined;
}

/**
 * Moves Vitest's faked `Date` and `performance` together to 1 ms past `targetMs`, as an operator
 * who reruns the command once the printed time has come. The suite must fake both.
 */
export function moveFakeClockPast(targetMs: number) {
  vi.advanceTimersByTime(Math.max(0, targetMs + 1 - Date.now()));
}

/**
 * Runs the command's preparation, and while it stops at a settle wait, moves the faked clock past
 * the printed target and runs it again with the owner it returned.
 */
export async function prepareCommandPastWaits(
  runtime: Parameters<typeof prepareFirstSetupCommand>[0],
  owner: Parameters<typeof prepareFirstSetupCommand>[1],
  io: ProvisioningIo,
  rounds = 3,
): ReturnType<typeof prepareFirstSetupCommand> {
  let printed: string[] = [];
  const watched: ProvisioningIo = {
    ...io,
    stdout: (line) => {
      printed.push(line);
      io.stdout(line);
    },
  };
  for (let round = 0; ; round++) {
    printed = [];
    const result = await prepareFirstSetupCommand(runtime, owner, watched);
    if (result.status !== "waiting") return result;
    const targetMs = printedWaitTarget(printed);
    if (targetMs === undefined) throw new Error("the command waited without printing until when");
    if (round === rounds) throw new Error(`still waiting after ${rounds} clock moves`);
    moveFakeClockPast(targetMs);
    owner = result.owner;
  }
}
