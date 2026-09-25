import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  withTransaction,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { StreamView } from "@waitron/stream";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import { checkTimeHealth, type TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/** "No records" is `chain.height === 0`, never `chain.lastAt`: a provisioned node's head row carries a
 * time at height 0. */
export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  /** pass.ts's `AwaitingCertStatus`. */
  awaitingFiscalCertificate: boolean;
  chain: ChainHeight;
  singletonRole: SingletonRole;
  backup: BackupStatus;
  stream: StreamView;
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  awaitingFiscalCertificate: () => boolean;
  chain: () => Promise<ChainHeight>;
  singletonRole: () => Promise<SingletonRole>;
  backup: (() => Promise<BackupStatus>) | undefined;
  stream: () => StreamView;
  duties: () => Record<string, unknown>;
};

export async function collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus> {
  const [mode, time, chain, singletonRole] = await Promise.all([
    readers.mode(),
    readers.time(),
    readers.chain(),
    readers.singletonRole(),
  ]);

  let cert: BoxStatus["cert"] = { available: false };
  if (readers.cert !== undefined) {
    try {
      const c = await readers.cert();
      cert = { available: true, notAfter: c.notAfter, daysRemaining: c.daysRemaining };
    } catch {
      // An unreadable leaf must never fail the whole status read.
      cert = { available: false };
    }
  }

  // Unlike cert, a backup reader that throws fails the read: a fault is not "backup is off".
  let backup: BoxStatus["backup"] = { configured: false };
  if (readers.backup !== undefined) {
    backup = await readers.backup();
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    awaitingFiscalCertificate: readers.awaitingFiscalCertificate(),
    chain,
    singletonRole,
    backup,
    stream: readers.stream(),
    duties: readers.duties(),
  };
}

export type BoxStatusDeps = {
  db: Database;
  cfg: { nodeId: string };
  environment: DeploymentEnvironment;
  health: HealthState;
  now: () => Date;
  tlsCertPath: string | undefined;
  readBackup: (() => Promise<BackupStatus>) | undefined;
  readStream: () => StreamView;
  readMode: () => DeploymentMode;
  readSingletonRole: () => SingletonRole;
  readAwaitingFiscalCertificate: () => boolean;
};

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
};

export function mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-status.failed");
  app.get("/api/box/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const chain = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "system.manage",
        });
        return readChainHeight(tx, deps.cfg.nodeId);
      });
      const certPath = deps.tlsCertPath;
      const status = await collectBoxStatus({
        mode: () => Promise.resolve(deps.readMode()),
        singletonRole: () => Promise.resolve(deps.readSingletonRole()),
        environment: deps.environment,
        time: () => checkTimeHealth(),
        cert: certPath === undefined ? undefined : () => readCertExpiry(certPath, deps.now()),
        awaitingFiscalCertificate: () => deps.readAwaitingFiscalCertificate(),
        chain: async () => chain,
        backup: deps.readBackup,
        stream: deps.readStream,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
