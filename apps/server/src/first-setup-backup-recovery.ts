import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { openVenueDatabase, readBreakGlassVerifier } from "@waitron/db";
import type { OperationBinding, OperationClient, WaitronModule } from "@waitron/module";
import type {
  BackupRepairObservation,
  FirstSetupRoots,
  createFirstSetupBackupWorkspace,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import {
  authenticatedFirstSetupBackupPreview,
  openFirstSetupBackupSource,
  type BackupRepairSource,
  type BackupRepairSourceDeps,
} from "./first-setup-backup-source.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import { readArtifactIdentity } from "./restore.js";
import "./errors.js";

export interface BackupRepairOptions extends FirstSetupRoots {
  environment: DeploymentEnvironment;
  modules: readonly WaitronModule[];
  host: FirstFiscalHost;
  sources: BackupRepairSourceDeps;
  workspace: ReturnType<typeof createFirstSetupBackupWorkspace>;
  log: Logger;
}
export interface BackupRepairOpenRequest {
  observation: Omit<BackupRepairObservation, "originalsDigest">;
  source: BackupRepairSource;
  nodeRecoverySecret: string;
  context: { oldBoxGone: boolean; soleRecovery: boolean };
  recoveryId?: string;
}
export interface BackupRepairSession {
  sessionId: string;
  recoveryId: string;
  preview: RecoveryBackupPreview;
  binding: OperationBinding;
}
const UNUSED_MS = 15 * 60_000;
type Selected = Awaited<ReturnType<typeof openFirstSetupBackupSource>>;
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function ownerRequired(): never {
  throw new AppError("setup.owner_required", {});
}
async function fingerprint(selected: Selected): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(selected.copy.databasePath)) hash.update(bytes);
  hash.update(JSON.stringify([selected.sourceId, selected.copy.sourceId, selected.copy.manifest]));
  for (const entry of selected.copy.secretEntries) {
    hash.update(JSON.stringify([entry.name, entry.bytes.byteLength]));
    hash.update(entry.bytes);
  }
  return hash.digest("hex");
}
async function verifier(selected: Selected): Promise<string | null> {
  const { node } = readArtifactIdentity(selected.copy.secretEntries);
  const db = await openVenueDatabase(dirname(selected.copy.databasePath));
  try {
    return await readBreakGlassVerifier(db.venue, node.nodeId);
  } finally {
    await db.close();
  }
}
export function createFirstSetupBackupRecovery(options: BackupRepairOptions) {
  let generation = 0;
  let disposed = false;
  let active:
    | {
        session: BackupRepairSession;
        usedAt: number;
        discard(): Promise<void>;
      }
    | undefined;
  let expiry: NodeJS.Timeout | undefined;
  const drop = async () => {
    const old = active;
    active = undefined;
    clearTimeout(expiry);
    await old?.discard();
  };
  const turn = <T>(run: () => Promise<T>) =>
    options.host.resolution.withVenueExclusion(() => options.host.coordinator.run(run));
  const observation = async () => {
    const inspection = await options.host.resolution.inspectFirstSetupResolution();
    return {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision,
      ownerGeneration: inspection.ownerGeneration,
    };
  };
  return {
    async open(
      supplied: BackupRepairOpenRequest,
      _client: OperationClient,
    ): Promise<BackupRepairSession> {
      void _client;
      if (disposed) ownerRequired();
      const request = structuredClone(supplied);
      if (request.source.kind !== "cloud" && request.source.environment !== options.environment)
        throw new AppError("restore.environment_mismatch", {
          backup: request.source.environment,
          target: options.environment,
        });
      if (request.context.oldBoxGone !== true || request.context.soleRecovery !== true)
        throw new AppError("module.operation_invalid", { module: "core" });
      if (request.recoveryId !== undefined) conflict();
      const recoveryId = randomUUID();
      const before = await turn(async () => {
        if (disposed) ownerRequired();
        if (!isDeepStrictEqual(await observation(), request.observation)) conflict();
        if ((await options.workspace.read()).length !== 0) conflict();
        return { digest: await options.workspace.inspect(recoveryId), generation: ++generation };
      });
      // Decrypted copies and key derivation stay outside the retained roots and their action lock.
      const scratch = await mkdtemp(join(tmpdir(), "waitron-backup-proof-"));
      let selected: Selected | undefined;
      let owned = true;
      const discard = async () => {
        try {
          await selected?.copy.discard();
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      };
      try {
        selected = await openFirstSetupBackupSource(
          request.source,
          {
            ...options.sources,
            stateDir: scratch,
            stagingDir: join(scratch, "staging"),
          },
          request.context,
        );
        if (selected.copy.manifest.environment !== options.environment)
          throw new AppError("restore.environment_mismatch", {
            backup: selected.copy.manifest.environment,
            target: options.environment,
          });
        const { node } = readArtifactIdentity(selected.copy.secretEntries);
        const proofBinding: OperationBinding = {
          module: "core",
          action: "restore",
          eventId: randomUUID(),
          sourceId: selected.copy.sourceId!,
          targetNodeId: node.nodeId,
        };
        const provedVerifier = await verifier(selected);
        const sourceDigest = await fingerprint(selected);
        const preview = await authenticatedFirstSetupBackupPreview(
          selected,
          proofBinding,
          request.nodeRecoverySecret,
          options.sources,
        );
        if (preview.fiscalSelection === undefined)
          throw new AppError("module.operation_invalid", { module: "core" });
        const binding = { ...proofBinding, module: preview.fiscalSelection.module };
        return await turn(async () => {
          if (disposed) ownerRequired();
          if (
            generation !== before.generation ||
            !isDeepStrictEqual(await observation(), request.observation) ||
            (await options.workspace.inspect(recoveryId)) !== before.digest ||
            (await fingerprint(selected!)) !== sourceDigest ||
            (await verifier(selected!)) !== provedVerifier ||
            (await options.workspace.read()).length !== 0
          )
            conflict();
          await drop();
          const session = {
            sessionId: randomBytes(32).toString("hex"),
            recoveryId,
            binding,
            preview,
          };
          const entry = { session, usedAt: performance.now(), discard };
          active = entry;
          expiry = setTimeout(
            () =>
              options.host.coordinator
                .run(async () => {
                  if (active === entry) await drop();
                })
                .catch(() => {}),
            UNUSED_MS + 1,
          );
          expiry.unref();
          owned = false;
          return structuredClone(session);
        });
      } finally {
        if (owned) await discard();
      }
    },
    close(sessionId: string): Promise<void> {
      return turn(async () => {
        if (active === undefined || active.session.sessionId !== sessionId) ownerRequired();
        if (performance.now() - active.usedAt > UNUSED_MS) {
          await drop();
          ownerRequired();
        }
        await drop();
      });
    },
    dispose(): Promise<void> {
      return options.host.coordinator.run(async () => {
        disposed = true;
        generation++;
        await drop();
      });
    },
  };
}
