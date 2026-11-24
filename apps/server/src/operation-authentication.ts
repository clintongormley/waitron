import { authorityKey, authorityKeyMatches, type KeyRing } from "@waitron/credentials";
import "./errors.js";
import { AppError, decodeMasterKeyCode } from "@waitron/shared";
import {
  readCurrentMasterKey,
  withVenueAndNodeTransaction,
  withTransaction,
  type Database,
  type MasterKeyRecord,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  withInspectorAdmitted,
} from "@waitron/identity";
import {
  withOperationAuthority,
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { inTurn } from "./attempt-turns.js";
import { isUuid } from "./till-session.js";

export async function withRecoveryKeyOperation<T>(
  deps: { readonly db: Database; readonly node: NodeDatabase; readonly nodeId: string },
  operation: OperationBinding,
  secret: unknown,
  run: (tx: Transaction, authority: OperationAuthority) => Promise<T>,
  collect?: (authority: OperationAuthority, commit: () => Promise<T>) => Promise<T>,
): Promise<T> {
  return withRecoveryKeyAuthority(deps, operation, secret, (authority, commit) => {
    const perform = () => commit((tx) => run(tx, authority));
    return collect === undefined ? perform() : collect(authority, perform);
  });
}

export async function withRecoveryKeyAuthority<T>(
  deps: { readonly db: Database; readonly node: NodeDatabase; readonly nodeId: string },
  operation: OperationBinding,
  secret: unknown,
  run: (
    authority: OperationAuthority,
    commit: <R>(body: (tx: Transaction) => Promise<R>) => Promise<R>,
  ) => Promise<T>,
  allowedActions: readonly string[] = ["restore", "promote"],
): Promise<T> {
  const binding = { ...operation };
  const targetNodeId = deps.nodeId;
  const refuse = (): never => {
    throw new AppError("promotion.break_glass_invalid", {});
  };
  if (binding.targetNodeId !== targetNodeId || !allowedActions.includes(binding.action))
    return refuse();
  const checked = await masterKeyAuthorising(deps.db, secret);
  if (checked === null) return refuse();
  return withOperationAuthority(
    binding,
    { kind: "recovery-key", nodeId: targetNodeId, eventId: binding.eventId },
    (authority) => {
      const authorise = (): void => {
        if (readOperationAuthority(authority, binding) === undefined) refuse();
      };
      const commit = async <R>(body: (tx: Transaction) => Promise<R>): Promise<R> => {
        authorise();
        // A new master key is a venue.db write, so it cannot land between this re-read and the
        // commit that holds the venue write turn.
        return withVenueAndNodeTransaction(deps.db, deps.node, async (tx) => {
          authorise();
          if ((await readCurrentMasterKey(tx))?.number !== checked.number) return refuse();
          const result = await body(tx);
          authorise();
          return result;
        });
      };
      return run(authority, commit);
    },
  );
}

// The bytes live here, not on the handle, so no holder of a handle can read or change them.
const stagedAuthorityKeys = new WeakMap<object, Uint8Array>();
declare const staged: unique symbol;
export type StagedAuthorityKey = { readonly [staged]: true };

/** An authority key a restore staged from its master key; a request body cannot make one. */
export function stagedAuthorityKey(bytes: Uint8Array): StagedAuthorityKey {
  const key = Object.freeze({});
  stagedAuthorityKeys.set(key, Uint8Array.from(bytes));
  return key as StagedAuthorityKey;
}

export function isStagedAuthorityKey(value: unknown): value is StagedAuthorityKey {
  return typeof value === "object" && value !== null && stagedAuthorityKeys.has(value);
}

function authorityFrom(secret: unknown): Uint8Array | null {
  if (typeof secret === "object" && secret !== null) return stagedAuthorityKeys.get(secret) ?? null;
  if (typeof secret !== "string") return null;
  try {
    return authorityKey(decodeMasterKeyCode(secret));
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

/** The venue's current master key when `secret` (a typed master key or a staged authority key)
 * is that key; `null` otherwise, and before the venue has one. */
export async function masterKeyAuthorising(
  db: Database | Transaction,
  secret: unknown,
): Promise<MasterKeyRecord | null> {
  const authority = authorityFrom(secret);
  if (authority === null) return null;
  const current = await readCurrentMasterKey(db);
  return current !== null && authorityKeyMatches(authority, current.checkValue) ? current : null;
}

const switchSignedIn = new WeakSet<object>();
declare const signedIn: unique symbol;
export type SwitchSignedIn = { readonly personId: string; readonly [signedIn]: true };

/** Credentials for a person the emergency switch signed in by passkey or proof; a request body
 * cannot make one. */
export function switchSignedInAs(personId: string): SwitchSignedIn {
  const credentials = Object.freeze({ personId });
  switchSignedIn.add(credentials);
  return credentials as SwitchSignedIn;
}

export function isSwitchSignedIn(credentials: unknown): credentials is SwitchSignedIn {
  return typeof credentials === "object" && credentials !== null && switchSignedIn.has(credentials);
}

export async function withAuthenticatedOperation<T>(
  deps: { readonly db: Database; readonly credentialKeyRing: KeyRing },
  operation: {
    readonly binding: OperationBinding;
    readonly permission: "node.manage";
  },
  credentials: unknown,
  run: (authority: OperationAuthority) => Promise<T>,
  /** Runs inside the sign-in's transaction, so a throw leaves no session row behind. */
  afterSignIn?: () => Promise<void>,
): Promise<T> {
  if (typeof credentials !== "object" || credentials === null || Array.isArray(credentials))
    throw new AppError("password.invalid", {}, { reason: "malformed" });
  const { personId, password, totp } = credentials as Record<string, unknown>;
  if (
    typeof personId !== "string" ||
    !isUuid(personId) ||
    typeof password !== "string" ||
    (totp !== undefined && typeof totp !== "string")
  )
    throw new AppError("password.invalid", {}, { reason: "malformed" });
  const binding = { ...operation.binding };
  const permission = operation.permission;
  const operatorId = await inTurn(deps.db, personId, async () => {
    const checked = await checkManagerPassword(deps.db, { personId }, password);
    return withTransaction(deps.db, async (tx) => {
      const session = await loginManagerById(tx, {
        personId,
        password,
        totp,
        totpKeyRing: deps.credentialKeyRing,
        checked,
      });
      const authorised = await withInspectorAdmitted(() =>
        authorizeManager(tx, { managementSessionId: session.token, permission }),
      );
      await endManagementSession(tx, session.token, "operation_finished");
      await afterSignIn?.();
      return authorised.authorizedBy;
    });
  });
  return withOperationAuthority(binding, operatorId, run);
}
