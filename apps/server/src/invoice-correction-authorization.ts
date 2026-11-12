import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  authorize,
  type Authorization,
  type Override,
  type PinAttempts,
  type SecretCheck,
} from "@waitron/identity";
import type { DeviceId } from "@waitron/shared";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { checkAccess } from "./tender-refund-api.js";
import "./errors.js";

/**
 * Runs `body` once the signed-in person, or the supervisor whose PIN `override` carries, holds
 * `sale.rectify`. The PIN is checked before the write lock; session, device, profile and the
 * invoice's zones are read again inside the transaction `body` shares.
 */
export async function withCorrectionAuthorization<T>(
  db: Database,
  saleId: string,
  override: Override | undefined,
  operator: { personId: string; sessionId: string; deviceId: DeviceId; attempts: PinAttempts },
  body: (
    tx: Transaction,
    authorization: Authorization,
    checked: SecretCheck | undefined,
  ) => Promise<T>,
): Promise<T> {
  const toCheck = await overrideToCheck(
    db,
    { sessionId: operator.sessionId, permission: "sale.rectify" },
    override,
  );
  return withPinCheckAhead(db, toCheck, operator.attempts, (checked) =>
    withTransaction(db, async (tx) => {
      await checkAccess(tx, operator, saleId);
      const authorization = await authorize(
        tx,
        {
          sessionId: operator.sessionId,
          permission: "sale.rectify",
          override: withCheck(override, checked),
        },
        operator.attempts,
      );
      return body(tx, authorization, checked);
    }),
  );
}
