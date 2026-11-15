import { isIP } from "node:net";
import {
  exactKeys,
  fetchCloudDisplay,
  object,
  readPrices,
  unavailable,
  type BillingPrices,
} from "./cloud-billing.js";
import type { SavedCloudState } from "./cloud-client.js";
import type { OnRefusal } from "./cloud-translation.js";
import "./errors.js";

export type EmergencyFacts =
  | {
      status: "ready";
      open: boolean;
      closedReason:
        null | "setting_off" | "level_inactive" | "no_payment_method" | "not_provisioned";
      address: string | null;
      codeIssuedAt: string | null;
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
const instant = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const host = (origin: string) => new URL(origin).hostname.toLowerCase().replace(/\.$/, "");
function addressValid(value: unknown, cloudOrigin: string, staffOrigin: string): value is string {
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
    exactKeys(e, ["status", "open", "closedReason", "address", "codeIssuedAt"]);
    if (
      e.status !== "ready" ||
      typeof e.open !== "boolean" ||
      (e.open
        ? e.closedReason !== null || e.address === null || e.codeIssuedAt === null
        : !["setting_off", "level_inactive", "no_payment_method", "not_provisioned"].includes(
            e.closedReason as string,
          )) ||
      (e.address !== null &&
        !addressValid(e.address, expected.cloudOrigin, expected.staffOrigin)) ||
      (e.codeIssuedAt !== null && (!instant(e.codeIssuedAt) || e.codeIssuedAt > value.asOf))
    )
      unavailable();
  }
  return {
    ...value,
    prices: readPrices(value.prices),
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
