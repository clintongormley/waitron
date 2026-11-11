import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RESTORE_FLOW_DIR } from "@waitron/store";

export type RestoreFlowPhase = "staged" | "placing" | "first-start";

export async function readRestoreFlowPhase(
  stateDir: string,
): Promise<RestoreFlowPhase | "unreadable" | null> {
  try {
    const record = JSON.parse(
      await readFile(join(stateDir, RESTORE_FLOW_DIR, "record.json"), "utf8"),
    ) as { version?: unknown; phase?: unknown } | null;
    if (
      record?.version === 1 &&
      (record.phase === "staged" || record.phase === "placing" || record.phase === "first-start")
    ) {
      return record.phase;
    }
    return "unreadable";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
}
