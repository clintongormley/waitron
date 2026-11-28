import {
  isPairingV4Profile,
  pairingV4Payload,
  pairingV5Payload,
  type PairingV4Operation,
} from "@waitron/contract";
import { hashSessionToken } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { fetchSetupAddress } from "./cloud-address-lookup.js";
import type {
  CloudConnectionOptions,
  CloudInstallationCredentials,
  CloudRegistration,
  SavedCloudState,
} from "./cloud-client-types.js";
import { requestSetupCloudEmailGrant } from "./cloud-email.js";
import { hasLiveLease, installationClient } from "./cloud-installation.js";
import {
  cloudSignInChallenge,
  newCloudSignInAttempt,
  readCloudSignInReply,
  type CloudSignInBinding,
  type CloudSignInReturn,
  type CloudSignInState,
  type PreparedSetupAdmin,
} from "./cloud-sign-in.js";
import "./errors.js";

export function createCloudClientSignIn({
  options,
  run,
  readState,
  writeState,
  save,
  requestPairing,
}: {
  options: CloudConnectionOptions;
  run: <T>(
    work: () => Promise<T>,
    wait?: boolean,
    signal?: AbortSignal,
    key?: string | symbol,
  ) => Promise<T>;
  readState: () => Promise<SavedCloudState | CloudSignInState | undefined>;
  writeState: (state: SavedCloudState | CloudSignInState) => Promise<void>;
  save: (state: SavedCloudState, optionalHints?: boolean) => Promise<void>;
  requestPairing: <T>(
    action: string,
    bytes: Buffer,
    privateKey: string,
    readReply: (value: unknown) => T,
    signIn?: boolean,
  ) => Promise<T>;
}) {
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
  return {
    recoverSignIn,
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
  };
}
