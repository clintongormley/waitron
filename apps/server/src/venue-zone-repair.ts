import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  incidents,
  locations,
  locationBusinessDaySettings,
  venueLocationId,
  type Transaction,
} from "@waitron/db";
import { findAdministrativeArea } from "@waitron/country";
import { getCountryPack, requireCountryTimeZone } from "@waitron/country-packs";
import type { IssueScope } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import type { AlertEventClaim } from "@waitron/module";
import {
  AppError,
  businessDayAt,
  cutoverForBusinessDay,
  timeZoneOffsetMinutes,
} from "@waitron/shared";
import { readZoneContext, validateRetainedZoneClock } from "./venue-zone-context.js";
import type { TradingAdmissionView } from "./trading-admission.js";
import "./errors.js";

export const ZONE_REPAIR_ALERT_CLAIM: AlertEventClaim = {
  prefix: "venue.time_zone_repaired",
  area: "venue",
  permission: "venue.configure",
};

export function zoneRepairRequest(input: unknown): {
  timeZone: string;
  expectedClockRevision: number;
  confirmed: true;
} {
  const invalid = () => new AppError("management.request_invalid", { field: "body" });
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["timeZone", "expectedClockRevision", "confirmed"].includes(key),
    ) ||
    typeof body.timeZone !== "string" ||
    body.confirmed !== true ||
    typeof body.expectedClockRevision !== "number" ||
    !Number.isSafeInteger(body.expectedClockRevision) ||
    body.expectedClockRevision < 0
  )
    throw invalid();
  return {
    timeZone: body.timeZone,
    expectedClockRevision: body.expectedClockRevision,
    confirmed: true,
  };
}

export async function confirmVenueZone(
  tx: Transaction,
  scope: IssueScope,
  session: string,
  input: unknown,
  at: Date,
): Promise<{ repaired: true; clockRevision: number; admission: "restart_required" }> {
  const { authorizedBy } = await authorizeManager(tx, {
    managementSessionId: session,
    permission: "venue.configure",
  });
  const request = zoneRepairRequest(input);
  const context = await readZoneContext(tx, scope);
  if (context.savedZone.kind === "valid")
    throw new AppError("venue.time_zone_repair_not_needed", {});
  if (request.expectedClockRevision !== context.clockRevision)
    throw new AppError("venue.business_day_changed", {});
  const timeZone = requireCountryTimeZone(context.country, request.timeZone);
  await validateRetainedZoneClock(tx, scope, timeZone, at);
  const clockRevision = context.clockRevision + 1;
  const venueId = await venueLocationId(tx);
  await tx.update(locations).set({ timeZone }).where(eq(locations.id, venueId));
  await tx
    .insert(locationBusinessDaySettings)
    .values({ locationId: venueId, revision: clockRevision })
    .onConflictDoUpdate({
      target: locationBusinessDaySettings.locationId,
      set: { revision: clockRevision },
    });
  await tx.insert(incidents).values({
    source: "dashboard",
    code: "venue.time_zone_repaired",
    severity: "warning",
    detectedAt: at.toISOString(),
    acknowledgedAt: at.toISOString(),
    acknowledgedBy: authorizedBy,
    params: {
      nodeId: context.nodeId,
      timeZone,
      previousRevision: context.clockRevision,
      clockRevision,
      oldCategory: context.savedZone.kind,
      oldFingerprint: createHash("sha256").update(context.clock.timeZone).digest("hex"),
    },
  });
  return { repaired: true, clockRevision, admission: "restart_required" };
}

export async function readVenueZoneRepair(
  tx: Transaction,
  scope: IssueScope,
  session: string,
  admission: TradingAdmissionView,
  at: Date,
  candidate?: string,
) {
  await authorizeManager(tx, { managementSessionId: session, permission: "venue.configure" });
  const context = await readZoneContext(tx, scope);
  const { nodeId, legalName, country, province, savedZone, clockRevision } = context;
  const pack = getCountryPack(country);
  const area = pack === undefined ? undefined : findAdministrativeArea(pack, province ?? "");
  const view = {
    nodeId,
    legalName,
    country,
    province,
    category: savedZone.kind,
    eligible: savedZone.kind !== "valid",
    clockRevision,
    ...(savedZone.kind === "valid" ? { timeZone: savedZone.timeZone } : {}),
    choices: pack?.timeZones ?? [],
    suggestion: area?.timeZone ?? pack?.defaultTimeZone ?? null,
    admission,
    clock: { dayCutover: context.clock.dayCutover, cutoverChanges: context.clock.cutoverChanges },
  };
  if (candidate === undefined) return view;
  const timeZone = requireCountryTimeZone(country, candidate);
  const clock = await validateRetainedZoneClock(tx, scope, timeZone, at);
  const offsetMinutes = timeZoneOffsetMinutes(timeZone, at);
  const civil = new Date(at.getTime() + offsetMinutes * 60_000).toISOString();
  const businessDay = businessDayAt(clock, at);
  return {
    ...view,
    preview: {
      at: at.toISOString(),
      timeZone,
      civilDate: civil.slice(0, 10),
      timeOfDay: civil.slice(11, 19),
      offsetMinutes,
      businessDay,
      dayCutover: cutoverForBusinessDay(clock, businessDay),
    },
  };
}
export type ZoneRepairView = Awaited<ReturnType<typeof readVenueZoneRepair>>;
