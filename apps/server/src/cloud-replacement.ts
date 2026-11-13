import { mkdirDurable, syncFolderHolding, writeFileDurable } from "@waitron/provisioning";
import {
  CLOUD_DIR,
  CLOUD_REPLACEMENT_FILE,
  CLOUD_REPLACEMENT_SET_ASIDE_PREFIX,
} from "@waitron/store";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { link, lstat, readFile } from "node:fs/promises";
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
  stopped?: true;
  /** Fresh keys Cloud has not yet answered must be sent as a reissue, not a status check. */
  reissued?: true;
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
  const path = join(resolve(options.stateDir), CLOUD_REPLACEMENT_FILE);
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
        typeof value.peerPublicKey !== "string" ||
        (value.stopped !== undefined && value.stopped !== true) ||
        (value.reissued !== undefined && value.reissued !== true)
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
      throw new AppError("cloud.replacement_state_invalid", {});
    }
  }
  async function save(value: SavedReplacement) {
    await mkdirDurable(join(options.stateDir, CLOUD_DIR), 0o700);
    await writeFileDurable(path, JSON.stringify(value), 0o600);
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
  async function candidate(reissue: boolean, overUnreadable: boolean) {
    const proof = await identity();
    let saved = overUnreadable ? undefined : await read();
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
        ...(reissue ? { reissued: true as const } : {}),
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
  async function setAsideUnreadable(): Promise<boolean> {
    await identity();
    try {
      await read();
      return false;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "cloud.replacement_state_invalid")
        throw error;
    }
    if ((await options.connection.status()).state !== "not_connected") conflict();
    const aside = join(
      resolve(options.stateDir),
      `${CLOUD_REPLACEMENT_SET_ASIDE_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    // A second name, never a move: `replacement.json` stays the unreadable original until the
    // fresh request replaces it, so an interrupted reissue still shows the refusal.
    try {
      await link(path, aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AppError("cloud.busy", {});
      throw error;
    }
    await syncFolderHolding(aside);
    return true;
  }
  async function exchange(
    action: "prepare" | "status" | "reissue",
    authorize?: () => Promise<void>,
    overUnreadable = false,
  ) {
    const { saved, proof } = await candidate(action === "reissue", overUnreadable);
    const sent = saved.reissued && !saved.view ? "reissue" : action;
    const bytes = Buffer.from(
      JSON.stringify([
        "waitron-cloud-replacement-v1",
        options.origin,
        saved.requestId,
        sent,
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
      const response = await fetchImpl(`${options.origin}/api/replacement/${sent}`, {
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
      if (response.status >= 400 && response.status < 500)
        throw new AppError("cloud.replacement_refused", {});
      if (!response.ok || !response.body) unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 16384) unavailable();
        chunks.push(chunk);
      }
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch (error) {
      if (error instanceof AppError && error.code === "cloud.replacement_refused") throw error;
      unavailable();
    }
    const view = validate(value, saved);
    await authorize?.();
    saved.view = view;
    await save(saved);
    if (saved.view.state === "complete") await importInto(saved, saved.view);
    return saved.view;
  }
  async function importInto(saved: SavedReplacement, view: ReplacementView) {
    await options.connection.importReplacement({
      requestId: saved.requestId,
      privateKey: saved.privateKey,
      publicKey: saved.publicKey,
      expiresAt: view.expiresAt,
      organisationName: view.organisationName,
      legalBusinessName: view.legalBusinessName,
      registration: view.registration!,
      stopped: saved.stopped === true,
    });
  }
  return {
    async approval(): Promise<{ requestId: string; code: string; openCloudUrl: string } | null> {
      try {
        return await recovery.replacementApproval();
      } catch {
        return null;
      }
    },
    async hasProposal(): Promise<boolean> {
      return (await read()) !== undefined;
    },
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
    reissue: (authorize?: () => Promise<void>) =>
      locked(async () => {
        await authorize?.();
        return exchange("reissue", authorize, await setAsideUnreadable());
      }),
    async status(): Promise<ReplacementView | null> {
      return (await read())?.view ?? null;
    },
    async resume(): Promise<void> {
      await locked(async () => {
        const saved = await read();
        if (!saved?.view || saved.view.state !== "complete") return;
        await importInto(saved, saved.view);
      });
    },
    /** `cloud/connection.json` alone cannot keep the stop if it is deleted. */
    async recordStop(): Promise<void> {
      await locked(async () => {
        let saved: SavedReplacement | undefined;
        try {
          saved = await read();
        } catch {
          // Resume and check refuse the file while it stays unreadable; a repaired file, or the fresh
          // request that Get a fresh reconnection request writes, carries no stop
          // (`docs/backlog/replication-cloud.md`, "A stop made while `cloud/replacement.json` is
          // unreadable is not recorded in it").
          return;
        }
        if (!saved || (await options.connection.status()).requestId !== saved.requestId) return;
        saved.stopped = true;
        await save(saved);
      });
    },
  };
}
export type CloudReplacement = ReturnType<typeof createCloudReplacement>;
