import { isIP } from "node:net";
import { AppError } from "@waitron/shared";
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

export interface EmergencyCode {
  version: 1;
  installationId: string;
  venueId: string;
  countryCode: "ES";
  asOf: string;
  code: string;
  codeIssuedAt: string;
  address: string;
}
export function readEmergencyCode(
  value: unknown,
  expected: Parameters<typeof readEmergencyDisplay>[1],
  exchange?: { sentAt: number; receivedAt: number },
): EmergencyCode {
  exactKeys(value, [
    "version",
    "installationId",
    "venueId",
    "countryCode",
    "asOf",
    "code",
    "codeIssuedAt",
    "address",
  ]);
  if (
    value.version !== 1 ||
    value.installationId !== expected.installationId ||
    value.venueId !== expected.venueId ||
    value.countryCode !== "ES" ||
    !instant(value.asOf) ||
    (exchange &&
      (Date.parse(value.asOf) < exchange.sentAt - 60000 ||
        Date.parse(value.asOf) > exchange.receivedAt + 60000)) ||
    typeof value.code !== "string" ||
    !/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){5}$/.test(value.code) ||
    !instant(value.codeIssuedAt) ||
    value.codeIssuedAt > value.asOf ||
    !addressValid(value.address, expected.cloudOrigin, expected.staffOrigin)
  )
    unavailable();
  return value as unknown as EmergencyCode;
}
export function fetchEmergencyCode(
  state: SavedCloudState,
  staffOrigin: string,
  options: { signal?: AbortSignal; onRefusal?: OnRefusal; timeoutMs?: number } = {},
): Promise<EmergencyCode> {
  return fetchCloudDisplay(
    state,
    "emergency-hosting-code",
    (value, exchange) =>
      readEmergencyCode(
        value,
        {
          installationId: state.view!.registration!.installationId,
          venueId: state.view!.registration!.venueId,
          cloudOrigin: state.origin,
          staffOrigin,
        },
        exchange,
      ),
    {
      ...options,
      refusal: (status, value, retryAfter) => {
        if (status === 403 && object(value) && value.error === "emergency_hosting_closed") {
          exactKeys(value, ["error", "reason"]);
          if (
            !["setting_off", "level_inactive", "no_payment_method", "not_provisioned"].includes(
              value.reason as string,
            )
          )
            unavailable();
          return new AppError("cloud.emergency_hosting_closed", { reason: value.reason as string });
        }
        const seconds =
          retryAfter !== null && /^[1-9]\d*$/.test(retryAfter) ? Number(retryAfter) : NaN;
        if (
          status === 429 &&
          Number.isSafeInteger(seconds) &&
          object(value) &&
          value.error === "rate_limited" &&
          Object.keys(value).length === 1
        )
          return new AppError("cloud.emergency_code_rate_limited", { seconds });
        return new AppError(
          [400, 405, 413, 415].includes(status) ? "cloud.request_invalid" : "cloud.unavailable",
          {},
        );
      },
    },
  );
}

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
