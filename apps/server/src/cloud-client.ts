import {
  installationClient,
  projectCloudInstallation,
  readCloudInstallation,
  type CloudInstallationState,
  type CloudInstallationStatus,
  type CloudObservation,
} from "./cloud-installation.js";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomInt,
  randomUUID,
  sign,
} from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface CloudRegistration {
  venueId: string;
  installationId: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface CloudPairingView {
  requestId: string;
  localVenueId: string;
  environment: "test" | "production";
  expiresAt: string;
  state: "awaiting_cloud" | "awaiting_local" | "complete";
  organisationId?: string;
  legalBusinessId?: string;
  organisationName?: string;
  legalBusinessName?: string;
  registration?: CloudRegistration;
}
export interface CloudConnectionStatus extends Partial<Omit<CloudPairingView, "state">> {
  state: "not_connected" | "awaiting_cloud" | "awaiting_local" | "complete";
  code: string;
  installation?: CloudInstallationStatus;
  openCloudUrl?: string;
}
export interface CloudChoice {
  requestId: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface CloudConnectionOptions {
  stateDir: string;
  origin: string;
  localVenueId: string;
  environment: "test" | "production";
}
export interface SavedCloudState {
  lifecycle?: CloudInstallationState;
  version: 1;
  origin: string;
  privateKey: string;
  publicKey: string;
  localVenueId: string;
  environment: "test" | "production";
  requestId: string;
  code: string;
  view?: CloudPairingView;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const name = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 200;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function loadCloudOrigin(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.WAITRON_CLOUD_ORIGIN;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (env.WAITRON_ENV === "dev" &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error();
    return value;
  } catch {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_CLOUD_ORIGIN",
      reason: "secure_origin_required",
    });
  }
}
function readView(value: unknown, state: SavedCloudState): CloudPairingView {
  if (
    !record(value) ||
    value.requestId !== state.requestId ||
    value.localVenueId !== state.localVenueId ||
    value.environment !== state.environment ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !["awaiting_cloud", "awaiting_local", "complete"].includes(String(value.state))
  )
    throw new AppError("cloud.unavailable", {});
  const view: CloudPairingView = {
    requestId: state.requestId,
    localVenueId: state.localVenueId,
    environment: state.environment,
    expiresAt: value.expiresAt,
    state: value.state as CloudPairingView["state"],
  };
  if (view.state !== "awaiting_cloud") {
    if (
      !uuid(value.organisationId) ||
      !uuid(value.legalBusinessId) ||
      !name(value.organisationName) ||
      !name(value.legalBusinessName)
    )
      throw new AppError("cloud.unavailable", {});
    Object.assign(view, {
      organisationId: value.organisationId,
      legalBusinessId: value.legalBusinessId,
      organisationName: value.organisationName,
      legalBusinessName: value.legalBusinessName,
    });
  }
  if (view.state === "complete") {
    const r = value.registration;
    if (
      !record(r) ||
      !uuid(r.venueId) ||
      !uuid(r.installationId) ||
      r.organisationId !== view.organisationId ||
      r.legalBusinessId !== view.legalBusinessId
    )
      throw new AppError("cloud.unavailable", {});
    view.registration = {
      venueId: r.venueId,
      installationId: r.installationId,
      organisationId: r.organisationId as string,
      legalBusinessId: r.legalBusinessId as string,
    };
  }
  if (
    state.view?.organisationId &&
    (view.organisationId !== state.view.organisationId ||
      view.legalBusinessId !== state.view.legalBusinessId)
  )
    throw new AppError("cloud.unavailable", {});
  if (
    state.view?.registration &&
    JSON.stringify(view.registration) !== JSON.stringify(state.view.registration)
  )
    throw new AppError("cloud.unavailable", {});
  return view;
}
const activePaths = new Map<string, Promise<void>>();
/** One server process owns a node state directory. Calls within that process share this write gate. */
export function createCloudConnection(options: CloudConnectionOptions) {
  const path = join(resolve(options.stateDir), "cloud-connection.json");
  async function read(): Promise<SavedCloudState | undefined> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0) throw new Error();
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !record(value) ||
        value.version !== 1 ||
        value.origin !== options.origin ||
        value.localVenueId !== options.localVenueId ||
        value.environment !== options.environment ||
        !uuid(value.requestId) ||
        typeof value.code !== "string" ||
        !/^\d{8}$/.test(value.code) ||
        typeof value.privateKey !== "string" ||
        typeof value.publicKey !== "string"
      )
        throw new Error();
      const key = createPrivateKey({
        key: Buffer.from(value.privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      });
      if (
        key.asymmetricKeyType !== "ed25519" ||
        createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64url") !==
          value.publicKey
      )
        throw new Error();
      const state = value as unknown as SavedCloudState;
      if (state.view !== undefined) state.view = readView(state.view, state);
      if (state.lifecycle !== undefined)
        state.lifecycle = readCloudInstallation(state.lifecycle, state);
      return state;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new AppError("cloud.state_invalid", {});
    }
  }
  async function save(state: SavedCloudState) {
    await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      const directory = await open(options.stateDir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  function project(state: SavedCloudState | undefined): CloudConnectionStatus {
    if (!state) return { state: "not_connected", code: "" };
    return {
      state: "awaiting_cloud",
      requestId: state.requestId,
      localVenueId: state.localVenueId,
      environment: state.environment,
      ...state.view,
      code: state.view?.state === "complete" ? "" : state.code,
      openCloudUrl: `${options.origin}/connect#request=${state.requestId}`,
      ...(state.view?.registration ? { installation: projectCloudInstallation(state) } : {}),
    };
  }
  async function exchange(
    state: SavedCloudState,
    action: "start" | "status" | "complete",
    choice?: CloudChoice,
  ): Promise<CloudPairingView> {
    const bytes = Buffer.from(
      JSON.stringify([
        "waitron-cloud-pair-v1",
        state.origin,
        action,
        state.requestId,
        state.publicKey,
        state.localVenueId,
        state.environment,
        action === "start" ? state.code : "",
        choice?.organisationId ?? "",
        choice?.legalBusinessId ?? "",
        Date.now(),
      ]),
    );
    const signature = sign(
      null,
      bytes,
      createPrivateKey({
        key: Buffer.from(state.privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      }),
    ).toString("base64url");
    try {
      const response = await fetch(`${options.origin}/api/pairing/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: bytes.toString("base64url"), signature }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (!response.body) throw new Error();
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 16384) throw new Error();
        chunks.push(chunk);
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!response.ok) {
        if (record(value) && value.error === "pairing_unavailable")
          throw new AppError("cloud.request_unavailable", {});
        throw new Error();
      }
      return readView(value, state);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("cloud.unavailable", {});
    }
  }
  async function run(work: () => Promise<CloudConnectionStatus>, wait = false) {
    while (activePaths.has(path)) {
      if (!wait) throw new AppError("cloud.busy", {});
      await activePaths.get(path);
    }
    let release = () => {};
    activePaths.set(
      path,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      return await work();
    } finally {
      activePaths.delete(path);
      release();
    }
  }
  return {
    async status() {
      return project(await read());
    },
    async refresh(signal?: AbortSignal) {
      return run(async () => {
        const state = await read();
        if (!state?.view?.registration) return project(state);
        await installationClient(state, save).refresh(signal);
        return project(state);
      });
    },
    async revoke(authorize: () => Promise<void>, signal?: AbortSignal) {
      return run(async () => {
        const state = await read();
        if (!state?.view?.registration) throw new AppError("cloud.binding_conflict", {});
        await installationClient(state, save).revoke(authorize, signal);
        return project(state);
      }, true);
    },
    async report(services: CloudObservation[], observedAt = Date.now(), signal?: AbortSignal) {
      return run(async () => {
        const state = await read();
        if (!state?.view?.registration) throw new AppError("cloud.binding_conflict", {});
        await installationClient(state, save).report(services, observedAt, signal);
        return project(state);
      });
    },
    async start(restart = false) {
      return run(async () => {
        let state = await read();
        if (state?.view?.state === "complete") return project(state);
        if (state && restart) {
          try {
            const latest = await exchange(state, "status");
            if (latest.state === "complete") {
              state.view = latest;
              await save(state);
              return project(state);
            }
            throw new AppError("cloud.binding_conflict", {});
          } catch (error) {
            if (!(error instanceof AppError) || error.code !== "cloud.request_unavailable")
              throw error;
          }
          state = {
            ...state,
            requestId: randomUUID(),
            code: randomInt(0, 100000000).toString().padStart(8, "0"),
          };
          delete state.view;
          await save(state);
        }
        if (!state) {
          const key = generateKeyPairSync("ed25519");
          state = {
            version: 1,
            origin: options.origin,
            localVenueId: options.localVenueId,
            environment: options.environment,
            requestId: randomUUID(),
            code: randomInt(0, 100000000).toString().padStart(8, "0"),
            privateKey: key.privateKey
              .export({ format: "der", type: "pkcs8" })
              .toString("base64url"),
            publicKey: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
          };
          await save(state);
        }
        state.view = await exchange(state, "start");
        await save(state);
        return project(state);
      });
    },
    async check() {
      return run(async () => {
        const state = await read();
        if (!state) return project(state);
        state.view = await exchange(state, "status");
        await save(state);
        return project(state);
      });
    },
    async complete(choice: CloudChoice, authorize: () => Promise<void>) {
      return run(async () => {
        const state = await read();
        if (
          !state ||
          choice.requestId !== state.requestId ||
          state.view?.organisationId !== choice.organisationId ||
          state.view?.legalBusinessId !== choice.legalBusinessId
        )
          throw new AppError("cloud.binding_conflict", {});
        const view = await exchange(state, "status");
        if (
          view.organisationId !== choice.organisationId ||
          view.legalBusinessId !== choice.legalBusinessId
        )
          throw new AppError("cloud.binding_conflict", {});
        // No SQLite transaction spans the network wait; recheck live local authority before signing.
        await authorize();
        state.view = await exchange(state, "complete", choice);
        await save(state);
        return project(state);
      });
    },
  };
}
export type CloudConnection = ReturnType<typeof createCloudConnection>;
