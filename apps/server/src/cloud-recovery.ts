import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";
import { mkdirDurable, readRestoreFlowPhase, writeFileDurable } from "@waitron/provisioning";
import { CLOUD_DIR, CLOUD_RECOVERY_FILE } from "@waitron/store";
import { generateKeyPairSync, randomInt, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AppError } from "@waitron/shared";
import { Agent } from "node:https";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  parseBackupVerificationJson,
  type BackupVerificationTarget,
} from "./backup-verification-protocol.js";
import {
  assertSnapshotRecoveryTarget,
  cloudRecoveryUnavailable as unavailable,
  readCloudRecoveryState,
  readSnapshotRecoveryVerification,
  sameSnapshotRecoveryVerification,
  snapshotRecoveryTarget,
  type SavedCloudRecoveryState as SavedState,
  type SnapshotRecoveryVerification,
} from "./cloud-recovery-v2.js";
import { MAX_CLOUD_ARCHIVE_BYTES } from "./cloud-backup-limits.js";
import { errnoOf } from "./errno.js";
import { freeBytes } from "./free-bytes.js";
import { recoveryArchiveFileSourceId } from "./recovery-source.js";
import { ARCHIVE_DOWNLOAD_PREFIX, RESTORE_STAGING_DIR } from "./restore-staging-dirs.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import type { ArchiveFileRestoreRequest } from "./restore-request.js";
import "./errors.js";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
class ExpiredRequest extends Error {}

export interface CloudRecoveryPoint {
  id: string;
  venueId: string;
  capturedAt: string;
  modules: Record<string, number>;
  digest: string;
  size: number;
  objectKey: string;
  verification: "verified";
  kind: "snapshot";
  deleting: false;
  deletedAt: null;
}
export interface CloudRecoveryView {
  requestId: string;
  code: string;
  openCloudUrl: string;
  expiresAt: string;
  state: "awaiting_owner" | "approved" | "expired";
  point?: Pick<CloudRecoveryPoint, "id" | "venueId" | "capturedAt" | "modules">;
}
interface Grant {
  point: CloudRecoveryPoint;
  location: { endpoint: string; bucket: string; region: string };
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
  recoveryKey: string;
  expiresAt: string;
  operationExpiresAt: string;
}
export interface CloudRecoveryOptions {
  stateDir: string;
  origin: string;
  environment: "preproduction" | "production";
  fetch?: typeof fetch;
  storageCa?: string;
  snapshotProtocol?: 2;
  target?: () => BackupVerificationTarget;
  download?: (grant: Grant, artifactPath: string) => Promise<void>;
}

function point(value: unknown): CloudRecoveryPoint {
  if (
    !record(value) ||
    !uuid(value.id) ||
    !uuid(value.venueId) ||
    !validDate(value.capturedAt) ||
    value.kind !== "snapshot" ||
    value.verification !== "verified" ||
    value.deleting !== false ||
    value.deletedAt !== null ||
    value.objectKey !== `snapshots/${value.id}` ||
    typeof value.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.digest) ||
    !Number.isSafeInteger(value.size) ||
    Number(value.size) < 1 ||
    Number(value.size) > MAX_CLOUD_ARCHIVE_BYTES ||
    !record(value.modules) ||
    Object.values(value.modules).some((v) => !Number.isSafeInteger(v) || Number(v) < 0)
  )
    unavailable();
  return value as unknown as CloudRecoveryPoint;
}
async function downloadArchive(grant: Grant, artifactPath: string, ca?: string): Promise<void> {
  let client: S3Client | undefined;
  try {
    const url = new URL(grant.location.endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !grant.location.bucket ||
      !grant.location.region ||
      !grant.credentials.accessKeyId ||
      !grant.credentials.secretAccessKey ||
      !grant.credentials.sessionToken
    )
      unavailable();
    const remaining = Math.min(14 * 60_000, Date.parse(grant.expiresAt) - Date.now() - 5000);
    if (!Number.isFinite(remaining) || remaining <= 0) unavailable();
    client = new S3Client({
      endpoint: grant.location.endpoint,
      region: grant.location.region,
      credentials: grant.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { httpsAgent: new Agent({ ca, rejectUnauthorized: true }) },
    });
    const signal = AbortSignal.timeout(remaining);
    const response = await client.send(
      new GetObjectCommand({ Bucket: grant.location.bucket, Key: grant.point.objectKey }),
      { abortSignal: signal },
    );
    if (response.ContentLength !== grant.point.size || !response.Body) unavailable();
    await pipeline(
      response.Body as AsyncIterable<Uint8Array>,
      async function* (chunks) {
        let size = 0;
        for await (const chunk of chunks) {
          size += chunk.length;
          if (size > grant.point.size) unavailable();
          yield chunk;
        }
      },
      createWriteStream(artifactPath, { flags: "wx", mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    if (["ENOSPC", "EDQUOT"].includes(errnoOf(error) ?? ""))
      throw new AppError("restore.archive_resource_limit", {});
    return unavailable();
  } finally {
    client?.destroy();
  }
}

export function createCloudRecoveryClient(options: CloudRecoveryOptions) {
  if (options.environment !== "preproduction") unavailable();
  const path = join(options.stateDir, CLOUD_RECOVERY_FILE);
  const fetchImpl = options.fetch ?? fetch;
  let active = false;
  async function locked<T>(fn: () => Promise<T>): Promise<T> {
    if (active) unavailable();
    active = true;
    try {
      return await fn();
    } finally {
      active = false;
    }
  }
  function currentTarget(): BackupVerificationTarget {
    try {
      if (!options.target || options.snapshotProtocol !== 2) unavailable();
      return snapshotRecoveryTarget(options.target());
    } catch {
      return unavailable();
    }
  }
  function assertCurrent(state: SavedState) {
    if (state.version === 2) {
      if (currentTarget().digest !== state.target.digest) unavailable();
    } else if (options.snapshotProtocol !== undefined || options.target !== undefined)
      unavailable();
  }
  async function read(): Promise<SavedState | undefined> {
    const state = await readCloudRecoveryState(options.stateDir);
    if (state && state.origin !== options.origin) unavailable();
    return state;
  }
  async function readForSetup(): Promise<SavedState | undefined> {
    const state = await read();
    if (state?.phase === "staged") {
      const phase = await readRestoreFlowPhase(options.stateDir);
      if (phase === "unreadable") return unavailable();
      if (phase !== "staged" && phase !== "placing") {
        delete state.phase;
        await save(state);
      }
    }
    return state;
  }
  async function save(value: SavedState) {
    const raw = JSON.stringify(value);
    if (value.version === 2 && Buffer.byteLength(raw) > 65536) unavailable();
    await mkdirDurable(join(options.stateDir, CLOUD_DIR), 0o700);
    await writeFileDurable(path, raw, 0o600);
  }
  function fresh(): SavedState {
    const key = generateKeyPairSync("ed25519");
    const binding =
      options.snapshotProtocol === 2
        ? {
            version: 2 as const,
            protocol: "backup-data-restore/v1" as const,
            target: currentTarget(),
          }
        : options.target === undefined
          ? { version: 1 as const }
          : unavailable();
    return {
      ...binding,
      origin: options.origin,
      environment: "preproduction",
      requestId: randomUUID(),
      code: String(randomInt(100000000)).padStart(8, "0"),
      privateKey: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
      publicKey: key.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    };
  }
  function proof(
    state: SavedState,
    action: "start" | "status" | "info" | "read" | "restored",
    digest = "",
  ) {
    assertCurrent(state);
    const bytes =
      state.version === 2
        ? Buffer.from(
            JSON.stringify(
              action === "start" || action === "status"
                ? [
                    "waitron-cloud-recovery-request-v2",
                    options.origin,
                    state.requestId,
                    action,
                    state.publicKey,
                    state.code,
                    state.target.digest,
                    Date.now(),
                  ]
                : [
                    "waitron-cloud-recovery-v2",
                    options.origin,
                    state.requestId,
                    action,
                    digest,
                    state.target.digest,
                    Date.now(),
                  ],
            ),
          )
        : Buffer.from(
            JSON.stringify(
              action === "start" || action === "status"
                ? [
                    "waitron-cloud-recovery-request-v1",
                    options.origin,
                    state.requestId,
                    action,
                    state.publicKey,
                    state.code,
                    Date.now(),
                  ]
                : [
                    "waitron-cloud-recovery-v1",
                    options.origin,
                    state.requestId,
                    action,
                    digest,
                    Date.now(),
                  ],
            ),
          );
    return {
      payload: bytes.toString("base64url"),
      signature: signCloudPayload(bytes, state.privateKey),
    };
  }
  async function post(
    state: SavedState,
    action: "start" | "status" | "info" | "read" | "restored",
    digest = "",
  ): Promise<unknown> {
    try {
      const response = await fetchImpl(`${options.origin}/api/recovery/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          state.version === 2
            ? {
                version: 2,
                ...(action === "start" || action === "status" ? {} : { id: state.requestId }),
                target: state.target,
                ...proof(state, action, digest),
              }
            : action === "start" || action === "status"
              ? proof(state, action)
              : { id: state.requestId, ...proof(state, action, digest) },
        ),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 410 && (action === "status" || action === "info"))
        throw new ExpiredRequest();
      if (!response.ok) unavailable();
      const replyBytes = await readCloudResponseBytes(
        response,
        state.version === 2 ? 65536 : 16384,
      );
      const raw = replyBytes.toString();
      const result: unknown =
        state.version === 2 ? parseBackupVerificationJson(raw, 65536) : JSON.parse(raw);
      if (state.version === 2 && (!record(result) || result.version !== 2)) unavailable();
      assertCurrent(state);
      return result;
    } catch (error) {
      if (error instanceof ExpiredRequest) throw error;
      return unavailable();
    }
  }
  function view(
    state: SavedState,
    mode: CloudRecoveryView["state"],
    p?: CloudRecoveryPoint,
    deadline?: string,
  ): CloudRecoveryView {
    return {
      requestId: state.requestId,
      code: state.code,
      openCloudUrl: `${options.origin}/recover#request=${state.requestId}`,
      expiresAt: deadline ?? state.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      state: mode,
      ...(p
        ? { point: { id: p.id, venueId: p.venueId, capturedAt: p.capturedAt, modules: p.modules } }
        : {}),
    };
  }
  function checkedVerification(
    state: SavedState,
    response: Record<string, unknown>,
    p: CloudRecoveryPoint,
  ): SnapshotRecoveryVerification | undefined {
    if (state.version === 1) return undefined;
    const verification = readSnapshotRecoveryVerification(response.verification);
    assertSnapshotRecoveryTarget(verification, currentTarget());
    if (
      verification.pointId !== p.id ||
      verification.archiveSha256 !== p.digest ||
      verification.archiveBytes !== p.size ||
      (state.snapshotVerification &&
        !sameSnapshotRecoveryVerification(state.snapshotVerification, verification))
    )
      unavailable();
    return verification;
  }
  async function statusOf(state: SavedState, action: "start" | "status") {
    let result: unknown;
    try {
      result = await post(state, action);
    } catch (error) {
      if (!(error instanceof ExpiredRequest)) throw error;
      state.expiresAt ??= new Date().toISOString();
      await save(state);
      return view(state, "expired", undefined, new Date().toISOString());
    }
    if (
      !record(result) ||
      result.requestId !== state.requestId ||
      !validDate(result.expiresAt) ||
      typeof result.state !== "string" ||
      !["awaiting_owner", "approved"].includes(result.state) ||
      result.operationId !== (result.state === "approved" ? state.requestId : null) ||
      (state.expiresAt && state.expiresAt !== result.expiresAt)
    )
      unavailable();
    state.expiresAt = result.expiresAt;
    await save(state);
    if (result.state === "awaiting_owner") return view(state, "awaiting_owner");
    let info: unknown;
    try {
      info = await post(state, "info");
    } catch (error) {
      if (error instanceof ExpiredRequest)
        return view(state, "expired", undefined, new Date().toISOString());
      throw error;
    }
    if (
      !record(info) ||
      !validDate(info.operationExpiresAt) ||
      Date.parse(info.operationExpiresAt) <= Date.now()
    )
      unavailable();
    const p = point(info.point);
    if (state.pointId && state.pointId !== p.id) unavailable();
    const verification = checkedVerification(state, info, p);
    state.pointId = p.id;
    if (state.version === 2) state.snapshotVerification = verification;
    await save(state);
    return view(state, "approved", p, info.operationExpiresAt);
  }
  async function withSelectedArchive<T>(
    expectedPointId: string,
    use: (request: ArchiveFileRestoreRequest, state: SavedState) => Promise<T>,
  ): Promise<T> {
    const state = await readForSetup();
    if (!state || state.phase) unavailable();
    const current = await statusOf(state, "status");
    if (current.state !== "approved" || !current.point || expectedPointId !== current.point.id)
      unavailable();
    const info = await post(state, "info");
    if (!record(info)) unavailable();
    const p = point(info.point);
    if (
      p.id !== current.point.id ||
      state.pointId !== p.id ||
      !validDate(info.operationExpiresAt) ||
      Date.parse(info.operationExpiresAt) <= Date.now()
    )
      unavailable();
    const verification = checkedVerification(state, info, p);
    const result = await post(state, "read", p.digest);
    if (
      !record(result) ||
      !record(result.location) ||
      !record(result.credentials) ||
      typeof result.recoveryKey !== "string" ||
      !result.recoveryKey ||
      !validDate(result.expiresAt) ||
      Date.parse(result.expiresAt) <= Date.now() ||
      !validDate(result.operationExpiresAt) ||
      Date.parse(result.operationExpiresAt) <= Date.now()
    )
      unavailable();
    const granted = point(result.point);
    if (JSON.stringify(granted) !== JSON.stringify(p)) unavailable();
    checkedVerification(state, result, granted);
    const grant = result as unknown as Grant;
    const stagingDir = join(options.stateDir, RESTORE_STAGING_DIR);
    let scratch: string | undefined;
    try {
      try {
        await mkdir(stagingDir, { recursive: true, mode: 0o700 });
        const free = await freeBytes(stagingDir);
        if (free === null || free - START_FREE_SPACE_FLOOR < p.size)
          throw new AppError("restore.archive_resource_limit", {});
        scratch = await mkdtemp(join(stagingDir, ARCHIVE_DOWNLOAD_PREFIX));
      } catch (error) {
        if (["ENOSPC", "EDQUOT"].includes(errnoOf(error) ?? ""))
          throw new AppError("restore.archive_resource_limit", {});
        throw error;
      }
      const artifactPath = join(scratch, "archive");
      if (options.download) await options.download(grant, artifactPath);
      else await downloadArchive(grant, artifactPath, options.storageCa);
      if (
        (await stat(artifactPath)).size !== p.size ||
        (await recoveryArchiveFileSourceId(artifactPath)) !== p.digest
      )
        unavailable();
      const after = await post(state, "info");
      if (
        !record(after) ||
        JSON.stringify(point(after.point)) !== JSON.stringify(p) ||
        !validDate(after.operationExpiresAt) ||
        Date.parse(after.operationExpiresAt) <= Date.now()
      )
        unavailable();
      checkedVerification(state, after, p);
      assertCurrent(state);
      return await use(
        {
          kind: "archive-file",
          artifactPath,
          recoveryKey: grant.recoveryKey,
          environment: "preproduction",
          managedCloud: { requestId: state.requestId, pointId: p.id },
          ...(verification === undefined ? {} : { snapshotVerification: verification }),
        },
        state,
      );
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  }
  return {
    async replacementApproval(): Promise<{
      requestId: string;
      code: string;
      openCloudUrl: string;
    }> {
      return locked(async () => {
        const state = await read();
        if (!state?.pointId || (state.phase !== "restored" && state.phase !== "reported"))
          unavailable();
        return {
          requestId: state.requestId,
          code: state.code,
          openCloudUrl: `${options.origin}/recover#request=${state.requestId}`,
        };
      });
    },
    async replacementIdentity(): Promise<{
      requestId: string;
      pointId: string;
      publicKey: string;
      privateKey: string;
      phase: "restored" | "reported";
    }> {
      return locked(async () => {
        const state = await read();
        if (!state?.pointId || (state.phase !== "restored" && state.phase !== "reported"))
          unavailable();
        return {
          requestId: state.requestId,
          pointId: state.pointId,
          publicKey: state.publicKey,
          privateKey: state.privateKey,
          phase: state.phase,
        };
      });
    },
    async binding(): Promise<{ requestId: string; pointId?: string }> {
      return locked(async () => {
        const state = await read();
        if (!state) unavailable();
        return { requestId: state.requestId, pointId: state.pointId };
      });
    },
    async start(): Promise<CloudRecoveryView> {
      return locked(async () => {
        let state = await readForSetup();
        if (!state) {
          state = fresh();
          await save(state);
        }
        if (state.phase) unavailable();
        return statusOf(state, "start");
      });
    },
    async status(): Promise<CloudRecoveryView> {
      return locked(async () => {
        const state = await readForSetup();
        if (!state) unavailable();
        return statusOf(state, "status");
      });
    },
    async startAgain(): Promise<CloudRecoveryView> {
      return locked(async () => {
        const old = await readForSetup();
        if (old) {
          if (old.phase) unavailable();
          const previous = await statusOf(old, "status");
          if (previous.state !== "expired") unavailable();
        }
        const state = fresh();
        await save(state);
        return statusOf(state, "start");
      });
    },
    async preview<T>(
      review: (request: ArchiveFileRestoreRequest) => Promise<T>,
      expectedPointId: string,
    ): Promise<T> {
      return locked(() => withSelectedArchive(expectedPointId, (request) => review(request)));
    },
    async restore(
      stage: (request: ArchiveFileRestoreRequest) => Promise<void>,
      expectedPointId: string,
    ): Promise<void> {
      return locked(() =>
        withSelectedArchive(expectedPointId, async (request, state) => {
          await stage(request);
          state.phase = "staged";
          await save(state);
        }),
      );
    },
    async markRestored(binding: { requestId: string; pointId: string }): Promise<void> {
      return locked(async () => {
        const state = await read();
        if (
          !state ||
          !["staged", "restored", "reported"].includes(state.phase ?? "") ||
          state.requestId !== binding.requestId ||
          state.pointId !== binding.pointId
        )
          unavailable();
        if (state.phase !== "staged") return;
        state.phase = "restored";
        await save(state);
      });
    },
    async reportRestored(): Promise<void> {
      return locked(async () => {
        const state = await read();
        if (!state || state.phase !== "restored" || !state.pointId) return;
        const info = await post(state, "info");
        if (!record(info)) unavailable();
        const p = point(info.point);
        if (p.id !== state.pointId) unavailable();
        checkedVerification(state, info, p);
        const result = await post(state, "restored", p.digest);
        if (!record(result) || result.status !== "restored") unavailable();
        state.phase = "reported";
        await save(state);
      });
    },
  };
}
