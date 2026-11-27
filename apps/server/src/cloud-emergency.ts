import { isIP } from "node:net";
import {
  exactKeys,
  fetchCloudDisplay,
  object,
  readPrices,
  unavailable,
  type BillingPrices,
} from "./cloud-billing.js";
import type { CloudInstallationCredentials, SavedCloudState } from "./cloud-client.js";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import type { OnRefusal } from "./cloud-translation.js";

const closureReasons = [
  "setting_off",
  "level_inactive",
  "no_payment_method",
  "not_provisioned",
] as const;
type ClosureReason = (typeof closureReasons)[number];
const isClosureReason = (value: unknown): value is ClosureReason =>
  closureReasons.some((reason) => reason === value);

export type EmergencyFacts =
  | {
      status: "ready";
      open: boolean;
      closedReason: null | ClosureReason;
      address: string | null;
    }
  | { status: "unavailable"; reason: "state_not_ready" };
export interface EmergencyDisplay {
  version: 1;
  installationId: string;
  venueId: string;
  countryCode: "ES";
  asOf: string;
  emergency: EmergencyFacts;
  prices: BillingPrices;
}
export const instant = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const host = (origin: string) => new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
export function validEmergencyAddress(
  value: unknown,
  cloudOrigin: string,
  staffOrigin: string,
): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value),
      hostname = url.hostname;
    return (
      value === `https://${hostname}/` &&
      hostname.length <= 253 &&
      hostname.includes(".") &&
      !isIP(hostname) &&
      hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
      !/\.(?:localhost|local|internal|lan)$/.test(hostname) &&
      hostname !== host(cloudOrigin) &&
      hostname !== host(staffOrigin)
    );
  } catch {
    return false;
  }
}
export function readEmergencyDisplay(
  value: unknown,
  expected: { installationId: string; venueId: string; cloudOrigin: string; staffOrigin: string },
  exchange?: { sentAt: number; receivedAt: number },
): EmergencyDisplay {
  exactKeys(value, [
    "version",
    "installationId",
    "venueId",
    "countryCode",
    "asOf",
    "emergency",
    "prices",
  ]);
  if (
    value.version !== 1 ||
    value.installationId !== expected.installationId ||
    value.venueId !== expected.venueId ||
    value.countryCode !== "ES" ||
    !instant(value.asOf) ||
    (exchange &&
      (Date.parse(value.asOf) < exchange.sentAt - 60000 ||
        Date.parse(value.asOf) > exchange.receivedAt + 60000))
  )
    unavailable();
  const e = value.emergency;
  if (object(e) && e.status === "unavailable") {
    exactKeys(e, ["status", "reason"]);
    if (e.reason !== "state_not_ready") unavailable();
  } else {
    exactKeys(e, ["status", "open", "closedReason", "address"]);
    if (
      e.status !== "ready" ||
      typeof e.open !== "boolean" ||
      (e.open ? e.closedReason !== null || e.address === null : !isClosureReason(e.closedReason)) ||
      (e.address !== null &&
        !validEmergencyAddress(e.address, expected.cloudOrigin, expected.staffOrigin))
    )
      unavailable();
  }
  return {
    ...value,
    prices: readPrices(value.prices, null),
  } as unknown as EmergencyDisplay;
}
export function fetchEmergencyDisplay(
  state: SavedCloudState,
  staffOrigin: string,
  options: { signal?: AbortSignal; onRefusal?: OnRefusal; timeoutMs?: number } = {},
): Promise<EmergencyDisplay> {
  return fetchCloudDisplay(
    state,
    "emergency-hosting-display",
    (value, exchange) =>
      readEmergencyDisplay(
        value,
        {
          installationId: state.view!.registration!.installationId,
          venueId: state.view!.registration!.venueId,
          cloudOrigin: state.origin,
          staffOrigin,
        },
        exchange,
      ),
    options,
  );
}

interface EmergencyCopyStatus {
  sourceLastHeardAt: string | null;
  reason: ClosureReason | "state_not_ready" | "source_recent" | null;
}

export function readEmergencyCopyStatus(
  value: unknown,
  binding: EmergencyCopyBinding,
  exchange?: { sentAt: number; receivedAt: number },
): EmergencyCopyStatus {
  const boundKeys = [
    "installationId",
    "venueId",
    "environment",
    "sourceInstallationId",
    "sourceNodeId",
    "copyNodeId",
    "copyOperationId",
    "startedAt",
    "expiresAt",
  ] as const;
  exactKeys(value, [...boundKeys, "version", "asOf", "eligibility", "sourceLastHeardAt"]);
  const { asOf, eligibility, sourceLastHeardAt } = value;
  if (
    value.version !== 1 ||
    boundKeys.some((key) => value[key] !== binding[key]) ||
    !instant(asOf) ||
    (sourceLastHeardAt !== null && !instant(sourceLastHeardAt))
  )
    unavailable();
  const checkedAt = Date.parse(asOf);
  if (
    checkedAt < Date.parse(binding.startedAt) ||
    checkedAt >= Date.parse(binding.expiresAt) ||
    (exchange && (checkedAt < exchange.sentAt - 60000 || checkedAt > exchange.receivedAt + 60000))
  )
    unavailable();
  const age = sourceLastHeardAt === null ? Infinity : checkedAt - Date.parse(sourceLastHeardAt);
  if (age < 0) unavailable();
  if (object(eligibility) && eligibility.status === "unavailable") {
    exactKeys(eligibility, ["status", "reason"]);
    if (eligibility.reason !== "state_not_ready") unavailable();
    return { sourceLastHeardAt, reason: eligibility.reason };
  }
  exactKeys(eligibility, ["status", "open", "closedReason"]);
  if (eligibility.status !== "ready") unavailable();
  if (eligibility.open === false && isClosureReason(eligibility.closedReason))
    return { sourceLastHeardAt, reason: eligibility.closedReason };
  if (eligibility.open !== true || eligibility.closedReason !== null) unavailable();
  return { sourceLastHeardAt, reason: age <= 120000 ? "source_recent" : null };
}

export function fetchEmergencyCopyStatus(
  state: CloudInstallationCredentials,
  binding: EmergencyCopyBinding,
  signal: AbortSignal,
): Promise<EmergencyCopyStatus> {
  return fetchCloudDisplay(
    state,
    "emergency-copy-status",
    (value, exchange) => readEmergencyCopyStatus(value, binding, exchange),
    {
      signal,
      signedBody: JSON.stringify({ version: 1, copyOperationId: binding.copyOperationId }),
    },
  );
}
