import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomInt,
  randomUUID,
  sign,
} from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
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
import type { ArchiveRestoreRequest } from "./restore-request.js";

const MAX_BYTES = 512 * 1024 * 1024;
const STATE_FILE = "cloud-recovery.json";
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
  download?: (grant: Grant) => Promise<Uint8Array>;
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
    Number(value.size) > MAX_BYTES ||
    !record(value.modules) ||
    Object.values(value.modules).some((v) => !Number.isSafeInteger(v) || Number(v) < 0)
  )
    unavailable();
  return value as unknown as CloudRecoveryPoint;
}
async function downloadArchive(grant: Grant, ca?: string): Promise<Uint8Array> {
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
      requestHandler: { httpsAgent: new Agent({ ca }) },
    });
    const response = await client.send(
      new GetObjectCommand({ Bucket: grant.location.bucket, Key: grant.point.objectKey }),
      { abortSignal: AbortSignal.timeout(remaining) },
    );
    if (response.ContentLength !== grant.point.size || !response.Body) unavailable();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > grant.point.size || size > MAX_BYTES) unavailable();
      chunks.push(chunk);
    }
    if (size !== grant.point.size) unavailable();
    return Buffer.concat(chunks, size);
  } catch {
    return unavailable();
  } finally {
    client?.destroy();
  }
}

export function createCloudRecoveryClient(options: CloudRecoveryOptions) {
  if (options.environment !== "preproduction") unavailable();
  const path = join(options.stateDir, STATE_FILE);
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
      try {
        await lstat(join(options.stateDir, "restore-request.json"));
      } catch (error) {
        if (!record(error) || error.code !== "ENOENT") return unavailable();
        // A failed cold restore removes its marker. Keep the approved identity for a retry.
        delete state.phase;
        await save(state);
      }
    }
    return state;
  }
  async function save(value: SavedState) {
    const raw = JSON.stringify(value);
    if (value.version === 2 && Buffer.byteLength(raw) > 65536) unavailable();
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(raw);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      const dir = await open(options.stateDir, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
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
      signature: sign(
        null,
        bytes,
        createPrivateKey({
          key: Buffer.from(state.privateKey, "base64url"),
          format: "der",
          type: "pkcs8",
        }),
      ).toString("base64url"),
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
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) unavailable();
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > (state.version === 2 ? 65536 : 16384)) unavailable();
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks, size).toString();
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
      !["awaiting_owner", "approved"].includes(String(result.state)) ||
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
  async function readSelectedArchive(expectedPointId: string) {
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
    const archive = await (
      options.download ?? ((g: Grant) => downloadArchive(g, options.storageCa))
    )(grant);
    if (
      archive.length !== p.size ||
      createHash("sha256").update(archive).digest("hex") !== p.digest
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
    const request: ArchiveRestoreRequest & { snapshotVerification?: SnapshotRecoveryVerification } =
      {
        artifact: archive,
        recoveryKey: grant.recoveryKey,
        environment: "preproduction",
        managedCloud: { requestId: state.requestId, pointId: p.id },
        ...(verification === undefined ? {} : { snapshotVerification: verification }),
      };
    return { state, request };
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
      review: (request: ArchiveRestoreRequest) => Promise<T>,
      expectedPointId: string,
    ): Promise<T> {
      return locked(async () => {
        const { request } = await readSelectedArchive(expectedPointId);
        return review(request);
      });
    },
    async restore(
      stage: (request: ArchiveRestoreRequest) => Promise<void>,
      expectedPointId: string,
    ): Promise<void> {
      return locked(async () => {
        const { state, request } = await readSelectedArchive(expectedPointId);
        await stage(request);
        state.phase = "staged";
        await save(state);
      });
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
