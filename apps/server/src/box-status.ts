import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  withTransaction,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { SHUTDOWN_PATH, type AdminShutdown } from "./admin-shutdown.js";
import { streamShutdownDownload } from "./admin-shutdown-download.js";
import type { readShutdownStaff } from "./admin-shutdown-duties.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import type { SpareFollowView } from "./spare-follow.js";
import type { StreamView } from "@waitron/stream";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import type { TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import {
  createErrorBoundary,
  readJsonBody,
  requireEnum,
  requireManagementSession,
  requireString,
} from "@waitron/server-kit";
import type { JobView } from "./job-runner.js";
import type { Logger } from "./logger.js";

/** A node with no fiscal record has a chain height of zero and a null record time. */
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
  spare?: SpareFollowView | null;
  duties: Record<string, unknown>;
  jobs: Readonly<Record<string, JobView>>;
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
  spare?: () => Promise<SpareFollowView | null>;
  duties: () => Record<string, unknown>;
  jobs: () => Readonly<Record<string, JobView>>;
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

  const stream: StreamView & { pruneBlockedSince?: string } = { ...readers.stream() };
  delete stream.pruneBlockedSince;

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    awaitingFiscalCertificate: readers.awaitingFiscalCertificate(),
    chain,
    singletonRole,
    backup,
    stream,
    ...(readers.spare === undefined ? {} : { spare: await readers.spare() }),
    duties: readers.duties(),
    jobs: readers.jobs(),
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
  shutdown?: Pick<
    AdminShutdown,
    "status" | "resolvePaused" | "cancel" | "beginDownload" | "confirmDownload"
  > & {
    start(): Promise<void> | void;
    available(): Promise<boolean>;
    readStaff: () => ReturnType<typeof readShutdownStaff>;
  };
  readStream: () => StreamView;
  readSpare?: () => Promise<SpareFollowView | null>;
  readMode: () => DeploymentMode;
  readJobs: () => Readonly<Record<string, JobView>>;
  readSingletonRole: () => SingletonRole;
  readAwaitingFiscalCertificate: () => boolean;
  /** Shared with `/api/box/health`, so both read the host's clock service through one cache. */
  readTime: () => Promise<TimeHealth>;
};

const STATUS: Record<string, ContentfulStatusCode> = {
  "management.request_invalid": 400,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "node.operation_page_required": 403,
  "box.shutdown_in_progress": 409,
  "box.shutdown_unavailable": 409,
};

export function mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-status.failed");
  const shutdown = deps.shutdown;
  if (shutdown !== undefined) {
    const authorize = async (c: Context, fresh = false) => {
      c.header("Cache-Control", "no-store");
      const token = requireManagementSession(c);
      await authorizeManager(deps.db, {
        managementSessionId: token,
        permission: "node.manage",
        touch: false,
      });
      if (fresh) await requireFreshManagementSignIn(deps.db, token, { passwordOnly: true });
    };
    app.get(SHUTDOWN_PATH, (c) =>
      run(c, log, async () => {
        requireNodeOperationHttps(c);
        await authorize(c);
        if (!(await shutdown.available())) throw new AppError("box.shutdown_unavailable", {});
        return c.json(await shutdown.readStaff());
      }),
    );
    app.post(SHUTDOWN_PATH, (c) =>
      run(c, log, async () => {
        requireNodeOperationHttps(c);
        await authorize(c, true);
        await shutdown.start();
        return c.json(shutdown.status(), 202);
      }),
    );
    app.get(`${SHUTDOWN_PATH}/download/:name`, (c) =>
      run(c, log, async () => {
        requireNodeOperationHttps(c);
        await authorize(c);
        if (c.req.raw.method === "HEAD") return c.body(null, 405, { Allow: "GET" });
        return streamShutdownDownload(c, await shutdown.beginDownload(c.req.param("name")));
      }),
    );
    app.patch(SHUTDOWN_PATH, (c) =>
      run(c, log, async () => {
        requireNodeOperationHttps(c);
        await authorize(c);
        const body = await readJsonBody<{ decision?: unknown; name?: unknown } | null>(c);
        const decision = requireEnum(body?.decision, "decision", [
          "retry",
          "keep-waiting",
          "shut-down-anyway",
          "backup-saved",
        ]);
        if (decision === "backup-saved")
          shutdown.confirmDownload(requireString(body?.name, "name"));
        else shutdown.resolvePaused(decision);
        return c.json(shutdown.status(), 202);
      }),
    );
    app.delete(SHUTDOWN_PATH, (c) =>
      run(c, log, async () => {
        requireNodeOperationHttps(c);
        await authorize(c);
        await shutdown.cancel();
        return c.json(shutdown.status(), 200);
      }),
    );
  }
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
        time: deps.readTime,
        cert: certPath === undefined ? undefined : () => readCertExpiry(certPath, deps.now()),
        awaitingFiscalCertificate: () => deps.readAwaitingFiscalCertificate(),
        chain: async () => chain,
        backup: deps.readBackup,
        stream: deps.readStream,
        ...(deps.readSpare === undefined ? {} : { spare: deps.readSpare }),
        jobs: deps.readJobs,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
