import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "@waitron/shared";
import {
  assertPasswordLength,
  assertPinLength,
  hashPassword,
  hashPin,
  normalizeAndValidateEmail,
  verifyPassword,
} from "@waitron/identity";
import type {
  FirstSetupCoordinator,
  FirstSetupFrozen,
  FirstSetupHold,
  FirstSetupState,
  FirstSetupStore,
  VenueRequest,
} from "@waitron/provisioning";
import { createSetupOperationStore } from "./setup-operation.js";
import { inTurn } from "./attempt-turns.js";
import "@waitron/provisioning";

export interface FirstSetupClaimPayload {
  environment: "production" | "preproduction";
  request: Omit<VenueRequest, "admin"> & {
    admin: Omit<VenueRequest["admin"], "pinHash" | "passwordHash"> & {
      password: string;
      pin: string;
    };
  };
}
export interface FirstSetupOwnerAttempt {
  attemptId: string;
  revision: number;
  ownerGeneration: number;
  capability: string;
}
export type ReconfirmationPurpose = "block-use" | "activation";
export interface PublicFirstSetupState {
  attemptId: string;
  nodeId: string;
  administratorId: string;
  revision: number;
  ownerGeneration: number;
  status: FirstSetupState["status"];
  environment: FirstSetupFrozen["environment"];
  venue: Omit<VenueRequest, "admin"> & {
    admin: Omit<VenueRequest["admin"], "pinHash" | "passwordHash">;
  };
  modules: { module: string; version: string }[];
}
interface OwnerOptions {
  stateDir: string;
  store: FirstSetupStore;
  coordinator: FirstSetupCoordinator;
  bootId: string;
  now?: () => number;
  freeze(
    request: VenueRequest,
    environment: FirstSetupFrozen["environment"],
    ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
  ): Promise<FirstSetupFrozen>;
  assertClaimAllowed?(hold: FirstSetupHold): Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const validToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(value) &&
  Buffer.from(value, "base64url").toString("base64url") === value;
function refuse(): never {
  throw new AppError("setup.owner_required", {});
}
const dummyVerifier = hashPassword(token());
const matches = (value: string, digest: string) =>
  timingSafeEqual(Buffer.from(hash(value), "hex"), Buffer.from(digest, "hex"));
export function publicFirstSetupState(state: FirstSetupState): PublicFirstSetupState {
  const { pinHash: _, passwordHash: __, ...admin } = state.frozen.request.admin;
  void _;
  void __;
  return {
    attemptId: state.frozen.attemptId,
    nodeId: state.frozen.nodeId,
    administratorId: state.frozen.administratorId,
    revision: state.revision,
    ownerGeneration: state.ownerGeneration,
    status: state.status,
    environment: state.frozen.environment,
    venue: structuredClone({ ...state.frozen.request, admin }),
    modules: state.frozen.modules.map(({ module, version }) => ({ module, version })),
  };
}
async function assertNoOtherSetupInProgress(stateDir: string): Promise<void> {
  try {
    const operation = await createSetupOperationStore(stateDir).read();
    if (operation !== null && operation.phase !== "complete")
      throw new AppError("setup.attempt_conflict", {});
    for (const name of ["restore-request.json", "reset-request.json"]) {
      const exists = await lstat(join(stateDir, name)).then(
        () => true,
        (error: unknown) => {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return false;
          throw new AppError("setup.attempt_invalid", {});
        },
      );
      if (exists) throw new AppError("setup.attempt_conflict", {});
    }
  } catch (error) {
    if (error instanceof AppError)
      throw new AppError(
        error.code === "setup.attempt_invalid" ? "setup.attempt_invalid" : "setup.attempt_conflict",
        {},
      );
    throw new AppError("setup.attempt_invalid", {});
  }
}
export function createFirstSetupOwner(options: OwnerOptions) {
  const { store, coordinator } = options;
  const now = options.now ?? (() => performance.now());
  const throttle = {};
  const grants = new Map<
    string,
    FirstSetupOwnerAttempt & { purpose: ReconfirmationPurpose; bootId: string; expires: number }
  >();
  const invalidate = (attemptId: string) => {
    for (const [key, grant] of grants) if (grant.attemptId === attemptId) grants.delete(key);
  };
  const authorize = async (owner: FirstSetupOwnerAttempt): Promise<FirstSetupState> => {
    const state = await store.read();
    if (
      state === null ||
      !validToken(owner.capability) ||
      state.frozen.attemptId !== owner.attemptId ||
      state.revision !== owner.revision ||
      state.ownerGeneration !== owner.ownerGeneration ||
      state.status === "complete" ||
      state.status === "abandoned" ||
      !matches(owner.capability, state.capabilityHash)
    )
      refuse();
    return state;
  };
  return {
    authorize,
    async status(owner: FirstSetupOwnerAttempt): Promise<FirstSetupState> {
      const state = await store.read();
      if (
        state === null ||
        !validToken(owner.capability) ||
        state.frozen.attemptId !== owner.attemptId ||
        state.ownerGeneration !== owner.ownerGeneration ||
        !matches(owner.capability, state.capabilityHash)
      )
        refuse();
      return state;
    },
    invalidate,
    async claimFirstSetup(payload: FirstSetupClaimPayload, clientClaimNonce: string) {
      if (!validToken(clientClaimNonce)) refuse();
      const { password, pin, ...admin } = payload.request.admin;
      if (
        typeof password !== "string" ||
        typeof pin !== "string" ||
        Buffer.byteLength(password) > 1024 ||
        Buffer.byteLength(pin) > 1024
      )
        refuse();
      assertPasswordLength(password);
      assertPinLength(pin);
      const request: VenueRequest = {
        ...structuredClone(payload.request),
        country: payload.request.country.trim().toUpperCase(),
        taxId: payload.request.taxId.trim().toUpperCase(),
        legalName: payload.request.legalName.trim(),
        admin: {
          ...admin,
          displayName: admin.displayName.trim(),
          email: normalizeAndValidateEmail(admin.email),
          pinHash: hashPin(pin),
          passwordHash: hashPassword(password),
        },
      };
      const ids = { attemptId: randomUUID(), nodeId: randomUUID(), administratorId: randomUUID() };
      const frozen = await options.freeze(request, payload.environment, ids);
      if (
        frozen.attemptId !== ids.attemptId ||
        frozen.nodeId !== ids.nodeId ||
        frozen.administratorId !== ids.administratorId ||
        frozen.environment !== payload.environment
      )
        throw new AppError("setup.attempt_invalid", {});
      const capability = token();
      const state = await coordinator.run(async (hold) => {
        await assertNoOtherSetupInProgress(options.stateDir);
        await options.assertClaimAllowed?.(hold);
        return store.claim(
          frozen,
          request.admin.passwordHash,
          hash(capability),
          hash(clientClaimNonce),
          hold,
        );
      });
      return {
        state: publicFirstSetupState(state),
        capability,
        ownerGeneration: state.ownerGeneration,
      };
    },
    resumeFirstSetup(clientClaimNonce: string, proof: { password: string }) {
      return inTurn(throttle, "resume", async () => {
        const resumable = await store.readResumable();
        const before = resumable?.state ?? null;
        if (before?.status === "complete" && resumable?.publicationComplete) refuse();
        if (typeof proof.password !== "string" || Buffer.byteLength(proof.password) > 1024)
          refuse();
        const correct = await verifyPassword(
          proof.password,
          before?.ownerVerifier ?? dummyVerifier,
        );
        if (
          before === null ||
          !correct ||
          !validToken(clientClaimNonce) ||
          !matches(clientClaimNonce, before.claimNonceHash)
        )
          refuse();
        const capability = token();
        const state = await coordinator.run(async (hold) => {
          const current = (await store.readResumable())?.state ?? null;
          if (
            current?.revision !== before.revision ||
            current.frozen.attemptId !== before.frozen.attemptId ||
            current.ownerGeneration !== before.ownerGeneration
          )
            refuse();
          const updated = await store.update(
            current.frozen.attemptId,
            current.revision,
            { kind: "resume", capabilityHash: hash(capability) },
            hold,
          );
          invalidate(current.frozen.attemptId);
          return updated;
        });
        return {
          state: publicFirstSetupState(state),
          capability,
          ownerGeneration: state.ownerGeneration,
        };
      });
    },
    reconfirm(owner: FirstSetupOwnerAttempt, password: string, purpose: ReconfirmationPurpose) {
      return inTurn(throttle, "reconfirm", async () => {
        if (!["block-use", "activation"].includes(purpose)) refuse();
        const before = await authorize(owner);
        if (
          typeof password !== "string" ||
          Buffer.byteLength(password) > 1024 ||
          !(await verifyPassword(password, before.ownerVerifier))
        ) {
          invalidate(owner.attemptId);
          refuse();
        }
        return coordinator.run(async () => {
          await authorize(owner);
          invalidate(owner.attemptId);
          const nonce = token();
          grants.set(hash(nonce), {
            ...owner,
            capability: "",
            purpose,
            bootId: options.bootId,
            expires: now() + 300000,
          });
          return nonce;
        });
      });
    },
    consumeReconfirmation(
      owner: FirstSetupOwnerAttempt,
      nonce: string,
      purpose: ReconfirmationPurpose,
      hold?: FirstSetupHold,
    ): Promise<void> {
      const consume = async () => {
        await authorize(owner);
        if (!validToken(nonce)) refuse();
        const grant = grants.get(hash(nonce));
        grants.delete(hash(nonce));
        if (
          grant === undefined ||
          grant.attemptId !== owner.attemptId ||
          grant.revision !== owner.revision ||
          grant.ownerGeneration !== owner.ownerGeneration ||
          grant.purpose !== purpose ||
          grant.bootId !== options.bootId ||
          now() >= grant.expires
        )
          refuse();
      };
      return hold === undefined ? coordinator.run(consume) : coordinator.held(hold, consume);
    },
  };
}
