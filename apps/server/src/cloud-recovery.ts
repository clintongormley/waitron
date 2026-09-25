import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomInt,
  randomUUID,
  sign,
} from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { Agent } from "node:https";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RestoreRequest } from "./restore-request.js";

const MAX_BYTES = 512 * 1024 * 1024;
const STATE_FILE = "cloud-recovery.json";
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
function unavailable(): never {
  throw new Error("Cloud recovery is unavailable. Try again.");
}
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
interface SavedState {
  version: 1;
  origin: string;
  environment: "preproduction";
  requestId: string;
  publicKey: string;
  privateKey: string;
  code: string;
  expiresAt?: string;
  pointId?: string;
  phase?: "staged" | "restored" | "reported";
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
  async function read(): Promise<SavedState | undefined> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 8192 || info.mode & 0o077) unavailable();
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !record(value) ||
        value.version !== 1 ||
        value.origin !== options.origin ||
        value.environment !== "preproduction" ||
        !uuid(value.requestId) ||
        typeof value.code !== "string" ||
        !/^\d{8}$/.test(value.code) ||
        typeof value.publicKey !== "string" ||
        typeof value.privateKey !== "string"
      )
        unavailable();
      const privateKey = createPrivateKey({
        key: Buffer.from(value.privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      });
      if (
        privateKey.asymmetricKeyType !== "ed25519" ||
        createPublicKey(privateKey)
          .export({ type: "spki", format: "der" })
          .toString("base64url") !== value.publicKey ||
        (value.expiresAt !== undefined && !validDate(value.expiresAt)) ||
        (value.pointId !== undefined && !uuid(value.pointId)) ||
        (value.phase !== undefined &&
          !["staged", "restored", "reported"].includes(String(value.phase)))
      )
        unavailable();
      return value as unknown as SavedState;
    } catch (error) {
      if (record(error) && error.code === "ENOENT") return undefined;
      return unavailable();
    }
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
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value));
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
    return {
      version: 1,
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
    const bytes = Buffer.from(
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
          action === "start" || action === "status"
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
        if (size > 16384) unavailable();
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks, size).toString()) as unknown;
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
    state.pointId = p.id;
    await save(state);
    return view(state, "approved", p, info.operationExpiresAt);
  }
  return {
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
    async restore(
      stage: (request: RestoreRequest) => Promise<void>,
      expectedPointId: string,
    ): Promise<void> {
      return locked(async () => {
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
        await stage({
          artifact: archive,
          recoveryKey: grant.recoveryKey,
          environment: "preproduction",
          managedCloud: { requestId: state.requestId, pointId: p.id },
        });
        state.phase = "staged";
        await save(state);
      });
    },
    async markRestored(binding: { requestId: string; pointId: string }): Promise<void> {
      return locked(async () => {
        const state = await read();
        if (
          !state ||
          state.phase !== "staged" ||
          state.requestId !== binding.requestId ||
          state.pointId !== binding.pointId
        )
          unavailable();
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
        const result = await post(state, "restored", p.digest);
        if (!record(result) || result.status !== "restored") unavailable();
        state.phase = "reported";
        await save(state);
      });
    },
  };
}
