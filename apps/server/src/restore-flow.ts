import type { Logger } from "./logger.js";
import { errnoOf } from "./errno.js";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { readRestoreFlowPhase, type RestoreFlowPhase } from "@waitron/provisioning";
import { FLOWS_DIR, RESTORE_FLOW_DIR, SCRATCH_DIR } from "@waitron/store";
import { mkdirDurable, syncFolderHolding, writeFileDurable } from "./fs-atomic.js";
import type { RebuildSource } from "./rebuild-first-start.js";

export type StagedRequestFields = Readonly<Record<string, unknown>>;
export type { RestoreFlowPhase };
export interface RestoreFlowRecord {
  readonly version: 1;
  readonly phase: RestoreFlowPhase;
  readonly request?: StagedRequestFields;
  readonly firstStart?: { readonly source: RebuildSource };
}
const ATTACHMENTS = [
  "artifact",
  "key",
  "venue.db",
  "entries",
  "placement.db",
  "node-key",
  "admin-verifiers",
] as const;
export type RestoreAttachment = (typeof ATTACHMENTS)[number];

const recordPath = (stateDir: string) => join(stateDir, RESTORE_FLOW_DIR, "record.json");

export function attachmentPath(stateDir: string, name: RestoreAttachment): string {
  return join(stateDir, RESTORE_FLOW_DIR, name);
}

export async function readRestoreFlow(stateDir: string): Promise<RestoreFlowRecord | null> {
  const phase = await readRestoreFlowPhase(stateDir);
  if (phase === null) return null;
  if (phase === "unreadable") throw new Error("unreadable restore flow record");
  return JSON.parse(await readFile(recordPath(stateDir), "utf8")) as RestoreFlowRecord;
}

export async function publishRestoreFlow(
  stateDir: string,
  record: RestoreFlowRecord,
  attach: (dir: string) => Promise<void>,
): Promise<void> {
  const staged = join(stateDir, SCRATCH_DIR, `restore-flow-${randomUUID()}`);
  await mkdirDurable(staged, 0o700);
  try {
    // Attachment writers flush their files before the record can publish them.
    await attach(staged);
    await writeFileDurable(join(staged, "record.json"), JSON.stringify(record), 0o600);
    await mkdirDurable(join(stateDir, FLOWS_DIR), 0o700);
    await endRestoreFlow(stateDir);
    await rename(staged, join(stateDir, RESTORE_FLOW_DIR));
    try {
      await syncFolderHolding(join(stateDir, RESTORE_FLOW_DIR));
    } catch (error) {
      await endRestoreFlow(stateDir);
      throw error;
    }
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

export async function updateRestoreFlow(
  stateDir: string,
  record: RestoreFlowRecord,
): Promise<void> {
  await writeFileDurable(recordPath(stateDir), JSON.stringify(record), 0o600);
}

export async function dropAttachments(stateDir: string): Promise<void> {
  await Promise.all(
    ATTACHMENTS.filter((name) => name !== "admin-verifiers").map((name) =>
      rm(attachmentPath(stateDir, name), { force: true }),
    ),
  );
}

export async function endRestoreFlow(stateDir: string): Promise<void> {
  await mkdirDurable(join(stateDir, SCRATCH_DIR), 0o700);
  const flow = join(stateDir, RESTORE_FLOW_DIR);
  const discarded = join(stateDir, SCRATCH_DIR, `restore-flow-ended-${randomUUID()}`);
  try {
    await rename(flow, discarded);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await syncFolderHolding(discarded);
  await syncFolderHolding(flow);
  await rm(discarded, { recursive: true, force: true });
}

export async function restoreDiscardPending(stateDir: string): Promise<boolean> {
  try {
    await lstat(attachmentPath(stateDir, "admin-verifiers"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new AppError("restore.flow_unreadable", {});
  }
}

export async function firstStartPending(
  stateDir: string,
): Promise<{ source: RebuildSource | "unknown" } | null> {
  const phase = await readRestoreFlowPhase(stateDir);
  if (phase === "unreadable") {
    if (await restoreDiscardPending(stateDir)) throw new AppError("restore.flow_unreadable", {});
    return { source: "unknown" };
  }
  const record = await readRestoreFlow(stateDir);
  if (record?.firstStart === undefined) return null;
  const source = record.firstStart.source;
  return { source: source === "archive" || source === "stream" ? source : "unknown" };
}

export async function restoreAdminVerifiers(
  stateDir: string,
  log?: Logger,
): Promise<readonly string[] | null> {
  try {
    const hashes: unknown = JSON.parse(
      await readFile(attachmentPath(stateDir, "admin-verifiers"), "utf8"),
    );
    if (
      !Array.isArray(hashes) ||
      hashes.length === 0 ||
      hashes.some((hash) => typeof hash !== "string" || hash === "")
    )
      return null;
    return hashes as string[];
  } catch (error) {
    const errno = errnoOf(error);
    if (!(error instanceof SyntaxError) && !["ENOENT", "ENOTDIR", "EISDIR"].includes(errno ?? "")) {
      try {
        log?.("warn", "recovery.restore_auth_unreadable", { errno: errno ?? null });
      } catch {
        /* Recovery remains visible when its logger fails. */
      }
    }
    return null;
  }
}

export async function disarmRestoreDiscard(stateDir: string): Promise<void> {
  const path = attachmentPath(stateDir, "admin-verifiers");
  try {
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await syncFolderHolding(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
