import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { readPairLink } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { BACKUP_ENV_FILE } from "@waitron/store";
import { backupSettingsDigestOf, readBackupSettings } from "./backup-env-writer.js";
import { boxRefusal, isRecord, postToBox, type AskPeerStatusDeps } from "./boot-peer-check.js";
import { signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { sleep } from "./spare-join.js";

const CHECK_MS = 5_000;
const RETRY_MS = 30_000;

export interface SpareSettingsExchange extends Pick<
  AskPeerStatusDeps,
  "fetch" | "authorityOf" | "lookup"
> {
  timeoutMs: number;
}

export interface SendBackupSettingsDeps {
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  stateDir: string;
  exchange: SpareSettingsExchange;
}

export type SendOutcome =
  { delivered: true; digest: string | null } | { delivered: false; reason: string };

/**
 * Signs this box's `backup.env` for the spare and posts it to the spare's settings route. Without a
 * fetch replacement only an https address is sent to: the settings carry the recovery key.
 */
export async function sendBackupSettings(
  deps: SendBackupSettingsDeps,
  to: { nodeId: string; contactUrl: string },
): Promise<SendOutcome> {
  const base = to.contactUrl.replace(/\/+$/, "");
  if (deps.exchange.fetch === undefined && URL.parse(base)?.protocol !== "https:")
    return { delivered: false, reason: "not_https" };
  let settings: Record<string, string> | null;
  try {
    settings = await readBackupSettings(deps.stateDir);
  } catch {
    // Never `null` in its place: that would remove the spare's settings.
    return { delivered: false, reason: "unreadable" };
  }
  // Every writer keeps a recovery key in the file, so one that is there but reads as no settings is
  // damaged, and sending `null` would remove the spare's.
  if (settings === null && (await present(join(deps.stateDir, BACKUP_ENV_FILE))))
    return { delivered: false, reason: "unreadable" };
  const digest = backupSettingsDigestOf(settings);
  const envelope = await signAsThisBox(deps, "backup-settings", { toNodeId: to.nodeId, settings });
  let answer: { status: number; text: string };
  try {
    answer = await postToBox(
      deps.exchange,
      to.nodeId,
      `${base}/api/node/backup-settings`,
      JSON.stringify(envelope),
    );
  } catch {
    return { delivered: false, reason: "unreachable" };
  }
  if (answer.status !== 200)
    return { delivered: false, reason: boxRefusal(answer.text)?.code ?? String(answer.status) };
  let answered: unknown;
  try {
    answered = JSON.parse(answer.text);
  } catch {
    answered = undefined;
  }
  if (!isRecord(answered) || answered.backupSettings !== digest)
    return { delivered: false, reason: "digest_differs" };
  return { delivered: true, digest };
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export interface SpareSettingsDeps extends SendBackupSettingsDeps {
  db: Database;
  checkMs?: number;
  retryMs?: number;
  log: Logger;
}

/**
 * On the main box, sends its backup settings to the spare its pair link streams to, again after each
 * change, until the spare answers their digest. What was delivered is kept in memory only, so every
 * start sends once. Failures are logged at `info` until this box first delivers to that spare after
 * it starts, because a spare answers only after its first full start, and at `warn` after that.
 */
export function runSpareSettings(deps: SpareSettingsDeps): { stop(): Promise<void> } {
  const checkMs = deps.checkMs ?? CHECK_MS;
  const retryMs = deps.retryMs ?? RETRY_MS;
  const stopping = new AbortController();
  let stopped = false;
  let delivered: { peerNodeId: string; digest: string | null } | undefined;
  let failed: { peerNodeId: string; at: number } | undefined;
  const reached = new Set<string>();

  function failure(peerNodeId: string, reason: string): void {
    if (failed?.peerNodeId !== peerNodeId)
      deps.log(reached.has(peerNodeId) ? "warn" : "info", "spare-settings.send_failed", {
        peerNodeId,
        reason,
      });
    failed = { peerNodeId, at: Date.now() };
  }

  async function pass(): Promise<void> {
    const link = await readPairLink(deps.node, deps.nodeId);
    if (link?.role !== "streams" || link.state !== "streaming") return;
    const { peerNodeId } = link;
    const held = await readNodeMembership(deps.db);
    const contactUrl = held?.body.nodes.find((n) => n.nodeId === peerNodeId)?.contactUrl;
    if (contactUrl === undefined || contactUrl === "") return;
    const digest = await readBackupSettings(deps.stateDir).then(backupSettingsDigestOf, () => {});
    if (delivered?.peerNodeId === peerNodeId && delivered.digest === digest) return;
    if (failed?.peerNodeId === peerNodeId && Date.now() - failed.at < retryMs) return;
    if (stopped) return;
    let outcome: SendOutcome;
    try {
      outcome = await sendBackupSettings(deps, { nodeId: peerNodeId, contactUrl });
    } catch (error) {
      outcome = { delivered: false, reason: codeOf(error) };
    }
    if (!outcome.delivered) return failure(peerNodeId, outcome.reason);
    delivered = { peerNodeId, digest: outcome.digest };
    failed = undefined;
    reached.add(peerNodeId);
    deps.log("info", "spare-settings.sent", { peerNodeId });
  }

  const running = (async () => {
    // Logged once per run of failed checks, so a lasting fault does not fill the log.
    let checkFailing = false;
    while (!stopped) {
      try {
        await pass();
        checkFailing = false;
      } catch (error) {
        if (!stopped && !checkFailing)
          deps.log("warn", "spare-settings.check_failed", { errorCode: codeOf(error) });
        checkFailing = true;
      }
      await sleep(checkMs, stopping.signal);
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      stopping.abort();
      await running;
    },
  };
}
