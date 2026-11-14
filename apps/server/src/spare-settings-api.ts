import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { readNodeMembership } from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { servingPrimaryNodeId } from "@waitron/membership";
import { readNodeMode } from "@waitron/node-db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  backupSettingsDigestOf,
  readBackupSettings,
  replaceBackupSettings,
} from "./backup-env-writer.js";
import type { Turns } from "./backup-turns.js";
import { peerKeyOf } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

const STATUS = {
  "spare.settings_invalid": 400,
  "spare.settings_sender_unknown": 403,
  "spare.settings_not_a_spare": 409,
} as const;

const BODY_KEYS = ["settings", "toNodeId"];

// A message holding a minted key and its rotation time is about 400 bytes. The main box's key routes
// set no maximum, so a key near 64 KiB would never reach the spare.
const BODY_MAX_BYTES = 64 * 1024;

/**
 * `POST /api/node/backup-settings` — the main box hands its spare its `backup.env`, signed by its
 * node key. Only a mirror takes it, and only from the box its held chart names `serving-primary`
 * when the whole body has arrived, so a box that took over never has its settings overwritten by
 * its old main box. Nothing of the body is stored beyond the file or logged: a value may be the
 * backup recovery key.
 */
export function mountSpareSettingsApi(
  app: Hono,
  deps: PeerStatusApiDeps & {
    stateDir: string;
    /** The turns the backup routes write `backup.env` in. */
    turns: Turns;
  },
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "spare-settings.failed");

  app.post(
    "/api/node/backup-settings",
    bodyLimit({
      maxSize: BODY_MAX_BYTES,
      onError: (c) =>
        c.json({ error: { code: "spare.settings_invalid", params: { reason: "size" } } }, 413),
    }),
    (c) =>
      run(c, log, async () => {
        const raw = await readRawJsonBody<unknown>(c);
        const digest = await deps.turns(async () => {
          const held = await readNodeMembership(deps.db);
          const verdict = verifyEnvelope<unknown>(
            raw,
            "backup-settings",
            await peerKeyOf(deps, held),
          );
          if (!verdict.valid) {
            if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose")
              throw new AppError("spare.settings_invalid", { reason: "envelope" });
            throw new AppError("spare.settings_sender_unknown", {});
          }
          const body = verdict.body;
          if (
            body === null ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).sort().join() !== BODY_KEYS.join() ||
            (body as { toNodeId: unknown }).toNodeId !== deps.nodeId
          ) {
            throw new AppError("spare.settings_invalid", { reason: "body" });
          }
          if ((await readNodeMode(deps.node, deps.nodeId)).mode !== "mirror")
            throw new AppError("spare.settings_not_a_spare", {});
          if (held === null || servingPrimaryNodeId(held) !== verdict.signerNodeId)
            throw new AppError("spare.settings_sender_unknown", {});
          await replaceBackupSettings(
            deps.stateDir,
            (body as { settings: Record<string, string> | null }).settings,
          );
          return backupSettingsDigestOf(await readBackupSettings(deps.stateDir));
        });
        return c.json({ backupSettings: digest }, 200);
      }),
  );
}
