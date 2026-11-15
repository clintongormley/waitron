import { sha256Hex } from "@waitron/handover";
import { stageCheckedCopy, type CheckedCopyDeps } from "./handover-copy-from-backup.js";
import type { SelectedCopy } from "./handover-copy-selection.js";

export function followedCopyId(position: { generation: string; appliedTXID: string }): string {
  return sha256Hex(`${position.generation}:${position.appliedTXID}`);
}

/** Takes the stopped follower's output as the copy a switch places. */
export async function stageFollowedAsCopy(
  deps: CheckedCopyDeps,
  stopped: { path: string; generation: string; appliedTXID: string },
): Promise<SelectedCopy> {
  const selection: SelectedCopy = { source: "followed-copy", sourceId: followedCopyId(stopped) };
  await stageCheckedCopy(deps, stopped.path, selection);
  return selection;
}
