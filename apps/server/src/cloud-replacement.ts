import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import type { CloudConnection, CloudRegistration } from "./cloud-client.js";
import "./errors.js";

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 200;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const active = new Set<string>();

export interface ReplacementView {
  requestId: string;
  pointId: string;
  venueId: string;
  oldInstallationId: string;
  localVenueId: string;
  nodeId: string;
  environment: "test";
  publicKey: string;
  peerPublicKey: string;
  state: "awaiting_owner" | "complete";
  expiresAt: string;
  organisationName: string;
  legalBusinessName: string;
  registration: CloudRegistration | null;
}
interface SavedReplacement {
  version: 1;
  origin: string;
  requestId: string;
  pointId: string;
  localVenueId: string;
  nodeId: string;
  publicKey: string;
  privateKey: string;
  peerPublicKey: string;
  peerPrivateKey: string;
  view?: ReplacementView;
}
export interface ReplacementOptions {
  stateDir: string;
  origin: string;
  localVenueId: string;
  nodeId: string;
  connection: CloudConnection;
  fetch?: typeof fetch;
}
function conflict(): never {
  throw new AppError("cloud.binding_conflict", {});
}
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}

export function createCloudReplacement(options: ReplacementOptions) {
  const path = join(resolve(options.stateDir), "cloud-replacement.json");
  const recovery = createCloudRecoveryClient({
    stateDir: options.stateDir,
    origin: options.origin,
    environment: "preproduction",
    fetch: options.fetch,
  });
  const fetchImpl = options.fetch ?? fetch;
  async function locked<T>(work: () => Promise<T>): Promise<T> {
    if (active.has(path)) throw new AppError("cloud.busy", {});
    active.add(path);
    try {
      return await work();
    } finally {
      active.delete(path);
    }
  }
  async function read(): Promise<SavedReplacement | undefined> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 16384 || info.mode & 0o077) throw Error();
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !record(value) ||
        value.version !== 1 ||
        value.origin !== options.origin ||
        value.localVenueId !== options.localVenueId ||
        value.nodeId !== options.nodeId ||
        !uuid(value.requestId) ||
        !uuid(value.pointId) ||
        typeof value.privateKey !== "string" ||
        typeof value.publicKey !== "string" ||
        typeof value.peerPrivateKey !== "string" ||
        typeof value.peerPublicKey !== "string"
      )
        throw Error();
      const key = createPrivateKey({
        key: Buffer.from(value.privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      });
      if (
        key.asymmetricKeyType !== "ed25519" ||
        createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64url") !==
          value.publicKey ||
        Buffer.from(value.peerPrivateKey, "base64").length !== 32 ||
        Buffer.from(value.peerPublicKey, "base64").length !== 32
      )
        throw Error();
      const peerKey = createPrivateKey({
        key: Buffer.concat([
          Buffer.from("302e020100300506032b656e04220420", "hex"),
          Buffer.from(value.peerPrivateKey, "base64"),
        ]),
        format: "der",
        type: "pkcs8",
      });
      if (
        createPublicKey(peerKey)
          .export({ format: "der", type: "spki" })
          .subarray(-32)
          .toString("base64") !== value.peerPublicKey
      )
        throw Error();
      const saved = value as unknown as SavedReplacement;
      if (saved.view !== undefined) validate(saved.view, saved);
      return saved;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new AppError("cloud.state_invalid", {});
    }
  }
  async function save(value: SavedReplacement) {
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
  async function identity() {
    let value: Awaited<ReturnType<typeof recovery.replacementIdentity>>;
    try {
      value = await recovery.replacementIdentity();
    } catch {
      throw new AppError("cloud.replacement_not_restored", {});
    }
    if (value.phase === "restored") {
      try {
        await recovery.reportRestored();
      } catch {
        unavailable();
      }
      value = await recovery.replacementIdentity();
    }
    if (value.phase !== "reported") conflict();
    return value;
  }
  async function candidate() {
    const proof = await identity();
    let saved = await read();
    if (saved && (saved.requestId !== proof.requestId || saved.pointId !== proof.pointId))
      conflict();
    const connection = await options.connection.status();
    if (
      connection.state !== "not_connected" &&
      (!saved ||
        connection.requestId !== saved.requestId ||
        connection.registration?.installationId !== saved.view?.registration?.installationId)
    )
      conflict();
    if (!saved) {
      const installation = generateKeyPairSync("ed25519");
      const peer = generateKeyPairSync("x25519");
      const peerPrivate = peer.privateKey.export({ format: "der", type: "pkcs8" });
      const peerPublic = peer.publicKey.export({ format: "der", type: "spki" });
      saved = {
        version: 1,
        origin: options.origin,
        requestId: proof.requestId,
        pointId: proof.pointId,
        localVenueId: options.localVenueId,
        nodeId: options.nodeId,
        privateKey: installation.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64url"),
        publicKey: installation.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64url"),
        peerPrivateKey: peerPrivate.subarray(-32).toString("base64"),
        peerPublicKey: peerPublic.subarray(-32).toString("base64"),
      };
      await save(saved);
    }
    return { saved, proof };
  }
  function validate(value: unknown, state: SavedReplacement): ReplacementView {
    if (
      !record(value) ||
      Object.keys(value).sort().join(",") !==
        [
          "requestId",
          "pointId",
          "venueId",
          "oldInstallationId",
          "localVenueId",
          "nodeId",
          "environment",
          "publicKey",
          "peerPublicKey",
          "state",
          "expiresAt",
          "organisationName",
          "legalBusinessName",
          "registration",
        ]
          .sort()
          .join(",") ||
      value.requestId !== state.requestId ||
      value.pointId !== state.pointId ||
      !uuid(value.venueId) ||
      !uuid(value.oldInstallationId) ||
      value.localVenueId !== state.localVenueId ||
      value.nodeId !== state.nodeId ||
      value.environment !== "test" ||
      value.publicKey !== state.publicKey ||
      value.peerPublicKey !== state.peerPublicKey ||
      !["awaiting_owner", "complete"].includes(String(value.state)) ||
      !date(value.expiresAt) ||
      !name(value.organisationName) ||
      !name(value.legalBusinessName)
    )
      unavailable();
    if (value.state === "complete") {
      const r = value.registration;
      if (
        !record(r) ||
        !uuid(r.venueId) ||
        !uuid(r.installationId) ||
        !uuid(r.organisationId) ||
        !uuid(r.legalBusinessId) ||
        r.venueId !== value.venueId
      )
        unavailable();
    } else if (value.registration !== null) unavailable();
    if (
      state.view &&
      (state.view.venueId !== value.venueId ||
        state.view.oldInstallationId !== value.oldInstallationId ||
        state.view.organisationName !== value.organisationName ||
        state.view.legalBusinessName !== value.legalBusinessName ||
        (state.view.state === "complete" &&
          (value.state !== "complete" ||
            JSON.stringify(state.view.registration) !== JSON.stringify(value.registration))))
    )
      unavailable();
    return value as unknown as ReplacementView;
  }
  async function exchange(action: "prepare" | "status", authorize?: () => Promise<void>) {
    const { saved, proof } = await candidate();
    const bytes = Buffer.from(
      JSON.stringify([
        "waitron-cloud-replacement-v1",
        options.origin,
        saved.requestId,
        action,
        saved.localVenueId,
        saved.nodeId,
        "test",
        saved.publicKey,
        saved.peerPublicKey,
        Date.now(),
      ]),
    );
    const signWith = (privateKey: string) =>
      sign(
        null,
        bytes,
        createPrivateKey({
          key: Buffer.from(privateKey, "base64url"),
          format: "der",
          type: "pkcs8",
        }),
      ).toString("base64url");
    let value: unknown;
    try {
      const response = await fetchImpl(`${options.origin}/api/replacement/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: saved.requestId,
          payload: bytes.toString("base64url"),
          signature: signWith(proof.privateKey),
          keySignature: signWith(saved.privateKey),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || !response.body) unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 16384) unavailable();
        chunks.push(chunk);
      }
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      unavailable();
    }
    const view = validate(value, saved);
    await authorize?.();
    saved.view = view;
    await save(saved);
    if (saved.view.state === "complete")
      await options.connection.importReplacement({
        requestId: saved.requestId,
        privateKey: saved.privateKey,
        publicKey: saved.publicKey,
        expiresAt: saved.view.expiresAt,
        organisationName: saved.view.organisationName,
        legalBusinessName: saved.view.legalBusinessName,
        registration: saved.view.registration!,
      });
    return saved.view;
  }
  return {
    async eligible(): Promise<boolean> {
      try {
        await recovery.replacementIdentity();
        return true;
      } catch {
        return false;
      }
    },
    prepare: (authorize?: () => Promise<void>) => locked(() => exchange("prepare", authorize)),
    check: (authorize?: () => Promise<void>) => locked(() => exchange("status", authorize)),
    async status(): Promise<ReplacementView | null> {
      return (await read())?.view ?? null;
    },
    async resume(): Promise<void> {
      await locked(async () => {
        const saved = await read();
        if (!saved?.view || saved.view.state !== "complete") return;
        const { proof } = await candidate();
        if (proof.requestId !== saved.requestId) conflict();
        await options.connection.importReplacement({
          requestId: saved.requestId,
          privateKey: saved.privateKey,
          publicKey: saved.publicKey,
          expiresAt: saved.view.expiresAt,
          organisationName: saved.view.organisationName,
          legalBusinessName: saved.view.legalBusinessName,
          registration: saved.view.registration!,
        });
      });
    },
  };
}
export type CloudReplacement = ReturnType<typeof createCloudReplacement>;
