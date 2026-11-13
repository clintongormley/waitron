import { RESET_REQUEST_FILE } from "@waitron/store";
import { readRestoreFlowPhase } from "./restore-flow-phase.js";
import "./errors.js";
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
} from "./first-setup-state.js";
import type { VenueRequest } from "./venue-plan.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { inTurn } from "./attempt-turns.js";

export interface FirstSetupClaimPayload {
  environment: "production" | "preproduction";
  configurationImport?: boolean;
  newTaxpayer?: boolean;
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
export type ReconfirmationPurpose = "block-use" | "activation" | "node-key-reissue";
export interface PublicFirstSetupState {
  attemptId: string;
  nodeId: string;
  administratorId: string;
  revision: number;
  ownerGeneration: number;
  status: FirstSetupState["status"];
  consumptionIntent: boolean;
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
    intent?: Pick<FirstSetupClaimPayload, "configurationImport" | "newTaxpayer">,
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
    consumptionIntent: state.consumptionIntent,
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
    const restorePhase = await readRestoreFlowPhase(stateDir);
    if (restorePhase === "staged" || restorePhase === "placing")
      throw new AppError("setup.attempt_conflict", {});
    for (const name of [RESET_REQUEST_FILE]) {
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
  const passwordThrottle = createPasswordThrottle(now);
  type Grant = FirstSetupOwnerAttempt & {
    purpose: ReconfirmationPurpose;
    bootId: string;
    expires: number;
  };
  const grants = new Map<string, Grant>();
  const grantMatches = (
    grant: Grant | undefined,
    owner: FirstSetupOwnerAttempt,
    purpose: ReconfirmationPurpose,
  ) =>
    grant !== undefined &&
    grant.attemptId === owner.attemptId &&
    grant.revision === owner.revision &&
    grant.ownerGeneration === owner.ownerGeneration &&
    grant.purpose === purpose &&
    grant.bootId === options.bootId &&
    now() < grant.expires;
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
    async claimFirstSetup(payload: FirstSetupClaimPayload) {
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
      const capability = token();
      const state = await coordinator.run(async (hold) => {
        await assertNoOtherSetupInProgress(options.stateDir);
        await options.assertClaimAllowed?.(hold);
        const frozen = await options.freeze(request, payload.environment, ids, payload);
        if (
          frozen.attemptId !== ids.attemptId ||
          frozen.nodeId !== ids.nodeId ||
          frozen.administratorId !== ids.administratorId ||
          frozen.environment !== payload.environment
        )
          throw new AppError("setup.attempt_invalid", {});
        return store.claim(frozen, request.admin.passwordHash, hash(capability), hold);
      });
      return {
        state: publicFirstSetupState(state),
        capability,
        ownerGeneration: state.ownerGeneration,
      };
    },
    reconfirm(owner: FirstSetupOwnerAttempt, password: string, purpose: ReconfirmationPurpose) {
      return inTurn(throttle, "reconfirm", async () => {
        if (!["block-use", "activation", "node-key-reissue"].includes(purpose)) refuse();
        const before = await authorize(owner);
        const finish =
          purpose === "node-key-reissue" ? passwordThrottle.begin("first-setup") : undefined;
        let outcome: "success" | "invalid" | "error" = "error";
        try {
          if (
            typeof password !== "string" ||
            Buffer.byteLength(password) > 1024 ||
            !(await verifyPassword(password, before.ownerVerifier))
          ) {
            invalidate(owner.attemptId);
            outcome = "invalid";
            refuse();
          }
          const grant = await coordinator.run(async () => {
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
          outcome = "success";
          return grant;
        } finally {
          finish?.(outcome);
        }
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
        if (!grantMatches(grant, owner, purpose)) refuse();
      };
      return hold === undefined ? coordinator.run(consume) : coordinator.held(hold, consume);
    },
    checkReconfirmation(
      owner: FirstSetupOwnerAttempt,
      nonce: string,
      purpose: ReconfirmationPurpose,
      hold?: FirstSetupHold,
    ): Promise<void> {
      const check = async () => {
        await authorize(owner);
        if (!validToken(nonce) || !grantMatches(grants.get(hash(nonce)), owner, purpose)) refuse();
      };
      return hold === undefined ? coordinator.run(check) : coordinator.held(hold, check);
    },
  };
}
