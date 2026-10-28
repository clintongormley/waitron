import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { readWellFormedModulePreparations, type FirstSetupRoots } from "@waitron/provisioning";
import {
  initialSetupFor,
  type InitialSetupContribution,
  type WaitronModule,
} from "@waitron/module";

type Seat = NonNullable<InitialSetupContribution["startAgainFloor"]>;

async function picksFilePresent(roots: FirstSetupRoots): Promise<boolean> {
  return lstat(join(roots.stateDir, "module-preparation-state.json")).then(
    () => true,
    () => false,
  );
}

export async function readSeriesPicks(
  roots: FirstSetupRoots,
  module: string,
  seat: Seat,
): Promise<{ preparations: readonly unknown[]; unreadable: boolean }> {
  let read: Awaited<ReturnType<typeof readWellFormedModulePreparations>>;
  try {
    read = await readWellFormedModulePreparations(roots, module);
  } catch (error) {
    if (error instanceof AppError && (await picksFilePresent(roots)))
      return { preparations: [], unreadable: true };
    throw error;
  }
  const usable = (preparations: readonly unknown[]) => {
    try {
      seat({ attempts: [], preparations, publicEvidence: [] });
      return true;
    } catch (error) {
      if (error instanceof AppError) return false;
      throw error;
    }
  };
  if (!read.malformed && usable(read.history))
    return { preparations: read.history, unreadable: false };
  return { preparations: read.history.filter((one) => usable([one])), unreadable: true };
}

/** `moduleNames` is the attempt's own frozen module set, as `gatherStartAgainFloor` reads it. */
export async function seriesPicksUnreadable(
  roots: FirstSetupRoots,
  modules: readonly WaitronModule[],
  moduleNames: readonly string[],
): Promise<boolean> {
  for (const module of moduleNames) {
    const seat = initialSetupFor(modules, module)?.startAgainFloor;
    if (seat === undefined) continue;
    if ((await readSeriesPicks(roots, module, seat)).unreadable) return true;
  }
  return false;
}
