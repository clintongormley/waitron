import "./errors.js";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database } from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  loginManagerById,
  type TotpKeyRing,
} from "@waitron/identity";
import {
  withOperationAuthority,
  type OperationAuthority,
  type OperationBinding,
} from "@waitron/module";
import { inTurn } from "./attempt-turns.js";
import { isUuid } from "./till-session.js";

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
