import "./errors.js";
import { AppError } from "@waitron/shared";
import {
  withNodeTransaction,
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
  type TotpKeyRing,
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
    !["restore", "promote"].includes(binding.action)
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
        // node.db's lock is taken outside venue.db's, so the key cannot change before this commits.
        return withNodeTransaction(deps.node, (node) =>
          withTransaction(deps.db, async (tx) => {
            authorise();
            if ((await readRecoveryKeyVerifier(node, targetNodeId)) !== verifier) return refuse();
            const result = await body(tx);
            authorise();
            return result;
          }),
        );
      };
      return run(authority, commit);
    },
  );
}

export async function withAuthenticatedOperation<T>(
  deps: { readonly db: Database; readonly credentialKeyRing: TotpKeyRing },
  operation: {
    readonly binding: OperationBinding;
    readonly permission: "node.promote" | "mirror.create";
  },
  credentials: unknown,
  run: (authority: OperationAuthority) => Promise<T>,
): Promise<T> {
  if (typeof credentials !== "object" || credentials === null || Array.isArray(credentials))
    throw new AppError("password.invalid", {});
  const { personId, password, totp } = credentials as Record<string, unknown>;
  if (
    typeof personId !== "string" ||
    !isUuid(personId) ||
    typeof password !== "string" ||
    (totp !== undefined && typeof totp !== "string")
  )
    throw new AppError("password.invalid", {});
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
      const authorised = await authorizeManager(tx, {
        managementSessionId: session.token,
        permission,
      });
      await endManagementSession(tx, session.token);
      return authorised.authorizedBy;
    });
  });
  return withOperationAuthority(binding, operatorId, run);
}
