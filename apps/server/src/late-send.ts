import type { Database, Transaction } from "@waitron/db";
import { authorize, type PinThrottle } from "@waitron/identity";
import { invalid } from "./bill-allocation.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { overridePinAttempts, parseOverrideField } from "./till-api.js";
import { isUuid } from "./till-session.js";
import "./errors.js";

/** A request's `lateSend`, as read from its body. */
export interface ParsedLateSend {
  menuIds: string[];
  override?: { personId: string; pin: string };
}

/** The ended menus a request confirms, and who confirms them. */
export interface LateSendConfirmation {
  readonly menuIds: ReadonlySet<string>;
  /**
   * The person recorded as confirming, checked once: a later call with the same `needsManager` gets
   * the first answer, and one with a different value throws, since that answer did not ask for it.
   */
  confirm(tx: Transaction, needsManager: boolean): Promise<string>;
}

const PERMISSION = "venue_service.manage";

/** `lateSend` from a body, or undefined when it is absent; an explicit null is refused. */
export function parseLateSend(value: unknown): ParsedLateSend | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("lateSend");
  }
  const { menuIds, override } = value as { menuIds?: unknown; override?: unknown };
  if (
    !Array.isArray(menuIds) ||
    menuIds.length === 0 ||
    !menuIds.every((id) => typeof id === "string" && isUuid(id))
  ) {
    throw invalid("lateSend");
  }
  const ids = [...new Set((menuIds as string[]).map((id) => id.toLowerCase()))];
  const parsed = parseOverrideField(override);
  return parsed === undefined ? { menuIds: ids } : { menuIds: ids, override: parsed };
}

/**
 * Runs `run` with the request's confirmation. A manager's PIN in it is checked before `run` opens
 * its write transaction, in turn with other override attempts for the same person on this device.
 */
export async function withLateSendCheck<T>(
  db: Database,
  session: { sessionId: string; personId: string; deviceId: string },
  pinThrottle: PinThrottle,
  parsed: ParsedLateSend | undefined,
  run: (late: LateSendConfirmation | undefined) => Promise<T>,
): Promise<T> {
  if (parsed === undefined) return run(undefined);
  const { override } = parsed;
  const authz = { sessionId: session.sessionId, permission: PERMISSION };
  const attempts = overridePinAttempts(pinThrottle, session.deviceId);
  const toCheck = await overrideToCheck(db, authz, override);
  return withPinCheckAhead(db, toCheck, attempts, (checked) => {
    let confirmed: { needsManager: boolean; by: Promise<string> } | undefined;
    return run({
      menuIds: new Set(parsed.menuIds),
      confirm(tx, needsManager) {
        confirmed ??= {
          needsManager,
          by: needsManager
            ? authorize(tx, { ...authz, override: withCheck(override, checked) }, attempts).then(
                (authorization) => authorization.authorizedBy,
              )
            : Promise.resolve(session.personId),
        };
        if (confirmed.needsManager !== needsManager) {
          throw new Error("a late-send confirmation was asked with a different setting");
        }
        return confirmed.by;
      },
    });
  });
}
