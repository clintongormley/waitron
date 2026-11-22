import { hashSessionToken } from "@waitron/identity";
import {
  CLOUD_SIGN_IN_CALLBACK,
  cloudSignInChallenge,
  readCloudSignInReply,
  newCloudSignInAttempt,
  readCloudSignInAttempt,
  readHeldSetupAdmin,
  type CloudSignInBinding,
  type CloudSignInProfile,
  type CloudSignInReturn,
  type CloudSignInState,
  type PreparedSetupAdmin,
} from "./cloud-sign-in.js";
import { fetchSetupAddress } from "./cloud-address-lookup.js";
import { fetchOwnerRecovery, ownerRecoveryBinding } from "./cloud-owner-recovery.js";
import {
  fetchCloudEmailGrant,
  requestSetupCloudEmailGrant,
  sendCloudEmail,
  type CloudEmailGrant,
  type CloudEmail,
} from "./cloud-email.js";
import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";
import { mkdirDurable, writeFileDurable } from "@waitron/provisioning";
import { CLOUD_DIR, CLOUD_CONNECTION_FILE } from "@waitron/store";
import {
  isPairingV4Profile,
  pairingPayload,
  pairingV4Payload,
  pairingV5Payload,
  pairingVenueName,
  type PairingV4Operation,
} from "@waitron/contract";
import {
  reserveCloudCapture,
  publishCloudCapture,
  type CloudCaptureMetadata,
} from "./cloud-backup.js";
import {
  hasLiveLease,
  installationClient,
  markRevoked,
  pendingRequest,
  projectCloudInstallation,
  readCloudInstallation,
  type CloudInstallationState,
  type CloudInstallationStatus,
  type CloudObservation,
} from "./cloud-installation.js";
import {
  fetchEmergencyCode,
  fetchEmergencyDisplay,
  instant,
  validEmergencyAddress,
  type EmergencyDisplay,
} from "./cloud-emergency.js";
import { fetchBillingDisplay, type BillingDisplay, type BillingRefusal } from "./cloud-billing.js";
import {
  collectTranslation,
  type OnRefusal,
  releaseTranslation,
  refusalOf,
  serviceExchange,
  submitTranslation,
  translationStatus,
} from "./cloud-translation.js";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomInt,
  randomUUID,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AppError } from "@waitron/shared";
import {
  readTunnelPublicKey,
  writeTunnelConfiguration,
  staffHostnameFrom,
} from "./cloud-tunnel.js";
import "./errors.js";
import { refreshStaffCertificate } from "./cloud-staff-certificate.js";
import {
  fetchGuestMenuStatus,
  publishCloudGuestMenu,
  withdrawCloudGuestMenu,
} from "./cloud-guest-menu.js";

export interface CloudRegistration {
  venueId: string;
  installationId: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface CloudPairingView {
  requestId: string;
  venueId: string;
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
  remoteAccessEnabled?: boolean;
  sameTabSignIn?: true;
  configured?: false;
  remoteAccessPlanRequired?: true;
  state: "not_connected" | "awaiting_cloud" | "awaiting_local" | "complete";
  code: string;
  installation?: CloudInstallationStatus;
  openCloudUrl?: string;
  signupUrl?: string;
  accountUrl?: string;
}
export interface CloudChoice {
  requestId: string;
  organisationId: string;
  legalBusinessId: string;
}
export interface CloudConnectionOptions {
  managementOrigin?: string;
  signIn?: {
    callback: string;
    readProfile(): Promise<CloudSignInProfile>;
    setup?: boolean;
    currentNodeId?(): string | undefined;
  };
  onEmergencyHintsError?: (error: unknown) => void;
  stateDir: string;
  tunnelDir?: string;
  origin: string;
  readVenueId(): Promise<string | null>;
  readVenueName(): Promise<string>;
  recordVenueId(venueId: string): Promise<void>;
  forgetVenueId(): Promise<void>;
  environment: "test" | "production";
}
interface SavedEmergencyHints {
  registration: string;
  staffOrigin: string;
  address: string | null;
  open: boolean;
  asOf: string;
}
export interface CloudInstallationCredentials {
  origin: string;
  privateKey: string;
  publicKey: string;
  environment: "test" | "production";
  lifecycle?: CloudInstallationState;
  view?: { registration?: CloudRegistration };
}
export interface SavedCloudState extends CloudInstallationCredentials {
  emailRelayEnabled?: boolean;
  emergencyHints?: SavedEmergencyHints;
  remoteAccessEnabled?: boolean;
  version: 2;
  signedIn?: true;
  venueId: string;
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
export function loadCloudSignInCallback(
  env: NodeJS.ProcessEnv,
  managementOrigin: string,
): string | undefined {
  const variable = "WAITRON_TEST_CLOUD_SIGN_IN_CALLBACK";
  const value = env[variable];
  if (!value || env.WAITRON_ENV === "production") return undefined;
  const expected = `${managementOrigin}${CLOUD_SIGN_IN_CALLBACK}`;
  if (!expected.startsWith("https://") || value !== expected)
    throw new AppError("server.config_invalid", { variable, reason: "secure_origin_required" });
  return value;
}

function readView(value: unknown, state: SavedCloudState): CloudPairingView {
  if (
    !record(value) ||
    value.requestId !== state.requestId ||
    (value.venueId !== "" && value.venueId !== state.venueId) ||
    value.venueId !== (state.view?.venueId ?? state.venueId) ||
    value.environment !== state.environment ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    typeof value.state !== "string" ||
    !["awaiting_cloud", "awaiting_local", "complete"].includes(value.state)
  )
    throw new AppError("cloud.unavailable", {});
  const view: CloudPairingView = {
    requestId: state.requestId,
    venueId: value.venueId as string,
    environment: state.environment,
    expiresAt: value.expiresAt,
    state: value.state as CloudPairingView["state"],
  };
  if (view.state !== "awaiting_cloud") {
    if (
      !uuid(value.organisationId) ||
      !uuid(value.legalBusinessId) ||
      (!state.signedIn && (!name(value.organisationName) || !name(value.legalBusinessName)))
    )
      throw new AppError("cloud.unavailable", {});
    Object.assign(view, {
      organisationId: value.organisationId,
      legalBusinessId: value.legalBusinessId,
      ...(name(value.organisationName) ? { organisationName: value.organisationName } : {}),
      ...(name(value.legalBusinessName) ? { legalBusinessName: value.legalBusinessName } : {}),
    });
  }
  if (view.state === "complete") {
    const r = value.registration;
    if (
      !record(r) ||
      !uuid(r.venueId) ||
      (state.venueId !== "" && r.venueId !== state.venueId) ||
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
async function readPrivateCloudState(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) !== 0)
    throw new AppError("cloud.state_invalid", {});
  return JSON.parse(await readFile(path, "utf8"));
}

// Start again already owns the venue folder. Keep the configured key and remove the setup draft
// before deleting the abandoned attempt.
export async function discardHeldSetupAdmin(stateDir: string): Promise<void> {
  const path = join(stateDir, CLOUD_CONNECTION_FILE);
  const state = await readPrivateCloudState(path).catch(() => undefined);
  if (!record(state) || state.version !== 4 || !Object.hasOwn(state, "setupAdmin")) return;
  delete state.setupAdmin;
  await writeFileDurable(path, JSON.stringify(state), 0o600);
}

const connectionTurns = new Map<string | symbol, Promise<void>>();
/** One server process owns a node state directory. */
export function createCloudConnection(options: CloudConnectionOptions) {
  const path = join(resolve(options.stateDir), CLOUD_CONNECTION_FILE);
  let heldEmergencyHints: SavedEmergencyHints | undefined;
  function readHints(state: SavedCloudState): SavedEmergencyHints | undefined {
    const value = state.emergencyHints;
    const registration = registrationOf(state);
    if (!registration || !record(value)) return undefined;
    if (
      Object.keys(value).length !== 5 ||
      value.registration !== registration ||
      typeof value.staffOrigin !== "string" ||
      value.staffOrigin.length > 2048 ||
      typeof value.open !== "boolean" ||
      !instant(value.asOf) ||
      (value.open && value.address === null) ||
      (value.address !== null &&
        !validEmergencyAddress(value.address, options.origin, value.staffOrigin))
    )
      return undefined;
    try {
      const origin = new URL(value.staffOrigin);
      if (origin.origin !== value.staffOrigin || !["https:", "http:"].includes(origin.protocol))
        return undefined;
    } catch {
      return undefined;
    }
    return value as unknown as SavedEmergencyHints;
  }
  function cleanHints(state: SavedCloudState) {
    const hints = readHints(state);
    if (hints) state.emergencyHints = hints;
    else delete state.emergencyHints;
    return hints;
  }
  async function readState(): Promise<SavedCloudState | CloudSignInState | undefined> {
    try {
      const value = await readPrivateCloudState(path);
      if (record(value) && value.version === 1) {
        heldEmergencyHints = undefined;
        return undefined;
      }
      if (
        !record(value) ||
        value.origin !== options.origin ||
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
      if (value.version === 4) {
        if (options.environment !== "test") throw new Error();
        heldEmergencyHints = undefined;
        const attempt = readCloudSignInAttempt(value.attempt);
        const setupAdmin = readHeldSetupAdmin(value.setupAdmin);
        return {
          version: 4,
          origin: options.origin,
          privateKey: value.privateKey,
          publicKey: value.publicKey,
          ...(attempt ? { attempt } : {}),
          ...(setupAdmin ? { setupAdmin } : {}),
        };
      }
      const venueId = await options.readVenueId();
      if (
        value.version !== 2 ||
        (value.venueId !== "" && !uuid(value.venueId)) ||
        (venueId !== null && value.venueId !== "" && value.venueId !== venueId) ||
        value.environment !== options.environment ||
        (value.emailRelayEnabled !== undefined && typeof value.emailRelayEnabled !== "boolean") ||
        (value.remoteAccessEnabled !== undefined &&
          typeof value.remoteAccessEnabled !== "boolean") ||
        !uuid(value.requestId) ||
        (value.signedIn === true
          ? value.code !== "" || options.environment !== "test"
          : value.signedIn !== undefined ||
            typeof value.code !== "string" ||
            !/^\d{8}$/.test(value.code))
      )
        throw new Error();
      const state = value as unknown as SavedCloudState;
      if (state.view !== undefined) state.view = readView(state.view, state);
      if (state.venueId === "" && venueId !== null) state.venueId = venueId;
      if (state.lifecycle !== undefined)
        state.lifecycle = readCloudInstallation(state.lifecycle, state);
      if (venueId === null && state.venueId !== "") {
        heldEmergencyHints = undefined;
        return undefined;
      }
      heldEmergencyHints = cleanHints(state);
      return state;
    } catch (error) {
      heldEmergencyHints = undefined;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw new AppError("cloud.state_invalid", {});
    }
  }
  async function read(): Promise<SavedCloudState | undefined> {
    const state = await readState();
    return state?.version === 2 ? state : undefined;
  }
  async function writeState(state: SavedCloudState | CloudSignInState) {
    await mkdirDurable(join(options.stateDir, CLOUD_DIR), 0o700);
    await writeFileDurable(path, JSON.stringify(state), 0o600);
  }
  async function save(state: SavedCloudState, optionalHints = false) {
    const venueId = state.view?.registration?.venueId;
    if (venueId) {
      const heldId = await options.readVenueId();
      if (heldId !== null && heldId !== venueId) throw new AppError("cloud.binding_conflict", {});
      if (heldId === null) await options.recordVenueId(venueId);
      state.venueId = venueId;
    }
    cleanHints(state);
    if (state.emergencyHints && Buffer.byteLength(JSON.stringify(state)) > 65536)
      delete state.emergencyHints;
    try {
      await writeState(state);
    } catch (error) {
      // Optional entrance hints must not turn a successful Cloud read into a storage failure.
      if (!optionalHints) throw error;
      options.onEmergencyHintsError?.(error);
      return;
    }
    heldEmergencyHints = state.emergencyHints;
  }
  function project(state: SavedCloudState | undefined): CloudConnectionStatus {
    if (!state) return { state: "not_connected", code: "", signupUrl: `${options.origin}/signup` };
    const installation = projectCloudInstallation(state);
    const remoteAccessEnabled = state.remoteAccessEnabled !== false;
    const planRequired =
      remoteAccessEnabled &&
      installation?.state === "active" &&
      state.lifecycle?.tunnelPlanRequired &&
      state.lifecycle.pending?.action !== "revoke" &&
      !installation.services.some(
        (s) => s.service === "remote_access" && s.state !== "unconfigured",
      );
    return {
      state: "awaiting_cloud",
      requestId: state.requestId,
      environment: state.environment,
      ...state.view,
      venueId: state.venueId,
      code: state.view?.state === "complete" ? "" : state.code,
      ...(state.signedIn
        ? {}
        : {
            openCloudUrl: `${options.origin}/connect#request=${state.requestId}${(state.view?.state ?? "awaiting_cloud") === "awaiting_cloud" ? `&code=${state.code}` : ""}`,
          }),
      ...(state.view?.registration
        ? {
            installation,
            remoteAccessEnabled,
            ...(planRequired ? { remoteAccessPlanRequired: true } : {}),
            ...(state.lifecycle?.revoked ? {} : { accountUrl: `${options.origin}/account` }),
          }
        : { signupUrl: `${options.origin}/signup` }),
    };
  }
  async function exchange(
    state: SavedCloudState,
    action: "start" | "status" | "complete",
    choice?: CloudChoice,
  ): Promise<CloudPairingView> {
    // Read before stamping issuedAt: a slow read must not age the proof past Cloud's 60-second window.
    const venueName = action === "start" ? pairingVenueName(await options.readVenueName()) : "";
    const bytes = pairingPayload({
      origin: state.origin,
      action,
      requestId: state.requestId,
      publicKey: state.publicKey,
      venueId: state.view?.venueId ?? state.venueId,
      environment: state.environment,
      code: action === "start" ? state.code : "",
      organisationId: choice?.organisationId ?? "",
      legalBusinessId: choice?.legalBusinessId ?? "",
      issuedAt: Date.now(),
      venueName,
    });
    return requestPairing(action, bytes, state.privateKey, (value) => readView(value, state));
  }
  function exchangeSignIn(
    state: CloudSignInState,
    attempt: NonNullable<CloudSignInState["attempt"]>,
    operation: PairingV4Operation,
  ) {
    const encode =
      attempt.kind === "setup" || attempt.resumeSetup ? pairingV5Payload : pairingV4Payload;
    const bytes = encode({
      ...operation,
      origin: state.origin,
      publicKey: state.publicKey,
      requestId: attempt.requestId,
      issuedAt: Date.now(),
    });
    return requestPairing(
      operation.action,
      bytes,
      state.privateKey,
      (value) => readCloudSignInReply(value, state.origin, attempt, operation),
      true,
    );
  }
  async function requestPairing<T>(
    action: string,
    bytes: Buffer,
    privateKey: string,
    readReply: (value: unknown) => T,
    signIn = false,
  ): Promise<T> {
    const signature = signCloudPayload(bytes, privateKey);
    try {
      const response = await fetch(`${options.origin}/api/pairing/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: bytes.toString("base64url"), signature }),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      const replyBytes = await readCloudResponseBytes(response, 16384);
      const value: unknown = JSON.parse(replyBytes.toString());
      if (!response.ok) {
        if (record(value)) {
          if (value.error === "pairing_unavailable")
            throw new AppError("cloud.request_unavailable", {});
          if (
            signIn &&
            (value.error === "business_match_ambiguous" || value.error === "binding_conflict")
          )
            throw new AppError("cloud.binding_conflict", {});
        }
        throw new Error();
      }
      return readReply(value);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("cloud.unavailable", {});
    }
  }
  async function run<T>(
    work: () => Promise<T>,
    wait = false,
    signal?: AbortSignal,
    key: string | symbol = path,
  ) {
    while (connectionTurns.has(key)) {
      if (!wait) throw new AppError("cloud.busy", {});
      signal?.throwIfAborted();
      const active = connectionTurns.get(key)!;
      if (signal) {
        let remove = () => {};
        try {
          await Promise.race([
            active,
            new Promise<never>((_resolve, reject) => {
              const abort = () => reject(signal.reason);
              signal.addEventListener("abort", abort, { once: true });
              remove = () => signal.removeEventListener("abort", abort);
            }),
          ]);
        } finally {
          remove();
        }
      } else await active;
    }
    signal?.throwIfAborted();
    let release = () => {};
    connectionTurns.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      return await work();
    } finally {
      connectionTurns.delete(key);
      release();
    }
  }
  async function signInState() {
    if (!options.signIn || options.environment !== "test")
      throw new AppError("cloud.not_configured", {});
    const state = await readState();
    if (!state) throw new AppError("cloud.not_configured", {});
    if (state.version !== 4) throw new AppError("cloud.binding_conflict", {});
    return state;
  }
  function sameBinding(attempt: CloudSignInBinding, binding: CloudSignInBinding) {
    return (
      attempt.kind === binding.kind &&
      attempt.tab === binding.tab &&
      attempt.session === hashSessionToken(binding.session)
    );
  }
  async function liveSetupAdmin(state: CloudSignInState, saveInProgress = false) {
    const held = state.setupAdmin;
    if (held && held.expiresAt <= Date.now() && !saveInProgress) {
      delete state.setupAdmin;
      await writeState(state);
      return;
    }
    return held;
  }
  async function setupAddressAttempt(binding: CloudSignInBinding) {
    if (options.signIn?.setup !== true) return;
    const state = await signInState();
    return provisionalSetupAttempt(state, binding);
  }
  function provisionalSetupAttempt(state: CloudSignInState, binding: CloudSignInBinding) {
    const attempt = state.attempt;
    if (
      attempt?.kind === "setup" &&
      attempt.phase === "account_bound" &&
      attempt.provisionalRegistration &&
      !attempt.publishedNodeId &&
      sameBinding(attempt, binding) &&
      Date.parse(attempt.expiresAt) > Date.now()
    )
      return { state, attempt, registration: attempt.provisionalRegistration };
  }
  // An address lookup never holds the connection turn used by Provision.
  const setupAddressTurn = Symbol();
  let setupServiceLease:
    { requestId: string; credentials: CloudInstallationCredentials } | undefined;

  function setupServiceAccess(
    state: CloudSignInState,
    attempt: { requestId: string },
    registration: CloudRegistration,
  ) {
    if (setupServiceLease?.requestId !== attempt.requestId) {
      const { origin, publicKey, privateKey } = state;
      setupServiceLease = {
        requestId: attempt.requestId,
        credentials: { origin, publicKey, privateKey, environment: "test", view: { registration } },
      };
    }
    return setupServiceLease;
  }

  async function bindSetupAccount(
    state: CloudSignInState,
    attempt: NonNullable<CloudSignInState["attempt"]>,
    reply: Awaited<ReturnType<typeof exchangeSignIn>>,
    authorize: () => Promise<void>,
  ) {
    if (reply.state !== "account_bound") throw new AppError("cloud.request_unavailable", {});
    await authorize();
    attempt.phase = "account_bound";
    attempt.expiresAt = reply.expiresAt;
    if (reply.provisionalRegistration)
      attempt.provisionalRegistration = reply.provisionalRegistration;
    await writeState(state);
  }
  async function finishSignIn(
    state: CloudSignInState,
    requestId: string,
    reply: { registration: CloudRegistration; expiresAt: string },
    authorize: () => Promise<void>,
  ) {
    await authorize();
    const { registration, expiresAt } = reply;
    await save({
      version: 2,
      signedIn: true,
      ...(state.attempt?.emailRelayEnabled && { emailRelayEnabled: true }),
      origin: state.origin,
      privateKey: state.privateKey,
      publicKey: state.publicKey,
      environment: "test",
      venueId: registration.venueId,
      requestId,
      code: "",
      view: {
        state: "complete",
        environment: "test",
        requestId,
        expiresAt,
        registration,
        venueId: registration.venueId,
        organisationId: registration.organisationId,
        legalBusinessId: registration.legalBusinessId,
      },
    });
  }
  async function completeSignIn(
    state: CloudSignInState,
    attempt: NonNullable<CloudSignInState["attempt"]>,
    bound: { expiresAt: string; provisionalRegistration?: CloudRegistration },
    authorize: () => Promise<void>,
  ) {
    await authorize();
    attempt.phase = "account_bound";
    attempt.expiresAt = bound.expiresAt;
    attempt.provisionalRegistration ??= bound.provisionalRegistration;
    const profile = attempt.profile ?? (await options.signIn!.readProfile());
    if (!isPairingV4Profile(profile)) throw new AppError("cloud.request_invalid", {});
    attempt.profile = profile;
    await writeState(state);
    await authorize();
    const reply = await exchangeSignIn(state, attempt, {
      action: "complete",
      args: attempt.profile,
    });
    if (reply.state !== "complete") throw new AppError("cloud.unavailable", {});
    await finishSignIn(state, attempt.requestId, reply, authorize);
  }
  async function recoverSignIn(
    state: CloudSignInState,
    attempt: NonNullable<CloudSignInState["attempt"]>,
    authorize: () => Promise<void>,
    ownAttempt = true,
  ) {
    const reply = await exchangeSignIn(state, attempt, { action: "status", args: [] });
    if (reply.state === "complete") await finishSignIn(state, attempt.requestId, reply, authorize);
    else {
      if (!ownAttempt) throw new AppError("cloud.binding_conflict", {});
      if (reply.state !== "account_bound") return false;
      await completeSignIn(state, attempt, reply, authorize);
    }
    return true;
  }
  async function captureState(signal?: AbortSignal) {
    const state = await read();
    if (!state?.view?.registration || state.environment !== "test" || state.lifecycle?.revoked)
      throw new AppError("cloud.binding_conflict", {});
    await installationClient(state, save).refresh(signal);
    if (state.lifecycle?.revoked) throw new AppError("cloud.binding_conflict", {});
    return state;
  }
  // Holds the shared lock only to renew the lease, never across a translation exchange, so a
  // refresh or report is not refused `cloud.busy` while one waits on Cloud.
  async function leaseState(signal?: AbortSignal): Promise<SavedCloudState> {
    const current = await read();
    if (current && hasLiveLease(current)) return current;
    try {
      return await run(
        async () => {
          const state = await read();
          if (!state?.view?.registration || state.lifecycle?.revoked)
            throw new AppError("cloud.not_configured", {});
          await installationClient(state, save).ensureLease(signal);
          return state;
        },
        true,
        signal,
      );
    } catch (error) {
      if (error instanceof AppError || !signal?.aborted) throw error;
      throw new AppError("cloud.unavailable", {});
    }
  }
  // A refresh can renew the lease while a call waits on Cloud; dropping that fresh lease on the
  // old one's invalid_proof would only force another renewal. The connection can also be paired
  // again meanwhile, and the old installation's refusal says nothing about the new one.
  const recordRefusal: OnRefusal = (refusal, used, publicKey) =>
    run(async () => {
      const state = await read();
      if (!state?.lifecycle || state.publicKey !== publicKey) return;
      const c = state.lifecycle;
      if (refusal === "revoked") markRevoked(c);
      else if (JSON.stringify(c.lease) === used) delete c.lease;
      else return;
      await save(state);
    }, true);
  async function ownerRecovery(
    authorize: () => Promise<string>,
    decision: { action: "approve" | "refuse"; request: unknown } | undefined,
    signal?: AbortSignal,
  ) {
    const binding = ownerRecoveryBinding(await read());
    const deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    await leaseState(deadline);
    const actor = await authorize();
    const state = await read();
    if (ownerRecoveryBinding(state) !== binding) throw new AppError("cloud.binding_conflict", {});
    const result = await fetchOwnerRecovery(state!, actor, decision, deadline, recordRefusal);
    // A confirmed decision has taken effect; a later authority change cannot withdraw it.
    if (
      !decision &&
      ((await authorize()) !== actor || ownerRecoveryBinding(await read()) !== binding)
    )
      throw new AppError("cloud.binding_conflict", {});
    return result;
  }
  // Cloud's billing contract allows one read a minute across every dashboard (Retry-After may ask
  // for longer) and no snapshot on disk, so the last read and its outcome live here, per registration.
  let billingRead:
    { registration: string; notBefore: number; outcome: Promise<BillingDisplay> } | undefined;
  const registrationOf = (state: SavedCloudState | undefined) =>
    state?.view?.registration && !state.lifecycle?.revoked
      ? `${state.publicKey} ${state.view.registration.installationId}`
      : undefined;
  let emergencyRead:
    | {
        registration: string;
        staffOrigin: string;
        notBefore: number;
        outcome: Promise<EmergencyDisplay>;
      }
    | undefined;
  let emergencyFacts: { registration: string; display: EmergencyDisplay } | undefined;
  return {
    async setupSignInAvailable() {
      return options.signIn?.setup === true && (await readState())?.version === 4;
    },
    async setupAddressLookup(
      binding: CloudSignInBinding,
      input: Parameters<typeof fetchSetupAddress>[1] | undefined,
      authorize: () => Promise<void>,
      signal: AbortSignal,
    ) {
      if (input === undefined) return { available: !!(await setupAddressAttempt(binding)) };
      const access = await run(
        async () => {
          const held = await setupAddressAttempt(binding);
          if (!held) throw new AppError("cloud.request_unavailable", {});
          const access = setupServiceAccess(held.state, held.attempt, held.registration);
          await installationClient(access.credentials, async () => {}).ensureLease(signal);
          return access;
        },
        true,
        signal,
        setupAddressTurn,
      ).catch((error: unknown) => {
        if (error instanceof AppError || !signal.aborted) throw error;
        throw new AppError("cloud.unavailable", {});
      });
      await authorize();
      const held = await setupAddressAttempt(binding);
      if (held?.attempt.requestId !== access.requestId)
        throw new AppError("cloud.request_unavailable", {});
      return fetchSetupAddress(access.credentials, input, signal);
    },
    async publishSetupSignIn(binding: CloudSignInBinding, nodeId: string, staffEmail?: true) {
      return run(async () => {
        const state = await readState();
        if (state?.version !== 4 || options.signIn?.setup !== true) return;
        const attempt = state.attempt;
        if (
          attempt?.kind !== "setup" ||
          attempt.phase !== "account_bound" ||
          !sameBinding(attempt, binding) ||
          Date.parse(attempt.expiresAt) <= Date.now()
        )
          return;
        if (!attempt.publishedNodeId && staffEmail) {
          const held = provisionalSetupAttempt(state, binding);
          if (held) {
            const { credentials: cached } = setupServiceAccess(state, attempt, held.registration);
            // Reuse a live lease without sharing an address search's pending renewal.
            const credentials = {
              ...cached,
              lifecycle: hasLiveLease(cached) ? structuredClone(cached.lifecycle) : undefined,
            };
            try {
              const signal = AbortSignal.timeout(8000);
              await installationClient(credentials, async () => {}).ensureLease(signal);
              if (await requestSetupCloudEmailGrant(credentials, attempt.requestId, signal))
                attempt.emailRelayEnabled = true;
            } catch {
              // A grant refusal must still let setup record the venue for publishing.
            }
          }
        }
        if (!attempt.publishedNodeId) {
          attempt.publishedNodeId = nodeId;
          await writeState(state);
        }
        return staffEmail ? attempt.emailRelayEnabled === true : undefined;
      });
    },
    async readSetupAdmin(binding: CloudSignInBinding, saveInProgress: boolean) {
      return run(async () => {
        const state = await signInState();
        const held = await liveSetupAdmin(state, saveInProgress);
        if (!held || !sameBinding(held, binding))
          throw new AppError("cloud.request_unavailable", {});
        return held.admin;
      });
    },
    async clearSetupAdmin() {
      return run(async () => {
        const state = await readState();
        if (state?.version !== 4 || !state.setupAdmin) return;
        delete state.setupAdmin;
        await writeState(state);
      });
    },
    async startSignIn(
      binding: CloudSignInBinding,
      authorize: () => Promise<void>,
      prepareAdmin?: (saved: PreparedSetupAdmin | undefined) => PreparedSetupAdmin,
    ) {
      return run(async () => {
        const state = await signInState();
        let attempt = state.attempt;
        await authorize();
        const setup = binding.kind === "setup";
        if (setup !== (options.signIn!.setup === true))
          throw new AppError("cloud.binding_conflict", {});
        if (setup && prepareAdmin) {
          const held = await liveSetupAdmin(state);
          if (
            attempt &&
            Date.parse(attempt.expiresAt) > Date.now() &&
            !sameBinding(attempt, binding)
          )
            throw new AppError("cloud.binding_conflict", {});
          const previous = held && sameBinding(held, binding) ? held.admin : undefined;
          state.setupAdmin = {
            kind: "setup",
            tab: binding.tab,
            session: hashSessionToken(binding.session),
            expiresAt: Date.now() + 43_800_000,
            admin: prepareAdmin(previous),
          };
          await authorize();
          await writeState(state);
        }
        const resumeSetup =
          !setup &&
          (attempt?.resumeSetup ||
            (attempt?.kind === "setup" && attempt.phase !== "awaiting_cloud"));
        const provisionalRegistration = resumeSetup ? attempt?.provisionalRegistration : undefined;
        const emailRelayEnabled = resumeSetup ? attempt?.emailRelayEnabled : undefined;
        if (attempt && attempt.kind !== binding.kind) {
          if (setup) throw new AppError("cloud.binding_conflict", {});
          try {
            if (
              attempt.publishedNodeId &&
              attempt.publishedNodeId === options.signIn?.currentNodeId?.() &&
              Date.parse(attempt.expiresAt) > Date.now()
            ) {
              if (await recoverSignIn(state, attempt, authorize)) return {};
            } else if (attempt.profile) {
              // Cloud can confirm a filed registration after the sign-in expires.
              const reply = await exchangeSignIn(state, attempt, { action: "status", args: [] });
              if (reply.state === "complete") {
                await finishSignIn(state, attempt.requestId, reply, authorize);
                return {};
              }
            }
          } catch (error) {
            if (!(error instanceof AppError) || error.code !== "cloud.request_unavailable")
              throw error;
          }
          attempt = undefined;
        }
        if (
          setup &&
          attempt &&
          attempt.phase !== "awaiting_cloud" &&
          Date.parse(attempt.expiresAt) > Date.now()
        ) {
          if (!sameBinding(attempt, binding)) throw new AppError("cloud.binding_conflict", {});
          if (attempt.phase === "account_bound") return {};
          const reply = await exchangeSignIn(state, attempt, { action: "status", args: [] });
          if (reply.state === "account_bound") {
            await bindSetupAccount(state, attempt, reply, authorize);
            return {};
          }
        }
        if (!setup && attempt && attempt.phase !== "awaiting_cloud") {
          const ownAttempt = sameBinding(attempt, binding);
          const otherActiveAttempt = !ownAttempt && Date.parse(attempt.expiresAt) > Date.now();
          if (otherActiveAttempt && attempt.phase !== "account_bound")
            throw new AppError("cloud.binding_conflict", {});
          try {
            if (await recoverSignIn(state, attempt, authorize, ownAttempt)) return {};
          } catch (error) {
            if (!(error instanceof AppError) || error.code !== "cloud.request_unavailable")
              throw error;
            if (otherActiveAttempt) throw new AppError("cloud.binding_conflict", {});
            attempt = undefined;
          }
        }
        if (!setup && (await options.readVenueId()))
          throw new AppError("cloud.binding_conflict", {});
        if (attempt && Date.parse(attempt.expiresAt) > Date.now()) {
          if (!sameBinding(attempt, binding)) throw new AppError("cloud.binding_conflict", {});
        } else {
          attempt = newCloudSignInAttempt({
            tab: binding.tab,
            session: hashSessionToken(binding.session),
            ...(setup && { kind: "setup" as const }),
            ...(resumeSetup && { resumeSetup: true, provisionalRegistration, emailRelayEnabled }),
          });
          state.attempt = attempt;
          await writeState(state);
        }
        const result = await exchangeSignIn(state, attempt, {
          action: "start",
          args: [options.signIn!.callback, attempt.state, cloudSignInChallenge(attempt.verifier)],
        });
        attempt.expiresAt = result.expiresAt;
        await writeState(state);
        return { authorizationUrl: result.authorizationUrl };
      });
    },
    async returnSignIn(
      binding: CloudSignInBinding,
      input: CloudSignInReturn,
      authorize: () => Promise<void>,
    ) {
      return run(async () => {
        const state = await signInState();
        const attempt = state.attempt;
        if (
          !attempt ||
          (binding.kind === "setup") !== (options.signIn!.setup === true) ||
          !sameBinding(attempt, binding) ||
          attempt.requestId !== input.requestId ||
          attempt.state !== input.state
        )
          throw new AppError("cloud.binding_conflict", {});
        await authorize();
        if ("error" in input) {
          if (attempt.phase === "awaiting_cloud") {
            // A cancelled login can leave the original placeholder behind.
            if (attempt.resumeSetup) attempt.expiresAt = new Date(0).toISOString();
            else delete state.attempt;
            await writeState(state);
          }
          throw new AppError("cloud.request_unavailable", {});
        }
        if (
          attempt.resumeSetup &&
          attempt.phase === "awaiting_cloud" &&
          Date.parse(attempt.expiresAt) <= Date.now()
        )
          throw new AppError("cloud.binding_conflict", {});
        if (attempt.phase !== "awaiting_cloud") {
          if (attempt.kind === "setup") {
            if (attempt.phase === "account_bound") return;
            const reply = await exchangeSignIn(state, attempt, { action: "status", args: [] });
            if (reply.state === "account_bound") {
              await bindSetupAccount(state, attempt, reply, authorize);
              return;
            }
          } else if (await recoverSignIn(state, attempt, authorize)) return;
        }
        attempt.phase = "redeeming";
        await writeState(state);
        await authorize();
        const reply = await exchangeSignIn(state, attempt, {
          action: "redeem",
          args: [input.code, attempt.verifier],
        });
        if (attempt.kind === "setup") {
          await bindSetupAccount(state, attempt, reply, authorize);
        } else {
          if (reply.state !== "account_bound") throw new AppError("cloud.request_unavailable", {});
          await completeSignIn(state, attempt, reply, authorize);
        }
      });
    },
    async emailRelayEnabled() {
      const state = await read();
      return state?.environment === "test" && state.emailRelayEnabled === true;
    },
    async emailRelay(signal?: AbortSignal) {
      const before = await read();
      if (!before?.view?.registration || before.environment !== "test") return null;
      let grant: CloudEmailGrant | null;
      let used: SavedCloudState;
      try {
        used = await leaseState(signal);
        grant = await fetchCloudEmailGrant(used, signal, options.managementOrigin, recordRefusal);
      } catch (error) {
        if ((await read())?.emailRelayEnabled) throw error;
        return null;
      }
      await run(
        async () => {
          const latest = await read();
          if (!latest || registrationOf(latest) !== registrationOf(used))
            throw new AppError("cloud.unavailable", {});
          if (latest.emailRelayEnabled !== (grant !== null)) {
            latest.emailRelayEnabled = grant !== null;
            await save(latest);
          }
        },
        true,
        signal,
      );
      return grant;
    },
    async sendEmail(grant: CloudEmailGrant, id: string, message: CloudEmail, signal?: AbortSignal) {
      let state: SavedCloudState;
      try {
        state = await leaseState(signal);
      } catch {
        return {
          status: "rejected" as const,
          failureCode: "mail.relay_refused" as const,
          serverRefused: true as const,
        };
      }
      return sendCloudEmail(state, grant, id, message, signal);
    },
    emergencyHints(staffOrigin: string): { address: string } | null {
      const hints = heldEmergencyHints;
      return hints?.staffOrigin === staffOrigin && hints.open && hints.address !== null
        ? { address: hints.address }
        : null;
    },
    async emergencyCode(staffOrigin: string, signal?: AbortSignal) {
      const state = await leaseState(),
        registration = registrationOf(state);
      const code = await fetchEmergencyCode(state, staffOrigin, {
        signal,
        onRefusal: recordRefusal,
      });
      if (!registration || registrationOf(await read()) !== registration)
        throw new AppError("cloud.unavailable", {});
      return code;
    },
    async emergency(
      staffOrigin: string,
      signal?: AbortSignal,
    ): Promise<EmergencyDisplay & { stale: boolean }> {
      const registration = registrationOf(await read());
      if (emergencyFacts?.registration !== registration) emergencyFacts = undefined;
      if (!registration) throw new AppError("cloud.not_configured", {});
      const startedAt = Date.now();
      if (
        !emergencyRead ||
        emergencyRead.registration !== registration ||
        emergencyRead.staffOrigin !== staffOrigin ||
        startedAt >= emergencyRead.notBefore
      ) {
        let sentAt: number | undefined;
        const outcome = (async () => {
          const state = await leaseState();
          if (registrationOf(state) !== registration) throw new AppError("cloud.unavailable", {});
          sentAt = Date.now();
          return fetchEmergencyDisplay(state, staffOrigin, { onRefusal: recordRefusal });
        })();
        const entry = { registration, staffOrigin, notBefore: Infinity, outcome };
        emergencyRead = entry;
        const settle = (error?: BillingRefusal) => {
          entry.notBefore = Math.max(
            (sentAt ?? startedAt) + 60000,
            error?.retryAfterMs ? Date.now() + Math.min(error.retryAfterMs, 3600000) : 0,
          );
        };
        outcome.then(() => settle(), settle);
      }
      const entry = emergencyRead;
      let display: EmergencyDisplay | undefined;
      let remove = () => {};
      try {
        display = await (signal
          ? Promise.race([
              entry.outcome,
              new Promise<never>((_resolve, reject) => {
                const abort = () => reject(new AppError("cloud.unavailable", {}));
                if (signal.aborted) abort();
                else signal.addEventListener("abort", abort, { once: true });
                remove = () => signal.removeEventListener("abort", abort);
              }),
            ])
          : entry.outcome);
      } catch (error) {
        if (signal?.aborted || !(error instanceof AppError) || error.code !== "cloud.unavailable")
          throw error;
      } finally {
        remove();
      }
      const current = registrationOf(await read());
      if (current !== registration) {
        emergencyFacts = undefined;
        throw new AppError(current ? "cloud.unavailable" : "cloud.not_configured", {});
      }
      if (
        display &&
        heldEmergencyHints?.staffOrigin === staffOrigin &&
        display.asOf < heldEmergencyHints.asOf
      )
        display = undefined;
      if (
        display?.emergency.status === "ready" &&
        emergencyRead === entry &&
        (!emergencyFacts || display.asOf >= emergencyFacts.display.asOf)
      ) {
        emergencyFacts = { registration, display };
        const hints: SavedEmergencyHints = {
          registration,
          staffOrigin,
          address: display.emergency.address,
          open: display.emergency.open,
          asOf: display.asOf,
        };
        const changed = (previous: SavedEmergencyHints | undefined) =>
          !previous ||
          previous.registration !== registration ||
          previous.staffOrigin !== staffOrigin ||
          previous.address !== hints.address ||
          previous.open !== hints.open;
        if (changed(heldEmergencyHints)) {
          try {
            await run(
              async () => {
                const state = await read(),
                  current = registrationOf(state);
                if (!state || current !== registration)
                  throw new AppError(current ? "cloud.unavailable" : "cloud.not_configured", {});
                if (emergencyRead !== entry) return;
                if (changed(state.emergencyHints)) {
                  state.emergencyHints = hints;
                  await save(state, true);
                }
              },
              true,
              signal,
            );
          } catch (error) {
            if (signal?.aborted) throw new AppError("cloud.unavailable", {});
            throw error;
          }
        }
        return { ...display, stale: false };
      }
      if (emergencyFacts) return { ...emergencyFacts.display, stale: true };
      if (display) return { ...display, stale: false };
      throw new AppError("cloud.unavailable", {});
    },
    async setRemoteAccess(enabled: boolean, authorize: () => Promise<void>) {
      return run(async () => {
        const state = await read();
        if (
          !state?.view?.registration ||
          state.lifecycle?.revoked ||
          (enabled && state.lifecycle?.pending?.action === "revoke")
        )
          throw new AppError("cloud.not_configured", {});
        await authorize();
        state.remoteAccessEnabled = enabled;
        await save(state);
        try {
          await writeTunnelConfiguration(options.tunnelDir, state);
        } catch (error) {
          if (enabled) {
            state.remoteAccessEnabled = false;
            await save(state);
          }
          throw error;
        }
        return project(state);
      }, true);
    },
    ownerRecoveryRead: (authorize: () => Promise<string>, signal?: AbortSignal) =>
      ownerRecovery(authorize, undefined, signal),
    ownerRecoveryDecide: (
      action: "approve" | "refuse",
      request: unknown,
      authorize: () => Promise<string>,
      signal?: AbortSignal,
    ) => ownerRecovery(authorize, { action, request }, signal),
    async errorReportRegistration(): Promise<string | undefined> {
      return registrationOf(await read());
    },
    async sendErrorReport(
      registration: string,
      operationId: string,
      body: string,
      signal?: AbortSignal,
    ): Promise<void> {
      const state = await leaseState(signal);
      if (registrationOf(state) !== registration || signal?.aborted)
        throw new AppError("cloud.unavailable", {});
      const reply = await serviceExchange(
        state,
        "error-report",
        operationId,
        body,
        {},
        signal,
        recordRefusal,
        {
          requireVersion: false,
          refusal: (status, value) =>
            status === 409 ? new AppError("cloud.unavailable", {}) : refusalOf(status, value),
        },
      );
      if (reply.accepted !== true || Object.keys(reply).length !== 1)
        throw new AppError("cloud.unavailable", {});
    },
    async guestMenuStatus(signal?: AbortSignal) {
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      return fetchGuestMenuStatus(await leaseState(deadline), deadline, recordRefusal);
    },
    async publishGuestMenu(expectedRevision: number, body: string, signal?: AbortSignal) {
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000);
      return publishCloudGuestMenu(
        await leaseState(deadline),
        expectedRevision,
        body,
        deadline,
        recordRefusal,
      );
    },
    async withdrawGuestMenu(signal?: AbortSignal) {
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      return withdrawCloudGuestMenu(await leaseState(deadline), deadline, recordRefusal);
    },
    async staffAdmitted(): Promise<boolean> {
      return staffHostnameFrom(await read()) !== undefined;
    },
    async staffCertificate(signal?: AbortSignal): Promise<boolean> {
      if (staffHostnameFrom(await read()) === undefined) return false;
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000);
      const state = await leaseState(deadline);
      const registration = registrationOf(state),
        hostname = staffHostnameFrom(state);
      return refreshStaffCertificate(state, options.stateDir, deadline, recordRefusal, async () => {
        const current = await read();
        return registrationOf(current) === registration && staffHostnameFrom(current) === hostname;
      });
    },
    async billing(signal?: AbortSignal): Promise<BillingDisplay> {
      const registration = registrationOf(await read());
      if (!registration) throw new AppError("cloud.not_configured", {});
      const startedAt = Date.now();
      if (
        !billingRead ||
        billingRead.registration !== registration ||
        startedAt >= billingRead.notBefore
      ) {
        let sentAt: number | undefined;
        // Bound only by the read's own limit: one caller leaving must not fail it for the others.
        const outcome = (async () => {
          const state = await leaseState();
          if (registrationOf(state) !== registration) throw new AppError("cloud.unavailable", {});
          sentAt = Date.now();
          return fetchBillingDisplay(state, { onRefusal: recordRefusal });
        })();
        // Shared until it settles, however long the lease renewal before it takes.
        const entry = { registration, notBefore: Infinity, outcome };
        billingRead = entry;
        // The minute counts from the read Cloud received, and a 429's wait from its arrival.
        const settle = (error?: BillingRefusal) => {
          entry.notBefore =
            sentAt === undefined
              ? startedAt + 60_000
              : Math.max(
                  sentAt + 60_000,
                  error?.retryAfterMs ? Date.now() + Math.min(error.retryAfterMs, 3_600_000) : 0,
                );
        };
        outcome.then(() => settle(), settle);
      }
      const { outcome } = billingRead;
      let display: BillingDisplay;
      if (signal) {
        let remove = () => {};
        try {
          display = await Promise.race([
            outcome,
            new Promise<never>((_resolve, reject) => {
              const abort = () => reject(new AppError("cloud.unavailable", {}));
              if (signal.aborted) abort();
              signal.addEventListener("abort", abort, { once: true });
              remove = () => signal.removeEventListener("abort", abort);
            }),
          ]);
        } finally {
          remove();
        }
      } else display = await outcome;
      const now = registrationOf(await read());
      if (now !== registration)
        throw new AppError(now ? "cloud.unavailable" : "cloud.not_configured", {});
      return display;
    },
    translation: {
      submit: async (operationId: string, body: string, signal?: AbortSignal) =>
        submitTranslation(await leaseState(signal), operationId, body, signal, recordRefusal),
      status: async (jobId: string, signal?: AbortSignal) =>
        translationStatus(await leaseState(signal), jobId, signal, recordRefusal),
      collect: async (jobId: string, cursor: number, signal?: AbortSignal) =>
        collectTranslation(await leaseState(signal), jobId, cursor, signal, recordRefusal),
      release: async (jobId: string, signal?: AbortSignal) =>
        releaseTranslation(await leaseState(signal), jobId, signal, recordRefusal),
    },
    async translationService(): Promise<"on" | "off" | "not_connected"> {
      const state = await read();
      if (!state?.view?.registration || state.lifecycle?.revoked) return "not_connected";
      return state.lifecycle?.view?.services.some(
        (s) => s.service === "content_translation" && s.state === "ready",
      )
        ? "on"
        : "off";
    },
    async importReplacement(input: {
      requestId: string;
      privateKey: string;
      publicKey: string;
      expiresAt: string;
      organisationName: string;
      legalBusinessName: string;
      registration: CloudRegistration;
      stopped: boolean;
    }) {
      return run(async () => {
        const existing = await readState();
        if (existing?.version === 4) throw new AppError("cloud.binding_conflict", {});
        if (existing) {
          if (
            existing.requestId !== input.requestId ||
            existing.privateKey !== input.privateKey ||
            existing.publicKey !== input.publicKey ||
            JSON.stringify(existing.view?.registration) !== JSON.stringify(input.registration)
          )
            throw new AppError("cloud.binding_conflict", {});
          const c = (existing.lifecycle ??= { unavailable: false, revoked: false });
          if (input.stopped && !c.revoked && c.pending?.action !== "revoke") {
            c.pending = pendingRequest("revoke");
            await save(existing);
          }
          return project(existing);
        }
        const state: SavedCloudState = {
          version: 2,
          origin: options.origin,
          venueId: (await options.readVenueId()) ?? "",
          environment: options.environment,
          requestId: input.requestId,
          code: "00000000",
          privateKey: input.privateKey,
          publicKey: input.publicKey,
          view: {
            requestId: input.requestId,
            venueId: (await options.readVenueId()) ?? "",
            environment: options.environment,
            expiresAt: input.expiresAt,
            state: "complete",
            organisationId: input.registration.organisationId,
            legalBusinessId: input.registration.legalBusinessId,
            organisationName: input.organisationName,
            legalBusinessName: input.legalBusinessName,
            registration: input.registration,
          },
          ...(input.stopped
            ? {
                lifecycle: {
                  unavailable: false,
                  revoked: false,
                  pending: pendingRequest("revoke"),
                },
              }
            : {}),
        };
        await save(state);
        return project(state);
      });
    },
    async reserveCapture(id: string, signal?: AbortSignal) {
      return run(
        async () => reserveCloudCapture(await captureState(signal), id, signal),
        true,
        signal,
      );
    },
    async publishCapture(id: string, metadata: CloudCaptureMetadata, signal?: AbortSignal) {
      return run(
        async () => publishCloudCapture(await captureState(signal), id, metadata, signal),
        true,
        signal,
      );
    },
    async status(): Promise<CloudConnectionStatus> {
      const state = await readState();
      return state?.version === 4
        ? {
            state: "not_connected" as const,
            code: "",
            ...(options.signIn ? { sameTabSignIn: true as const } : { configured: false as const }),
          }
        : project(state);
    },
    async syncTunnel() {
      return run(async () => {
        let state: SavedCloudState | undefined;
        try {
          state = await read();
        } finally {
          await writeTunnelConfiguration(options.tunnelDir, state);
        }
      }, true);
    },
    async refresh(signal?: AbortSignal) {
      return run(async () => {
        let state: SavedCloudState | undefined;
        try {
          const stored = await readState();
          if (stored?.version === 4) {
            const attempt = stored.attempt;
            if (
              attempt?.kind !== "setup" ||
              !attempt.publishedNodeId ||
              attempt.publishedNodeId !== options.signIn?.currentNodeId?.() ||
              Date.parse(attempt.expiresAt) <= Date.now()
            )
              return project(undefined);
            const authorize = async () => {
              signal?.throwIfAborted();
              if (attempt.publishedNodeId !== options.signIn?.currentNodeId?.())
                throw new AppError("cloud.not_primary", {});
            };
            await authorize();
            await recoverSignIn(stored, attempt, authorize);
            state = await read();
            return project(state);
          }
          state = stored;
          if (!state?.view?.registration) return project(state);
          const client = installationClient(state, save);
          await client.refresh(signal);
          if (
            options.tunnelDir &&
            state.environment === "test" &&
            !state.lifecycle?.revoked &&
            state.remoteAccessEnabled !== false
          ) {
            const peerPublicKey = await readTunnelPublicKey(options.tunnelDir);
            if (peerPublicKey === undefined) return project(state);
            const remote = state.lifecycle?.view?.services.find(
              (s) => s.service === "remote_access",
            );
            if (remote?.configuration.peerPublicKey !== peerPublicKey)
              await client.provisionTunnel(peerPublicKey, signal);
          }
          return project(state);
        } finally {
          await writeTunnelConfiguration(options.tunnelDir, state);
        }
      });
    },
    async revoke(authorize: () => Promise<void>, signal?: AbortSignal) {
      return run(async () => {
        const state = await read();
        if (!state?.view?.registration) throw new AppError("cloud.binding_conflict", {});
        let localFailure: unknown;
        const authorizeStop = async () => {
          await authorize();
          try {
            await writeTunnelConfiguration(options.tunnelDir);
          } catch (error) {
            localFailure = error;
          }
        };
        if (state.lifecycle?.revoked) await authorizeStop();
        else await installationClient(state, save).revoke(authorizeStop, signal);
        state.emailRelayEnabled = false;
        await save(state);
        if (localFailure) throw localFailure;
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
    /** `reconnect` is Connect again: given, a revoked installation is forgotten and paired afresh. */
    async start(restart = false, reconnect?: () => Promise<void>) {
      return run(async () => {
        const saved = await readState();
        if (saved?.version === 4) throw new AppError("cloud.binding_conflict", {});
        let state = saved;
        let remoteAccessOff = false;
        if (reconnect && state) {
          if (state.view?.state !== "complete" || !state.lifecycle?.revoked) return project(state);
          await reconnect();
          remoteAccessOff = state.remoteAccessEnabled === false;
          // Forgotten before the new file is saved: read() takes a file naming a venue id the
          // database no longer holds as not connected, so a crash between pairs afresh.
          await options.forgetVenueId();
          state = undefined;
        } else if (state?.view?.state === "complete") return project(state);
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
            venueId: (await options.readVenueId()) ?? "",
            requestId: randomUUID(),
            code: randomInt(0, 100000000).toString().padStart(8, "0"),
          };
          delete state.view;
          await save(state);
        }
        if (!state) {
          const key = generateKeyPairSync("ed25519");
          state = {
            version: 2,
            origin: options.origin,
            venueId: (await options.readVenueId()) ?? "",
            environment: options.environment,
            requestId: randomUUID(),
            code: randomInt(0, 100000000).toString().padStart(8, "0"),
            privateKey: key.privateKey
              .export({ format: "der", type: "pkcs8" })
              .toString("base64url"),
            publicKey: key.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
            ...(remoteAccessOff ? { remoteAccessEnabled: false } : {}),
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
        if (!state || state.signedIn) return project(state);
        state.view = await exchange(state, "status");
        await save(state);
        return project(state);
      });
    },
    async complete(choice: CloudChoice, authorize: () => Promise<void>) {
      return run(async () => {
        const state = await read();
        if (!state) throw new AppError("cloud.request_not_found", {});
        if (
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
