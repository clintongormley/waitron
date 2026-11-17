import type { KeyRing } from "@waitron/credentials";
import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  withVenueAndNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  verifySecretAsync,
  withInspectorAdmitted,
} from "@waitron/identity";
import {
  withOperationAuthority,
  readOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { readRecoveryKeyVerifier } from "@waitron/node-db";
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
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    binding.targetNodeId !== targetNodeId ||
    !allowedActions.includes(binding.action)
  )
    return refuse();
  const verifier = await readRecoveryKeyVerifier(deps.node, targetNodeId);
  if (verifier === null || !(await verifySecretAsync(secret, verifier))) return refuse();
  return withOperationAuthority(
    binding,
    { kind: "recovery-key", nodeId: targetNodeId, eventId: binding.eventId },
    (authority) => {
      const authorise = (): void => {
        if (readOperationAuthority(authority, binding) === undefined) refuse();
      };
      const commit = async <R>(body: (tx: Transaction) => Promise<R>): Promise<R> => {
        authorise();
        // node.db's lock is held across the venue commit, and every key write takes it, so the key
        // cannot change before this commits.
        return withVenueAndNodeTransaction(deps.db, deps.node, async (tx, node) => {
          authorise();
          if ((await readRecoveryKeyVerifier(node, targetNodeId)) !== verifier) return refuse();
          const result = await body(tx);
          authorise();
          return result;
        });
      };
      return run(authority, commit);
    },
  );
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
